import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { ORGANELLE_IDS, QUIZ_IDS } from '../../web/src/organelles.js';
import { t, organelleName } from '../../web/src/i18n.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";

async function open(width, height, options = {}) {
  const page = await openPage('dist/plant-cell.html', { offline: true, width, height, ...options });
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

// 開場時：按鈕完整在視窗內且真的點得到
async function checkIntro(page, W, H, layout) {
  assert.equal(await page.evaluate('document.body.dataset.layout'), layout, `${W}×${H} 的版面模式`);
  const r = await info(page, '#intro-start');
  assert.ok(r.shown && inside(r, W, H), `#intro-start 應完整在視窗內：${JSON.stringify(r)}`);
  const c = center(r);
  assert.equal(await page.evaluate(`!!document.elementFromPoint(${c.x}, ${c.y}).closest('#intro-start')`), true, '#intro-start 中心點上方就是它自己');
}

// 畫布的繪圖寬高比與顯示寬高比相差小於 1%
async function checkCanvas(page) {
  const c = await page.evaluate(`(() => { const s = document.getElementById('stage'); const r = s.getBoundingClientRect(); return { dw: s.width, dh: s.height, w: r.width, h: r.height, left: r.left, top: r.top }; })()`);
  assert.ok(Math.abs(c.dw / c.dh / (c.w / c.h) - 1) < 0.01, `畫布繪圖比 ${c.dw}/${c.dh} 與顯示比 ${c.w}/${c.h} 不符`);
  return c;
}

const visibleUi = async (page) => {
  const out = {};
  for (const id of ['toolbar', 'list-wrap', 'panel', 'quiz']) {
    const r = await info(page, `#${id}`);
    if (r && r.shown) out[id] = r;
  }
  return out;
};
// 可見的介面元素都在視窗內、彼此不重疊
async function checkUi(page, W, H, msg) {
  const ui = await visibleUi(page);
  const names = Object.keys(ui);
  for (const n of names) assert.ok(inside(ui[n], W, H), `${msg}：#${n} 應完整在視窗內 ${JSON.stringify(ui[n])}`);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    assert.equal(overlaps(ui[names[i]], ui[names[j]], 1), false, `${msg}：#${names[i]} 與 #${names[j]} 重疊 ${JSON.stringify([ui[names[i]], ui[names[j]]])}`);
  }
  return ui;
}

const pillsOf = (page) => page.evaluate(`[...document.querySelectorAll('#labels [data-id]')].filter((e) => e.getClientRects().length > 0).map((e) => {
  const r = e.getBoundingClientRect();
  return { id: e.dataset.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
})`);
const frames = (page, n = 3) => page.evaluate(`new Promise((res) => { let n = ${n}; const f = () => (--n <= 0 ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const clickCenter = async (page, sel) => { const r = await info(page, sel); const c = center(r); await page.click(c.x, c.y); };

const EN = { initScript: "try { localStorage.setItem('plant-cell-lang', 'en'); } catch {}" };
const layoutOf = (page) => page.evaluate('window.__cell.layout()');

test('E1 English wide 1280×800：清單不超過三列且不截斷，壁在可用範圍內（載入即英文、執行中切換兩種）', async () => {
  // (a) 載入即英文
  const page = await open(1280, 800, EN);
  try {
    assert.ok((await page.evaluate(COLLECT_WALL)) > 50, '應取得本細胞的壁的頂點');
    await startAndSettle(page);
    const rows = await page.evaluate(`(() => {
      const wrap = document.getElementById('list-wrap').getBoundingClientRect();
      const bs = [...document.querySelectorAll('#list button')].map((b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), left: r.left, right: r.right, bottom: r.bottom, sw: b.scrollWidth, cw: b.clientWidth }; });
      return { wrap: { left: wrap.left, right: wrap.right, top: wrap.top, bottom: wrap.bottom }, bs };
    })()`);
    const tops = new Set(rows.bs.map((b) => b.top));
    const lay = await layoutOf(page);
    console.log(`E1 en rows ${tops.size}, band: rect.bottom ${lay.rect.bottom} of ${lay.height}`);
    assert.ok(tops.size <= 3, `英文清單應不超過三列：${[...tops]}`);
    for (const b of rows.bs) {
      assert.ok(b.sw <= b.cw, `清單按鈕被截斷：${JSON.stringify(b)}`);
      assert.ok(b.left >= rows.wrap.left - 0.5 && b.right <= rows.wrap.right + 0.5 && b.top >= rows.wrap.top - 0.5 && b.bottom <= rows.wrap.bottom + 0.5, `按鈕應在 #list-wrap 內：${JSON.stringify([b, rows.wrap])}`);
    }
    const wall = await page.evaluate(WALL_BOUNDS);
    const listTop = (await info(page, '#list-wrap')).top;
    assert.ok(wall.left >= lay.rect.left - 1 && wall.right <= lay.rect.right + 1 && wall.top >= lay.rect.top - 1 && wall.bottom <= lay.rect.bottom + 1, `壁應在可用範圍內：${JSON.stringify([wall, lay.rect])}`);
    assert.ok(wall.bottom <= listTop, `壁下緣 ${wall.bottom} 應在清單上緣 ${listTop} 之上`);
    await checkUi(page, 1280, 800, 'E1 英文載入');
    await page.screenshot('assets/preview/web-en-wide.png');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
  // (b) 執行中切換
  const page2 = await open(1280, 800);
  try {
    assert.ok((await page2.evaluate(COLLECT_WALL)) > 50);
    await startAndSettle(page2);
    const before = (await layoutOf(page2)).rect;
    await clickCenter(page2, '#toolbar [data-lang="en"]');
    await page2.waitFor("document.documentElement.lang === 'en'");
    await page2.waitFor('!window.__cell.cameraBusy()', 5000);
    await sleep(500);
    const lay = await layoutOf(page2);
    console.log(`E1 switch rect.bottom zh ${before.bottom} -> en ${lay.rect.bottom}`);
    assert.ok(lay.rect.bottom <= before.bottom + 0.5, `切換後保留帶不應變小：${before.bottom} -> ${lay.rect.bottom}`);
    const wall = await page2.evaluate(WALL_BOUNDS);
    const listTop = (await info(page2, '#list-wrap')).top;
    assert.ok(wall.left >= lay.rect.left - 1 && wall.right <= lay.rect.right + 1 && wall.top >= lay.rect.top - 1 && wall.bottom <= lay.rect.bottom + 1, `切換後壁應在可用範圍內：${JSON.stringify([wall, lay.rect])}`);
    assert.ok(wall.bottom <= listTop, `切換後壁下緣 ${wall.bottom} 應在清單上緣 ${listTop} 之上`);
    assert.deepEqual(page2.consoleErrors, []);
  } finally {
    await page2.close();
  }
});

test('E2 English wide 1280×800：一般狀態的名稱標籤數不比中文少 4 個以上', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    await clickCenter(page, '#btn-labels');
    await frames(page, 3);
    const nZh = (await pillsOf(page)).length;
    await clickCenter(page, '#toolbar [data-lang="en"]');
    await page.waitFor("document.documentElement.lang === 'en'");
    await frames(page, 3);
    const pills = await pillsOf(page);
    const nEn = pills.length;
    console.log(`E2 pills nZh ${nZh} nEn ${nEn}`);
    assert.ok(nEn >= nZh - 3, `英文標籤數 ${nEn} 不應比中文 ${nZh} 少 4 個以上`);
    for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) {
      assert.equal(overlaps(pills[i], pills[j]), false, `標籤重疊：${pills[i].id} 與 ${pills[j].id}`);
    }
    for (const sel of ['#list-wrap', '#toolbar']) {
      const r = await info(page, sel);
      if (!r || !r.shown) continue;
      for (const p of pills) assert.equal(overlaps(p, r), false, `標籤 ${p.id} 不應蓋住 ${sel}`);
    }
    await page.screenshot('assets/preview/web-en-wide-labels.png');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('E3 English wide 1280×800：20 則面板都捲得到底，需要捲動的不超過 8 則；字級與寬度在範圍內；fps ≥ 50', async () => {
  const page = await open(1280, 800, EN);
  try {
    await startAndSettle(page);
    const needScroll = [];
    for (const id of ORGANELLE_IDS) {
      await clickCenter(page, `#list [data-id="${id}"]`);
      await page.waitFor(`document.getElementById('panel-title').textContent === ${JSON.stringify(organelleName('en', id))}`, 3000);
      await frames(page, 2);
      const m = await page.evaluate(`(() => {
        const p = document.getElementById('panel');
        const scroll = p.scrollHeight > p.clientHeight + 1;
        p.scrollTop = p.scrollHeight;
        const fact = document.getElementById('panel-fact');
        const last = fact && !fact.hidden ? fact : document.getElementById('panel-body');
        return { scroll, lastBottom: last.getBoundingClientRect().bottom, panelBottom: p.getBoundingClientRect().bottom };
      })()`);
      if (m.scroll) needScroll.push(id);
      assert.ok(m.lastBottom <= m.panelBottom + 1, `${id}：捲到底後最後一段應在面板內 ${JSON.stringify(m)}`);
      await checkUi(page, 1280, 800, `E3 ${id}`);
    }
    console.log(`en panel scroll ${needScroll.length} ${needScroll.join(',')}`);
    assert.ok(needScroll.length <= 8, `需要捲動的面板 ${needScroll.length} 則：${needScroll}`);
    const st = await page.evaluate(`(() => ({ fs: parseFloat(getComputedStyle(document.getElementById('panel-body')).fontSize), w: document.getElementById('panel').getBoundingClientRect().width }))()`);
    assert.ok(st.fs >= 13, `面板內文字級 ${st.fs} 應 ≥ 13px`);
    assert.ok(st.w <= 380 + 0.5, `面板寬度 ${st.w} 應 ≤ 380`);
    await clickCenter(page, '#list [data-id="nucleus"]');
    await page.waitFor("document.getElementById('panel-title').textContent === " + JSON.stringify(organelleName('en', 'nucleus')), 3000);
    await sleep(1500);
    await page.screenshot('assets/preview/web-en-wide-panel.png');
    const fps = await page.evaluate('window.__cell.stats().fps');
    console.log(`E3 fps ${fps}, font ${st.fs}, panel width ${st.w}`);
    assert.ok(fps >= 50, `fps ${fps} 應 ≥ 50`);
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

const longest = [...QUIZ_IDS].sort((a, b) => organelleName('en', b).length - organelleName('en', a).length);
for (const [W, H, layout] of [[900, 420, 'short'], [390, 800, 'narrow']]) {
  test(`E4 English ${layout}（${W}×${H}）：工具列不溢出、不壓到取景範圍；最長答錯訊息不被裁切`, async () => {
    const page = await open(W, H, EN);
    try {
      assert.equal(await page.evaluate('document.body.dataset.layout'), layout);
      await startAndSettle(page);
      const measure = async (msg) => {
        const tb = await info(page, '#toolbar');
        assert.ok(tb.shown && inside(tb, W, H), `${msg}：#toolbar 應完整在視窗內 ${JSON.stringify(tb)}`);
        const ov = await page.evaluate("(() => { const e = document.getElementById('toolbar'); return { sw: e.scrollWidth, cw: e.clientWidth }; })()");
        assert.ok(ov.sw <= ov.cw + 1, `${msg}：#toolbar 內容不可溢出 ${JSON.stringify(ov)}`);
        await checkUi(page, W, H, msg);
        if (layout === 'narrow') {
          const lay = await layoutOf(page);
          assert.ok(tb.bottom <= lay.rect.top + 0.5, `${msg}：#toolbar 下緣 ${tb.bottom} 應在取景範圍上緣 ${lay.rect.top} 之上`);
        }
        console.log(`E4 ${layout} ${msg} toolbar h ${Math.round(tb.height)} w ${Math.round(tb.width)} bottom ${Math.round(tb.bottom)}`);
      };
      await measure('初始');
      await clickCenter(page, '#btn-explode');
      await clickCenter(page, '#btn-labels');
      await frames(page, 3);
      await sleep(600);
      await measure('拆解與名稱');
      await page.screenshot(`assets/preview/web-en-${layout}.png`);
      await clickCenter(page, '#btn-explode');
      await clickCenter(page, '#btn-labels');
      await frames(page, 3);
      await clickCenter(page, '#btn-quiz');
      await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
      await sleep(500);
      const picked = organelleName('en', longest[0]);
      const expected = organelleName('en', longest[1]);
      await page.evaluate(`(() => {
        const r = document.getElementById('quiz-result');
        r.dataset.state = 'wrong';
        r.textContent = ${JSON.stringify(t('en', 'quizWrong', { picked, expected }))};
      })()`);
      await frames(page);
      const card = await info(page, '#quiz');
      assert.ok(card.shown && inside(card, W, H), `測驗卡片應完整在視窗內：${JSON.stringify(card)}`);
      assert.equal(overlaps(card, await info(page, '#toolbar')), false, '不與工具列重疊');
      const fit = await page.evaluate("(() => { const r = document.getElementById('quiz-result'); return { sw: r.scrollWidth, cw: r.clientWidth, sh: r.scrollHeight, ch: r.clientHeight, fs: parseFloat(getComputedStyle(r).fontSize) }; })()");
      console.log(`E4 ${layout} quiz-result ${JSON.stringify(fit)} (${picked} / ${expected})`);
      assert.ok(fit.sw <= fit.cw, `答錯訊息不可橫向被裁掉：${JSON.stringify(fit)}`);
      const kids = await page.evaluate(`[...document.querySelectorAll('#quiz > *')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })`);
      for (const k of kids) assert.ok(k.left >= card.left - 1 && k.right <= card.right + 1 && k.top >= card.top - 1 && k.bottom <= card.bottom + 1, `#${k.id} 應在卡片內：${JSON.stringify([k, card])}`);
      await page.screenshot(`assets/preview/web-en-quiz-longest-${layout}.png`);
      assert.deepEqual(page.consoleErrors, []);
    } finally {
      await page.close();
    }
  });
}

for (const [W, H, layout] of [[1280, 800, 'wide'], [900, 420, 'short'], [390, 800, 'narrow']]) {
  test(`E5 English 開場卡片（${W}×${H}）：Start exploring 與切換鈕看得到、點得到，文字在卡片內捲得到底`, async () => {
    const page = await open(W, H, EN);
    try {
      assert.equal(await page.evaluate('document.body.dataset.layout'), layout);
      assert.equal(await page.evaluate("document.getElementById('intro-start').textContent"), 'Start exploring');
      const card = await info(page, '#intro-card');
      const targets = ['#intro-start', '#intro .lang-switch button[data-lang="zh"]', '#intro .lang-switch button[data-lang="en"]'];
      for (const sel of targets) {
        const r = await info(page, sel);
        assert.ok(r.shown && inside(r, W, H), `${sel} 應完整在視窗內：${JSON.stringify(r)}`);
        assert.ok(r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top >= card.top - 0.5 && r.bottom <= card.bottom + 0.5, `${sel} 應在 #intro-card 內：${JSON.stringify([r, card])}`);
        const c = center(r);
        assert.equal(await page.evaluate(`!!document.elementFromPoint(${c.x}, ${c.y}).closest(${JSON.stringify(sel)})`), true, `${sel} 中心點上方就是它自己`);
      }
      const body = await page.evaluate(`(() => {
        const b = document.querySelector('#intro-card .intro-body');
        if (!b) return null;
        const scroll = b.scrollHeight > b.clientHeight;
        if (scroll) b.scrollTop = b.scrollHeight;
        const ps = b.querySelectorAll('.intro-text');
        return { scroll, sh: b.scrollHeight, ch: b.clientHeight, lastBottom: ps[ps.length - 1].getBoundingClientRect().bottom, bodyBottom: b.getBoundingClientRect().bottom };
      })()`);
      assert.ok(body, '應有 .intro-body');
      console.log(`E5 ${layout} intro-body ${JSON.stringify(body)}`);
      assert.ok(body.lastBottom <= body.bodyBottom + 1, `最後一段應在 .intro-body 內：${JSON.stringify(body)}`);
      await page.screenshot(`assets/preview/web-en-intro-${layout}.png`);
      assert.deepEqual(page.consoleErrors, []);
    } finally {
      await page.close();
    }
  });
}

// 改成 .intro-body 結構之前，最後一段與開始鈕之間的 margin 會折疊成開始鈕的 margin-top（wide／narrow 26、short 12）
test('中文開場卡片：.intro-body 結構不改變既有間距（1280×800、900×420、390×800）', async () => {
  for (const [W, H, layout, expected] of [[1280, 800, 'wide', 26], [900, 420, 'short', 12], [390, 800, 'narrow', 26]]) {
    const page = await open(W, H);
    try {
      assert.equal(await page.evaluate('document.body.dataset.layout'), layout);
      const m = await page.evaluate(`(() => {
        const b = document.querySelector('#intro-card .intro-body');
        const scroll = b.scrollHeight > b.clientHeight;
        b.scrollTop = b.scrollHeight;
        const ps = b.querySelectorAll('.intro-text');
        const gap = document.getElementById('intro-start').getBoundingClientRect().top - ps[ps.length - 1].getBoundingClientRect().bottom;
        return { scroll, gap };
      })()`);
      console.log(`zh intro ${layout} ${JSON.stringify(m)}`);
      assert.ok(Math.abs(m.gap - expected) <= 0.5, `${layout}：最後一段到開始鈕的距離 ${m.gap} 應為 ${expected}`);
      if (layout !== 'narrow') assert.equal(m.scroll, false, `${layout} 的中文 .intro-body 不需要捲動`);
      assert.deepEqual(page.consoleErrors, []);
    } finally {
      await page.close();
    }
  }
});
