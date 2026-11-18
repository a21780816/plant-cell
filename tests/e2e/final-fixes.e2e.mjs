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

// ---- F2：窄螢幕 360×740，工具列不壓到取景範圍 ----
// 本細胞的壁（不含相鄰細胞）在「蓋子還蓋著」時的頂點：開場時蒐集，之後用目前的鏡頭投影（做法同 layout-en.e2e.mjs 的 E1）
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
  return { left: l, right: rt, top: t, bottom: b };
})()`;
const toolbarState = (page) => page.evaluate(`(() => {
  const tb = document.getElementById('toolbar');
  const r = tb.getBoundingClientRect();
  const tops = [...new Set([...tb.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top)))];
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, tops, sw: tb.scrollWidth, cw: tb.clientWidth, rect: window.__cell.layout().rect };
})()`);

for (const lang of ['zh', 'en']) {
  test(`F2 窄螢幕 360×740（${lang === 'zh' ? '中文' : '英文'}）：工具列不壓到取景範圍`, async () => {
    const W = 360, H = 740;
    const page = await open({ width: W, height: H, ...(lang === 'en' ? { initScript: EN_INIT } : {}) });
    try {
      assert.ok((await page.evaluate(COLLECT_WALL)) > 50, '應取得本細胞的壁的頂點');
      const b = await center(page, '#intro-start');
      await page.click(b.x, b.y);
      await page.waitFor('window.__cell.lidOpen() === true');
      await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
      await settleCamera(page);
      await sleep(500);
      const check = async (msg) => {
        await frames(page, 3);
        const s = await toolbarState(page);
        console.log(`F2 ${lang} ${msg} ${JSON.stringify(s)}`);
        if (lang === 'zh') assert.equal(s.tops.length, 1, `${msg}：中文工具列應只有一列：${s.tops}`);
        assert.ok(s.bottom <= s.rect.top + 0.5, `${msg}：工具列下緣 ${s.bottom} 應在可用範圍上緣 ${s.rect.top} 之上`);
        assert.ok(s.left >= -0.5 && s.top >= -0.5 && s.right <= W + 0.5 && s.bottom <= H + 0.5, `${msg}：工具列應完整在視窗內：${JSON.stringify(s)}`);
        if (lang === 'en') assert.ok(s.sw <= s.cw, `${msg}：工具列內容被截斷 ${s.sw} > ${s.cw}`);
        return s;
      };
      await check('start 之後');
      const wall = await page.evaluate(WALL_BOUNDS);
      const rect = (await toolbarState(page)).rect;
      assert.ok(wall.left >= rect.left - 1 && wall.right <= rect.right + 1 && wall.top >= rect.top - 1 && wall.bottom <= rect.bottom + 1, `壁應在可用範圍內：${JSON.stringify([wall, rect])}`);
      if (lang === 'zh') await page.screenshot('assets/preview/web-fix-360-zh.png');
      await clickSel(page, '#btn-explode');
      await page.waitFor('window.__cell.explodeProgress() === 1');
      await settleCamera(page);
      await check('按過拆解');
      await clickSel(page, '#btn-labels');
      await settleCamera(page);
      await check('顯示名稱');
      assert.deepEqual(page.consoleErrors, []);
    } finally {
      await page.close();
    }
  });
}

// ---- F3：寬 720–840px 的 wide／short 版面，有選取時面板不蓋住工具列 ----
async function selectNucleus(page) {
  await page.evaluate(`document.querySelector('#list [data-id="nucleus"]').scrollIntoView({ block: 'nearest', inline: 'center' })`);
  await clickList(page, 'nucleus');
  await page.waitFor("!document.getElementById('panel').hidden", 3000);
  await settleCamera(page);
  await sleep(500);
}
const F3_CASES = [[768, 1024, 'zh'], [768, 1024, 'en'], [720, 500, 'en']];
for (const [W, H, lang] of F3_CASES) {
  test(`F3 平板寬度有選取時，面板不蓋住工具列（${W}×${H} ${lang}）`, async () => {
    const page = await boot({ width: W, height: H, ...(lang === 'en' ? { initScript: EN_INIT } : {}) });
    try {
      await selectNucleus(page);
      const tb = await rectOf(page, '#toolbar');
      const pn = await rectOf(page, '#panel');
      console.log(`F3 ${W}×${H} ${lang} toolbar ${JSON.stringify(tb)} panel ${JSON.stringify(pn)}`);
      assert.equal(overlaps(tb, pn), false, `#panel 與 #toolbar 不應重疊：${JSON.stringify([tb, pn])}`);
      const hits = await page.evaluate(`[...document.querySelectorAll('#toolbar button')].map((b) => {
        const r = b.getBoundingClientRect();
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: b.textContent, ok: e === b || b.contains(e) };
      })`);
      assert.ok(hits.length >= 5, `工具列應有 5 顆按鈕（拆解、名稱、測驗、兩顆語言）：${hits.length}`);
      for (const h of hits) assert.equal(h.ok, true, `工具列按鈕「${h.text}」中心被別的元素蓋住`);
      assert.ok(pn.left >= -0.5 && pn.top >= -0.5 && pn.right <= W + 0.5 && pn.bottom <= H + 0.5, `#panel 應完整在視窗內：${JSON.stringify(pn)}`);
      const scrolled = await page.evaluate(`(() => {
        const p = document.getElementById('panel');
        p.scrollTop = p.scrollHeight;
        const kids = [...p.children].filter((c) => c.getClientRects().length > 0);
        const last = kids[kids.length - 1].getBoundingClientRect();
        return { lastBottom: last.bottom, panelBottom: p.getBoundingClientRect().bottom };
      })()`);
      assert.ok(scrolled.lastBottom <= scrolled.panelBottom + 1, `面板內容應捲得到底：${JSON.stringify(scrolled)}`);
      const c = await page.evaluate('window.__cell.callout()');
      if (c.visible) {
        assert.ok(Math.abs(c.x1 - pn.left) <= 1 && c.y1 >= pn.top - 1 && c.y1 <= pn.bottom + 1, `引線起點應在面板邊緣：${JSON.stringify([c, pn])}`);
      } else {
        // 768 寬英文：取景中心（視窗中線）剛好落在 380px 的面板邊緣，細胞核在面板底下 2 像素處，引線依規則不畫（目標在面板內）；其餘情況一定要畫
        const rep = await page.evaluate("window.__cell.repScreenPoint('nucleus')");
        assert.ok(rep.x >= pn.left - 1 && rep.x <= pn.right && rep.y >= pn.top && rep.y <= pn.bottom, `引線沒畫時，目標應在面板內：${JSON.stringify([rep, pn])}`);
      }
      if (W === 768 && lang === 'en') await page.screenshot('assets/preview/web-fix-768-en.png');
      assert.deepEqual(page.consoleErrors, []);
    } finally {
      await page.close();
    }
  });
}
test('F3 1280×800 中文與英文選取後，面板的 top 仍是 16', async () => {
  for (const lang of ['zh', 'en']) {
    const page = await boot({ width: 1280, height: 800, ...(lang === 'en' ? { initScript: EN_INIT } : {}) });
    try {
      await selectNucleus(page);
      const pn = await rectOf(page, '#panel');
      assert.equal(pn.top, 16, `${lang}：面板 top 應為 16：${pn.top}`);
    } finally {
      await page.close();
    }
  }
});
