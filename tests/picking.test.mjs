import test from 'node:test';
import assert from 'node:assert/strict';
import { isClick } from '../web/src/picking.js';

test('isClick：位移 5 像素以內算點選', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 13, y: 14 }), true);
});

test('isClick：位移 6 像素算拖曳', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 16, y: 10 }), false);
});
