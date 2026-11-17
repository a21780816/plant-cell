import { Box3, Matrix3, Vector3 } from 'three';
import { SCALE_IDS } from './config.js';
import { easeInOutCubic } from './lid.js';

// 拆解（爆炸圖）：讓各個體從模型中心向外散開。只動「個體根節點」的位置與縮放，不動網格與材質。
export const SPREAD = 0.9;                       // 每個個體沿「中心到自己」的方向多走 SPREAD 倍的距離
export const EXTRA = { nucleolus: [1.2, 1.0, 1.2] }; // 額外位移：核仁要離開細胞核的剖面
export const DURATION = 1.0;                     // 秒；easeInOutCubic

// 以 id 為單位：不自己算位移，而是跟著所屬構造的代表個體做完全相同的位移（染色質留在細胞核裡、細胞質絲留在液泡裡）。
export const FOLLOW = { chromatin: 'nucleus', transvacuolar_strand: 'vacuole' };

// 以「個體」為單位的規則（id → { 個體編號: 規則 }），優先於 FOLLOW 與 SCALE_IDS：
// - ribosome 個體 0 是附著在粗糙內質網上的那一群，照公式算會與內質網差約 0.13，
//   核糖體會飄離或陷進相鄰的扁囊，所以跟著 rough_er 的代表個體走。
// - ribosome 個體 1 是游離的 14 簇，根在細胞中心附近，照公式幾乎不動，會被移過來的液泡等蓋住，
//   所以和 SCALE_IDS 一樣以模型中心放大。
export const INSTANCE_RULES = {
  ribosome: { 0: { kind: 'follow', of: 'rough_er' }, 1: { kind: 'scale' } },
};

// 目標位置（世界座標）：position + (position − center) × SPREAD + EXTRA[id]
export function explodeTarget(position, center, id) {
  const extra = EXTRA[id] ?? [0, 0, 0];
  return position.map((p, i) => p + (p - center[i]) * SPREAD + extra[i]);
}

// 一個個體屬於哪一種處理：'scale'（以中心放大）、'follow'（跟隨 of 的代表個體）、'move'（依 explodeTarget 位移）。
export function ruleFor(id, inst) {
  const byInst = INSTANCE_RULES[id] && INSTANCE_RULES[id][inst];
  if (byInst) return { ...byInst };
  if (FOLLOW[id]) return { kind: 'follow', of: FOLLOW[id] };
  if (SCALE_IDS.includes(id)) return { kind: 'scale' };
  return { kind: 'move' };
}

// 建立拆解器。progress 是「已套用的拆解程度」（0 組合、1 完全拆解，已含緩動）；
// 動畫中途 set() 反向時，內部時間從目前位置連續地折返，不會跳動。
export function createExploder(index) {
  const center = index.center.toArray();
  const c = index.center;
  const nodes = [];
  const repNode = new Map(); // id -> 代表個體的 node

  for (const [id, entry] of index.byId) {
    for (const root of entry.instances) {
      root.updateWorldMatrix(true, false);
      const inst = root.userData.inst;
      const p0 = root.getWorldPosition(new Vector3());
      const node = {
        id, inst, root, p0,
        rule: ruleFor(id, inst),
        local0: root.position.clone(),
        scale0: root.scale.clone(),
        box0: new Box3().setFromObject(root),
        disp: new Vector3(), // 完全拆解時的世界位移
        ldisp: new Vector3(), // 同一位移換算到父節點座標
      };
      nodes.push(node);
      if (root === entry.rep) repNode.set(id, node);
    }
  }

  const SCALE = 1 + SPREAD;
  for (const n of nodes) {
    if (n.rule.kind === 'scale') n.disp.copy(n.p0).sub(c).multiplyScalar(SPREAD);
    else if (n.rule.kind === 'move') n.disp.fromArray(explodeTarget(n.p0.toArray(), center, n.id)).sub(n.p0);
  }
  for (const n of nodes) {
    if (n.rule.kind !== 'follow') continue;
    const target = repNode.get(n.rule.of);
    if (target && target.rule.kind !== 'follow') {
      n.disp.copy(target.disp);
    } else { // 找不到所屬構造：退回一般位移，不讓它留在原地被蓋住
      n.rule = { kind: 'move' };
      n.disp.fromArray(explodeTarget(n.p0.toArray(), center, n.id)).sub(n.p0);
    }
  }
  const inv = new Matrix3();
  for (const n of nodes) {
    const parent = n.root.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      inv.setFromMatrix4(parent.matrixWorld).invert();
      n.ldisp.copy(n.disp).applyMatrix3(inv);
    } else n.ldisp.copy(n.disp);
  }

  let t = 0;      // 時間進度 0..1（線性）
  let goal = 0;
  let applied = 0; // 上次套用的 progress
  let ease = 0;

  function apply(e) {
    for (const n of nodes) {
      n.root.position.copy(n.local0).addScaledVector(n.ldisp, e);
      if (n.rule.kind === 'scale') n.root.scale.copy(n.scale0).multiplyScalar(1 + SPREAD * e);
    }
    applied = e;
  }

  // 完全拆解時整個模型的外框（世界座標）：放大的個體以中心縮放其外框，其餘平移其外框。
  let exploded = null;
  function explodedBox() {
    if (exploded) return exploded.clone();
    const box = new Box3();
    for (const n of nodes) {
      if (n.box0.isEmpty()) continue;
      const b = n.box0.clone();
      if (n.rule.kind === 'scale') {
        b.min.sub(c).multiplyScalar(SCALE).add(c);
        b.max.sub(c).multiplyScalar(SCALE).add(c);
      } else b.translate(n.disp);
      box.union(b);
    }
    exploded = box;
    return box.clone();
  }

  return {
    set(on) { goal = on ? 1 : 0; },
    update(dt) {
      if (t !== goal) {
        const step = Math.max(0, dt) / DURATION;
        t = goal > t ? Math.min(goal, t + step) : Math.max(goal, t - step);
        ease = easeInOutCubic(t);
      }
      if (ease !== applied) apply(ease);
    },
    explodedBox,
    get progress() { return ease; },
    get moving() { return t !== goal; },
    get goal() { return goal; },
  };
}
