import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { ORGANELLES, ORGANELLE_IDS } from '../../web/src/organelles.js';
import { GHOST_IDS, ghostOrderOf } from '../../web/src/config.js';

const zh = (id) => ORGANELLES.find((o) => o.id === id).zh;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";

async function boot() {
  const page = await openPage('dist/plant-cell.html', { offline: true });
  try {
    await page.waitFor(READY);
    const failure = await page.evaluate('document.documentElement.dataset.cellError || ""');
    assert.equal(failure, '', `檢視器啟動失敗：${failure}`);
    const b = await page.evaluate("(() => { const r = document.getElementById('intro-start').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await page.click(b.x, b.y);
    await page.waitFor('window.__cell.lidOpen() === true');
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
// 材質與網格狀態的快照；載入完成時記下，之後用來檢查「取消選取後完全還原」。
const SNAP_JS = `(() => {
  const take = () => [...window.__cell.index.byId.values()].flatMap((e) => e.meshes).map((m) => ({
    n: m.name, t: m.material.transparent, d: m.material.depthWrite, o: m.material.opacity, r: m.renderOrder,
    c: m.material.color.toArray(), ec: m.material.emissive.toArray(), e: m.material.emissiveIntensity, s: m.castShadow,
  }));
  window.__snapDiffs = () => {
    const a = window.__snap0, b = take(), out = [];
    a.forEach((x, i) => {
      const y = b[i];
      for (const k of Object.keys(x)) {
        const xs = [].concat(x[k]), ys = [].concat(y[k]);
        if (xs.some((v, j) => (typeof v === 'number' ? Math.abs(v - ys[j]) > 1e-6 : v !== ys[j]))) out.push(x.n + '.' + k + ' ' + xs + ' -> ' + ys);
      }
    });
    return out;
  };
  window.__snap0 = take();
})()`;
const gridIds = (page) => page.evaluate(`(() => {
  const ids = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) {
    const h = window.__cell.hitAt((i + 0.5) * innerWidth / 12, (j + 0.5) * innerHeight / 8);
    if (h) ids.push(h.id);
  }
  return ids;
})()`);
const camState = (page) => page.evaluate(`(() => {
  const { camera, controls } = window.__cell.view;
  return [...camera.position.toArray(), ...controls.target.toArray(), controls.maxDistance, camera.far];
})()`);
const setInnerWidth = (page, w) => page.evaluate(`(() => {
  Object.defineProperty(window, 'innerWidth', { value: ${w}, configurable: true });
  window.dispatchEvent(new Event('resize'));
})()`);
const camPos = (page) => page.evaluate('window.__cell.view.camera.position.toArray()');

test('選取、發亮、面板與清單', async () => {
  const page = await boot();
  try {
    await page.evaluate(SNAP_JS);
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

    // 變暗、殘影與射線穿透（漸變收斂後）
    const dim = await page.evaluate(`(() => {
      const { index } = window.__cell;
      const snap = window.__snap0;
      const meshes = [...index.byId.values()].flatMap((e) => e.meshes);
      const dimHex = 0xD8D2C4;
      const dist = (hex) => [16, 8, 0].reduce((s, sh) => s + Math.abs(((hex >> sh) & 255) - ((dimHex >> sh) & 255)), 0);
      const underLid = (m) => { for (let o = m; o; o = o.parent) if (o.userData.lid === 1) return true; return false; };
      const ghosts = meshes.filter((m) => !underLid(m) && (${JSON.stringify(GHOST_IDS)}.includes(m.userData.organelle) || m.parent && ${JSON.stringify(GHOST_IDS)}.includes(m.parent.userData.organelle)))
        .map((m) => { const i = meshes.indexOf(m); return { n: m.name, id: m.userData.organelle, part: m.userData.part, t: m.material.transparent, d: m.material.depthWrite, o: m.material.opacity, r: m.renderOrder, base: snap[i].o }; });
      const chloro = index.byId.get('chloroplast').meshes.map((m) => ({ now: dist(m.material.color.getHex()), was: dist(m.material.color.clone().fromArray(snap[meshes.indexOf(m)].c).getHex()) }));
      const sel = index.byId.get('nucleus').meshes.map((m) => m.material.emissiveIntensity);
      const others = meshes.filter((m) => !underLid(m) && !index.byId.get('nucleus').meshes.includes(m)).map((m) => m.material.emissiveIntensity);
      return { ghosts, chloro, selMin: Math.min(...sel), othersMax: Math.max(...others) };
    })()`);
    assert.ok(dim.ghosts.length >= 8, '應找到所有外殼網格（蓋子底下的網格不受發亮管理，不計）');
    for (const g of dim.ghosts) {
      const expected = ghostOrderOf(g.id, { userData: { part: g.part }, name: g.n });
      assert.equal(g.t, true, `${g.n} 應為半透明`);
      assert.equal(g.d, false, `${g.n} 不寫深度`);
      assert.ok(g.o <= 0.15 + 1e-9 && g.o <= g.base + 1e-9, `${g.n} 不透明度 ${g.o}`);
      assert.equal(g.r, expected, `${g.n} 的繪製順序`);
      assert.notEqual(g.r, 0);
    }
    for (const c of dim.chloro) assert.ok(c.now < c.was * 0.6, `葉綠體應往背景色靠近：${JSON.stringify(c)}`);
    assert.ok(dim.selMin > 0.38 && dim.selMin > dim.othersMax, `被選個體應比其他任何構造亮：${JSON.stringify(dim)}`);
    assert.equal((await gridIds(page)).filter((id) => GHOST_IDS.includes(id)).length, 0, '殘影外殼不可擋住射線');

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
    assert.ok((await gridIds(page)).includes('cell_wall'), '取消選取後外殼可被點到（證明上一個格點斷言有鑑別力）');
    assert.deepEqual(await page.evaluate('window.__snapDiffs()'), [], '取消選取後材質應完全還原');
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
    await settle(page);
    assert.deepEqual(await page.evaluate('window.__snapDiffs()'), [], '點空白取消後材質也應完全還原');
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), true);

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

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('回到預設位置後的鏡頭與 view.frame(box) 的結果一致', async () => {
  const page = await boot();
  try {
    await clickList(page, 'nucleus');
    await page.waitFor('window.__cell.cameraBusy()');
    await settle(page);
    await page.click(...Object.values(await page.evaluate("(() => { const r = document.getElementById('panel-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")));
    await settle(page);
    const before = await camState(page);
    await page.evaluate('window.__cell.frameCurrent()');
    assert.ok(near(before, await camState(page)), '回到預設後的鏡頭設定應與 frame() 相同');
  } finally {
    await page.close();
  }
});

test('動畫中途縮放視窗：靠近動畫停在被選構造，回到預設動畫結束後完整套用', async () => {
  const page = await boot();
  try {
    // 靠近動畫進行到一半時縮放
    await clickList(page, 'nucleus');
    await page.waitFor('window.__cell.cameraBusy()');
    await sleep(150);
    assert.equal(await page.evaluate('window.__cell.cameraBusy()'), true, '縮放時動畫應仍在進行');
    await setInnerWidth(page, 760);
    await settle(page);
    const off = await page.evaluate(`(() => {
      const { controls } = window.__cell.view;
      const a = window.__cell.index.byId.get('nucleus').anchor;
      return controls.target.distanceTo(a.getWorldPosition(controls.target.clone()));
    })()`);
    assert.ok(off < 1e-3, `動畫結束後鏡頭應停在被選構造，目標點偏差 ${off}`);
    await setInnerWidth(page, 760); // 靜止後再縮放也不可拉回預設
    await sleep(200);
    assert.ok((await page.evaluate(`(() => { const { controls } = window.__cell.view; const a = window.__cell.index.byId.get('nucleus').anchor; return controls.target.distanceTo(a.getWorldPosition(controls.target.clone())); })()`)) < 1e-3);

    // 回到預設的動畫進行到一半時縮放（變窄使預設距離變大）
    await page.click(...Object.values(await page.evaluate("(() => { const r = document.getElementById('panel-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")));
    await page.waitFor('window.__cell.cameraBusy()');
    await sleep(150);
    await setInnerWidth(page, 420);
    await settle(page);
    const after = await camState(page);
    await page.evaluate('window.__cell.frameCurrent()');
    assert.ok(near(after, await camState(page)), '動畫中途縮放後，結束時的鏡頭、maxDistance、far 應與 frame() 相同');
  } finally {
    await page.close();
  }
});

test('鏡頭在動而游標不動時，滑過狀態跟著重算；拖曳中隱藏名稱與手指游標', async () => {
  const page = await boot();
  try {
    const nuc = await pointOf(page, 'nucleus');
    await page.mouseMove(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().hovered?.id === 'nucleus' && !document.getElementById('hover-name').hidden");
    // 程式移動鏡頭（游標不動）：滑過狀態必須等於游標底下實際打到的東西
    await page.evaluate(`(() => {
      const { camera, controls } = window.__cell.view;
      camera.position.copy(controls.target).add({ x: 0.3, y: 36, z: 0.3 });
      controls.update();
    })()`);
    await page.waitFor(`(() => {
      const h = window.__cell.hitAt(${nuc.x}, ${nuc.y});
      const s = window.__cell.store.getState().hovered;
      return (h ? h.id + ':' + h.inst : '') === (s ? s.id + ':' + s.inst : '');
    })()`);
    const truth = await page.evaluate(`window.__cell.hitAt(${nuc.x}, ${nuc.y})`);
    assert.notEqual(truth && truth.id, 'nucleus', '鏡頭移動後游標底下已經不是細胞核，這個斷言才有鑑別力');
    assert.equal(await page.evaluate("document.getElementById('hover-name').hidden"), truth === null);

    // 拖曳中：名稱標籤隱藏、游標不是手指
    await page.evaluate("window.__cell.view.frame(window.__cell.index.box)");
    await sleep(200);
    const p2 = await pointOf(page, 'nucleus');
    await page.mouseMove(p2.x, p2.y);
    await page.waitFor("!document.getElementById('hover-name').hidden");
    const drag = page.drag(p2.x, p2.y, p2.x + 160, p2.y + 20, 60);
    let done = false;
    drag.then(() => { done = true; });
    const samples = [];
    await sleep(80);
    while (!done && samples.length < 25) {
      samples.push(await page.evaluate("[document.getElementById('hover-name').hidden, getComputedStyle(document.getElementById('stage')).cursor]"));
      await sleep(25);
    }
    await drag;
    assert.ok(samples.length >= 5, '應該在拖曳中取到樣本');
    for (const [hidden, cursor] of samples) {
      assert.equal(hidden, true, '拖曳中名稱標籤應隱藏');
      assert.notEqual(cursor, 'pointer');
    }
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('拖曳放開後游標不動，滑過狀態與名稱標籤等於放開位置底下的構造', async () => {
  const page = await boot();
  try {
    await clickList(page, 'mitochondrion');
    await settle(page);
    const mito = await pointOf(page, 'mitochondrion');
    await page.mouseMove(mito.x, mito.y);
    await page.waitFor("window.__cell.store.getState().hovered?.id === 'mitochondrion' && !document.getElementById('hover-name').hidden");
    // 在另一個構造上按下、拖曳、放開並保持不動（起點底下有構造，放開位置底下是別的東西或空白）
    const start = await page.evaluate(`(() => {
      for (let y = 40; y < innerHeight - 200; y += 20) for (let x = 40; x < innerWidth - 450; x += 20) {
        if (Math.hypot(x - ${mito.x}, y - ${mito.y}) < 100 || !window.__cell.hitAt(x, y)) continue;
        if (document.elementFromPoint(x, y) !== document.getElementById('stage') || document.elementFromPoint(x + 50, y) !== document.getElementById('stage')) continue; // 被介面蓋住的點不能拖曳
        if ((window.__cell.hitAt(x + 50, y) || {}).id === window.__cell.hitAt(x, y).id) continue; // 放開位置要有機會是別的構造，這個測試才有鑑別力
        return { x, y, id: window.__cell.hitAt(x, y).id };
      }
      return null;
    })()`);
    assert.ok(start, '應找到起點有構造的拖曳');
    await page.drag(start.x, start.y, start.x + 50, start.y);
    await settle(page);
    const truth = await page.evaluate(`window.__cell.hitAt(${start.x + 50}, ${start.y})`);
    assert.notEqual(truth && truth.id, start.id, '放開位置底下不是起點的構造，這個斷言才有鑑別力');
    const hovered = await page.evaluate('window.__cell.store.getState().hovered');
    assert.deepEqual(hovered, truth, `放開後 hovered 應等於游標底下的構造，實際 ${JSON.stringify(hovered)}`);
    assert.equal(await page.evaluate("document.getElementById('hover-name').hidden"), truth === null);
    if (truth === null) assert.notEqual(await page.evaluate("getComputedStyle(document.getElementById('stage')).cursor"), 'pointer');
  } finally {
    await page.close();
  }
});
