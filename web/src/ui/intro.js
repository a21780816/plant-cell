// 開場卡片。root 是 #intro（蓋住整個視窗的薄紗）；卡片內容由這裡建立。
// intro 是 { title, paragraphs, start }；按下開始鈕時呼叫 onStart()，之後由呼叫端呼叫 hide() 淡出；setContent(intro) 換語言用。
const FADE_MS = 300;

export function mountIntro(root, { intro, onStart = () => {} }) {
  root.innerHTML = '';
  root.classList.remove('leaving');
  const card = document.createElement('div');
  card.id = 'intro-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'intro-title');

  const title = document.createElement('h1');
  title.id = 'intro-title';
  card.append(title);
  let paras = [];
  const start = document.createElement('button');
  start.id = 'intro-start';
  start.type = 'button';
  start.textContent = intro.start;
  start.addEventListener('click', () => onStart());
  card.append(start);

  // 就地更新文字：段數不同才重建段落；不重建卡片、不搬焦點
  const setContent = (next) => {
    title.textContent = next.title;
    if (paras.length !== next.paragraphs.length) {
      for (const p of paras) p.remove();
      paras = next.paragraphs.map(() => {
        const p = document.createElement('p');
        p.className = 'intro-text';
        card.insertBefore(p, start);
        return p;
      });
    }
    next.paragraphs.forEach((text, i) => { paras[i].textContent = text; });
    start.textContent = next.start;
  };
  setContent(intro);

  root.append(card);
  root.hidden = false;
  start.focus({ preventScroll: true });

  let timer = 0;
  return {
    hide() {
      if (root.hidden || root.classList.contains('leaving')) return;
      if (document.activeElement === start) start.blur(); // 按鈕隱藏後不可留著鍵盤焦點
      root.classList.add('leaving');
      timer = setTimeout(() => { root.hidden = true; }, FADE_MS);
    },
    dispose() { clearTimeout(timer); },
    setContent,
  };
}
