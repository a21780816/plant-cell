import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuiz } from '../web/src/quiz.js';
import { QUIZ_IDS } from '../web/src/organelles.js';

// 固定亂數：簡單的線性同餘產生器，同一個種子每次序列相同。
const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const order = (quiz) => {
  const out = [];
  while (!quiz.finished) { out.push(quiz.currentId); quiz.answer(quiz.currentId); }
  return out;
};

test('13 個構造抽 10 題：total 為 10、題目不重複、都來自題庫', () => {
  assert.equal(QUIZ_IDS.length, 13);
  const q = createQuiz({ ids: QUIZ_IDS, count: 10 });
  assert.equal(q.total, 10);
  assert.equal(q.index, 0);
  assert.equal(q.finished, false);
  const seq = order(q);
  assert.equal(seq.length, 10);
  assert.equal(new Set(seq).size, 10, '題目不重複');
  for (const id of seq) assert.ok(QUIZ_IDS.includes(id));
});

test('預設 count 是 10；題庫只有 3 個時 total 為 3', () => {
  assert.equal(createQuiz({ ids: QUIZ_IDS }).total, 10);
  const q = createQuiz({ ids: ['nucleus', 'golgi', 'vacuole'], count: 10 });
  assert.equal(q.total, 3);
  assert.deepEqual([...order(q)].sort(), ['golgi', 'nucleus', 'vacuole']);
});

test('固定的 rng 得到相同題序；不同的 rng 通常題序不同；不改動傳入的 ids', () => {
  const ids = [...QUIZ_IDS];
  const a = order(createQuiz({ ids, count: 10, rng: seeded(7) }));
  const b = order(createQuiz({ ids, count: 10, rng: seeded(7) }));
  assert.deepEqual(a, b);
  const c = order(createQuiz({ ids, count: 10, rng: seeded(12345) }));
  assert.notDeepEqual(a, c);
  assert.deepEqual(ids, QUIZ_IDS, 'ids 不被改動');
});

test('預設的 Math.random：連續多局的題序不會全部相同', () => {
  const seqs = new Set();
  for (let i = 0; i < 8; i++) seqs.add(order(createQuiz({ ids: QUIZ_IDS, count: 10 })).join());
  assert.ok(seqs.size > 1);
});

test('答對加 1 分、答錯不加；expectedId 等於作答前的 currentId；作答後前進', () => {
  const q = createQuiz({ ids: QUIZ_IDS, count: 10, rng: seeded(1) });
  const first = q.currentId;
  const r1 = q.answer(first);
  assert.deepEqual(r1, { correct: true, expectedId: first });
  assert.equal(q.score, 1);
  assert.equal(q.index, 1);
  assert.notEqual(q.currentId, first);

  const second = q.currentId;
  const wrong = QUIZ_IDS.find((id) => id !== second);
  const r2 = q.answer(wrong);
  assert.deepEqual(r2, { correct: false, expectedId: second });
  assert.equal(q.score, 1, '答錯不加分');
  assert.equal(q.index, 2);
});

test('答完最後一題 finished 為 true、currentId 為 null、分數正確；之後再作答不計分', () => {
  const q = createQuiz({ ids: ['nucleus', 'golgi', 'vacuole'], count: 3, rng: seeded(3) });
  q.answer(q.currentId);
  q.answer('cell_wall');
  assert.equal(q.finished, false);
  q.answer(q.currentId);
  assert.equal(q.finished, true);
  assert.equal(q.currentId, null);
  assert.equal(q.score, 2);
  assert.equal(q.index, 3);
  const extra = q.answer('nucleus');
  assert.equal(extra.correct, false);
  assert.equal(q.score, 2, '結束後的作答不計分');
  assert.equal(q.index, 3);
});
