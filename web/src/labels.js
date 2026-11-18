import { Vector3 } from 'three';
import { ORGANELLE_IDS, getOrganelle } from './organelles.js';

// ---- 版面（純函式，不依賴 DOM 與 three.js）----
export const DIR_COUNT = 8;
export const DISTANCES = [40, 70, 100, 135]; // 錨點到藥丸中心的距離（像素）
const DOT_R = 4;   // 錨點圓點含外框的半徑
const GAP = 3;     // 藥丸之間、藥丸與圓點或介面之間至少留的空隙

const hits = (a, b, gap = GAP) =>
  a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
const dotRect = (it) => ({ left: it.ax - DOT_R, right: it.ax + DOT_R, top: it.ay - DOT_R, bottom: it.ay + DOT_R });

// 8 個方向（螢幕座標，y 向下）的單位向量；編號 i 對應角度 i × 45°。
export const dirVector = (i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)];

// 往外方向（ox, oy）最接近的方向編號；零向量視為向上。
export function nearestDir(ox, oy) {
  if (!ox && !oy) return 6;
  const a = Math.atan2(oy, ox);
  return ((Math.round(a / (Math.PI / 4)) % DIR_COUNT) + DIR_COUNT) % DIR_COUNT;
}

// 候選順序：距離由近到遠；同一距離內，從往外的方向開始，再往兩側展開（+1、−1、+2、−2、+3、−3、對向）。
export function candidateOrder(ox, oy) {
  const base = nearestDir(ox, oy);
  const out = [];
  for (let d = 0; d < DISTANCES.length; d++) {
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) out.push({ dir: (base + k + DIR_COUNT) % DIR_COUNT, dist: d });
  }
  return out;
}

// items（依優先順序）：{ ax, ay, w, h, ox, oy } 錨點的畫面座標、藥丸大小、往外方向（模型中心指向錨點）；不可顯示的放 null。
// 回傳同長陣列：null（隱藏）或 { x, y, cand }（藥丸中心與採用的候選）。
// prev：上一格採用的 cand（或 null）陣列；仍然合格就沿用，旋轉時標籤才不會來回跳。
// 合格 = 藥丸完整在視窗內，且不與已放好的藥丸、其他標籤的圓點（含自己的）、obstacles 重疊。
export function layoutLabels(items, { width, height, obstacles = [], prev = [] }) {
  const dots = items.map((it) => (it ? dotRect(it) : null));
  const placed = [];
  const rectOf = (it, cand) => {
    const [vx, vy] = dirVector(cand.dir);
    const x = it.ax + vx * DISTANCES[cand.dist];
    const y = it.ay + vy * DISTANCES[cand.dist];
    return { x, y, left: x - it.w / 2, right: x + it.w / 2, top: y - it.h / 2, bottom: y + it.h / 2 };
  };
  const ok = (r, i) => {
    if (r.left < 0 || r.top < 0 || r.right > width || r.bottom > height) return false;
    if (placed.some((p) => hits(r, p))) return false;
    if (obstacles.some((o) => hits(r, o, 0))) return false;
    return !dots.some((d, j) => d && (j === i ? hits(r, d, GAP + 1) : hits(r, d, 1)));
  };
  return items.map((it, i) => {
    if (!it) return null;
    const tries = [];
    if (prev[i]) tries.push(prev[i]);
    tries.push(...candidateOrder(it.ox, it.oy));
    for (const cand of tries) {
      const r = rectOf(it, cand);
      if (!ok(r, i)) continue;
      placed.push(r);
      return { x: r.x, y: r.y, cand: { dir: cand.dir, dist: cand.dist } };
    }
    return null;
  });
}

// ---- 畫面 ----
const SVG = 'http://www.w3.org/2000/svg';

// 每個構造一組引線標註：錨點圓點＋引線（畫在一張 SVG 上，不攔截滑鼠）與名稱藥丸（<button data-id>，攔截滑鼠）。
// 錨點是 byId.get(id).anchor（沒有錨點時就是代表個體根）。update() 要在每次繪製之前呼叫
//（main.js 掛在 scene.onBeforeRender），標籤才與同一個畫面的鏡頭、模型一致。
export function createLabels({
  container, index, camera, nameOf, palette = {}, onSelect = () => {}, obstacles = () => [], ids = ORGANELLE_IDS,
}) {
  container.innerHTML = '';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'label-lines');
  svg.setAttribute('aria-hidden', 'true');
  container.append(svg);

  const items = [];
  for (const id of ids) {
    const entry = index.byId.get(id);
    if (!entry || !entry.anchor) continue;
    const color = (palette[id] && palette[id].main) || '#B8B4AC';
    const el = document.createElement('button');
    el.type = 'button';
    el.tabIndex = -1; // 鍵盤操作走底部的清單；這裡只給滑鼠與觸控
    el.className = 'label';
    el.dataset.id = id;
    el.style.setProperty('--c', color);
    el.textContent = nameOf(id);
    el.addEventListener('click', () => onSelect(id));
    container.append(el);
    const g = document.createElementNS(SVG, 'g');
    g.dataset.for = id; // 圓點與引線（不用 data-id，#labels [data-id] 只有 20 個藥丸）
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('class', 'leader');
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('class', 'anchor-dot');
    dot.setAttribute('r', '3.5');
    dot.style.fill = color;
    g.append(line, dot);
    g.setAttribute('visibility', 'hidden');
    svg.append(g);
    const o = getOrganelle(id);
    items.push({
      id, el, g, line, dot, anchor: entry.anchor, pickable: !(o && o.pickable === false),
      w: 0, h: 0, shown: false, tx: NaN, ty: NaN, prev: null, geo: '',
    });
  }
  // 優先順序：可點選的 13 個在前、不可點選的 7 個在後，各自照既定順序（sort 穩定）
  const order = [...items.keys()].sort((a, b) => Number(!items[a].pickable) - Number(!items[b].pickable));

  let visible = false;
  let selectedId = null;
  const v = new Vector3();
  const c = new Vector3();
  const sizes = () => { for (const it of items) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; } };
  const project = (world, W, H) => {
    v.copy(world).applyMatrix4(camera.matrixWorldInverse);
    if (v.z > -camera.near) return null; // 在鏡頭背面
    v.applyMatrix4(camera.projectionMatrix);
    if (v.z > 1) return null;
    return { x: Math.round(((v.x + 1) / 2) * W), y: Math.round(((1 - v.y) / 2) * H) };
  };

  function update() {
    if (!visible) return;
    const W = container.clientWidth || window.innerWidth; // 標籤的範圍就是畫布（容器的大小）
    const H = container.clientHeight || window.innerHeight;
    const mc = project(index.center, W, H); // 模型中心的投影：標籤往外呈放射狀
    const wanted = order.map((i) => {
      const it = items[i];
      it.anchor.getWorldPosition(c);
      const p = project(c, W, H);
      if (!p || p.x < 0 || p.y < 0 || p.x > W || p.y > H) return null;
      const len = mc ? Math.hypot(p.x - mc.x, p.y - mc.y) : 0;
      return { ax: p.x, ay: p.y, w: it.w, h: it.h, ox: len ? (p.x - mc.x) / len : 0, oy: len ? (p.y - mc.y) / len : 0 };
    });
    const rects = obstacles().filter((r) => r && r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    const out = layoutLabels(wanted, { width: W, height: H, obstacles: rects, prev: order.map((i) => items[i].prev) });
    order.forEach((i, k) => {
      const it = items[i];
      const p = out[k];
      it.prev = p ? p.cand : null;
      const show = p !== null;
      if (show !== it.shown) {
        it.el.hidden = !show;
        it.g.setAttribute('visibility', show ? 'visible' : 'hidden');
        it.shown = show;
      }
      if (!show) return;
      const w = wanted[k];
      const left = Math.round(p.x - it.w / 2);
      const top = Math.round(p.y - it.h / 2);
      if (left !== it.tx || top !== it.ty) {
        it.el.style.transform = `translate(${left}px, ${top}px)`;
        it.tx = left; it.ty = top;
      }
      // 引線：從錨點到藥丸最近的邊
      const ex = Math.min(Math.max(w.ax, left), left + it.w);
      const ey = Math.min(Math.max(w.ay, top), top + it.h);
      const geo = `${w.ax},${w.ay},${ex},${ey}`;
      if (geo !== it.geo) {
        it.geo = geo;
        it.line.setAttribute('x1', w.ax); it.line.setAttribute('y1', w.ay);
        it.line.setAttribute('x2', ex); it.line.setAttribute('y2', ey);
        it.dot.setAttribute('cx', w.ax); it.dot.setAttribute('cy', w.ay);
      }
    });
  }

  return {
    setVisible(on) {
      on = !!on;
      if (on === visible) return;
      visible = on;
      container.hidden = !on;
      if (on) {
        for (const it of items) { it.el.hidden = false; it.g.setAttribute('visibility', 'visible'); it.shown = true; it.prev = null; }
        sizes();
        update();
      }
    },
    setSelected(id) {
      selectedId = id ?? null;
      for (const it of items) {
        const on = it.id === selectedId;
        it.el.classList.toggle('selected', on);
        it.dot.classList.toggle('selected', on);
      }
    },
    // 換語言：更新藥丸文字；可見時重新量大小、清掉每個 prev（讓版面重新找位置）並立刻重排
    setNames(nameOfNext) {
      for (const it of items) it.el.textContent = nameOfNext(it.id);
      if (!visible) return;
      sizes();
      for (const it of items) it.prev = null;
      update();
    },
    update,
    get visible() { return visible; },
  };
}
