// 最終審查後的修正輪（F1–F8）的端對端測試。輔助函式照抄既有的 e2e 檔（這個專案的慣例）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';

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
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
    await page.waitFor('!window.__cell.cameraBusy()', 5000);
  } catch (e) { await page.close(); throw e; }
  return page;
}
const clickSel = async (page, sel) => { const p = await center(page, sel); await page.click(p.x, p.y); };
const clickList = (page, id) => clickSel(page, `#list [data-id="${id}"]`);
const frames = (page, n = 2) => page.evaluate(`new Promise((res) => { let n = ${n}; const f = () => (--n <= 0 ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const settleCamera = (page) => page.waitFor('!window.__cell.cameraBusy()', 5000);
const rectOf = (page, sel) => page.evaluate(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
})()`);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const labelInfo = (page) => page.evaluate(`[...document.querySelectorAll('#labels [data-id]')].map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.dataset.id, text: el.textContent, shown: el.getClientRects().length > 0,
    w: el.offsetWidth, h: el.offsetHeight, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
})`);
const assertNoOverlap = (labels, msg) => {
  const shown = labels.filter((l) => l.shown);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    assert.equal(overlaps(shown[i], shown[j]), false, `${msg}：標籤「${shown[i].text}」與「${shown[j].text}」重疊`);
  }
};

// ---- F1：名稱標籤開著時切換語言 ----
for (const [W, H, mode] of [[900, 420, 'short'], [390, 800, 'narrow']]) {
  test(`F1 名稱標籤開著時切換語言：重新量寬、不重疊（${mode} ${W}×${H}）`, async () => {
    const page = await boot({ width: W, height: H });
    try {
      await settleCamera(page);
      await clickSel(page, '#btn-labels');
      await frames(page, 3);
      const check = async (msg) => {
        await frames(page, 3);
        const labels = await labelInfo(page);
        assert.ok(labels.some((l) => l.shown), `${msg}：應有可見標籤`);
        for (const l of labels.filter((x) => x.shown)) {
          assert.ok(l.w > 0 && l.h > 0, `${msg}：標籤「${l.text}」量到 ${l.w}×${l.h}`);
        }
        assertNoOverlap(labels, msg);
      };
      await check('中文');
      await clickSel(page, '#toolbar [data-lang="en"]');
      await check('中→英');
      if (mode === 'short') await page.screenshot('assets/preview/web-fix-short-labels-en.png');
      await clickSel(page, '#toolbar [data-lang="zh"]');
      await check('英→中');
    } finally {
      await page.close();
    }
  });
}
