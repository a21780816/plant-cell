import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { ORGANELLES, ORGANELLE_IDS } from '../../web/src/organelles.js';

const zh = (id) => ORGANELLES.find((o) => o.id === id).zh;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";

async function boot() {
  const page = await openPage('dist/plant-cell.html', { offline: true });
  try {
    await page.waitFor(READY);
    const failure = await page.evaluate('document.documentElement.dataset.cellError || ""');
    assert.equal(failure, '', `檢視器啟動失敗：${failure}`);
  } catch (e) { await page.close(); throw e; }
  return page;
}

const selected = (page) => page.evaluate('window.__cell.store.getState().selected');
const text = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const settle = async (page) => {
  await page.waitFor('!window.__cell.cameraBusy()', 5000);
  await sleep(600); // 等 0.25 秒的發亮與變暗漸變收斂
};
const pointOf = async (page, id) => {
  const p = await page.evaluate(`window.__cell.screenPointOf(${JSON.stringify(id)})`);
  assert.ok(p, `畫面上找不到可以點到 ${id} 的位置`);
  return p;
};
const listBtn = (page, id) => page.evaluate(`(() => {
  const r = document.querySelector('#list [data-id="${id}"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const clickList = async (page, id) => { const p = await listBtn(page, id); await page.click(p.x, p.y); };
const camPos = (page) => page.evaluate('window.__cell.view.camera.position.toArray()');

test('選取、發亮、面板與清單', async () => {
  const page = await boot();
  try {
    // 滑過：名稱與手指游標
    const nuc = await pointOf(page, 'nucleus');
    await page.mouseMove(nuc.x, nuc.y);
    await page.waitFor(`document.getElementById('hover-name').textContent === ${JSON.stringify(zh('nucleus'))} && !document.getElementById('hover-name').hidden`);
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('stage')).cursor"), 'pointer');
    assert.equal(await page.evaluate("window.__cell.store.getState().hovered.id"), 'nucleus');

    // 點細胞核
    await page.click(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    assert.equal(await text(page, '#panel-title'), zh('nucleus'));
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), false);
    await settle(page);
    await page.screenshot('assets/preview/web-selected.png');

    // 縮放視窗不可把鏡頭拉回預設
    const before = await camPos(page);
    await page.evaluate("window.dispatchEvent(new Event('resize'))");
    await sleep(200);
    assert.deepEqual(await camPos(page), before, 'resize 不應改動被選取後的鏡頭');

    // 取消選取後回到預設，再點粒線體（個體）
    await page.click(...Object.values(await page.evaluate("(() => { const r = document.getElementById('panel-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")));
    await page.waitFor('window.__cell.store.getState().selected === null');
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), true, '按關閉鈕會取消選取並隱藏面板');
    await settle(page);
    const mito = await pointOf(page, 'mitochondrion');
    await page.click(mito.x, mito.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'mitochondrion'");
    const sel = await selected(page);
    assert.notEqual(sel.inst, null);
    assert.equal(await text(page, '#panel-title'), zh('mitochondrion'));
    await settle(page);
    await page.screenshot('assets/preview/web-selected-multi.png');
    // 被點的個體最亮、同類其他個體次之、其他構造變暗
    const glow = await page.evaluate(`(() => {
      const { index, store } = window.__cell;
      const s = store.getState().selected;
      const ei = (m) => m.material.emissiveIntensity;
      const mine = index.byId.get('mitochondrion').meshes.filter((m) => m.parent && (() => { for (let o = m; o; o = o.parent) if (o.userData.inst === s.inst && o.userData.organelle === 'mitochondrion') return true; return false; })());
      const others = index.byId.get('mitochondrion').meshes.filter((m) => !mine.includes(m));
      const nuc = index.byId.get('nucleus').meshes[0];
      return { mine: Math.min(...mine.map(ei)), others: Math.max(...others.map(ei)), nucFade: nuc.material.color.getHex() };
    })()`);
    assert.ok(glow.mine > glow.others + 0.1, `被選個體應比同類其他個體亮：${JSON.stringify(glow)}`);

    // 從清單選核糖體（不可點選的構造）
    await clickList(page, 'ribosome');
    await page.waitFor(`document.getElementById('panel-title').textContent === ${JSON.stringify(zh('ribosome'))}`);
    assert.equal((await selected(page)).inst, null);

    // 立刻連點兩項，以後者為準；鏡頭 3 秒內停止
    await clickList(page, 'chloroplast');
    await clickList(page, 'mitochondrion');
    await page.waitFor(`document.getElementById('panel-title').textContent === ${JSON.stringify(zh('mitochondrion'))}`);
    assert.equal((await selected(page)).id, 'mitochondrion');
    await page.waitFor('!window.__cell.cameraBusy()', 3000);
    await settle(page);

    // 拖曳不改變選取
    const keep = await selected(page);
    await page.drag(640, 400, 800, 400);
    assert.deepEqual(await selected(page), keep);

    // 點空白處取消選取（先把鏡頭拉遠到一定有空白處，再在網格上找一個射線打不到任何東西的點）
    await page.evaluate(`(() => {
      const { camera, controls } = window.__cell.view;
      camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).setLength(32));
      controls.update();
    })()`);
    await sleep(300);
    const blank = await page.evaluate(`(() => {
      for (let y = 12; y < innerHeight - 12; y += 40) for (let x = 12; x < innerWidth - 12; x += 40) {
        if (document.elementFromPoint(x, y)?.id === 'stage' && !window.__cell.hitAt(x, y)) return { x, y };
      }
      return null;
    })()`);
    assert.ok(blank, '拉遠後應該有空白處');
    await page.click(blank.x, blank.y);
    await page.waitFor('window.__cell.store.getState().selected === null');
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), true);
    await settle(page);

    // 從清單選皮層微管：整個構造發亮
    await clickList(page, 'microtubule');
    await page.waitFor("document.getElementById('panel-title').textContent.length > 0 && window.__cell.store.getState().selected?.id === 'microtubule'");
    await settle(page);
    const mt = await page.evaluate(`(() => {
      const e = window.__cell.index.byId.get('microtubule');
      return { n: e.instances.length, lit: e.meshes.every((m) => m.material.emissiveIntensity > 0.15) };
    })()`);
    assert.ok(mt.n >= 1); // 16 條微管合併在同一個網格裡，整個網格亮就是全部亮
    assert.ok(mt.lit, '同 id 的所有個體都應發亮');
    await page.screenshot('assets/preview/web-selected-list.png');

    // 逐一點清單 20 個按鈕：標題與內文與資料一致
    for (const o of ORGANELLES) {
      await clickList(page, o.id);
      await page.waitFor(`window.__cell.store.getState().selected?.id === ${JSON.stringify(o.id)}`);
      assert.equal(await text(page, '#panel-title'), o.zh, `${o.id} 標題`);
      assert.equal(await text(page, '#panel-body'), o.body, `${o.id} 內文`);
      assert.equal(await page.evaluate("document.getElementById('panel-fact').hidden"), o.fact == null, `${o.id} 你知道嗎`);
      assert.equal(await page.evaluate(`document.querySelector('#list [data-id="${o.id}"]').classList.contains('active')`), true);
    }
    assert.equal(await page.evaluate("document.querySelectorAll('#list button').length"), 20);
    assert.equal(await text(page, '#list-title'), '細胞構造');

    // 一致性：模型裡的 id 與介紹資料的 id 完全相同
    const s = await page.evaluate('window.__cell.stats()');
    assert.deepEqual([...s.ids].sort(), [...ORGANELLE_IDS].sort());

    assert.deepEqual(page.consoleErrors, []);
    assert.deepEqual(page.consoleWarnings.filter((w) => !w.startsWith('[materials]')), []);
    assert.equal(page.requests.filter((u) => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')).length, 0);
  } finally {
    await page.close();
  }
});

test('觸控輕點可選取', async () => {
  const page = await boot();
  try {
    const nuc = await pointOf(page, 'nucleus');
    await page.tap(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    assert.equal(await text(page, '#panel-title'), zh('nucleus'));
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});
