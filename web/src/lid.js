import { Vector3 } from 'three';
import { isLidMesh } from './picking.js';

export const LID_OFFSET = [3, 2.5, 3]; // three.js 世界座標下，蓋子移開的位移
export const LID_DURATION = 1.4;       // 秒
export const FADE_START = 0.35;        // 動畫進度到這裡才開始變淡
const LID_ORDER_BASE = 10;             // 大於 materials.js 的 TRANSLUCENT（1–3）與 config.js 的 GHOST_ORDER（最大 2）

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// 蓋子：開場時蓋著（外觀與本體完全一致、不透明、會投影）；open() 讓它沿 LID_OFFSET 移開並淡出。
// 蓋子底下的網格不受 highlight.js 管理，材質由這裡獨佔。
export function createLid(index) {
  const root = index.lid;
  const state = { isOpen: !root, opening: false };
  if (!root) return { open() {}, update() {}, get isOpen() { return true; } };

  const meshes = [];
  root.traverse((o) => { if (o.isMesh && isLidMesh(o)) meshes.push(o); });
  const mats = new Map(); // 材質 -> 原本的不透明度
  for (const m of meshes) if (!mats.has(m.material)) mats.set(m.material, m.material.opacity);

  const start = root.position.clone();
  let end = start;
  let t = 0;
  let faded = false; // 已切成「半透明、不寫深度、排在最後」

  function beginFade() {
    faded = true;
    for (const m of meshes) {
      const mat = m.material;
      if (!mat.transparent) { mat.transparent = true; mat.needsUpdate = true; }
      mat.depthWrite = false;
      m.renderOrder = LID_ORDER_BASE + m.renderOrder; // 保持蓋子內部原本的先後，整體排在其他構造之後
    }
  }

  function open() {
    if (state.opening || state.isOpen) return;
    state.opening = true;
    for (const m of meshes) m.castShadow = false; // 內部在蓋子掀起時亮起來
    // 世界座標的位移換算成蓋子父節點的區域座標
    const parent = root.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      const w0 = parent.localToWorld(start.clone());
      end = parent.worldToLocal(w0.add(new Vector3(...LID_OFFSET)));
    } else {
      end = start.clone().add(new Vector3(...LID_OFFSET));
    }
  }

  function update(dt) {
    if (!state.opening || state.isOpen) return;
    t = Math.min(1, t + Math.max(0, dt) / LID_DURATION);
    const e = easeInOutCubic(t);
    root.position.lerpVectors(start, end, e);
    if (e >= FADE_START) {
      if (!faded) beginFade();
      const k = Math.max(0, 1 - (e - FADE_START) / (1 - FADE_START));
      for (const [mat, base] of mats) mat.opacity = base * k;
    }
    if (t >= 1) {
      root.visible = false;
      state.isOpen = true;
    }
  }

  return { open, update, get isOpen() { return state.isOpen; } };
}
