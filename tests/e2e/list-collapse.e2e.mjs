import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";
const EN_INIT = "try { localStorage.setItem('plant-cell-lang', 'en'); } catch {}";

async function open(width, height, initScript = null) {
  const page = await openPage('dist/plant-cell.html', { offline: true, width, height, initScript });
  try {
    await page.waitFor(READY);
    const failure = await page.evaluate('document.documentElement.dataset.cellError || ""');
    assert.equal(failure, '', `檢視器啟動失敗：${failure}`);
  } catch (e) { await page.close(); throw e; }
  return page;
}

// 一個元素是否看得到，以及它的矩形
const info = (page, sel) => page.evaluate(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return { shown: e.getClientRects().length > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
})()`);
const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
const overlaps = (a, b, gap = 0) => a.left < b.right - gap && a.right > b.left + gap && a.top < b.bottom - gap && a.bottom > b.top + gap;
const inside = (r, W, H) => r.left >= -0.5 && r.top >= -0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5;

// 本細胞的壁（不含相鄰細胞）在「蓋子還蓋著」時的頂點：開場時蒐集，之後用目前的鏡頭投影
const COLLECT_WALL = `(() => {
  const { index, view } = window.__cell;
  view.scene.updateMatrixWorld(true);
  const v = view.camera.position.clone();
  const pts = [];
  for (const m of index.byId.get('cell_wall').meshes) {
    if (m.name.startsWith('neighbor')) continue;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); pts.push(v.x, v.y, v.z); }
  }
  window.__wallPts = pts;
  return pts.length / 3;
})()`;
const WALL_BOUNDS = `(() => {
  const { view } = window.__cell;
  view.camera.updateMatrixWorld();
  const r = document.getElementById('stage').getBoundingClientRect();
  const v = view.camera.position.clone();
  let l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
  const p = window.__wallPts;
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i + 1], p[i + 2]).project(view.camera);
    const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
    if (x < l) l = x; if (x > rt) rt = x; if (y < t) t = y; if (y > b) b = y;
  }
  return { left: l, right: rt, top: t, bottom: b, n: p.length / 3 };
})()`;

async function startAndSettle(page) {
  const b = center(await info(page, '#intro-start'));
  await page.click(b.x, b.y);
  await page.waitFor('window.__cell.lidOpen() === true');
  await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
  await page.waitFor('!window.__cell.cameraBusy()', 5000);
  await sleep(500);
}

const pillsOf = (page) => page.evaluate(`[...document.querySelectorAll('#labels [data-id]')].filter((e) => e.getClientRects().length > 0).map((e) => {
  const r = e.getBoundingClientRect();
  return { id: e.dataset.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
})`);
const frames = (page, n = 3) => page.evaluate(`new Promise((res) => { let n = ${n}; const f = () => (--n <= 0 ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const clickCenter = async (page, sel) => { const r = await info(page, sel); const c = center(r); await page.click(c.x, c.y); };
const setInnerWidth = (page, w) => page.evaluate(`(() => {
  Object.defineProperty(window, 'innerWidth', { value: ${w}, configurable: true });
  window.dispatchEvent(new Event('resize'));
})()`);
const camDistance = (page) => page.evaluate('(() => { const { camera, controls } = window.__cell.view; return camera.position.distanceTo(controls.target); })()');

// ---- 本檔新寫的輔助函式 ----
const settled = async (page) => {
  await page.waitFor('!window.__cell.cameraBusy()', 5000);
  await frames(page, 3);
  await sleep(300);
};
const rect = async (page) => (await page.evaluate('window.__cell.layout()')).rect;
// 目前版面的預設鏡頭距離
const defDist = (page) => page.evaluate('(() => { const p = window.__cell.view.defaultPose(); return p.position.distanceTo(p.target); })()');
const camDir = (page) => page.evaluate('(() => { const { camera, controls } = window.__cell.view; return camera.position.clone().sub(controls.target).normalize().toArray(); })()');
const targetOf = (page) => page.evaluate('window.__cell.view.controls.target.toArray()');

// 按下收合鈕（真的滑鼠點），同時逐格記錄畫面平移與鏡頭距離，量出有沒有一格跳過去
async function toggleSmoothly(page, n = 50) {
  await page.evaluate(`window.__samples = new Promise((res) => {
    const out = [];
    const f = () => {
      const { camera, controls } = window.__cell.view;
      out.push([camera.view.offsetX, camera.view.offsetY, camera.position.distanceTo(controls.target)]);
      if (out.length >= ${n}) res(out); else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }); true`);
  await clickCenter(page, '#list-toggle');
  const s = await page.evaluate('window.__samples');
  let maxStep = 0, maxDStep = 0;
  for (let i = 1; i < s.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(s[i][0] - s[i - 1][0]), Math.abs(s[i][1] - s[i - 1][1]));
    maxDStep = Math.max(maxDStep, Math.abs(s[i][2] - s[i - 1][2]));
  }
  const a = s[0], b = s[s.length - 1];
  const total = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  const r = { maxStep, total, dStart: a[2], dEnd: b[2], maxDStep };
  console.log('toggleSmoothly', JSON.stringify(r));
  return r;
}
const smoothOk = (r) => {
  assert.ok(r.maxStep <= 6, `平移一格跳了 ${r.maxStep}`);
  assert.ok(r.total > 1, `平移幾乎沒動 ${r.total}`);
  const dd = Math.abs(r.dEnd - r.dStart);
  if (dd > 0.05) assert.ok(r.maxDStep <= 0.2 * dd, `距離一格跳了 ${r.maxDStep}（總變化 ${dd}）`);
};
const within = (b, rc, eps = 1) => b.left >= rc.left - eps && b.right <= rc.right + eps && b.top >= rc.top - eps && b.bottom <= rc.bottom + eps;

for (const [W, H, mode] of [[1280, 800, 'wide'], [900, 420, 'short']]) {
  test(`L1 收合（${mode} ${W}×${H}）：清單只剩標題列、取景平滑放大；再按一次回到原值`, async () => {
    const page = await open(W, H);
    try {
      await page.evaluate(COLLECT_WALL);
      await startAndSettle(page);
      const tg = await info(page, '#list-toggle');
      assert.equal(tg.shown, true);
      assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-expanded')"), 'true');
      assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-controls')"), 'list');
      assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-label')"), '收起構造清單');
      const R0 = await rect(page);
      const d0 = await camDistance(page);
      const w0 = await info(page, '#list-wrap');
      if (mode === 'wide') {
        const ti = await info(page, '#list-title');
        console.log('L1 title offset', center(ti).x - center(w0).x);
        assert.ok(Math.abs(center(ti).x - center(w0).x) <= 0.5, `展開時標題偏離清單中心 ${center(ti).x - center(w0).x}`);
        console.log('L1 wide 展開高度', w0.height);
        assert.deepEqual(R0, { left: 0, top: 16, right: 1280, bottom: 674 });
        assert.ok(Math.abs(d0 - 22.17) < 0.01, `d0 ${d0}`);
      } else {
        const l = await info(page, '#list');
        assert.ok(Math.abs(w0.height - (l.height + 14)) <= 0.5, `short 展開高度 ${w0.height} vs ${l.height}`);
      }

      const r = await toggleSmoothly(page);
      smoothOk(r);
      assert.ok(r.dEnd < r.dStart - 0.05, `距離沒有縮短 ${r.dStart} → ${r.dEnd}`);
      await settled(page);
      assert.equal((await info(page, '#list')).shown, false);
      const w1 = await info(page, '#list-wrap');
      assert.ok(w1.height <= 44, `收合後清單高度 ${w1.height}`);
      assert.ok(Math.abs(center(w1).x - center(w0).x) <= 1, '收合後清單中心 x 改變');
      const R1 = await rect(page);
      assert.ok(R1.bottom > R0.bottom, `可用範圍沒有往下延伸 ${R0.bottom} → ${R1.bottom}`);
      assert.deepEqual({ l: R1.left, t: R1.top, r: R1.right }, { l: R0.left, t: R0.top, r: R0.right });
      const wall = await page.evaluate(WALL_BOUNDS);
      assert.ok(within(wall, R1), `壁超出可用範圍 ${JSON.stringify([wall, R1])}`);
      assert.ok(wall.bottom <= w1.top + 0.5, `壁被清單蓋住 ${wall.bottom} > ${w1.top}`);
      const d1 = await camDistance(page);
      assert.ok(d1 < d0 - 0.05, `d1 ${d1} d0 ${d0}`);
      assert.ok(Math.abs(d1 - (await defDist(page))) < 0.01, 'd1 與新版面的預設距離不同');
      assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-expanded')"), 'false');
      assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-label')"), '展開構造清單');
      assert.equal(await page.evaluate('localStorage.length'), 0);
      console.log(`L1 ${mode}`, JSON.stringify({ R0bottom: R0.bottom, R1bottom: R1.bottom, d0, d1, wrapH: w1.height }));
      await page.screenshot(`assets/preview/web-list-collapsed-${mode}.png`);

      const r2 = await toggleSmoothly(page);
      smoothOk(r2);
      await settled(page);
      assert.deepEqual(await rect(page), R0);
      assert.ok(Math.abs((await camDistance(page)) - d0) < 0.01, '展開後距離沒回到原值');
      assert.equal((await info(page, '#list')).shown, true);
      assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-expanded')"), 'true');
      assert.deepEqual(page.consoleErrors, []);
    } finally { await page.close(); }
  });
}

test('L2 收合後進入測驗：測驗中的保留帶與展開時相同，結束後回到收合', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    const R0 = await rect(page);
    const d0 = await camDistance(page);
    await clickCenter(page, '#list-toggle');
    await settled(page);
    const R1 = await rect(page);
    const d1 = await camDistance(page);
    await clickCenter(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await settled(page);
    assert.deepEqual(await rect(page), R0);
    assert.ok(Math.abs((await camDistance(page)) - d0) < 0.01, `測驗中距離 ${await camDistance(page)} vs ${d0}`);
    assert.equal(await page.evaluate('window.__cell.store.getState().listCollapsed'), true);
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('list-wrap')).visibility"), 'hidden');
    await clickCenter(page, '#quiz-exit');
    await page.waitFor("window.__cell.store.getState().phase === 'explore'");
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
    await settled(page);
    assert.deepEqual(await rect(page), R1);
    assert.ok(Math.abs((await camDistance(page)) - d1) < 0.01, `結束測驗後距離 ${await camDistance(page)} vs ${d1}`);
    assert.equal((await info(page, '#list')).shown, false);
    assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-expanded')"), 'false');
  } finally { await page.close(); }
});

test('L3 narrow：沒有收合鈕且清單一律展開；wide 收合後縮成 narrow 再放大仍是收合', async () => {
  const a = await open(390, 800);
  try {
    await startAndSettle(a);
    assert.equal((await info(a, '#list-toggle')).shown, false);
    assert.equal((await info(a, '#list')).shown, true);
    const R = await rect(a);
    await a.evaluate("window.__cell.store.dispatch({ type: 'toggleList' })");
    await frames(a, 3);
    assert.equal((await info(a, '#list')).shown, true);
    assert.deepEqual(await rect(a), R);
  } finally { await a.close(); }
  const b = await open(1280, 800);
  try {
    await startAndSettle(b);
    await clickCenter(b, '#list-toggle');
    await settled(b);
    const R1 = await rect(b);
    await setInnerWidth(b, 390);
    await frames(b, 3);
    assert.equal(await b.evaluate('document.body.dataset.layout'), 'narrow');
    assert.equal((await info(b, '#list')).shown, true);
    assert.equal((await info(b, '#list-toggle')).shown, false);
    await setInnerWidth(b, 1280);
    await frames(b, 3);
    assert.equal((await info(b, '#list')).shown, false);
    const tg = await info(b, '#list-toggle');
    assert.equal(tg.shown, true);
    assert.equal(await b.evaluate("document.getElementById('list-toggle').getAttribute('aria-expanded')"), 'false');
    assert.ok((await info(b, '#list-wrap')).height <= 44);
    assert.equal((await rect(b)).bottom, R1.bottom);
  } finally { await b.close(); }
});

test('L4 英文：收合鈕的文字標籤，切換語言時跟著換', async () => {
  const page = await open(1280, 800, EN_INIT);
  try {
    await startAndSettle(page);
    assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-label')"), 'Collapse structure list');
    assert.equal(await page.evaluate("document.getElementById('list-toggle').title"), 'Collapse structure list');
    await clickCenter(page, '#list-toggle');
    await settled(page);
    assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-label')"), 'Expand structure list');
    assert.equal(await page.evaluate("document.getElementById('list-toggle').title"), 'Expand structure list');
    assert.ok((await info(page, '#list-wrap')).height <= 44);
    assert.equal(await page.evaluate("document.getElementById('list-title').textContent"), 'Cell structures');
    await page.screenshot('assets/preview/web-list-collapsed-en.png');
    await clickCenter(page, '#toolbar [data-lang="zh"]');
    await frames(page, 3);
    assert.equal(await page.evaluate("document.getElementById('list-toggle').getAttribute('aria-label')"), '展開構造清單');
    assert.equal(await page.evaluate("document.getElementById('list-toggle').title"), '展開構造清單');
    assert.equal((await info(page, '#list')).shown, false);
    assert.ok((await info(page, '#list-wrap')).height <= 44);
  } finally { await page.close(); }
});

test('L5 鍵盤與 aria：原生按鈕、排在清單按鈕之前、操作後焦點留在收合鈕', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    const q = (js) => page.evaluate(`(() => { const t = document.getElementById('list-toggle'); ${js} })()`);
    assert.equal(await page.evaluate("document.querySelector('#list-wrap button').id"), 'list-toggle');
    assert.equal(await q('return t.tagName;'), 'BUTTON');
    assert.equal(await q('return t.type;'), 'button');
    assert.equal(await q('return t.tabIndex;'), 0);
    assert.equal(await q('return t.disabled;'), false);
    assert.equal(await q("return t.getAttribute('aria-controls');"), 'list');
    assert.equal(await page.evaluate("!!document.getElementById('list')"), true);
    assert.equal(await q('t.focus(); return document.activeElement === t;'), true);
    await q('t.click();');
    await frames(page, 3);
    assert.equal(await q("return t.getAttribute('aria-expanded');"), 'false');
    assert.equal(await page.evaluate('window.__cell.store.getState().listCollapsed'), true);
    assert.equal(await q('return document.activeElement === t;'), true);
    await q('t.click();');
    await frames(page, 3);
    assert.equal(await q("return t.getAttribute('aria-expanded');"), 'true');
    assert.equal(await q('return document.activeElement === t;'), true);
  } finally { await page.close(); }
});

test('L6 拖曳並拉近後收合：距離依比例、方向與目標不變、過程平滑；名稱標籤不蓋住清單', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    await page.drag(640, 400, 820, 330);
    await settled(page);
    await page.evaluate('(() => { const { camera, controls } = window.__cell.view; camera.position.lerp(controls.target, 0.3); controls.update(); })()');
    await settled(page);
    const d = await camDistance(page);
    const u = await camDir(page);
    const T = await targetOf(page);
    const k0 = await defDist(page);
    const r = await toggleSmoothly(page);
    assert.ok(r.maxStep <= 6, `maxStep ${r.maxStep}`);
    assert.ok(r.maxDStep <= 0.2 * Math.abs(r.dEnd - r.dStart), `maxDStep ${r.maxDStep}`);
    await settled(page);
    const k = (await defDist(page)) / k0;
    const dn = await camDistance(page);
    assert.ok(Math.abs(dn - d * k) <= 0.01 * d * k, `距離 ${dn} 應為 ${d * k}`);
    const u2 = await camDir(page);
    const angle = (Math.acos(Math.min(1, u[0] * u2[0] + u[1] * u2[1] + u[2] * u2[2])) * 180) / Math.PI;
    assert.ok(angle < 0.5, `方向夾角 ${angle}`);
    const T2 = await targetOf(page);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(T2[i] - T[i]) < 1e-6, `target[${i}]`);
    assert.ok((await rect(page)).bottom > 674);
    console.log('L6', JSON.stringify({ k, d, dn, angle, ...r }));
    await clickCenter(page, '#btn-labels');
    await frames(page, 3);
    await sleep(300);
    const wrap = await info(page, '#list-wrap');
    for (const p of await pillsOf(page)) assert.equal(overlaps(p, wrap), false, `名稱標籤 ${p.id} 蓋住清單`);
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('L7 閒置自轉開始後收合：距離變成新版面的預設距離', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    const d0 = await camDistance(page);
    await page.waitFor('window.__cell.autoRotating()', 8000);
    const r = await toggleSmoothly(page);
    smoothOk(r);
    await settled(page);
    const dd = await defDist(page);
    const d = await camDistance(page);
    console.log('L7', JSON.stringify({ d0, d, defDist: dd }));
    assert.ok(Math.abs(d - dd) < 0.01 * dd, `距離 ${d} vs 預設 ${dd}`);
    assert.ok(d < d0 - 0.05);
  } finally { await page.close(); }
});

test('L8 特寫中收合：距離不變、只平移；面板不蓋住收合後的清單', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    await page.evaluate("document.querySelector('#list [data-id=\"nucleus\"]').click()");
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    await settled(page);
    const d = await camDistance(page);
    const T = await targetOf(page);
    const r = await toggleSmoothly(page);
    console.log('L8', JSON.stringify({ d, ...r }));
    assert.ok(r.maxStep <= 6, `maxStep ${r.maxStep}`);
    assert.ok(r.total > 1, `total ${r.total}`);
    assert.ok(r.maxDStep < 0.01, `maxDStep ${r.maxDStep}`);
    assert.ok(Math.abs(r.dEnd - d) < 0.01);
    await settled(page);
    assert.ok(Math.abs((await camDistance(page)) - d) < 0.01);
    const T2 = await targetOf(page);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(T2[i] - T[i]) < 1e-6, `target[${i}]`);
    const panel = await info(page, '#panel');
    const wrap = await info(page, '#list-wrap');
    assert.equal(overlaps(panel, wrap), false, '面板蓋住清單');
    assert.ok(panel.bottom <= wrap.top + 0.5, `面板下緣 ${panel.bottom} 超過清單上緣 ${wrap.top}`);
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('L9 收合動畫進行中再按一次：拖曳過的鏡頭回到原本的距離；沒動過鏡頭也回到預設取景', async () => {
  const a = await open(1280, 800);
  try {
    await startAndSettle(a);
    await a.drag(640, 400, 820, 330);
    await settled(a);
    const R0 = await rect(a);
    const d = await camDistance(a);
    await clickCenter(a, '#list-toggle');
    await sleep(250);
    assert.equal(await a.evaluate('window.__cell.cameraBusy()'), true, '第一段動畫應還在跑');
    await clickCenter(a, '#list-toggle');
    await settled(a);
    const dn = await camDistance(a);
    console.log('L9 拖曳後連按', JSON.stringify({ d, dn }));
    assert.ok(Math.abs(dn - d) <= 0.01 * d, `距離 ${dn} 應回到 ${d}`);
    assert.deepEqual(await rect(a), R0);
    assert.equal(await a.evaluate('window.__cell.store.getState().listCollapsed'), false);
  } finally { await a.close(); }
  const b = await open(1280, 800);
  try {
    await startAndSettle(b);
    await clickCenter(b, '#list-toggle');
    await sleep(250);
    await clickCenter(b, '#list-toggle');
    await settled(b);
    const dn = await camDistance(b);
    console.log('L9 預設位置連按', dn);
    assert.deepEqual(await rect(b), { left: 0, top: 16, right: 1280, bottom: 674 });
    assert.ok(Math.abs(dn - 22.17) <= 0.01, `距離 ${dn}`);
  } finally { await b.close(); }
});
