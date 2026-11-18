import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createCameraMoves } from '../web/src/camera-moves.js';

const DIR = new Vector3(0.6, 0, 0.8);
const TARGET = new Vector3(1, 2, 3);

function setup() {
  const camera = new PerspectiveCamera();
  const target = TARGET.clone();
  const listeners = {};
  const controls = {
    target, minDistance: 2.5, maxDistance: 36,
    update() {},
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  const reset = () => camera.position.copy(target).addScaledVector(DIR, 10);
  reset();
  const moves = createCameraMoves({ camera, controls });
  const dist = () => camera.position.distanceTo(controls.target);
  return { camera, controls, listeners, moves, reset, dist };
}

test('scaleDistance：0.8 秒平滑到開始長度 × k，方向與目標不變，結果夾在 min／max 之間', () => {
  const { camera, controls, moves, reset, dist } = setup();
  moves.scaleDistance(0.8);
  moves.update(0.4);
  assert.ok(dist() > 8 && dist() < 10, `中途距離 ${dist()}`);
  assert.ok(moves.busy);
  moves.update(0.4);
  assert.ok(Math.abs(dist() - 8) < 1e-9);
  assert.equal(moves.busy, false);
  const dir = camera.position.clone().sub(controls.target).normalize();
  assert.ok(dir.dot(DIR) > 1 - 1e-9);
  assert.ok(controls.target.distanceTo(TARGET) < 1e-12);
  reset(); moves.scaleDistance(0.1); moves.update(0.8);
  assert.ok(Math.abs(dist() - 2.5) < 1e-9);
  reset(); moves.scaleDistance(10); moves.update(0.8);
  assert.ok(Math.abs(dist() - 36) < 1e-9);
});

test('scaleDistance：controls 的 start 事件（使用者拖曳或縮放）立刻中止', () => {
  const { camera, listeners, moves } = setup();
  moves.scaleDistance(0.5);
  moves.update(0.2);
  listeners.start();
  assert.equal(moves.busy, false);
  const p = camera.position.clone();
  moves.update(0.4);
  assert.ok(camera.position.distanceTo(p) === 0);
});

test('scaleDistance：進行中再呼叫會把新比例乘進終點，跑完回到開始的長度', () => {
  const { camera, controls, moves, dist } = setup();
  moves.scaleDistance(0.8);
  moves.update(0.4);
  moves.scaleDistance(1.25);
  assert.ok(moves.busy);
  moves.update(0.8);
  assert.equal(moves.busy, false);
  assert.ok(Math.abs(dist() - 10) < 1e-6, `距離 ${dist()}`);
  assert.ok(camera.position.clone().sub(controls.target).normalize().dot(DIR) > 1 - 1e-9);
  assert.ok(controls.target.distanceTo(TARGET) < 1e-12);
});

test('scaleDistance：進行中的不是尺度動畫（focus、home）時，照舊從目前位置另起一段', () => {
  const { camera, controls, moves, dist } = setup();
  const home = createCameraMoves({
    camera, controls,
    defaultPose: () => ({ target: TARGET.clone(), position: TARGET.clone().addScaledVector(DIR, 20) }),
  });
  home.home();
  home.update(0.4);
  const d = dist();
  home.scaleDistance(0.5); // 取代 home：從目前長度起算
  home.update(0.8);
  assert.ok(Math.abs(dist() - Math.max(2.5, d * 0.5)) < 1e-6, `距離 ${dist()} 應為 ${d * 0.5}`);
  void moves;
});
