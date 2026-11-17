import { Box3, Quaternion, Sphere, Vector3 } from 'three';
import { findInstanceRoot } from './model.js';

const DURATION = 0.8;                       // 秒
const easeOutCubic = (t) => 1 - (1 - t) ** 3; // 先快後慢
const RADIUS_FACTOR = 4;
const MIN_DIST = 3;
const MAX_DIST = 14;

// 平順的鏡頭移動。保持當下的觀看方向（focus）或轉向預設方向（home），
// 目標點、距離、方向各自內插；使用者一開始拖曳或滾輪（OrbitControls 的 start 事件）就中止。
// defaultPose() 與 setUserMoved() 由 scene.js 提供：動畫期間標記「使用者動過鏡頭」，
// 避免 resize() 把鏡頭拉回預設；回到預設位置後由 applyDefault（view.frame）完整套用並重設旗標。
export function createCameraMoves({ camera, controls, defaultPose = null, setUserMoved = () => {}, applyDefault = null }) {
  let move = null;

  function begin(resolveEnd, onDone, opts = {}) {
    const target0 = controls.target.clone();
    const off0 = camera.position.clone().sub(target0);
    move = { target0, len0: off0.length(), dir0: off0.clone().normalize(), resolveEnd, onDone, t: 0, duration: opts.duration ?? DURATION, ease: opts.ease ?? easeOutCubic };
    setUserMoved(true);
  }

  function focus(object3d) {
    object3d.updateWorldMatrix(true, false);
    const target = object3d.getWorldPosition(new Vector3());
    const root = findInstanceRoot(object3d);
    let radius = 1;
    if (root) {
      const box = new Box3().setFromObject(root);
      if (!box.isEmpty()) radius = box.getBoundingSphere(new Sphere()).radius;
    }
    const dist = Math.min(MAX_DIST, Math.max(MIN_DIST, radius * RADIUS_FACTOR));
    const dir = camera.position.clone().sub(controls.target).normalize();
    begin(() => ({ target, len: dist, dir }));
  }

  // opts.duration / opts.ease：拆解與組合用較長的時間與對稱的緩動，才跟得上模型的伸縮（預設 0.8 秒、先快後慢）
  function home(opts) {
    if (!defaultPose) return;
    begin(() => {
      const p = defaultPose();
      const off = p.position.clone().sub(p.target);
      return { target: p.target, len: off.length(), dir: off.normalize() };
    }, () => (applyDefault ? applyDefault() : setUserMoved(false)), opts); // 結束時完整套用預設鏡頭（含 maxDistance、far）
  }

  function update(dt) {
    if (!move) return;
    const m = move;
    m.t = Math.min(1, m.t + dt / m.duration);
    const e = m.ease(m.t);
    const end = m.resolveEnd();
    const q = new Quaternion().slerp(new Quaternion().setFromUnitVectors(m.dir0, end.dir), e);
    const dir = m.dir0.clone().applyQuaternion(q);
    const len = m.len0 + (end.len - m.len0) * e;
    controls.target.lerpVectors(m.target0, end.target, e);
    camera.position.copy(controls.target).addScaledVector(dir, len);
    controls.update();
    if (m.t >= 1) {
      move = null;
      if (m.onDone) m.onDone();
    }
  }

  controls.addEventListener('start', () => { move = null; }); // 使用者接手

  return {
    focus, home, update,
    get busy() { return move !== null; },
  };
}
