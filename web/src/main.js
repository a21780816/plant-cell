import { Vector3 } from 'three';
import modelBytes from '../../assets/plant_cell.glb';
import palette from '../../shared/palette.json';
import { createScene } from './scene.js';
import { parseModel, indexModel, findOrganelle, findInstanceRoot } from './model.js';
import { applyMaterials } from './materials.js';
import { ORGANELLES, INTRO, getOrganelle } from './organelles.js';
import { GHOST_IDS, SCALE_IDS } from './config.js';
import { createStore } from './state.js';
import { createPicker } from './picking.js';
import { createHighlighter } from './highlight.js';
import { createCameraMoves } from './camera-moves.js';
import { createLid, easeInOutCubic } from './lid.js';
import { createExploder } from './explode.js';
import { createLabels } from './labels.js';
import { mountPanel } from './ui/panel.js';
import { mountList } from './ui/list.js';
import { mountIntro } from './ui/intro.js';
import { mountToolbar } from './ui/toolbar.js';
import { placeHoverName } from './ui/hover-name.js';

const canvas = document.getElementById('stage');
const root = document.documentElement;

const FALLBACK_TEXT = '這個瀏覽器無法顯示 3D 內容，請改用新版的 Chrome 開啟。';
const IDLE_MS = 4000; // 使用者閒置這麼久才開始自轉
const EXPLODE_MOVE = { duration: 1, ease: easeInOutCubic }; // 拆解／組合時的鏡頭移動：與模型的伸縮同步，才不會在動畫中途被切出畫面

// 建立 WebGL 失敗：只顯示說明（開場卡片與清單都不出現），並留下錯誤原因供除錯。
function showFallback(e) {
  root.dataset.cellError = String(e && e.message ? e.message : e);
  console.warn('[cell] 無法建立 WebGL', e);
  document.getElementById('intro').hidden = true;
  const box = document.getElementById('fallback');
  box.textContent = FALLBACK_TEXT;
  box.hidden = false;
}

async function main() {
  let view;
  try {
    view = createScene(canvas);
  } catch (e) {
    showFallback(e);
    return;
  }
  const model = await parseModel(modelBytes);
  const index = indexModel(model);
  applyMaterials(index, palette);
  view.scene.add(model);
  const lid = createLid(index); // 開場時蓋著；按下開始後掀開
  const exploder = createExploder(index);
  // 各狀態的取景：box 是預設鏡頭要完整框住的外框（拆解時只框真正散開的構造；外殼與貼著細胞壁的原生質絲、微管、微絲（SCALE_IDS）撐滿整面壁，框它們畫面只會剩 55%，所以允許超出畫面），
  // extent 是使用者縮到最遠、遠平面、陰影範圍要涵蓋的完整外框（含外殼）。
  const explodedFrame = { box: exploder.explodedBox(SCALE_IDS), extent: exploder.explodedBox(), margin: 1.0 }; // 留白 1.0：散開的構造才能佔畫面寬度六成以上
  const restFrame = { box: index.box, extent: index.box, margin: 1.08 };
  const frameOf = (exploded) => (exploded ? explodedFrame : restFrame);

  view.frame(index.box);

  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const triangles = meshes.reduce((n, m) => {
    const g = m.geometry;
    return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
  }, 0);
  const ids = [...new Set(meshes.map(findOrganelle).filter((x) => x !== null))];

  // ---- 狀態與各個畫面：選取狀態只存在 store ----
  const store = createStore();
  const highlighter = createHighlighter(index);
  const moves = createCameraMoves({
    camera: view.camera, controls: view.controls,
    defaultPose: view.defaultPose, setUserMoved: view.setUserMoved,
    applyDefault: () => { const f = frameOf(store.getState().exploded); return view.frame(f.box, f.extent, f.margin); }, // 回到預設後完整套用（含 maxDistance、far、陰影）並重設旗標
  });
  const panel = mountPanel(document.getElementById('panel'), {
    palette, onClose: () => store.dispatch({ type: 'deselect' }),
  });
  const list = mountList(document.getElementById('list'), {
    organelles: ORGANELLES, palette,
    onSelect: (id) => store.dispatch({ type: 'select', id, inst: null }),
  });
  const toolbar = mountToolbar(document.getElementById('toolbar'), {
    onExplode: () => store.dispatch({ type: 'toggleExplode' }),
    onLabels: () => store.dispatch({ type: 'toggleLabels' }),
  });
  const labels = createLabels({
    container: document.getElementById('labels'), index, camera: view.camera, palette,
    nameOf: (id) => getOrganelle(id).zh,
    onSelect: (id) => store.dispatch({ type: 'select', id, inst: null }),
    obstacles: () => ['list-wrap', 'toolbar', 'panel'].map((n) => {
      const el = document.getElementById(n);
      return el && !el.hidden ? el.getBoundingClientRect() : null;
    }),
  });
  // 標籤在每次繪製之前更新（此時鏡頭與模型矩陣都已是這一格要畫的狀態），才不會落後一格
  view.scene.onBeforeRender = () => labels.update();
  const hoverName = document.getElementById('hover-name');
  const intro = mountIntro(document.getElementById('intro'), {
    intro: INTRO,
    onStart: () => {
      store.dispatch({ type: 'start' });
      lid.open();
      intro.hide();
    },
  });

  const isPickable = (id) => {
    const o = getOrganelle(id);
    if (o && o.pickable === false) return false;
    if (highlighter.shellsGhosted && GHOST_IDS.includes(id)) return false;
    return true;
  };

  const picker = createPicker({
    dom: canvas, camera: view.camera, index, isPickable,
    onHover: (h) => store.dispatch(h ? { type: 'hover', id: h.id, inst: h.inst } : { type: 'unhover' }),
    onPressChange: () => paintHover(), // 拖曳中隱藏名稱與手指游標
    onPick: (h) => {
      if (h) store.dispatch({ type: 'select', id: h.id, inst: h.inst });
      else if (store.getState().selected) store.dispatch({ type: 'deselect' });
    },
  });

  // #hover-name 跟著游標（右下 14 像素，靠邊時翻到另一側，完整留在視窗內）
  let pointer = { x: 0, y: 0 };
  function placeLabel() {
    const p = placeHoverName({
      x: pointer.x, y: pointer.y, width: hoverName.offsetWidth, height: hoverName.offsetHeight,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    });
    hoverName.style.transform = `translate(${p.left}px, ${p.top}px)`;
  }
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (!hoverName.hidden) placeLabel();
  });
  function paintHover() {
    const h = store.getState().hovered;
    const o = h && getOrganelle(h.id);
    const show = !!o && !picker.pressed;
    if (o) hoverName.textContent = o.zh;
    hoverName.hidden = !show;
    canvas.style.cursor = show ? 'pointer' : '';
    if (show) placeLabel();
  }

  // ---- 自轉：探索階段、蓋子已打開、沒有選取、沒有鏡頭動畫、使用者閒置滿 4 秒才轉 ----
  let lastActivity = performance.now();
  let openedAt = null; // 蓋子完全打開的時刻；閒置計時從這裡起算
  function updateAutoRotate() {
    const now = performance.now();
    const s = store.getState();
    if (lid.isOpen && openedAt === null) openedAt = now;
    const want = s.phase === 'explore' && lid.isOpen && !s.selected && !moves.busy && !exploder.moving
      && now - Math.max(lastActivity, openedAt) >= IDLE_MS;
    if (want !== view.isAutoRotating()) view.setAutoRotate(want);
  }
  function noteActivity() {
    lastActivity = performance.now();
    updateAutoRotate(); // 一操作就立刻停止自轉
  }
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
    window.addEventListener(type, noteActivity, { capture: true, passive: true });
  }
  canvas.addEventListener('pointermove', noteActivity, { passive: true });

  // 拆解動畫結束時，若有選取，鏡頭重新對準被選構造的新位置（使用者在中途自己動了鏡頭就不搶）
  let pendingRefocus = false;
  view.controls.addEventListener('start', () => { pendingRefocus = false; });
  const targetOf = (sel) => {
    const entry = index.byId.get(sel.id);
    return sel.inst === null
      ? (entry.anchor ?? entry.rep)
      : entry.instances.find((r) => r.userData.inst === sel.inst) ?? entry.rep;
  };

  let prev = { selected: undefined, hovered: undefined, exploded: false, labels: false };
  function render(s) {
    document.body.dataset.phase = s.phase; // 清單等介面依階段顯示（CSS）
    highlighter.apply(s);
    toolbar.setState(s);
    labels.setVisible(s.labels && s.phase === 'explore');
    if (s.exploded !== prev.exploded) {
      noteActivity();
      exploder.set(s.exploded);
      { const f = frameOf(s.exploded); view.setFrameBox(f.box, f.extent, f.margin); } // 之後的預設位置（含取消選取、視窗縮放）以這個狀態的外框為準
      if (s.selected) pendingRefocus = true;
      else moves.home(EXPLODE_MOVE);
    }
    if (s.hovered !== prev.hovered) paintHover();
    if (s.selected !== prev.selected) {
      noteActivity();
      const sel = s.selected;
      list.setActive(sel ? sel.id : null);
      labels.setSelected(sel ? sel.id : null);
      if (sel) {
        panel.show(getOrganelle(sel.id));
        const target = targetOf(sel);
        if (target) moves.focus(target);
        if (exploder.moving) pendingRefocus = true; // 動畫還沒結束，結束時再對準一次
      } else {
        panel.hide();
        if (prev.selected) moves.home(); // 取消選取：鏡頭回到預設位置
      }
    }
    prev = s;
  }
  store.subscribe(render);
  render(store.getState());

  // ---- 除錯與端對端測試用 ----
  const projectToClient = (world) => {
    view.camera.updateMatrixWorld();
    const v = world.clone().project(view.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z };
  };

  // 畫面上一個射線確實會打到該 id 的點（視窗 CSS 像素，可直接拿去點）；都被擋住就回 null。
  function screenPointOf(id) {
    const entry = index.byId.get(id);
    if (!entry) return null;
    model.updateMatrixWorld(true);
    const w = new Vector3();
    for (const inst of entry.instances) {
      const cands = [inst.getWorldPosition(new Vector3())];
      for (const m of entry.meshes) {
        if (findInstanceRoot(m) !== inst) continue;
        const pos = m.geometry.attributes.position;
        const step = Math.max(1, Math.ceil(pos.count / 150));
        for (let i = 0; i < pos.count; i += step) {
          cands.push(w.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
        }
      }
      for (const c of cands) {
        const p = projectToClient(c);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (p.z < -1 || p.z > 1 || x < 4 || y < 4 || x > window.innerWidth - 4 || y > window.innerHeight - 4) continue;
        if (document.elementFromPoint(x, y) !== canvas) continue;
        const h = picker.hitAt(x, y);
        if (h && h.id === id) return { x, y };
      }
    }
    return null;
  }

  const dts = [];
  window.__cell = {
    index,
    view, // 除錯與端對端測試用
    store,
    cameraBusy: () => moves.busy,
    explodeProgress: () => exploder.progress,
    lidOpen: () => lid.isOpen,
    autoRotating: () => view.isAutoRotating(),
    hitAt: (x, y) => picker.hitAt(x, y), // 與點選相同規則的射線測試
    screenPointOf,
    repScreenPoint(id) {
      const entry = index.byId.get(id);
      const p = projectToClient(entry.rep.getWorldPosition(new Vector3()));
      return { x: p.x, y: p.y };
    },
    stats() {
      const avg = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
      return {
        meshes: meshes.length,
        unresolved: meshes.filter((m) => findOrganelle(m) === null).length,
        ids,
        triangles,
        fps: avg > 0 ? 1 / avg : 0,
      };
    },
  };

  let first = true;
  const camSeen = new Float64Array(16);
  view.start((dt) => {
    dts.push(dt);
    if (dts.length > 60) dts.shift();
    moves.update(dt);
    const wasExploding = exploder.moving;
    exploder.update(dt);
    if (wasExploding && !exploder.moving && pendingRefocus) {
      pendingRefocus = false;
      const sel = store.getState().selected;
      const target = sel && targetOf(sel);
      if (target) moves.focus(target);
    }
    lid.update(dt);
    highlighter.update(dt);
    updateAutoRotate();
    // 鏡頭在動（動畫或阻尼）而游標不動時，滑過狀態要跟著畫面重算；每畫面最多一次
    const me = view.camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (me[i] !== camSeen[i]) { moved = true; camSeen[i] = me[i]; }
    if (moved || exploder.moving) picker.refresh();
    if (first) { first = false; root.dataset.cellReady = '1'; }
  });
}

main().catch((e) => {
  root.dataset.cellError = String(e && e.message ? e.message : e);
  console.warn('[cell] 載入失敗', e);
});
