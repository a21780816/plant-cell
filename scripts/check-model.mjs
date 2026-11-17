#!/usr/bin/env node
// 用法：node scripts/check-model.mjs [--file assets/plant_cell.glb] [--ids a,b,c] [--max-triangles N]
import { readGlb, summarizeGlb } from './glb.mjs';

const argv = process.argv.slice(2);
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const file = opt('--file') ?? 'assets/plant_cell.glb';
const wanted = opt('--ids')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const maxTri = opt('--max-triangles');

const { json, byteLength } = readGlb(file);
const s = summarizeGlb(json, byteLength, maxTri ? { maxTriangles: Number(maxTri) } : {});
const missing = wanted.filter((id) => !s.ids.includes(id));

console.log(`檔案：${file}`);
console.log(`大小：${(byteLength / 1024 / 1024).toFixed(2)} MB（${byteLength} 位元組）`);
console.log(`網格：${s.meshCount}　三角面：${s.triangles}`);
console.log(`id（${s.ids.length}）：${s.ids.join(', ')}`);
console.log(`個體：${s.instances.map((i) => `${i.id}#${i.inst}${i.rep === 1 ? '*' : ''}`).join(' ')}`);
for (const m of missing) console.log(`缺少 id：${m}`);
for (const p of s.problems) console.log(`問題：${p}`);

process.exit(s.problems.length || missing.length ? 1 : 0);
