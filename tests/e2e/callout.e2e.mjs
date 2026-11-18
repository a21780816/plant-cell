import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { QUIZ_IDS } from '../../web/src/organelles.js';
import { GHOST_IDS } from '../../web/src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";

async function open(width, height) {
  const page = await openPage('dist/plant-cell.html', { offline: true, width, height });
  try {
    await page.waitFor(READY);
    const failure = await page.evaluate('document.documentElement.dataset.cellError || ""');
    assert.equal(failure, '', `檢視器啟動失敗：${failure}`);
  } catch (e) { await page.close(); throw e; }
  return page;
}

const info = (page, sel) => page.evaluate(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return { shown: e.getClientRects().length > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
})()`);
const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

async function startAndSettle(page) {
  const b = center(await info(page, '#intro-start'));
  await page.click(b.x, b.y);
  await page.waitFor('window.__cell.lidOpen() === true');
  await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
  await page.waitFor('!window.__cell.cameraBusy()', 5000);
  await sleep(500);
}

const frames = (page, n = 3) => page.evaluate(`new Promise((res) => { let n = ${n}; const f = () => (--n <= 0 ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const clickCenter = async (page, sel) => { const r = await info(page, sel); const c = center(r); await page.click(c.x, c.y); };

const setInnerWidth = (page, w) => page.evaluate(`(() => {
  Object.defineProperty(window, 'innerWidth', { value: ${w}, configurable: true });
  window.dispatchEvent(new Event('resize'));
})()`);

// 某構造（或其指定個體）的世界位置投影到視窗座標；inst 為 null 時用錨點（沒有就用代表個體）
const projectOf = (page, id, inst = null) => page.evaluate(`(() => {
  const { index, view } = window.__cell;
  const e = index.byId.get(${JSON.stringify(id)});
  const o = ${inst === null ? 'null' : 'true'} ? e.instances.find((r) => r.userData.inst === ${JSON.stringify(inst)}) : (e.anchor ?? e.rep);
  view.camera.updateMatrixWorld();
  const v = o.getWorldPosition(o.position.clone()).project(view.camera);
  const r = document.getElementById('stage').getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
})()`);

const settle = async (page) => {
  await page.waitFor('!window.__cell.cameraBusy()', 5000);
  await sleep(600);
  await frames(page, 3);
};
const callout = (page) => page.evaluate('window.__cell.callout()');
const dist = (c, p) => Math.hypot(c.x2 - p.x, c.y2 - p.y);
const pick = async (page, id) => { await clickCenter(page, `#list [data-id="${id}"]`); await page.waitFor(`window.__cell.store.getState().selected?.id === '${id}'`); };

test('引線 wide（1280×800）：開場不顯示；選細胞核後起點在面板左緣、對齊色點，終點是錨點投影；樣式與圖層；靜止不寫 DOM；名稱標籤同時顯示；fps ≥ 50', async () => {
  const page = await open(1280, 800);
  try {
    let c = await callout(page);
    assert.equal(c.visible, false, '開場不顯示');
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('callout')).display"), 'none');
    const css = await page.evaluate(`(() => {
      const e = document.getElementById('callout'), cs = getComputedStyle(e), r = e.getBoundingClientRect();
      return { position: cs.position, pe: cs.pointerEvents, z: cs.zIndex, aria: e.getAttribute('aria-hidden'),
        after: !!(document.getElementById('labels').compareDocumentPosition(e) & 4), r: { left: r.left, top: r.top, width: r.width, height: r.height } };
    })()`);
    assert.equal(css.position, 'fixed');
    assert.equal(css.pe, 'none');
    assert.equal(css.z, '1');
    assert.equal(css.aria, 'true');
    assert.ok(css.after, '#callout 在 #labels 之後');
    // display none 時 getBoundingClientRect 是 0，改在顯示後檢查矩形
    await startAndSettle(page);
    await pick(page, 'nucleus');
    await settle(page);
    c = await callout(page);
    assert.ok(c.visible, `選取後應顯示：${JSON.stringify(c)}`);
    const rect = await info(page, '#callout');
    assert.deepEqual([rect.left, rect.top, rect.width, rect.height], [0, 0, 1280, 800]);
    const panel = await info(page, '#panel');
    const dot = center(await info(page, '#panel-dot'));
    assert.ok(Math.abs(c.x1 - panel.left) <= 1, `起點 x ${c.x1} 應在面板左緣 ${panel.left}`);
    assert.ok(Math.abs(c.y1 - dot.y) <= 1, `起點 y ${c.y1} 應對齊色點 ${dot.y}`);
    const p = await projectOf(page, 'nucleus');
    assert.ok(dist(c, p) <= 2, `終點 ${c.x2},${c.y2} 應是錨點投影 ${p.x},${p.y}`);
    const dom = await page.evaluate(`(() => {
      const l = document.querySelector('#callout line'), k = document.querySelector('#callout circle');
      const ls = getComputedStyle(l), ks = getComputedStyle(k);
      return { x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2'),
        cx: +k.getAttribute('cx'), cy: +k.getAttribute('cy'), r: k.getAttribute('r'), fill: ks.fill, stroke: ls.stroke, sw: ls.strokeWidth };
    })()`);
    assert.deepEqual([dom.x1, dom.y1, dom.x2, dom.y2], [c.x1, c.y1, c.x2, c.y2]);
    assert.deepEqual([dom.cx, dom.cy], [c.x2, c.y2]);
    assert.equal(dom.r, '3.5');
    assert.equal(dom.fill, 'rgb(163, 150, 184)');
    assert.equal(dom.stroke, 'rgba(52, 48, 42, 0.5)');
    assert.equal(dom.sw, '1px');
    await page.screenshot('assets/preview/web-callout-wide.png');
    const muts = await page.evaluate(`new Promise((res) => {
      let n = 0;
      const o = new MutationObserver((l) => { n += l.length; });
      o.observe(document.getElementById('callout'), { attributes: true, subtree: true });
      setTimeout(() => { o.disconnect(); res(n); }, 500);
    })`);
    assert.equal(muts, 0, '靜止時不寫 DOM');
    await clickCenter(page, '#btn-labels');
    await page.waitFor('window.__cell.store.getState().labels === true');
    await frames(page, 3);
    assert.ok((await callout(page)).visible, '顯示名稱時引線仍在');
    await sleep(1500);
    const fps = await page.evaluate('window.__cell.stats().fps');
    console.log(`fps = ${fps.toFixed(1)}，callout = ${JSON.stringify(c)}`);
    assert.ok(fps >= 50, `fps ${fps}`);
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('引線跟隨：旋轉、拉近、視窗縮放、拆解後終點仍是投影；代表個體指向錨點、非代表個體指向該個體根', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    await pick(page, 'nucleus');
    await settle(page);
    const follow = async (msg) => {
      await frames(page, 3);
      const c = await callout(page);
      const p = await projectOf(page, 'nucleus');
      assert.ok(c.visible, `${msg}：應顯示 ${JSON.stringify(c)}`);
      assert.ok(dist(c, p) <= 2, `${msg}：終點 ${c.x2},${c.y2} 與投影 ${p.x},${p.y} 差太多`);
      return c;
    };
    await follow('選取');
    // 鏡頭繞被選構造的錨點旋轉，錨點的投影本來就不動：只能驗「鏡頭真的轉了、終點仍是投影」
    const cam0 = await page.evaluate('window.__cell.view.camera.position.toArray()');
    await page.drag(640, 400, 820, 330);
    await sleep(300);
    const cam1 = await page.evaluate('window.__cell.view.camera.position.toArray()');
    assert.ok(Math.hypot(...cam1.map((v, i) => v - cam0[i])) > 1, `旋轉後鏡頭應移動 ${JSON.stringify([cam0, cam1])}`);
    await follow('旋轉');
    await page.evaluate('(() => { const { view } = window.__cell; view.camera.position.lerp(view.controls.target, 0.3); view.controls.update(); })()');
    await follow('拉近');
    await setInnerWidth(page, 1240);
    await sleep(300);
    await follow('視窗縮放');
    await setInnerWidth(page, 1280);
    await sleep(300);
    await clickCenter(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1', 8000);
    await settle(page);
    await follow('拆解');
    await clickCenter(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 0', 8000);
    await settle(page);
    await follow('組合');

    // 代表個體指向錨點
    const repInst = await page.evaluate("window.__cell.index.byId.get('nucleus').rep.userData.inst");
    const sep = await page.evaluate(`(() => {
      const { index, view } = window.__cell;
      const e = index.byId.get('nucleus');
      view.camera.updateMatrixWorld();
      const pr = (o) => { const v = o.getWorldPosition(o.position.clone()).project(view.camera); return { x: v.x * 640, y: v.y * 400 }; };
      const a = pr(e.anchor ?? e.rep), b = pr(e.rep);
      return Math.hypot(a.x - b.x, a.y - b.y);
    })()`);
    assert.ok(sep > 4, `前提：錨點與代表個體根的投影要相距 > 4 px（${sep}）`);
    await page.evaluate(`window.__cell.store.dispatch({ type: 'select', id: 'nucleus', inst: ${JSON.stringify(repInst)} })`);
    await settle(page);
    await follow('點到代表個體');

    // 非代表個體指向該個體根
    const multi = await page.evaluate(`(${((QUIZ, GHOST) => {
      for (const id of QUIZ) {
        if (GHOST.includes(id)) continue;
        const e = window.__cell.index.byId.get(id);
        if (!e || e.instances.length < 2) continue;
        const other = e.instances.find((r) => r !== e.rep);
        return { id, inst: other.userData.inst };
      }
      return null;
    }).toString()})(${JSON.stringify(QUIZ_IDS)}, ${JSON.stringify(GHOST_IDS)})`);
    assert.ok(multi, '找得到有多個個體的構造');
    await page.evaluate(`window.__cell.store.dispatch({ type: 'select', id: ${JSON.stringify(multi.id)}, inst: ${JSON.stringify(multi.inst)} })`);
    await settle(page);
    const c = await callout(page);
    const p = await projectOf(page, multi.id, multi.inst);
    assert.ok(c.visible, `${multi.id}#${multi.inst} 應顯示 ${JSON.stringify(c)}`);
    assert.ok(dist(c, p) <= 2, `${multi.id}#${multi.inst}：終點 ${c.x2},${c.y2} 與個體根投影 ${p.x},${p.y}`);
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('引線消失：取消選取與進入測驗後不顯示，測驗中不出現', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    await pick(page, 'nucleus');
    await settle(page);
    assert.ok((await callout(page)).visible);
    await clickCenter(page, '#panel-close');
    await frames(page, 3);
    assert.equal((await callout(page)).visible, false);
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('callout')).display"), 'none');
    await pick(page, 'nucleus');
    await settle(page);
    assert.ok((await callout(page)).visible);
    await clickCenter(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await frames(page, 3);
    assert.equal((await callout(page)).visible, false, '進入測驗後隱藏');
    for (let i = 0; i < 10; i++) {
      assert.equal((await callout(page)).visible, false, `測驗中第 ${i} 次取樣`);
      await sleep(100);
    }
    await clickCenter(page, '#quiz-exit');
    await page.waitFor("window.__cell.store.getState().phase === 'explore'");
    await frames(page, 3);
    assert.equal((await callout(page)).visible, false, '離開測驗後仍隱藏');
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('引線 narrow（390×800）：起點在面板上緣、對齊色點的水平位置', async () => {
  const page = await open(390, 800);
  try {
    await startAndSettle(page);
    await pick(page, 'nucleus');
    await settle(page);
    const c = await callout(page);
    assert.ok(c.visible, `應顯示 ${JSON.stringify(c)}`);
    const panel = await info(page, '#panel');
    const dot = center(await info(page, '#panel-dot'));
    const stage = await info(page, '#stage');
    assert.ok(Math.abs(c.y1 - panel.top) <= 1, `起點 y ${c.y1} 應在面板上緣 ${panel.top}`);
    assert.ok(Math.abs(c.x1 - dot.x) <= 1, `起點 x ${c.x1} 應對齊色點 ${dot.x}`);
    const p = await projectOf(page, 'nucleus');
    assert.ok(dist(c, p) <= 2, `終點 ${c.x2},${c.y2} 與投影 ${p.x},${p.y}`);
    assert.ok(c.y2 <= stage.bottom - 4, `終點 y ${c.y2} 要在畫布內`);
    console.log(`narrow callout = ${JSON.stringify(c)}`);
    await page.screenshot('assets/preview/web-callout-narrow.png');
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('引線 short（900×420）：面板捲到底、色點移出後起點夾在面板上緣', async () => {
  const page = await open(900, 420);
  try {
    await startAndSettle(page);
    await pick(page, 'nucleus');
    await settle(page);
    const need = await page.evaluate("(() => { const p = document.getElementById('panel'); return p.scrollHeight - p.clientHeight; })()");
    assert.ok(need > 20, `前提：面板要能捲動（${need}）`);
    await page.evaluate("(() => { const p = document.getElementById('panel'); p.scrollTop = p.scrollHeight; })()");
    await frames(page, 3);
    const panel = await info(page, '#panel');
    const dot = await info(page, '#panel-dot');
    assert.ok(dot.bottom < panel.top, `色點下緣 ${dot.bottom} 應在面板上緣 ${panel.top} 之上`);
    const c = await callout(page);
    assert.ok(c.visible, `應顯示 ${JSON.stringify(c)}`);
    assert.ok(Math.abs(c.y1 - panel.top) <= 1, `起點 y ${c.y1} 應夾在面板上緣 ${panel.top}`);
    assert.ok(Math.abs(c.x1 - panel.left) <= 1, `起點 x ${c.x1} 應在面板左緣 ${panel.left}`);
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});
