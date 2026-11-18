import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGS, DEFAULT_LANG, LANG_KEY, HTML_LANG, LANG_LABELS, UI_TEXT,
  t, readLang, writeLang, organelleName, localizedOrganelle, introContent,
} from '../web/src/i18n.js';
import { INTRO, getOrganelle } from '../web/src/organelles.js';
import { ORGANELLES_EN, INTRO_EN } from '../web/src/organelles.en.js';

const ZH = {
  title: '植物細胞', loading: '載入中…', listTitle: '細胞構造', toolbarLabel: '檢視工具',
  quiz: '測驗', explode: '拆解', assemble: '組合', showNames: '顯示名稱', hideNames: '隱藏名稱',
  closePanel: '關閉介紹', didYouKnow: '你知道嗎', quizProgress: '第 {n} 題／共 {total} 題',
  quizFind: '請點出：{name}', quizCorrect: '答對了！',
  quizWrong: '答錯了，你點的是{picked}。發亮的才是{expected}。',
  quizScore: '答對 {score}／{total} 題', playAgain: '再玩一次', endQuiz: '結束測驗',
  fallback: '這個瀏覽器無法顯示 3D 內容，請改用新版的 Chrome 開啟。',
  loadFail: '模型載入失敗，請重新整理頁面再試一次。',
  collapseList: '收起構造清單', expandList: '展開構造清單',
};
const EN = {
  title: 'Plant Cell', loading: 'Loading…', listTitle: 'Cell structures', toolbarLabel: 'View tools',
  quiz: 'Quiz', explode: 'Explode', assemble: 'Assemble', showNames: 'Show names', hideNames: 'Hide names',
  closePanel: 'Close description', didYouKnow: 'Did you know?', quizProgress: 'Question {n} of {total}',
  quizFind: 'Find: {name}', quizCorrect: 'Correct!',
  quizWrong: 'Not quite. You clicked {picked}. The glowing one is {expected}.',
  quizScore: 'You got {score} out of {total}', playAgain: 'Play again', endQuiz: 'End quiz',
  fallback: "This browser can't display 3D content. Please open this page in a recent version of Chrome.",
  loadFail: 'The model failed to load. Please refresh the page and try again.',
  collapseList: 'Collapse structure list', expandList: 'Expand structure list',
};

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('UI_TEXT 的 zh、en 鍵相同（22 個），值都是非空字串，兩語的 {佔位符} 集合相同', () => {
  const zk = Object.keys(UI_TEXT.zh).sort();
  assert.deepEqual(zk, Object.keys(UI_TEXT.en).sort());
  assert.equal(zk.length, 22);
  for (const k of zk) {
    for (const lang of LANGS) {
      assert.equal(typeof UI_TEXT[lang][k], 'string');
      assert.ok(UI_TEXT[lang][k].length > 0, `${lang}.${k} 不可為空`);
    }
    assert.deepEqual(placeholders(UI_TEXT.zh[k]), placeholders(UI_TEXT.en[k]), `${k} 的佔位符`);
  }
});

test('UI_TEXT 等於定稿', () => {
  assert.deepEqual(UI_TEXT.zh, ZH);
  assert.deepEqual(UI_TEXT.en, EN);
});

test('UI_TEXT.en 與 LANG_LABELS.en 不含中日韓文字與全形標點', () => {
  const cjk = /[　-〿㐀-鿿＀-￯]/;
  for (const [k, v] of Object.entries(UI_TEXT.en)) assert.ok(!cjk.test(v), `en.${k}`);
  assert.ok(!cjk.test(LANG_LABELS.en));
});

test('t：代入參數、不支援的語言用中文、未知鍵丟錯', () => {
  assert.equal(t('zh', 'quizProgress', { n: 1, total: 10 }), '第 1 題／共 10 題');
  assert.equal(t('en', 'quizProgress', { n: 1, total: 10 }), 'Question 1 of 10');
  assert.equal(t('en', 'quizWrong', { picked: 'A', expected: 'B' }), 'Not quite. You clicked A. The glowing one is B.');
  assert.equal(t('en', 'quizScore', { score: 7, total: 10 }), 'You got 7 out of 10');
  assert.equal(t('zh', 'quizScore', { score: 7, total: 10 }), '答對 7／10 題');
  assert.equal(t('fr', 'quiz'), '測驗');
  assert.throws(() => t('zh', 'nope'));
});

test('readLang：有效值照用，其餘一律 zh，不往外丟錯', () => {
  const keys = [];
  const store = (v) => () => ({ getItem: (k) => { keys.push(k); return v; } });
  assert.equal(readLang(store('en')), 'en');
  assert.equal(readLang(store('zh')), 'zh');
  for (const v of [null, 'fr', 'EN']) assert.equal(readLang(store(v)), 'zh');
  assert.equal(readLang(() => { throw new Error('denied'); }), 'zh');
  assert.equal(readLang(() => ({ getItem() { throw new Error('denied'); } })), 'zh');
  assert.equal(readLang(() => undefined), 'zh');
  assert.ok(keys.length > 0 && keys.every((k) => k === 'plant-cell-lang'));
});

test('writeLang：寫入 plant-cell-lang，無效值不寫，錯誤不往外丟', () => {
  const calls = [];
  const getStorage = () => ({ setItem: (k, v) => calls.push([k, v]) });
  writeLang('en', getStorage);
  assert.deepEqual(calls, [['plant-cell-lang', 'en']]);
  writeLang('fr', getStorage);
  assert.equal(calls.length, 1);
  assert.doesNotThrow(() => writeLang('en', () => { throw new Error('denied'); }));
  assert.doesNotThrow(() => writeLang('en', () => ({ setItem() { throw new Error('quota'); } })));
});

test('常數：LANGS、DEFAULT_LANG、LANG_KEY、HTML_LANG、LANG_LABELS 等於定稿', () => {
  assert.deepEqual(LANGS, ['zh', 'en']);
  assert.equal(DEFAULT_LANG, 'zh');
  assert.equal(LANG_KEY, 'plant-cell-lang');
  assert.deepEqual(HTML_LANG, { zh: 'zh-Hant', en: 'en' });
  assert.deepEqual(LANG_LABELS, { zh: '中文', en: 'English' });
});

test('organelleName 與 localizedOrganelle', () => {
  assert.equal(organelleName('en', 'golgi'), 'Golgi body');
  assert.equal(organelleName('zh', 'golgi'), '高基氏體');
  const n = getOrganelle('nucleus');
  assert.deepEqual(localizedOrganelle('zh', 'nucleus'), {
    id: 'nucleus', title: '細胞核（核膜）', subtitle: 'Nucleus (nuclear envelope)',
    tagline: n.tagline, body: n.body, fact: n.fact,
  });
  const en = localizedOrganelle('en', 'nucleus');
  assert.equal(en.id, 'nucleus');
  assert.equal(en.title, 'Nucleus (nuclear envelope)');
  assert.equal(en.subtitle, null);
  assert.equal(en.tagline, ORGANELLES_EN.nucleus.tagline);
  assert.equal(en.body, ORGANELLES_EN.nucleus.body);
  assert.equal(en.fact, ORGANELLES_EN.nucleus.fact);
  assert.equal(localizedOrganelle('en', 'smooth_er').fact, null);
  assert.equal(localizedOrganelle('zh', 'nope'), undefined);
});

test('introContent', () => {
  assert.equal(introContent('zh'), INTRO);
  assert.equal(introContent('en'), INTRO_EN);
  assert.equal(introContent('fr'), INTRO);
});

test('t：收合鈕的文字標籤中英都有', () => {
  assert.equal(t('zh', 'collapseList'), '收起構造清單');
  assert.equal(t('zh', 'expandList'), '展開構造清單');
  assert.equal(t('en', 'collapseList'), 'Collapse structure list');
  assert.equal(t('en', 'expandList'), 'Expand structure list');
});
