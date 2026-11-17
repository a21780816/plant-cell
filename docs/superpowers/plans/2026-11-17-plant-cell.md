# 互動式植物細胞模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 `dist/plant-cell.html`：在 Chrome 點兩下就能離線打開，可以旋轉、點選、拆解、測驗的精美 3D 植物細胞。

**Architecture:** Blender 用 Python 腳本程序化生成模型並匯出 `.glb`，每個物件用自訂屬性標明它屬於哪個構造。網頁用 three.js 載入模型，材質與互動都在網頁端定義。純邏輯（狀態、測驗、拆解位置）與繪圖分開：前者用 Node 內建測試，後者用無介面 Chrome 做端對端檢查。esbuild 把程式、樣式、模型全部內嵌成單一 HTML。

**Tech Stack:** Blender 5.2.2 LTS（內建 Python 3.13.13）、three 0.187.0、esbuild 0.28.2、Node.js 22（`node --test`、內建 `WebSocket` 與 `fetch`）、Google Chrome 158 headless（已實測無介面模式可用 WebGL2）。

**Spec:** `docs/superpowers/specs/2026-11-17-plant-cell-design.md`

**修訂紀錄：** 2026-11-17 經獨立審查後修訂（版面座標重排並驗算、蓋子處理、拆解斷言、並行規則等 21 項）。同日依規格 §11 改版：六角柱外形、20 項構造、柔和配色、大學程度的介紹；新增 Task 14 到 18，Task 7、9、11 的相關數值同步更新。Task 1 到 6 與 Task 8 是照改版前的內容完成的，它們的段落保留作為紀錄。

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
- 20 個 id，順序固定：`cell_wall, middle_lamella, cell_membrane, cytoplasm, nucleus, nucleolus, chromatin, rough_er, smooth_er, ribosome, golgi, mitochondrion, chloroplast, vacuole, transvacuolar_strand, peroxisome, oil_body, plasmodesmata, microtubule, actin_filament`。（改版前是 15 個：沒有 `middle_lamella`、`chromatin`、`transvacuolar_strand`、`oil_body`，且 `microtubule` 與 `actin_filament` 合為 `cytoskeleton`。）
- 不能在模型上直接點選、只能從清單選的 7 個 id：`middle_lamella, cytoplasm, chromatin, ribosome, transvacuolar_strand, microtubule, actin_filament`。其餘 13 個可點選，也是測驗的題庫。
- 預算：三角面總數硬上限 500,000（目標 300,000 以內）；`assets/plant_cell.glb` ≤ 15 MB；`dist/plant-cell.html` ≤ 25 MB；這台電腦上 ≥ 50 fps。
- 介面文字用繁體中文、台灣的學術用語（以國家教育研究院的學術名詞為準）。20 項的清單標題叫「細胞構造」，不叫「胞器」。禁用詞：線粒體、高爾基體、胞間連絲、溶酶體、溶體、中心粒、中心體、細胞器。
- 生物學：不畫中心粒、不畫溶體。液泡刻意縮小，介紹裡要寫明。
- 字體只用系統字體：`-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif`。
- git 只在本機，絕不 push。提交用 `git add <明確路徑>` 接 `git commit -m "…" -- <同樣的路徑>`；禁止 `git add -A`、reset、rebase、amend。
- 不提交產生物：`node_modules/`、`dist/`、`assets/*.glb`、`assets/parts/`、`assets/preview/`、`.chrome-profile/`。

## 座標與版面（Blender 座標，Z 朝上）

以下數值已用腳本驗算：全部在空腔內、兩兩不重疊、從預設鏡頭看得到。寫在 `blender/cellkit/common.py`，是所有模組的唯一來源。

| 常數 | 值 |
|---|---|
| 外形（改版後） | 六角柱。本細胞的細胞壁外表面：頂點 `(±6.6, 0)`、`(±4.6, ±3.5)`，高度 `±3.2`。`HEX_TIP_X = 6.6`、`HEX_SHOULDER_X = 4.6`、`HEX_HALF_Y = 3.5`、`HEX_HALF_Z = 3.2`；稜線倒角 `EDGE_BEVEL = 0.06`。（改版前是 `CELL_HALF = (5.0, 3.5, 3.2)`、外圓角 1.0 的圓角盒。） |
| `WALL_T` / `GAP` / `MEMBRANE_T` | `0.28` / `0.04` / `0.06` |
| `LAMELLA_T` / `NEIGHBOR_WALL_T` / `FLANGE_LEN` | `0.06` / `0.28` / `1.5`（中膠層厚、相鄰細胞的壁厚、六條直立稜上相鄰細胞壁伸出的長度） |
| 空腔（細胞膜內側，改版後） | 六角柱各面內縮 0.38：`\|z\| ≤ 2.82`、`\|y\| ≤ 3.12`、`(3.5·\|x\| + 2.0·\|y\|)/4.0311 ≤ 5.3504`。已驗算它完整包含改版前的圓角盒空腔（半寬 `(4.62, 3.12, 2.82)`、內圓角 `0.62`），所以下面的固定位置全部沿用。 |
| 掀開區 `in_cut(p)` | `p.x >= -2.2 and p.y <= 0.8 and p.z >= -1.4` |
| `VACUOLE` | 中心 `(-1.6, 0.9, -0.2)`，半軸 `(2.7, 1.95, 2.1)`，表面起伏振幅上限 `0.10` |
| `NUCLEUS` | 中心 `(2.7, -0.6, 0.6)`，半徑 `1.15` |
| `NUCLEUS_ZONE` | 以細胞核中心為球心、半徑 `1.80` 的禁入球（含粗糙內質網） |
| `RER` | 軸 `(-0.75, 0.55, 0.35)`；只在「方向與軸的內積 > 0.1」的那半邊；4 層薄片，半徑 `1.30, 1.42, 1.54, 1.66` |
| `SER` | 繞細胞核的扇形區：軸 `(0.35, -0.45, -0.8)`，方向與軸的內積 > 0.55，距核心 `1.35` 到 `1.95`。禁入區取內積 > 0.5、半徑 `2.05` |
| `GOLGI` | `[(-0.3, -2.2, 0.2), (-3.3, -2.1, -1.5)]`，第一個是代表個體；禁入球半徑 `0.75` |
| 代表個體位置 | 葉綠體 `(-1.2, -2.4, 1.7)`、粒線體 `(0.9, -2.5, -0.7)`、過氧化體 `(0.5, -2.6, 1.6)` |
| `OIL_BODY_REP` | 油體代表個體的位置 `(3.9, -2.0, -0.9)`；禁入球半徑 `OIL_BODY_KEEPOUT = 0.22` |
| `STRANDS` | 三條跨液泡細胞質絲，各以「通過點相對液泡中心的偏移 `off`、方向 `dir`」定義：`{off: (0.3, -0.2, 0.9), dir: (0.85, -0.50, 0.15)}`、`{off: (-1.3, 0.3, 0.1), dir: (0.20, -0.45, 0.87)}`、`{off: (0.5, 0.3, -0.6), dir: (0.55, -0.80, -0.05)}`。端點取在液泡橢球值等於 `STRAND_END_LEVEL = 1.10` 處。驗算得到的端點（近端／遠端）：`(0.36, -0.27, 0.99)`／`(-3.88, 2.21, 0.25)`、`(-2.45, 0.18, 1.87)`／`(-3.26, 2.02, -1.69)`、`(0.19, -0.68, -0.92)`／`(-2.29, 2.94, -0.69)`。三條的中心線兩兩最近距離是 0.54、1.56、1.41（已驗算）；第 0、2 條的近端在掀開區內、從預設鏡頭看得到 |
| `CAMERA_DIR` | `(0.62, -0.62, 0.48)`（預設鏡頭所在方向；剖面一律朝這個方向） |
| `SHOWCASE` | 從預設鏡頭必須看得到、不可被隨機擺放的胞器擋住的構造，各以（球心、半徑）表示：細胞核 `(NUCLEUS 中心, 1.15)`、葉綠體代表 `(…, 0.62)`、粒線體代表 `(…, 0.48)`、過氧化體代表 `(…, 0.25)`、第一個高基氏體 `(GOLGI[0], 0.70)`、油體代表 `(OIL_BODY_REP, 0.22)`。每個構造朝 `CAMERA_DIR` 方向延伸出去的圓柱稱為它的視線走廊。已模擬：加上「隨機擺放的胞器不得進入視線走廊」之後，300 組種子全部仍放得下 |
| `SEED` | `20261117` |

- 匯出後 Blender 的 `(x, y, z)` 變成 three.js 的 `(x, z, -y)`。預設鏡頭在 three.js 的 `(0.62, 0.48, 0.62)` 方向，正對掀開的那一角。
- 固定位置的構造（液泡、細胞核、粗糙內質網、平滑內質網、高基氏體）**不呼叫 `reserve`**，它們已內建在 `is_free` 的禁入區。`reserve` 只給葉綠體、粒線體、過氧化體與游離核糖體群使用。核仁在細胞核內，也不呼叫 `reserve`。

## 配色（`shared/palette.json`，Blender 與網頁共用）

```json
{
  "cell_wall":            { "main": "#CFC2A3", "cut": "#E3D9BF", "neighbor": "#BDB196" },
  "middle_lamella":       { "main": "#8E7F63", "cut": "#A39474" },
  "cell_membrane":        { "main": "#E2A77A", "cut": "#EFC4A2" },
  "cytoplasm":            { "main": "#EDE6D3" },
  "nucleus":              { "main": "#A396B8", "cut": "#CBC2D8", "pore": "#7E7096", "chromatin": "#6F6289" },
  "nucleolus":            { "main": "#B56B95" },
  "chromatin":            { "main": "#6F6289" },
  "rough_er":             { "main": "#5E9FA0" },
  "smooth_er":            { "main": "#7DB6A8" },
  "ribosome":             { "main": "#2F5560" },
  "golgi":                { "main": "#7A6A62", "vesicle": "#D9A0A0" },
  "mitochondrion":        { "main": "#D98B45", "cut": "#F0C08E", "cristae": "#B5652B" },
  "chloroplast":          { "main": "#8FA95B", "cut": "#C5D69A", "grana": "#55783A" },
  "vacuole":              { "main": "#DAD8E6" },
  "transvacuolar_strand": { "main": "#B9C7B0" },
  "peroxisome":           { "main": "#9DB3C7", "cut": "#C9D6E2", "core": "#6E869C" },
  "oil_body":             { "main": "#A65A3C" },
  "plasmodesmata":        { "main": "#7F9A84" },
  "microtubule":          { "main": "#5D7F6B" },
  "actin_filament":       { "main": "#8B8FA0" },
  "cytoskeleton":         { "main": "#5D7F6B", "filament": "#8B8FA0" }
}
```

改版後的配色（教科書插畫的柔和色調）。兩個過渡用的鍵 `nucleus.chromatin` 與 `cytoskeleton` 都由 Task 17 移除；在那之前留著是為了讓尚未改版的模組還能建置。Task 15、16 不得修改 `shared/palette.json`。

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
- 改版任務：Task 14 先做；Task 15 與 16 彼此獨立，可在 Task 14 完成後同時進行（不自行提交）；Task 17 在兩者都提交後做。Task 18（介紹重寫）與 Task 7（網頁檢視器）都不依賴模型的版面，可與改版任務同時進行；Task 18 不自行提交。
- 多個任務同時進行時，每位實作者只跑自己任務寫明的指令與測試檔；`git commit` 若遇到 `index.lock` 就等幾秒重試。
- 檢查點一在 Task 17 與 Task 7 都完成後進行：主持人重建成品、重跑端對端檢查並看過截圖，再交給使用者。
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

## 改版任務（2026-11-17，依規格 §11）

Task 1 到 6 是照改版前的規格完成的。以下任務把模型改成規格 §11 的樣子；介紹文字的重寫在 Task 18。

### Task 14: 外殼改版（六角柱、三層壁、相鄰細胞壁）

**Files:**
- Modify: `blender/cellkit/common.py`, `blender/cellkit/shell.py`, `shared/palette.json`

**Interfaces:**
- Consumes: 既有的 `common.py` 介面與 `build_cell.py`
- Produces（`common.py` 的變更）。**其他三個模組用到的既有名稱不得消失：改之前先 grep `core.py`、`energy.py`、`endomembrane.py` 用了 `common` 的哪些名稱，全部保留可用。**
  - 新常數照「座標與版面」表：`HEX_TIP_X`、`HEX_SHOULDER_X`、`HEX_HALF_Y`、`HEX_HALF_Z`、`EDGE_BEVEL`、`LAMELLA_T`、`NEIGHBOR_WALL_T`、`FLANGE_LEN`、`OIL_BODY_REP`、`OIL_BODY_KEEPOUT`、`STRANDS`、`STRAND_END_LEVEL`。`CELL_HALF` 改為 `(6.6, 3.5, 3.2)`；`CAVITY_HALF` 改為空腔的外接半寬（由公式算出，約 `(6.162, 3.12, 2.82)`）。
  - `cavity_sdf(p)`：必須同時接受單點（回傳 `float`）與形狀 `(N, 3)` 的 numpy 陣列（回傳長度 N 的陣列），因為 Task 16 要用它對大量頂點做判斷。內容改為六角柱空腔，`max(|z| − 2.82, |y| − 3.12, (3.5·|x| + 2.0·|y|)/√(3.5² + 2.0²) − h)`，`h` 由「斜面通過 `(4.6, 3.5)` 再內縮 0.38」算出（約 5.3504）。數值都由常數推導，不要寫死。`inside_cavity`、`in_cut` 的介面不變。
  - `hex_vertices() → [(x, y)] × 6`：本細胞的細胞壁外表面六個頂點，逆時針，從 `(6.6, 0)` 開始。
  - `flange_dirs() → [(dx, dy)] × 6`：每條直立稜上相鄰細胞壁朝外伸出的單位方向（該頂點兩條鄰邊的外角平分線），順序同 `hex_vertices()`。
  - `strand_ends(i) → (near, far)`：第 `i` 條細胞質絲的兩個端點。直線通過「`VACUOLE` 中心加 `STRANDS[i]['off']`」、方向為 `STRANDS[i]['dir']`（正規化），往正反兩個方向各走到液泡橢球值（`|(p − 中心) / 半軸|`）等於 `STRAND_END_LEVEL` 的點；正方向那個是 `near`。算出的值要與「座標與版面」表列的端點相符（誤差 0.01 內）。
  - 圓角盒時代的 `rbox_sdf`、`CORNER_R`、`CAVITY_R` 三個名稱原樣保留（`endomembrane.py` 目前還在用，Task 16 才會把那些地方改成 `cavity_sdf`）；`common.py` 自己不再用它們判斷空腔。
  - `Ctx.sample_free` 的取樣範圍改用新的 `CAVITY_HALF`。`Ctx.is_free` 增加兩種禁入區：球心 `OIL_BODY_REP`、半徑 `OIL_BODY_KEEPOUT` 的球（加 `radius`）；以及三條細胞質絲的線段（`strand_ends(i)` 的 `near` 到 `far`），與任一條線段的距離小於 `0.16 + radius` 就不可用。
  - `SHOWCASE`（見「座標與版面」表）與 `Ctx.is_free(center, radius, respect_view=True)`：`respect_view` 為真時（預設），若 `center` 落在任一 `SHOWCASE` 構造的視線走廊內就回 `False`。判斷方式：令 `v = center − 球心`、`t = v·d`（`d` 是正規化的 `CAMERA_DIR`），當 `t > 0` 且 `v` 垂直於 `d` 的分量長度小於「該構造的半徑 + radius」時視為在走廊內。`sample_free` 一律以 `respect_view=True` 取樣。
  - `validate_layout` 的「在空腔內」檢查一律改用 `cavity_sdf`。另檢查：`SHOWCASE` 的每個構造都不在別的 `SHOWCASE` 構造的視線走廊內。另增加：三條細胞質絲的線段與其他固定構造（`NUCLEUS_ZONE`、兩個高基氏體、三個代表個體、`OIL_BODY_REP`）的間隙扣掉管半徑 0.16 後不小於 0.1，三條線段兩兩最近距離不小於 0.4；`OIL_BODY_REP` 滿足 `inside_cavity(p, OIL_BODY_KEEPOUT)` 且與其他固定構造的間隙不小於 0.1；三條細胞質絲的六個端點都滿足 `inside_cavity(p, 0.15)`、距細胞核中心都大於 `NUCLEUS_ZONE` 加 0.1。
- Produces（`shared/palette.json`）：改成本計畫「配色」一節的內容（含兩個過渡用的鍵）。

**外殼規格（`shell.py`，取代 Task 2 的表）。** 每一層都是六角柱形，稜線帶 `EDGE_BEVEL` 的小倒角，每一面是平的（不再是圓角盒）：

| id | 形狀 | parts | 錨點 |
|---|---|---|---|
| `cell_membrane` | 厚 `MEMBRANE_T` 的薄殼，內表面就是空腔的邊界 | `main`, `cut` | `(-2.2, -1.2, 2.85)` |
| `cell_wall`（本細胞） | 厚 `WALL_T`，與細胞膜之間留 `GAP`；外表面就是 `hex_vertices()` 定義的六角柱 | `main`, `cut` | `(-2.2, -2.0, 3.06)` |
| `middle_lamella` | 緊貼本細胞的壁外側、厚 `LAMELLA_T` 的一層（上下與六個側面都有）；並沿六條直立稜各伸出一片，夾在兩片相鄰細胞壁中間，伸出長度 `FLANGE_LEN`、與本體等高 | `main`, `cut` | `(-2.2, -2.0, 3.23)` |
| `cell_wall`（相鄰細胞） | 中膠層外側、厚 `NEIGHBOR_WALL_T` 的一層（上下與六個側面都有）；六條直立稜上各有兩片夾住伸出的中膠層，伸出長度 `FLANGE_LEN`。伸出的末端是平的切口，看得到「壁｜中膠層｜壁」三層 | `neighbor`, `cut` | 無 |
| `cytoplasm` | 細胞膜內側空間的實心體 | `main` | `(-2.2, -2.0, 1.6)` |
| `plasmodesmata` | 16 條貫穿「本細胞的壁、中膠層、相鄰細胞的壁」三層的短管（半徑 0.07），兩端有小環；至少 3 條落在切面上被剖開。合併成一個網格 | `main` | 其中一條被剖開的管子上 |

- 相鄰細胞的壁標 `organelle: cell_wall`、`part: neighbor`，掛在 `cell_wall` 的同一個個體根底下。
- 原生質絲被掀開區切到的那幾條：留在本體這一側的半截連同切口都屬於 `plasmodesmata` 的 `main`；蓋子那一側不另外建立原生質絲。
- 以上每一層（含伸出的六片）都切掉掀開區，切面各自獨立成 `cut`。被切掉的部分（細胞膜、兩種壁、中膠層都要）放在蓋子根節點下，蓋回去要密合。
- 外殼的三角面上限是 60,000。

- [ ] **Step 1:** grep 其他三個模組對 `common` 的引用；更新 `common.py`。
- [ ] **Step 2:** 把 `shared/palette.json` 改成「配色」一節的內容。
- [ ] **Step 3:** 改寫 `shell.py`。
- [ ] **Step 4:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only shell --preview assets/preview/shell.png`，結束碼 0。
- [ ] **Step 5:** 跑 `node scripts/check-model.mjs --file assets/parts/shell.glb --ids cell_wall,middle_lamella,cell_membrane,cytoplasm,plasmodesmata --max-triangles 60000`，結束碼 0。
- [ ] **Step 6:** 跑完整建置 `node scripts/run-blender.mjs blender/build_cell.py --preview assets/preview/full.png` 與 `node scripts/check-model.mjs`，兩者結束碼 0（此時共 16 個 id：舊的 15 個加 `middle_lamella`）。`tests/model.test.mjs` 仍期待舊的 15 個 id，它在 Task 17 才更新，本任務期間它失敗是預期的；`node --test tests/glb.test.mjs tests/three-extras.test.mjs` 要通過。
- [ ] **Step 7:** 用 Read 看 `assets/preview/shell.png` 與 `assets/preview/full.png`：外形是稜線分明的六角柱；切面上由內而外看得出細胞膜、本細胞的壁、中膠層、相鄰細胞的壁；六條直立稜上各有一片伸出的相鄰細胞壁，末端切口看得出三層；蓋子蓋著時密合；所有胞器都在殼內。不符就修。
- [ ] **Step 8:** 提交（路徑：`blender/cellkit/common.py blender/cellkit/shell.py shared/palette.json`），訊息 `feat: 外殼改為六角柱，加入中膠層與相鄰細胞壁`。

### Task 15: 染色質獨立、跨液泡細胞質絲（`core.py`）

**Files:**
- Modify: `blender/cellkit/core.py`

**Interfaces:**
- Consumes: Task 14 的 `strand_ends`、`STRANDS`，以及既有的 `common.py` 介面

| id | 形狀 | parts | 錨點 |
|---|---|---|---|
| `nucleus` | 幾何不變；染色質不再屬於它 | `main`, `cut`, `pore` | 不變 |
| `chromatin` | 原本的染色質網格改成獨立的構造：自己的個體根（放在染色質的幾何中心）。幾何與既有的檢查（不穿出核膜、不擋在核仁前面）都保留 | `main` | 從切口看得到的一段染色質上 |
| `transvacuolar_strand` | 3 條穿過液泡的細管，合併成一個網格、一個個體。每條從 `strand_ends(i)` 的 `near` 到 `far`；中段半徑 0.09，兩端最後 0.35 的長度內平順地張開到半徑 0.16；路徑是略帶 S 形的平滑曲線，離直線的橫向偏移不超過 0.10 | `main` | 第 0 條的 `near` 端 |

- `build` 裡的自我檢查（不過就丟 `ValueError`）：每條絲去掉兩端各 0.4 之後的中段，所有頂點都在液泡橢球內；每條絲的所有頂點都滿足 `inside_cavity(p, 0.05)`、距細胞核中心都大於 `NUCLEUS_ZONE`；不同條絲的頂點之間最近距離不小於 0.2。
- `nucleus` 不再使用 `chromatin` 這個 part（改用 `chromatin` 這個 id 的 `main`）。本任務不得修改 `shared/palette.json`。
- 這個模組的三角面上限是 56,000。

- [ ] **Step 1:** 修改 `core.py`。
- [ ] **Step 2:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only core --preview assets/preview/core.png`，結束碼 0。
- [ ] **Step 3:** 跑 `node scripts/check-model.mjs --file assets/parts/core.glb --ids vacuole,nucleus,nucleolus,chromatin,transvacuolar_strand --max-triangles 56000`，結束碼 0。
- [ ] **Step 4:** 用 Read 看 `assets/preview/core.png`：三條細胞質絲穿過半透明的液泡、兩端張開；細胞核的外觀與改版前相同。不符就修。
- [ ] **Step 5:** 回報完成（不自行提交）。

### Task 16: 皮層微管、肌動蛋白微絲、油體（`endomembrane.py`）

**Files:**
- Modify: `blender/cellkit/endomembrane.py`

**Interfaces:**
- Consumes: Task 14 的 `cavity_sdf`（六角柱）、`OIL_BODY_REP`，以及既有的 `common.py` 介面

| id | 形狀 | parts | 錨點 |
|---|---|---|---|
| `microtubule` | 取代 `cytoskeleton` 的微管：16 條，半徑 0.022，沿細胞膜內側（距膜 0.15 到 0.35）走，貼合六角柱空腔（用 `cavity_sdf`，不要假設空腔是盒子）。一個個體、一個網格。掀開區內至少 4 條 | `main` | 掀開區內看得到的一條的中點 |
| `actin_filament` | 取代 `cytoskeleton` 的微絲：12 條，半徑 0.012，從皮層伸向細胞核附近，略彎。一個個體、一個網格 | `main` | 掀開區內看得到的一條的中點 |
| `oil_body` | 5 顆光滑的球，半徑 0.17 到 0.21。第 0 顆（代表）放在 `OIL_BODY_REP`，是固定位置，不呼叫 `reserve`；其餘 4 顆用 `sample_free(0.22, …)`（其中 1 顆在掀開區）取位置並 `reserve`。每顆一個個體 | `main` | 無 |

- 建立順序：先建 5 顆油體（其中 4 顆 `reserve`），再建微管與微絲，讓微管與微絲用 `ctx.is_free` 避開油體與細胞質絲的端點。
- 把 `endomembrane.py` 裡所有用 `rbox_sdf`、`CAVITY_R`、`CAVITY_HALF` 判斷「是否在空腔內」的地方（粗糙內質網的範圍限制與 `_cavity_ok` 等自我檢查）改成用 `cavity_sdf`，讓它們檢查的是六角柱空腔。
- 模型裡不再有 `cytoskeleton` 這個 id（palette 裡的 `cytoskeleton` 鍵由 Task 17 移除，本任務不得修改 `shared/palette.json`）。微管與微絲都不得穿過液泡（半軸各加 0.15）與 `NUCLEUS_ZONE`；既有的自我檢查改成分別檢查這兩個構造。
- 其餘構造（粗糙內質網、核糖體、平滑內質網、高基氏體）的幾何與檢查不變。
- 這個模組的三角面上限是 104,000。

- [ ] **Step 1:** 修改 `endomembrane.py`。
- [ ] **Step 2:** 跑 `node scripts/run-blender.mjs blender/build_cell.py --only endomembrane --preview assets/preview/endomembrane.png`，結束碼 0。
- [ ] **Step 3:** 跑 `node scripts/check-model.mjs --file assets/parts/endomembrane.glb --ids rough_er,ribosome,smooth_er,golgi,microtubule,actin_filament,oil_body --max-triangles 104000`，結束碼 0，且摘要的 id 清單裡沒有 `cytoskeleton`。
- [ ] **Step 4:** 用 Read 看 `assets/preview/endomembrane.png`：微管沿六角柱的內壁走、轉角處順著稜線；油體是 5 顆紅棕色的小球；其餘構造與改版前相同。不符就修。
- [ ] **Step 5:** 回報完成（不自行提交）。

### Task 17: 改版後的重新整合

**Files:**
- Modify: `tests/model.test.mjs`, `shared/palette.json`（只移除兩個過渡用的鍵）
- Modify: `blender/cellkit/*.py`（只修整合時發現的重疊或穿模；固定位置的構造互相穿插時回報 BLOCKED）

- [ ] **Step 1:** 把 `tests/model.test.mjs` 期待的 id 清單改成 Global Constraints 的 20 個。跑 `node --test tests/model.test.mjs` 確認失敗（目前的 `assets/plant_cell.glb` 還是舊的）。
- [ ] **Step 2:** 從 `shared/palette.json` 移除 `nucleus.chromatin` 與 `cytoskeleton` 兩個過渡用的鍵。跑 `node scripts/run-blender.mjs blender/build_cell.py --preview assets/preview/full.png`，結束碼 0（代表沒有模組還在用這兩個鍵）。
- [ ] **Step 3:** 跑 `node --test tests/glb.test.mjs tests/three-extras.test.mjs tests/model.test.mjs` 全數通過；跑 `node scripts/check-model.mjs`，在回報附上三角面數與檔案大小。
- [ ] **Step 4:** 種子 20261117 到 20261126 各做一次完整建置（輸出到暫存資料夾），十個都要完成。
- [ ] **Step 5:** 用 Node 腳本解析正式的 glb 做量化驗算並附上數字：粗糙內質網、附著的核糖體、平滑內質網到細胞核中心的最小距離（應大於 1.18）；葉綠體、粒線體、過氧化體、油體每個個體的碰撞球（半徑 0.62、0.48、0.25、0.22）裡別的構造的頂點數（應為 0；`cytoplasm` 不算）；所有胞器（`cell_wall`、`middle_lamella`、`cell_membrane`、`cytoplasm`、`plasmodesmata` 除外）的頂點是否都在六角柱空腔內；高基氏體是否在液泡之外。
- [ ] **Step 6:** 用 Read 看 `assets/preview/full.png`：六角柱外殼、三層壁與六片相鄰細胞壁、掀開的一角看得到所有代表構造（含油體與穿過液泡的細胞質絲）、蓋子密合。不符就修。
- [ ] **Step 7:** 提交（路徑：`blender shared/palette.json tests/model.test.mjs`），訊息 `feat: 改版後的完整模型（20 項構造）`。

### Task 18: 介紹文字重寫（大學程度，20 項）

**Files:**
- Modify: `web/src/organelles.js`, `tests/organelles.test.mjs`

**Interfaces:**
- Produces（匯出的名稱與 Task 8 相同，內容改版）：
  - `ORGANELLES: { id, zh, en, tagline, body, fact, pickable }[]`：20 項，順序同 Global Constraints；`zh`、`en` 照規格 §11 的構造清單；`pickable` 為 `false` 的是 Global Constraints 列的那 7 個 id。
  - `ORGANELLE_IDS`、`QUIZ_IDS`（13 個）、`getOrganelle(id)`、`INTRO: { title: '植物細胞', paragraphs: string[], start: '開始探索' }` 不變。
  - `web/src/forbidden-words.js` 不變。

- [ ] **Step 1:** 改寫 `tests/organelles.test.mjs`（長度以 `[...s].length` 計）：
  - `ORGANELLE_IDS` 等於 20 個 id 的固定順序；每項的 `zh`、`en` 等於規格 §11 的對照表（整張表寫進測試）。
  - 每項 `tagline` 長度 1 到 30、`body` 長度 120 到 260、`fact` 為 `null` 或長度 1 到 90。
  - `pickable` 為 `false` 的恰好是那 7 個 id；`QUIZ_IDS.length === 13`。
  - 所有文字（含 `INTRO`）不含禁用詞。
  - `vacuole` 的 `body` 或 `fact` 含「比例」。
  - `INTRO.paragraphs` 有 2 到 3 段，合起來含「葉肉細胞」「中膠層」「原生質絲」「液泡」「比例」，總長度不超過 260。
- [ ] **Step 2:** 跑 `node --test tests/organelles.test.mjs` 確認失敗。
- [ ] **Step 3:** 改寫 `web/src/organelles.js`。程度是大學普通生物學到植物生理學：每項的 `body` 要講到構造的組成（例如膜的層數、主要成分）、位置、功能，以及它與其他構造的關係；用詞精確。開場要說明：這是葉肉細胞的示意模型；相鄰細胞以中膠層相黏、以原生質絲相通；液泡的比例刻意縮小。
- [ ] **Step 4:** 跑 `node --test tests/organelles.test.mjs` 通過。
- [ ] **Step 5:** 回報完成（不自行提交）。

主持人另派一位沒參與撰寫的審查者，逐句核對生物學正確性與台灣的學術用語。

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
- 背景：畫布透明，頁面底色用 CSS 放射漸層 `#F6F3EC → #DDD6C6`（淺色紙張色調，配合教科書插畫的畫風）。
- 鏡頭：位置為方向 `(0.62, 0.48, 0.62)` 正規化後乘以 20，看向模型中心；`OrbitControls` 開啟阻尼，縮放距離限制在 7 到 36，關閉平移。
- 材質：預設不透明、粗糙度 0.6 到 0.8（教科書插畫的霧面質感，不要塑膠般的高光）。`cut` 一律比 `main` 更霧面。半透明的只有三種：`vacuole`（唯一可用 `transmission` 的構造）、`cytoplasm`（不透明度約 0.12、`depthWrite: false`）、`cell_membrane`（不透明度約 0.9）。
- 不使用後製（不加 EffectComposer）。
- **模型正在改版**（Task 14 到 17）：`assets/plant_cell.glb` 的 id 會從 15 個變成 20 個，`shared/palette.json` 的鍵也會跟著增減。檢視器不得寫死 id 的數量或清單；材質一律依 palette 的 `organelle/part` 查色，palette 裡查不到的組合用中性灰並以 `console.warn` 提示一次（不可用 `console.error`）。

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
  const built = summarizeGlb(...Object.values(readGlb('assets/plant_cell.glb')));
  assert.deepEqual([...s.ids].sort(), [...built.ids].sort());
  assert.ok(s.ids.length >= 15);
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

主持人自己看 `assets/preview/web-default.png` 與 `web-rotated.png`，不滿意就先派修正。滿意後把 `dist/plant-cell.html` 交給使用者試轉，確認形狀與質感的方向。檢查點一在改版任務（Task 14 到 17）與 Task 7 都完成後進行。**使用者確認前不開始 Task 9 之後的任務。**

---

## 第二階段：到檢查點二（第一個可玩版本）

### Task 8: 介紹文字（已完成；內容由 Task 18 重寫）

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
  - `config.js`：`GHOST_IDS = ['cell_wall', 'middle_lamella', 'cell_membrane', 'cytoplasm']`（會變成殘影的外殼）；`SCALE_IDS = [...GHOST_IDS, 'plasmodesmata', 'microtubule', 'actin_filament']`（拆解時跟著外殼放大的構造，Task 11 使用）。
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
- 介面外觀：淺色主題。面板與清單是半透明的白色底加背景模糊、深色文字；內文字級不小於 16 像素；桌機上面板寬 340 像素、靠右；清單在底部，每個按鈕左側有該構造的色點（顏色取 palette 的 `main`）。

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
  - 逐一點清單上的 20 個按鈕：`#panel-title` 等於該項的 `zh`、`#panel-body` 等於該項的 `body`。
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
  - `explode.js`：`FOLLOW = { chromatin: 'nucleus', transvacuolar_strand: 'vacuole' }`。`FOLLOW` 裡的構造不自己算位移，而是跟著它所屬構造的代表個體做完全相同的位移（染色質留在細胞核裡、細胞質絲留在液泡裡）。
  - `highlight.js`：`apply(state)` 在 `state.exploded` 為真時也把 `GHOST_IDS` 變成殘影，並讓 `shellsGhosted` 為 `true`（所以拆解中外殼不可點）。
  - `labels.js`：`createLabels({ container, index, camera, nameOf }) → { setVisible(on), update() }`，每個 id 一個標籤，掛在 `byId.get(id).anchor` 上，位置每格更新，在鏡頭背面的不顯示。
  - `ui/toolbar.js`：`mountToolbar(root, { onExplode, onLabels }) → { setState({ exploded, labels, phase }) }`
  - `window.__cell` 增加：`explodeProgress() → number`（0 到 1）。
  - DOM：`#btn-explode`、`#btn-labels`、`#labels`（每個標籤 `data-id`）。

- [ ] **Step 1:** 寫失敗測試 `tests/explode.test.mjs`，數值比較用容差 `1e-9`：`explodeTarget([2,0,0],[0,0,0],'golgi')` 約等於 `[3.8,0,0]`；`explodeTarget([0,0,0],[0,0,0],'vacuole')` 約等於 `[0,0,0]`；`explodeTarget([1,1,1],[1,1,1],'nucleolus')` 約等於 `[2.2,2.0,2.2]`。在 `tests/state.test.mjs` 增加 `toggleExplode`、`toggleLabels` 各切換一次的測試（先 `start`）。跑 `npm test` 確認失敗，實作後通過。
- [ ] **Step 2:** 實作 `createExploder`、`labels.js`、`toolbar.js` 並接進 `main.js`。
- [ ] **Step 3:** 寫 `tests/e2e/play.e2e.mjs`（開頭先點 `#intro-start` 並等 `lidOpen()`）：
  - 記下 `nucleus, golgi, chloroplast, mitochondrion, peroxisome, vacuole` 六者的 `repScreenPoint`。點 `#btn-explode`，3 秒內 `explodeProgress() === 1`；六者任兩個在畫面上的距離都比拆解前大；`screenPointOf('cell_wall') === null`（外殼是殘影、不可點）；`chromatin` 與 `nucleus` 的 `repScreenPoint` 之間的距離與拆解前相差不到 2 像素（`FOLLOW`）；截圖 `assets/preview/web-exploded.png`。再點一次，`explodeProgress()` 回到 0。
  - 點 `#btn-labels`，`#labels [data-id]` 共 20 個，其中可見的至少 10 個；截圖 `assets/preview/web-labels.png`。再點一次全部隱藏。
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
