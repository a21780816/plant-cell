import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitDistance } from '../web/src/scene.js';

const HALF = [8.9, 3.5, 5];
const DIR = [0.62, 0.48, 0.62];
const corners = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  corners.push([sx * HALF[0], sy * HALF[1], sz * HALF[2]]);
}

function fit(aspect, margin) {
  const args = { corners, target: [0, 0, 0], dir: DIR, fovDeg: 36, aspect };
  if (margin !== undefined) args.margin = margin;
  return fitDistance(args);
}

// 用算出的距離擺相機，回傳 8 個角在標準化裝置座標的最大 |x|、|y|。
function worst(aspect, dist) {
  const cam = new PerspectiveCamera(36, aspect, 0.1, 500);
  cam.position.fromArray(DIR).normalize().multiplyScalar(dist);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  let m = 0;
  for (const c of corners) {
    const p = new Vector3(...c).project(cam);
    assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, `角 ${c} 出界：${p.x}, ${p.y}`);
    m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  }
  return m;
}

test('8 個角都入鏡且貼近邊緣', () => {
  for (const aspect of [1.6, 0.5]) {
    const m = worst(aspect, fit(aspect));
    assert.ok(m >= 0.9, `aspect ${aspect} 框太鬆：${m}`);
  }
});

test('窄螢幕需要更遠', () => {
  assert.ok(fit(0.5) > fit(1.6));
});

test('margin 為 1 時剛好貼邊', () => {
  for (const aspect of [1.6, 0.5]) {
    const m = worst(aspect, fit(aspect, 1) * 1.0001);
    assert.ok(Math.abs(1 - m) < 0.01, `aspect ${aspect}：${m}`);
  }
});

// ---- fitToRect：依實際點放進「可用範圍」並置中 ----
import { fitToRect } from '../web/src/scene.js';

// 六角柱的 12 個頂點（半長 8.49、半寬 3.5×1.286、半高 3.575），再補幾個偏心的點，形狀不對稱
function hexPoints() {
  const pts = [];
  for (const y of [-3.575, 3.575]) {
    pts.push([8.49, y, 0], [-8.49, y, 0], [5.9, y, 4.5], [-5.9, y, 4.5], [5.9, y, -4.5], [-5.9, y, -4.5]);
  }
  pts.push([2, 3, 5.26], [-7, -3, -5.26]);
  return pts;
}

// 用 three 的相機（含 setViewOffset）獨立投影，回傳像素範圍
function projectedBounds(points, { distance, offset }, { width, height }) {
  const cam = new PerspectiveCamera(36, width / height, 0.1, 500);
  const dir = new Vector3(...DIR).normalize();
  cam.position.copy(dir).multiplyScalar(distance);
  cam.lookAt(0, 0, 0);
  cam.setViewOffset(width, height, -offset.x, -offset.y, width, height);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of points) {
    const v = new Vector3(...p).project(cam);
    const x = ((v.x + 1) / 2) * width;
    const y = ((1 - v.y) / 2) * height;
    l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
  }
  return { left: l, right: r, top: t, bottom: b };
}

const CASES = [
  { name: '1280×800，底部保留 130 像素', width: 1280, height: 800, rect: { left: 0, top: 16, right: 1280, bottom: 670 } },
  { name: '390×416 窄螢幕', width: 390, height: 416, rect: { left: 0, top: 48, right: 390, bottom: 408 } },
  { name: '900×420 矮視窗', width: 900, height: 420, rect: { left: 0, top: 16, right: 900, bottom: 336 } },
];

for (const c of CASES) {
  for (const margin of [1.04, 1]) {
    test(`fitToRect：${c.name}、留白 ${margin}：範圍在矩形內、置中、至少一邊貼滿`, () => {
      const points = hexPoints();
      const fit = fitToRect({ points, target: [0, 0, 0], dir: DIR, fovDeg: 36, width: c.width, height: c.height, rect: c.rect, margin });
      const b = projectedBounds(points, fit, c);
      const eps = 1e-3;
      assert.ok(b.left >= c.rect.left - eps && b.right <= c.rect.right + eps && b.top >= c.rect.top - eps && b.bottom <= c.rect.bottom + eps, `出界 ${JSON.stringify(b)}`);
      const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      assert.ok(Math.abs(cx - (c.rect.left + c.rect.right) / 2) < 1, `水平中心偏 ${cx}`);
      assert.ok(Math.abs(cy - (c.rect.top + c.rect.bottom) / 2) < 1, `垂直中心偏 ${cy}`);
      const rw = c.rect.right - c.rect.left, rh = c.rect.bottom - c.rect.top;
      const fillW = (b.right - b.left) / rw, fillH = (b.bottom - b.top) / rh;
      assert.ok(Math.max(fillW, fillH) >= (1 / margin) * 0.99, `填滿率 ${fillW}, ${fillH}`);
      assert.ok(Math.max(fillW, fillH) <= (1 / margin) * 1.01, `不可超過 1/留白：${fillW}, ${fillH}`);
    });
  }
}

test('fitToRect：可用範圍越矮距離越遠；平面陣列與巢狀陣列結果相同；單次不超過 10 毫秒', () => {
  const points = hexPoints();
  const base = { target: [0, 0, 0], dir: DIR, fovDeg: 36, width: 1280, height: 800, margin: 1.04 };
  const tall = fitToRect({ ...base, points, rect: { left: 0, top: 0, right: 1280, bottom: 800 } });
  const short = fitToRect({ ...base, points, rect: { left: 0, top: 0, right: 1280, bottom: 500 } });
  assert.ok(short.distance > tall.distance);
  const flat = fitToRect({ ...base, points: new Float32Array(points.flat()), rect: { left: 0, top: 0, right: 1280, bottom: 800 } });
  assert.ok(Math.abs(flat.distance - tall.distance) < 1e-3);
  const many = [];
  for (let i = 0; i < 8000; i++) many.push(points[i % points.length].map((v, k) => v * (0.5 + ((i * 7 + k) % 10) / 20)));
  const t0 = performance.now();
  fitToRect({ ...base, points: many, rect: { left: 0, top: 16, right: 1280, bottom: 670 } });
  assert.ok(performance.now() - t0 < 10, `耗時 ${performance.now() - t0} ms`);
});
