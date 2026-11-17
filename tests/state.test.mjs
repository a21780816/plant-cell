import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, createStore } from '../web/src/state.js';

// 開場階段只接受 start；既有行為都在探索階段驗證。
const explore = reduce(initialState, { type: 'start' });

test('起始 phase 是 intro；start 之後變 explore', () => {
  assert.equal(initialState.phase, 'intro');
  assert.equal(explore.phase, 'explore');
  assert.equal(reduce(explore, { type: 'start' }), explore, '已在探索階段時 start 不改變狀態');
});

test('intro 階段除了 start 以外的動作一律不改變狀態', () => {
  for (const action of [
    { type: 'select', id: 'nucleus', inst: 0 },
    { type: 'deselect' },
    { type: 'hover', id: 'nucleus', inst: 0 },
    { type: 'unhover' },
    { type: 'noop' },
  ]) {
    assert.equal(reduce(initialState, action), initialState, `${action.type} 在 intro 階段應無效`);
  }
  assert.equal(initialState.selected, null);
});

test('intro 階段 select 無效，start 之後 select 有效', () => {
  const store = createStore();
  store.dispatch({ type: 'select', id: 'nucleus', inst: 0 });
  assert.equal(store.getState().selected, null);
  store.dispatch({ type: 'start' });
  store.dispatch({ type: 'select', id: 'nucleus', inst: 0 });
  assert.deepEqual(store.getState().selected, { id: 'nucleus', inst: 0 });
});

test('select 後 selected 等於給定值，inst 預設為 null', () => {
  const s = reduce(explore, { type: 'select', id: 'nucleus', inst: 0 });
  assert.deepEqual(s.selected, { id: 'nucleus', inst: 0 });
  const t = reduce(explore, { type: 'select', id: 'ribosome' });
  assert.deepEqual(t.selected, { id: 'ribosome', inst: null });
});

test('連續兩次 select 以後者為準；deselect 清空', () => {
  let s = reduce(explore, { type: 'select', id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'select', id: 'mitochondrion', inst: 3 });
  assert.deepEqual(s.selected, { id: 'mitochondrion', inst: 3 });
  s = reduce(s, { type: 'deselect' });
  assert.equal(s.selected, null);
});

test('hover 與 unhover 不影響 selected', () => {
  let s = reduce(explore, { type: 'select', id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'hover', id: 'vacuole', inst: 0 });
  assert.deepEqual(s.hovered, { id: 'vacuole', inst: 0 });
  assert.deepEqual(s.selected, { id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'unhover' });
  assert.equal(s.hovered, null);
  assert.deepEqual(s.selected, { id: 'nucleus', inst: 0 });
});

test('reduce 不改動傳入的物件', () => {
  const before = structuredClone(explore);
  const frozen = Object.freeze({ ...explore });
  reduce(frozen, { type: 'select', id: 'nucleus', inst: 0 });
  reduce(frozen, { type: 'hover', id: 'nucleus', inst: 0 });
  assert.deepEqual(explore, before);
  assert.equal(frozen.selected, null);
  const introBefore = structuredClone(initialState);
  reduce(Object.freeze({ ...initialState }), { type: 'start' });
  assert.deepEqual(initialState, introBefore);
});

test('subscribe 的函式在 dispatch 後被呼叫一次，unsubscribe 後不再被呼叫', () => {
  const store = createStore();
  store.dispatch({ type: 'start' });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.dispatch({ type: 'select', id: 'nucleus', inst: 0 });
  assert.equal(calls, 1);
  assert.equal(store.getState().selected.id, 'nucleus');
  off();
  store.dispatch({ type: 'deselect' });
  assert.equal(calls, 1);
  assert.equal(store.getState().selected, null);
});

test('toggleExplode 與 toggleLabels 各切換一次（先 start）', () => {
  assert.equal(explore.exploded, false);
  assert.equal(explore.labels, false);
  const a = reduce(explore, { type: 'toggleExplode' });
  assert.equal(a.exploded, true);
  assert.equal(a.labels, false);
  assert.equal(reduce(a, { type: 'toggleExplode' }).exploded, false);
  const b = reduce(explore, { type: 'toggleLabels' });
  assert.equal(b.labels, true);
  assert.equal(b.exploded, false);
  assert.equal(reduce(b, { type: 'toggleLabels' }).labels, false);
  assert.equal(explore.exploded, false, '不改動傳入的狀態');
});

test('toggleExplode 與 toggleLabels 不影響選取；intro 階段無效', () => {
  const sel = reduce(explore, { type: 'select', id: 'nucleus', inst: 0 });
  const t = reduce(reduce(sel, { type: 'toggleExplode' }), { type: 'toggleLabels' });
  assert.deepEqual(t.selected, { id: 'nucleus', inst: 0 });
  assert.equal(reduce(initialState, { type: 'toggleExplode' }), initialState);
  assert.equal(reduce(initialState, { type: 'toggleLabels' }), initialState);
});
