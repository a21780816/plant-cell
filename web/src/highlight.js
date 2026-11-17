import { Color } from 'three';
import { findOrganelle } from './model.js';
import { instanceOfMesh, isLidMesh } from './picking.js';
import { GHOST_IDS, ghostOrderOf } from './config.js';

// 發亮與變暗全用材質參數漸變，不用後製。
const EMISSIVE = { hover: 0.15, selected: 0.45, family: 0.2 };
const BREATH = { amplitude: 0.06, period: 2 }; // 被選個體很慢的呼吸起伏（自發光強度 ±0.06、週期 2 秒）
const DIM_COLOR = new Color('#D8D2C4'); // 與背景同色系的淺灰米色
const DIM_MIX = 0.7;        // 其餘構造往 DIM_COLOR 靠近的比例
const HOVER_DIM_MIX = 0.35; // 變暗的構造被滑過時，先退回到這個程度作為預覽
const GHOST_MIX = 0.5;      // 殘影外殼的顏色往 DIM_COLOR 靠近的比例
const GHOST_OPACITY = 0.15;
const TAU = 0.08;           // 指數趨近的時間常數；約 3 倍（0.25 秒）收斂

const ROLE_TARGET = {
  normal: () => ({ emi: 0, fade: 0, ghost: 0 }),
  hover: (dimmed) => ({ emi: EMISSIVE.hover, fade: dimmed ? HOVER_DIM_MIX : 0, ghost: 0 }),
  family: () => ({ emi: EMISSIVE.family, fade: 0, ghost: 0 }),
  dim: () => ({ emi: 0, fade: DIM_MIX, ghost: 0 }),
  ghost: () => ({ emi: 0, fade: GHOST_MIX, ghost: 1 }),
};

// 趨近目標；足夠接近時直接等於目標，收斂後的數值才精確（還原不留殘差）。
const approach = (v, t, k) => {
  const n = v + (t - v) * k;
  return Math.abs(t - n) < 1e-3 ? t : n;
};

export function createHighlighter(index) {
  const recs = [];
  for (const [id, entry] of index.byId) {
    for (const mesh of entry.meshes) {
      if (isLidMesh(mesh)) continue; // 蓋子的外觀由 lid.js 獨佔，不複製也不改動它的材質
      const mat = mesh.material.clone(); // 每個網格各自一份材質，才能逐個體發亮
      mesh.material = mat;
      const own = findOrganelle(mesh) ?? id;
      const baseEI = mat.emissive.getHex() === 0 ? 0 : mat.emissiveIntensity;
      // 先統一成「發光色＝本色、強度＝基準」，載入後的快照與漸變收斂後的值才會精確相同（視覺上等價）。
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = baseEI;
      recs.push({
        mesh, mat,
        id: own,
        inst: instanceOfMesh(mesh, index),
        isShell: GHOST_IDS.includes(own),
        ghostOrder: GHOST_IDS.includes(own) ? ghostOrderOf(own, mesh) : null,
        baseOrder: mesh.renderOrder,
        baseColor: mat.color.clone(),
        baseEI,
        baseOpacity: mat.opacity,
        baseTransparent: mat.transparent,
        baseDepthWrite: mat.depthWrite,
        baseCast: mesh.castShadow,
        cur: { emi: 0, fade: 0, ghost: 0 },
        written: null,
      });
    }
  }

  let state = { selected: null, hovered: null };
  let shellsGhosted = false;
  let time = 0;

  function apply(next) {
    state = next;
    shellsGhosted = next.selected !== null && !GHOST_IDS.includes(next.selected.id);
  }

  const same = (a, rec) => a && a.id === rec.id && (a.inst === null || a.inst === rec.inst);

  function targetOf(rec, breath) {
    const { selected: sel, hovered: hov } = state;
    let role = 'normal';
    let isSelected = false;
    if (sel) {
      if (rec.id === sel.id) {
        if (sel.inst !== null && rec.inst === sel.inst) isSelected = true;
        else role = 'family';
      } else role = shellsGhosted && rec.isShell ? 'ghost' : 'dim';
    }
    if (isSelected) return { emi: EMISSIVE.selected + breath, fade: 0, ghost: 0 };
    if ((role === 'normal' || role === 'dim') && same(hov, rec)) return ROLE_TARGET.hover(role === 'dim');
    return ROLE_TARGET[role]();
  }

  function write(rec) {
    const { mat, cur } = rec;
    mat.color.copy(rec.baseColor).lerp(DIM_COLOR, cur.fade);
    mat.emissive.copy(mat.color);
    mat.emissiveIntensity = rec.baseEI + cur.emi;
    const ghosting = cur.ghost > 0.001;
    const transparent = ghosting || rec.baseTransparent;
    if (mat.transparent !== transparent) {
      mat.transparent = transparent;
      mat.needsUpdate = true; // three 的 OPAQUE 著色器變體依 transparent 而定，翻轉時必須重編
    }
    mat.depthWrite = ghosting ? false : rec.baseDepthWrite;
    mat.opacity = rec.baseOpacity + (Math.min(rec.baseOpacity, GHOST_OPACITY) - rec.baseOpacity) * cur.ghost;
    rec.mesh.renderOrder = ghosting && rec.ghostOrder !== null ? rec.ghostOrder : rec.baseOrder; // 殘影時固定由外到內的順序
    rec.mesh.castShadow = rec.baseCast && cur.ghost < 0.5; // 殘影不投影，否則看不見的外殼會把內部遮暗
  }

  function update(dt) {
    time += dt;
    const breath = Math.sin((time * 2 * Math.PI) / BREATH.period) * BREATH.amplitude;
    const k = 1 - Math.exp(-Math.max(0, dt) / TAU);
    for (const rec of recs) {
      const t = targetOf(rec, breath);
      const c = rec.cur;
      const w = rec.written;
      c.emi = approach(c.emi, t.emi, k);
      c.fade = approach(c.fade, t.fade, k);
      c.ghost = approach(c.ghost, t.ghost, k);
      if (w && c.emi === w.emi && c.fade === w.fade && c.ghost === w.ghost) continue;
      write(rec);
      rec.written = { emi: c.emi, fade: c.fade, ghost: c.ghost };
    }
  }

  return {
    apply,
    update,
    get shellsGhosted() { return shellsGhosted; },
  };
}
