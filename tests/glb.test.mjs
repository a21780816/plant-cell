import test from 'node:test';
import assert from 'node:assert/strict';
import { readGlb, summarizeGlb } from '../scripts/glb.mjs';

// 最小合法模型：一個個體根（mito, inst 0, rep 1）底下一個網格（12 個三角面）。
function base() {
  return {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1], extras: { organelle: 'mito', inst: 0, rep: 1 } },
      { name: 'm', mesh: 0, extras: { organelle: 'mito', part: 'main' } },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ count: 8 }, { count: 36 }],
  };
}

function only(s, keyword) {
  assert.equal(s.problems.length, 1, JSON.stringify(s.problems));
  assert.ok(s.problems[0].includes(keyword), s.problems[0]);
}

test('fixture 摘要', () => {
  const { json, byteLength } = readGlb('tests/fixtures/tag_spike.glb');
  const s = summarizeGlb(json, byteLength);
  assert.deepEqual(s.ids.sort(), ['cell_wall', 'mitochondrion']);
  assert.equal(s.meshCount, 4);
  assert.equal(s.triangles, 48);
  assert.deepEqual(s.problems, []);
});

test('最小模型沒有問題', () => {
  const s = summarizeGlb(base(), 100);
  assert.deepEqual(s.problems, []);
  assert.equal(s.triangles, 12);
  assert.deepEqual(s.instances, [{ id: 'mito', inst: 0, rep: 1 }]);
});

test('網格缺 organelle', () => {
  const j = base();
  delete j.nodes[1].extras.organelle;
  only(summarizeGlb(j, 100), 'organelle');
});

test('網格沒有 inst 或 lid 祖先', () => {
  const j = base();
  j.scenes[0].nodes = [0, 2];
  j.nodes.push({ name: 'orphan', mesh: 0, extras: { organelle: 'mito', part: 'main' } });
  only(summarizeGlb(j, 100), '祖先');
});

test('同一 id 有兩個 rep', () => {
  const j = base();
  j.nodes.push({ name: 'root2', extras: { organelle: 'mito', inst: 1, rep: 1 } });
  only(summarizeGlb(j, 100), 'rep');
});

test('同一 id 沒有 rep', () => {
  const j = base();
  j.nodes[0].extras.rep = 0;
  only(summarizeGlb(j, 100), 'rep');
});

test('一個 mesh 有兩個 primitives', () => {
  const j = base();
  j.meshes[0].primitives.push({ attributes: { POSITION: 0 }, indices: 1 });
  only(summarizeGlb(j, 100), 'primitive');
});

test('triangles 超過 maxTriangles', () => {
  only(summarizeGlb(base(), 100, { maxTriangles: 11 }), '三角面');
});

test('byteLength 超過 maxBytes', () => {
  only(summarizeGlb(base(), 101, { maxBytes: 100 }), '大小');
});
