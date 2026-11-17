import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANELLES, ORGANELLE_IDS, QUIZ_IDS, getOrganelle, INTRO,
} from '../web/src/organelles.js';
import { FORBIDDEN_WORDS } from '../web/src/forbidden-words.js';

const len = (s) => [...s].length;

const EXPECTED = [
  ['cell_wall', '細胞壁', 'Cell wall'],
  ['cell_membrane', '細胞膜', 'Cell membrane'],
  ['cytoplasm', '細胞質', 'Cytoplasm'],
  ['nucleus', '細胞核', 'Nucleus'],
  ['nucleolus', '核仁', 'Nucleolus'],
  ['rough_er', '粗糙內質網', 'Rough endoplasmic reticulum'],
  ['smooth_er', '平滑內質網', 'Smooth endoplasmic reticulum'],
  ['ribosome', '核糖體', 'Ribosome'],
  ['golgi', '高基氏體', 'Golgi apparatus'],
  ['mitochondrion', '粒線體', 'Mitochondrion'],
  ['chloroplast', '葉綠體', 'Chloroplast'],
  ['vacuole', '中央液泡', 'Central vacuole'],
  ['peroxisome', '過氧化體', 'Peroxisome'],
  ['plasmodesmata', '原生質絲', 'Plasmodesmata'],
  ['cytoskeleton', '細胞骨架', 'Cytoskeleton'],
];

test('ORGANELLE_IDS 是 15 個 id 的固定順序', () => {
  assert.deepEqual(ORGANELLE_IDS, EXPECTED.map((e) => e[0]));
  assert.deepEqual(ORGANELLES.map((o) => o.id), ORGANELLE_IDS);
});

test('每項的 zh 與 en 等於規格 §5 對照表', () => {
  for (const [id, zh, en] of EXPECTED) {
    const o = getOrganelle(id);
    assert.ok(o, id);
    assert.equal(o.zh, zh, `${id} zh`);
    assert.equal(o.en, en, `${id} en`);
  }
});

test('tagline、body、fact 長度符合規格', () => {
  for (const o of ORGANELLES) {
    assert.equal(typeof o.tagline, 'string', `${o.id} tagline`);
    assert.ok(len(o.tagline) >= 1 && len(o.tagline) <= 25, `${o.id} tagline 長度 ${len(o.tagline)}`);
    assert.equal(typeof o.body, 'string', `${o.id} body`);
    assert.ok(len(o.body) >= 60 && len(o.body) <= 120, `${o.id} body 長度 ${len(o.body)}`);
    if (o.fact !== null) {
      assert.equal(typeof o.fact, 'string', `${o.id} fact`);
      assert.ok(len(o.fact) >= 1 && len(o.fact) <= 60, `${o.id} fact 長度 ${len(o.fact)}`);
    }
  }
});

test('所有文字（含 INTRO）不含禁用詞', () => {
  const texts = [];
  for (const o of ORGANELLES) texts.push(o.zh, o.tagline, o.body, o.fact ?? '');
  texts.push(INTRO.title, INTRO.start, ...INTRO.paragraphs);
  for (const t of texts) {
    for (const w of FORBIDDEN_WORDS) {
      assert.ok(!t.includes(w), `「${w}」出現在：${t}`);
    }
  }
});

test('vacuole 的 body 或 fact 含「比例」', () => {
  const v = getOrganelle('vacuole');
  assert.ok(v.body.includes('比例') || (v.fact ?? '').includes('比例'));
});

test('INTRO 涵蓋必要詞且總長不超過 180', () => {
  assert.equal(INTRO.title, '植物細胞');
  assert.equal(INTRO.start, '開始探索');
  assert.ok(Array.isArray(INTRO.paragraphs));
  assert.ok(INTRO.paragraphs.length >= 2 && INTRO.paragraphs.length <= 3);
  const all = INTRO.paragraphs.join('');
  for (const w of ['葉肉細胞', '動物細胞', '細胞壁', '液泡', '葉綠體', '根']) {
    assert.ok(all.includes(w), `INTRO 缺「${w}」`);
  }
  assert.ok(len(all) <= 180, `INTRO 總長 ${len(all)}`);
});

test('QUIZ_IDS 共 13 項，且只有 cytoplasm 與 ribosome 不可點選', () => {
  assert.equal(QUIZ_IDS.length, 13);
  assert.ok(!QUIZ_IDS.includes('cytoplasm'));
  assert.ok(!QUIZ_IDS.includes('ribosome'));
  for (const o of ORGANELLES) {
    assert.equal(o.pickable, o.id !== 'cytoplasm' && o.id !== 'ribosome', o.id);
  }
  assert.deepEqual(QUIZ_IDS, ORGANELLES.filter((o) => o.pickable).map((o) => o.id));
});

test('getOrganelle 對未知 id 回傳 undefined', () => {
  assert.equal(getOrganelle('nope'), undefined);
});
