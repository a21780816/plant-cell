// 會在「選了別的構造」時變成殘影的外殼。
export const GHOST_IDS = ['cell_wall', 'middle_lamella', 'cell_membrane', 'cytoplasm'];
// 拆解時跟著外殼放大的構造（Task 11 使用）。
export const SCALE_IDS = [...GHOST_IDS, 'plasmodesmata', 'microtubule', 'actin_filament'];

// 選取細胞質時它那一片的外觀（細胞質沒有形狀，選取時整片染色而不是讓別的構造褪色）。
export const CYTOPLASM_SELECTED = { color: '#E8B95A', opacity: 0.38, emissive: 0.25 };

// 外殼變殘影時的繪製順序（由外到內遞增）。與 materials.js 的 TRANSLUCENT 表銜接：
// 該表已定細胞膜 1、細胞質 2，這裡的細胞膜與細胞質沿用同一值，其餘外殼排在它們之前（都小於 1、不為 0）。
// 相鄰細胞的壁（含其切面）在最外，其次中膠層、本細胞的壁。切面一律與同構造同值。
export const GHOST_ORDER = {
  neighbor: 0.2,
  middle_lamella: 0.4,
  cell_wall: 0.6,
  cell_membrane: 1,
  cytoplasm: 2,
};

// 相鄰細胞壁的網格：part 為 neighbor，或其切面（模型裡名稱以 neighbor 開頭）。
export function ghostOrderOf(id, mesh) {
  if (id === 'cell_wall' && (mesh.userData.part === 'neighbor' || String(mesh.name).startsWith('neighbor'))) {
    return GHOST_ORDER.neighbor;
  }
  return GHOST_ORDER[id];
}
