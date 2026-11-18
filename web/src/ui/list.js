import { organelleName, t } from '../i18n.js';

// 底部的構造清單。root 是 #list；每個按鈕帶 data-id，左側是該構造的色點（palette 的 main）。
export function mountList(root, { organelles, palette, onSelect }) {
  root.innerHTML = '';
  const buttons = new Map();
  let lang = 'zh';
  let namesHidden = false;
  for (const o of organelles) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = o.id;
    b.dataset.name = o.zh; // 測驗時名稱隱藏，CSS 用它的偽元素（看不見）佔住原本的寬度，清單的版面高度才不隨名稱顯示與否改變
    b.style.setProperty('--c', (palette[o.id] && palette[o.id].main) || '#B8B4AC');
    b.setAttribute('aria-pressed', 'false');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = o.zh;
    b.append(dot, label);
    b.addEventListener('click', () => onSelect(o.id));
    root.append(b);
    buttons.set(o.id, { b, label });
  }
  return {
    focus(id) {
      const e = buttons.get(id);
      if (e) e.b.focus({ preventScroll: true });
    },
    setActive(id) {
      for (const [bid, { b }] of buttons) {
        const on = bid === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    },
    // 測驗時隱藏名稱：畫面上只留色點（並移除 title 提示，避免洩漏答案）。
    setNamesHidden(hidden) {
      namesHidden = !!hidden;
      root.classList.toggle('names-hidden', namesHidden);
      for (const [id, { b }] of buttons) {
        if (namesHidden) b.removeAttribute('title'); else b.title = organelleName(lang, id);
      }
    },
    // 切換語言：更新名稱文字、data-name（隱藏名稱時的佔位寬度）與 title
    setLang(next) {
      lang = next;
      for (const [id, { b, label }] of buttons) {
        const name = organelleName(lang, id);
        label.textContent = name;
        b.dataset.name = name;
        if (!namesHidden) b.title = name;
      }
    },
  };
}

// 清單標題列的收合鈕：原生 button，狀態寫在 aria-expanded 與 aria-label（箭頭方向由 CSS 依 aria-expanded 畫）。
// set() 只在值真的改變時才寫 DOM。
export function mountListToggle(button, { onToggle }) {
  let shown = null; // { collapsed, lang }
  button.addEventListener('click', () => onToggle());
  return {
    set(collapsed, lang) {
      const c = !!collapsed;
      if (!shown || shown.collapsed !== c) button.setAttribute('aria-expanded', String(!c));
      if (!shown || shown.collapsed !== c || shown.lang !== lang) button.setAttribute('aria-label', t(lang, c ? 'expandList' : 'collapseList'));
      shown = { collapsed: c, lang };
    },
  };
}
