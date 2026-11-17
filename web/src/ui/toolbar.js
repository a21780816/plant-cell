// 左上角的工具列。root 是 #toolbar；每個按鈕帶 aria-pressed。
// 之後要加按鈕時在 BUTTONS 加一列即可：isOn 決定按下的樣子，phases 是可以操作的階段。
const BUTTONS = [
  { id: 'btn-explode', on: '組合', off: '拆解', isOn: (s) => !!s.exploded, phases: ['explore'], handler: 'onExplode' },
  { id: 'btn-labels', on: '隱藏名稱', off: '顯示名稱', isOn: (s) => !!s.labels, phases: ['explore'], handler: 'onLabels' },
  { id: 'btn-quiz', on: '測驗', off: '測驗', isOn: (s) => s.phase === 'quiz', phases: ['explore', 'quiz'], handler: 'onQuiz' },
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
    return { b, spec, shown: { text: spec.off, pressed: 'false', active: false, disabled: false } };
  });
  let last = {};
  let ready = false; // 蓋子完全打開之前三顆按鈕都停用（否則蓋子會停在半空、外殼卻已放大）

  // 值有變才寫 DOM
  function paint() {
    const s = last;
    for (const item of buttons) {
      const { b, spec, shown } = item;
      const on = spec.isOn(s);
      const text = on ? spec.on : spec.off;
      const pressed = on ? 'true' : 'false';
      const disabled = !(ready && (s.phase === undefined || spec.phases.includes(s.phase)));
      if (shown.text !== text) { b.textContent = text; shown.text = text; }
      if (shown.pressed !== pressed) { b.setAttribute('aria-pressed', pressed); shown.pressed = pressed; }
      if (shown.active !== on) { b.classList.toggle('active', on); shown.active = on; }
      if (shown.disabled !== disabled) { b.disabled = disabled; shown.disabled = disabled; }
    }
  }
  paint();
  return {
    setState(state) { last = state; paint(); },
    setReady(on) { ready = !!on; paint(); },
  };
}
