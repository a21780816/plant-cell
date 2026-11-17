import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { openPage } from '../../scripts/cdp.mjs';
import { readGlb, summarizeGlb } from '../../scripts/glb.mjs';

test('檢視器載入完整模型', async () => {
  const page = await openPage('dist/plant-cell.html', { offline: true });
  try {
    await page.waitFor("document.documentElement.dataset.cellReady === '1'");
    const s = await page.evaluate('window.__cell.stats()');
    console.log('stats', JSON.stringify({ ...s, ids: s.ids.length }));
    assert.equal(s.unresolved, 0);
    const built = summarizeGlb(...Object.values(readGlb('assets/plant_cell.glb')));
    assert.deepEqual([...s.ids].sort(), [...built.ids].sort());
    assert.ok(s.ids.length >= 15);
    assert.deepEqual(page.consoleErrors, []);
    assert.equal(page.requests.filter((u) => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')).length, 0);
    await page.screenshot('assets/preview/web-default.png');
    await page.drag(640, 400, 900, 300);
    await page.screenshot('assets/preview/web-rotated.png');
    // 拉近到細胞核附近
    await page.evaluate(`(() => {
      const c = window.__cell.view;
      const n = window.__cell.index.byId.get('nucleus').anchor;
      const p = n.getWorldPosition(new n.position.constructor());
      c.controls.target.copy(p);
      c.camera.position.copy(p).add(new p.constructor(0.6, 0.5, 0.65).normalize().multiplyScalar(8));
      c.controls.update();
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot('assets/preview/web-closeup.png');
    assert.deepEqual(page.consoleErrors, []);
  } finally {
    await page.close();
  }
});

test('成品是單一檔案', () => {
  const html = readFileSync('dist/plant-cell.html', 'utf8');
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link\b/i.test(html));
  assert.ok(statSync('dist/plant-cell.html').size <= 25 * 1024 * 1024);
});
