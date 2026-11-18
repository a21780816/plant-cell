// 介紹卡片的引線：從卡片邊緣連到畫面上被選的構造。
// 幾何與目標選擇都是純函式（不 import three），畫面寫入集中在 createCallout。
import { GHOST_IDS } from './config.js';

export const CALLOUT_INSET = 4;   // 目標點要在畫布內縮這麼多像素以內才畫
export const CALLOUT_MIN_LEN = 12; // 線太短（目標幾乎在卡片邊上）就不畫

const HIDDEN = { visible: false, x1: 0, y1: 0, x2: 0, y2: 0 };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// 全部是視窗 CSS 像素。mode：'wide' | 'short' | 'narrow'；panel、stage 是 { left, top, right, bottom }。
export function calloutGeometry({ mode, panel, dot, target, stage }) {
  if (!panel || !target) return { ...HIDDEN };
  let x1, y1;
  if (mode === 'narrow') {
    y1 = panel.top;
    x1 = clamp(dot.x, panel.left, panel.right);
  } else {
    x1 = panel.left;
    y1 = clamp(dot.y, panel.top, panel.bottom);
  }
  x1 = Math.round(x1); y1 = Math.round(y1);
  const x2 = Math.round(target.x), y2 = Math.round(target.y);
  const inStage = x2 >= stage.left + CALLOUT_INSET && x2 <= stage.right - CALLOUT_INSET
    && y2 >= stage.top + CALLOUT_INSET && y2 <= stage.bottom - CALLOUT_INSET;
  const inPanel = x2 >= panel.left && x2 <= panel.right && y2 >= panel.top && y2 <= panel.bottom;
  if (!inStage || inPanel || Math.hypot(x2 - x1, y2 - y1) < CALLOUT_MIN_LEN) return { ...HIDDEN };
  return { visible: true, x1, y1, x2, y2 };
}

// 引線指向的物件：清單選取與外殼類用錨點；點選非代表個體時用該個體的根。
export function calloutTargetOf(entry, sel, ghostIds = GHOST_IDS) {
  if (!entry) return null;
  const fallback = entry.anchor ?? entry.rep;
  if (ghostIds.includes(sel.id) || sel.inst === null) return fallback;
  const inst = entry.instances.find((r) => r.userData.inst === sel.inst);
  return !inst || inst === entry.rep ? fallback : inst;
}

const NS = 'http://www.w3.org/2000/svg';

// 只建立一次線與圓點；draw 只在值改變時寫 DOM。
export function createCallout(svg) {
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('class', 'callout-line');
  const dotEl = document.createElementNS(NS, 'circle');
  dotEl.setAttribute('class', 'callout-dot');
  dotEl.setAttribute('r', '3.5');
  svg.append(line, dotEl);
  svg.style.display = 'none';

  let state = { ...HIDDEN };
  let fill = null;
  return {
    draw(geo, color) {
      if (!geo.visible) {
        if (state.visible) { svg.style.display = 'none'; state = { ...HIDDEN }; }
        return;
      }
      const fresh = !state.visible; // 剛從隱藏轉為顯示：全部重寫一次
      if (fresh) svg.style.display = '';
      if (fresh || geo.x1 !== state.x1) line.setAttribute('x1', geo.x1);
      if (fresh || geo.y1 !== state.y1) line.setAttribute('y1', geo.y1);
      if (fresh || geo.x2 !== state.x2) { line.setAttribute('x2', geo.x2); dotEl.setAttribute('cx', geo.x2); }
      if (fresh || geo.y2 !== state.y2) { line.setAttribute('y2', geo.y2); dotEl.setAttribute('cy', geo.y2); }
      if (fresh || color !== fill) { dotEl.setAttribute('fill', color); fill = color; }
      state = { ...geo };
    },
    get state() { return state; },
  };
}
