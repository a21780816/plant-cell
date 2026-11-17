import test from 'node:test';
import assert from 'node:assert/strict';
import { SPREAD, EXTRA, FOLLOW, explodeTarget, ruleFor } from '../web/src/explode.js';

const near = (a, b, msg) => {
  assert.equal(a.length, b.length, msg);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg ?? ''} [${i}] ${v} vs ${b[i]}`));
};

test('常數：SPREAD、EXTRA、FOLLOW', () => {
  assert.equal(SPREAD, 0.9);
  assert.deepEqual(EXTRA, { nucleolus: [1.2, 1.0, 1.2] });
  assert.deepEqual(FOLLOW, { chromatin: 'nucleus', transvacuolar_strand: 'vacuole' });
});

test('explodeTarget：position + (position - center) * SPREAD + EXTRA', () => {
  near(explodeTarget([2, 0, 0], [0, 0, 0], 'golgi'), [3.8, 0, 0]);
  near(explodeTarget([0, 0, 0], [0, 0, 0], 'vacuole'), [0, 0, 0]);
  near(explodeTarget([1, 1, 1], [1, 1, 1], 'nucleolus'), [2.2, 2.0, 2.2]);
});

test('explodeTarget：中心不在原點時以中心為準', () => {
  near(explodeTarget([3, 2, 1], [1, 2, -1], 'mitochondrion'), [4.8, 2, 2.8]);
});

test('ruleFor：外殼類與細絲走放大，其餘個體走位移', () => {
  for (const id of ['cell_wall', 'middle_lamella', 'cell_membrane', 'cytoplasm', 'plasmodesmata', 'microtubule', 'actin_filament']) {
    assert.deepEqual(ruleFor(id, 0), { kind: 'scale' }, id);
  }
  for (const id of ['nucleus', 'golgi', 'chloroplast', 'vacuole', 'oil_body']) {
    assert.deepEqual(ruleFor(id, 0), { kind: 'move' }, id);
  }
});

test('ruleFor：FOLLOW 以 id 為單位', () => {
  assert.deepEqual(ruleFor('chromatin', 0), { kind: 'follow', of: 'nucleus' });
  assert.deepEqual(ruleFor('transvacuolar_strand', 0), { kind: 'follow', of: 'vacuole' });
});

test('ruleFor：ribosome 個體 0 跟隨 rough_er，個體 1 走放大，其餘個體照一般規則', () => {
  assert.deepEqual(ruleFor('ribosome', 0), { kind: 'follow', of: 'rough_er' });
  assert.deepEqual(ruleFor('ribosome', 1), { kind: 'scale' });
  assert.deepEqual(ruleFor('ribosome', 2), { kind: 'move' });
});
