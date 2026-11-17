import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANELLES, ORGANELLE_IDS, QUIZ_IDS, getOrganelle, INTRO,
} from '../web/src/organelles.js';
import { FORBIDDEN_WORDS } from '../web/src/forbidden-words.js';

const len = (s) => [...s].length;

// 規格 §11 的對照表：[id, 中文名, 英文名, 可直接點選]
const EXPECTED = [
  ['cell_wall', '初生細胞壁', 'Primary wall', true],
  ['middle_lamella', '中膠層', 'Middle lamella', false],
  ['cell_membrane', '細胞膜（質膜）', 'Plasma membrane', true],
  ['cytoplasm', '細胞質', 'Cytoplasm', false],
  ['nucleus', '細胞核（核膜）', 'Nucleus (nuclear envelope)', true],
  ['nucleolus', '核仁', 'Nucleolus', true],
  ['chromatin', '染色質', 'Chromatin', false],
  ['rough_er', '粗糙內質網（扁囊狀）', 'Cisternal rough ER', true],
  ['smooth_er', '平滑內質網（管狀）', 'Tubular smooth ER', true],
  ['ribosome', '核糖體', 'Ribosomes', false],
  ['golgi', '高基氏體', 'Golgi body', true],
  ['mitochondrion', '粒線體', 'Mitochondrion', true],
  ['chloroplast', '葉綠體', 'Chloroplast', true],
  ['vacuole', '液泡', 'Vacuole', true],
  ['transvacuolar_strand', '跨液泡細胞質絲', 'Transvacuolar strand', false],
  ['peroxisome', '過氧化體', 'Peroxisome', true],
  ['oil_body', '油體', 'Oil body', true],
  ['plasmodesmata', '原生質絲', 'Plasmodesmata', true],
  ['microtubule', '皮層微管', 'Cortical microtubules', false],
  ['actin_filament', '肌動蛋白微絲', 'Cortical actin microfilament', false],
];

const NOT_PICKABLE = [
  'middle_lamella', 'cytoplasm', 'chromatin', 'ribosome',
  'transvacuolar_strand', 'microtubule', 'actin_filament',
];

test('ORGANELLE_IDS 是 20 個 id 的固定順序', () => {
  assert.equal(ORGANELLES.length, 20);
  assert.deepEqual(ORGANELLE_IDS, EXPECTED.map((e) => e[0]));
  assert.deepEqual(ORGANELLES.map((o) => o.id), ORGANELLE_IDS);
});

test('每項的 zh、en、pickable 等於規格 §11 對照表', () => {
  for (const [id, zh, en, pickable] of EXPECTED) {
    const o = getOrganelle(id);
    assert.ok(o, `${id} 不存在`);
    assert.equal(o.zh, zh, `${id} zh`);
    assert.equal(o.en, en, `${id} en`);
    assert.equal(o.pickable, pickable, `${id} pickable`);
  }
});

test('tagline、body、fact 長度符合規格', () => {
  for (const o of ORGANELLES) {
    assert.equal(typeof o.tagline, 'string', `${o.id} tagline 型別`);
    assert.ok(len(o.tagline) >= 1 && len(o.tagline) <= 30, `${o.id} tagline 長度 ${len(o.tagline)}`);
    assert.equal(typeof o.body, 'string', `${o.id} body 型別`);
    assert.ok(len(o.body) >= 120 && len(o.body) <= 260, `${o.id} body 長度 ${len(o.body)}`);
    assert.ok(o.fact === null || typeof o.fact === 'string', `${o.id} fact 型別`);
    if (o.fact !== null) {
      assert.ok(len(o.fact) >= 1 && len(o.fact) <= 90, `${o.id} fact 長度 ${len(o.fact)}`);
    }
  }
});

test('pickable 為 false 的恰好是那 7 個 id，QUIZ_IDS 共 13 項', () => {
  const notPickable = ORGANELLES.filter((o) => !o.pickable).map((o) => o.id);
  assert.deepEqual([...notPickable].sort(), [...NOT_PICKABLE].sort());
  assert.equal(QUIZ_IDS.length, 13);
  assert.deepEqual(QUIZ_IDS, ORGANELLES.filter((o) => o.pickable).map((o) => o.id));
  for (const id of NOT_PICKABLE) assert.ok(!QUIZ_IDS.includes(id), `${id} 不應在 QUIZ_IDS`);
});

test('所有文字（含 INTRO）不含禁用詞', () => {
  const texts = [];
  for (const o of ORGANELLES) {
    for (const [field, t] of [['zh', o.zh], ['tagline', o.tagline], ['body', o.body], ['fact', o.fact ?? '']]) {
      texts.push([`${o.id}.${field}`, t]);
    }
  }
  texts.push(['INTRO.title', INTRO.title], ['INTRO.start', INTRO.start]);
  INTRO.paragraphs.forEach((p, i) => texts.push([`INTRO.paragraphs[${i}]`, p]));
  for (const [where, t] of texts) {
    for (const w of FORBIDDEN_WORDS) {
      assert.ok(!t.includes(w), `${where} 含禁用詞「${w}」：${t}`);
    }
  }
});

test('vacuole 的 body 或 fact 含「比例」', () => {
  const v = getOrganelle('vacuole');
  assert.ok(v.body.includes('比例') || (v.fact ?? '').includes('比例'), 'vacuole 缺「比例」');
});

test('INTRO 涵蓋必要詞且總長不超過 260', () => {
  assert.equal(INTRO.title, '植物細胞');
  assert.equal(INTRO.start, '開始探索');
  assert.ok(Array.isArray(INTRO.paragraphs));
  assert.ok(INTRO.paragraphs.length >= 2 && INTRO.paragraphs.length <= 3,
    `INTRO 段數 ${INTRO.paragraphs.length}`);
  const all = INTRO.paragraphs.join('');
  for (const w of ['葉肉細胞', '中膠層', '原生質絲', '液泡', '比例']) {
    assert.ok(all.includes(w), `INTRO 缺「${w}」`);
  }
  assert.ok(len(all) <= 260, `INTRO 總長 ${len(all)}`);
});

test('getOrganelle 對未知 id 回傳 undefined', () => {
  assert.equal(getOrganelle('nope'), undefined);
});
