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

// ---- 測驗（Review Focus 3）：每個測試都先 start ----
test('quizStart：phase 變 quiz；選取與滑過清空、標籤與拆解關閉，原值存進 quiz.saved', () => {
  let s = reduce(explore, { type: 'toggleLabels' });
  s = reduce(s, { type: 'toggleExplode' });
  s = reduce(s, { type: 'select', id: 'nucleus', inst: 0 });
  s = reduce(s, { type: 'hover', id: 'golgi', inst: 0 });
  assert.equal(s.labels, true);
  assert.equal(s.exploded, true);
  const q = reduce(s, { type: 'quizStart' });
  assert.equal(q.phase, 'quiz');
  assert.equal(q.labels, false);
  assert.equal(q.exploded, false);
  assert.equal(q.selected, null);
  assert.equal(q.hovered, null);
  assert.deepEqual(q.quiz, { saved: { labels: true, exploded: true }, reveal: null });
  assert.equal(s.phase, 'explore', '不改動傳入的狀態');
  assert.equal(s.labels, true);
});

test('quizStart 在 intro 階段無效；已在測驗中再 quizStart 不改變狀態（不覆蓋 saved）', () => {
  assert.equal(reduce(initialState, { type: 'quizStart' }), initialState);
  const q = reduce(reduce(explore, { type: 'toggleLabels' }), { type: 'quizStart' });
  assert.equal(reduce(q, { type: 'quizStart' }), q);
});

test('測驗中 select、toggleExplode、toggleLabels 不改變狀態；deselect 與 hover 照常', () => {
  const q = reduce(explore, { type: 'quizStart' });
  for (const action of [
    { type: 'select', id: 'nucleus', inst: 0 },
    { type: 'select', id: 'ribosome' },
    { type: 'toggleExplode' },
    { type: 'toggleLabels' },
  ]) {
    assert.equal(reduce(q, action), q, `${action.type} 在測驗中應無效`);
  }
  const h = reduce(q, { type: 'hover', id: 'vacuole', inst: 1 });
  assert.deepEqual(h.hovered, { id: 'vacuole', inst: 1 });
  assert.equal(reduce(h, { type: 'unhover' }).hovered, null);
});

test('quizExit：回到 explore，還原 labels 與 exploded，quiz 設為 null', () => {
  let s = reduce(explore, { type: 'toggleLabels' });
  s = reduce(s, { type: 'toggleExplode' });
  const q = reduce(s, { type: 'quizStart' });
  const back = reduce(q, { type: 'quizExit' });
  assert.equal(back.phase, 'explore');
  assert.equal(back.labels, true);
  assert.equal(back.exploded, true);
  assert.equal(back.quiz, null);
  assert.equal(back.selected, null);
  // 測驗中的揭曉也一併清掉
  const revealing = reduce(q, { type: 'quizReveal', id: 'nucleus', correct: true });
  assert.equal(reduce(revealing, { type: 'quizExit' }).quiz, null);
  // 原本都是關的：還原後也是關的
  const plain = reduce(reduce(explore, { type: 'quizStart' }), { type: 'quizExit' });
  assert.equal(plain.labels, false);
  assert.equal(plain.exploded, false);
  // 探索階段 quizExit 無效；回來之後 select 又有效
  assert.equal(reduce(explore, { type: 'quizExit' }), explore);
  assert.deepEqual(reduce(back, { type: 'select', id: 'nucleus', inst: null }).selected, { id: 'nucleus', inst: null });
});

test('quizReveal 與 quizNext：測驗階段有效、探索與開場階段無效', () => {
  const q = reduce(explore, { type: 'quizStart' });
  const r = reduce(q, { type: 'quizReveal', id: 'golgi', correct: false });
  assert.deepEqual(r.quiz.reveal, { id: 'golgi', correct: false });
  assert.deepEqual(r.quiz.saved, q.quiz.saved, '揭曉不動 saved');
  assert.equal(r.phase, 'quiz');
  const n = reduce(r, { type: 'quizNext' });
  assert.equal(n.quiz.reveal, null);
  assert.equal(q.quiz.reveal, null, '不改動傳入的狀態');
  assert.equal(reduce(explore, { type: 'quizReveal', id: 'golgi', correct: true }), explore);
  assert.equal(reduce(explore, { type: 'quizNext' }), explore);
  assert.equal(reduce(initialState, { type: 'quizReveal', id: 'golgi', correct: true }), initialState);
  assert.equal(reduce(initialState, { type: 'quizNext' }), initialState);
});

test('initialState.lang 是 zh', () => {
  assert.equal(initialState.lang, 'zh');
});

test('setLang 在 intro、explore、quiz 階段都有效，只改 lang', () => {
  const quiz = reduce(explore, { type: 'quizStart' });
  for (const s of [initialState, explore, quiz]) {
    const s2 = reduce(s, { type: 'setLang', lang: 'en' });
    assert.equal(s2.lang, 'en');
    assert.deepEqual({ ...s2, lang: s.lang }, s);
  }
});

test('setLang 給不支援的值或目前的語言時回傳原物件', () => {
  for (const lang of ['fr', undefined, 'zh']) {
    assert.equal(reduce(explore, { type: 'setLang', lang }), explore);
  }
});

test('以英文起始的 store，其他動作不改 lang', () => {
  const store = createStore({ ...initialState, lang: 'en' });
  for (const action of [
    { type: 'start' }, { type: 'select', id: 'nucleus', inst: 0 }, { type: 'toggleExplode' },
    { type: 'quizStart' }, { type: 'quizExit' },
  ]) {
    store.dispatch(action);
    assert.equal(store.getState().lang, 'en', `${action.type} 之後`);
  }
});

test('initialState.listCollapsed 是 false', () => {
  assert.equal(initialState.listCollapsed, false);
});

test('toggleList 在 intro、explore、quiz 階段都有效，只改 listCollapsed', () => {
  const quiz = reduce(explore, { type: 'quizStart' });
  for (const s of [initialState, explore, quiz]) {
    const a = reduce(s, { type: 'toggleList' });
    assert.equal(a.listCollapsed, true);
    assert.deepEqual({ ...a, listCollapsed: s.listCollapsed }, s);
    assert.equal(reduce(a, { type: 'toggleList' }).listCollapsed, false);
    assert.equal(s.listCollapsed, false);
  }
});

test('其他動作不改 listCollapsed', () => {
  const store = createStore({ ...initialState, listCollapsed: true });
  for (const action of [
    { type: 'start' }, { type: 'select', id: 'nucleus', inst: 0 }, { type: 'hover', id: 'vacuole', inst: 0 },
    { type: 'unhover' }, { type: 'deselect' }, { type: 'toggleExplode' }, { type: 'toggleLabels' },
    { type: 'setLang', lang: 'en' }, { type: 'quizStart' }, { type: 'quizReveal', id: 'golgi', correct: false },
    { type: 'quizNext' }, { type: 'quizExit' }, { type: 'noop' },
  ]) {
    store.dispatch(action);
    assert.equal(store.getState().listCollapsed, true, `${action.type} 之後`);
  }
});
