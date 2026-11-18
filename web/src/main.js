import { Box3, Vector3 } from 'three';
import modelBytes from '../../assets/plant_cell.glb';
import palette from '../../shared/palette.json';
import { createScene } from './scene.js';
import { parseModel, indexModel, findOrganelle, findInstanceRoot } from './model.js';
import { applyMaterials } from './materials.js';
import { ORGANELLES, QUIZ_IDS, getOrganelle } from './organelles.js';
import { t, readLang, writeLang, organelleName, introContent, HTML_LANG } from './i18n.js';
import { GHOST_IDS, SCALE_IDS } from './config.js';
import { createStore, initialState } from './state.js';
import { createPicker } from './picking.js';
import { createHighlighter } from './highlight.js';
import { createCameraMoves } from './camera-moves.js';
import { createLid, easeInOutCubic } from './lid.js';
import { createExploder } from './explode.js';
import { createLabels } from './labels.js';
import { createCallout, calloutGeometry, calloutTargetOf } from './callout.js';
import { createQuiz } from './quiz.js';
import { mountPanel } from './ui/panel.js';
import { mountList, mountListToggle } from './ui/list.js';
import { mountIntro } from './ui/intro.js';
import { mountToolbar } from './ui/toolbar.js';
import { mountLangSwitch } from './ui/lang-switch.js';
import { mountQuizUI } from './ui/quiz-ui.js';
import { placeHoverName } from './ui/hover-name.js';

const canvas = document.getElementById('stage');
const root = document.documentElement;

const IDLE_MS = 4000; // 使用者閒置這麼久才開始自轉
const REVEAL_MS = 1800; // 測驗：作答後揭曉正確答案的時間
const NARROW_W = 720; // 視窗寬度小於這個值是 narrow 版面
const SHORT_H = 560; // 寬度夠但高度小於這個值是 short 版面
const NARROW_STAGE = 0.52; // narrow：畫布佔視窗高度的比例
const EXPLODE_MOVE = { duration: 1, ease: easeInOutCubic }; // 拆解／組合時的鏡頭移動：與模型的伸縮同步，才不會在動畫中途被切出畫面

// 建立 WebGL 失敗：只顯示說明（開場卡片與清單都不出現），並留下錯誤原因供除錯。
// 說明文字取記住的語言（store 可能還沒建立，所以直接讀 localStorage）。
function showFallback(e, key = 'fallback', what = '無法建立 WebGL') {
  root.dataset.cellError = String(e && e.message ? e.message : e);
  console.warn(`[cell] ${what}`, e);
  document.getElementById('intro').hidden = true;
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.hidden = true;
  const box = document.getElementById('fallback');
  box.textContent = t(readLang(), key);
  box.hidden = false;
}

// ---- 版面：依 window.innerWidth／innerHeight 決定模式（寫在 body 的 data-layout，CSS 依它排版）----
// wide／short：畫布佔滿視窗，模型放進「可用範圍」＝視窗扣掉頂端 16 像素與底部一條保留帶（構造清單的實際高度加留白；
// 測驗卡片出現在同一個位置，所以三個階段的取景一樣）。narrow：畫布只佔視窗高度的 52%，可用範圍扣掉頂端給工具列的空間
// （工具列換行變高時，可用範圍的上緣跟著它的下緣走）。
// wide／short：工具列與介紹面板在水平方向會重疊時（平板寬度），面板的頂端移到工具列下緣之下（CSS 變數 --panel-dy）。
// 每次視窗縮放、切換語言、工具列大小改變時由 scene.js 的 resize() 呼叫 update()：它先套用模式與 CSS 變數，再回傳畫布大小與可用範圍。
const layoutCtl = (() => {
  const listWrap = document.getElementById('list-wrap');
  const toolbarEl = document.getElementById('toolbar');
  const panelBox = document.getElementById('panel');
  let last = { mode: 'wide', width: 1, height: 1, rect: { left: 0, top: 0, right: 1, bottom: 1 } };
  return {
    update() {
      const W = Math.max(1, window.innerWidth);
      const H = Math.max(1, window.innerHeight);
      const mode = W < NARROW_W ? 'narrow' : (H < SHORT_H ? 'short' : 'wide');
      document.body.dataset.layout = mode;
      let height = H;
      let rect;
      let band = 0;
      let panelTop = 0; // 面板頂端要往下移多少（0 = 維持原位）
      if (mode === 'narrow') {
        height = Math.max(1, Math.round(H * NARROW_STAGE));
        const toolbarBottom = toolbarEl.getBoundingClientRect().bottom;
        rect = { left: 0, top: Math.max(Math.min(48, height * 0.2), toolbarBottom + 1), right: W, bottom: height - 8 };
      } else {
        band = listWrap.offsetHeight + (mode === 'short' ? 8 : 12) + 8;
        rect = { left: 0, top: 16, right: W, bottom: Math.max(16 + H * 0.3, H - band) };
        // 面板還沒顯示（display:none）時量不到矩形，所以讀計算樣式的寬度與 right（兩者都由 data-layout 與語言決定）
        const cs = getComputedStyle(panelBox);
        const base = mode === 'short' ? 10 : 16;
        const panelLeft = W - (parseFloat(cs.right) || base) - (parseFloat(cs.width) || panelBox.offsetWidth);
        const tb = toolbarEl.getBoundingClientRect();
        if (tb.right + 12 > panelLeft) panelTop = Math.max(0, tb.bottom + 8 - base);
      }
      root.style.setProperty('--stage-w', `${W}px`);
      root.style.setProperty('--stage-h', `${height}px`);
      root.style.setProperty('--band', `${band}px`);
      root.style.setProperty('--panel-dy', `${panelTop}px`);
      last = { mode, width: W, height, rect };
      return last;
    },
    get current() { return last; },
  };
})();

// 依語言更新頁面上不由元件管理的文字：html lang、標題、載入提示、清單標題與兩個 aria-label。
function applyDocumentText(lang) {
  root.lang = HTML_LANG[lang];
  document.title = t(lang, 'title');
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.textContent = t(lang, 'loading');
  document.getElementById('list-title').textContent = t(lang, 'listTitle');
  document.getElementById('toolbar').setAttribute('aria-label', t(lang, 'toolbarLabel'));
  document.getElementById('quiz').setAttribute('aria-label', t(lang, 'quiz'));
}

const cornersOf = (b) => {
  const out = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(x, y, z);
  return out;
};

async function main() {
  applyDocumentText(readLang());
  const loading = document.getElementById('loading');
  let view;
  try {
    view = createScene(canvas, { getLayout: () => layoutCtl.update() });
  } catch (e) {
    showFallback(e);
    return;
  }
  const model = await parseModel(modelBytes);
  const index = indexModel(model);
  applyMaterials(index, palette);
  view.scene.add(model);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const lid = createLid(index); // 開場時蓋著；按下開始後掀開
  const exploder = createExploder(index);
  // 各狀態的取景：box 是預設鏡頭要放進可用範圍的外框，points 是實際取景用的點（比外框的八個角貼近輪廓）。
  // 一般狀態：只用「本細胞的壁」的實際頂點（含蓋子裡的部分，蓋子蓋著時也框得住）；相鄰細胞的壁、中膠層與從稜上伸出去的部分可以超出畫面。
  // 拆解：只框真正散開的構造（外殼與貼著細胞壁的原生質絲、微管、微絲（SCALE_IDS）撐滿整面壁，框它們畫面只會剩 55%，所以允許超出畫面）。
  // extent 是使用者縮到最遠、遠平面、陰影範圍要涵蓋的完整外框（含外殼與相鄰細胞）。
  const wallPoints = [];
  for (const m of meshes) {
    if (findOrganelle(m) !== 'cell_wall' || m.name.startsWith('neighbor')) continue;
    const pos = m.geometry.attributes.position;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); wallPoints.push(v.x, v.y, v.z); }
  }
  const wallBox = wallPoints.length ? new Box3().setFromArray(wallPoints) : index.box;
  const explodedBox = exploder.explodedBox(SCALE_IDS);
  const explodedFrame = { box: explodedBox, extent: exploder.explodedBox(), margin: 1.0, points: cornersOf(explodedBox) }; // 留白 1.0：散開的構造才能佔畫面寬度六成以上
  const restFrame = { box: wallBox, extent: index.box, margin: 1.04, points: wallPoints.length ? wallPoints : null };
  // 拆解時選了外殼類構造：外殼是放大的，要看得到整個被選的外殼，所以改框含外殼的完整拆解範圍（不留白以外的空隙）。
  const extentBox = exploder.explodedBox();
  const shellFrame = { box: extentBox, extent: extentBox, margin: 1.04, points: cornersOf(extentBox) };
  const frameOf = (exploded) => (exploded ? explodedFrame : restFrame);
  const isShellSel = (sel) => !!sel && GHOST_IDS.includes(sel.id);
  // 目前狀態的預設取景：一般狀態是本細胞的壁；拆解且選了外殼是完整外框；拆解其餘是散開的構造
  const frameFor = (s) => (s.exploded && isShellSel(s.selected) ? shellFrame : frameOf(s.exploded));

  view.frame(restFrame.box, restFrame.extent, restFrame.margin, restFrame.points);

  const triangles = meshes.reduce((n, m) => {
    const g = m.geometry;
    return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
  }, 0);
  const ids = [...new Set(meshes.map(findOrganelle).filter((x) => x !== null))];

  // ---- 狀態與各個畫面：選取狀態只存在 store ----
  const store = createStore({ ...initialState, lang: readLang() });
  const setLanguage = (lang) => {
    writeLang(lang);
    store.dispatch({ type: 'setLang', lang });
  };
  const highlighter = createHighlighter(index);
  const moves = createCameraMoves({
    camera: view.camera, controls: view.controls,
    defaultPose: view.defaultPose, setUserMoved: view.setUserMoved,
    applyDefault: () => { const f = frameFor(store.getState()); return view.frame(f.box, f.extent, f.margin, f.points); }, // 回到預設後完整套用（含 maxDistance、far、陰影）並重設旗標
  });
  const panel = mountPanel(document.getElementById('panel'), {
    palette, onClose: () => store.dispatch({ type: 'deselect' }),
  });
  const list = mountList(document.getElementById('list'), {
    organelles: ORGANELLES, palette,
    onSelect: (id) => {
      store.dispatch({ type: 'select', id, inst: null });
      // narrow：選取後清單被面板取代（display:none），焦點會掉回 body；移到面板的關閉鈕
      if (layoutCtl.current.mode === 'narrow' && store.getState().selected) document.getElementById('panel-close').focus({ preventScroll: true });
    },
  });
  const listToggle = mountListToggle(document.getElementById('list-toggle'), {
    onToggle: () => store.dispatch({ type: 'toggleList' }),
  });
  view.resize(); // 清單有內容之後它的高度才是真的：重新計算可用範圍與取景
  const toolbar = mountToolbar(document.getElementById('toolbar'), {
    onExplode: () => store.dispatch({ type: 'toggleExplode' }),
    onLabels: () => store.dispatch({ type: 'toggleLabels' }),
    onQuiz: () => store.dispatch({ type: store.getState().phase === 'quiz' ? 'quizExit' : 'quizStart' }),
  });
  let toolbarReady = false; // 蓋子完全打開後才啟用工具列（在每格的更新裡檢查）

  // ---- 測驗：題目與分數由 quiz 物件保存（不放進 store）；store 只管「揭曉哪一個」----
  let quiz = null;
  let shownId = null; // 畫面上目前這一題的答案（揭曉期間仍是剛作答的那一題）；沒有題目時為 null
  let revealTimer = 0;
  const showQuestion = () => {
    shownId = quiz.currentId;
    quizUI.showQuestion({ index: quiz.index, total: quiz.total, id: shownId });
  };
  const startRound = () => {
    clearTimeout(revealTimer);
    revealTimer = 0;
    quiz = createQuiz({ ids: QUIZ_IDS });
    showQuestion();
  };
  const quizUI = mountQuizUI(document.getElementById('quiz'), {
    onExit: () => store.dispatch({ type: 'quizExit' }),
    onRetry: () => {
      if (store.getState().phase === 'quiz') startRound();
    },
  });
  function answerQuiz(h) {
    const s = store.getState();
    // 點到空白、揭曉中、已經答完都不算作答（每題只算第一次）
    if (!h || !quiz || quiz.finished || s.quiz.reveal) return;
    const { correct, expectedId } = quiz.answer(h.id);
    store.dispatch({ type: 'quizReveal', id: expectedId, correct });
    quizUI.showResult({ correct, expectedId, pickedId: h.id });
    revealTimer = setTimeout(() => {
      revealTimer = 0;
      store.dispatch({ type: 'quizNext' });
      if (quiz.finished) {
        shownId = null;
        quizUI.showSummary({ score: quiz.score, total: quiz.total });
      } else showQuestion();
    }, REVEAL_MS);
  }
  const labels = createLabels({
    container: document.getElementById('labels'), index, camera: view.camera, palette,
    nameOf: (id) => organelleName(store.getState().lang, id),
    onSelect: (id) => store.dispatch({ type: 'select', id, inst: null }),
    obstacles: () => ['list-wrap', 'toolbar', 'panel'].map((n) => {
      const el = document.getElementById(n);
      return el && !el.hidden ? el.getBoundingClientRect() : null;
    }),
  });
  // 標籤與引線在每次繪製之前更新（此時鏡頭與模型矩陣都已是這一格要畫的狀態），才不會落後一格。
  // 引線先做（它要讀版面）、標籤後做（它會寫 transform 與 SVG 屬性）：沒有選取時完全不讀版面；引線顯示時 draw 的寫入仍可能讓標籤的讀取多一次重排，這裡只是減少交錯。
  view.scene.onBeforeRender = () => { updateCallout(); labels.update(); };
  const callout = createCallout(document.getElementById('callout'));
  const calloutV = new Vector3();
  const panelEl = document.getElementById('panel');
  const panelDotEl = document.getElementById('panel-dot');
  const CALLOUT_NEUTRAL = '#B8B4AC';
  const CALLOUT_OFF = { visible: false, x1: 0, y1: 0, x2: 0, y2: 0 };
  // 介紹卡片的引線：只在探索階段、有選取且卡片顯示時才畫；不啟用時不讀任何版面
  function updateCallout() {
    const s = store.getState();
    if (s.phase !== 'explore' || !s.selected || panelEl.hidden) { callout.draw(CALLOUT_OFF, CALLOUT_NEUTRAL); return; }
    let target = null;
    const obj = calloutTargetOf(index.byId.get(s.selected.id), s.selected);
    if (obj) {
      const p = projectToClient(obj.getWorldPosition(calloutV));
      if (p.z >= -1 && p.z <= 1) target = { x: p.x, y: p.y }; // 鏡頭背面或超出遠近平面就不畫
    }
    const d = panelDotEl.getBoundingClientRect();
    const geo = calloutGeometry({
      mode: layoutCtl.current.mode,
      panel: panelEl.getBoundingClientRect(),
      dot: { x: (d.left + d.right) / 2, y: (d.top + d.bottom) / 2 },
      target,
      stage: canvas.getBoundingClientRect(),
    });
    callout.draw(geo, palette[s.selected.id]?.main ?? CALLOUT_NEUTRAL);
  }
  const hoverName = document.getElementById('hover-name');
  loading.hidden = true; // 模型已載入：開場卡片接手
  const intro = mountIntro(document.getElementById('intro'), {
    intro: introContent(store.getState().lang),
    onStart: () => {
      store.dispatch({ type: 'start' });
      lid.open();
      intro.hide();
    },
  });
  // 語言切換鈕：開場卡片（開始鈕之後）與工具列（測驗鈕之後）各一組，切換時一起更新 aria-pressed
  const langSwitches = [
    mountLangSwitch(document.getElementById('intro-card'), { onChange: setLanguage }),
    mountLangSwitch(document.getElementById('toolbar'), { onChange: setLanguage }),
  ];
  // 工具列大小改變（切換語言、按鈕文字或粗細改變、視窗縮放造成換行）時，先重算版面；只有版面結果（模式、畫布大小、可用範圍）
  // 真的變了才重算取景。否則拆解／組合時英文按鈕文字寬度改變，會讓進行中的平移緩動一格跳到終點。
  // 只在寬或高真的變了才處理（resize 不會改變工具列大小，不會循環）。
  const toolbarBox = document.getElementById('toolbar');
  const layoutKey = (l) => `${l.mode}|${l.width}|${l.height}|${l.rect.left}|${l.rect.top}|${l.rect.right}|${l.rect.bottom}`;
  let tbW = -1;
  let tbH = -1;
  new ResizeObserver(() => {
    if (toolbarBox.offsetWidth === tbW && toolbarBox.offsetHeight === tbH) return;
    tbW = toolbarBox.offsetWidth;
    tbH = toolbarBox.offsetHeight;
    const before = layoutKey(layoutCtl.current);
    if (layoutKey(layoutCtl.update()) !== before) view.resize(); // update() 同時更新 --panel-dy
  }).observe(toolbarBox);

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
      if (store.getState().phase === 'quiz') { answerQuiz(h); return; }
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
  // 擷取階段先記下位置：picking.js 在 pointerup 與 refresh 時發出滑過狀態，標籤位置必須已是那個游標位置
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) {
    canvas.addEventListener(type, (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });
  }
  canvas.addEventListener('pointermove', () => { if (!hoverName.hidden) placeLabel(); });
  function paintHover() {
    const h = store.getState().hovered;
    const o = h && getOrganelle(h.id);
    const show = !!o && !picker.pressed;
    const showName = show && store.getState().phase !== 'quiz'; // 測驗中不顯示名稱（會洩漏答案），游標仍是手指
    if (o) hoverName.textContent = organelleName(store.getState().lang, h.id);
    hoverName.hidden = !showName;
    canvas.style.cursor = show ? 'pointer' : '';
    if (showName) placeLabel();
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
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'touchstart', 'touchend']) {
    window.addEventListener(type, noteActivity, { capture: true, passive: true });
  }
  canvas.addEventListener('pointermove', noteActivity, { passive: true });
  // Esc：探索階段有選取時等同取消選取（開場與測驗階段沒有作用）
  window.addEventListener('keydown', (e) => {
    const s = store.getState();
    if (e.key === 'Escape' && s.phase === 'explore' && s.selected) store.dispatch({ type: 'deselect' });
  });

  // 拆解動畫結束時，若有選取，鏡頭重新對準被選構造的新位置（使用者在中途自己動了鏡頭就不搶）
  let pendingRefocus = false;
  view.controls.addEventListener('start', () => { pendingRefocus = false; });
  const targetOf = (sel) => {
    const entry = index.byId.get(sel.id);
    return sel.inst === null
      ? (entry.anchor ?? entry.rep)
      : entry.instances.find((r) => r.userData.inst === sel.inst) ?? entry.rep;
  };

  let prev = { phase: 'intro', selected: undefined, hovered: undefined, exploded: false, labels: false, lang: null, listCollapsed: false };
  function render(s) {
    document.body.dataset.phase = s.phase; // 清單等介面依階段顯示（CSS）
    document.body.dataset.list = s.listCollapsed ? 'collapsed' : 'open';
    listToggle.set(s.listCollapsed, s.lang);
    // 清單收合／展開（或進出測驗，清單照展開的高度佔位）會改變可用範圍：重算版面，鏡頭怎麼跟上留到本次 render 的最後決定
    let reframe = null;
    if (s.listCollapsed !== prev.listCollapsed || s.phase !== prev.phase) {
      const before = layoutKey(layoutCtl.current);
      if (layoutKey(layoutCtl.update()) !== before) reframe = view.relayout();
    }
    if (s.lang !== prev.lang) {
      applyDocumentText(s.lang);
      list.setLang(s.lang);
      labels.setNames((id) => organelleName(s.lang, id));
      panel.setLang(s.lang);
      quizUI.setLang(s.lang);
      intro.setContent(introContent(s.lang));
      for (const sw of langSwitches) sw.setLang(s.lang);
      paintHover();
      view.resize(); // 清單高度可能改變：重算保留帶與取景
    }
    highlighter.apply(s);
    toolbar.setState(s);
    labels.setVisible(s.labels && s.phase === 'explore');
    const enteringQuiz = s.phase === 'quiz' && prev.phase !== 'quiz';
    const leavingQuiz = s.phase !== 'quiz' && prev.phase === 'quiz';
    if (enteringQuiz) {
      noteActivity();
      list.setNamesHidden(true);
      startRound();
    } else if (leavingQuiz) {
      clearTimeout(revealTimer);
      revealTimer = 0;
      quiz = null;
      shownId = null;
      quizUI.hide();
      list.setNamesHidden(false);
    }
    if (s.phase !== prev.phase) paintHover();
    const explodeChanged = s.exploded !== prev.exploded;
    const shellSel = isShellSel(s.selected);
    if (explodeChanged) {
      noteActivity();
      exploder.set(s.exploded);
    }
    if (explodeChanged || (s.exploded && shellSel) !== (prev.exploded && isShellSel(prev.selected))) {
      const f = frameFor(s);
      view.setFrameBox(f.box, f.extent, f.margin, f.points); // 之後的預設位置（含取消選取、視窗縮放）以這個狀態的外框為準
    }
    if (explodeChanged) {
      if (s.selected && !shellSel) pendingRefocus = true;
      else moves.home(EXPLODE_MOVE); // 沒有選取，或選的是外殼（外殼用預設取景，不靠近錨點）
    }
    if (s.hovered !== prev.hovered) paintHover();
    if (s.selected !== prev.selected) {
      noteActivity();
      const sel = s.selected;
      list.setActive(sel ? sel.id : null);
      labels.setSelected(sel ? sel.id : null);
      if (sel) {
        panel.show(sel.id);
        if (shellSel) {
          if (!explodeChanged) moves.home(); // 外殼類：鏡頭平順移到「看得到整個被選構造」的預設取景
        } else {
          const target = targetOf(sel);
          if (target) moves.focus(target);
          if (exploder.moving) pendingRefocus = true; // 動畫還沒結束，結束時再對準一次
        }
      } else {
        const focusInPanel = document.getElementById('panel').contains(document.activeElement);
        panel.hide();
        // narrow：面板收起、清單回來；焦點原本在面板裡，就還給清單上對應那個構造的按鈕
        if (focusInPanel && prev.selected && layoutCtl.current.mode === 'narrow') list.focus(prev.selected.id);
        if (prev.selected) moves.home(explodeChanged ? EXPLODE_MOVE : undefined); // 取消選取：鏡頭回到預設位置（同時在拆解／組合就用同一段動畫）
      }
    }
    if (enteringQuiz) moves.home(explodeChanged ? EXPLODE_MOVE : undefined); // 進入測驗：鏡頭平順回到一般（未拆解）的預設位置
    // 本次 render 沒開始別的鏡頭動畫（進入測驗、拆解、取消選取等會每格重讀 defaultPose，已經用新版面）才處理；
    // 進行中的若是上一次的尺度動畫（收合動畫途中再切換），照樣處理，新比例會乘進它的終點：
    // 鏡頭在預設位置就平順回到新的預設；動過但不是特寫就依預設距離的比例放大縮小；特寫中只靠平移緩動。
    if (reframe && (!moves.busy || moves.scaling)) {
      if (reframe.atDefault) moves.home();
      else if (!(s.selected && !isShellSel(s.selected)) && Math.abs(reframe.scale - 1) > 1e-6) moves.scaleDistance(reframe.scale);
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
    layout: () => layoutCtl.current, // { mode, width, height, rect }：畫布大小與可用範圍
    frameCurrent() { // 以目前狀態（一般或拆解）的取景重新套用預設鏡頭
      const f = frameFor(store.getState());
      return view.frame(f.box, f.extent, f.margin, f.points);
    },
    shellFrameCorners: () => shellFrame.points.slice(), // 含外殼的完整拆解外框的八個角（攤平）
    setCytoplasmLook: (look) => highlighter.setCytoplasmLook(look), // 除錯與截圖用：換掉選取細胞質時的外觀
    cameraBusy: () => moves.busy,
    explodeProgress: () => exploder.progress,
    lidOpen: () => lid.isOpen,
    quizCurrentId: () => shownId,
    autoRotating: () => view.isAutoRotating(),
    hitAt: (x, y) => picker.hitAt(x, y), // 與點選相同規則的射線測試
    screenPointOf,
    callout: () => ({ ...callout.state }), // 引線最後一次畫的值
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
      const target = sel && !isShellSel(sel) ? targetOf(sel) : null; // 外殼類用預設取景，鏡頭動畫自己追著它
      if (target) moves.focus(target);
    }
    lid.update(dt);
    if (lid.isOpen && !toolbarReady) { toolbarReady = true; toolbar.setReady(true); }
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

main().catch((e) => showFallback(e, 'loadFail', '載入失敗')); // 模型載入或解析失敗：開場、清單、工具列都不顯示（phase 不是 explore），只留說明
