// 左上角的工具列。root 是 #toolbar；每個按鈕帶 aria-pressed。
// 之後要加按鈕（例如測驗）時在 BUTTONS 加一列即可。
const BUTTONS = [
  { id: 'btn-explode', on: '組合', off: '拆解', key: 'exploded', handler: 'onExplode' },
  { id: 'btn-labels', on: '隱藏名稱', off: '顯示名稱', key: 'labels', handler: 'onLabels' },
];

export function mountToolbar(root, handlers = {}) {
  root.innerHTML = '';
  const buttons = BUTTONS.map((spec) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = spec.id;
    b.textContent = spec.off;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => (handlers[spec.handler] || (() => {}))());
    root.append(b);
    return { b, spec };
  });
  return {
    setState(state) {
      const interactive = state.phase === undefined || state.phase === 'explore';
      for (const { b, spec } of buttons) {
        const on = !!state[spec.key];
        b.textContent = on ? spec.on : spec.off;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('active', on);
        b.disabled = !interactive;
      }
    },
  };
}
