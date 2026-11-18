// 介面文字表與語言狀態的純邏輯：不碰 DOM，方便單元測試。
import { INTRO, getOrganelle } from './organelles.js';
import { ORGANELLES_EN, INTRO_EN } from './organelles.en.js';

export const LANGS = ['zh', 'en'];
export const DEFAULT_LANG = 'zh';
export const LANG_KEY = 'plant-cell-lang';
export const HTML_LANG = { zh: 'zh-Hant', en: 'en' };
export const LANG_LABELS = { zh: '中文', en: 'English' };

export const UI_TEXT = {
  zh: {
    title: '植物細胞',
    loading: '載入中…',
    listTitle: '細胞構造',
    toolbarLabel: '檢視工具',
    quiz: '測驗',
    explode: '拆解',
    assemble: '組合',
    showNames: '顯示名稱',
    hideNames: '隱藏名稱',
    closePanel: '關閉介紹',
    didYouKnow: '你知道嗎',
    quizProgress: '第 {n} 題／共 {total} 題',
    quizFind: '請點出：{name}',
    quizCorrect: '答對了！',
    quizWrong: '答錯了，你點的是{picked}。發亮的才是{expected}。',
    quizScore: '答對 {score}／{total} 題',
    playAgain: '再玩一次',
    endQuiz: '結束測驗',
    fallback: '這個瀏覽器無法顯示 3D 內容，請改用新版的 Chrome 開啟。',
    loadFail: '模型載入失敗，請重新整理頁面再試一次。',
  },
  en: {
    title: 'Plant Cell',
    loading: 'Loading…',
    listTitle: 'Cell structures',
    toolbarLabel: 'View tools',
    quiz: 'Quiz',
    explode: 'Explode',
    assemble: 'Assemble',
    showNames: 'Show names',
    hideNames: 'Hide names',
    closePanel: 'Close description',
    didYouKnow: 'Did you know?',
    quizProgress: 'Question {n} of {total}',
    quizFind: 'Find: {name}',
    quizCorrect: 'Correct!',
    quizWrong: 'Not quite. You clicked {picked}. The glowing one is {expected}.',
    quizScore: 'You got {score} out of {total}',
    playAgain: 'Play again',
    endQuiz: 'End quiz',
    fallback: "This browser can't display 3D content. Please open this page in a recent version of Chrome.",
    loadFail: 'The model failed to load. Please refresh the page and try again.',
  },
};

// 不支援的語言退回中文；{名稱} 換成 vars 的值；未知的鍵直接丟錯，免得漏譯悄悄過關。
export function t(lang, key, vars = {}) {
  const table = UI_TEXT[LANGS.includes(lang) ? lang : DEFAULT_LANG];
  if (!Object.hasOwn(table, key)) throw new Error(`未知的文字鍵：${key}`);
  return table[key].replace(/\{(\w+)\}/g, (m, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}

// 只看 localStorage，不看瀏覽器語言與網址；任何失敗都當成中文。
export function readLang(getStorage = () => globalThis.localStorage) {
  try {
    const v = getStorage().getItem(LANG_KEY);
    return LANGS.includes(v) ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function writeLang(lang, getStorage = () => globalThis.localStorage) {
  if (!LANGS.includes(lang)) return;
  try {
    getStorage().setItem(LANG_KEY, lang);
  } catch {
    // 無痕模式或儲存空間被封鎖：照常使用，只是不記住。
  }
}

export function organelleName(lang, id) {
  const o = getOrganelle(id);
  return lang === 'en' ? o.en : o.zh;
}

// 中文：標題用中文名、副標用英文名；英文：標題用英文名、沒有副標。
export function localizedOrganelle(lang, id) {
  const o = getOrganelle(id);
  if (!o) return undefined;
  if (lang === 'en') {
    const { tagline, body, fact } = ORGANELLES_EN[id];
    return { id, title: o.en, subtitle: null, tagline, body, fact };
  }
  return { id, title: o.zh, subtitle: o.en, tagline: o.tagline, body: o.body, fact: o.fact };
}

export function introContent(lang) {
  return lang === 'en' ? INTRO_EN : INTRO;
}
