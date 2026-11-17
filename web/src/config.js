// 會在「選了別的構造」時變成殘影的外殼。
export const GHOST_IDS = ['cell_wall', 'middle_lamella', 'cell_membrane', 'cytoplasm'];
// 拆解時跟著外殼放大的構造（Task 11 使用）。
export const SCALE_IDS = [...GHOST_IDS, 'plasmodesmata', 'microtubule', 'actin_filament'];
