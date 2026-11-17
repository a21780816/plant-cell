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
