import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPage } from '../../scripts/cdp.mjs';
import { FORBIDDEN_WORDS } from '../../web/src/forbidden-words.js';

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

test('版面 wide（1280×800）：取景、清單、面板、名稱標籤、測驗卡片', async () => {
  const page = await open(1280, 800);
  try {
    await checkIntro(page, 1280, 800, 'wide');
    await page.screenshot('assets/preview/web-wide-intro.png');
    assert.ok((await page.evaluate(COLLECT_WALL)) > 50, '應取得本細胞的壁的頂點');
    assert.equal(await page.evaluate("(() => { const e = document.getElementById('loading'); return !e || e.getClientRects().length === 0; })()"), true, 'cellReady 之後載入提示不可見');
    await startAndSettle(page);

    const stage = await checkCanvas(page);
    assert.deepEqual([stage.w, stage.h], [1280, 800], 'wide 模式畫布佔滿整個視窗');
    const list = await info(page, '#list-wrap');
    assert.ok(list.shown && list.height <= 124, `清單連標題總高度應不超過 124，實際 ${list.height}`);
    assert.ok(inside(list, 1280, 800));
    const rows = await page.evaluate("new Set([...document.querySelectorAll('#list button')].map((b) => Math.round(b.getBoundingClientRect().top))).size");
    assert.equal(rows, 2, '寬螢幕的清單排成兩列');

    // 取景完成條件
    const { rect } = await page.evaluate('window.__cell.layout()');
    const b = await page.evaluate(WALL_BOUNDS);
    const eps = 1;
    assert.ok(b.left >= rect.left - eps && b.right <= rect.right + eps && b.top >= rect.top - eps && b.bottom <= rect.bottom + eps, `本細胞的壁應在可用範圍內：${JSON.stringify({ b, rect })}`);
    assert.ok((b.bottom - b.top) >= 0.92 * (rect.bottom - rect.top), `高度應至少佔可用範圍的 92%：${b.bottom - b.top} / ${rect.bottom - rect.top}`);
    assert.ok(b.right - b.left >= 600, `寬度應至少 600 像素，實際 ${(b.right - b.left).toFixed(1)}`);
    assert.ok(b.bottom <= list.top, `清單不可蓋住本細胞的壁：壁下緣 ${b.bottom}，清單上緣 ${list.top}`);
    console.log('wide 取景', JSON.stringify({ rect, wall: { w: +(b.right - b.left).toFixed(1), h: +(b.bottom - b.top).toFixed(1) }, dist: await page.evaluate('(() => { const { camera, controls } = window.__cell.view; return camera.position.distanceTo(controls.target); })()') }));
    await checkUi(page, 1280, 800, 'wide 探索');
    await page.screenshot('assets/preview/web-wide.png');

    // 名稱標籤：不與清單、工具列重疊
    await clickCenter(page, '#btn-labels');
    await frames(page);
    await sleep(300);
    const toolbar = await info(page, '#toolbar');
    let pills = await pillsOf(page);
    assert.ok(pills.length >= 18, `名稱標籤至少 18 個，實際 ${pills.length}`);
    for (const p of pills) {
      assert.equal(overlaps(p, list), false, `標籤 ${p.id} 不可蓋住清單`);
      assert.equal(overlaps(p, toolbar), false, `標籤 ${p.id} 不可蓋住工具列`);
      assert.ok(inside(p, 1280, 800));
    }
    await page.screenshot('assets/preview/web-wide-labels.png');

    // 選取細胞核：面板在右側、不與清單重疊
    const nuc = center(await info(page, '#list [data-id="nucleus"]'));
    await page.click(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    await page.waitFor('!window.__cell.cameraBusy()', 5000);
    await frames(page);
    const panel = await info(page, '#panel');
    assert.ok(panel.shown && inside(panel, 1280, 800), `面板應完整在視窗內：${JSON.stringify(panel)}`);
    assert.ok(panel.left > 640, '面板的左緣在視窗水平中線的右邊');
    assert.equal(overlaps(panel, await info(page, '#list-wrap')), false, '面板不可蓋到清單');
    await checkUi(page, 1280, 800, 'wide 選取');
    pills = await pillsOf(page);
    for (const p of pills) assert.equal(overlaps(p, panel), false, `標籤 ${p.id} 不可蓋住面板`);
    await clickCenter(page, '#panel-close');
    await page.waitFor('window.__cell.store.getState().selected === null');
    await clickCenter(page, '#btn-labels'); // 關閉名稱

    // 測驗：卡片在底部、清單原本的位置，不與工具列重疊；結束後清單回來
    await clickCenter(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).visibility === 'hidden'");
    await sleep(400);
    const quiz = await info(page, '#quiz');
    assert.ok(quiz.shown && quiz.top > 400 && inside(quiz, 1280, 800), `測驗卡片應在底部：${JSON.stringify(quiz)}`);
    assert.equal(overlaps(quiz, await info(page, '#toolbar')), false);
    assert.ok(quiz.top >= list.top - 4, `測驗卡片不應比清單高太多（取景保留帶）：${quiz.top} vs ${list.top}`);
    await checkUi(page, 1280, 800, 'wide 測驗');
    await clickCenter(page, '#quiz-exit');
    await page.waitFor("window.__cell.store.getState().phase === 'explore'");
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).visibility === 'visible' && getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
    assert.equal((await info(page, '#list-wrap')).shown, true, '結束測驗後清單回來');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('版面 narrow（390×800）：畫布在上、下方區在清單、面板、測驗卡片之間切換', async () => {
  const page = await open(390, 800);
  try {
    await checkIntro(page, 390, 800, 'narrow');
    await page.evaluate(COLLECT_WALL);
    await startAndSettle(page);
    const stage = await checkCanvas(page);
    assert.ok(stage.h >= 0.45 * 800, `畫布高度至少是視窗高度的 45%，實際 ${stage.h}`);
    assert.equal(stage.w, 390);
    const stageBottom = stage.top + stage.h;
    const wall = await page.evaluate(WALL_BOUNDS);
    assert.ok(wall.left >= -1 && wall.right <= 390 + 1 && wall.top >= -1 && wall.bottom <= stageBottom + 1, `本細胞的壁應在畫布內：${JSON.stringify(wall)}`);
    const tb = await info(page, '#toolbar');
    assert.ok(tb.shown && inside(tb, 390, stageBottom), '工具列在畫布左上角');

    // 沒有選取：清單在畫布下方、在視窗內
    let list = await info(page, '#list-wrap');
    assert.ok(list.shown && list.top >= stageBottom - 1 && inside(list, 390, 800), `清單應在畫布下方：${JSON.stringify(list)}`);
    await checkUi(page, 390, 800, 'narrow 清單');
    await page.screenshot('assets/preview/web-narrow-list.png');

    // 選取：清單不可見、面板在畫布下方
    const nuc = center(await info(page, '#list [data-id="nucleus"]'));
    await page.click(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    await page.waitFor('!window.__cell.cameraBusy()', 5000);
    await sleep(600);
    assert.equal((await info(page, '#list-wrap')).shown, false, '選取後清單不可見');
    const panel = await info(page, '#panel');
    assert.ok(panel.shown && panel.top >= stageBottom - 1 && inside(panel, 390, 800), `面板應在畫布下方且在視窗內：${JSON.stringify(panel)}`);
    await checkUi(page, 390, 800, 'narrow 選取');
    await page.screenshot('assets/preview/web-narrow.png');

    // 按關閉鈕：清單恢復
    await clickCenter(page, '#panel-close');
    await page.waitFor('window.__cell.store.getState().selected === null');
    list = await info(page, '#list-wrap');
    assert.ok(list.shown && list.top >= stageBottom - 1, '關閉面板後清單恢復');

    // 測驗：卡片在畫布下方
    await clickCenter(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await sleep(500);
    const quiz = await info(page, '#quiz');
    assert.ok(quiz.shown && quiz.top >= stageBottom - 1 && inside(quiz, 390, 800), `測驗卡片應在畫布下方：${JSON.stringify(quiz)}`);
    await checkUi(page, 390, 800, 'narrow 測驗');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('版面 short（900×420）：清單單列、取景放進可用範圍', async () => {
  const page = await open(900, 420);
  try {
    await checkIntro(page, 900, 420, 'short');
    await page.evaluate(COLLECT_WALL);
    await startAndSettle(page);
    const stage = await checkCanvas(page);
    assert.deepEqual([stage.w, stage.h], [900, 420]);
    const list = await info(page, '#list-wrap');
    assert.ok(list.shown && list.height <= 64, `清單總高度應不超過 64，實際 ${list.height}`);
    const tops = await page.evaluate("[...document.querySelectorAll('#list button')].map((b) => Math.round(b.getBoundingClientRect().top))");
    assert.equal(new Set(tops).size, 1, `清單應是單列：${[...new Set(tops)]}`);
    const { rect } = await page.evaluate('window.__cell.layout()');
    const b = await page.evaluate(WALL_BOUNDS);
    assert.ok(b.left >= rect.left - 1 && b.right <= rect.right + 1 && b.top >= rect.top - 1 && b.bottom <= rect.bottom + 1, `本細胞的壁應在可用範圍內：${JSON.stringify({ b, rect })}`);
    assert.ok(b.bottom <= list.top, '清單不蓋住壁');
    await checkUi(page, 900, 420, 'short 探索');
    await page.screenshot('assets/preview/web-short.png');
    // 選取：面板不蓋清單
    const nuc = center(await info(page, '#list [data-id="nucleus"]'));
    await page.click(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    await sleep(400);
    await checkUi(page, 900, 420, 'short 選取');
    await clickCenter(page, '#panel-close');
    await clickCenter(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await sleep(500);
    await checkUi(page, 900, 420, 'short 測驗');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

for (const [W, H, layout] of [[722, 323, 'short'], [468, 798, 'narrow']]) {
  test(`小視窗 ${W}×${H}（${layout}）：介面不互相遮擋、開場按鈕完整可見`, async () => {
    const page = await open(W, H);
    try {
      await checkIntro(page, W, H, layout);
      await checkCanvas(page);
      await startAndSettle(page);
      await checkUi(page, W, H, '探索');
      const nuc = center(await info(page, '#list [data-id="nucleus"]'));
      await page.click(nuc.x, nuc.y);
      await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
      await sleep(500);
      await checkUi(page, W, H, '選取');
      await clickCenter(page, '#panel-close');
      await clickCenter(page, '#btn-quiz');
      await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
      await sleep(500);
      await checkUi(page, W, H, '測驗');
      assert.deepEqual(page.consoleErrors, []);
    } finally {
      await page.close();
    }
  });
}

const setInnerWidth = (page, w) => page.evaluate(`(() => {
  Object.defineProperty(window, 'innerWidth', { value: ${w}, configurable: true });
  window.dispatchEvent(new Event('resize'));
})()`);

test('底部保留帶不受測驗與名稱隱藏影響：測驗中縮放視窗後壁不被蓋住，結束測驗後也不被清單蓋住', async () => {
  const page = await open(1280, 800);
  try {
    await page.evaluate(COLLECT_WALL);
    await startAndSettle(page);
    const bottomAt = async () => (await page.evaluate('window.__cell.layout()')).rect.bottom;
    const settled = async () => { await page.waitFor('!window.__cell.cameraBusy()', 5000); await frames(page); await sleep(300); };
    const base = await bottomAt();
    await setInnerWidth(page, 1240);
    await frames(page);
    const explore1240 = await bottomAt();
    await setInnerWidth(page, 1280);
    await frames(page);
    assert.ok(Math.abs((await bottomAt()) - base) <= 1, '回到 1280 後保留帶相同');

    await clickCenter(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await settled();
    assert.ok(Math.abs((await bottomAt()) - base) <= 1, `測驗中的保留帶應與探索相同：${await bottomAt()} vs ${base}`);
    await setInnerWidth(page, 1240);
    await frames(page);
    await settled();
    const quiz1240 = await bottomAt();
    assert.ok(Math.abs(quiz1240 - explore1240) <= 1, `同寬度下測驗與探索的保留帶應相同：${quiz1240} vs ${explore1240}`);
    const card = await info(page, '#quiz');
    const wall = await page.evaluate(WALL_BOUNDS);
    assert.ok(wall.bottom <= card.top + 0.5, `測驗卡片不可蓋住壁：壁下緣 ${wall.bottom}，卡片上緣 ${card.top}`);

    await clickCenter(page, '#quiz-exit');
    await page.waitFor("window.__cell.store.getState().phase === 'explore'");
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
    await settled();
    const list = await info(page, '#list-wrap');
    const wall2 = await page.evaluate(WALL_BOUNDS);
    assert.ok(wall2.bottom <= list.top + 0.5, `結束測驗後清單不可蓋住壁：壁下緣 ${wall2.bottom}，清單上緣 ${list.top}`);
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('narrow：鍵盤從清單選取後焦點移到關閉鈕，關閉後回到清單上那個構造的按鈕', async () => {
  const page = await open(390, 800);
  try {
    await startAndSettle(page);
    await page.evaluate("(() => { const b = document.querySelector('#list [data-id=\"nucleus\"]'); b.focus(); b.click(); })()");
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    assert.equal(await page.evaluate('document.activeElement.id'), 'panel-close', '選取後焦點應在 #panel-close');
    await page.evaluate("document.getElementById('panel-close').click()");
    await page.waitFor('window.__cell.store.getState().selected === null');
    assert.equal(await page.evaluate("document.activeElement === document.querySelector('#list [data-id=\"nucleus\"]')"), true, '關閉後焦點應回到細胞核的清單按鈕');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('wide：從清單選取不搬動焦點', async () => {
  const page = await open(1280, 800);
  try {
    await startAndSettle(page);
    await page.evaluate("(() => { const b = document.querySelector('#list [data-id=\"nucleus\"]'); b.focus(); b.click(); })()");
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    assert.equal(await page.evaluate("document.activeElement === document.querySelector('#list [data-id=\"nucleus\"]')"), true);
  } finally {
    await page.close();
  }
});

for (const [W, H, layout] of [[900, 420, 'short'], [390, 800, 'narrow']]) {
  test(`測驗卡片遇到最長的答錯訊息（${W}×${H}，${layout}）：完整在視窗內、不蓋工具列、文字不被裁掉`, async () => {
    const page = await open(W, H);
    try {
      await startAndSettle(page);
      await clickCenter(page, '#btn-quiz');
      await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
      await sleep(500);
      await page.evaluate(`(() => {
        const r = document.getElementById('quiz-result');
        r.dataset.state = 'wrong';
        r.textContent = '答錯了，你點的是粗糙內質網（扁囊狀）。發亮的才是平滑內質網（管狀）。';
      })()`);
      await frames(page);
      const card = await info(page, '#quiz');
      assert.ok(card.shown && inside(card, W, H), `測驗卡片應完整在視窗內：${JSON.stringify(card)}`);
      assert.equal(overlaps(card, await info(page, '#toolbar')), false, '不與工具列重疊');
      const fit = await page.evaluate("(() => { const r = document.getElementById('quiz-result'); return { sw: r.scrollWidth, cw: r.clientWidth, sh: r.scrollHeight, ch: r.clientHeight }; })()");
      assert.ok(fit.sw <= fit.cw, `答錯訊息不可橫向被裁掉：${JSON.stringify(fit)}`);
      // 卡片內所有子元素都在卡片的矩形內（不被裁、不溢出）
      const kids = await page.evaluate(`[...document.querySelectorAll('#quiz > *')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })`);
      for (const k of kids) assert.ok(k.left >= card.left - 1 && k.right <= card.right + 1 && k.top >= card.top - 1 && k.bottom <= card.bottom + 1, `#${k.id} 應在卡片內：${JSON.stringify([k, card])}`);
      await page.screenshot(`assets/preview/web-quiz-longest-${layout}.png`);
    } finally {
      await page.close();
    }
  });
}

test('成品全文不含禁用詞', () => {
  const html = readFileSync('dist/plant-cell.html', 'utf8');
  for (const w of FORBIDDEN_WORDS) assert.ok(!html.includes(w), `成品含禁用詞：${w}`);
});
