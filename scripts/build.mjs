// 把網頁程式、樣式、模型內嵌成單一 dist/plant-cell.html。
import { readFileSync, writeFileSync, mkdirSync, statSync, watch, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist/plant-cell.html');
const GLB = resolve(ROOT, 'assets/plant_cell.glb');

const options = (minify) => ({
  entryPoints: [resolve(ROOT, 'web/src/main.js')],
  bundle: true,
  format: 'iife',
  minify,
  write: false,
  outfile: resolve(ROOT, 'dist/main.js'),
  loader: { '.glb': 'binary', '.css': 'text', '.json': 'json' },
  logLevel: 'silent',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 模型可能正被別人重寫：標頭記的總長度必須等於檔案大小才算寫完。
function glbComplete() {
  try {
    const buf = readFileSync(GLB);
    return buf.length >= 12 && buf.readUInt32LE(0) === 0x46546c67 && buf.readUInt32LE(8) === buf.length;
  } catch { return false; }
}

async function waitForGlb() {
  for (let i = 0; i < 10 && !glbComplete(); i++) await sleep(3000);
  if (!glbComplete()) throw new Error(`模型檔不完整或不存在：${GLB}`);
}

function assemble(jsText) {
  const css = readFileSync(resolve(ROOT, 'web/styles.css'), 'utf8');
  const template = readFileSync(resolve(ROOT, 'web/template.html'), 'utf8');
  const js = jsText.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const style = css.replace(/<\/style/gi, '<\\/style');
  const html = template
    .replace('<!--STYLE-->', () => style)
    .replace('<!--SCRIPT-->', () => js);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  return { outfile: OUT, bytes: statSync(OUT).size };
}

export async function build({ minify = true } = {}) {
  await waitForGlb();
  const result = await esbuild.build(options(minify));
  return assemble(result.outputFiles[0].text);
}

async function watchAndServe(argv) {
  if (argv.includes('--watch')) {
    await waitForGlb();
    const rebuild = {
      name: 'assemble',
      setup(b) {
        b.onEnd((r) => {
          if (r.errors.length) { console.error('建置失敗', r.errors[0].text); return; }
          if (!glbComplete()) {
            console.warn('模型檔尚未寫完（可能正在重建），跳過這次重建；寫完後會自動再建');
            return;
          }
          try {
            const o = assemble(r.outputFiles[0].text);
            console.log(`已重建 ${o.outfile}（${(o.bytes / 1048576).toFixed(2)} MB）`);
          } catch (e) {
            console.error('組裝 HTML 失敗', e);
          }
        });
      },
    };
    const ctx = await esbuild.context({ ...options(false), plugins: [rebuild] });
    await ctx.watch();
    let timer = null;
    for (const f of ['web/styles.css', 'web/template.html']) {
      watch(resolve(ROOT, f), () => {
        clearTimeout(timer);
        timer = setTimeout(() => ctx.rebuild().catch(() => {}), 100);
      });
    }
  } else {
    console.log(await build());
  }
  if (argv.includes('--serve')) {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };
    createServer((req, res) => {
      let p = new URL(req.url, 'http://x').pathname;
      if (p === '/') p = '/plant-cell.html';
      const file = resolve(ROOT, 'dist', '.' + p);
      if (!file.startsWith(resolve(ROOT, 'dist')) || !existsSync(file)) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    }).listen(5173, () => console.log('http://localhost:5173/'));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--watch') || argv.includes('--serve')) {
    watchAndServe(argv).catch((e) => { console.error(e); process.exit(1); });
  } else {
    build().then((o) => console.log(`${o.outfile} ${o.bytes} bytes`))
      .catch((e) => { console.error(e); process.exit(1); });
  }
}
