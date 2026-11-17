import { Color, MeshPhysicalMaterial } from 'three';
import { findOrganelle } from './model.js';

const NEUTRAL = '#B8B4AC';
const warned = new Set();

// 半透明構造的唯一定義：繪製順序（細胞膜 → 細胞質 → 液泡，後者疊在前者上）與各自的材質參數。
// 不使用 0，避免與日後預設為 0 的透明物件混排。三者都不寫入深度，
// 這樣液泡與細胞質後面、裡面的不透明構造與較後畫的半透明層都不會被擋掉。
// 只有 main 等非 cut 的 part 適用；cut 一律不透明。
const TRANSLUCENT = {
  cell_membrane: { order: 1, opacity: 0.9, roughness: 0.6 },
  cytoplasm: { order: 2, opacity: 0.12, roughness: 0.8 },
  vacuole: { order: 3, opacity: 0.5, roughness: 0.45, specularIntensity: 0.5 },
};

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

function isUnderLid(mesh) {
  for (let o = mesh; o; o = o.parent) if (o.userData && o.userData.lid === 1) return true;
  return false;
}

function lookupColor(palette, id, part) {
  const entry = id === null ? undefined : palette[id];
  if (!entry) {
    warnOnce(`id:${id}`, `[materials] palette 找不到構造 ${id}，改用中性灰`);
    return NEUTRAL;
  }
  if (entry[part]) return entry[part];
  return entry.main ?? NEUTRAL;
}

// 霧面的教科書插畫質感：粗糙度偏高、鏡面反射壓低。
function makeMaterial(id, part, color) {
  const c = new Color(color);
  const base = { color: c, roughness: 0.72, metalness: 0, specularIntensity: 0.35, clearcoat: 0 };
  if (part === 'cut') {
    // 剖面：更霧、更平，帶一點自發光讓它比外表面亮。
    return new MeshPhysicalMaterial({
      ...base, roughness: 0.92, specularIntensity: 0.1,
      emissive: c.clone(), emissiveIntensity: 0.12,
    });
  }
  const t = TRANSLUCENT[id];
  if (t) {
    const { order, ...params } = t;
    return new MeshPhysicalMaterial({ ...base, ...params, transparent: true, depthWrite: false });
  }
  return new MeshPhysicalMaterial(base);
}

export function applyMaterials(index, palette) {
  const shared = new Map();
  for (const [id, entry] of index.byId) {
    for (const mesh of entry.meshes) {
      const part = mesh.userData.part ?? 'main';
      const own = findOrganelle(mesh) ?? id;
      const color = lookupColor(palette, own, part);
      let mat;
      if (isUnderLid(mesh)) {
        mat = makeMaterial(own, part, color); // 蓋子獨立材質，之後單獨淡出
      } else {
        const key = `${own}/${part}`;
        if (!shared.has(key)) shared.set(key, makeMaterial(own, part, color));
        mat = shared.get(key);
      }
      mesh.material = mat;
      mesh.castShadow = !mat.transparent;
      mesh.renderOrder = mat.transparent ? TRANSLUCENT[own].order : 0;
      mesh.receiveShadow = true;
    }
  }
}
