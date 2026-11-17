import { Vector3 } from 'three';
import { ORGANELLE_IDS } from './organelles.js';

const PAD = 2; // 兩個標籤之間至少留的空隙（像素）

// 純數學：依固定優先順序（items 的順序）為每個標籤挑位置，保證任兩個被放置的矩形不重疊。
// items: [{ x, y, w, h }]（x、y 是標籤中心；回傳同樣長度的陣列，被放棄的是 null，否則 { x, y }）。
// 後面的標籤先嘗試上下挪動（最多兩個標籤高度：0、+1、−1、+2、−2 個「高度＋空隙」），仍重疊或超出畫面就隱藏。
// obstacles: 不可蓋住的矩形 { left, top, right, bottom }（介面的面板、清單、工具列）。
export function layoutLabels(items, { width, height, obstacles = [] }) {
  const placed = [];
  const hits = (r, list) => list.some((o) => r.left < o.right + PAD && r.right + PAD > o.left && r.top < o.bottom + PAD && r.bottom + PAD > o.top);
  return items.map((it) => {
    if (!it) return null;
    const step = it.h + PAD;
    for (const k of [0, 1, -1, 2, -2]) {
      const y = it.y + k * step;
      const r = { left: it.x - it.w / 2, right: it.x + it.w / 2, top: y - it.h / 2, bottom: y + it.h / 2 };
      if (r.left < 0 || r.top < 0 || r.right > width || r.bottom > height) continue;
      if (hits(r, placed) || hits(r, obstacles)) continue;
      placed.push(r);
      return { x: it.x, y };
    }
    return null;
  });
}

// 每個構造一個名稱標籤（<button>，data-id），掛在 byId.get(id).anchor（沒有錨點時 anchor 就是代表個體根）的世界座標上。
// update() 應該在每次繪製之前呼叫（main.js 掛在 scene.onBeforeRender），這樣標籤與同一個畫面裡的鏡頭、模型位置一致。
// 在鏡頭背面或畫面外的標籤不顯示；容器本身不攔截滑鼠，只有標籤攔截。
export function createLabels({
  container, index, camera, nameOf, palette = {}, onSelect = () => {}, obstacles = () => [], ids = ORGANELLE_IDS,
}) {
  container.innerHTML = '';
  const items = [];
  for (const id of ids) {
    const entry = index.byId.get(id);
    if (!entry || !entry.anchor) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.tabIndex = -1; // 鍵盤操作走底部的清單；這裡只給滑鼠與觸控
    el.className = 'label';
    el.dataset.id = id;
    el.style.setProperty('--c', (palette[id] && palette[id].main) || '#B8B4AC');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = nameOf(id);
    el.append(dot, text);
    el.addEventListener('click', () => onSelect(id));
    container.append(el);
    items.push({ id, el, anchor: entry.anchor, w: 0, h: 0, shown: false, tx: NaN, ty: NaN });
  }

  let visible = false;
  let selectedId = null;
  const v = new Vector3();
  const sizes = () => { // 標籤大小只在顯示時量得到；字體是系統字體，大小固定
    for (const it of items) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
  };

  function update() {
    if (!visible) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const near = camera.near;
    const wanted = items.map((it) => {
      it.anchor.getWorldPosition(v); // 內含祖先矩陣更新，拆解動畫中的位置也是最新的
      v.applyMatrix4(camera.matrixWorldInverse);
      if (v.z > -near) return null; // 在鏡頭背面
      v.applyMatrix4(camera.projectionMatrix);
      if (v.z > 1) return null;
      return { x: Math.round(((v.x + 1) / 2) * W), y: Math.round(((1 - v.y) / 2) * H), w: it.w, h: it.h };
    });
    const rects = obstacles().filter((r) => r && r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    const out = layoutLabels(wanted, { width: W, height: H, obstacles: rects });
    items.forEach((it, i) => {
      const p = out[i];
      const show = p !== null;
      if (show !== it.shown) { it.el.hidden = !show; it.shown = show; }
      if (!show) return;
      const tx = Math.round(p.x - it.w / 2);
      const ty = Math.round(p.y - it.h / 2);
      if (tx !== it.tx || ty !== it.ty) {
        it.el.style.transform = `translate(${tx}px, ${ty}px)`;
        it.tx = tx; it.ty = ty;
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
        for (const it of items) { it.el.hidden = false; it.shown = true; }
        sizes();
        update();
      }
    },
    setSelected(id) {
      selectedId = id ?? null;
      for (const it of items) it.el.classList.toggle('selected', it.id === selectedId);
    },
    update,
    get visible() { return visible; },
  };
}
