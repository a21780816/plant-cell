import test from 'node:test';
import assert from 'node:assert/strict';
import { isClick } from '../web/src/picking.js';

test('isClick：位移 5 像素以內算點選', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 13, y: 14 }), true);
});

test('isClick：位移 6 像素算拖曳', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 16, y: 10 }), false);
});

import { Object3D, Mesh, BufferGeometry, BoxGeometry, MeshPhysicalMaterial, PerspectiveCamera } from 'three';
import { instanceOfMesh, isLidMesh, createPicker } from '../web/src/picking.js';
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

test('isLidMesh：蓋子底下的網格為真，本體的網格為假', () => {
  const { body, lidMesh } = fakeIndex();
  assert.equal(isLidMesh(lidMesh), true);
  assert.equal(isLidMesh(body), false);
});

test('蓋子內的網格完全不受 highlighter 管理：材質不被複製、不被改動', () => {
  const { index, body, lidMesh } = fakeIndex();
  const lidMat = lidMesh.material;
  const lidBefore = { c: lidMat.color.getHex(), e: lidMat.emissiveIntensity, o: lidMat.opacity, t: lidMat.transparent };
  const h = createHighlighter(index);
  assert.equal(lidMesh.material, lidMat, '蓋子的材質不可被替換成複製品');
  assert.notEqual(body.material, lidMat);
  h.apply({ selected: { id: 'cell_wall', inst: 3 }, hovered: { id: 'cell_wall', inst: 3 } });
  for (let i = 0; i < 40; i++) h.update(0.05);
  assert.ok(body.material.emissiveIntensity > 0.38, '本體仍正常發亮');
  assert.deepEqual({ c: lidMat.color.getHex(), e: lidMat.emissiveIntensity, o: lidMat.opacity, t: lidMat.transparent }, lidBefore);
  h.apply({ selected: { id: 'nucleus', inst: 0 }, hovered: null }); // 選別的構造：外殼本該變暗與殘影，蓋子仍不動
  for (let i = 0; i < 40; i++) h.update(0.05);
  assert.deepEqual({ c: lidMat.color.getHex(), e: lidMat.emissiveIntensity, o: lidMat.opacity, t: lidMat.transparent }, lidBefore);
});

test('射線穿過蓋子：蓋子在前、本體在後時打到本體（蓋著與否都一樣）', () => {
  const mk = (id, part, z, parent) => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshPhysicalMaterial());
    m.userData = { organelle: id, part };
    m.position.z = z;
    parent.add(m);
    return m;
  };
  const world = new Object3D();
  const rep = new Object3D();
  rep.userData = { organelle: 'nucleus', inst: 0, rep: 1 };
  world.add(rep);
  const behind = mk('nucleus', 'main', 0, rep);
  const lid = new Object3D();
  lid.userData = { lid: 1 };
  world.add(lid);
  const front = mk('cell_wall', 'main', 2, lid);
  const index = { byId: new Map([
    ['nucleus', { meshes: [behind], instances: [rep], rep, anchor: rep }],
    ['cell_wall', { meshes: [front], instances: [], rep: null, anchor: null }],
  ]) };
  const camera = new PerspectiveCamera(36, 800 / 600, 0.1, 50);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  world.updateMatrixWorld(true);
  const dom = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener() {}, removeEventListener() {},
  };
  const keep = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const picker = createPicker({ dom, camera, index, isPickable: () => true, onHover() {}, onPick() {} });
    assert.equal(picker.hitAt(400, 300).id, 'nucleus', '蓋子可見時射線也穿過它');
    lid.visible = false;
    assert.equal(picker.hitAt(400, 300).id, 'nucleus', '蓋子隱藏後同樣打到本體');
    picker.dispose();
  } finally {
    globalThis.window = keep;
  }
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
