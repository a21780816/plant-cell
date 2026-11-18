import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORGANELLE_IDS, getOrganelle, INTRO } from '../web/src/organelles.js';
import { INTRO_EN, ORGANELLES_EN } from '../web/src/organelles.en.js';

const CJK = /[　-〿㐀-鿿＀-￯]/;
const len = (s) => [...s].length;
const allStrings = () => [
  ...Object.values(ORGANELLES_EN).flatMap((e) => [e.tagline, e.body, e.fact]),
  INTRO_EN.title, INTRO_EN.start, ...INTRO_EN.paragraphs,
].filter((s) => s !== null);

test('鍵恰好是 20 個 id、順序同 ORGANELLE_IDS，每則只有 tagline、body、fact', () => {
  assert.deepEqual(Object.keys(ORGANELLES_EN), ORGANELLE_IDS);
  for (const e of Object.values(ORGANELLES_EN)) {
    assert.deepEqual(Object.keys(e).sort(), ['body', 'fact', 'tagline']);
  }
});

test('fact 為 null 的條件與中文相同（只有 smooth_er）', () => {
  const nulls = [];
  for (const id of ORGANELLE_IDS) {
    const isNull = ORGANELLES_EN[id].fact === null;
    assert.equal(isNull, getOrganelle(id).fact === null, id);
    if (isNull) nulls.push(id);
  }
  assert.deepEqual(nulls, ['smooth_er']);
});

test('長度（字元數含空白）：tagline 10–120、body 400–1200、fact 30–400', () => {
  for (const [id, e] of Object.entries(ORGANELLES_EN)) {
    assert.ok(len(e.tagline) >= 10 && len(e.tagline) <= 120, `${id} tagline ${len(e.tagline)}`);
    assert.ok(len(e.body) >= 400 && len(e.body) <= 1200, `${id} body ${len(e.body)}`);
    if (e.fact !== null) {
      assert.ok(len(e.fact) >= 30 && len(e.fact) <= 400, `${id} fact ${len(e.fact)}`);
    }
  }
});

test('INTRO_EN：title、start 定稿，段數與中文相同，各段非空、合計不超過 1100', () => {
  assert.equal(INTRO_EN.title, 'Plant Cell');
  assert.equal(INTRO_EN.start, 'Start exploring');
  assert.equal(INTRO_EN.paragraphs.length, INTRO.paragraphs.length);
  for (const p of INTRO_EN.paragraphs) assert.ok(p.trim().length > 0);
  assert.ok(len(INTRO_EN.paragraphs.join('')) <= 1100);
});

test('英文字串不含中日韓文字與全形標點', () => {
  for (const s of allStrings()) assert.ok(!CJK.test(s), s);
});

test('英文字串只含 ASCII 與 α、β、µ', () => {
  for (const s of allStrings()) assert.ok(!/[^\x00-\x7Fαβµ]/.test(s), s);
});

test('液泡保留「模型比實際小」的說明', () => {
  const v = ORGANELLES_EN.vacuole;
  assert.ok(/scale|proportion/i.test(`${v.body} ${v.fact}`));
  assert.ok(/smaller|reduced|shrunk|scaled down/i.test(v.body));
});

test('INTRO_EN 提到 mesophyll、middle lamella、plasmodesmata、vacuole 與比例', () => {
  const t = INTRO_EN.paragraphs.join(' ');
  for (const re of [/mesophyll/i, /middle lamella/i, /plasmodesmata/i, /vacuole/i, /scale|proportion/i]) {
    assert.ok(re.test(t), String(re));
  }
});

const NAME_RE = {
  cell_wall: [/primary (cell )?wall/i],
  middle_lamella: [/middle lamella/i],
  cell_membrane: [/plasma membrane/i],
  cytoplasm: [/cytoplasm/i],
  nucleus: [/nucleus/i, /nuclear envelope/i],
  nucleolus: [/nucleol/i],
  chromatin: [/chromatin/i],
  rough_er: [/rough ER\b/],
  smooth_er: [/smooth ER\b/],
  ribosome: [/ribosome/i],
  golgi: [/Golgi (body|bodies|stacks?)/],
  mitochondrion: [/mitochondri/i],
  chloroplast: [/chloroplast/i],
  vacuole: [/vacuole/i],
  transvacuolar_strand: [/transvacuolar strand/i],
  peroxisome: [/peroxisome/i],
  oil_body: [/oil bod(y|ies)/i],
  plasmodesmata: [/plasmodesma/i],
  microtubule: [/cortical microtubule/i],
  actin_filament: [/actin microfilament/i],
};
test('每則 body 用與 en 欄位一致的名稱提到自己', () => {
  for (const id of ORGANELLE_IDS) {
    for (const re of NAME_RE[id]) assert.ok(re.test(ORGANELLES_EN[id].body), `${id} ${re}`);
  }
});

test('中文欄位裡的數字與大寫縮寫都出現在對應的英文欄位', () => {
  for (const id of ORGANELLE_IDS) {
    const zh = getOrganelle(id);
    const en = ORGANELLES_EN[id];
    for (const k of ['tagline', 'body', 'fact']) {
      for (const tok of (zh[k] ?? '').match(/\d+|[A-Z]{2,}/g) ?? []) {
        assert.ok((en[k] ?? '').includes(tok), `${id}.${k} ${tok}`);
      }
    }
  }
});

const REJECTED = [/Golgi (apparatus|complex)/i, /cell membrane/i, /actin filament/i, /lysosom/i, /centriol/i, /centrosom/i, /Krebs/i, /triglyceride/i, /dictyosome/i];
const BRITISH = [
  /\b(colour|fibre|centre|behaviour|neighbour|grey|sulphur)/i,
  /\b(organi|polymeri|speciali|stabili|recogni|locali|mobili)s(e|ed|es|ing|ation)\b/i,
  /\bsynthesis(e|ed|es|ing)\b/i,
  /\b(cataly|hydroly|analy)s(e|ed|ing)\b/i,
  /\b(labelled|modelled|signalling|travelled|travelling)\b/i,
];
test('不用與既有名稱不一致的詞，一律美式拼法', () => {
  for (const s of allStrings()) {
    for (const re of [...REJECTED, ...BRITISH]) assert.ok(!re.test(s), `${re} in: ${s}`);
  }
});
