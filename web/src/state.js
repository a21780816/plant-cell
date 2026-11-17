// 唯一的狀態來源：發亮、面板、清單、鏡頭都訂閱這裡，不各自維護「目前選了誰」。
export const initialState = {
  phase: 'intro',   // 'intro'（開場，只接受 start）→ 'explore'
  selected: null,   // { id, inst }；inst 為 null 表示從清單選的
  hovered: null,    // { id, inst }
  exploded: false,
  labels: false,
  quiz: null,
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
      return { ...state, selected: { id: action.id, inst: action.inst ?? null } };
    case 'deselect':
      return { ...state, selected: null };
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
