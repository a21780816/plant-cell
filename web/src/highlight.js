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
const SELECTED_GHOST_OPACITY = 0.4; // 拆解時被選的外殼：比其他殘影清楚，但仍看得到裡面
const TAU = 0.08;           // 指數趨近的時間常數；約 3 倍（0.25 秒）收斂

const ROLE_TARGET = {
  normal: () => ({ emi: 0, fade: 0, ghost: 0, lift: 0 }),
  hover: (dimmed) => ({ emi: EMISSIVE.hover, fade: dimmed ? HOVER_DIM_MIX : 0, ghost: 0, lift: 0 }),
  family: () => ({ emi: EMISSIVE.family, fade: 0, ghost: 0, lift: 0 }),
  dim: () => ({ emi: 0, fade: DIM_MIX, ghost: 0, lift: 0 }),
  ghost: () => ({ emi: 0, fade: GHOST_MIX, ghost: 1, lift: 0 }),
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
        cur: { emi: 0, fade: 0, ghost: 0, lift: 0 },
        written: null,
      });
    }
  }

  let state = { selected: null, hovered: null, exploded: false };
  let shellsGhosted = false;
  let time = 0;

  function apply(next) {
    // 測驗揭曉：等同「從清單選取正確答案」（該 id 的全部個體發亮、其餘變暗、外殼變殘影）
    const reveal = next.phase === 'quiz' && next.quiz ? next.quiz.reveal : null;
    state = reveal ? { ...next, selected: { id: reveal.id, inst: null } } : next;
    next = state;
    // 選了外殼以外的構造，或拆解中：外殼都變殘影（拆解時外殼是放大的殘影，不可點）
    shellsGhosted = !!next.exploded || (next.selected !== null && !GHOST_IDS.includes(next.selected.id));
  }

  const same = (a, rec) => a && a.id === rec.id && (a.inst === null || a.inst === rec.inst);

  function targetOf(rec, breath) {
    const { selected: sel, hovered: hov } = state;
    let role = 'normal';
    let isSelected = false;
    if (sel) {
      if (rec.id === sel.id) {
        // 拆解中選了外殼（只能從清單選）：它維持半透明（不透明度約 0.35）並發亮，否則放大的不透明外殼會把裡面全部遮住
        if (state.exploded && rec.isShell) return { emi: EMISSIVE.family + breath, fade: 0, ghost: 1, lift: 1 };
        if (sel.inst !== null && rec.inst === sel.inst) isSelected = true;
        else role = 'family';
      } else role = shellsGhosted && rec.isShell ? 'ghost' : 'dim';
    } else if (shellsGhosted && rec.isShell) role = 'ghost';
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
    const cap = GHOST_OPACITY + (SELECTED_GHOST_OPACITY - GHOST_OPACITY) * cur.lift;
    mat.opacity = rec.baseOpacity + (Math.min(rec.baseOpacity, cap) - rec.baseOpacity) * cur.ghost;
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
      c.lift = approach(c.lift, t.lift, k);
      if (w && c.emi === w.emi && c.fade === w.fade && c.ghost === w.ghost && c.lift === w.lift) continue;
      write(rec);
      rec.written = { emi: c.emi, fade: c.fade, ghost: c.ghost, lift: c.lift };
    }
  }

  return {
    apply,
    update,
    get shellsGhosted() { return shellsGhosted; },
  };
}
