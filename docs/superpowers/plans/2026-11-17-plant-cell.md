# 互動式植物細胞模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 `dist/plant-cell.html`：在 Chrome 點兩下就能離線打開，可以旋轉、點選、拆解、測驗的精美 3D 植物細胞。

**Architecture:** Blender 用 Python 腳本程序化生成模型並匯出 `.glb`，每個物件用自訂屬性標明它屬於哪個構造。網頁用 three.js 載入模型，材質與互動都在網頁端定義。純邏輯（狀態、測驗、拆解位置）與繪圖分開：前者用 Node 內建測試，後者用無介面 Chrome 做端對端檢查。esbuild 把程式、樣式、模型全部內嵌成單一 HTML。

**Tech Stack:** Blender 5.2.2 LTS（內建 Python 3.13.13）、three 0.187.0、esbuild 0.28.2、Node.js 22（`node --test`、內建 `WebSocket` 與 `fetch`）、Google Chrome 158 headless（已實測無介面模式可用 WebGL2）。

**Spec:** `docs/superpowers/specs/2026-11-17-plant-cell-design.md`

**修訂紀錄：** 2026-11-17 經獨立審查後修訂（版面座標重排並驗算、蓋子處理、拆解斷言、並行規則等 21 項）。

## Global Constraints

- 成品是單一檔案 `dist/plant-cell.html`，不得向外部請求任何資源（無 `<script src>`、無 `<link>`、無網路字型）。
- Chrome 必過；Safari 只在最後由主持人實測一次並如實回報。
- 相依套件只有 `three@0.187.0`（dependencies）與 `esbuild@0.28.2`（devDependencies），版本鎖死（`--save-exact`）。不得新增其他套件。
- 執行 Blender 一律透過 `node scripts/run-blender.mjs`。旗標順序固定為 `--background --factory-startup --python-exit-code 1 --python <script> -- <args>`（`--python-exit-code` 必須在 `--python` 之前才有效）。不得使用系統的 `python3`。
- Blender 5.x 的 API 以這台電腦實際的為準：不確定的運算子或列舉值，先用 `--python-expr` 查，不憑印象寫。已查證：算圖引擎列舉值是 `'BLENDER_EEVEE'`；`export_extras`、`export_apply`、`export_texcoords`、`export_tangents` 都存在；內建 numpy。
- 匯出 glTF 必須 `export_extras=True`、套用修改器、不帶 UV 與切線。
- **一個網格物件只有一種材質**。需要第二種顏色就拆成另一個子物件。
- 標記約定（glTF `extras`，載入後在 `userData`）：
  - 個體根節點（Empty）：`organelle`（id）、`inst`（同一 id 內從 0 起算的整數）、`rep`（1 或 0）。位置放在該個體所有網格的幾何中心。每個 id 第一個建立的個體自動是代表（`rep: 1`），所以代表個體一律最先建立。
  - 網格：`organelle`（id）、`part`（字串，預設 `"main"`），必須是某個個體根節點或蓋子根節點的子孫。
  - 錨點（Empty，可有可無）：代表個體根底下一個標 `anchor: 1` 的 Empty，是名稱標籤與鏡頭靠近的目標點。沒有就用個體根的位置。
  - 蓋子根節點（Empty）：`lid: 1`，底下只放外殼被掀開的那一角。
- 15 個 id，順序固定：`cell_wall, cell_membrane, cytoplasm, nucleus, nucleolus, rough_er, smooth_er, ribosome, golgi, mitochondrion, chloroplast, vacuole, peroxisome, plasmodesmata, cytoskeleton`。
- 預算：三角面總數硬上限 500,000（目標 300,000 以內）；`assets/plant_cell.glb` ≤ 15 MB；`dist/plant-cell.html` ≤ 25 MB；這台電腦上 ≥ 50 fps。
- 介面文字用繁體中文、台灣課本用語。15 項的清單標題叫「細胞構造」，不叫「胞器」。禁用詞：線粒體、高爾基體、胞間連絲、溶酶體、溶體、中心粒、中心體、細胞器。
- 生物學：不畫中心粒、不畫溶體。液泡刻意縮小，介紹裡要寫明。
- 字體只用系統字體：`-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif`。
- git 只在本機，絕不 push。提交用 `git add <明確路徑>` 接 `git commit -m "…" -- <同樣的路徑>`；禁止 `git add -A`、reset、rebase、amend。
- 不提交產生物：`node_modules/`、`dist/`、`assets/*.glb`、`assets/parts/`、`assets/preview/`、`.chrome-profile/`。

## 座標與版面（Blender 座標，Z 朝上）

以下數值已用腳本驗算：全部在空腔內、兩兩不重疊、從預設鏡頭看得到。寫在 `blender/cellkit/common.py`，是所有模組的唯一來源。

| 常數 | 值 |
|---|---|
| `CELL_HALF` | `(5.0, 3.5, 3.2)`，指細胞壁外表面；外圓角 `CORNER_R = 1.0` |
| `WALL_T` / `GAP` / `MEMBRANE_T` | `0.28` / `0.04` / `0.06` |
| 空腔（細胞膜內側） | 半寬 `(4.62, 3.12, 2.82)`（`CELL_HALF` 各減 0.38），內圓角 `0.62` |
| 掀開區 `in_cut(p)` | `p.x >= -2.2 and p.y <= 0.8 and p.z >= -1.4` |
| `VACUOLE` | 中心 `(-1.6, 0.9, -0.2)`，半軸 `(2.7, 1.95, 2.1)`，表面起伏振幅上限 `0.10` |
| `NUCLEUS` | 中心 `(2.7, -0.6, 0.6)`，半徑 `1.15` |
| `NUCLEUS_ZONE` | 以細胞核中心為球心、半徑 `1.80` 的禁入球（含粗糙內質網） |
| `RER` | 軸 `(-0.75, 0.55, 0.35)`；只在「方向與軸的內積 > 0.1」的那半邊；4 層薄片，半徑 `1.30, 1.42, 1.54, 1.66` |
| `SER` | 繞細胞核的扇形區：軸 `(0.35, -0.45, -0.8)`，方向與軸的內積 > 0.55，距核心 `1.35` 到 `1.95`。禁入區取內積 > 0.5、半徑 `2.05` |
| `GOLGI` | `[(-0.3, -2.2, 0.2), (-3.3, -2.1, -1.5)]`，第一個是代表個體；禁入球半徑 `0.75` |
| 代表個體位置 | 葉綠體 `(-1.2, -2.4, 1.7)`、粒線體 `(0.9, -2.5, -0.7)`、過氧化體 `(0.5, -2.6, 1.6)` |
| `CAMERA_DIR` | `(0.62, -0.62, 0.48)`（預設鏡頭所在方向；剖面一律朝這個方向） |
| `SEED` | `20261117` |

- 匯出後 Blender 的 `(x, y, z)` 變成 three.js 的 `(x, z, -y)`。預設鏡頭在 three.js 的 `(0.62, 0.48, 0.62)` 方向，正對掀開的那一角。
- 固定位置的構造（液泡、細胞核、粗糙內質網、平滑內質網、高基氏體）**不呼叫 `reserve`**，它們已內建在 `is_free` 的禁入區。`reserve` 只給葉綠體、粒線體、過氧化體與游離核糖體群使用。核仁在細胞核內，也不呼叫 `reserve`。

## 配色（`shared/palette.json`，Blender 與網頁共用）

```json
{
  "cell_wall":     { "main": "#86B94A", "cut": "#B5D97A" },
  "cell_membrane": { "main": "#F0C75E", "cut": "#F7DE96" },
  "cytoplasm":     { "main": "#D8F0C2" },
  "nucleus":       { "main": "#8D6CC9", "cut": "#C9B3EC", "pore": "#5E4A9A", "chromatin": "#6B4FB0" },
  "nucleolus":     { "main": "#54348F" },
  "rough_er":      { "main": "#4D7FD6" },
  "smooth_er":     { "main": "#3FB7C4" },
  "ribosome":      { "main": "#2C2A5A" },
  "golgi":         { "main": "#F29E4C", "vesicle": "#F7C27E" },
  "mitochondrion": { "main": "#E2553D", "cut": "#F4A58C", "cristae": "#C43C2A" },
  "chloroplast":   { "main": "#3E9B3E", "cut": "#9BD36A", "grana": "#1F6B2E" },
  "vacuole":       { "main": "#9FD8F2" },
  "peroxisome":    { "main": "#E86FA0", "cut": "#F6B5CC", "core": "#B23A6E" },
  "plasmodesmata": { "main": "#2E8B6F" },
  "cytoskeleton":  { "main": "#D9D4F0", "filament": "#F2C6D8" }
}
```

## Review Focus

1. 拖曳旋轉後放開滑鼠，不可被當成點選。→ Task 9 `isClick` 與端對端
2. 鏡頭還在移動時又點另一個構造，以最後一次為準、不卡住。→ Task 9 端對端
3. 測驗進行中按拆解、標籤或點清單，不洩漏名稱、不破壞測驗；離開後回到原本狀態。→ Task 12 狀態測試
4. 視窗縮放或窄螢幕時畫面不變形、面板不蓋住模型。→ Task 13 端對端
5. 瀏覽器不能用 WebGL 時顯示說明文字，不是空白頁。→ Task 10 端對端

## 執行順序

- Task 1 → Task 2 必須依序。
- Task 3、4、5 彼此獨立（各自只建立自己的一個檔案），可以同時進行。
- Task 8（介紹文字）不依賴模型，也不受檢查點一限制，可以提早與 Task 2 到 7 同時進行。
- **同時進行的任務（3、4、5、8）不自行提交**，完成後回報，由主持人逐一提交。它們只跑自己任務寫明的檢查指令，不跑 `npm test`。
- Task 8 要在 Task 6 開始前完成並由主持人提交，這樣 Task 6 之後的 `npm test` 才不會掃到半成品。
- 其餘依編號順序。三個 🛑 檢查點要等使用者確認才往下。

---

## 第一階段：到檢查點一（模型初版）

### Task 1: 專案骨架、工具鏈、標記約定驗證

**Files:**
- Create: `.gitignore`, `package.json`, `shared/palette.json`, `scripts/run-blender.mjs`, `scripts/glb.mjs`, `scripts/check-model.mjs`, `blender/spike_tags.py`, `tests/fixtures/tag_spike.glb`
- Test: `tests/glb.test.mjs`, `tests/three-extras.test.mjs`

**Interfaces:**
- Produces:
  - `node scripts/run-blender.mjs <script.py> [script args…]`：以 Global Constraints 的固定旗標執行 Blender，結束碼照傳。
  - `readGlb(path) → { json, byteLength }`
  - `summarizeGlb(json, byteLength, { maxTriangles = 500000, maxBytes = 15*1024*1024 } = {}) → { ids: string[], instances: {id, inst, rep}[], meshCount, triangles, byteLength, problems: string[] }`
  - `node scripts/check-model.mjs [--file assets/plant_cell.glb] [--ids a,b,c] [--max-triangles N]`：印出摘要；`problems` 非空或缺少 `--ids` 指定的 id 時結束碼 1。
  - `package.json` scripts：`"test": "node --test \"tests/*.test.mjs\""`、`"model": "node scripts/run-blender.mjs blender/build_cell.py"`、`"build": "node scripts/build.mjs"`、`"dev": "node scripts/build.mjs --watch --serve"`、`"e2e": "node scripts/build.mjs && node --test --test-concurrency=1 \"tests/e2e/*.e2e.mjs\""`。

- [ ] **Step 1:** `git init -b main`；建立 `.gitignore`（內容見 Global Constraints）與 `package.json`（`"type": "module"`、`"private": true`）；`npm install --save-exact three@0.187.0` 與 `npm install --save-dev --save-exact esbuild@0.28.2`；寫入 `shared/palette.json`（內容見上）。
- [ ] **Step 2:** 寫 `scripts/run-blender.mjs`。驗證：用它執行一支只有 `raise RuntimeError('x')` 的暫存腳本，確認結束碼是 1，再刪除暫存腳本。
- [ ] **Step 3:** 寫 `blender/spike_tags.py`，匯出 `tests/fixtures/tag_spike.glb`：個體根 `mitochondrion/inst 0/rep 1` 底下兩個方塊（`part` 為 `main` 與 `cristae`）；個體根 `cell_wall/inst 0/rep 1` 底下一個方塊與一個標 `anchor: 1` 的 Empty；蓋子根 `lid: 1` 底下一個標 `cell_wall` 的方塊。
- [ ] **Step 4:** 寫失敗測試 `tests/glb.test.mjs`：

```js
test('fixture 摘要', () => {
  const { json, byteLength } = readGlb('tests/fixtures/tag_spike.glb');
  const s = summarizeGlb(json, byteLength);
  assert.deepEqual(s.ids.sort(), ['cell_wall', 'mitochondrion']);
  assert.equal(s.meshCount, 4);
  assert.equal(s.triangles, 48);
  assert.deepEqual(s.problems, []);
});
// 以下各用手寫的最小 json，各自斷言 problems 恰有一條且訊息含關鍵字：
// 網格缺 organelle →「organelle」；網格沒有 inst 或 lid 祖先 →「祖先」；
// 同一 id 有兩個 rep →「rep」；同一 id 沒有 rep →「rep」；
// 一個 mesh 有兩個 primitives →「primitive」；triangles 超過 maxTriangles →「三角面」；
// byteLength 超過 maxBytes →「大小」。
```

- [ ] **Step 5:** 跑 `npm test`，確認因 `scripts/glb.mjs` 不存在而失敗。
- [ ] **Step 6:** 實作 `scripts/glb.mjs` 與 `scripts/check-model.mjs`（直接解析 GLB 的 JSON 區塊，不依賴 three.js）。跑 `npm test` 通過。
- [ ] **Step 7:** 寫 `tests/three-extras.test.mjs`：在 Node 裡用 `GLTFLoader.parse` 載入 fixture，斷言每個 `isMesh` 物件的 `userData.organelle` 與 `userData.part` 存在、存在 `userData.lid === 1` 的節點、存在 `userData.inst === 0 && userData.rep === 1` 的節點、存在 `userData.anchor === 1` 的節點。這是規格 §7 第 3 點的實測。**若 `GLTFLoader` 在 Node 無法執行，回報 BLOCKED，不要自行改用別的方法。**
- [ ] **Step 8:** `npm test` 全數通過後提交（路徑：`.gitignore package.json package-lock.json shared scripts blender tests docs`），訊息 `chore: 專案骨架與 glb 標記約定驗證`。

### Task 2: Blender 共用工具與外殼

**Files:**
- Create: `blender/build_cell.py`, `blender/cellkit/__init__.py`, `blender/cellkit/common.py`, `blender/cellkit/shell.py`

**Interfaces:**
- Consumes: `scripts/run-blender.mjs`、`scripts/check-model.mjs`、`shared/palette.json`
- Produces（`common.py`）：
  - 「座標與版面」表的所有常數；`in_cut(p) → bool`；`cavity_sdf(p) → float`（圓角盒的有號距離，負值在空腔內）；`inside_cavity(p, margin=0.0) → bool`（`cavity_sdf(p) <= -margin`）
  - `validate_layout() → None`：檢查固定位置的構造都在空腔內且兩兩間隙不小於 0.1，不符就 `raise ValueError` 並指出是哪兩個。粗糙內質網與平滑內質網這一對本來就相連，只檢查兩個扇形區不重疊，不要求間隙。`build_cell.py` 一開始就呼叫。
  - `class PlacementError(RuntimeError)`
  - `class Ctx`：`rng: random.Random`；`is_free(center, radius) → bool`，以下任一成立就回 `False`：不在空腔內（含 `radius`）、進入液泡橢球（半軸各加 `0.15 + radius`）、進入 `NUCLEUS_ZONE`（加 `radius`）、進入 `SER` 禁入區（加 `radius`）、進入任一高基氏體禁入球（加 `radius`）、與任何已 `reserve` 的球重疊；`reserve(name, center, radius) → None`（先以 `is_free` 檢查，不通過就 `raise ValueError`）；`sample_free(radius, want_cut, tries=5000, accept=None) → (x, y, z)`（在空腔內均勻取樣，回傳第一個通過 `is_free`、`in_cut` 等於 `want_cut`、且 `accept(p)` 為真的點；`want_cut` 為真時整顆球都要在掀開區內；試滿仍找不到就 `raise PlacementError`）
  - `new_instance(organelle_id, location) → Object`（Empty，自動編 `inst`，該 id 的第一個自動 `rep: 1`）
  - `add_part(root, mesh_obj, part='main') → None`（設為子物件並保持世界座標、寫入 `organelle` 與 `part`、指定 `material_for` 的材質、平滑著色）
  - `add_anchor(root, location) → None`（在個體根底下加一個標 `anchor: 1` 的 Empty）
  - `material_for(organelle_id, part) → Material`（顏色取自 palette，有快取）
  - `export_glb(path) → None`
- Produces（`build_cell.py`）：`MODULES = ['shell', 'core', 'energy', 'endomembrane']`，每個模組提供 `build(ctx) → None`。參數：`--only a,b`（只建指定模組；此時預設輸出 `assets/parts/<第一個模組>.glb`）、`--out <path>`（預設 `assets/plant_cell.glb`）、`--preview <png>`（建完後用 EEVEE 從四個角度算圖，其中第一個角度是 `CAMERA_DIR`，以 numpy 拼成一張 2×2、1600×1200 的圖）。遇到 `PlacementError` 就清空場景、把種子加 1 整個重建，最多重試 20 次。完整建置時缺任何模組要報錯。

**外殼規格（`shell.py`）：**

| id | 形狀 | parts | 錨點 |
|---|---|---|---|
| `cell_wall` | 圓角盒殼，厚 `WALL_T`，表面有輕微的纖維起伏。切掉掀開區，切面獨立成 `cut`。 | `main`, `cut` | `(-3.6, 0.0, 3.2)`（頂面） |
| `cell_membrane` | 緊貼細胞壁內側（間隙 `GAP`）的薄殼，厚 `MEMBRANE_T`。同樣切掉掀開區。 | `main`, `cut` | `(-2.2, -1.2, 2.85)`（切面上） |
| 蓋子 | 細胞壁與細胞膜被切掉的那一角，放在蓋子根節點下，各自標 `cell_wall` / `cell_membrane`。蓋回去時要與本體密合。 | `main`, `cut` | 無 |
| `cytoplasm` | 細胞膜內側空間的實心體，同樣切掉掀開區（掀開區內沒有細胞質，胞器直接露出）。 | `main` | `(-2.2, -2.0, 1.6)`（切面上） |
| `plasmodesmata` | 16 條貫穿細胞壁的短管（半徑 0.07），兩端有小環。至少 3 條落在切面上被剖開。合併成一個網格。 | `main` | 其中一條被剖開的管子上 |

- [ ] **Step 1:** 寫 `common.py` 與 `build_cell.py`。
- [ ] **Step 2:** 寫 `shell.py`。
- [ ] **Step 3:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only shell --preview assets/preview/shell.png`，結束碼 0（代表 `validate_layout` 也通過）。
- [ ] **Step 4:** 跑 `node scripts/check-model.mjs --file assets/parts/shell.glb --ids cell_wall,cell_membrane,cytoplasm,plasmodesmata --max-triangles 40000`，結束碼 0。
- [ ] **Step 5:** 用 Read 打開 `assets/preview/shell.png` 自我檢查：外形是圓角盒不是圓球；掀開的一角乾淨、切面看得出細胞壁與細胞膜兩層；蓋子蓋著時密合。不符就修到符合。
- [ ] **Step 6:** 提交（路徑：`blender`），訊息 `feat: Blender 共用工具與細胞外殼`。

### Task 3: 液泡、細胞核、核仁（`core.py`）

**Files:**
- Create: `blender/cellkit/core.py`

**Interfaces:**
- Consumes: Task 2 的 `common.py` 全部介面。本任務的三個構造都是固定位置，**不呼叫 `reserve`**。

| id | 形狀 | parts | 錨點 |
|---|---|---|---|
| `vacuole` | 依 `VACUOLE` 的橢球，加低頻起伏（振幅不超過 0.10）成為不規則的飽滿水囊，表面平滑。 | `main` | 朝 `CAMERA_DIR` 的表面上 |
| `nucleus` | 依 `NUCLEUS` 的球。朝鏡頭的八分之一（局部座標 `x>0, y<0, z>0`）切開，切面看得出核膜厚度 0.08 與內部。表面約 70 個核孔（小環）。內部有 6 條糾結的染色質細線（半徑 0.03）。 | `main`, `cut`, `pore`, `chromatin` | 切口邊緣的核膜上 |
| `nucleolus` | 半徑 0.42 的球，位於細胞核中心偏 `(0.15, -0.1, 0.1)`，表面略帶顆粒感，從切口看得到。獨立的個體根。 | `main` | 無 |

- [ ] **Step 1:** 寫 `core.py`。
- [ ] **Step 2:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only core --preview assets/preview/core.png`，結束碼 0。
- [ ] **Step 3:** 跑 `node scripts/check-model.mjs --file assets/parts/core.glb --ids vacuole,nucleus,nucleolus --max-triangles 50000`，結束碼 0。
- [ ] **Step 4:** 用 Read 看 `assets/preview/core.png`：液泡不是正橢球；細胞核切口看得到核仁與染色質；核孔分布均勻。不符就修。
- [ ] **Step 5:** 回報完成（不自行提交）。

### Task 4: 葉綠體、粒線體、過氧化體（`energy.py`）

**Files:**
- Create: `blender/cellkit/energy.py`

**Interfaces:**
- Consumes: Task 2 的 `common.py` 全部介面

| id | 數量 | 碰撞半徑 | 形狀 | parts |
|---|---|---|---|---|
| `chloroplast` | 10（4 個在掀開區內） | 0.62 | 透鏡形橢球，半軸 `(0.62, 0.36, 0.24)`。代表個體與另外 1 個沿長軸剖開一半：可見 6 疊葉綠餅（每疊 6 片圓盤，半徑 0.09、厚 0.025），疊與疊之間有細薄片相連。 | `main`, `cut`, `grana` |
| `mitochondrion` | 8（4 個在掀開區內） | 0.48 | 略彎的膠囊，長 0.95、半徑 0.2。代表個體沿長軸剖開：可見內膜向內皺褶形成的嵴（波浪狀隔板）。 | `main`, `cut`, `cristae` |
| `peroxisome` | 5（2 個在掀開區內） | 0.25 | 半徑 0.2 的球，表面略帶顆粒。代表個體剖開，可見中央的多面體結晶核。 | `main`, `cut`, `core` |

- 建立順序：三個代表個體先建（位置依「座標與版面」表），各自 `reserve`；其餘用 `ctx.sample_free` 取位置後 `reserve`。
- 代表個體**不隨機轉向**：剖面的法線朝 `CAMERA_DIR`，長軸與 `CAMERA_DIR` 垂直。其餘個體隨機轉向，但葉綠體扁的那面朝向最近的細胞膜。
- 葉綠體只放在靠近細胞膜的皮層：`accept` 要求 `-cavity_sdf(p) <= 1.24`（下限已由 `is_free` 的碰撞半徑 0.62 保證）。

- [ ] **Step 1:** 寫 `energy.py`。
- [ ] **Step 2:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only energy --preview assets/preview/energy.png`，結束碼 0。
- [ ] **Step 3:** 跑 `node scripts/check-model.mjs --file assets/parts/energy.glb --ids chloroplast,mitochondrion,peroxisome --max-triangles 100000`，結束碼 0。
- [ ] **Step 4:** 用 Read 看 `assets/preview/energy.png`：葉綠餅是一疊疊圓盤、粒線體的嵴看得出皺褶、三個代表個體的剖面朝向第一個視角、沒有任何兩個個體相交。不符就修。
- [ ] **Step 5:** 回報完成（不自行提交）。

### Task 5: 內質網、核糖體、高基氏體、細胞骨架（`endomembrane.py`）

**Files:**
- Create: `blender/cellkit/endomembrane.py`

**Interfaces:**
- Consumes: Task 2 的 `common.py` 全部介面。粗糙內質網、平滑內質網、高基氏體是固定位置，**不呼叫 `reserve`**。

| id | 形狀 | parts | 錨點 |
|---|---|---|---|
| `rough_er` | 依 `RER`：4 層同心的皺褶薄片（厚 0.05），只在軸的那半邊，邊緣呈波浪狀。一個個體。 | `main` | 最外層薄片朝 `CAMERA_DIR` 露出的邊緣上 |
| `ribosome` | 小球，半徑 0.045。兩個個體，各合併成一個網格：先建「附著的」（約 500 顆貼在粗糙內質網薄片表面，為代表），再建「游離的」（14 群，每群約 10 顆，其中 6 群在掀開區；每群以 `sample_free(0.2, …)` 取位置並 `reserve`）。 | `main` | 粗糙內質網露出的邊緣上的一顆 |
| `smooth_er` | 依 `SER` 扇形區內的分支管網（半徑 0.065，9 到 12 條分支，有三叉接點）。管上所有點都要 `inside_cavity(p, 0.1)` 且在液泡外。至少 2 條管延伸出扇形區、末端接到粗糙內質網最外層薄片的邊緣。一個個體。 | `main` | 管網朝 `CAMERA_DIR` 最外側的一個接點 |
| `golgi` | 2 個，位置依 `GOLGI`。每個是 6 片彎成弓形的扁囊疊在一起（最大 1.1 × 0.5 × 0.06，間距 0.10，逐片縮小到 0.7），邊緣有 14 顆半徑 0.05 到 0.09 的小泡。整體要在半徑 0.7 的球內。代表個體的堆疊方向與 `CAMERA_DIR` 垂直（從鏡頭看到的是一疊弓形的側面）。 | `main`, `vesicle` | 無 |
| `cytoskeleton` | 16 條微管（半徑 0.022）沿細胞膜內側走，12 條微絲（半徑 0.012）穿過細胞質。不得穿過液泡與 `NUCLEUS_ZONE`。一個個體。 | `main`, `filament` | 掀開區內看得到的一條微管中點 |

- [ ] **Step 1:** 寫 `endomembrane.py`。
- [ ] **Step 2:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only endomembrane --preview assets/preview/endomembrane.png`，結束碼 0。
- [ ] **Step 3:** 跑 `node scripts/check-model.mjs --file assets/parts/endomembrane.glb --ids rough_er,ribosome,smooth_er,golgi,cytoskeleton --max-triangles 100000`，結束碼 0。
- [ ] **Step 4:** 用 Read 看 `assets/preview/endomembrane.png`：粗糙內質網是層層薄片不是實心殼、核糖體看得出是一顆顆、平滑內質網是相連的管網、高基氏體是弓形扁囊堆疊。不符就修。
- [ ] **Step 5:** 回報完成（不自行提交）。

### Task 6: 模型整合與檢查

**Files:**
- Modify: `blender/cellkit/*.py`（只修整合時發現的重疊或穿模）
- Test: `tests/model.test.mjs`

- [ ] **Step 1:** 寫失敗測試 `tests/model.test.mjs`：讀 `assets/plant_cell.glb`，斷言 `summarizeGlb` 的 `ids` 排序後等於 Global Constraints 的 15 個 id、`problems` 為空、`triangles <= 500000`、`byteLength <= 15*1024*1024`。檔案不存在時要失敗，不是跳過。
- [ ] **Step 2:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --preview assets/preview/full.png`。四個模組共用同一個 `Ctx`。若固定位置的構造互相穿插（`validate_layout` 沒攔到的），**回報 BLOCKED 並附上是哪兩個構造**，不要自行移動「座標與版面」表的數值。
- [ ] **Step 3:** 跑 `npm test` 全數通過；跑 `node scripts/check-model.mjs` 並在回報中附上輸出的三角面數與檔案大小。
- [ ] **Step 4:** 用 Read 看 `assets/preview/full.png`：從掀開的一角看得到液泡、細胞核切口、粗糙內質網的層層邊緣、平滑內質網、代表高基氏體、剖開的葉綠體與粒線體；沒有構造穿出細胞膜。不符就修。
- [ ] **Step 5:** 提交（路徑：`blender tests/model.test.mjs`），訊息 `feat: 完整模型與預算檢查`。

### Task 7: 網頁檢視器與單檔打包

**Files:**
- Create: `scripts/build.mjs`, `scripts/cdp.mjs`, `web/template.html`, `web/styles.css`, `web/src/main.js`, `web/src/scene.js`, `web/src/model.js`, `web/src/materials.js`, `.claude/launch.json`
- Test: `tests/model-index.test.mjs`, `tests/e2e/viewer.e2e.mjs`

**Interfaces:**
- Consumes: `assets/plant_cell.glb`、`shared/palette.json`
- Produces:
  - `scripts/build.mjs`：`build({ minify = true } = {}) → Promise<{ outfile, bytes }>`。esbuild 設定：`bundle`、`format: 'iife'`、loader `{ '.glb': 'binary', '.css': 'text', '.json': 'json' }`。把結果填進 `web/template.html` 的 `<!--STYLE-->` 與 `<!--SCRIPT-->`：填入時用 `replace(標記, () => 內容)` 的函式寫法（避免內容裡的 `$&` 等被當成替換樣式），並把腳本中的 `</script` 跳脫。旗標 `--watch`（原始碼變動就重建）、`--serve`（在 5173 埠提供 `dist/`）。
  - `scripts/cdp.mjs`：`openPage(target, { width = 1280, height = 800, offline = false, initScript = null } = {}) → Promise<page>`。`target` 是檔案路徑或網址；`initScript` 是在頁面任何腳本之前執行的程式字串。`page`：`evaluate(expr) → Promise<any>`、`waitFor(expr, timeoutMs = 15000)`、`click(x, y)`、`tap(x, y)`（觸控輕點：先啟用 `Emulation.setTouchEmulationEnabled`，再用 `Input.dispatchTouchEvent`）、`mouseMove(x, y)`、`drag(x1, y1, x2, y2)`、`screenshot(path)`、`consoleErrors: string[]`、`requests: string[]`、`close()`。用 `--headless=new --remote-debugging-port` 啟動 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，每次在 `.chrome-profile/` 底下用一個不重複的子資料夾當設定檔、`close()` 時刪除，以 Node 內建的 `WebSocket` 走 DevTools Protocol，不裝任何套件。
  - `web/src/model.js`：`parseModel(bytes: Uint8Array) → Promise<Object3D>`、`findOrganelle(object) → string | null`（往父層找 `userData.organelle`）、`findInstanceRoot(object) → Object3D | null`（往父層找 `userData.inst !== undefined`）、`indexModel(root) → { byId: Map<string, { meshes, instances, rep, anchor }>, lid: Object3D | null, center: Vector3, radius: number }`（`anchor` 是代表個體底下標 `anchor: 1` 的節點，沒有就等於 `rep`）
  - `web/src/materials.js`：`applyMaterials(index, palette) → void`，依 `organelle/part` 指定 `MeshPhysicalMaterial`。蓋子底下的網格使用自己的材質實例，不與本體共用（Task 10 要單獨把蓋子淡出）。
  - `web/src/scene.js`：`createScene(canvas) → { renderer, scene, camera, controls, start(onFrame), resize() }`
  - `web/src/main.js`：第一格畫完後設 `document.documentElement.dataset.cellReady = '1'`；失敗時設 `dataset.cellError`。公開 `window.__cell = { index, stats() }`，`stats() → { meshes, unresolved, ids, triangles, fps }`（`unresolved` 是 `findOrganelle` 回傳 null 的網格數）。**本任務把蓋子設為隱藏（`index.lid.visible = false`）**，畫面是掀開的狀態；蓋子的動畫留到 Task 10。
  - DOM：`<canvas id="stage">`。
  - `.claude/launch.json`：`{ "version": "0.0.1", "configurations": [{ "name": "cell-dev", "runtimeExecutable": "node", "runtimeArgs": ["scripts/build.mjs", "--watch", "--serve"], "port": 5173 }] }`

**畫面規格：**
- 繪圖：開啟反鋸齒、ACES 色調對應、sRGB 輸出、像素比上限 2；環境光用 three.js 內建的 `RoomEnvironment`（不載入外部檔）；一盞帶柔和陰影的暖色主光、一盞冷色輪廓光、一盞半球補光。
- 背景：畫布透明，頁面底色用 CSS 放射漸層 `#12303a → #071318`。
- 鏡頭：位置為方向 `(0.62, 0.48, 0.62)` 正規化後乘以 17，看向模型中心；`OrbitControls` 開啟阻尼，縮放距離限制在 6 到 30，關閉平移。
- 材質：預設不透明、粗糙度 0.45 到 0.65。`cut` 一律比 `main` 更霧面。半透明的只有三種：`vacuole`（唯一可用 `transmission` 的構造）、`cytoplasm`（不透明度約 0.12、`depthWrite: false`）、`cell_membrane`（不透明度約 0.9）。
- 不使用後製（不加 EffectComposer）。

- [ ] **Step 1:** 寫失敗測試 `tests/model-index.test.mjs`：用 `tests/fixtures/tag_spike.glb` 經 `parseModel` 與 `indexModel`，斷言 `byId.get('mitochondrion').meshes.length === 2`、`byId.get('mitochondrion').rep.userData.rep === 1`、`byId.get('mitochondrion').anchor === byId.get('mitochondrion').rep`、`byId.get('cell_wall').meshes.length === 2`（含蓋子裡那個）、`byId.get('cell_wall').anchor.userData.anchor === 1`、`lid !== null`；另用手建的 `Object3D` 樹斷言 `findOrganelle` 會越過沒有標記的中間層、頂層都沒有時回傳 `null`。跑 `npm test` 確認失敗。
- [ ] **Step 2:** 實作 `web/src/model.js`，`npm test` 通過。
- [ ] **Step 3:** 實作 `scripts/build.mjs`、`web/template.html`、`web/styles.css`、`scene.js`、`materials.js`、`main.js`、`.claude/launch.json`。跑 `npm run build`，產出 `dist/plant-cell.html`。
- [ ] **Step 4:** 實作 `scripts/cdp.mjs`，寫 `tests/e2e/viewer.e2e.mjs`：

```js
test('檢視器載入完整模型', async () => {
  const page = await openPage('dist/plant-cell.html', { offline: true });
  await page.waitFor("document.documentElement.dataset.cellReady === '1'");
  const s = await page.evaluate('window.__cell.stats()');
  assert.equal(s.unresolved, 0);
  assert.equal(s.ids.length, 15);
  assert.deepEqual(page.consoleErrors, []);
  assert.equal(page.requests.filter(u => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')).length, 0);
  await page.screenshot('assets/preview/web-default.png');
  await page.drag(640, 400, 900, 300);
  await page.screenshot('assets/preview/web-rotated.png');
  await page.close();
});
test('成品是單一檔案', () => {
  const html = readFileSync('dist/plant-cell.html', 'utf8');
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link\b/i.test(html));
  assert.ok(statSync('dist/plant-cell.html').size <= 25 * 1024 * 1024);
});
```

- [ ] **Step 5:** 跑 `npm run e2e` 通過。用 Read 看兩張截圖：細胞完整出現在畫面中央、掀開的一角朝向鏡頭且看得到內部、拖曳後角度確實改變、各構造顏色分明、沒有全黑或全白的物件。不符就調整光線與材質。
- [ ] **Step 6:** 提交（路徑：`scripts/build.mjs scripts/cdp.mjs web/template.html web/styles.css web/src/main.js web/src/scene.js web/src/model.js web/src/materials.js tests/model-index.test.mjs tests/e2e .claude/launch.json`），訊息 `feat: 網頁檢視器與單檔打包`。

### 🛑 檢查點一（由主持人執行，不派給實作者）

主持人自己看 `assets/preview/web-default.png` 與 `web-rotated.png`，不滿意就先派修正。滿意後把 `dist/plant-cell.html` 交給使用者試轉，確認形狀與質感的方向。**使用者確認前不開始 Task 9 之後的任務。**

---

## 第二階段：到檢查點二（第一個可玩版本）

### Task 8: 介紹文字（可提早進行）

**Files:**
- Create: `web/src/organelles.js`, `web/src/forbidden-words.js`
- Test: `tests/organelles.test.mjs`

**Interfaces:**
- Produces:
  - `ORGANELLES: { id, zh, en, tagline, body, fact, pickable }[]`（15 項，順序同 Global Constraints；`fact` 可為 `null`；`pickable` 只有 `cytoplasm` 與 `ribosome` 是 `false`）
  - `ORGANELLE_IDS: string[]`、`QUIZ_IDS: string[]`（`pickable` 為 `true` 的 id）、`getOrganelle(id)`
  - `INTRO: { title: '植物細胞', paragraphs: string[], start: '開始探索' }`
  - `web/src/forbidden-words.js`：`FORBIDDEN_WORDS: string[]`（Global Constraints 的禁用詞）。這個檔只給測試匯入，網頁程式不得匯入它，否則成品裡會出現禁用詞。

- [ ] **Step 1:** 寫失敗測試 `tests/organelles.test.mjs`，長度一律以 `[...s].length` 計：
  - `ORGANELLE_IDS` 等於 15 個 id 的固定順序；每項的 `zh` 與 `en` 等於規格 §5 的對照表（把整張表寫進測試當預期值）。
  - 每項 `tagline` 長度 1 到 25、`body` 長度 60 到 120、`fact` 為 `null` 或長度 1 到 60。
  - 所有文字（含 `INTRO`）不含任何禁用詞。
  - `vacuole` 的 `body` 或 `fact` 含「比例」。
  - `INTRO.paragraphs` 合起來含「葉肉細胞」「動物細胞」「細胞壁」「液泡」「葉綠體」「根」，總長度不超過 180。
  - `QUIZ_IDS.length === 13`。
- [ ] **Step 2:** 跑 `node --test tests/organelles.test.mjs` 確認失敗。
- [ ] **Step 3:** 撰寫 `web/src/organelles.js`。程度設定為國高中生看得懂；每項的 `body` 講「它是什麼、在哪裡、做什麼」。開場要說明：這個模型是葉肉細胞；植物細胞和動物細胞最明顯的差別是細胞壁與中央液泡；許多植物細胞還有葉綠體，但不是全部都有（例如根的細胞沒有）。
- [ ] **Step 4:** 跑 `node --test tests/organelles.test.mjs` 通過。
- [ ] **Step 5:** 回報完成（不自行提交）。

主持人另派一位沒參與撰寫的審查者，逐句核對生物學正確性與台灣課本用語（規格 §5 的要求）。

### Task 9: 選取、發亮、鏡頭、介紹面板、構造清單

**Files:**
- Create: `web/src/config.js`, `web/src/state.js`, `web/src/picking.js`, `web/src/highlight.js`, `web/src/camera-moves.js`, `web/src/ui/panel.js`, `web/src/ui/list.js`
- Modify: `web/src/main.js`, `web/template.html`, `web/styles.css`
- Test: `tests/state.test.mjs`, `tests/picking.test.mjs`, `tests/e2e/select.e2e.mjs`

**Interfaces:**
- Consumes: Task 7 的 `indexModel` 結果、Task 8 的 `ORGANELLES` 與 `getOrganelle`
- Produces:
  - `config.js`：`GHOST_IDS = ['cell_wall', 'cell_membrane', 'cytoplasm']`（會變成殘影的外殼）；`SCALE_IDS = [...GHOST_IDS, 'plasmodesmata', 'cytoskeleton']`（拆解時跟著外殼放大的構造，Task 11 使用）。
  - `state.js`：`initialState = { phase: 'explore', selected: null, hovered: null, exploded: false, labels: false, quiz: null }`（本任務先以 `'explore'` 起始，Task 10 改為 `'intro'`）。`selected` 與 `hovered` 的形狀是 `{ id, inst }`，`inst` 為 `null` 表示從清單選的。`reduce(state, action) → state`，動作：`hover {id, inst}`、`unhover`、`select {id, inst = null}`、`deselect`。`createStore(initial = initialState) → { getState(), dispatch(action), subscribe(fn) → unsubscribe }`。
  - `picking.js`：`isClick(down: {x, y}, up: {x, y}) → boolean`（位移不超過 5 像素才算點選）；`createPicker({ dom, camera, index, isPickable, onHover, onPick })`，`onHover` 與 `onPick` 收到 `{ id, inst } | null`。射線會穿過兩種網格：自己或任一層祖先 `visible === false` 的，以及 `isPickable(id)` 回傳 `false` 的。用 pointer 事件，觸控的輕點等同點選。
  - `main.js` 提供的 `isPickable(id)`：`getOrganelle(id).pickable` 為 `false` 時回 `false`；外殼目前是殘影且 `id` 在 `GHOST_IDS` 內時回 `false`；其餘回 `true`。
  - `highlight.js`：`createHighlighter(index) → { apply(state), update(dt), shellsGhosted: boolean }`
  - `camera-moves.js`：`createCameraMoves({ camera, controls }) → { focus(object3d), home(), update(dt), busy: boolean }`。新的 `focus` 會取消進行中的移動。從清單選時 `focus(byId.get(id).anchor)`，在模型上點某個個體時 `focus(該個體根)`。
  - `ui/panel.js`：`mountPanel(root) → { show(organelle), hide() }`；`ui/list.js`：`mountList(root, { organelles, palette, onSelect }) → { setActive(id | null), setNamesHidden(hidden) }`
  - `window.__cell` 增加：`store`；`cameraBusy() → boolean`；`screenPointOf(id) → { x, y } | null`（畫面上一個射線確實會打到該 id 的點：從該 id 各個體的中心與頂點取樣，以 picker 相同的規則驗證後回傳第一個命中的；都被擋住就回 `null`）；`repScreenPoint(id) → { x, y }`（代表個體根的世界座標投影到畫面，不管有沒有被擋住）。
  - DOM：`#panel`、`#panel-title`、`#panel-en`、`#panel-tagline`、`#panel-body`、`#panel-fact`、`#list`（每個按鈕 `data-id`）、`#list-title`（文字「細胞構造」）、`#hover-name`。

**行為規格（規格 §3）：**
- 滑過：該個體微亮、游標變手指、`#hover-name` 顯示中文名。
- 在模型上點某個個體：那一個最亮，同 id 的其他個體微亮，其餘全部變暗，且 `GHOST_IDS` 變成不透明度約 0.15 的殘影（被選的 id 本身在 `GHOST_IDS` 內時不變殘影）。鏡頭平順地靠近該個體。
- 從清單點：同 id 全部發亮，鏡頭靠近代表個體的錨點。
- 點空白處：取消選取，鏡頭回到預設位置。
- 發亮用材質的自發光漸變，變暗用降低彩度與亮度，不用後製。
- 介面外觀：面板與清單是半透明深色底加背景模糊；內文字級不小於 16 像素；桌機上面板寬 340 像素、靠右；清單在底部，每個按鈕左側有該構造的色點（顏色取 palette 的 `main`）。

- [ ] **Step 1:** 寫失敗測試 `tests/state.test.mjs`：`select` 後 `selected` 等於給定值；連續兩次 `select` 以後者為準；`deselect` 清空；`hover`／`unhover` 不影響 `selected`；`reduce` 不改動傳入的物件；`subscribe` 的函式在 `dispatch` 後被呼叫一次、`unsubscribe` 後不再被呼叫。
- [ ] **Step 2:** 寫失敗測試 `tests/picking.test.mjs`：`isClick({x:10,y:10},{x:13,y:14}) === true`（位移 5）；`isClick({x:10,y:10},{x:16,y:10}) === false`（位移 6）。
- [ ] **Step 3:** 跑 `npm test` 確認兩支失敗，實作 `state.js` 與 `isClick`，再跑到通過。
- [ ] **Step 4:** 實作其餘模組並接進 `main.js`。
- [ ] **Step 5:** 寫 `tests/e2e/select.e2e.mjs`：
  - `mouseMove` 到 `screenPointOf('nucleus')`：`#hover-name` 文字為「細胞核」，`#stage` 的 `cursor` 樣式為 `pointer`。
  - 在同一點 `click`：`#panel-title` 為「細胞核」、`store.getState().selected.id === 'nucleus'`；截圖 `assets/preview/web-selected.png`。
  - `click` 在 `screenPointOf('mitochondrion')`：`selected.inst` 不是 `null`；截圖 `assets/preview/web-selected-multi.png`。
  - 點 `#list [data-id="ribosome"]`，面板顯示「核糖體」。
  - 立刻連點清單上的 `chloroplast` 再 `mitochondrion`：面板顯示「粒線體」，且 3 秒內 `cameraBusy()` 變成 `false`。（Review Focus 2）
  - 從 `(640,400)` 拖曳到 `(800,400)` 後，`selected` 不變。（Review Focus 1）
  - 點畫面角落的空白處：`selected === null` 且 `#panel` 隱藏。
  - 用 `tap` 點 `screenPointOf('nucleus')`：`selected.id === 'nucleus'`。
  - 逐一點清單上的 15 個按鈕：`#panel-title` 等於該項的 `zh`、`#panel-body` 等於該項的 `body`。
  - `#list-title` 文字為「細胞構造」。
  - 一致性：`__cell.stats().ids` 排序後等於 `ORGANELLE_IDS` 排序後的結果（規格 §7 的一致性檢查）。
- [ ] **Step 6:** 跑 `npm test && npm run e2e` 通過。用 Read 看兩張截圖：`web-selected.png` 細胞核明顯發亮、其他變暗、面板文字清楚不擁擠；`web-selected-multi.png` 被點的那個粒線體最亮、其他粒線體微亮。
- [ ] **Step 7:** 提交（路徑：`web tests`），訊息 `feat: 點選、發亮、介紹面板與構造清單`。

### 🛑 檢查點二（由主持人執行）

把 `dist/plant-cell.html` 交給使用者實際玩，確認手感與介紹的呈現。**使用者確認前不開始第三階段。**

---

## 第三階段：到完成

### Task 10: 開場、開蓋、自轉、WebGL 不可用時的說明

**Files:**
- Create: `web/src/ui/intro.js`, `web/src/lid.js`
- Modify: `web/src/state.js`, `web/src/main.js`, `web/src/scene.js`, `web/template.html`, `web/styles.css`, `tests/state.test.mjs`, `tests/e2e/viewer.e2e.mjs`, `tests/e2e/select.e2e.mjs`
- Test: `tests/e2e/intro.e2e.mjs`

**Interfaces:**
- Consumes: Task 8 的 `INTRO`、Task 7 的 `index.lid`
- Produces:
  - `state.js`：`initialState.phase` 改為 `'intro'`；新增動作 `start`（`phase` 變 `'explore'`）。`phase === 'intro'` 時除了 `start` 以外的動作一律不改變狀態。**`tests/state.test.mjs` 既有的每個測試都要改成先 `dispatch({ type: 'start' })`。**
  - `ui/intro.js`：`mountIntro(root, { intro, onStart }) → { hide() }`
  - `lid.js`：`createLid(index) → { open(), update(dt), isOpen: boolean }`。開場時蓋子顯示且蓋著（取代 Task 7 的直接隱藏）；`open()` 讓蓋子沿 three.js 的 `(3, 2.5, 3)` 移開並淡出，結束後設 `visible = false`。
  - `scene.js`：`setAutoRotate(on)`；閒置 4 秒後緩慢自轉，使用者一操作就停。
  - `main.js`：建立 WebGL 失敗時顯示 `#fallback`，文字為「這個瀏覽器無法顯示 3D 內容，請改用新版的 Chrome 開啟。」
  - `window.__cell` 增加：`lidOpen() → boolean`、`autoRotating() → boolean`。
  - DOM：`#intro`、`#intro-start`、`#fallback`。
  - `tests/e2e/viewer.e2e.mjs` 與 `tests/e2e/select.e2e.mjs` 在等到 `cellReady` 之後都補上：點 `#intro-start`，再等 `lidOpen() === true`。之後新增的端對端測試也一樣。

- [ ] **Step 1:** 在 `tests/state.test.mjs` 增加失敗測試：起始 `phase === 'intro'`；`intro` 階段 `select` 無效；`start` 之後 `select` 有效。並把既有測試改成先 `start`。跑 `npm test` 確認新測試失敗，實作後全數通過。
- [ ] **Step 2:** 實作 `intro.js`、`lid.js`、自轉與 `#fallback`。
- [ ] **Step 3:** 寫 `tests/e2e/intro.e2e.mjs`：
  - 載入後 `#intro` 可見，內文含「葉肉細胞」；`lidOpen() === false`；截圖 `assets/preview/web-intro.png`。
  - 點 `#intro-start` 後 `#intro` 隱藏，3 秒內 `lidOpen() === true`；截圖 `assets/preview/web-opened.png`。
  - 不操作等 5 秒：`autoRotating() === true`；拖曳一下之後 `autoRotating() === false`。
  - 以 `initScript: "HTMLCanvasElement.prototype.getContext = () => null"` 開啟：`#fallback` 可見且含「無法顯示 3D」，`dataset.cellError` 有值。（Review Focus 5）
- [ ] **Step 4:** 跑 `npm test && npm run e2e` 通過，提交（路徑：`web tests`），訊息 `feat: 開場介紹、開蓋動畫、自轉與 3D 不可用說明`。

### Task 11: 拆解與名稱標籤

**Files:**
- Create: `web/src/explode.js`, `web/src/labels.js`, `web/src/ui/toolbar.js`
- Modify: `web/src/state.js`, `web/src/highlight.js`, `web/src/main.js`, `web/template.html`, `web/styles.css`, `tests/state.test.mjs`
- Test: `tests/explode.test.mjs`, `tests/e2e/play.e2e.mjs`

**Interfaces:**
- Consumes: Task 9 的 `SCALE_IDS`、`GHOST_IDS`、`repScreenPoint`
- Produces:
  - `state.js`：動作 `toggleExplode`、`toggleLabels`。
  - `explode.js`：`SPREAD = 0.9`；`EXTRA = { nucleolus: [1.2, 1.0, 1.2] }`；`explodeTarget(position: [x,y,z], center: [x,y,z], id) → [x,y,z]`，等於 `position + (position − center) × SPREAD + (EXTRA[id] ?? [0,0,0])`。`createExploder(index) → { set(on), update(dt), progress: number }`：`SCALE_IDS` 內的構造改為以模型中心放大到 `1 + SPREAD` 倍；其餘個體根依 `explodeTarget` 移動（個體本身大小不變）。
  - `highlight.js`：`apply(state)` 在 `state.exploded` 為真時也把 `GHOST_IDS` 變成殘影，並讓 `shellsGhosted` 為 `true`（所以拆解中外殼不可點）。
  - `labels.js`：`createLabels({ container, index, camera, nameOf }) → { setVisible(on), update() }`，每個 id 一個標籤，掛在 `byId.get(id).anchor` 上，位置每格更新，在鏡頭背面的不顯示。
  - `ui/toolbar.js`：`mountToolbar(root, { onExplode, onLabels }) → { setState({ exploded, labels, phase }) }`
  - `window.__cell` 增加：`explodeProgress() → number`（0 到 1）。
  - DOM：`#btn-explode`、`#btn-labels`、`#labels`（每個標籤 `data-id`）。

- [ ] **Step 1:** 寫失敗測試 `tests/explode.test.mjs`，數值比較用容差 `1e-9`：`explodeTarget([2,0,0],[0,0,0],'golgi')` 約等於 `[3.8,0,0]`；`explodeTarget([0,0,0],[0,0,0],'vacuole')` 約等於 `[0,0,0]`；`explodeTarget([1,1,1],[1,1,1],'nucleolus')` 約等於 `[2.2,2.0,2.2]`。在 `tests/state.test.mjs` 增加 `toggleExplode`、`toggleLabels` 各切換一次的測試（先 `start`）。跑 `npm test` 確認失敗，實作後通過。
- [ ] **Step 2:** 實作 `createExploder`、`labels.js`、`toolbar.js` 並接進 `main.js`。
- [ ] **Step 3:** 寫 `tests/e2e/play.e2e.mjs`（開頭先點 `#intro-start` 並等 `lidOpen()`）：
  - 記下 `nucleus, golgi, chloroplast, mitochondrion, peroxisome, vacuole` 六者的 `repScreenPoint`。點 `#btn-explode`，3 秒內 `explodeProgress() === 1`；六者任兩個在畫面上的距離都比拆解前大；`screenPointOf('cell_wall') === null`（外殼是殘影、不可點）；截圖 `assets/preview/web-exploded.png`。再點一次，`explodeProgress()` 回到 0。
  - 點 `#btn-labels`，`#labels [data-id]` 共 15 個，其中可見的至少 8 個；截圖 `assets/preview/web-labels.png`。再點一次全部隱藏。
- [ ] **Step 4:** 跑 `npm test && npm run e2e` 通過。用 Read 看兩張截圖：拆解後各構造彼此分開、標籤不互相重疊到無法閱讀。
- [ ] **Step 5:** 提交（路徑：`web tests`），訊息 `feat: 拆解與名稱標籤`。

### Task 12: 測驗

**Files:**
- Create: `web/src/quiz.js`, `web/src/ui/quiz-ui.js`
- Modify: `web/src/state.js`, `web/src/main.js`, `web/src/ui/toolbar.js`, `web/template.html`, `web/styles.css`, `tests/state.test.mjs`, `tests/e2e/play.e2e.mjs`
- Test: `tests/quiz.test.mjs`

**Interfaces:**
- Consumes: Task 8 的 `QUIZ_IDS`
- Produces:
  - `quiz.js`：`createQuiz({ ids, count = 10, rng = Math.random }) → { total, index, currentId, finished, score, answer(id) → { correct, expectedId } }`。`answer` 記分後前進到下一題；每題只算第一次作答。
  - `state.js`：動作 `quizStart`（`phase` 變 `'quiz'`；`selected`、`hovered` 清空；`labels`、`exploded` 設為 `false`；原值存進 `state.quiz.saved`）、`quizExit`（`phase` 回 `'explore'`，還原 `labels` 與 `exploded`，`quiz` 設為 `null`）。`phase === 'quiz'` 時 `select`、`toggleExplode`、`toggleLabels` 不改變狀態。
  - `ui/quiz-ui.js`：`mountQuizUI(root, { onExit, onRetry }) → { showQuestion({ index, total, zh }), showResult({ correct, expectedZh }), showSummary({ score, total }), hide() }`
  - `ui/toolbar.js`：`mountToolbar` 的選項增加 `onQuiz`，工具列增加 `#btn-quiz`。
  - `window.__cell` 增加：`quizCurrentId() → string | null`。
  - 測驗中：清單呼叫 `setNamesHidden(true)`、`#hover-name` 不顯示、介紹面板隱藏；在模型上點到的個體 id 等於 `currentId` 就算對（同 id 的任何一個都算）。
  - DOM：`#btn-quiz`、`#quiz`、`#quiz-question`、`#quiz-progress`、`#quiz-result`、`#quiz-summary`、`#quiz-exit`、`#quiz-retry`。

- [ ] **Step 1:** 寫失敗測試 `tests/quiz.test.mjs`：`ids` 13 個、`count` 10 時 `total === 10` 且題目不重複；`ids` 3 個時 `total === 3`；傳入固定的 `rng` 兩次得到相同題序；答對 `score` 加 1、答錯不加，`answer` 回傳的 `expectedId` 等於作答前的 `currentId`；答完最後一題 `finished === true`。
- [ ] **Step 2:** 在 `tests/state.test.mjs` 增加失敗測試（Review Focus 3），每個都先 `start`：先 `toggleLabels`、`toggleExplode` 再 `quizStart`，斷言 `labels === false`、`exploded === false`、`selected === null`；測驗中 `select`、`toggleLabels`、`toggleExplode` 都不改變狀態；`quizExit` 後 `labels === true`、`exploded === true`、`phase === 'explore'`。
- [ ] **Step 3:** 跑 `npm test` 確認失敗，實作 `quiz.js` 與狀態，跑到通過。
- [ ] **Step 4:** 實作 `quiz-ui.js` 並接進 `main.js`。
- [ ] **Step 5:** 在 `tests/e2e/play.e2e.mjs` 增加：點 `#btn-quiz` 後 `#quiz-question` 含「請點出」；`#list` 按鈕上看不到任何構造名稱；截圖 `assets/preview/web-quiz.png`。每一題用 `__cell.quizCurrentId()` 取得答案：`screenPointOf(答案)` 有值就點它並斷言 `#quiz-result` 顯示答對；為 `null` 就點另一個看得到的構造並斷言顯示答錯與正確名稱。答完後 `#quiz-summary` 的分數等於答對的題數；點 `#quiz-retry` 回到第 1 題；點 `#quiz-exit` 後清單名稱恢復。
- [ ] **Step 6:** 跑 `npm test && npm run e2e` 通過，提交（路徑：`web tests`），訊息 `feat: 測驗模式`。

### Task 13: 版面、效能、離線與收尾

**Files:**
- Create: `README.md`, `tests/e2e/layout.e2e.mjs`
- Modify: `web/styles.css`, `web/src/scene.js`, `web/src/main.js`

- [ ] **Step 1:** 寫 `tests/e2e/layout.e2e.mjs`（Review Focus 4）：
  - 以 390×800 開啟並點過開場後，`#stage` 的高度至少是視窗高度的 45%、畫布的繪圖寬高比與顯示寬高比相差小於 1%、選取細胞核後 `#panel` 與 `#stage` 都在視窗內且 `#panel` 位於 `#stage` 下方；截圖 `assets/preview/web-narrow.png`。
  - 以 1280×800 開啟，選取細胞核後 `#panel` 在 `#stage` 內容區的右側。
  - 讀 `dist/plant-cell.html` 全文，斷言不含 `web/src/forbidden-words.js` 的 `FORBIDDEN_WORDS` 任何一個詞。
- [ ] **Step 2:** 跑 `npm run e2e` 確認失敗，調整 `styles.css`（寬度小於 720 像素時面板移到下方）與 `resize()`，跑到通過。
- [ ] **Step 3:** 量測效能：用 `openPage` 以 1280×800 開啟成品，點過開場後等 5 秒，印出 `__cell.stats().fps`。不低於 50 算通過。若無介面 Chrome 的數字不到 50，把數字寫進回報並說明，由主持人在一般的 Chrome 視窗再量一次。
- [ ] **Step 4:** 離線檢查：把 `dist/plant-cell.html` 複製到一個新的暫存資料夾，用 `openPage(該路徑, { offline: true })` 開啟，斷言 `cellReady === '1'`、`consoleErrors` 為空。
- [ ] **Step 5:** 寫 `README.md`（30 行以內）：成品在哪、怎麼重建（`npm install`、`npm run model`、`npm run build`）、怎麼跑測試。
- [ ] **Step 6:** 跑 `npm test && npm run e2e` 全數通過，提交（路徑：`README.md web tests`），訊息 `feat: 窄螢幕版面、效能與離線檢查`。

### 🛑 最終驗收與檢查點三（由主持人執行）

1. 派一位沒參與製作的驗收者：自己跑 `npm test` 與 `npm run e2e` 並貼輸出；自己打開成品，逐項對照規格 §9 的驗收條件回報。
2. 主持人在 Safari 實測一次，如實回報能不能顯示與操作。不能就記錄現象，不列為阻擋。
3. 通過後把 `dist/plant-cell.html` 交給使用者。
