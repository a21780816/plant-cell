import { Raycaster, Vector2 } from 'three';
import { findOrganelle, findInstanceRoot } from './model.js';

const CLICK_SLOP = 5; // 按下與放開位移不超過這個像素數才算點選

export function isClick(down, up) {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP;
}

function isVisibleChain(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  return true;
}

// 射線會穿過：自己或任一層祖先 visible === false 的網格，以及 isPickable(id) 為 false 的構造。
export function createPicker({ dom, camera, index, isPickable, onHover, onPick }) {
  const meshes = [];
  for (const entry of index.byId.values()) meshes.push(...entry.meshes);
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  // 回傳 { id, inst } 或 null；座標為視窗（client）像素。
  function hitAt(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const candidates = meshes.filter((m) => {
      const id = findOrganelle(m);
      return id !== null && isVisibleChain(m) && isPickable(id);
    });
    const hits = raycaster.intersectObjects(candidates, false);
    if (!hits.length) return null;
    const mesh = hits[0].object;
    const root = findInstanceRoot(mesh);
    return { id: findOrganelle(mesh), inst: root ? root.userData.inst : 0 };
  }

  const keyOf = (h) => (h ? `${h.id}:${h.inst}` : '');
  let lastKey = '';
  const emitHover = (h) => {
    const k = keyOf(h);
    if (k === lastKey) return;
    lastKey = k;
    onHover(h);
  };

  let down = null;
  let moveAt = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (moveAt) emitHover(hitAt(moveAt.x, moveAt.y));
  };

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e) => {
    const d = down;
    down = null;
    if (!d || !isClick(d, { x: e.clientX, y: e.clientY })) return;
    onPick(hitAt(e.clientX, e.clientY));
  };
  const onCancel = () => { down = null; };
  const onMove = (e) => {
    if (e.pointerType === 'touch' || e.buttons) return; // 觸控沒有滑過；拖曳中不做射線
    moveAt = { x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(flush); // 每個畫面最多射一次
  };
  const onLeave = () => {
    moveAt = null;
    emitHover(null);
  };

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onCancel);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerleave', onLeave);

  return {
    hitAt,
    dispose() {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onCancel);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
