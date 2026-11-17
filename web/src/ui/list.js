// 底部的構造清單。root 是 #list；每個按鈕帶 data-id，左側是該構造的色點（palette 的 main）。
export function mountList(root, { organelles, palette, onSelect }) {
  root.innerHTML = '';
  const buttons = new Map();
  for (const o of organelles) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = o.id;
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
    buttons.set(o.id, { b, name: o.zh });
  }
  return {
    setActive(id) {
      for (const [bid, { b }] of buttons) {
        const on = bid === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    },
    // 測驗時隱藏名稱：畫面上只留色點（並移除 title 提示，避免洩漏答案）。
    setNamesHidden(hidden) {
      root.classList.toggle('names-hidden', !!hidden);
      for (const { b, name } of buttons.values()) {
        if (hidden) b.removeAttribute('title'); else b.title = name;
      }
    },
  };
}
