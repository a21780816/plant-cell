import test from 'node:test';
import assert from 'node:assert/strict';
import { isClick } from '../web/src/picking.js';

test('isClick：位移 5 像素以內算點選', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 13, y: 14 }), true);
});

test('isClick：位移 6 像素算拖曳', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 16, y: 10 }), false);
});

import { Object3D, Mesh, BufferGeometry, MeshPhysicalMaterial } from 'three';
import { instanceOfMesh } from '../web/src/picking.js';
import { createHighlighter } from '../web/src/highlight.js';
import { ghostOrderOf, GHOST_ORDER } from '../web/src/config.js';

// 最小的假模型：id 為 cell_wall，一個代表個體（有網格）加一個蓋子（裡面的網格沒有個體根）。
function fakeIndex() {
  const mk = (name, part) => {
    const m = new Mesh(new BufferGeometry(), new MeshPhysicalMaterial({ color: '#CFC2A3' }));
    m.name = name;
    m.userData = { organelle: 'cell_wall', part };
    return m;
  };
  const rep = new Object3D();
  rep.userData = { organelle: 'cell_wall', inst: 3, rep: 1 };
  const body = mk('wall_main', 'main');
  rep.add(body);
  const lid = new Object3D();
  lid.userData = { lid: 1 };
  const lidMesh = mk('wall_lid_main', 'main');
  lid.add(lidMesh);
  const index = { byId: new Map([['cell_wall', { meshes: [body, lidMesh], instances: [rep], rep, anchor: rep }]]) };
  return { index, body, lidMesh };
}

test('沒有個體根的網格（蓋子內）視為該 id 的代表個體', () => {
  const { index, body, lidMesh } = fakeIndex();
  assert.equal(instanceOfMesh(body, index), 3);
  assert.equal(instanceOfMesh(lidMesh, index), 3);
});

test('代表個體被選時，蓋子內的網格與本體以相同強度發亮', () => {
  const { index, body, lidMesh } = fakeIndex();
  const h = createHighlighter(index);
  h.apply({ selected: { id: 'cell_wall', inst: 3 }, hovered: null });
  for (let i = 0; i < 40; i++) h.update(0.05);
  assert.equal(lidMesh.material.emissiveIntensity, body.material.emissiveIntensity);
  assert.ok(body.material.emissiveIntensity > 0.38, '應是被選的強度（約 0.45），不是同類微亮的 0.2');
});

test('外殼殘影的繪製順序：由外到內遞增、都不為 0、細胞膜與細胞質沿用 1 與 2', () => {
  const neighborCut = { userData: { part: 'cut' }, name: 'neighbor_cut' };
  const order = [
    ghostOrderOf('cell_wall', neighborCut),
    ghostOrderOf('middle_lamella', { userData: { part: 'main' }, name: 'lamella_main' }),
    ghostOrderOf('cell_wall', { userData: { part: 'main' }, name: 'wall_main' }),
    ghostOrderOf('cell_membrane', { userData: { part: 'cut' }, name: 'membrane_cut' }),
    ghostOrderOf('cytoplasm', { userData: { part: 'main' }, name: 'x' }),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(new Set(order).size, 5);
  assert.ok(order.every((o) => o !== 0));
  assert.ok(order.slice(0, 3).every((o) => o < 1));
  assert.equal(GHOST_ORDER.cell_membrane, 1);
  assert.equal(GHOST_ORDER.cytoplasm, 2);
});
