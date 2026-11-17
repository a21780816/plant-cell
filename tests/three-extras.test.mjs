import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// 規格 §7 第 3 點的實測：Blender 自訂屬性經 glTF extras 進到 three.js 的 userData。
test('GLTFLoader 讀得到標記約定', async () => {
  const buf = readFileSync('tests/fixtures/tag_spike.glb');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(ab, '', resolve, reject));

  const all = [];
  gltf.scene.traverse((o) => all.push(o));
  const meshes = all.filter((o) => o.isMesh);
  assert.equal(meshes.length, 4);
  for (const m of meshes) {
    assert.ok(m.userData.organelle, `${m.name} 缺 organelle`);
    assert.ok(m.userData.part, `${m.name} 缺 part`);
  }
  assert.ok(all.some((o) => o.userData.lid === 1));
  assert.ok(all.some((o) => o.userData.inst === 0 && o.userData.rep === 1));
  assert.ok(all.some((o) => o.userData.anchor === 1));
});
