// 最小的 Chrome DevTools Protocol 用戶端：無介面 Chrome + Node 內建 WebSocket，不依賴任何套件。
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPage(target, { width = 1280, height = 800, offline = false, initScript = null } = {}) {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)
    ? target
    : pathToFileURL(isAbsolute(target) ? target : resolve(ROOT, target)).href;

  const profile = resolve(ROOT, '.chrome-profile', `p-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });
  let exited = false;
  const exitP = new Promise((r) => chrome.once('exit', () => { exited = true; r(); }));

  let ws = null;
  const cleanup = async () => {
    try { ws && ws.close(); } catch {}
    if (!exited) {
      chrome.kill('SIGTERM');
      await Promise.race([exitP, sleep(3000)]);
      if (!exited) { chrome.kill('SIGKILL'); await Promise.race([exitP, sleep(2000)]); }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  try {
    // 取得除錯埠
    const portFile = resolve(profile, 'DevToolsActivePort');
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      else await sleep(100);
    }
    if (!port) throw new Error('Chrome 沒有在時限內啟動');
    let wsUrl = null;
    for (let i = 0; i < 50 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
      } catch {}
      if (!wsUrl) await sleep(100);
    }
    if (!wsUrl) throw new Error('找不到頁面目標');

    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 連線失敗')); });

    let nextId = 1;
    const pending = new Map();
    const listeners = [];
    const consoleErrors = [];
    const requests = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        msg.error ? p.rej(new Error(`${p.method}: ${msg.error.message}`)) : p.res(msg.result);
      } else {
        for (const l of listeners) l(msg);
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej, method });
      ws.send(JSON.stringify({ id, method, params }));
    });

    listeners.push((m) => {
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        consoleErrors.push(d.exception?.description ?? d.text);
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`.trim());
      } else if (m.method === 'Network.requestWillBeSent') {
        requests.push(m.params.request.url);
      }
    });

    await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable'), send('Network.enable')]);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (offline) {
      await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
    await send('Page.navigate', { url });

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error(`evaluate 失敗：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n運算式：${expr}`);
      }
      return r.result.value;
    };

    const mouse = (type, x, y, extra = {}) =>
      send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });

    return {
      consoleErrors,
      requests,
      evaluate,
      async waitFor(expr, timeoutMs = 15000) {
        const t0 = Date.now();
        let lastErr = null;
        while (Date.now() - t0 < timeoutMs) {
          try { if (await evaluate(expr)) return; } catch (e) { lastErr = e; }
          await sleep(100);
        }
        throw new Error(`waitFor 逾時（${timeoutMs} ms）：${expr}${lastErr ? `\n最後一次錯誤：${lastErr.message}` : ''}`);
      },
      async click(x, y) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await mouse('mousePressed', x, y, { buttons: 1 });
        await mouse('mouseReleased', x, y, { buttons: 0 });
      },
      async tap(x, y) {
        await send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      async mouseMove(x, y) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      },
      async drag(x1, y1, x2, y2, steps = 12) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
        await mouse('mousePressed', x1, y1, { buttons: 1 });
        for (let i = 1; i <= steps; i++) {
          const x = x1 + ((x2 - x1) * i) / steps;
          const y = y1 + ((y2 - y1) * i) / steps;
          await mouse('mouseMoved', x, y, { buttons: 1 });
          await sleep(16);
        }
        await mouse('mouseReleased', x2, y2, { buttons: 0 });
        await sleep(600); // 等阻尼收斂
      },
      async screenshot(path) {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = isAbsolute(path) ? path : resolve(ROOT, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
      },
      close: cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
