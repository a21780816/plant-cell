import test from 'node:test';
import assert from 'node:assert/strict';
import { placeHoverName } from '../web/src/ui/hover-name.js';

const V = { viewportWidth: 1280, viewportHeight: 800, width: 100, height: 30 };
const inside = (p, v = V) =>
  p.left >= 0 && p.top >= 0 && p.left + v.width <= v.viewportWidth && p.top + v.height <= v.viewportHeight;

test('一般位置：在游標右下方 14 像素', () => {
  assert.deepEqual(placeHoverName({ ...V, x: 400, y: 300 }), { left: 414, top: 314 });
});

test('靠右緣：改到游標左邊', () => {
  const p = placeHoverName({ ...V, x: 1250, y: 300 });
  assert.deepEqual(p, { left: 1250 - 14 - 100, top: 314 });
  assert.ok(inside(p));
});

test('靠下緣：改到游標上方', () => {
  const p = placeHoverName({ ...V, x: 400, y: 790 });
  assert.deepEqual(p, { left: 414, top: 790 - 14 - 30 });
  assert.ok(inside(p));
});

test('右下角：左上方', () => {
  const p = placeHoverName({ ...V, x: 1279, y: 799 });
  assert.deepEqual(p, { left: 1279 - 14 - 100, top: 799 - 14 - 30 });
  assert.ok(inside(p));
});

test('左上角：右下方且完整在視窗內', () => {
  const p = placeHoverName({ ...V, x: 0, y: 0 });
  assert.deepEqual(p, { left: 14, top: 14 });
  assert.ok(inside(p));
});

test('視窗比標籤小：貼齊左上', () => {
  const p = placeHoverName({ x: 10, y: 10, width: 100, height: 30, viewportWidth: 80, viewportHeight: 20 });
  assert.deepEqual(p, { left: 0, top: 0 });
});

test('自訂 gap', () => {
  assert.deepEqual(placeHoverName({ ...V, x: 400, y: 300, gap: 20 }), { left: 420, top: 320 });
});
