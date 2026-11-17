import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { ORGANELLES, ORGANELLE_IDS, QUIZ_IDS } from '../../web/src/organelles.js';

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
// 拆解取景所框的外框（各個體根的世界外框聯集，不含外殼與貼著細胞壁的原生質絲、微管、微絲）八個角投影後的螢幕座標（NDC）
const SKIP = ['cell_wall', 'middle_lamella', 'cell_membrane', 'cytoplasm', 'plasmodesmata', 'microtubule', 'actin_filament'];
const cornersNdc = (page, skip = SKIP) => page.evaluate(`(() => {
  const { index, view } = window.__cell;
  view.scene.updateMatrixWorld(true);
  const Box = index.box.constructor;
  const box = new Box();
  for (const [id, e] of index.byId) if (!${JSON.stringify(skip)}.includes(id)) for (const r of e.instances) box.union(new Box().setFromObject(r));
  view.camera.updateMatrixWorld();
  const out = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = view.camera.position.clone().set(x, y, z).project(view.camera);
    out.push([v.x, v.y, v.z]);
  }
  return { out, center: box.getCenter(view.camera.position.clone()).toArray() };
})()`);
const camDist = (page) => page.evaluate(`(() => { const { camera, controls } = window.__cell.view; return camera.position.distanceTo(controls.target); })()`);

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
// 一般與拆解狀態都要：至少 18 個可見、13 個可點選的全部可見、藥丸不重疊也不蓋住任何可見的圓點、引線不超過 150 像素
const assertLayout = (labels, msg) => {
  const shown = labels.filter((l) => l.shown);
  assert.ok(shown.length >= 18, `${msg}：可見標籤至少 18 個，實際 ${shown.length}（隱藏：${labels.filter((l) => !l.shown).map((l) => l.id)}）`);
  for (const id of QUIZ_IDS) assert.ok(labels.find((l) => l.id === id).shown, `${msg}：可點選的 ${id} 標籤應可見`);
  assertNoOverlap(labels, msg);
  for (const l of shown) {
    assert.equal(l.dotShown, true, `${msg}：${l.id} 的圓點應顯示`);
    assert.ok(l.left >= 0 && l.top >= 0 && l.right <= 1280 && l.bottom <= 800, `${msg}：${l.id} 完整在視窗內`);
    assert.ok(l.leader <= 150, `${msg}：${l.id} 的引線長 ${l.leader.toFixed(1)} 超過 150`);
    for (const o of shown) {
      assert.equal(overlaps({ left: o.dot.x - 3.5, right: o.dot.x + 3.5, top: o.dot.y - 3.5, bottom: o.dot.y + 3.5 }, l), false, `${msg}：藥丸「${l.text}」蓋住「${o.text}」的圓點`);
    }
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

    // 六個構造：各狀態的預設鏡頭下，任兩個的畫面距離都比拆解前大（拆解取景只框散開的構造，所以畫面上真的散開）
    const pose1 = await getPose(page);
    const atPose0 = await repPoints(page, pose0, [...SIX, 'chromatin']);
    const d0 = pairDistances(before, SIX);
    const after1 = {};
    for (const id of SIX) after1[id] = await page.evaluate(`window.__cell.repScreenPoint(${JSON.stringify(id)})`);
    const d1 = pairDistances(after1, SIX); // 各狀態的預設鏡頭下：拆解前用一般預設位置、拆解後用拆解預設位置
    for (const k of Object.keys(d0)) assert.ok(d1[k] > d0[k], `${k}：拆解後 ${d1[k].toFixed(1)} 應大於拆解前 ${d0[k].toFixed(1)}`);
    // 跟隨：染色質與細胞核的畫面距離（在拆解前的同一個鏡頭位置下量）與拆解前相差不到 2 像素；世界座標差則完全相同
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
    assert.ok(dist1 > dist0, `拆解後鏡頭應拉遠：${dist0.toFixed(1)} → ${dist1.toFixed(1)}`);
    const lim = await page.evaluate('({ max: window.__cell.view.controls.maxDistance, far: window.__cell.view.camera.far })');
    assert.ok(lim.max > dist1 * 1.5 && lim.far > dist1 + 25, `maxDistance 與 far 應涵蓋含外殼的完整拆解模型：${JSON.stringify(lim)}`);
    // 散開的構造佔畫面寬度六成以上；核仁與細胞核在畫面上的輪廓（世界外接球的投影）不重疊
    const ndc = (await cornersNdc(page)).out;
    const width = (Math.max(...ndc.map((c) => c[0])) - Math.min(...ndc.map((c) => c[0]))) / 2;
    assert.ok(width >= 0.6, `散開的構造應佔畫面寬度六成以上，實際 ${(width * 100).toFixed(1)}%`);
    const circle = (id) => page.evaluate(`(() => {
      const { index, view } = window.__cell;
      view.scene.updateMatrixWorld(true); view.camera.updateMatrixWorld();
      const box = new index.box.constructor().setFromObject(index.byId.get(${JSON.stringify(id)}).rep);
      const c = box.getCenter(view.camera.position.clone());
      const r = Math.max(...box.getSize(view.camera.position.clone()).toArray()) / 2; // 近似球形的構造：外接球半徑
      const right = view.camera.position.clone().set(1, 0, 0).transformDirection(view.camera.matrixWorld);
      const px = (v) => { const p = v.clone().project(view.camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
      const p0 = px(c);
      const p1 = px(c.clone().addScaledVector(right, r));
      return { x: p0[0], y: p0[1], r: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) };
    })()`);
    const cNuc = await circle('nucleus');
    const cNcl = await circle('nucleolus');
    assert.ok(dist(cNuc, cNcl) > cNuc.r + cNcl.r, `核仁與細胞核在畫面上的輪廓不可重疊：圓心距 ${dist(cNuc, cNcl).toFixed(1)}，半徑和 ${(cNuc.r + cNcl.r).toFixed(1)}`);

    for (const [x, y, z] of (await cornersNdc(page)).out) {
      assert.ok(Math.abs(x) <= 1.001 && Math.abs(y) <= 1.001 && z < 1, `拆解後外框的角應在畫面內：${x.toFixed(2)}, ${y.toFixed(2)}`);
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
      assert.ok(Math.abs(x) <= 1.001 && Math.abs(y) <= 1.001 && z < 1, '取消選取後外框的角仍在畫面內');
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
    for (const [x, y, z] of (await cornersNdc(page)).out) assert.ok(Math.abs(x) <= 1.001 && Math.abs(y) <= 1.001 && z < 1);
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

test('名稱標籤：20 個、引線標註、不重疊、可點選、跟著拆解移動、靜止時不閃爍', async () => {
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
    assertLayout(labels, '組合狀態');
    // 靜止時不閃爍：連續取樣的顯示與位置完全相同
    const key = (ls) => JSON.stringify(ls.map((l) => [l.id, l.shown, l.left, l.top]));
    const k0 = key(labels);
    for (let i = 0; i < 6; i++) { await sleep(60); assert.equal(key(await labelInfo(page)), k0, '鏡頭靜止時標籤不可跳動或閃爍'); }
    await page.screenshot('assets/preview/web-labels.png');

    // 點「皮層微管」的標籤：預設鏡頭位置就看得到，不必先搬動鏡頭
    const mt = labels.find((l) => l.id === 'microtubule');
    assert.ok(mt.shown, '預設位置下「皮層微管」的標籤應可見');
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

    // 拆解：標籤跟著構造移動
    const rest = await labelInfo(page);
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1', 3000);
    await settleCamera(page);
    await frames(page, 3);
    const exploded = await labelInfo(page);
    assert.equal(exploded.length, 20);
    assertLayout(exploded, '拆解狀態');
    const moved = rest.filter((r) => r.shown && exploded.find((x) => x.id === r.id).shown
      && Math.hypot(r.dot.x - exploded.find((x) => x.id === r.id).dot.x, r.dot.y - exploded.find((x) => x.id === r.id).dot.y) > 10).map((r) => r.id);
    assert.ok(moved.length >= 10, `拆解前後同一個標籤的位置應跟著改變，實際只有 ${moved.length} 個`);
    await clickSel(page, '#btn-labels'); // 先關再開：驗證重新顯示後位置正確
    await clickSel(page, '#btn-labels');
    await frames(page, 3);
    assertLayout(await labelInfo(page), '關再開之後');
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

// ================= Task 12：測驗 =================
const visible = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`);
const textOf = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const disabledOf = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).disabled`);
const quizId = (page) => page.evaluate('window.__cell.quizCurrentId()');
const progressText = (page) => textOf(page, '#quiz-progress');
// 畫面上點得到的構造（排除 except）
const visibleOther = async (page, except) => {
  for (const id of QUIZ_IDS) {
    if (id === except) continue;
    const p = await page.evaluate(`window.__cell.screenPointOf(${JSON.stringify(id)})`);
    if (p) return { id, ...p };
  }
  throw new Error('畫面上找不到可點的構造');
};
// 畫面上沒有任何構造、也沒有介面的位置
const blankPoint = async (page) => {
  const p = await page.evaluate(`(() => {
    const c = document.getElementById('stage');
    for (let y = 600; y <= 780; y += 30) for (let x = 40; x <= 1240; x += 40) {
      if (document.elementFromPoint(x, y) === c && window.__cell.hitAt(x, y) === null) return { x, y };
    }
    return null;
  })()`);
  assert.ok(p, '找不到空白處');
  return p;
};
// 所有網格的自發光強度快照
const emissiveOf = (page) => page.evaluate(`(() => {
  const out = {};
  for (const [id, e] of window.__cell.index.byId) out[id] = e.meshes.map((m) => m.material.emissiveIntensity);
  return out;
})()`);
const maxDelta = (now, before, ids) => Math.max(...ids.flatMap((id) => now[id].map((v, i) => v - before[id][i])));

test('工具列：蓋子還沒完全打開之前三顆按鈕都停用，打開後才啟用', async () => {
  const page = await open();
  try {
    const b = await center(page, '#intro-start');
    await page.click(b.x, b.y);
    const snap = () => page.evaluate(`({ open: window.__cell.lidOpen(), d: ['btn-explode', 'btn-labels', 'btn-quiz'].map((id) => document.getElementById(id).disabled) })`);
    let early = 0;
    for (let i = 0; i < 400; i++) {
      const s = await snap();
      if (s.open) break;
      early += 1;
      assert.deepEqual(s.d, [true, true, true], '蓋子還沒打開時三顆按鈕都應停用');
      await sleep(40);
    }
    assert.ok(early >= 3, `應取到蓋子還沒打開的樣本，實際 ${early}`);
    await page.waitFor('window.__cell.lidOpen() === true');
    assert.deepEqual((await snap()).d, [false, false, false], '蓋子打開後三顆按鈕可按');
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('拆解連續來回三次：每個個體根的位置與縮放回到載入時的值', async () => {
  const page = await boot();
  try {
    await sleep(300);
    const snap = () => page.evaluate(`(() => {
      const out = [];
      for (const [id, e] of window.__cell.index.byId) for (const r of e.instances) out.push([id, r.userData.inst, ...r.position.toArray(), ...r.scale.toArray()]);
      return out;
    })()`);
    const before = await snap();
    assert.ok(before.length >= 20);
    for (let i = 0; i < 3; i++) {
      await clickSel(page, '#btn-explode');
      await page.waitFor('window.__cell.explodeProgress() === 1', 4000);
      await clickSel(page, '#btn-explode');
      await page.waitFor('window.__cell.explodeProgress() === 0', 4000);
    }
    assert.equal(await page.evaluate('window.__cell.store.getState().exploded'), false);
    const after = await snap();
    assert.equal(after.length, before.length);
    before.forEach((row, i) => {
      assert.deepEqual(after[i].slice(0, 2), row.slice(0, 2));
      for (let k = 2; k < row.length; k++) assert.ok(Math.abs(after[i][k] - row[k]) <= 1e-9, `${row[0]}#${row[1]} 第 ${k} 欄 ${row[k]} → ${after[i][k]}`);
    });
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('測驗：進入時的畫面、先開名稱與拆解會被關閉、在測驗中按 #btn-quiz 等同結束並還原', async () => {
  const page = await boot();
  try {
    await sleep(300);
    const pose0 = await getPose(page);
    await clickSel(page, '#btn-labels');
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1', 4000);
    await settleCamera(page);
    await clickList(page, 'golgi');
    await page.waitFor("window.__cell.store.getState().selected?.id === 'golgi'");
    await settleCamera(page);
    assert.equal(await visible(page, '#panel'), true, '選取後介紹面板可見');
    assert.equal(await pressed(page, '#btn-labels'), 'true');

    await clickSel(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    assert.equal(await pressed(page, '#btn-quiz'), 'true');
    assert.ok((await textOf(page, '#quiz-question')).includes('請點出'), '題目含「請點出」');
    assert.equal(await progressText(page), '第 1 題／共 10 題');
    assert.ok(await quizId(page), 'quizCurrentId 有值');
    assert.equal(await page.evaluate('window.__cell.store.getState().selected'), null);
    assert.equal(await visible(page, '#panel'), false, '介紹面板隱藏');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#labels [data-id]')].every((e) => e.getClientRects().length === 0)"), true, '名稱標籤不可見');
    assert.equal(await pressed(page, '#btn-labels'), 'false', '名稱已關閉');
    assert.equal(await pressed(page, '#btn-explode'), 'false', '拆解已關閉');
    assert.equal(await disabledOf(page, '#btn-explode'), true);
    assert.equal(await disabledOf(page, '#btn-labels'), true);
    assert.equal(await disabledOf(page, '#btn-quiz'), false);
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).visibility === 'hidden'");
    assert.equal(await visible(page, '#list-wrap'), false, '清單不可見');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#list .label')].every((e) => e.getClientRects().length === 0)"), true, '清單上看不到任何構造名稱');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#list button')].every((b) => !b.hasAttribute('title'))"), true, '沒有 title 提示洩漏名稱');
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    await page.waitFor('window.__cell.explodeProgress() === 0', 4000);
    await settleCamera(page);
    nearArr((await getPose(page)).p, pose0.p, 1e-3, '進入測驗後鏡頭回到一般（未拆解）的預設位置');
    // 滑過構造：游標是手指，但不顯示名稱
    const some = await visibleOther(page, null);
    await page.mouseMove(some.x, some.y);
    await page.waitFor("document.getElementById('stage').style.cursor === 'pointer'");
    assert.equal(await visible(page, '#hover-name'), false, '測驗中滑過不顯示名稱');
    await sleep(3500);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '測驗中不自轉');
    // 直接送出 select 不會洩漏：狀態不變
    await page.evaluate("window.__cell.store.dispatch({ type: 'select', id: 'nucleus', inst: null })");
    assert.equal(await page.evaluate('window.__cell.store.getState().selected'), null);

    // 再按 #btn-quiz：結束，名稱與拆解還原
    await clickSel(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'explore'");
    assert.equal(await visible(page, '#quiz'), false);
    assert.equal(await pressed(page, '#btn-quiz'), 'false');
    assert.equal(await pressed(page, '#btn-labels'), 'true', '名稱還原為開');
    assert.equal(await pressed(page, '#btn-explode'), 'true', '拆解還原為開');
    assert.equal(await disabledOf(page, '#btn-explode'), false);
    assert.equal(await page.evaluate('window.__cell.quizCurrentId()'), null);
    await page.waitFor('window.__cell.explodeProgress() === 1', 4000);
    await settleCamera(page);
    await frames(page, 3);
    assert.ok((await labelInfo(page)).filter((l) => l.shown).length >= 18, '名稱標籤恢復顯示');
    assert.equal(await page.evaluate('window.__cell.store.getState().selected'), null);
    assert.equal(await page.evaluate("[...document.querySelectorAll('#list .label')].every((e) => e.getClientRects().length > 0)"), true, '清單名稱恢復');
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).visibility === 'visible'");
    assertClean(page);
  } finally {
    await page.close();
  }
});

test('測驗：十題流程、揭曉發亮、空白與揭曉中的點擊不算、總結、再玩一次、結束', async () => {
  const page = await boot();
  try {
    await sleep(300);
    await clickSel(page, '#btn-quiz');
    await page.waitFor("window.__cell.store.getState().phase === 'quiz'");
    await settleCamera(page);
    await sleep(500);
    assert.ok((await textOf(page, '#quiz-question')).startsWith('請點出：'));
    await page.screenshot('assets/preview/web-quiz.png');

    // 點空白處不算作答
    const blank = await blankPoint(page);
    await page.click(blank.x, blank.y);
    await sleep(200);
    assert.equal(await progressText(page), '第 1 題／共 10 題');
    assert.equal(await textOf(page, '#quiz-result'), '');
    assert.equal(await page.evaluate('window.__cell.store.getState().quiz.reveal'), null);

    const seen = [];
    let correctCount = 0;
    let wrongCount = 0;
    for (let i = 0; i < 10; i++) {
      assert.equal(await progressText(page), `第 ${i + 1} 題／共 10 題`);
      const id = await quizId(page);
      assert.ok(QUIZ_IDS.includes(id));
      seen.push(id);
      assert.equal(await textOf(page, '#quiz-question'), `請點出：${zh(id)}`);
      const mine = await page.evaluate(`window.__cell.screenPointOf(${JSON.stringify(id)})`);
      // 第 1 題一律故意點錯（要驗證答錯的揭曉）；之後能點到答案就點答案，點不到就點別的
      const wrong = i === 0 || !mine;
      const target = wrong ? await visibleOther(page, id) : { id, ...mine };
      const before = i === 0 ? await emissiveOf(page) : null;
      await page.click(target.x, target.y);
      await page.waitFor("document.getElementById('quiz-result').textContent !== ''", 3000);
      const result = await textOf(page, '#quiz-result');
      if (wrong) {
        wrongCount += 1;
        assert.equal(result, `答錯了，你點的是${zh(target.id)}。發亮的才是${zh(id)}。`);
      } else {
        correctCount += 1;
        assert.equal(result, '答對了！');
      }
      assert.deepEqual(await page.evaluate('window.__cell.store.getState().quiz.reveal'), { id, correct: !wrong });
      assert.equal(await page.evaluate('window.__cell.quizCurrentId()'), id, '揭曉期間畫面上仍是這一題');
      if (i === 0) {
        await page.waitFor(`(() => { const e = window.__cell.index.byId.get(${JSON.stringify(id)}); return e.meshes.some((m) => m.material.emissiveIntensity > ${Math.max(...before[id])} + 0.15); })()`, 2000);
        await sleep(250);
        const now = await emissiveOf(page);
        const others = Object.keys(now).filter((k) => k !== id);
        assert.ok(maxDelta(now, before, [id]) > 0.15, '正確的構造自發光明顯增加');
        assert.ok(maxDelta(now, before, others) < 0.05, '其他構造不發亮');
        assert.equal(await textOf(page, '#quiz-result'), result, '截圖時仍在揭曉期間');
        await page.screenshot('assets/preview/web-quiz-wrong.png');
        assert.equal(await textOf(page, '#quiz-result'), result, '截圖完成時仍在揭曉期間');
      }
      if (i === 1) {
        // 揭曉期間再點別的構造：不改變分數與題號
        const other = await visibleOther(page, id);
        await page.click(other.x, other.y);
        await sleep(150);
        assert.equal(await progressText(page), `第 ${i + 1} 題／共 10 題`, '揭曉中的點擊不算作答');
        assert.equal(await textOf(page, '#quiz-result'), result);
      }
      if (i < 9) {
        await page.waitFor(`document.getElementById('quiz-progress').textContent === '第 ${i + 2} 題／共 10 題'`, 4000);
        assert.equal(await textOf(page, '#quiz-result'), '', '下一題時結果清空');
        assert.equal(await page.evaluate('window.__cell.store.getState().quiz.reveal'), null);
      }
    }
    assert.equal(new Set(seen).size, 10, '十題不重複');
    assert.ok(correctCount >= 1 && wrongCount >= 1, `答對與答錯各至少一題：${correctCount}／${wrongCount}`);

    await page.waitFor("!document.getElementById('quiz-summary').hidden", 4000);
    assert.equal(await textOf(page, '#quiz-summary'), `答對 ${correctCount}／10 題`);
    assert.equal(await page.evaluate('window.__cell.quizCurrentId()'), null);
    assert.equal(await visible(page, '#quiz-retry'), true);
    assert.equal(await visible(page, '#quiz-exit'), true);
    assert.equal(await textOf(page, '#quiz-retry'), '再玩一次');
    assert.equal(await textOf(page, '#quiz-exit'), '結束測驗');
    assert.equal(await page.evaluate('window.__cell.store.getState().quiz.reveal'), null, '總結時發亮已還原');
    await sleep(700);
    await page.screenshot('assets/preview/web-quiz-summary.png');

    // 再玩一次：回到第 1 題、重新抽題
    await clickSel(page, '#quiz-retry');
    await page.waitFor("document.getElementById('quiz-progress').textContent === '第 1 題／共 10 題'");
    assert.equal(await visible(page, '#quiz-summary'), false);
    assert.ok((await textOf(page, '#quiz-question')).startsWith('請點出：'));
    assert.ok(await quizId(page));
    assert.equal(await textOf(page, '#quiz-result'), '');

    // 結束測驗：清單名稱恢復
    await clickSel(page, '#quiz-exit');
    await page.waitFor("window.__cell.store.getState().phase === 'explore'");
    assert.equal(await visible(page, '#quiz'), false);
    assert.equal(await page.evaluate("[...document.querySelectorAll('#list .label')].every((e) => e.getClientRects().length > 0)"), true, '清單名稱恢復');
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).visibility === 'visible'");
    assert.equal(await page.evaluate('window.__cell.store.getState().selected'), null);
    assertClean(page);
  } finally {
    await page.close();
  }
});
