import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { ORGANELLES, ORGANELLE_IDS } from '../../web/src/organelles.js';

const zh = (id) => ORGANELLES.find((o) => o.id === id).zh;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";
const SIX = ['nucleus', 'golgi', 'chloroplast', 'mitochondrion', 'peroxisome', 'vacuole'];

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
async function boot() {
  const page = await open();
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
const progress = (page) => page.evaluate('window.__cell.explodeProgress()');
const selected = (page) => page.evaluate('window.__cell.store.getState().selected');
const pressed = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-pressed')`);

const getPose = (page) => page.evaluate(`(() => {
  const { camera, controls } = window.__cell.view;
  return { p: camera.position.toArray(), t: controls.target.toArray() };
})()`);
// 暫時把鏡頭放到指定位置（不經過鏡頭動畫）。呼叫後要自己 setPose 還原。
const setPose = (page, pose) => page.evaluate(`(() => {
  const { camera, controls } = window.__cell.view;
  camera.position.fromArray(${JSON.stringify(pose.p)});
  controls.target.fromArray(${JSON.stringify(pose.t)});
  controls.update();
  camera.updateMatrixWorld();
})()`);
// 在指定鏡頭位置下（同一個同步區塊內設定、量測、還原）量測 ids 的代表個體畫面位置
const repPoints = (page, pose, ids) => page.evaluate(`(() => {
  const { camera, controls } = window.__cell.view;
  const keep = { p: camera.position.clone(), t: controls.target.clone() };
  camera.position.fromArray(${JSON.stringify(pose.p)});
  controls.target.fromArray(${JSON.stringify(pose.t)});
  controls.update();
  const out = {};
  for (const id of ${JSON.stringify(ids)}) out[id] = window.__cell.repScreenPoint(id);
  camera.position.copy(keep.p);
  controls.target.copy(keep.t);
  controls.update();
  return out;
})()`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pairDistances = (pts, ids) => {
  const out = {};
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out[`${ids[i]}-${ids[j]}`] = dist(pts[ids[i]], pts[ids[j]]);
  return out;
};
// 個體根的世界座標（id 的第 inst 個個體）
const rootPos = (page, id, inst) => page.evaluate(`(() => {
  const r = window.__cell.index.byId.get(${JSON.stringify(id)}).instances.find((x) => x.userData.inst === ${inst});
  return r.getWorldPosition(window.__cell.view.camera.position.clone()).toArray();
})()`);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const nearArr = (a, b, tol, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${msg} [${i}] ${v} vs ${b[i]}`));
// 整個模型的外框（各個體根的世界外框聯集）八個角投影後的螢幕座標（NDC）
const cornersNdc = (page) => page.evaluate(`(() => {
  const { index, view } = window.__cell;
  view.scene.updateMatrixWorld(true);
  const Box = index.box.constructor;
  const box = new Box();
  for (const e of index.byId.values()) for (const r of e.instances) box.union(new Box().setFromObject(r));
  view.camera.updateMatrixWorld();
  const out = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = view.camera.position.clone().set(x, y, z).project(view.camera);
    out.push([v.x, v.y, v.z]);
  }
  return { out, center: box.getCenter(view.camera.position.clone()).toArray() };
})()`);
const camDist = (page) => page.evaluate(`(() => { const { camera, controls } = window.__cell.view; return camera.position.distanceTo(controls.target); })()`);

const labelInfo = (page) => page.evaluate(`[...document.querySelectorAll('#labels [data-id]')].map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.dataset.id, text: el.textContent, shown: el.getClientRects().length > 0, left: r.left, top: r.top, right: r.right, bottom: r.bottom, selected: el.classList.contains('selected') };
})`);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const assertNoOverlap = (labels, msg) => {
  const shown = labels.filter((l) => l.shown);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    assert.equal(overlaps(shown[i], shown[j]), false, `${msg}：標籤「${shown[i].text}」與「${shown[j].text}」重疊`);
  }
};
const assertClean = (page) => {
  assert.deepEqual(page.consoleErrors, []);
  const warns = page.consoleWarnings.filter((w) => !String(w).startsWith('[materials]'));
  assert.deepEqual(warns, [], '除 [materials] 提示外不應有警告');
};

test('開場階段：工具列與名稱標籤不顯示；開始後工具列出現', async () => {
  const page = await open();
  try {
    const hidden = await page.evaluate(`(() => {
      const cs = getComputedStyle(document.getElementById('toolbar'));
      return { vis: cs.visibility, op: cs.opacity, labels: getComputedStyle(document.getElementById('labels')).display };
    })()`);
    assert.ok(hidden.vis === 'hidden' || Number(hidden.op) === 0, '開場時工具列不可見');
    assert.equal(hidden.labels, 'none');
    assert.equal(await page.evaluate("document.getElementById('btn-explode').disabled"), true);
    const b = await center(page, '#intro-start');
    await page.click(b.x, b.y);
    await page.waitFor('window.__cell.lidOpen() === true');
    await page.waitFor("getComputedStyle(document.getElementById('toolbar')).visibility === 'visible' && Number(getComputedStyle(document.getElementById('toolbar')).opacity) > 0.9");
    assert.equal(await page.evaluate("document.getElementById('btn-explode').disabled"), false);
    assert.equal(await page.evaluate("document.getElementById('btn-explode').textContent"), '拆解');
    assert.equal(await page.evaluate("document.getElementById('btn-labels').textContent"), '顯示名稱');
    assert.equal(await pressed(page, '#btn-explode'), 'false');
    assert.equal(await pressed(page, '#btn-labels'), 'false');
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('拆解：位移、放大、跟隨、外殼殘影、點選、鏡頭與還原', async () => {
  const page = await boot();
  try {
    await sleep(300);
    const pose0 = await getPose(page);
    const dist0 = await camDist(page);
    const before = {};
    for (const id of [...SIX, 'chromatin']) before[id] = await page.evaluate(`window.__cell.repScreenPoint(${JSON.stringify(id)})`);
    const rib0 = sub(await rootPos(page, 'ribosome', 0), await rootPos(page, 'rough_er', 0));
    const strand0 = sub(await rootPos(page, 'transvacuolar_strand', 0), await rootPos(page, 'vacuole', 0));
    const chromatin0 = sub(await rootPos(page, 'chromatin', 0), await rootPos(page, 'nucleus', 0));
    assert.ok(await page.evaluate('window.__cell.screenPointOf("cell_wall")'), '組合狀態下外殼可點');

    await clickSel(page, '#btn-explode');
    assert.equal(await pressed(page, '#btn-explode'), 'true');
    assert.equal(await page.evaluate("document.getElementById('btn-explode').textContent"), '組合');
    await page.waitFor('window.__cell.explodeProgress() === 1', 3000);
    await settleCamera(page);
    await sleep(700); // 等外殼變成殘影的漸變收斂
    assert.equal(await page.evaluate('window.__cell.store.getState().exploded'), true);

    // 外殼是殘影、不可點
    assert.equal(await page.evaluate('window.__cell.screenPointOf("cell_wall")'), null);
    const ghost = await page.evaluate(`(() => ['cell_wall', 'middle_lamella', 'cell_membrane', 'cytoplasm'].flatMap((id) =>
      window.__cell.index.byId.get(id).meshes.map((m) => [m.material.transparent, m.material.opacity, m.castShadow])))()`);
    assert.ok(ghost.every(([t, o, c]) => t && o <= 0.16 && c === false), '拆解時外殼應是殘影（半透明、不投影）');

    // 六個構造：在「同一個鏡頭位置」下，任兩個的畫面距離都比拆解前大（鏡頭會為了讓放大的外殼完整入鏡而拉遠，
    // 所以在拆解後的鏡頭下，整體只是等比例縮小，不能拿來比距離）
    const pose1 = await getPose(page);
    const atPose0 = await repPoints(page, pose0, [...SIX, 'chromatin']);
    const d0 = pairDistances(before, SIX);
    const d1 = pairDistances(atPose0, SIX);
    for (const k of Object.keys(d0)) assert.ok(d1[k] > d0[k], `${k}：拆解後 ${d1[k].toFixed(1)} 應大於拆解前 ${d0[k].toFixed(1)}`);
    // 跟隨：染色質與細胞核的畫面距離（同一個鏡頭下）與拆解前相差不到 2 像素；世界座標差則完全相同
    const gap0 = dist(before.chromatin, before.nucleus);
    const gap1 = dist(atPose0.chromatin, atPose0.nucleus);
    assert.ok(Math.abs(gap1 - gap0) < 2, `染色質與細胞核的距離應不變：${gap0.toFixed(2)} → ${gap1.toFixed(2)}`);
    nearArr(sub(await rootPos(page, 'ribosome', 0), await rootPos(page, 'rough_er', 0)), rib0, 1e-6, '附著型核糖體跟著粗糙內質網');
    nearArr(sub(await rootPos(page, 'transvacuolar_strand', 0), await rootPos(page, 'vacuole', 0)), strand0, 1e-6, '細胞質絲跟著液泡');
    nearArr(sub(await rootPos(page, 'chromatin', 0), await rootPos(page, 'nucleus', 0)), chromatin0, 1e-6, '染色質跟著細胞核');
    // 放大的構造：游離核糖體（個體 1）以中心放大；核仁離開細胞核
    const sc = await page.evaluate(`(() => { const e = window.__cell.index.byId.get('ribosome'); return e.instances.find((r) => r.userData.inst === 1).scale.x; })()`);
    assert.ok(Math.abs(sc - 1.9) < 1e-6, `游離核糖體應放大到 1.9 倍，實際 ${sc}`);

    // 拆解後的鏡頭：整個模型完整入畫面
    const dist1 = await camDist(page);
    assert.ok(dist1 > dist0 * 1.5, `拆解後鏡頭應拉遠：${dist0.toFixed(1)} → ${dist1.toFixed(1)}`);
    for (const [x, y, z] of (await cornersNdc(page)).out) {
      assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1, `拆解後外框的角應在畫面內：${x.toFixed(2)}, ${y.toFixed(2)}`);
    }
    await page.screenshot('assets/preview/web-exploded.png');

    // 拆解狀態下點選照常運作（細胞核上能點到的位置）；選取後再取消，鏡頭回到拆解狀態的預設位置
    const nuc = await page.evaluate('window.__cell.screenPointOf("nucleus")');
    assert.ok(nuc, '拆解後畫面上應能點到細胞核');
    await page.click(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    await settleCamera(page);
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), false);
    assert.ok((await camDist(page)) < dist1 * 0.5, '選取後鏡頭應靠近');
    await clickSel(page, '#panel-close');
    await page.waitFor('window.__cell.store.getState().selected === null');
    await settleCamera(page);
    const home = await getPose(page);
    nearArr(home.p, pose1.p, 1e-3, '取消選取後鏡頭回到拆解狀態的預設位置');
    nearArr(home.t, pose1.t, 1e-3, '取消選取後目標點回到拆解狀態的預設位置');
    for (const [x, y, z] of (await cornersNdc(page)).out) {
      assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1, '取消選取後外框的角仍在畫面內');
    }

    // 再按一次：組合，回到拆解前
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 0', 3000);
    await settleCamera(page);
    assert.equal(await pressed(page, '#btn-explode'), 'false');
    assert.equal(await page.evaluate("document.getElementById('btn-explode').textContent"), '拆解');
    const back = await getPose(page);
    nearArr(back.p, pose0.p, 1e-3, '組合後鏡頭回到原本的預設位置');
    const after = await repPoints(page, back, SIX);
    for (const id of SIX) assert.ok(dist(after[id], before[id]) < 0.5, `${id} 組合後應回到原位`);
    assert.equal(await page.evaluate(`(() => { const e = window.__cell.index.byId.get('ribosome'); return e.instances.every((r) => r.scale.x === 1); })()`), true);
    await sleep(700);
    assert.ok(await page.evaluate('window.__cell.screenPointOf("cell_wall")'), '組合後外殼又可以點');
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('拆解動畫進行到一半再按一次：進度平順地反向回到 0', async () => {
  const page = await boot();
  try {
    await sleep(300);
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() > 0.25');
    await clickSel(page, '#btn-explode');
    const p0 = await progress(page);
    assert.ok(p0 > 0.25 && p0 < 1, `反向時進度應在中間，實際 ${p0}`);
    const samples = [p0];
    const t0 = Date.now();
    while (samples[samples.length - 1] > 0 && Date.now() - t0 < 4000) {
      await sleep(30);
      samples.push(await progress(page));
    }
    assert.equal(samples[samples.length - 1], 0, '最後回到 0');
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i] <= samples[i - 1] + 1e-9, `進度不可回升：${samples[i - 1]} → ${samples[i]}`);
    assert.ok(samples.filter((v) => v > 0 && v < p0).length >= 3, `應有多個中間值（平順），實際 ${samples.map((v) => v.toFixed(2))}`);
    await settleCamera(page);
    assert.equal(await pressed(page, '#btn-explode'), 'false');
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('有選取時切換拆解：選取保留，動畫結束後鏡頭重新對準新位置', async () => {
  const page = await boot();
  try {
    await clickList(page, 'golgi');
    await page.waitFor("window.__cell.store.getState().selected?.id === 'golgi'");
    await settleCamera(page);
    await sleep(400);
    const worldOf = () => page.evaluate(`(() => {
      const e = window.__cell.index.byId.get('golgi');
      const v = e.anchor.getWorldPosition(window.__cell.view.camera.position.clone());
      const t = window.__cell.view.controls.target;
      return { pos: v.toArray(), gap: v.distanceTo(t) };
    })()`);
    const w0 = await worldOf();
    assert.ok(w0.gap < 0.05, '選取後鏡頭對準高基氏體');
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1', 3000);
    await page.waitFor('!window.__cell.cameraBusy()', 5000);
    await sleep(200);
    assert.deepEqual(await selected(page), { id: 'golgi', inst: null }, '選取保留');
    const w1 = await worldOf();
    assert.ok(Math.hypot(...sub(w1.pos, w0.pos)) > 1, '高基氏體應已移動');
    assert.ok(w1.gap < 0.05, `動畫結束後鏡頭目標點應對準高基氏體的新位置，相距 ${w1.gap}`);
    // 拆解狀態下取消選取：回到拆解狀態的預設位置（外框完整入鏡）
    await clickSel(page, '#panel-close');
    await page.waitFor('window.__cell.store.getState().selected === null');
    await settleCamera(page);
    for (const [x, y, z] of (await cornersNdc(page)).out) assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1);
    // 組合回去時也一樣：先選取、再組合
    await clickList(page, 'golgi');
    await settleCamera(page);
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 0', 3000);
    await page.waitFor('!window.__cell.cameraBusy()', 5000);
    await sleep(200);
    assert.deepEqual(await selected(page), { id: 'golgi', inst: null });
    assert.ok((await worldOf()).gap < 0.05, '組合後鏡頭目標點應對準高基氏體');
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '有選取時不自轉');
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('名稱標籤：20 個、不重疊、可點選、跟著拆解移動、靜止時不閃爍', async () => {
  const page = await boot();
  try {
    await sleep(300);
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('labels')).display"), 'none');
    const pose0 = await getPose(page);
    await clickSel(page, '#btn-labels');
    assert.equal(await pressed(page, '#btn-labels'), 'true');
    assert.equal(await page.evaluate("document.getElementById('btn-labels').textContent"), '隱藏名稱');
    await frames(page, 3);
    let labels = await labelInfo(page);
    assert.equal(labels.length, 20);
    assert.deepEqual(labels.map((l) => l.id), ORGANELLE_IDS, '標籤順序與 20 個 id 的既定順序相同');
    for (const l of labels) assert.equal(l.text, zh(l.id), `${l.id} 的標籤文字`);
    const shown = labels.filter((l) => l.shown);
    assert.ok(shown.length >= 10, `可見標籤至少 10 個，實際 ${shown.length}`);
    assertNoOverlap(labels, '組合狀態');
    for (const l of shown) assert.ok(l.left >= 0 && l.top >= 0 && l.right <= 1280 && l.bottom <= 800, `${l.id} 完整在視窗內`);
    // 靜止時不閃爍：連續取樣的顯示與位置完全相同
    const key = (ls) => JSON.stringify(ls.map((l) => [l.id, l.shown, l.left, l.top]));
    const k0 = key(labels);
    for (let i = 0; i < 6; i++) { await sleep(60); assert.equal(key(await labelInfo(page)), k0, '鏡頭靜止時標籤不可跳動或閃爍'); }
    await page.screenshot('assets/preview/web-labels.png');

    // 點「皮層微管」的標籤：預設視角下它被優先順序較前的標籤擠掉，把鏡頭拉近到它旁邊再點
    await page.evaluate(`(() => {
      const { camera, controls } = window.__cell.view;
      const a = window.__cell.index.byId.get('microtubule').anchor.getWorldPosition(camera.position.clone());
      controls.target.copy(a);
      camera.position.copy(a).add(camera.position.clone().set(0.62, 0.48, 0.62).normalize().multiplyScalar(4));
      controls.update();
    })()`);
    await frames(page, 3);
    labels = await labelInfo(page);
    const mt = labels.find((l) => l.id === 'microtubule');
    assert.ok(mt.shown, '拉近後「皮層微管」的標籤應可見');
    assertNoOverlap(labels, '拉近後');
    const mp = { x: (mt.left + mt.right) / 2, y: (mt.top + mt.bottom) / 2 };
    assert.equal(await page.evaluate(`document.elementFromPoint(${mp.x}, ${mp.y}).closest('#labels .label')?.dataset.id`), 'microtubule', '標籤中心點上方就是它自己（只有標籤攔截滑鼠）');
    await page.click(mp.x, mp.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'microtubule'");
    assert.deepEqual(await selected(page), { id: 'microtubule', inst: null });
    await settleCamera(page);
    assert.equal(await page.evaluate("document.getElementById('list').querySelector('[data-id=\"microtubule\"]').classList.contains('active')"), true);
    assert.equal(await page.evaluate("document.getElementById('panel-title').textContent"), zh('microtubule'));
    await frames(page, 3);
    labels = await labelInfo(page);
    assert.equal(labels.filter((l) => l.selected).map((l) => l.id).join(), 'microtubule', '被選取的標籤有強調樣式');
    // 標籤之間的空隙讓滑鼠穿透到畫布
    assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('labels')).pointerEvents`), 'none');
    await clickSel(page, '#panel-close');
    await page.waitFor('window.__cell.store.getState().selected === null');
    await settleCamera(page);

    // 拆解：同一個標籤的位置跟著構造移動（在同一個鏡頭位置下比較）
    const rest = await labelInfo(page);
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1', 3000);
    await settleCamera(page);
    await frames(page, 3);
    const exploded = await labelInfo(page);
    assert.equal(exploded.length, 20);
    assert.ok(exploded.filter((l) => l.shown).length >= 10, '拆解後可見標籤至少 10 個');
    assertNoOverlap(exploded, '拆解狀態');
    const pose1 = await getPose(page);
    await setPose(page, pose0);
    await frames(page, 3);
    const atRest = await labelInfo(page);
    await setPose(page, pose1);
    await frames(page, 3);
    // 回到組合前的鏡頭位置，標籤的位置要和組合狀態的不同
    await clickSel(page, '#btn-labels'); // 先關再開：驗證重新顯示後位置正確
    await clickSel(page, '#btn-labels');
    await frames(page, 3);
    const moved = [];
    for (const l of atRest) {
      const r = rest.find((x) => x.id === l.id);
      if (l.shown && r.shown && Math.hypot(l.left - r.left, l.top - r.top) > 10) moved.push(l.id);
    }
    assert.ok(moved.length >= 3, `拆解後（同一個鏡頭下）至少 3 個標籤的位置應改變，實際 ${moved}`);
    // 靜止時不閃爍（拆解狀態）
    const k1 = key(await labelInfo(page));
    for (let i = 0; i < 6; i++) { await sleep(60); assert.equal(key(await labelInfo(page)), k1, '拆解狀態下靜止時標籤不閃爍'); }
    await page.screenshot('assets/preview/web-exploded-labels.png');

    // 關閉名稱：全部隱藏；組合：標籤的位置回到原處
    await clickSel(page, '#btn-labels');
    assert.equal(await pressed(page, '#btn-labels'), 'false');
    assert.equal(await page.evaluate("document.getElementById('btn-labels').textContent"), '顯示名稱');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#labels [data-id]')].every((e) => e.getClientRects().length === 0)"), true, '關閉後全部隱藏');
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 0', 3000);
    await settleCamera(page);
    assertClean(page);
  } finally {
    await page.close();
  }
});
