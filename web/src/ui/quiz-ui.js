// 測驗的題目卡片。root 是 #quiz；內容由這裡建立。
// 兩種外觀共用同一張卡片：出題時（進度、題目、結果、右上角的 #quiz-exit），
// 總結時（分數與兩個按鈕 #quiz-retry、#quiz-exit）。index 是 0 起算的題號（畫面上顯示 index + 1）。
export function mountQuizUI(root, { onExit = () => {}, onRetry = () => {} } = {}) {
  root.innerHTML = '';
  const el = (tag, id) => {
    const n = document.createElement(tag);
    if (id) n.id = id;
    return n;
  };
  const progress = el('div', 'quiz-progress');
  const question = el('div', 'quiz-question');
  const result = el('div', 'quiz-result');
  result.setAttribute('role', 'status'); // 讀螢幕報讀軟體時會唸出結果
  const summary = el('div', 'quiz-summary');
  const actions = el('div', 'quiz-actions');
  const retry = el('button', 'quiz-retry');
  retry.type = 'button';
  retry.textContent = '再玩一次';
  retry.addEventListener('click', () => onRetry());
  const exit = el('button', 'quiz-exit');
  exit.type = 'button';
  exit.textContent = '結束測驗';
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
  setMode('question');
  root.hidden = true;

  return {
    showQuestion({ index, total, zh }) {
      clearResult();
      progress.textContent = `第 ${index + 1} 題／共 ${total} 題`;
      question.textContent = `請點出：${zh}`;
      setMode('question');
    },
    // pickedZh 是使用者點到的構造名稱；答錯時才用到
    showResult({ correct, expectedZh, pickedZh = '' }) {
      result.dataset.state = correct ? 'right' : 'wrong';
      result.textContent = correct
        ? '答對了！'
        : `答錯了，你點的是${pickedZh}。發亮的才是${expectedZh}。`;
    },
    showSummary({ score, total }) {
      clearResult();
      summary.textContent = `答對 ${score}／${total} 題`;
      setMode('summary');
      retry.focus({ preventScroll: true });
    },
    hide() {
      if (root.contains(document.activeElement)) document.activeElement.blur();
      clearResult();
      root.hidden = true;
    },
  };
}
