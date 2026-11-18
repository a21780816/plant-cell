// 語言切換鈕：「中文／English」兩顆並排，加在 container 的尾端；aria-pressed 標示目前語言。
// 按鈕文字固定（不隨語言變），永不停用；點非目前語言的鈕才呼叫 onChange(lang)。
import { LANGS, HTML_LANG, LANG_LABELS } from '../i18n.js';

export function mountLangSwitch(container, { onChange = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'lang-switch';
  let current = null;
  const buttons = new Map();
  for (const lang of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lang = lang;
    b.lang = HTML_LANG[lang];
    b.textContent = LANG_LABELS[lang];
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { if (lang !== current) onChange(lang); });
    el.append(b);
    buttons.set(lang, b);
  }
  container.append(el);
  return {
    el,
    setLang(lang) {
      current = lang;
      for (const [l, b] of buttons) b.setAttribute('aria-pressed', l === lang ? 'true' : 'false');
    },
  };
}
