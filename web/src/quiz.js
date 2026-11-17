// 測驗的題目與計分（純邏輯，不依賴 DOM 與 three.js）。
// 從 ids 不重複地抽 count 題（Fisher–Yates 洗牌，亂數由 rng 提供，固定 rng 就得到固定題序）。
// answer(id) 記分後前進到下一題；測驗結束後再呼叫不計分、不前進，所以每題只會算到第一次作答。
export function createQuiz({ ids, count = 10, rng = Math.random }) {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const questions = pool.slice(0, Math.min(count, pool.length));
  let index = 0;
  let score = 0;
  return {
    get total() { return questions.length; },
    get index() { return index; },
    get currentId() { return index < questions.length ? questions[index] : null; },
    get finished() { return index >= questions.length; },
    get score() { return score; },
    answer(id) {
      if (index >= questions.length) return { correct: false, expectedId: null };
      const expectedId = questions[index];
      const correct = id === expectedId;
      if (correct) score += 1;
      index += 1;
      return { correct, expectedId };
    },
  };
}
