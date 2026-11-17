import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Object3D } from 'three';
import { parseModel, indexModel, findOrganelle, findInstanceRoot } from '../web/src/model.js';

async function load() {
  const buf = readFileSync('tests/fixtures/tag_spike.glb');
  const root = await parseModel(new Uint8Array(buf));
  return indexModel(root);
}

test('indexModel 依標記約定建立索引', async () => {
  const index = await load();
  const mito = index.byId.get('mitochondrion');
  assert.equal(mito.meshes.length, 2);
  assert.equal(mito.rep.userData.rep, 1);
  assert.equal(mito.anchor, mito.rep);
  const wall = index.byId.get('cell_wall');
  assert.equal(wall.meshes.length, 2); // 含蓋子裡那個
  assert.equal(wall.anchor.userData.anchor, 1);
  assert.notEqual(index.lid, null);
  assert.ok(index.radius > 0);
});

test('findOrganelle 越過沒有標記的中間層，頂層都沒有時回傳 null', () => {
  const top = new Object3D();
  top.userData.organelle = 'nucleus';
  const mid = new Object3D();
  const leaf = new Object3D();
  top.add(mid);
  mid.add(leaf);
  assert.equal(findOrganelle(leaf), 'nucleus');
  assert.equal(findInstanceRoot(leaf), null);
  top.userData.inst = 0;
  assert.equal(findInstanceRoot(leaf), top);
  const a = new Object3D();
  const b = new Object3D();
  a.add(b);
  assert.equal(findOrganelle(b), null);
});
