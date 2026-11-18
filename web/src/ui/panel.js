// 右側介紹面板。root 是 #panel；內容由這裡建立。show(id) 以目前語言顯示該構造（localizedOrganelle）。
// options.palette 用來取左上角色點的顏色；options.onClose 在按下關閉鈕時呼叫（等同取消選取）。
import { t, localizedOrganelle } from '../i18n.js';

export function mountPanel(root, { palette = {}, onClose = () => {} } = {}) {
  root.innerHTML = '';
  const el = (tag, id, cls) => {
    const n = document.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    return n;
  };
  const close = el('button', 'panel-close');
  close.type = 'button';
  close.setAttribute('aria-label', t('zh', 'closePanel'));
  close.textContent = '×';
  close.addEventListener('click', () => onClose());

  const head = el('div', null, 'panel-head');
  const dot = el('span', 'panel-dot');
  const title = el('h2', 'panel-title');
  head.append(dot, title);

  const en = el('div', 'panel-en');
  const tagline = el('p', 'panel-tagline');
  const body = el('p', 'panel-body');
  const fact = el('div', 'panel-fact');
  const factLabel = el('div', null, 'fact-label');
  factLabel.textContent = t('zh', 'didYouKnow');
  const factText = el('p', null, 'fact-text');
  fact.append(factLabel, factText);

  root.append(close, head, en, tagline, body, fact);

  let lang = 'zh';
  let currentId = null;
  const fill = (id) => {
    const o = localizedOrganelle(lang, id);
    const main = palette[id] && palette[id].main;
    dot.style.background = main || '#B8B4AC';
    title.textContent = o.title;
    en.textContent = o.subtitle ?? '';
    en.hidden = o.subtitle == null;
    tagline.textContent = o.tagline;
    body.textContent = o.body;
    fact.hidden = o.fact == null;
    factText.textContent = o.fact ?? '';
    root.scrollTop = 0;
  };

  return {
    show(id) {
      currentId = id;
      fill(id);
      root.hidden = false;
      root.classList.remove('shown'); // 重新觸發淡入
      void root.offsetWidth;
      root.classList.add('shown');
    },
    hide() {
      currentId = null;
      root.hidden = true;
      root.classList.remove('shown');
    },
    // 切換語言：更新關閉鈕與標題文字；顯示中就以新語言重寫內容（不重播淡入）
    setLang(next) {
      lang = next;
      close.setAttribute('aria-label', t(lang, 'closePanel'));
      factLabel.textContent = t(lang, 'didYouKnow');
      if (currentId !== null) fill(currentId);
    },
  };
}
