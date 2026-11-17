import test from 'node:test';
import assert from 'node:assert/strict';
import { readGlb, summarizeGlb } from '../scripts/glb.mjs';

const IDS = [
  'cell_wall', 'cell_membrane', 'cytoplasm', 'nucleus', 'nucleolus', 'rough_er', 'smooth_er',
  'ribosome', 'golgi', 'mitochondrion', 'chloroplast', 'vacuole', 'peroxisome', 'plasmodesmata',
  'cytoskeleton',
];
const MAX_TRIANGLES = 500000;
const MAX_BYTES = 15 * 1024 * 1024;

// 檔案不存在時 readGlb 會丟錯，測試會失敗（不是跳過）。
const { json, byteLength } = readGlb('assets/plant_cell.glb');
const s = summarizeGlb(json, byteLength, { maxTriangles: MAX_TRIANGLES, maxBytes: MAX_BYTES });

test('完整模型含 15 個 id', () => {
  assert.deepEqual([...s.ids].sort(), [...IDS].sort());
});

test('完整模型標記沒有問題', () => {
  assert.deepEqual(s.problems, []);
});

test('完整模型守住預算', () => {
  assert.ok(s.triangles <= MAX_TRIANGLES, `三角面 ${s.triangles}`);
  assert.ok(s.byteLength <= MAX_BYTES, `大小 ${s.byteLength}`);
});
