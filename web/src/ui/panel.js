// 右側介紹面板。root 是 #panel；內容由這裡建立。
// options.palette 用來取左上角色點的顏色；options.onClose 在按下關閉鈕時呼叫（等同取消選取）。
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
  close.setAttribute('aria-label', '關閉介紹');
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
  factLabel.textContent = '你知道嗎';
  const factText = el('p', null, 'fact-text');
  fact.append(factLabel, factText);

  root.append(close, head, en, tagline, body, fact);

  return {
    show(o) {
      const main = palette[o.id] && palette[o.id].main;
      dot.style.background = main || '#B8B4AC';
      title.textContent = o.zh;
      en.textContent = o.en;
      tagline.textContent = o.tagline;
      body.textContent = o.body;
      fact.hidden = o.fact == null;
      factText.textContent = o.fact ?? '';
      root.scrollTop = 0;
      root.hidden = false;
      root.classList.remove('shown'); // 重新觸發淡入
      void root.offsetWidth;
      root.classList.add('shown');
    },
    hide() {
      root.hidden = true;
      root.classList.remove('shown');
    },
  };
}
