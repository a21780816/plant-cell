import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, createStore } from '../web/src/state.js';

test('select 後 selected 等於給定值，inst 預設為 null', () => {
  const s = reduce(initialState, { type: 'select', id: 'nucleus', inst: 0 });
  assert.deepEqual(s.selected, { id: 'nucleus', inst: 0 });
  const t = reduce(initialState, { type: 'select', id: 'ribosome' });
  assert.deepEqual(t.selected, { id: 'ribosome', inst: null });
});

test('連續兩次 select 以後者為準；deselect 清空', () => {
  let s = reduce(initialState, { type: 'select', id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'select', id: 'mitochondrion', inst: 3 });
  assert.deepEqual(s.selected, { id: 'mitochondrion', inst: 3 });
  s = reduce(s, { type: 'deselect' });
  assert.equal(s.selected, null);
});

test('hover 與 unhover 不影響 selected', () => {
  let s = reduce(initialState, { type: 'select', id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'hover', id: 'vacuole', inst: 0 });
  assert.deepEqual(s.hovered, { id: 'vacuole', inst: 0 });
  assert.deepEqual(s.selected, { id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'unhover' });
  assert.equal(s.hovered, null);
  assert.deepEqual(s.selected, { id: 'nucleus', inst: 0 });
});

test('reduce 不改動傳入的物件', () => {
  const before = structuredClone(initialState);
  const frozen = Object.freeze({ ...initialState });
  reduce(frozen, { type: 'select', id: 'nucleus', inst: 0 });
  reduce(frozen, { type: 'hover', id: 'nucleus', inst: 0 });
  assert.deepEqual(initialState, before);
  assert.equal(frozen.selected, null);
});

test('subscribe 的函式在 dispatch 後被呼叫一次，unsubscribe 後不再被呼叫', () => {
  const store = createStore();
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
