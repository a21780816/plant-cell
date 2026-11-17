import test from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../scripts/cdp.mjs';
import { INTRO } from '../../web/src/organelles.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = "document.documentElement.dataset.cellReady === '1' || !!document.documentElement.dataset.cellError";
const FALLBACK_TEXT = '這個瀏覽器無法顯示 3D 內容，請改用新版的 Chrome 開啟。';

async function boot(options = {}) {
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
// 看得到：不是 display:none / visibility:hidden、有大小、幾乎不透明
const isShown = (page, sel) => page.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.9 && r.width > 0 && r.height > 0;
})()`);
const clickStart = async (page) => { const p = await center(page, '#intro-start'); await page.click(p.x, p.y); };
const setInnerWidth = (page, w) => page.evaluate(`(() => {
  Object.defineProperty(window, 'innerWidth', { value: ${w}, configurable: true });
  window.dispatchEvent(new Event('resize'));
})()`);
// 鏡頭繞目標點的水平角度（度）、距離與仰角
const orbit = (page) => page.evaluate(`(() => {
  const { camera, controls } = window.__cell.view;
  const v = camera.position.clone().sub(controls.target);
  return { az: Math.atan2(v.x, v.z) * 180 / Math.PI, dist: v.length(), el: Math.asin(v.y / v.length()) * 180 / Math.PI };
})()`);
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const settleCamera = (page) => page.waitFor('!window.__cell.cameraBusy()', 5000);

test('開場：蓋著的細胞與介紹卡片；開始後掀蓋、構造清單淡入、之後可點選', async () => {
  const page = await boot();
  try {
    // ---- 開場 ----
    assert.equal(await isShown(page, '#intro'), true);
    assert.equal(await isShown(page, '#intro-card'), true);
    const body = await page.evaluate("document.getElementById('intro').textContent");
    assert.ok(body.includes('葉肉細胞'), '卡片內文應含「葉肉細胞」');
    assert.equal(await page.evaluate("document.getElementById('intro-title').textContent"), INTRO.title);
    assert.equal(await page.evaluate("document.querySelectorAll('#intro .intro-text').length"), INTRO.paragraphs.length);
    assert.equal(await page.evaluate("document.getElementById('intro-start').textContent"), INTRO.start);
    assert.equal(await page.evaluate("document.activeElement && document.activeElement.id"), 'intro-start', '載入後按鈕取得鍵盤焦點');
    assert.equal(await page.evaluate('window.__cell.lidOpen()'), false);
    assert.equal(await page.evaluate('window.__cell.store.getState().phase'), 'intro');
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    assert.equal(await isShown(page, '#list-wrap'), false, '開場時構造清單不可見');
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), true);
    assert.equal(await page.evaluate("document.getElementById('hover-name').hidden"), true);
    // 蓋子蓋著：可見、不透明、會投影（與本體同一套材質參數）
    const closed = await page.evaluate(`(() => {
      const lid = window.__cell.index.lid;
      const ms = [];
      lid.traverse((o) => { if (o.isMesh) ms.push(o); });
      let visible = true;
      for (let p = lid; p; p = p.parent) if (p.visible === false) visible = false;
      return { n: ms.length, visible, y: lid.position.y,
        opaqueCast: ms.filter((m) => !m.material.transparent).every((m) => m.castShadow),
        opacity: ms.map((m) => m.material.opacity) };
    })()`);
    assert.ok(closed.n > 0);
    assert.equal(closed.visible, true);
    assert.equal(closed.opaqueCast, true);
    assert.ok(closed.opacity.every((o) => o > 0), '蓋著時蓋子沒有變淡');
    // 這一層攔住滑鼠：整個視窗任一點底下都是 #intro 或卡片
    const blocked = await page.evaluate(`[[5, 5], [640, 400], [1270, 790], [640, 60]].every(([x, y]) => !!document.elementFromPoint(x, y).closest('#intro'))`);
    assert.equal(blocked, true);
    const camBefore = await page.evaluate('window.__cell.view.camera.position.toArray()');
    await page.click(640, 400); // 畫布中央（實際點到的是開場這一層）
    await page.drag(300, 300, 700, 250);
    await sleep(150);
    assert.equal(await page.evaluate('window.__cell.store.getState().selected'), null);
    assert.equal(await page.evaluate('window.__cell.store.getState().phase'), 'intro');
    assert.deepEqual(await page.evaluate('window.__cell.view.camera.position.toArray()'), camBefore, '開場時不能旋轉模型');
    await page.screenshot('assets/preview/web-intro.png');

    // ---- 按下開始 ----
    const lidStart = await page.evaluate('window.__cell.index.lid.position.toArray()');
    const t0 = Date.now();
    await clickStart(page);
    assert.equal(await page.evaluate('window.__cell.store.getState().phase'), 'explore');
    // 動畫約一半時截圖（用蓋子位移的比例判斷），人工檢查有沒有破面
    await page.waitFor(`(() => {
      const p = window.__cell.index.lid.position, s = ${JSON.stringify(lidStart)};
      return Math.hypot(p.x - s[0], p.y - s[1], p.z - s[2]) >= 0.5 * Math.hypot(3, 2.5, 3);
    })()`, 3000);
    await page.screenshot('assets/preview/web-opening.png');
    await page.waitFor("document.getElementById('intro').hidden === true", 3000);
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('intro')).display"), 'none', '卡片與薄紗完全隱藏、不佔位');
    assert.equal(await page.evaluate("document.activeElement && document.activeElement.id !== 'intro-start'"), true, '按鈕隱藏後不留鍵盤焦點');
    await page.waitFor('window.__cell.lidOpen() === true', 3000);
    assert.ok(Date.now() - t0 <= 3000, `開蓋應在 3 秒內完成（${Date.now() - t0} ms）`);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '剛打開時還不自轉（閒置計時從打開那一刻算起）');
    assert.equal(await page.evaluate("window.__cell.store.getState().phase"), 'explore');
    await page.waitFor("getComputedStyle(document.getElementById('list-wrap')).opacity === '1'", 3000);
    assert.equal(await isShown(page, '#list-wrap'), true, '構造清單淡入');
    // 蓋子底下的每個網格都不可見
    const lidState = await page.evaluate(`(() => {
      const ms = [];
      window.__cell.index.lid.traverse((o) => { if (o.isMesh) ms.push(o); });
      const chainVisible = (m) => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; };
      return { n: ms.length, visible: ms.filter(chainVisible).length };
    })()`);
    assert.ok(lidState.n > 0);
    assert.equal(lidState.visible, 0, '打開後蓋子的網格都不可見');
    // 射線打得到蓋子原本蓋住的內部（格點網）
    const ids = await page.evaluate(`(() => {
      const out = new Set();
      for (let j = 0; j < 32; j++) for (let i = 0; i < 48; i++) {
        const h = window.__cell.hitAt((i + 0.5) * innerWidth / 48, (j + 0.5) * innerHeight / 32);
        if (h) out.add(h.id);
      }
      return [...out];
    })()`);
    assert.ok(ids.includes('nucleus'), `應能打到細胞核；打到：${ids}`);
    await sleep(300);
    await page.screenshot('assets/preview/web-opened.png');
    // 打開後可以點選
    const nuc = await page.evaluate("window.__cell.screenPointOf('nucleus')");
    assert.ok(nuc, '畫面上應有可點到細胞核的位置');
    await page.click(nuc.x, nuc.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");

    assert.deepEqual(page.consoleErrors, []);
    assert.deepEqual(page.consoleWarnings.filter((w) => !w.startsWith('[materials]')), []);
    assert.equal(page.requests.filter((u) => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')).length, 0);
  } finally {
    await page.close();
  }
});

test('自轉：閒置 4 秒後緩慢自轉，操作、選取即停；縮放不拉回；取消選取回到預設後再度自轉', async () => {
  const page = await boot();
  try {
    await clickStart(page);
    await page.waitFor('window.__cell.lidOpen() === true', 3000);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    await page.waitFor('window.__cell.autoRotating() === true', 8000); // 打開後閒置 4 秒
    const a0 = await orbit(page);
    const t0 = Date.now();
    await sleep(1000);
    const a1 = await orbit(page);
    const rate = Math.abs(angDiff(a1.az, a0.az)) / ((Date.now() - t0) / 1000);
    assert.ok(rate >= 2 && rate <= 6, `1 秒內水平角度變化應在 2 到 6 度之間，實際每秒 ${rate.toFixed(2)} 度`);
    assert.ok(Math.abs(a1.el - a0.el) < 0.5 && Math.abs(a1.dist - a0.dist) < 0.05, '只繞水平方向轉，距離與仰角不變');

    // 自轉一陣子之後縮放視窗（變窄使預設距離變大）：鏡頭不可跳回預設
    await sleep(1500);
    const before = await orbit(page);
    assert.ok(Math.abs(angDiff(before.az, 45)) > 5, '已經離開預設的水平角度，這個斷言才有鑑別力');
    await setInnerWidth(page, 420);
    await sleep(150);
    const after = await orbit(page);
    assert.ok(Math.abs(after.dist - before.dist) < 0.05, `縮放不應改變鏡頭距離：${before.dist} -> ${after.dist}`);
    assert.ok(Math.abs(angDiff(after.az, before.az)) < 2, `縮放不應改變水平角度：${before.az} -> ${after.az}`);
    await setInnerWidth(page, 1280);
    await sleep(100);

    // 拖曳一下：立刻停止，並維持停止
    await page.drag(640, 400, 700, 400, 4);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    await sleep(1200);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '操作後 4 秒內不自轉');
    await page.waitFor('window.__cell.autoRotating() === true', 8000); // 閒置滿 4 秒又轉

    // 滑鼠在畫布上移動也算操作
    await page.mouseMove(300, 300);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    await page.waitFor('window.__cell.autoRotating() === true', 8000);

    // 選取之後不自轉，等超過 4 秒仍然沒有
    const list = await center(page, '#list [data-id="nucleus"]');
    await page.click(list.x, list.y);
    await page.waitFor("window.__cell.store.getState().selected?.id === 'nucleus'");
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    await settleCamera(page);
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, `已選取，第 ${i + 1} 秒仍不應自轉`);
    }
    // 取消選取：鏡頭回到預設後再閒置 4 秒又開始自轉
    const close = await center(page, '#panel-close');
    await page.click(close.x, close.y);
    await page.waitFor('window.__cell.store.getState().selected === null');
    await page.waitFor('window.__cell.cameraBusy()', 2000);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '鏡頭動畫中不自轉');
    await settleCamera(page);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false);
    await page.waitFor('window.__cell.autoRotating() === true', 8000);

    assert.deepEqual(page.consoleErrors, []);
    assert.deepEqual(page.consoleWarnings.filter((w) => !w.startsWith('[materials]')), []);
  } finally {
    await page.close();
  }
});

test('WebGL 不可用：顯示說明，不出現開場卡片與清單', async () => {
  const page = await openPage('dist/plant-cell.html', {
    offline: true, initScript: 'HTMLCanvasElement.prototype.getContext = () => null',
  });
  try {
    await page.waitFor(READY);
    assert.ok(await page.evaluate("document.documentElement.dataset.cellError"), 'dataset.cellError 應有值');
    assert.equal(await isShown(page, '#fallback'), true);
    const text = await page.evaluate("document.getElementById('fallback').textContent");
    assert.ok(text.includes('無法顯示 3D'), text);
    assert.equal(text, FALLBACK_TEXT);
    assert.equal(await page.evaluate("document.documentElement.dataset.cellReady || ''"), '');
    assert.equal(await isShown(page, '#intro'), false);
    assert.equal(await isShown(page, '#list-wrap'), false);
    assert.equal(await page.evaluate("document.getElementById('panel').hidden"), true);
    assert.equal(await page.evaluate("document.querySelector('#intro-start')"), null, '開場卡片沒有被建立');
  } finally {
    await page.close();
  }
});

test('模型解析失敗：顯示載入失敗的說明，不出現開場卡片、清單與工具列', async () => {
  const page = await openPage('dist/plant-cell.html', {
    offline: true,
    initScript: "TextDecoder.prototype.decode = function () { throw new Error('測試用：解析失敗'); };",
  });
  try {
    await page.waitFor(READY);
    assert.ok(await page.evaluate('document.documentElement.dataset.cellError'), 'dataset.cellError 應有值');
    assert.equal(await isShown(page, '#fallback'), true, '應顯示說明框');
    const text = await page.evaluate("document.getElementById('fallback').textContent");
    assert.equal(text, '模型載入失敗，請重新整理頁面再試一次。');
    assert.equal(await isShown(page, '#loading'), false, '載入提示應隱藏');
    for (const sel of ['#intro', '#list-wrap', '#toolbar']) assert.equal(await isShown(page, sel), false, `${sel} 不應顯示`);
    assert.equal(await page.evaluate("document.documentElement.dataset.cellReady || ''"), '');
  } finally {
    await page.close();
  }
});

// 畫面平均亮度（0 到 255）：在同一個工作內先繪製再把畫布縮小畫到不透明的白底上取平均
const LUMINANCE = `(() => {
  const { renderer, scene, camera } = window.__cell.view;
  renderer.render(scene, camera);
  const w = 160, h = 100;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(document.getElementById('stage'), 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (w * h);
})()`;

test('WebGL context 遺失再恢復：環境光貼圖重新產生，畫面亮度與遺失前一致', async () => {
  const page = await boot();
  try {
    await clickStart(page);
    await page.waitFor('window.__cell.lidOpen() === true', 3000);
    await settleCamera(page);
    await sleep(500);
    await page.evaluate("window.__cell.view.setAutoRotate(false)");
    const envBefore = await page.evaluate("(() => { window.__env0 = window.__cell.view.scene.environment; return true; })()");
    assert.equal(envBefore, true);
    const before = await page.evaluate(LUMINANCE);
    await page.evaluate(`(() => {
      const gl = window.__cell.view.renderer.getContext();
      window.__lose = gl.getExtension('WEBGL_lose_context');
      window.__restored = false;
      document.getElementById('stage').addEventListener('webglcontextrestored', () => { window.__restored = true; });
      window.__lose.loseContext();
    })()`);
    await sleep(300);
    await page.evaluate('window.__lose.restoreContext()');
    await page.waitFor('window.__restored === true', 5000);
    await sleep(800);
    await page.evaluate("window.__cell.view.setAutoRotate(false)");
    const after = await page.evaluate(LUMINANCE);
    const renewed = await page.evaluate('window.__cell.view.scene.environment !== window.__env0');
    console.log('context 恢復亮度', JSON.stringify({ before: +before.toFixed(2), after: +after.toFixed(2), renewed }));
    assert.ok(before > 20, `遺失前的畫面應有內容，亮度 ${before}`);
    assert.ok(Math.abs(after / before - 1) < 0.03, `恢復後亮度應與遺失前相差不到 3%：${before.toFixed(2)} -> ${after.toFixed(2)}`);
    assert.equal(renewed, true, '恢復後環境光貼圖應是新的物件');
  } finally {
    await page.close();
  }
});

test('放開滑鼠也算使用者操作：自轉中放開滑鼠立刻停止自轉', async () => {
  const page = await boot();
  try {
    await clickStart(page);
    await page.waitFor('window.__cell.lidOpen() === true', 3000);
    await page.waitFor('window.__cell.autoRotating() === true', 8000);
    await page.evaluate("window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))");
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '放開滑鼠後應停止自轉');
    await sleep(1500);
    assert.equal(await page.evaluate('window.__cell.autoRotating()'), false, '放開後 4 秒內不應自轉');
  } finally {
    await page.close();
  }
});
