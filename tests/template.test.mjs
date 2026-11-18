import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI_TEXT, LANG_KEY, HTML_LANG } from '../web/src/i18n.js';

const html = readFileSync(new URL('../web/template.html', import.meta.url), 'utf8');
const loadingAt = html.indexOf('id="loading"');
const bigAt = html.indexOf('<!--SCRIPT-->');
// 在 #loading 之後、大腳本之前的 inline script
const early = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].filter((m) => m.index > loadingAt && m.index < bigAt && m[1] !== '<!--SCRIPT-->');

test('template：大腳本之前有一段讀記住語言的 inline script，鍵與英文字串和 i18n 一致', () => {
  assert.equal(early.length, 1, '#loading 之後、大腳本之前應有剛好一段 inline script');
  const code = early[0][1];
  assert.ok(code.includes(`'${LANG_KEY}'`), `應讀 localStorage 的鍵 ${LANG_KEY}`);
  assert.ok(code.includes(JSON.stringify(UI_TEXT.en.title)) || code.includes(`'${UI_TEXT.en.title}'`), '英文標題');
  assert.ok(code.includes(JSON.stringify(UI_TEXT.en.loading)) || code.includes(`'${UI_TEXT.en.loading}'`), '英文載入文字');
  assert.ok(code.includes(`'${HTML_LANG.en}'`), 'html lang');
  assert.ok(/try\s*\{[\s\S]*\}\s*catch/.test(code), '任何錯誤都要吞掉');
});

test('template：inline script 在記住英文時真的改了標題、html lang 與載入文字；其他情況不動', () => {
  const run = (stored, throws = false) => {
    const doc = { documentElement: { lang: 'zh-Hant' }, title: UI_TEXT.zh.title, getElementById: () => loading };
    const loading = { textContent: UI_TEXT.zh.loading };
    const localStorage = { getItem: (k) => { if (throws) throw new Error('blocked'); return k === LANG_KEY ? stored : null; } };
    new Function('document', 'localStorage', early[0][1])(doc, localStorage);
    return { lang: doc.documentElement.lang, title: doc.title, loading: loading.textContent };
  };
  assert.deepEqual(run('en'), { lang: HTML_LANG.en, title: UI_TEXT.en.title, loading: UI_TEXT.en.loading });
  assert.deepEqual(run('zh'), { lang: HTML_LANG.zh, title: UI_TEXT.zh.title, loading: UI_TEXT.zh.loading });
  assert.deepEqual(run(null), { lang: HTML_LANG.zh, title: UI_TEXT.zh.title, loading: UI_TEXT.zh.loading });
  assert.deepEqual(run('en', true), { lang: HTML_LANG.zh, title: UI_TEXT.zh.title, loading: UI_TEXT.zh.loading });
});
