// 直接解析 GLB 的 JSON 區塊並檢查標記約定，不依賴 three.js。
import { readFileSync } from 'node:fs';

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`不是 GLB 檔：${path}`);
  }
  const chunkLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error(`第一個區塊不是 JSON：${path}`);
  }
  const json = JSON.parse(buf.toString('utf8', 20, 20 + chunkLen));
  return { json, byteLength: buf.length };
}

function primitiveTriangles(json, prim) {
  const mode = prim.mode ?? 4;
  const acc = prim.indices !== undefined
    ? json.accessors?.[prim.indices]
    : json.accessors?.[prim.attributes?.POSITION];
  const n = acc?.count ?? 0;
  if (mode === 4) return Math.floor(n / 3);
  if (mode === 5 || mode === 6) return Math.max(0, n - 2);
  return 0;
}

export function summarizeGlb(
  json,
  byteLength,
  { maxTriangles = 500000, maxBytes = 15 * 1024 * 1024 } = {},
) {
  const nodes = json.nodes ?? [];
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));

  const problems = [];
  const instances = [];
  const idSet = new Set();
  const repCount = new Map();
  let meshCount = 0;
  let triangles = 0;

  const label = (i) => `節點 ${i}（${nodes[i].name ?? '無名'}）`;

  nodes.forEach((n, i) => {
    const x = n.extras ?? {};
    if (x.inst !== undefined) {
      if (typeof x.organelle !== 'string') {
        problems.push(`${label(i)} 是個體根但缺少 organelle`);
      } else {
        instances.push({ id: x.organelle, inst: x.inst, rep: x.rep });
        idSet.add(x.organelle);
        repCount.set(x.organelle, (repCount.get(x.organelle) ?? 0) + (x.rep === 1 ? 1 : 0));
      }
    }
    if (n.mesh === undefined) return;
    meshCount++;
    if (typeof x.organelle !== 'string') problems.push(`${label(i)} 的網格缺少 organelle`);
    let hasAncestor = false;
    for (let p = parent.get(i); p !== undefined; p = parent.get(p)) {
      const e = nodes[p].extras ?? {};
      if (e.inst !== undefined || e.lid !== undefined) { hasAncestor = true; break; }
    }
    if (!hasAncestor) problems.push(`${label(i)} 的網格沒有 inst 或 lid 祖先`);
    const prims = json.meshes?.[n.mesh]?.primitives ?? [];
    if (prims.length !== 1) {
      problems.push(`${label(i)} 的 mesh 有 ${prims.length} 個 primitive（只能有 1 個）`);
    }
    for (const p of prims) triangles += primitiveTriangles(json, p);
  });

  for (const id of idSet) {
    const c = repCount.get(id) ?? 0;
    if (c !== 1) problems.push(`${id} 的 rep 個體有 ${c} 個（必須恰好 1 個）`);
  }
  if (triangles > maxTriangles) problems.push(`三角面 ${triangles} 超過上限 ${maxTriangles}`);
  if (byteLength > maxBytes) problems.push(`檔案大小 ${byteLength} 位元組超過上限 ${maxBytes}`);

  return { ids: [...idSet], instances, meshCount, triangles, byteLength, problems };
}
