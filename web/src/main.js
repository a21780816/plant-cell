import modelBytes from '../../assets/plant_cell.glb';
import palette from '../../shared/palette.json';
import { createScene } from './scene.js';
import { parseModel, indexModel, findOrganelle } from './model.js';
import { applyMaterials } from './materials.js';

const canvas = document.getElementById('stage');
const root = document.documentElement;

async function main() {
  const view = createScene(canvas);
  const model = await parseModel(modelBytes);
  const index = indexModel(model);
  applyMaterials(index, palette);
  view.scene.add(model);
  if (index.lid) index.lid.visible = false; // 本階段畫面是掀開狀態

  view.frame(index.center, index.radius);

  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const triangles = meshes.reduce((n, m) => {
    const g = m.geometry;
    return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
  }, 0);
  const ids = [...new Set(meshes.map(findOrganelle).filter((x) => x !== null))];

  const dts = [];
  window.__cell = {
    index,
    view, // 除錯與端對端測試用
    stats() {
      const avg = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
      return {
        meshes: meshes.length,
        unresolved: meshes.filter((m) => findOrganelle(m) === null).length,
        ids,
        triangles,
        fps: avg > 0 ? 1 / avg : 0,
      };
    },
  };

  let first = true;
  view.start((dt) => {
    dts.push(dt);
    if (dts.length > 60) dts.shift();
    if (first) { first = false; root.dataset.cellReady = '1'; }
  });
}

main().catch((e) => {
  root.dataset.cellError = String(e && e.message ? e.message : e);
  console.warn('[cell] 載入失敗', e);
});
