// 測驗的題目卡片。root 是 #quiz；內容由這裡建立。
// 兩種外觀共用同一張卡片：出題時（進度、題目、結果、右上角的 #quiz-exit），
// 總結時（分數與兩個按鈕 #quiz-retry、#quiz-exit）。index 是 0 起算的題號（畫面上顯示 index + 1）。
// 文字依 setLang 設定的語言產生；最後一次的參數會記住，切換語言時重寫目前顯示的內容。
import { t, organelleName } from '../i18n.js';

export function mountQuizUI(root, { onExit = () => {}, onRetry = () => {} } = {}) {
  root.innerHTML = '';
  const el = (tag, id) => {
    const n = document.createElement(tag);
    if (id) n.id = id;
    return n;
  };
  let lang = 'zh';
  let lastQuestion = null;
  let lastResult = null;
  let lastSummary = null;
  const progress = el('div', 'quiz-progress');
  const question = el('div', 'quiz-question');
  const result = el('div', 'quiz-result');
  result.setAttribute('role', 'status'); // 讀螢幕報讀軟體時會唸出結果
  const summary = el('div', 'quiz-summary');
  const actions = el('div', 'quiz-actions');
  const retry = el('button', 'quiz-retry');
  retry.type = 'button';
  retry.addEventListener('click', () => onRetry());
  const exit = el('button', 'quiz-exit');
  exit.type = 'button';
  exit.addEventListener('click', () => onExit());
  actions.append(retry, exit);
  root.append(progress, question, result, summary, actions);

  const setMode = (mode) => {
    root.dataset.mode = mode;
    summary.hidden = mode !== 'summary';
    retry.hidden = mode !== 'summary';
    progress.hidden = mode !== 'question';
    question.hidden = mode !== 'question';
    result.hidden = mode !== 'question';
    root.hidden = false;
  };
  const clearResult = () => {
    result.textContent = '';
    delete result.dataset.state;
  };
  const paintButtons = () => {
    retry.textContent = t(lang, 'playAgain');
    exit.textContent = t(lang, 'endQuiz');
  };
  const paintQuestion = () => {
    if (!lastQuestion) return;
    progress.textContent = t(lang, 'quizProgress', { n: lastQuestion.index + 1, total: lastQuestion.total });
    question.textContent = t(lang, 'quizFind', { name: organelleName(lang, lastQuestion.id) });
  };
  const paintResult = () => {
    if (!lastResult) return;
    const { correct, expectedId, pickedId } = lastResult;
    result.dataset.state = correct ? 'right' : 'wrong';
    result.textContent = correct
      ? t(lang, 'quizCorrect')
      : t(lang, 'quizWrong', { picked: organelleName(lang, pickedId), expected: organelleName(lang, expectedId) });
  };
  const paintSummary = () => {
    if (lastSummary) summary.textContent = t(lang, 'quizScore', lastSummary);
  };
  paintButtons();
  setMode('question');
  root.hidden = true;

  return {
    showQuestion({ index, total, id }) {
      clearResult();
      lastResult = null;
      lastSummary = null;
      lastQuestion = { index, total, id };
      paintQuestion();
      setMode('question');
    },
    // pickedId 是使用者點到的構造；答錯時才用到
    showResult({ correct, expectedId, pickedId = null }) {
      lastResult = { correct, expectedId, pickedId };
      paintResult();
    },
    showSummary({ score, total }) {
      clearResult();
      lastResult = null;
      lastSummary = { score, total };
      paintSummary();
      setMode('summary');
      retry.focus({ preventScroll: true });
    },
    hide() {
      if (root.contains(document.activeElement)) document.activeElement.blur();
      clearResult();
      lastQuestion = null;
      lastResult = null;
      lastSummary = null;
      root.hidden = true;
    },
    setLang(next) {
      lang = next;
      paintButtons();
      paintQuestion();
      paintResult();
      paintSummary();
    },
  };
}
