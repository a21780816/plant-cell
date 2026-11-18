// 細胞質的選取呈現與清單可見度（C1–C4）。輔助函式照抄既有的 e2e 檔（這個專案的慣例）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { CYTOPLASM_SELECTED } from '../../web/src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";

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

// 所有網格的材質快照（發亮、不透明度、透明旗標、顏色）
const MESH_SNAP = `(() => {
  const out = {};
  for (const [id, e] of window.__cell.index.byId) out[id] = e.meshes.map((m) => ({ ei: m.material.emissiveIntensity, op: m.material.opacity, tr: m.material.transparent, c: m.material.color.getHex() }));
  return out;
})()`;
const meshSnap = (page) => page.evaluate(MESH_SNAP);
const sameSnap = (a, b) => Object.keys(a).every((id) => a[id].every((m, i) => Math.abs(m.ei - b[id][i].ei) < 1e-6 && Math.abs(m.op - b[id][i].op) < 1e-6 && m.tr === b[id][i].tr && m.c === b[id][i].c));

const settle = async (page) => { await settleCamera(page); await sleep(600); }; // 等 0.25 秒的漸變收斂
const away = async (page) => {
  const p = await center(page, '#list-title');
  await page.mouseMove(p.x, p.y);
  await page.waitFor('window.__cell.store.getState().hovered === null');
};
const hex = (s) => parseInt(s.slice(1), 16);
// 除 skip 以外每個 id 都相同；不同的 id 列在訊息裡
function same(now, ref, skip, label) {
  assert.deepEqual(Object.keys(now).sort(), Object.keys(ref).sort(), `${label}：構造 id 集合不同`);
  const diff = Object.keys(ref).filter((id) => id !== skip && !sameSnap({ [id]: now[id] }, { [id]: ref[id] }));
  assert.deepEqual(diff, [], `${label}：這些構造與基準不同（含 nucleus／chloroplast／mitochondrion 時請特別檢查）：${diff.join(', ')}`);
}
const checkCyto = (snap, look, label) => {
  const m = snap.cytoplasm[0];
  assert.equal(m.c, hex(look.color), `${label}：細胞質顏色 ${m.c.toString(16)}`);
  assert.ok(Math.abs(m.op - look.opacity) < 1e-6, `${label}：細胞質不透明度 ${m.op}`);
  assert.equal(m.tr, true, `${label}：細胞質 transparent`);
};

test('C1 選取細胞質：其他構造與未選取時相同（含滑過），細胞質等於 CYTOPLASM_SELECTED 且有呼吸；改選細胞核與直接選相同；取消後完全還原', async () => {
  const page = await boot();
  try {
    await away(page); await settle(page);
    const base = await meshSnap(page);
    assert.equal(base.cytoplasm.length, 1);
    await clickList(page, 'nucleus'); await settle(page);
    const refN = await meshSnap(page);

    await clickList(page, 'cytoplasm'); await settle(page);
    const now = await meshSnap(page);
    same(now, base, 'cytoplasm', '選取細胞質');
    for (const id of ['nucleus', 'chloroplast', 'mitochondrion']) assert.ok(sameSnap({ [id]: now[id] }, { [id]: base[id] }), `${id} 與基準不同`);
    checkCyto(now, CYTOPLASM_SELECTED, '選取細胞質');
    const eis = [];
    for (let i = 0; i < 6; i++) { eis.push((await meshSnap(page)).cytoplasm[0].ei); await sleep(170); }
    const E = CYTOPLASM_SELECTED.emissive;
    for (const e of eis) assert.ok(e >= E - 0.06 - 1e-6 && e <= E + 0.06 + 1e-6, `細胞質自發光 ${e} 超出範圍`);
    assert.ok(Math.max(...eis) - Math.min(...eis) > 0.02, `細胞質沒有呼吸：${eis.join(', ')}`);

    // 滑過其他構造：照常滑過發亮
    const p = await page.evaluate("window.__cell.screenPointOf('nucleus')");
    assert.ok(p, 'nucleus 螢幕座標為 null');
    await page.mouseMove(p.x, p.y);
    await page.waitFor("window.__cell.store.getState().hovered?.id === 'nucleus'");
    await sleep(600);
    const hov = await meshSnap(page);
    let maxD = -Infinity;
    hov.nucleus.forEach((m, i) => {
      assert.equal(m.c, base.nucleus[i].c, '滑過的細胞核顏色');
      maxD = Math.max(maxD, m.ei - base.nucleus[i].ei);
    });
    assert.ok(Math.abs(maxD - 0.15) < 1e-6, `滑過細胞核的發亮增量 ${maxD}`);
    await away(page); await sleep(600);

    await clickList(page, 'nucleus'); await settle(page);
    same(await meshSnap(page), refN, null, '改選細胞核');
    await clickSel(page, '#panel-close');
    await page.waitFor('window.__cell.store.getState().selected === null');
    await settle(page);
    same(await meshSnap(page), base, null, '取消選取');
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('C2 拆解狀態選取細胞質：同樣上色，其他構造與拆解未選取時相同', async () => {
  const page = await boot();
  try {
    await clickSel(page, '#btn-explode');
    await page.waitFor('window.__cell.explodeProgress() === 1');
    await away(page); await settle(page);
    const baseE = await meshSnap(page);
    await clickList(page, 'cytoplasm'); await settle(page);
    const now = await meshSnap(page);
    checkCyto(now, CYTOPLASM_SELECTED, '拆解選取細胞質');
    same(now, baseE, 'cytoplasm', '拆解選取細胞質');
    assert.deepEqual(page.consoleErrors, []);
  } finally { await page.close(); }
});

test('C3 清單：色點的 box-shadow 等於規格值；選取中按鈕保留構造色光環與陰影，外側多一圈深色外環', async () => {
  const page = await boot();
  try {
    const dots = await page.evaluate("[...document.querySelectorAll('#list button .dot')].map((d) => getComputedStyle(d).boxShadow)");
    assert.equal(dots.length, 20);
    for (const s of dots) assert.equal(s, 'rgba(52, 48, 42, 0.28) 0px 0px 0px 1px inset');
    const style = (id) => page.evaluate(`(() => { const s = getComputedStyle(document.querySelector('#list [data-id="${id}"]')); return { shadow: s.boxShadow, border: s.borderTopColor, weight: s.fontWeight }; })()`);
    await clickList(page, 'cytoplasm'); await away(page); await sleep(300);
    const cy = await style('cytoplasm');
    assert.equal(cy.shadow, 'rgb(237, 230, 211) 0px 0px 0px 1.5px, rgba(52, 48, 42, 0.45) 0px 0px 0px 3px, rgba(60, 50, 30, 0.12) 0px 2px 8px 0px');
    assert.equal(cy.border, 'rgb(237, 230, 211)');
    assert.equal(cy.weight, '650');
    await clickList(page, 'nucleus'); await away(page); await sleep(300);
    const nu = await style('nucleus');
    assert.equal(nu.shadow, 'rgb(163, 150, 184) 0px 0px 0px 1.5px, rgba(52, 48, 42, 0.45) 0px 0px 0px 3px, rgba(60, 50, 30, 0.12) 0px 2px 8px 0px');
    assert.equal(nu.border, 'rgb(163, 150, 184)');
    assert.equal(nu.weight, '650');
    assert.equal((await style('cytoplasm')).shadow, 'none');
  } finally { await page.close(); }
});

test('C4 候選值截圖：三組外觀各一張，材質等於該組數值', async () => {
  const page = await boot();
  try {
    await away(page);
    await settle(page);
    await page.screenshot('assets/preview/web-cytoplasm-none.png');
    await clickList(page, 'cytoplasm');
    const looks = [
      ['a', { color: '#E8B95A', opacity: 0.38, emissive: 0.25 }],
      ['b', { color: '#E8B95A', opacity: 0.5, emissive: 0.25 }],
      ['c', { color: '#8FC3E8', opacity: 0.35, emissive: 0.25 }],
    ];
    for (const [name, look] of looks) {
      await page.evaluate(`window.__cell.setCytoplasmLook(${JSON.stringify(look)})`);
      await away(page); await settle(page);
      checkCyto(await meshSnap(page), look, `候選 ${name}`);
      await page.screenshot(`assets/preview/web-cytoplasm-${name}.png`);
    }
    await page.evaluate(`window.__cell.setCytoplasmLook(${JSON.stringify(looks[0][1])})`);
    await away(page); await settle(page);
    await page.screenshot('assets/preview/web-list-active.png');
  } finally { await page.close(); }
});
