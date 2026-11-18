import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPage } from '../../scripts/cdp.mjs';
import { UI_TEXT, t, organelleName, LANG_KEY } from '../../web/src/i18n.js';
import { ORGANELLES_EN, INTRO_EN } from '../../web/src/organelles.en.js';
import { ORGANELLES, ORGANELLE_IDS, QUIZ_IDS, INTRO } from '../../web/src/organelles.js';

const zhOf = (id) => organelleName('zh', id);
const enOf = (id) => organelleName('en', id);
const CJK = /[　-〿㐀-鿿＀-￯]/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";
const EN_INIT = "try { localStorage.setItem('plant-cell-lang', 'en'); } catch {}";

async function open(options = {}) {
  const page = await openPage('dist/plant-cell.html', { offline: true, ...options });
  try {
    await page.waitFor(READY);
    const failure = await page.evaluate('document.documentElement.dataset.cellError || ""');
    assert.equal(failure, '', `檢視器啟動失敗：${failure}`);
  } catch (e) { await page.close(); throw e; }
  return page;
}
const center = (page, sel) => page.evaluate(`(() => {
  const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
async function boot(options = {}) {
  const page = await open(options);
  try {
    const b = await center(page, '#intro-start');
    await page.click(b.x, b.y);
    await page.waitFor('window.__cell.lidOpen() === true');
  } catch (e) { await page.close(); throw e; }
  return page;
}
const clickSel = async (page, sel) => { const p = await center(page, sel); await page.click(p.x, p.y); };
const clickList = (page, id) => clickSel(page, `#list [data-id="${id}"]`);
const frames = (page, n = 2) => page.evaluate(`new Promise((res) => { let n = ${n}; const f = () => (--n <= 0 ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const settleCamera = (page) => page.waitFor('!window.__cell.cameraBusy()', 5000);

const labelInfo = (page) => page.evaluate(`(() => {
  const gs = Object.fromEntries([...document.querySelectorAll('#labels g[data-for]')].map((g) => [g.dataset.for, g]));
  return [...document.querySelectorAll('#labels [data-id]')].map((el) => {
    const r = el.getBoundingClientRect();
    const g = gs[el.dataset.id];
    const shown = el.getClientRects().length > 0;
    const ln = g.querySelector('line');
    const dot = { x: Number(g.querySelector('circle').getAttribute('cx')), y: Number(g.querySelector('circle').getAttribute('cy')) };
    const leader = Math.hypot(Number(ln.getAttribute('x2')) - Number(ln.getAttribute('x1')), Number(ln.getAttribute('y2')) - Number(ln.getAttribute('y1')));
    return { id: el.dataset.id, text: el.textContent, shown, dotShown: g.getAttribute('visibility') === 'visible', dot, leader,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, selected: el.classList.contains('selected') };
  });
})()`);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const assertNoOverlap = (labels, msg) => {
  const shown = labels.filter((l) => l.shown);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    assert.equal(overlaps(shown[i], shown[j]), false, `${msg}：標籤「${shown[i].text}」與「${shown[j].text}」重疊`);
  }
};

const visible = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`);
const textOf = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const attrOf = (page, sel, name) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).getAttribute(${JSON.stringify(name)})`);
const quizId = (page) => page.evaluate('window.__cell.quizCurrentId()');
const progressText = (page) => textOf(page, '#quiz-progress');
const visibleOther = async (page, except, skip = []) => {
  for (const id of QUIZ_IDS) {
    if (id === except || skip.includes(id)) continue;
    const p = await page.evaluate(`window.__cell.screenPointOf(${JSON.stringify(id)})`);
    if (p) return { id, ...p };
  }
  throw new Error('畫面上找不到可點的構造');
};
const htmlLang = (page) => page.evaluate('document.documentElement.lang');
const state = (page) => page.evaluate('(() => { const s = window.__cell.store.getState(); return { lang: s.lang, phase: s.phase, selected: s.selected && s.selected.id, exploded: s.exploded, labels: s.labels }; })()');
const warnsOf = (page) => page.consoleWarnings.filter((w) => !w.startsWith('[materials]'));

test('L1 預設中文，不看瀏覽器語言與網址；開場卡片切到英文後開場文字、標題、html lang 改變，仍在開場階段', async () => {
  const url = `${pathToFileURL(resolve('dist/plant-cell.html')).href}?lang=en#en`;
  const page = await open_(url);
  try {
    assert.equal(await htmlLang(page), 'zh-Hant');
    assert.equal(await page.evaluate('document.title'), '植物細胞');
    const btns = () => page.evaluate(`[...document.querySelectorAll('#intro .lang-switch button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])`);
    assert.deepEqual(await btns(), [['中文', 'true'], ['English', 'false']]);
    // 無障礙分組：兩組語言切換鈕都有 role=group 與固定的 aria-label（不隨語言變）
    const groups = () => page.evaluate(`[...document.querySelectorAll('.lang-switch')].map((g) => [g.getAttribute('role'), g.getAttribute('aria-label')])`);
    assert.deepEqual(await groups(), [['group', '語言 / Language'], ['group', '語言 / Language']]);
    await clickSel(page, '#intro [data-lang="en"]');
    await frames(page, 3);
    assert.equal(await textOf(page, '#intro-title'), INTRO_EN.title);
    assert.equal(await textOf(page, '#intro-title'), 'Plant Cell');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#intro .intro-text')].map((p) => p.textContent)`), INTRO_EN.paragraphs);
    assert.equal(await textOf(page, '#intro-start'), 'Start exploring');
    assert.equal(await htmlLang(page), 'en');
    assert.equal(await page.evaluate('document.title'), 'Plant Cell');
    assert.equal(await textOf(page, '#loading'), 'Loading…');
    assert.equal(await page.evaluate('window.__cell.store.getState().lang'), 'en');
    assert.equal(await page.evaluate('window.__cell.store.getState().phase'), 'intro');
    assert.equal(await page.evaluate('window.__cell.lidOpen()'), false);
    assert.equal(await page.evaluate('document.activeElement.dataset.lang'), 'en');
    assert.deepEqual(await btns(), [['中文', 'false'], ['English', 'true']]);
    assert.deepEqual(await groups(), [['group', '語言 / Language'], ['group', '語言 / Language']]);
    await page.screenshot('assets/preview/web-lang-intro-en.png');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});
async function open_(url) {
  const page = await openPage(url, { offline: true });
  try {
    await page.waitFor(READY);
    const failure = await page.evaluate('document.documentElement.dataset.cellError || ""');
    assert.equal(failure, '', `檢視器啟動失敗：${failure}`);
  } catch (e) { await page.close(); throw e; }
  return page;
}

test('L2 英文模式下清單、工具列、面板、滑過名稱、名稱標籤、aria 都是英文，畫面上沒有中文；切回中文完全還原', async () => {
  const page = await boot();
  try {
    const listTexts = (attr) => page.evaluate(`[...document.querySelectorAll('#list button')].map((b) => ({ id: b.dataset.id, label: b.querySelector('.label').textContent, name: b.dataset.name, title: b.getAttribute('title') }))`);
    await clickSel(page, '#toolbar [data-lang="en"]');
    await frames(page, 3);
    assert.equal(await textOf(page, '#list-title'), 'Cell structures');
    let items = await listTexts();
    assert.equal(items.length, 20);
    for (const it of items) {
      assert.equal(it.label, enOf(it.id));
      assert.equal(it.name, enOf(it.id));
      assert.equal(it.title, enOf(it.id));
    }
    assert.equal(await attrOf(page, '#toolbar', 'aria-label'), 'View tools');
    assert.equal(await attrOf(page, '#quiz', 'aria-label'), 'Quiz');
    assert.deepEqual(await page.evaluate(`['#btn-explode', '#btn-labels', '#btn-quiz'].map((s) => document.querySelector(s).textContent)`), ['Explode', 'Show names', 'Quiz']);
    await clickSel(page, '#btn-explode');
    await clickSel(page, '#btn-labels');
    await frames(page, 3);
    assert.deepEqual(await page.evaluate(`['#btn-explode', '#btn-labels'].map((s) => document.querySelector(s).textContent)`), ['Assemble', 'Hide names']);
    // 還原成未拆解、未顯示名稱，接著測面板
    await clickSel(page, '#btn-labels');
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 0');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#toolbar .lang-switch button')].map((b) => [b.disabled, b.getAttribute('aria-pressed')])`), [[false, 'false'], [false, 'true']]);

    await clickList(page, 'nucleus');
    await settleCamera(page);
    await frames(page, 3);
    const E = ORGANELLES_EN.nucleus;
    assert.equal(await textOf(page, '#panel-title'), 'Nucleus (nuclear envelope)');
    assert.equal(await textOf(page, '#panel-tagline'), E.tagline);
    assert.equal(await textOf(page, '#panel-body'), E.body);
    assert.equal(await textOf(page, '.fact-text'), E.fact);
    assert.equal(await textOf(page, '.fact-label'), 'Did you know?');
    assert.equal(await attrOf(page, '#panel-close', 'aria-label'), 'Close description');
    assert.equal(await visible(page, '#panel-en'), false);

    const sp = await page.evaluate("window.__cell.screenPointOf('nucleus')");
    assert.ok(sp, '應有可點的細胞核');
    await page.mouseMove(sp.x, sp.y);
    await page.waitFor("!document.getElementById('hover-name').hidden");
    assert.equal(await textOf(page, '#hover-name'), enOf('nucleus'));
    await clickSel(page, '#btn-labels');
    await frames(page, 3);
    const labels = await labelInfo(page);
    const shown = labels.filter((l) => l.shown);
    assert.ok(shown.length >= 10, `可見藥丸 ${shown.length}`);
    for (const l of shown) assert.equal(l.text, enOf(l.id));
    assert.equal(CJK.test((await page.evaluate('document.body.innerText')).replaceAll('中文', '')), false, '英文模式畫面上不應有中文');
    await page.mouseMove(2, 400);
    await page.screenshot('assets/preview/web-lang-en-wide.png');

    // 切回中文
    await clickSel(page, '#toolbar [data-lang="zh"]');
    await frames(page, 3);
    assert.equal(await textOf(page, '#list-title'), '細胞構造');
    items = await listTexts();
    for (const it of items) {
      assert.equal(it.label, zhOf(it.id));
      assert.equal(it.name, zhOf(it.id));
      assert.equal(it.title, zhOf(it.id));
    }
    assert.equal(await attrOf(page, '#toolbar', 'aria-label'), '檢視工具');
    assert.equal(await attrOf(page, '#quiz', 'aria-label'), '測驗');
    assert.deepEqual(await page.evaluate(`['#btn-explode', '#btn-labels', '#btn-quiz'].map((s) => document.querySelector(s).textContent)`), ['拆解', '隱藏名稱', '測驗']);
    const O = ORGANELLES.find((o) => o.id === 'nucleus');
    assert.equal(await textOf(page, '#panel-title'), O.zh);
    assert.equal(await visible(page, '#panel-en'), true);
    assert.equal(await textOf(page, '#panel-en'), 'Nucleus (nuclear envelope)');
    assert.equal(await textOf(page, '#panel-tagline'), O.tagline);
    assert.equal(await textOf(page, '#panel-body'), O.body);
    assert.equal(await textOf(page, '.fact-text'), O.fact);
    assert.equal(await textOf(page, '.fact-label'), '你知道嗎');
    assert.equal(await attrOf(page, '#panel-close', 'aria-label'), '關閉介紹');
    for (const l of (await labelInfo(page)).filter((x) => x.shown)) assert.equal(l.text, zhOf(l.id));
    assert.equal(await htmlLang(page), 'zh-Hant');
    assert.equal(await page.evaluate('document.title'), '植物細胞');
    const bad = page.requests.filter((u) => !/^(file|data|blob):/.test(u));
    assert.deepEqual(bad, []);
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('L3 重新整理後記住選擇', async () => {
  const page = await open();
  try {
    await clickSel(page, '#intro [data-lang="en"]');
    assert.equal(await page.evaluate(`localStorage.getItem(${JSON.stringify(LANG_KEY)})`), 'en');
    await page.evaluate("document.documentElement.dataset.cellReady = ''; location.reload()");
    await page.waitFor(READY);
    assert.equal(await htmlLang(page), 'en');
    assert.equal(await textOf(page, '#intro-title'), 'Plant Cell');
    assert.equal(await page.evaluate('window.__cell.store.getState().lang'), 'en');
    await clickSel(page, '#intro [data-lang="zh"]');
    await page.evaluate("document.documentElement.dataset.cellReady = ''; location.reload()");
    await page.waitFor(READY);
    assert.equal(await htmlLang(page), 'zh-Hant');
    assert.equal(await textOf(page, '#intro-title'), '植物細胞');
  } finally {
    await page.close();
  }
});

test('L4 切換時選取、拆解、名稱顯示保留，名稱標籤重新排版不重疊', async () => {
  const page = await boot();
  try {
    await clickList(page, 'golgi');
    await settleCamera(page);
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1');
    await clickSel(page, '#btn-labels');
    await settleCamera(page);
    await frames(page, 3);
    const before = await state(page);
    assert.equal(before.selected, 'golgi');
    assert.equal(before.exploded, true);
    assert.equal(before.labels, true);
    await clickSel(page, '#toolbar [data-lang="en"]');
    await frames(page, 3);
    const after = await state(page);
    assert.deepEqual({ ...after, lang: 'zh' }, before);
    assert.equal(after.lang, 'en');
    assert.equal(await textOf(page, '#panel-title'), 'Golgi body');
    let labels = await labelInfo(page);
    let shown = labels.filter((l) => l.shown);
    assert.ok(shown.some((l) => l.id === 'golgi'), '選取的高基氏體標籤應可見'); // 選取後鏡頭拉近，其餘多半在畫面外
    for (const l of shown) assert.equal(l.text, enOf(l.id));
    assertNoOverlap(labels, '英文');
    await clickSel(page, '#toolbar [data-lang="zh"]');
    await frames(page, 3);
    assert.deepEqual(await state(page), { ...before });
    labels = await labelInfo(page);
    shown = labels.filter((l) => l.shown);
    for (const l of shown) assert.equal(l.text, zhOf(l.id));
    assertNoOverlap(labels, '中文');
  } finally {
    await page.close();
  }
});

test('L5 測驗進行中與揭曉中切換：題目與計時不受影響，總結文字跟著換', async () => {
  const page = await boot();
  try {
    await clickSel(page, '#btn-quiz');
    await page.waitFor('window.__cell.quizCurrentId() !== null');
    const id0 = await quizId(page);
    await clickSel(page, '#toolbar [data-lang="en"]');
    await frames(page, 3);
    assert.equal(await progressText(page), 'Question 1 of 10');
    assert.equal(await textOf(page, '#quiz-question'), `Find: ${enOf(id0)}`);
    assert.equal(await quizId(page), id0);
    assert.equal(await textOf(page, '#quiz-exit'), 'End quiz');
    assert.equal(await textOf(page, '#quiz-retry'), 'Play again');
    const other = await visibleOther(page, id0);
    await page.click(other.x, other.y);
    await page.waitFor('window.__cell.store.getState().quiz.reveal !== null');
    assert.equal(await textOf(page, '#quiz-result'), t('en', 'quizWrong', { picked: enOf(other.id), expected: enOf(id0) }));
    const reveal = await page.evaluate('JSON.stringify(window.__cell.store.getState().quiz.reveal)');
    await clickSel(page, '#toolbar [data-lang="zh"]');
    await frames(page, 2);
    assert.equal(await textOf(page, '#quiz-result'), t('zh', 'quizWrong', { picked: zhOf(other.id), expected: zhOf(id0) }));
    assert.equal(await page.evaluate('JSON.stringify(window.__cell.store.getState().quiz.reveal)'), reveal);
    await page.waitFor("document.getElementById('quiz-progress').textContent === '第 2 題／共 10 題'", 4000);
    await clickSel(page, '#toolbar [data-lang="en"]');
    await frames(page, 2);
    assert.equal(await progressText(page), 'Question 2 of 10');
    for (let i = 2; i <= 10; i++) {
      await page.waitFor(`document.getElementById('quiz-progress').textContent === 'Question ${i} of 10'`, 4000);
      const id = await quizId(page);
      const p = (await page.evaluate(`window.__cell.screenPointOf(${JSON.stringify(id)})`)) ?? (await visibleOther(page, id));
      await page.click(p.x, p.y);
      if (i < 10) await page.waitFor(`document.getElementById('quiz-progress').textContent === 'Question ${i + 1} of 10'`, 4000);
    }
    await page.waitFor("(() => { const s = document.getElementById('quiz-summary'); return s.getClientRects().length > 0 && s.textContent !== ''; })()", 4000);
    const summary = await textOf(page, '#quiz-summary');
    const m = /^You got (\d+) out of 10$/.exec(summary);
    assert.ok(m, summary);
    await clickSel(page, '#toolbar [data-lang="zh"]');
    await frames(page, 2);
    assert.equal(await textOf(page, '#quiz-summary'), `答對 ${m[1]}／10 題`);
    assert.equal(await textOf(page, '#quiz-retry'), '再玩一次');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('L6 localStorage 無法使用時以中文啟動、切換仍有效、沒有錯誤', async () => {
  const page = await open({
    initScript: "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });",
  });
  try {
    assert.equal(await page.evaluate("(() => { try { window.localStorage; return false; } catch { return true; } })()"), true, '前提：存取 localStorage 會丟錯');
    assert.equal(await htmlLang(page), 'zh-Hant');
    await clickSel(page, '#intro [data-lang="en"]');
    await frames(page, 2);
    assert.equal(await textOf(page, '#intro-title'), 'Plant Cell');
    await clickSel(page, '#intro-start');
    await page.waitFor('window.__cell.lidOpen() === true');
    await clickSel(page, '#toolbar [data-lang="zh"]');
    await frames(page, 2);
    assert.equal(await textOf(page, '#list-title'), '細胞構造');
    assert.equal(await htmlLang(page), 'zh-Hant');
    assert.deepEqual(page.consoleErrors, []);
    assert.deepEqual(warnsOf(page), []);
  } finally {
    await page.close();
  }
});

test('L7 記住英文時，WebGL 不可用與模型載入失敗的說明是英文', async () => {
  const cases = [
    ['fallback', 'HTMLCanvasElement.prototype.getContext = () => null'],
    ['loadFail', "TextDecoder.prototype.decode = function () { throw new Error('測試用：解析失敗'); };"],
  ];
  for (const [key, script] of cases) {
    const page = await openPage('dist/plant-cell.html', { offline: true, initScript: `${EN_INIT}\n${script}` });
    try {
      await page.waitFor(READY);
      assert.ok(await page.evaluate('document.documentElement.dataset.cellError'), 'dataset.cellError 應有值');
      assert.equal(await textOf(page, '#fallback'), UI_TEXT.en[key]);
      assert.equal(await htmlLang(page), 'en');
    } finally {
      await page.close();
    }
  }
});

test('L8 中文 narrow（390×800）：加了切換鈕的工具列仍是一列、不壓到取景範圍', async () => {
  const page = await boot({ width: 390, height: 800 });
  try {
    const measure = async (msg) => {
      const m = await page.evaluate(`(() => {
        const tb = document.getElementById('toolbar').getBoundingClientRect();
        return {
          tops: [...new Set([...document.querySelectorAll('#toolbar button')].map((b) => Math.round(b.getBoundingClientRect().top)))],
          bottom: tb.bottom, left: tb.left, right: tb.right, top: tb.top,
          rectTop: window.__cell.layout().rect.top, W: window.innerWidth, H: window.innerHeight,
        };
      })()`);
      assert.equal(m.tops.length, 1, `${msg}：工具列應只有一列，實際 top：${m.tops}`);
      assert.ok(m.bottom <= m.rectTop + 0.5, `${msg}：工具列下緣 ${m.bottom} 不可超過取景上緣 ${m.rectTop}`);
      assert.ok(m.left >= 0 && m.top >= 0 && m.right <= m.W && m.bottom <= m.H, `${msg}：工具列需完整在視窗內`);
    };
    await measure('start 後');
    await clickSel(page, '#btn-explode');
    await clickSel(page, '#btn-labels');
    await frames(page, 3);
    await measure('拆解且顯示名稱後');
  } finally {
    await page.close();
  }
});
