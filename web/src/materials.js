import { Color, MeshPhysicalMaterial } from 'three';
import { findOrganelle } from './model.js';

const NEUTRAL = '#B8B4AC';
const warned = new Set();

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
  switch (id) {
    case 'vacuole':
      // 半透明、不寫入深度：液泡裡的構造（細胞質絲等）在不透明階段已先畫好，透得過來。
      return new MeshPhysicalMaterial({
        ...base, roughness: 0.45, specularIntensity: 0.5, transparent: true, opacity: 0.5, depthWrite: false,
      });
    case 'cytoplasm':
      return new MeshPhysicalMaterial({
        ...base, transparent: true, opacity: 0.12, depthWrite: false, roughness: 0.8,
      });
    case 'cell_membrane':
      return new MeshPhysicalMaterial({
        ...base, transparent: true, opacity: 0.9, roughness: 0.6,
      });
    default:
      return new MeshPhysicalMaterial(base);
  }
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
      const translucent = own === 'vacuole' || own === 'cytoplasm' || own === 'cell_membrane';
      mesh.castShadow = !translucent;
      // 半透明層的繪製順序：細胞膜 → 細胞質 → 液泡（液泡不寫深度，要最後疊上去）
      if (own === 'cell_membrane') mesh.renderOrder = 0;
      else if (own === 'cytoplasm') mesh.renderOrder = 1;
      else if (own === 'vacuole') mesh.renderOrder = 2;
      mesh.receiveShadow = true;
    }
  }
}
