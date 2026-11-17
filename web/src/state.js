// 唯一的狀態來源：發亮、面板、清單、鏡頭都訂閱這裡，不各自維護「目前選了誰」。
export const initialState = {
  phase: 'intro',   // 'intro'（開場，只接受 start）→ 'explore'
  selected: null,   // { id, inst }；inst 為 null 表示從清單選的
  hovered: null,    // { id, inst }
  exploded: false,
  labels: false,
  quiz: null,       // 測驗中：{ saved: { labels, exploded }, reveal: null | { id, correct } }
};

export function reduce(state, action) {
  if (action.type === 'start') return state.phase === 'intro' ? { ...state, phase: 'explore' } : state;
  if (state.phase === 'intro') return state; // 開場階段除了 start 以外一律無效
  switch (action.type) {
    case 'hover':
      return { ...state, hovered: { id: action.id, inst: action.inst ?? null } };
    case 'unhover':
      return { ...state, hovered: null };
    case 'select':
      if (state.phase === 'quiz') return state; // 測驗中不可選取（清單與名稱標籤會洩漏答案）
      return { ...state, selected: { id: action.id, inst: action.inst ?? null } };
    case 'deselect':
      return { ...state, selected: null };
    case 'toggleExplode':
      return state.phase === 'quiz' ? state : { ...state, exploded: !state.exploded };
    case 'toggleLabels':
      return state.phase === 'quiz' ? state : { ...state, labels: !state.labels };
    case 'quizStart':
      if (state.phase !== 'explore') return state;
      return {
        ...state, phase: 'quiz', selected: null, hovered: null, labels: false, exploded: false,
        quiz: { saved: { labels: state.labels, exploded: state.exploded }, reveal: null },
      };
    case 'quizExit':
      if (state.phase !== 'quiz') return state;
      return {
        ...state, phase: 'explore', selected: null, hovered: null,
        labels: state.quiz.saved.labels, exploded: state.quiz.saved.exploded, quiz: null,
      };
    case 'quizReveal':
      if (state.phase !== 'quiz') return state;
      return { ...state, quiz: { ...state.quiz, reveal: { id: action.id, correct: !!action.correct } } };
    case 'quizNext':
      if (state.phase !== 'quiz') return state;
      return { ...state, quiz: { ...state.quiz, reveal: null } };
    default:
      return state;
  }
}

export function createStore(initial = initialState) {
  let state = initial;
  const subs = new Set();
  return {
    getState: () => state,
    dispatch(action) {
      state = reduce(state, action);
      for (const fn of [...subs]) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}
