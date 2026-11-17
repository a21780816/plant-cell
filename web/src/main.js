import { Vector3 } from 'three';
import modelBytes from '../../assets/plant_cell.glb';
import palette from '../../shared/palette.json';
import { createScene } from './scene.js';
import { parseModel, indexModel, findOrganelle, findInstanceRoot } from './model.js';
import { applyMaterials } from './materials.js';
import { ORGANELLES, getOrganelle } from './organelles.js';
import { GHOST_IDS } from './config.js';
import { createStore } from './state.js';
import { createPicker } from './picking.js';
import { createHighlighter } from './highlight.js';
import { createCameraMoves } from './camera-moves.js';
import { mountPanel } from './ui/panel.js';
import { mountList } from './ui/list.js';
import { placeHoverName } from './ui/hover-name.js';

const canvas = document.getElementById('stage');
const root = document.documentElement;

async function main() {
  const view = createScene(canvas);
  const model = await parseModel(modelBytes);
  const index = indexModel(model);
  applyMaterials(index, palette);
  view.scene.add(model);
  if (index.lid) index.lid.visible = false; // 本階段畫面是掀開狀態

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
    applyDefault: () => view.frame(index.box), // 回到預設後完整套用（含 maxDistance、far、陰影）並重設旗標
  });
  const panel = mountPanel(document.getElementById('panel'), {
    palette, onClose: () => store.dispatch({ type: 'deselect' }),
  });
  const list = mountList(document.getElementById('list'), {
    organelles: ORGANELLES, palette,
    onSelect: (id) => store.dispatch({ type: 'select', id, inst: null }),
  });
  const hoverName = document.getElementById('hover-name');

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

  let prev = { selected: undefined, hovered: undefined };
  function render(s) {
    highlighter.apply(s);
    if (s.hovered !== prev.hovered) paintHover();
    if (s.selected !== prev.selected) {
      const sel = s.selected;
      list.setActive(sel ? sel.id : null);
      if (sel) {
        panel.show(getOrganelle(sel.id));
        const entry = index.byId.get(sel.id);
        const target = sel.inst === null
          ? (entry.anchor ?? entry.rep)
          : entry.instances.find((r) => r.userData.inst === sel.inst) ?? entry.rep;
        if (target) moves.focus(target);
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
    highlighter.update(dt);
    // 鏡頭在動（動畫或阻尼）而游標不動時，滑過狀態要跟著畫面重算；每畫面最多一次
    const me = view.camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (me[i] !== camSeen[i]) { moved = true; camSeen[i] = me[i]; }
    if (moved) picker.refresh();
    if (first) { first = false; root.dataset.cellReady = '1'; }
  });
}

main().catch((e) => {
  root.dataset.cellError = String(e && e.message ? e.message : e);
  console.warn('[cell] 載入失敗', e);
});
