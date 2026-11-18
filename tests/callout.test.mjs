import test from 'node:test';
import assert from 'node:assert/strict';
import { calloutGeometry, calloutTargetOf } from '../web/src/callout.js';

const STAGE = { left: 0, top: 0, right: 1280, bottom: 800 }, PANEL = { left: 924, top: 16, right: 1264, bottom: 500 };
const HIDDEN = { visible: false, x1: 0, y1: 0, x2: 0, y2: 0 };
const g = (o = {}) => calloutGeometry({ mode: 'wide', panel: PANEL, dot: { x: 955, y: 57 }, target: { x: 600, y: 400 }, stage: STAGE, ...o });

test('wide 與 short：起點 x 是面板左緣、y 是色點中心，終點是目標點', () => {
  const want = { visible: true, x1: 924, y1: 57, x2: 600, y2: 400 };
  assert.deepEqual(g(), want);
  assert.deepEqual(g({ mode: 'short' }), want);
});

test('wide：色點捲出面板時 y 夾在面板上下緣', () => {
  assert.equal(g({ dot: { x: 955, y: -20 } }).y1, 16);
  assert.equal(g({ dot: { x: 955, y: 640 } }).y1, 500);
});

test('narrow：起點 y 是面板上緣、x 是色點中心並夾在左右緣', () => {
  const o = { mode: 'narrow', stage: { left: 0, top: 0, right: 390, bottom: 416 }, panel: { left: 12, top: 420, right: 378, bottom: 788 }, target: { x: 200, y: 200 } };
  assert.deepEqual(g({ ...o, dot: { x: 43, y: 455 } }), { visible: true, x1: 43, y1: 420, x2: 200, y2: 200 });
  assert.equal(g({ ...o, dot: { x: 5, y: 455 } }).x1, 12);
  assert.equal(g({ ...o, dot: { x: 500, y: 455 } }).x1, 378);
});

test('面板或目標點為 null 時不顯示，座標全為 0', () => {
  assert.deepEqual(g({ panel: null }), HIDDEN);
  assert.deepEqual(g({ target: null }), HIDDEN);
});

test('目標點要在畫布內縮 4 像素以內（含邊界）', () => {
  const t = (x, y) => g({ target: { x, y } }).visible;
  assert.equal(t(4, 400), true);
  assert.equal(t(1276, 400), true);
  assert.equal(t(3, 400), false);
  assert.equal(t(1277, 400), false);
  assert.equal(t(600, 4), true);
  assert.equal(t(600, 796), true);
  assert.equal(t(600, 3), false);
  assert.equal(t(600, 797), false);
});

test('目標點落在面板矩形內（含邊緣）不顯示', () => {
  assert.deepEqual(g({ target: { x: 1000, y: 200 } }), HIDDEN);
  assert.deepEqual(g({ target: { x: 924, y: 200 } }), HIDDEN);
  assert.equal(g({ target: { x: 923, y: 200 } }).visible, true);
});

test('線長小於 12 不顯示、等於 12 顯示', () => {
  const o = { dot: { x: 955, y: 300 } };
  assert.deepEqual(g({ ...o, target: { x: 913, y: 300 } }), HIDDEN);
  assert.equal(g({ ...o, target: { x: 912, y: 300 } }).visible, true);
});

test('座標四捨五入成整數', () => {
  const r = g({ dot: { x: 955.4, y: 57.6 }, target: { x: 600.5, y: 399.4 } });
  assert.deepEqual(r, { visible: true, x1: 924, y1: 58, x2: 601, y2: 399 });
});

test('calloutTargetOf：清單選用錨點，點選非代表個體用該個體根，代表個體、找不到的個體與外殼類用錨點', () => {
  const rep = { userData: { inst: 0 } }, other = { userData: { inst: 1 } }, anchor = { userData: {} };
  const e = { rep, anchor, instances: [rep, other] };
  assert.equal(calloutTargetOf(e, { id: 'nucleus', inst: null }), anchor);
  assert.equal(calloutTargetOf(e, { id: 'nucleus', inst: 1 }), other);
  assert.equal(calloutTargetOf(e, { id: 'nucleus', inst: 0 }), anchor);
  assert.equal(calloutTargetOf(e, { id: 'nucleus', inst: 7 }), anchor);
  assert.equal(calloutTargetOf(e, { id: 'cell_wall', inst: 1 }), anchor);
  assert.equal(calloutTargetOf({ rep, anchor: null, instances: [rep] }, { id: 'nucleus', inst: null }), rep);
  assert.equal(calloutTargetOf(undefined, { id: 'x', inst: null }), null);
});
