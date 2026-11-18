import { t } from '../i18n.js';

// 左上角的工具列。root 是 #toolbar；每個按鈕帶 aria-pressed。
// 之後要加按鈕時在 BUTTONS 加一列即可：isOn 決定按下的樣子，phases 是可以操作的階段。
const BUTTONS = [
  { id: 'btn-explode', on: 'assemble', off: 'explode', isOn: (s) => !!s.exploded, phases: ['explore'], handler: 'onExplode' },
  { id: 'btn-labels', on: 'hideNames', off: 'showNames', isOn: (s) => !!s.labels, phases: ['explore'], handler: 'onLabels' },
  { id: 'btn-quiz', on: 'quiz', off: 'quiz', isOn: (s) => s.phase === 'quiz', phases: ['explore', 'quiz'], handler: 'onQuiz' },
];

export function mountToolbar(root, handlers = {}) {
  root.innerHTML = '';
  const buttons = BUTTONS.map((spec) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = spec.id;
    b.textContent = t('zh', spec.off);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => (handlers[spec.handler] || (() => {}))());
    root.append(b);
    return { b, spec, shown: { text: t('zh', spec.off), pressed: 'false', active: false, disabled: false } };
  });
  let last = {};
  let ready = false; // 蓋子完全打開之前三顆按鈕都停用（否則蓋子會停在半空、外殼卻已放大）

  // 值有變才寫 DOM
  function paint() {
    const s = last;
    for (const item of buttons) {
      const { b, spec, shown } = item;
      const on = spec.isOn(s);
      const text = t(s.lang ?? 'zh', on ? spec.on : spec.off);
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
