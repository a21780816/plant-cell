# 介紹卡片引線與英文版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選取構造後，介紹卡片（`#panel`）用一條引線連到畫面上被選的構造；整個成品可在中文與英文之間即時切換。

**Architecture:** 引線是蓋滿視窗的 `<svg id="callout">`，幾何由純函式 `calloutGeometry` 計算，`main.js` 在每次繪製前（`scene.onBeforeRender`，與名稱標籤同一時機）更新。語言是 store 的 `lang` 欄位；介面文字集中在 `web/src/i18n.js` 的文字表，英文介紹在 `web/src/organelles.en.js`；各介面模組提供 `setLang`／`setNames`／`setContent`，由 `render(state)` 在 `lang` 改變時呼叫。英文版面只用 `html[lang="en"]` 開頭的 CSS 覆寫，中文樣式不動。

**Tech Stack:** three 0.187.0、esbuild 0.28.2、Node.js 22（`node --test`）、無介面 Chrome（`scripts/cdp.mjs` 的 `openPage`）。

**Spec:** `docs/superpowers/specs/2026-11-18-callout-english-design.md`

## Global Constraints

- 只在分支 feat/callout-english 上新增 commit；提交一律 `git add <明確路徑>` 再 `git commit -m … -- <同樣路徑>`；禁止 `git add -A`、裸 commit、reset、rebase、amend、squash、切到其他分支、push（這個 repo 沒有遠端）。
- 相依套件只有 three 與 esbuild，不得新增任何套件；不得改 `package.json` 的 dependencies。
- `dist/` 與 `assets/*.glb` 不進版控，不得提交；不需要也不得跑 `npm run model`（Blender）。
- 註解與 commit 訊息用繁體中文（沿用既有寫法，例如「feat: 窄螢幕版面、效能與離線檢查」）；程式識別字用英文。
- 預設語言是中文，中文模式的既有行為與既有測試（83 項單元、43 項端對端）必須維持通過；機械性調整既有斷言（例如屬性改名）可以，放寬斷言不行。
- 既有測試依賴的固定值不得改：閒置自轉門檻 4 秒、測驗揭曉 1.8 秒、鏡頭方向 (0.62, 0.48, 0.62)、fov 36。
- 測試做法：先寫會失敗的測試、確認紅燈、再實作到綠燈。指令是 `npm test`（單元）與 `npm run e2e`（端對端，會先 build）；單檔指令見下面「指令」那一條。跑完不得殘留 Chrome 行程。
- 成品仍是單一檔 `dist/plant-cell.html`，離線可開、沒有外部請求。
- 指令（已核對 `package.json:7-11`）：單元單檔 `node --test tests/<名稱>.test.mjs`；單元全套 `npm test`（起點 `# pass 83`）。端對端單檔要先建置：`npm run build && node --test --test-concurrency=1 tests/e2e/<名稱>.e2e.mjs`，只跑一項再加 `--test-name-pattern="<名稱片段>"`。全套 `npm run e2e`（起點 43 項；加上本計畫新檔後約 8–10 分鐘，用背景執行或把逾時設 600000 ms）。改了 `web/` 一定要重新建置，端對端開的是 `dist/plant-cell.html`。
- 殘留 Chrome 檢查：`pgrep -fl 'chrome-profile/p-' || echo 無殘留`，通過時只印「無殘留」；有殘留就 `pkill -f 'chrome-profile/p-'`，再查一次並寫進回報。
- 端對端隔離：每個 `test()` 自己 `openPage`、在 `finally` 裡 `close()`（每次都是新的 Chrome 設定檔，localStorage 互不相通）；要一開始就是英文，用 `openPage` 的 `initScript: "try { localStorage.setItem('plant-cell-lang', 'en'); } catch {}"`；測試之間不得共用頁面。
- 行號以本分支起點 `b5abfd4` 為準；前面任務改過的檔案行號會位移，以引號裡的程式片段定位。任務依序 1→5，每個任務只改自己 Files 列出的檔。截圖存 `assets/preview/`（不進版控）。

## Review Focus

1. 面板內捲動讓色點移出面板 → 起點夾在面板邊緣，線不從面板外的空白冒出。→ Task 1 單元「色點捲出面板」＋端對端第 5 項
2. 名稱標籤開著時切換語言 → 藥丸重新量寬、彼此不重疊。→ Task 4 端對端 L4
3. localStorage 被封鎖、讀寫丟錯或存了無效值 → 以中文正常啟動、切換仍有效、主控台沒有錯誤。→ Task 3 `readLang`／`writeLang` 單元＋Task 4 端對端 L6
4. 執行中切到英文使清單變高 → 底部保留帶重算，本細胞的壁不被清單蓋住。→ Task 5 端對端 E1
5. 測驗揭曉中切換語言 → 結果文字換成新語言，計時照常進到下一題，題目與分數不變。→ Task 4 端對端 L5

---

### Task 1: 介紹卡片引線

**Files:**
- Create: `web/src/callout.js`、`tests/callout.test.mjs`、`tests/e2e/callout.e2e.mjs`
- Modify: `web/template.html:14`（`<div id="labels" hidden></div>` 之後插入 `<svg id="callout" aria-hidden="true"></svg>`）、`web/styles.css:396`（`#labels .label.selected` 區塊之後新增 `#callout` 規則）、`web/src/main.js:15`（import）、`:208`（onBeforeRender）、`:399-432`（`window.__cell`）

**Interfaces:**
- Consumes: `GHOST_IDS`（`web/src/config.js:2`）；`index.byId.get(id) → { instances, rep, anchor }`（`web/src/model.js:29,51`，沒有錨點時 `anchor === rep`）；`main.js` 的 `layoutCtl.current.mode`、`projectToClient(world) → { x, y, z }`（`:363-368`，視窗座標，z 是 NDC）、`palette`。
- Produces（`web/src/callout.js`，不 import three）：
  - `export const CALLOUT_INSET = 4`、`export const CALLOUT_MIN_LEN = 12`
  - `export function calloutGeometry({ mode, panel, dot, target, stage }) → { visible, x1, y1, x2, y2 }`：`mode` 是 `'wide'|'short'|'narrow'`；`panel`、`stage` 是 `{ left, top, right, bottom }`（`panel` 可為 null）；`dot`、`target` 是 `{ x, y }`（`target` 可為 null）；全部是視窗 CSS 像素。
  - `export function calloutTargetOf(entry, sel, ghostIds = GHOST_IDS) → Object3D | null`
  - `export function createCallout(svg) → { draw(geo, color), get state() }`
  - `window.__cell.callout() → { visible, x1, y1, x2, y2 }`（最後一次 `draw` 的值的複本）

- [ ] **Step 1: 寫單元測試 `tests/callout.test.mjs`（9 項）**

```js
const STAGE = { left: 0, top: 0, right: 1280, bottom: 800 }, PANEL = { left: 924, top: 16, right: 1264, bottom: 500 };
const HIDDEN = { visible: false, x1: 0, y1: 0, x2: 0, y2: 0 };
const g = (o = {}) => calloutGeometry({ mode: 'wide', panel: PANEL, dot: { x: 955, y: 57 }, target: { x: 600, y: 400 }, stage: STAGE, ...o });
test('wide 與 short：起點 x 是面板左緣、y 是色點中心，終點是目標點');  // deepEqual(g(), { visible: true, x1: 924, y1: 57, x2: 600, y2: 400 })；g({ mode: 'short' }) 相同
test('wide：色點捲出面板時 y 夾在面板上下緣');                          // g({ dot: { x: 955, y: -20 } }).y1 === 16；dot.y 640 → y1 === 500
test('narrow：起點 y 是面板上緣、x 是色點中心並夾在左右緣');            // stage {0,0,390,416}、panel {12,420,378,788}、dot {43,455}、target {200,200} → { visible: true, x1: 43, y1: 420, x2: 200, y2: 200 }；dot.x 5 → x1 12；dot.x 500 → x1 378
test('面板或目標點為 null 時不顯示，座標全為 0');                        // g({ panel: null })、g({ target: null }) 都 deepEqual HIDDEN
test('目標點要在畫布內縮 4 像素以內（含邊界）');                         // target.x 4、1276 顯示；3、1277 不顯示；target.y 4、796 顯示；3、797 不顯示
test('目標點落在面板矩形內（含邊緣）不顯示');                            // target {1000,200}、{924,200} → HIDDEN；{923,200} 顯示
test('線長小於 12 不顯示、等於 12 顯示');                                 // dot {955,300}：target {913,300} → HIDDEN；{912,300} 顯示
test('座標四捨五入成整數');                                               // dot {955.4,57.6}、target {600.5,399.4} → x1 924、y1 58、x2 601、y2 399
test('calloutTargetOf：清單選用錨點，點選非代表個體用該個體根，代表個體、找不到的個體與外殼類用錨點');
// const rep = { userData: { inst: 0 } }, other = { userData: { inst: 1 } }, anchor = { userData: {} }, e = { rep, anchor, instances: [rep, other] };
// (e, { id: 'nucleus', inst: null }) → anchor；inst 1 → other；inst 0 → anchor；inst 7 → anchor；(e, { id: 'cell_wall', inst: 1 }) → anchor；
// ({ rep, anchor: null, instances: [rep] }, { id: 'nucleus', inst: null }) → rep；(undefined, { id: 'x', inst: null }) → null
```

- [ ] **Step 2:** `node --test tests/callout.test.mjs` → FAIL（找不到 `../web/src/callout.js`）。
- [ ] **Step 3: 實作 `web/src/callout.js`**
  - `calloutGeometry`：起點——`mode === 'narrow'`：`y1 = panel.top`、`x1 = clamp(dot.x, panel.left, panel.right)`；其他（wide、short）：`x1 = panel.left`、`y1 = clamp(dot.y, panel.top, panel.bottom)`。終點 = target。四個值 `Math.round` 後再判斷，全部成立才 `visible: true`：panel 與 target 非 null；`stage.left+4 ≤ x2 ≤ stage.right−4` 且 `stage.top+4 ≤ y2 ≤ stage.bottom−4`；目標不在面板矩形（含邊）內；`Math.hypot(x2−x1, y2−y1) ≥ 12`。不顯示就回傳 `HIDDEN` 的形狀。
  - `calloutTargetOf`：entry 不存在 → null；`ghostIds.includes(sel.id)` 或 `sel.inst === null` → `entry.anchor ?? entry.rep`；否則找 `userData.inst === sel.inst` 的個體，找不到或它就是 `entry.rep` → `entry.anchor ?? entry.rep`，否則回傳該個體根。（計畫的決定：規格的條列與既有 `targetOf` 在「點到代表個體」時不同，引線照規格條列；鏡頭用的 `targetOf`（`main.js:291-296`）不改，中文行為不變。）
  - `createCallout(svg)`：只建立一次 `<line class="callout-line">` 與 `<circle class="callout-dot" r="3.5">`；建立時 `svg.style.display = 'none'`；`draw(geo, color)` 只在值改變時寫 DOM（`display`、四個座標、圓點 `cx`/`cy` = `(x2, y2)`、`fill`）。
- [ ] **Step 4:** `node --test tests/callout.test.mjs` → `# pass 9`、`# fail 0`。
- [ ] **Step 5: 寫端對端測試 `tests/e2e/callout.e2e.mjs`（5 項）**——import `QUIZ_IDS`（`web/src/organelles.js`）與 `GHOST_IDS`（`web/src/config.js`）；`sleep`、`READY`、`open`、`info`、`center`、`overlaps`、`inside` 照抄 `tests/e2e/layout.e2e.mjs:7-31`，`startAndSettle` 照抄 `:62-69`，`frames`、`clickCenter` 照抄 `:110-111`，`setInnerWidth` 照抄 `:305-308`。自訂 `projectOf(page, id, inst = null)`：頁面內取 `inst === null ? (e.anchor ?? e.rep) : e.instances.find((r) => r.userData.inst === inst)`，`getWorldPosition` 後用 `__cell.view.camera` 投影，加上 `#stage` 的 `getBoundingClientRect()` 換成視窗座標。`settle` = `waitFor('!window.__cell.cameraBusy()', 5000)`＋`sleep(600)`＋`frames(page, 3)`，每次量測前都做。`c` = `await page.evaluate('window.__cell.callout()')`。
  1. `引線 wide（1280×800）：開場不顯示；選細胞核後起點在面板左緣、對齊色點，終點是錨點投影；樣式與圖層；靜止不寫 DOM；名稱標籤同時顯示；fps ≥ 50`——開場：`c.visible === false`、`#callout` 計算後 `display === 'none'`。`#callout` 的 `position` 'fixed'、`pointerEvents` 'none'、`zIndex` '1'、`aria-hidden` 'true'、`#labels.compareDocumentPosition(#callout) & 4` 為真、矩形 `{0,0,1280,800}`。start 後點清單 `nucleus`、settle：`c.visible`、`|c.x1 − panel.left| ≤ 1`、`|c.y1 − #panel-dot 中心 y| ≤ 1`、`(c.x2, c.y2)` 與 `projectOf('nucleus')` 距離 ≤ 2；`line` 的 x1..y2 屬性等於 c；`circle` 的 cx/cy 等於 (x2, y2)、`r` 為 '3.5'、計算後 `fill` 為 `rgb(163, 150, 184)`（`shared/palette.json` 的 nucleus.main `#A396B8`）；`line` 計算後 `stroke` 為 `rgba(52, 48, 42, 0.5)`、`strokeWidth` 為 `1px`。MutationObserver 觀察 `#callout`（attributes、subtree）500 ms，變動數 0。按 `#btn-labels` 後 `c.visible` 仍為真。`sleep(1500)` 後 `__cell.stats().fps ≥ 50`（印出數值）。`page.consoleErrors` 為 `[]`。
  2. `引線跟隨：旋轉、拉近、視窗縮放、拆解後終點仍是投影；代表個體指向錨點、非代表個體指向該個體根`——選 nucleus 後 `page.drag(640, 400, 820, 330)`：終點移動 > 5 px 且與新的 `projectOf` 距離 ≤ 2；頁面內 `camera.position.lerp(controls.target, 0.3); controls.update()` 後距離 ≤ 2；`setInnerWidth(1240)` 後距離 ≤ 2（再設回 1280）；按 `#btn-explode`、等 `explodeProgress() === 1` 再 settle，距離 ≤ 2，再按一次回到組合。`store.dispatch({ type: 'select', id: 'nucleus', inst: <rep 的 userData.inst> })`：先斷言錨點與代表個體根的投影相距 > 4 px（前提），再斷言終點對應錨點。`QUIZ_IDS` 中第一個不在 `GHOST_IDS` 且 `instances.length ≥ 2` 的 id，dispatch 選它的一個非代表個體：`c.visible` 且與 `projectOf(id, inst)` 距離 ≤ 2。
  3. `引線消失：取消選取與進入測驗後不顯示，測驗中不出現`——選 nucleus → visible；按 `#panel-close`、frames 後 `visible === false` 且 display 'none'；再選 → visible；按 `#btn-quiz`，phase 為 quiz 後 hidden，之後 1 秒內每 100 ms 取樣都 hidden；按 `#quiz-exit` 後仍 hidden。
  4. `引線 narrow（390×800）：起點在面板上緣、對齊色點的水平位置`——點清單 nucleus、settle：`|c.y1 − panel.top| ≤ 1`、`|c.x1 − 色點中心 x| ≤ 1`、終點與 `projectOf` 距離 ≤ 2、`c.y2 ≤ stage.bottom − 4`。
  5. `引線 short（900×420）：面板捲到底、色點移出後起點夾在面板上緣`——選 nucleus；前提 `scrollHeight > clientHeight + 20`；`#panel.scrollTop = scrollHeight`、frames(3)：色點下緣 < 面板上緣、`c.visible`、`|c.y1 − panel.top| ≤ 1`、`|c.x1 − panel.left| ≤ 1`。
- [ ] **Step 6:** `npm run build && node --test --test-concurrency=1 tests/e2e/callout.e2e.mjs` → 5 項 FAIL（`window.__cell.callout is not a function` 或 `#callout` 不存在）。
- [ ] **Step 7: 接線**
  - `web/template.html`：照 Files 在 `#labels` 那一行之後插入 `<svg id="callout" aria-hidden="true"></svg>`。
  - `web/styles.css`：`#callout { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 1; pointer-events: none; overflow: visible; }`；`#callout .callout-line` 的 stroke 與寬度照抄 `#labels .leader`（`:365`），`#callout .callout-dot` 照抄 `#labels .anchor-dot`（`:366`）。z-index 1＋DOM 順序在 `#labels` 之後＝在名稱標籤之上，在清單與工具列（z 2）、面板與測驗卡片（z 3）之下。
  - `web/src/main.js`：`const callout = createCallout(document.getElementById('callout'))`；`:208` 改為 `view.scene.onBeforeRender = () => { labels.update(); updateCallout(); };`。`updateCallout()`：`s.phase === 'explore' && s.selected && !#panel.hidden` 才把 `#panel` 的 `getBoundingClientRect()` 當 `panel`，否則 `panel: null`；目標物件 `calloutTargetOf(index.byId.get(id), s.selected)`，`projectToClient(obj.getWorldPosition(v))` 的 `z` 在 `[-1, 1]` 才當 `target`（否則 null：在鏡頭背面或超出遠近平面）；`dot` 是 `#panel-dot` 矩形中心；`stage` 是 `canvas.getBoundingClientRect()`；`mode` 是 `layoutCtl.current.mode`；顏色 `palette[id]?.main ?? '#B8B4AC'`。`window.__cell.callout = () => ({ ...callout.state })`。不做遮擋判斷。
- [ ] **Step 8:** 單檔端對端 → `# pass 5`；`npm test` → `# fail 0`；`npm run e2e` → `# fail 0`（43＋5 項）；殘留 Chrome 檢查印「無殘留」。
- [ ] **Step 9: Commit**

```bash
git add web/src/callout.js web/src/main.js web/template.html web/styles.css tests/callout.test.mjs tests/e2e/callout.e2e.mjs
git commit -m "feat: 介紹卡片的引線" -- web/src/callout.js web/src/main.js web/template.html web/styles.css tests/callout.test.mjs tests/e2e/callout.e2e.mjs
```

### Task 2: 英文介紹內容（只新增檔案，不碰介面）

**Files:**
- Create: `web/src/organelles.en.js`、`tests/organelles-en.test.mjs`

**Interfaces:**
- Consumes: `ORGANELLES`、`ORGANELLE_IDS`、`INTRO`、`getOrganelle`（`web/src/organelles.js:4-161`，中文內容不得修改）。
- Produces: `export const INTRO_EN = { title: 'Plant Cell', paragraphs: [三個字串], start: 'Start exploring' }`；`export const ORGANELLES_EN = { [id]: { tagline, body, fact } }`（20 個鍵，順序同 `ORGANELLE_IDS`；`fact` 為字串或 null）。本檔不 import 任何東西（比照 `organelles.js:2` 的規定）。

- [ ] **Step 1: 寫 `tests/organelles-en.test.mjs`（10 項）**

```js
const CJK = /[　-〿㐀-鿿＀-￯]/; const len = (s) => [...s].length;
test('鍵恰好是 20 個 id、順序同 ORGANELLE_IDS，每則只有 tagline、body、fact');   // deepEqual(Object.keys(ORGANELLES_EN), ORGANELLE_IDS)；每則 deepEqual(Object.keys(e).sort(), ['body', 'fact', 'tagline'])
test('fact 為 null 的條件與中文相同（只有 smooth_er）');                       // 每個 id：(en.fact === null) === (getOrganelle(id).fact === null)；null 的 id deepEqual ['smooth_er']
test('長度（字元數含空白）：tagline 10–120、body 400–1200、fact 30–400');
test('INTRO_EN：title、start 定稿，段數與中文相同，各段非空、合計不超過 1100');  // title 'Plant Cell'；start 'Start exploring'；paragraphs.length === INTRO.paragraphs.length；len(paragraphs.join('')) ≤ 1100
test('英文字串不含中日韓文字與全形標點');                                       // 所有 tagline／body／fact 與 INTRO_EN 的字串 !CJK.test(s)
test('液泡保留「模型比實際小」的說明');                                          // /scale|proportion/i.test(body + ' ' + fact)；/smaller|reduced|shrunk|scaled down/i.test(body)
test('INTRO_EN 提到 mesophyll、middle lamella、plasmodesmata、vacuole 與比例');  // 對 paragraphs.join(' ')：/mesophyll/i、/middle lamella/i、/plasmodesmata/i、/vacuole/i、/scale|proportion/i
test('每則 body 用與 en 欄位一致的名稱提到自己');  // NAME_RE[id] 全部符合 body：cell_wall /primary (cell )?wall/i；middle_lamella /middle lamella/i；cell_membrane /plasma membrane/i；cytoplasm /cytoplasm/i；nucleus /nucleus/i 與 /nuclear envelope/i；nucleolus /nucleol/i；chromatin /chromatin/i；rough_er /rough ER\b/；smooth_er /smooth ER\b/；ribosome /ribosome/i；golgi /Golgi (body|bodies|stacks?)/；mitochondrion /mitochondri/i；chloroplast /chloroplast/i；vacuole /vacuole/i；transvacuolar_strand /transvacuolar strand/i；peroxisome /peroxisome/i；oil_body /oil bod(y|ies)/i；plasmodesmata /plasmodesma/i；microtubule /cortical microtubule/i；actin_filament /actin microfilament/i
test('中文欄位裡的數字與大寫縮寫都出現在對應的英文欄位');  // tagline→tagline、body→body、fact→fact：for (const tok of (zh ?? '').match(/\d+|[A-Z]{2,}/g) ?? []) assert.ok(en.includes(tok))
test('不用與既有名稱不一致的詞，一律美式拼法');  // 全部英文字串都不符合：
// REJECTED = [/Golgi (apparatus|complex)/i, /cell membrane/i, /actin filament/i, /lysosom/i, /centriol/i, /centrosom/i, /Krebs/i, /triglyceride/i, /dictyosome/i]
// BRITISH = [/\b(colour|fibre|centre|behaviour|neighbour|grey|sulphur)/i, /\b(organi|polymeri|speciali|stabili|recogni|locali|mobili)s(e|ed|es|ing|ation)\b/i, /\bsynthesis(e|ed|es|ing)\b/i, /\b(cataly|hydroly|analy)s(e|ed|ing)\b/i, /\b(labelled|modelled|signalling|travelled|travelling)\b/i]
```

- [ ] **Step 2:** `node --test tests/organelles-en.test.mjs` → FAIL（找不到 `../web/src/organelles.en.js`）。
- [ ] **Step 3: 寫 `web/src/organelles.en.js`**，規則（規格 4.3）：
  - 忠實翻譯現有中文：事實、數字、單位、程度都相同，不加新主張（不加新例子、新數字、新構造），也不刪內容；每個中文句子都要有對應的英文（可合句或拆句，資訊不可少）。中文括號裡的英文（cellulose synthase complex、cytosol、histone、tonoplast、transvacuolar strand、catalase、oil body、oleosin、desmotubule、myosin）照用。
  - 名詞用下表（大學英文教科書標準用法、美式拼法）；構造名稱與 `organelles.js` 的 `en` 欄位一致。標點只用 ASCII（直引號），可用 `α`、`β`、`µ`。
  - 長度：tagline 10–120、body 400–1200、fact 30–400 字元；不要為了長度增刪內容（自然譯文的 body 約 450–800 字元）。`INTRO_EN` 三段、合計 ≤ 1100，`title`／`start` 照 Produces。`fact` 只有 `smooth_er` 是 null。
  - 液泡：body 寫明模型裡的液泡刻意縮小、不是真實比例（含 scale 或 proportion，以及 smaller／reduced／shrunk／scaled down 之一）；fact 照中文翻花青素。
- [ ] **Step 4:** `node --test tests/organelles-en.test.mjs` → `# pass 10`；`npm test` → `# fail 0`。
- [ ] **Step 5: 自我對照**：逐則把中文與英文並排，逐句確認同一個主張、同樣的程度詞（下表最後一列）與數字；有出入就改譯文，不改測試。
- [ ] **Step 6: Commit**

```bash
git add web/src/organelles.en.js tests/organelles-en.test.mjs
git commit -m "feat: 英文介紹內容" -- web/src/organelles.en.js tests/organelles-en.test.mjs
```

**名詞對照表**（翻譯者與審查者共用；同一個中文全篇用同一個英文）

| 範圍 | 中文 → English |
|---|---|
| 構造名稱（全篇） | 初生細胞壁／初生壁 primary wall（可寫 primary cell wall）；細胞壁 cell wall；中膠層 middle lamella；細胞膜／質膜 plasma membrane（不用 cell membrane）；細胞質 cytoplasm；細胞質液 cytosol；細胞核 nucleus；核膜 nuclear envelope；核仁 nucleolus；染色質 chromatin；內質網 endoplasmic reticulum (ER)；粗糙內質網 rough ER；平滑內質網 smooth ER；扁囊 cisterna／cisternae；核糖體 ribosome；高基氏體 Golgi body／Golgi bodies（堆疊 Golgi stacks；不用 Golgi apparatus／complex）；粒線體 mitochondrion／mitochondria；葉綠體 chloroplast；液泡 vacuole；液泡膜 tonoplast；跨液泡細胞質絲 transvacuolar strand；過氧化體 peroxisome；油體 oil body；原生質絲 plasmodesmata（單數 plasmodesma）；皮層微管 cortical microtubules；微管 microtubule；肌動蛋白微絲 actin microfilaments（不用 actin filaments）；質體 plastid；囊泡 vesicle；構造 structure |
| 共通 | 葉肉細胞 mesophyll cell；葉片 leaf；光合作用 photosynthesis；光呼吸 photorespiration；膨壓 turgor pressure；細胞分裂 cell division；細胞板 cell plate；成膜體 phragmoplast；肌凝蛋白 myosin；致動蛋白 kinesin；酵素 enzyme；傳訊 RNA messenger RNA (mRNA)；核糖體 RNA ribosomal RNA (rRNA)；油料種子 oilseeds；萌發 germination；β 氧化 β-oxidation；乙醛酸循環 glyoxylate cycle；基質：壁與粒線體 matrix、葉綠體 stroma；內共生 endosymbiotic |
| INTRO | 示意模型 schematic model；主要場所 main site；相黏 held together；貫穿壁 pass through the walls；細胞質彼此相通 cytoplasm connected；成熟細胞 mature cell；大半的體積 most of the volume；比例 scale／proportion |
| cell_wall | 纖維素微纖維 cellulose microfibrils；果膠 pectin；半纖維素 hemicellulose；纖維素合成酶複合體 cellulose synthase complex；基質多醣 matrix polysaccharides；延展性 extensible；不可逆地拉伸 irreversibly stretched；挺立 stay upright；沉積 deposition；伸長 elongation |
| middle_lamella | 鈣離子 calcium ions；交聯 cross-link；凝膠 gel；黏著劑 glue；果實成熟變軟 fruit softening during ripening；果醬 jam；高糖、酸性條件 high-sugar, acidic conditions |
| cell_membrane | 磷脂質雙層 phospholipid bilayer；疏水 hydrophobic；極性分子 polar molecules；通道蛋白 channel proteins；載體蛋白 carrier proteins；幫浦 pumps；選擇性通透 selective permeability；質子幫浦 proton pump；電化學梯度 electrochemical gradient；酸生長假說 acid growth hypothesis；壁鬆弛 wall loosening |
| cytoplasm | 糖解作用 glycolysis；代謝反應 metabolic reactions；馬達蛋白 motor proteins；細胞質環流 cytoplasmic streaming；輪藻 Chara；節間細胞 internodal cells；薄層 thin layer |
| nucleus | 核孔 nuclear pores；複製 replication；轉錄 transcription；轉譯 translation；基因體 genome；基因表現 gene expression；核基因 nuclear genes；編碼 encode；崩解 break down；末期 telophase；染色體 chromosomes |
| nucleolus | 沒有膜包被 not membrane-bound；加工 processing；核糖體蛋白 ribosomal proteins；大、小次單元 large and small subunits；前期 prophase；濃縮 condense；消散 disperse |
| chromatin | 組織蛋白 histones；核小體 nucleosomes；真染色質 euchromatin；異染色質 heterochromatin；化學修飾 chemical modifications；DNA 甲基化 DNA methylation；CG、CHG、CHH 序列 CG, CHG, and CHH sequence contexts |
| rough_er | 腔 lumen；訊息序列 signal sequence；摺疊 folding；雙硫鍵 disulfide bonds；寡醣 oligosaccharides；運輸囊泡 transport vesicles；分泌蛋白 secretory proteins；未摺疊蛋白回應 unfolded protein response (UPR)；分子伴護蛋白 molecular chaperones；分解 degrade |
| smooth_er | 管網 tubular network；磷脂質 phospholipids；脂肪酸 fatty acids；醣脂 glycolipids；葉綠體被膜 chloroplast envelope；貼近接觸 close contact |
| ribosome | 密碼子 codons；胺基酸 amino acids；多肽鏈 polypeptide chain；游離 free；附著 bound；液泡蛋白 vacuolar proteins；內膜系統 endomembrane system；類似細菌的 bacterial-type；氯黴素 chloramphenicol |
| golgi | 順面 cis face；成熟面 trans face；醣基化 glycosylation；分類包裝 sorted and packaged；分泌囊泡 secretory vesicles；融合 fuse |
| mitochondrion | 內膜、外膜 inner, outer membrane；皺褶 folds (cristae)；檸檬酸循環 citric acid cycle；電子傳遞鏈 electron transport chain；ATP 合成酶 ATP synthase；質子梯度 proton gradient；氧化磷酸化 oxidative phosphorylation；耗能反應 energy-requiring reactions；內共生學說 endosymbiont theory；真核細胞 eukaryotic cell；吞入 engulfed |
| chloroplast | 類囊體 thylakoids；葉綠餅 grana（單數 granum）；光系統 photosystems；光反應 light reactions；卡爾文循環 Calvin cycle；固定二氧化碳 fix carbon dioxide；還原 reduce；糖類 sugars；有機物 organic molecules；受光面 the walls facing the light；側壁 side walls |
| vacuole | 水解酶 hydrolytic enzymes；有機酸 organic acids；色素 pigments；溶質 solutes；滲透吸水 take up water by osmosis；花青素 anthocyanins；酸鹼度 pH |
| transvacuolar_strand | 核周的細胞質 cytoplasm around the nucleus；皮層細胞質 cortical cytoplasm；捷徑 shortcut；懸浮培養細胞 suspension-cultured cells；根毛 root hairs |
| peroxisome | 氧化酶 oxidases；過氧化氫酶 catalase；過氧化氫 hydrogen peroxide；乙醇酸 glycolate；乙醛酸體 glyoxysomes；Rubisco；RuBP；已固定的碳 fixed carbon |
| oil_body | 三酸甘油酯 triacylglycerols（不用 triglycerides）；磷脂質單層 phospholipid monolayer；兩層磷脂質之間 between the two leaflets；出芽 bud off；油質蛋白 oleosins；糖質新生 gluconeogenesis；脂滴 lipid droplets |
| plasmodesmata | 內襯 lined with；desmotubule；細胞質環帶 cytoplasmic sleeve；訊號分子 signaling molecules；共質體 symplast；胼胝質 callose；隙型連結 gap junctions |
| microtubule | α、β 微管蛋白二聚體 α/β-tubulin dimers；中空管 hollow tubes；紡錘體 spindle；早前期帶 preprophase band；開花植物 flowering plants；胞質動力蛋白 cytoplasmic dynein |
| actin_filament | 球狀肌動蛋白 globular actin (G-actin)；方向性 polarity；成束 bundles；葉綠體定位 chloroplast positioning；胞吞 endocytosis；胞吐 exocytosis；肌凝蛋白 XI myosin XI |
| 程度詞與單位 | 常 often；多半 mostly；約 about；一般認為 is generally thought；可 can；主要 mainly；大致 roughly；有時 sometimes；之一 one of；極多 numerous；少量 a small number of；數公分 several centimeters；微米 µm；奈米 nm |

**審查方式**（審查者沒參與翻譯）：把 `organelles.js` 與 `organelles.en.js` 並排，20 則加 `INTRO` 逐則、逐句判讀語意，不是只掃關鍵字。每句檢查：主張是否相同、有無多出或漏掉的資訊、數字與單位、程度詞（上表最後一列）、名詞是否照表、拼法是否美式。回報格式：每則一行 PASS，或列出「中文原句／英文譯句／問題」。

### Task 3: 文字表與語言狀態（純邏輯＋單元測試）

**Files:**
- Create: `web/src/i18n.js`、`tests/i18n.test.mjs`
- Modify: `web/src/state.js:2-13`、`tests/state.test.mjs`（檔尾新增 4 項）

**Interfaces:**
- Consumes: Task 2 的 `ORGANELLES_EN`、`INTRO_EN`（`web/src/organelles.en.js`）；`ORGANELLES`、`INTRO`、`getOrganelle`。
- Produces（`web/src/i18n.js`）：
  - `LANGS = ['zh', 'en']`、`DEFAULT_LANG = 'zh'`、`LANG_KEY = 'plant-cell-lang'`、`HTML_LANG = { zh: 'zh-Hant', en: 'en' }`、`LANG_LABELS = { zh: '中文', en: 'English' }`、`UI_TEXT = { zh, en }`（下表）
  - `t(lang, key, vars = {}) → string`：不支援的 lang 用 zh；`{名稱}` 換成 `String(vars[名稱])`；未知 key 丟 `Error`。
  - `readLang(getStorage = () => globalThis.localStorage) → 'zh'|'en'`：`getStorage().getItem(LANG_KEY)` 是 `LANGS` 之一就回傳它；其他（null、無效值、getStorage 丟錯、getItem 丟錯、storage 不存在）一律 `'zh'`。不看瀏覽器語言與網址。
  - `writeLang(lang, getStorage = () => globalThis.localStorage) → void`：lang 在 `LANGS` 才 `setItem(LANG_KEY, lang)`；任何錯誤吞掉。
  - `organelleName(lang, id) → string`（en 用 `o.en`，其他用 `o.zh`）
  - `localizedOrganelle(lang, id) → { id, title, subtitle, tagline, body, fact } | undefined`：zh → title `o.zh`、subtitle `o.en`、其餘中文；en → title `o.en`、subtitle `null`、其餘取 `ORGANELLES_EN[id]`。
  - `introContent(lang) → INTRO_EN`（en）或 `INTRO`（其他）
  - `web/src/state.js`：`initialState.lang = 'zh'`；動作 `{ type: 'setLang', lang }` 在 intro 判斷（`:13`）之前處理：lang 在 `LANGS` 且不等於目前值 → `{ ...state, lang }`，否則回傳原物件；任何階段都有效。（計畫的決定：規格的 `setLang(lang)` 以這個動作物件表達；`state.js` 從 `./i18n.js` import `LANGS`。）

| 鍵 | zh | en |
|---|---|---|
| `title` | 植物細胞 | Plant Cell |
| `loading` | 載入中… | Loading… |
| `listTitle` | 細胞構造 | Cell structures |
| `toolbarLabel` | 檢視工具 | View tools |
| `quiz` | 測驗 | Quiz |
| `explode`／`assemble` | 拆解／組合 | Explode／Assemble（各一個鍵） |
| `showNames`／`hideNames` | 顯示名稱／隱藏名稱 | Show names／Hide names（各一個鍵） |
| `closePanel` | 關閉介紹 | Close description |
| `didYouKnow` | 你知道嗎 | Did you know? |
| `quizProgress` | 第 {n} 題／共 {total} 題 | Question {n} of {total} |
| `quizFind` | 請點出：{name} | Find: {name} |
| `quizCorrect` | 答對了！ | Correct! |
| `quizWrong` | 答錯了，你點的是{picked}。發亮的才是{expected}。 | Not quite. You clicked {picked}. The glowing one is {expected}. |
| `quizScore` | 答對 {score}／{total} 題 | You got {score} out of {total} |
| `playAgain` | 再玩一次 | Play again |
| `endQuiz` | 結束測驗 | End quiz |
| `fallback` | 這個瀏覽器無法顯示 3D 內容，請改用新版的 Chrome 開啟。 | This browser can't display 3D content. Please open this page in a recent version of Chrome. |
| `loadFail` | 模型載入失敗，請重新整理頁面再試一次。 | The model failed to load. Please refresh the page and try again. |

（zh 欄是 `main.js:27-28`、`template.html:6,11,17,18,20`、`toolbar.js:4-6`、`panel.js:13,27`、`quiz-ui.js:19,23,47,48,55,56,60` 的既有文字，一字不改；`fallback`／`loadFail` 的英文是計畫寫的定稿。）

- [ ] **Step 1: 寫 `tests/i18n.test.mjs`（9 項）**

```js
test('UI_TEXT 的 zh、en 鍵相同（20 個），值都是非空字串，兩語的 {佔位符} 集合相同');
test('UI_TEXT 等於定稿');                       // deepEqual(UI_TEXT.zh, {…上表 zh…})、deepEqual(UI_TEXT.en, {…上表 en…})
test('UI_TEXT.en 與 LANG_LABELS.en 不含中日韓文字與全形標點');  // /[　-〿㐀-鿿＀-￯]/
test('t：代入參數、不支援的語言用中文、未知鍵丟錯');
// t('zh','quizProgress',{ n: 1, total: 10 }) === '第 1 題／共 10 題'；t('en','quizProgress',{ n: 1, total: 10 }) === 'Question 1 of 10'
// t('en','quizWrong',{ picked: 'A', expected: 'B' }) === 'Not quite. You clicked A. The glowing one is B.'；t('en','quizScore',{ score: 7, total: 10 }) === 'You got 7 out of 10'
// t('zh','quizScore',{ score: 7, total: 10 }) === '答對 7／10 題'；t('fr','quiz') === '測驗'；assert.throws(() => t('zh', 'nope'))
test('readLang：有效值照用，其餘一律 zh，不往外丟錯');
// getItem 回 'en' → 'en'；'zh' → 'zh'；null、'fr'、'EN' → 'zh'；getStorage 丟錯 → 'zh'；getItem 丟錯 → 'zh'；getStorage 回 undefined → 'zh'；getItem 收到的鍵是 'plant-cell-lang'
test('writeLang：寫入 plant-cell-lang，無效值不寫，錯誤不往外丟');  // 假 storage 記錄 setItem → [['plant-cell-lang', 'en']]；writeLang('fr') 不呼叫；getStorage 或 setItem 丟錯 → doesNotThrow
test('常數：LANGS、DEFAULT_LANG、LANG_KEY、HTML_LANG、LANG_LABELS 等於定稿');
test('organelleName 與 localizedOrganelle');   // organelleName('en','golgi') === 'Golgi body'、('zh','golgi') === '高基氏體'；localizedOrganelle('zh','nucleus') deepEqual { id, title: '細胞核（核膜）', subtitle: 'Nucleus (nuclear envelope)', tagline/body/fact 同中文 }；('en','nucleus') 的 title 'Nucleus (nuclear envelope)'、subtitle null、tagline/body/fact === ORGANELLES_EN.nucleus；('en','smooth_er').fact === null；('zh','nope') === undefined
test('introContent');                          // ('zh') === INTRO、('en') === INTRO_EN、('fr') === INTRO
```

- [ ] **Step 2: 在 `tests/state.test.mjs` 檔尾加 4 項**

```js
test('initialState.lang 是 zh');
test('setLang 在 intro、explore、quiz 階段都有效，只改 lang');  // 對 initialState、explore、quizStart 後的狀態：s2 = reduce(s, { type: 'setLang', lang: 'en' })；s2.lang === 'en'；deepEqual({ ...s2, lang: s.lang }, s)
test('setLang 給不支援的值或目前的語言時回傳原物件');           // lang 'fr'、undefined、'zh'（目前就是 zh）→ reduce(explore, …) === explore
test('以英文起始的 store，其他動作不改 lang');                  // createStore({ ...initialState, lang: 'en' })；依序 start、select、toggleExplode、quizStart、quizExit 後 lang 都是 'en'
```

- [ ] **Step 3:** `node --test tests/i18n.test.mjs tests/state.test.mjs` → FAIL（找不到 `i18n.js`；`initialState.lang` 為 undefined）。
- [ ] **Step 4:** 實作 `web/src/i18n.js` 與 `state.js` 的修改（`initialState` 的註解改為「開場，只接受 start 與 setLang」）。
- [ ] **Step 5:** `npm test` → `# fail 0`（較起點多 13 項＋Task 1、2 的新增數）；`npm run e2e` → `# fail 0`；殘留 Chrome 檢查。
- [ ] **Step 6: Commit**

```bash
git add web/src/i18n.js web/src/state.js tests/i18n.test.mjs tests/state.test.mjs
git commit -m "feat: 介面文字表與語言狀態" -- web/src/i18n.js web/src/state.js tests/i18n.test.mjs tests/state.test.mjs
```

### Task 4: 介面接線與語言切換鈕

**Files:**
- Create: `web/src/ui/lang-switch.js`、`tests/e2e/lang.e2e.mjs`
- Modify: `web/src/main.js`、`web/src/labels.js:177-199`、`web/src/ui/panel.js`、`web/src/ui/list.js`、`web/src/ui/toolbar.js`、`web/src/ui/intro.js`、`web/src/ui/quiz-ui.js`、`web/styles.css`（`:195` 的 `attr(data-zh)` 改 `attr(data-name)`；新增 `.lang-switch` 規則）

**Interfaces:**
- Consumes（Task 3，`web/src/i18n.js`）：`LANGS`、`HTML_LANG = { zh: 'zh-Hant', en: 'en' }`、`LANG_LABELS = { zh: '中文', en: 'English' }`、`UI_TEXT`、`t(lang, key, vars)`（鍵：`title`、`loading`、`listTitle`、`toolbarLabel`、`quiz`、`explode`、`assemble`、`showNames`、`hideNames`、`closePanel`、`didYouKnow`、`quizProgress{n,total}`、`quizFind{name}`、`quizCorrect`、`quizWrong{picked,expected}`、`quizScore{score,total}`、`playAgain`、`endQuiz`、`fallback`、`loadFail`）、`readLang()`、`writeLang(lang)`、`organelleName(lang, id)`、`localizedOrganelle(lang, id) → { id, title, subtitle, tagline, body, fact }`、`introContent(lang)`；`state.js` 的 `initialState`（含 `lang: 'zh'`）與動作 `{ type: 'setLang', lang }`。Task 2：`ORGANELLES_EN`、`INTRO_EN`（`web/src/organelles.en.js`）。Task 1 在 `main.js` 加的 `updateCallout()`、`onBeforeRender`、`__cell.callout` 保持不動。
- Produces（Task 5 會用）：
  - `mountLangSwitch(container, { onChange }) → { el, setLang(lang) }`（`web/src/ui/lang-switch.js`）：在 container 尾端加 `<div class="lang-switch">`，依序兩顆 `<button type="button" data-lang="zh" lang="zh-Hant">中文</button>`、`<button type="button" data-lang="en" lang="en">English</button>`（文字取 `LANG_LABELS`，不隨語言變），`aria-pressed` 標目前語言；點非目前語言的鈕呼叫 `onChange(lang)`；永不 disabled。掛兩處：`#intro-card` 最後（`#intro-start` 之後）、`#toolbar` 最後（`#btn-quiz` 之後）。
  - `document.documentElement.lang` 隨語言為 `zh-Hant`／`en`；英文模式的 CSS 一律以 `html[lang="en"]` 開頭。
  - `mountPanel(root, { palette, onClose }) → { show(id), hide(), setLang(lang) }`：`show` 用 `localizedOrganelle`；`#panel-en` 文字 = subtitle，subtitle 為 null 時 `hidden`；`setLang` 更新關閉鈕 `aria-label`（`closePanel`）與 `.fact-label`（`didYouKnow`），面板顯示中就以新語言重寫內容（不重播淡入、`scrollTop = 0`）。
  - `mountList(root, { organelles, palette, onSelect }) → { focus(id), setActive(id), setNamesHidden(hidden), setLang(lang) }`：`setLang` 更新每顆 `.label` 文字、`data-name`（取代 `data-zh`）、名稱沒隱藏時的 `title`。
  - `mountToolbar(root, handlers)`：API 不變；`BUTTONS` 的 `on`／`off` 改存文字鍵（`assemble`／`explode`、`hideNames`／`showNames`、`quiz`／`quiz`），文字 `t(state.lang ?? 'zh', key)`。
  - `mountIntro(root, { intro, onStart }) → { hide(), dispose(), setContent(intro) }`：就地更新標題、各段、開始鈕文字（段數不同才重建段落），不重建卡片、不搬焦點。
  - `mountQuizUI(root, { onExit, onRetry }) → { showQuestion({ index, total, id }), showResult({ correct, expectedId, pickedId }), showSummary({ score, total }), hide(), setLang(lang) }`：記住最後一次的參數，`setLang` 以新語言重寫按鈕與目前顯示的進度、題目、結果或總結。
  - `createLabels(...)` 的回傳物件加 `setNames(nameOf)`：更新藥丸文字；可見時重新量大小（`sizes()`）、清掉每個 `prev`、立刻 `update()`。

- [ ] **Step 1: 寫 `tests/e2e/lang.e2e.mjs`（8 項）**——import `UI_TEXT`、`t`、`organelleName`、`LANG_KEY` 自 `../../web/src/i18n.js`，`ORGANELLES_EN`、`INTRO_EN` 自 `../../web/src/organelles.en.js`，`ORGANELLES`、`ORGANELLE_IDS`、`QUIZ_IDS`、`INTRO` 自 `../../web/src/organelles.js`；`sleep`、`READY`、`open`、`center`、`boot`、`clickSel`、`clickList`、`frames`、`settleCamera` 照抄 `tests/e2e/play.e2e.mjs:7-36`，`labelInfo`、`overlaps`、`assertNoOverlap` 照抄 `:98-117`，`visibleOther`、`textOf`、`quizId`、`progressText` 照抄 `:425-440`。`zhOf`、`enOf` = `organelleName('zh'|'en', id)`；`CJK` 同 Task 3。
  1. `L1 預設中文，不看瀏覽器語言與網址；開場卡片切到英文後開場文字、標題、html lang 改變，仍在開場階段`——用 `pathToFileURL(resolve('dist/plant-cell.html')).href + '?lang=en#en'` 開：html lang 'zh-Hant'、`document.title` '植物細胞'、`#intro .lang-switch button` 依序文字 ['中文', 'English']、`aria-pressed` ['true', 'false']（headless Chrome 的 `navigator.language` 是英文，仍是中文）。點 `#intro [data-lang="en"]`：`#intro-title` 'Plant Cell'、`.intro-text` 文字等於 `INTRO_EN.paragraphs`、`#intro-start` 'Start exploring'、html lang 'en'、title 'Plant Cell'、`#loading` 文字 'Loading…'、`store.getState().lang === 'en'`、phase 仍 'intro'、`lidOpen() === false`、`document.activeElement.dataset.lang === 'en'`、按鈕文字仍是 ['中文', 'English']。
  2. `L2 英文模式下清單、工具列、面板、滑過名稱、名稱標籤、aria 都是英文，畫面上沒有中文；切回中文完全還原`——boot 後點 `#toolbar [data-lang="en"]`：`#list-title` 'Cell structures'；20 顆 `#list button` 的 `.label`、`data-name`、`title` 都是 `enOf(id)`；`#toolbar` aria-label 'View tools'、`#quiz` aria-label 'Quiz'；`#btn-explode`/`#btn-labels`/`#btn-quiz` 為 'Explode'/'Show names'/'Quiz'，切換後 'Assemble'/'Hide names'；工具列的兩顆語言鈕 `disabled === false`、en 的 `aria-pressed` 'true'；點清單 nucleus：`#panel-title` 'Nucleus (nuclear envelope)'、`#panel-tagline`/`#panel-body`/`.fact-text` 等於 `ORGANELLES_EN.nucleus`、`.fact-label` 'Did you know?'、`#panel-close` aria-label 'Close description'、`#panel-en` 不可見；滑鼠移到 `screenPointOf('nucleus')`：`#hover-name` 為 `enOf('nucleus')`；按 `#btn-labels` 後名稱標籤每個藥丸文字 `enOf(id)`；`CJK.test(document.body.innerText.replaceAll('中文', ''))` 為 false。點 `#toolbar [data-lang="zh"]`：以上逐項回到中文（`#panel-en` 可見且文字 'Nucleus (nuclear envelope)'、html lang 'zh-Hant'、title '植物細胞'）。`page.requests` 沒有 file:／data:／blob: 以外的請求；`consoleErrors` 為 `[]`。
  3. `L3 重新整理後記住選擇`——開場切英文：`localStorage.getItem('plant-cell-lang') === 'en'`；`page.evaluate("document.documentElement.dataset.cellReady = ''; location.reload()")` 後 `waitFor(READY)`：html lang 'en'、`#intro-title` 'Plant Cell'、`store.getState().lang === 'en'`。再切回中文、重新整理：'zh-Hant'、'植物細胞'。
  4. `L4 切換時選取、拆解、名稱顯示保留，名稱標籤重新排版不重疊`——點清單 golgi、按 `#btn-explode`（等 `explodeProgress() === 1`）、按 `#btn-labels`、settle；切英文、frames(3)：`selected`、`exploded`、`labels`、`phase` 與切換前相同；`#panel-title` 'Golgi body'；可見藥丸文字為英文且 `assertNoOverlap` 通過；切回中文同樣檢查。
  5. `L5 測驗進行中與揭曉中切換：題目與計時不受影響，總結文字跟著換`——中文按 `#btn-quiz`，記下 `id0 = quizCurrentId()`；切英文：`#quiz-progress` 'Question 1 of 10'、`#quiz-question` `Find: ${enOf(id0)}`、`quizCurrentId() === id0`、`#quiz-exit` 'End quiz'、`#quiz-retry` 'Play again'。點 `visibleOther(page, id0)`：結果 `t('en','quizWrong',{ picked: enOf(other), expected: enOf(id0) })`；揭曉中切中文：結果變 `t('zh','quizWrong',…)`、`quiz.reveal` 不變，4 秒內進到 '第 2 題／共 10 題'。切英文，其餘 9 題用 `screenPointOf(id)`（null 就用 `visibleOther`）作答、每題等下一題；總結 `#quiz-summary` 符合 `/^You got (\d+) out of 10$/`，切中文後等於 `答對 ${n}／10 題`。
  6. `L6 localStorage 無法使用時以中文啟動、切換仍有效、沒有錯誤`——`initScript: "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });"`；前提：頁面內存取 `localStorage` 會丟錯；html lang 'zh-Hant'；開場切英文 → `#intro-title` 'Plant Cell'；start 後切回中文正常；`consoleErrors` 為 `[]`、除 `[materials]` 外沒有警告。
  7. `L7 記住英文時，WebGL 不可用與模型載入失敗的說明是英文`——兩頁各自開關：initScript 先寫入 en，再分別加 `HTMLCanvasElement.prototype.getContext = () => null` 與 `TextDecoder.prototype.decode = function () { throw new Error('測試用：解析失敗'); };`（同 `intro.e2e.mjs:214,236`）；`#fallback` 文字分別等於 `UI_TEXT.en.fallback`、`UI_TEXT.en.loadFail`，html lang 'en'。
  8. `L8 中文 narrow（390×800）：加了切換鈕的工具列仍是一列、不壓到取景範圍`——start 後與按過拆解、顯示名稱後各量一次：`#toolbar button` 的 top（四捨五入）只有一個值；`#toolbar` 下緣 ≤ `__cell.layout().rect.top + 0.5`；工具列完整在視窗內。
- [ ] **Step 2:** `npm run build && node --test --test-concurrency=1 tests/e2e/lang.e2e.mjs` → FAIL（找不到 `.lang-switch`）。
- [ ] **Step 3: 各介面模組**依 Produces 改 `panel.js`、`list.js`、`toolbar.js`、`intro.js`、`quiz-ui.js`、`labels.js`，新增 `lang-switch.js`。`quiz-ui.js`：進度 `t(lang,'quizProgress',{ n: index + 1, total })`、題目 `t(lang,'quizFind',{ name: organelleName(lang, id) })`、結果 `quizCorrect` 或 `quizWrong{picked,expected}`、總結 `quizScore`、按鈕 `playAgain`／`endQuiz`。
- [ ] **Step 4: `web/src/main.js`**
  - 刪掉 `const FALLBACK_TEXT`、`const LOAD_FAIL_TEXT`（`:27-28`）；`showFallback(e, key = 'fallback', what = '無法建立 WebGL')` 的說明改 `t(readLang(), key)`；`:461` 改 `showFallback(e, 'loadFail', '載入失敗')`（store 可能還沒建立，所以直接讀 localStorage）。
  - 新增模組層級 `applyDocumentText(lang)`：`documentElement.lang = HTML_LANG[lang]`、`document.title = t(lang,'title')`、`#loading` 文字 `loading`、`#list-title` 文字 `listTitle`、`#toolbar` 的 aria-label `toolbarLabel`、`#quiz` 的 aria-label `quiz`。`main()` 第一行呼叫 `applyDocumentText(readLang())`。
  - `const store = createStore()`（`:136`）改 `createStore({ ...initialState, lang: readLang() })`；`setLanguage(lang)` = `writeLang(lang)` 再 `store.dispatch({ type: 'setLang', lang })`。
  - `mountIntro` 與 `mountToolbar` 之後：`const langSwitches = [mountLangSwitch(#intro-card, { onChange: setLanguage }), mountLangSwitch(#toolbar, { onChange: setLanguage })]`。
  - 名稱一律 `organelleName(store.getState().lang, id)`：labels 的 `nameOf`（`:200`）、`paintHover`（`:257`）；`quizUI.showQuestion({ index, total, id: shownId })`（`:168`）、`quizUI.showResult({ correct, expectedId, pickedId: h.id })`（`:188`）；`panel.show(sel.id)`（`:340`）。
  - `render`：`prev` 初值加 `lang: null`；在 `document.body.dataset.phase = s.phase;` 之後、其他處理之前：`if (s.lang !== prev.lang)` 依序 `applyDocumentText`、`list.setLang`、`labels.setNames((id) => organelleName(s.lang, id))`、`panel.setLang`、`quizUI.setLang`、`intro.setContent(introContent(s.lang))`、每個 `langSwitches[i].setLang`、`paintHover()`、`view.resize()`（清單高度可能改變，重算保留帶與取景）。
- [ ] **Step 5: `web/styles.css`**：`:195` 改 `content: attr(data-name)`；`.lang-switch` 兩顆並排，`aria-pressed="true"` 的樣子比照 `#toolbar button.active`（`:236-241`）；在 `#intro-card` 置中於開始鈕下方；在工具列沿用 `#toolbar button` 的尺寸。中文模式其他樣式不改。
- [ ] **Step 6:** 單檔端對端 → `# pass 8`；`npm test` → `# fail 0`；`npm run e2e` → `# fail 0`（既有 43 項＋Task 1 的 5 項＋8 項）；殘留 Chrome 檢查。
- [ ] **Step 7: Commit**

```bash
git add web/src/main.js web/src/labels.js web/src/ui/lang-switch.js web/src/ui/panel.js web/src/ui/list.js web/src/ui/toolbar.js web/src/ui/intro.js web/src/ui/quiz-ui.js web/styles.css tests/e2e/lang.e2e.mjs
git commit -m "feat: 語言切換與英文介面" -- web/src/main.js web/src/labels.js web/src/ui/lang-switch.js web/src/ui/panel.js web/src/ui/list.js web/src/ui/toolbar.js web/src/ui/intro.js web/src/ui/quiz-ui.js web/styles.css tests/e2e/lang.e2e.mjs
```

### Task 5: 英文模式的版面、截圖檢查與 README

**Files:**
- Create: `tests/e2e/layout-en.e2e.mjs`
- Modify: `web/styles.css`（只新增 `html[lang="en"] …` 覆寫與 `.intro-body` 規則）、`web/src/ui/intro.js`（段落包進 `<div class="intro-body">`）、`README.md:6-10,27`

**Interfaces:**
- Consumes：Task 4 的 DOM 與 API——`.lang-switch > button[data-lang="zh"|"en"]`（在 `#intro-card` 最後與 `#toolbar` 最後）、`html[lang="en"]`、`mountIntro(...).setContent(intro)`（改結構後仍要能就地更新段落）、`#list button[data-name]`；Task 3 的 `t(lang, key, vars)`、`organelleName(lang, id)`、`UI_TEXT`；Task 2 的 `ORGANELLES_EN`；`__cell.layout() → { mode, width, height, rect }`、`__cell.stats().fps`。
- Produces：無（最後一個任務）。

可調的地方（計畫的決定：只准動這些，全部以 `html[lang="en"]` 開頭；中文樣式不動）：
- 面板內文（`#panel` 的 font-size 與 line-height，影響 tagline、body、fact）字級不小於 13px；wide 版面的面板寬度最多 380px（`html[lang="en"] body[data-layout="wide"] #panel`）。
- 名稱標籤藥丸字級不小於 12px、左右內距不小於 7px（只在 E2 不過時才調）；排版與捨棄規則（`labels.js`）不改。
- `.lang-switch` 與工具列在 narrow／short 的內距（左右不小於 6px）、間距（不小於 3px）與 narrow 工具列 `max-width`（最多 `calc(100vw - 16px)`）。
- 測驗結果文字（`#quiz-result`）字級不小於 13px。
- 開場卡片：`#intro-card` 改成直向 flex，`.intro-body`（包住所有 `.intro-text`）在放不下時於卡片內捲動，標題、`#intro-start` 與 `.lang-switch` 一直看得到（計畫的決定：規格要「看得到 Start exploring 與切換鈕」又要「文字放不下時在卡片內捲動」，所以只讓段落捲動）。這個結構改動中英都套用，既有中文開場測驗必須照過。

- [ ] **Step 1: 寫 `tests/e2e/layout-en.e2e.mjs`（8 項：E1、E2、E3 各 1，E4 兩個尺寸、E5 三個尺寸）**——import `ORGANELLE_IDS`、`QUIZ_IDS`（`web/src/organelles.js`）與 `t`、`organelleName`（`web/src/i18n.js`）；`sleep`、`READY`、`open(width, height, options)`、`info`、`center`、`overlaps`、`inside`、`COLLECT_WALL`、`WALL_BOUNDS`、`startAndSettle`、`checkIntro`、`checkUi`、`pillsOf`、`frames`、`clickCenter` 照抄 `tests/e2e/layout.e2e.mjs:7-111`（`open` 多收 `options` 傳給 `openPage`）；`EN = { initScript: "try { localStorage.setItem('plant-cell-lang', 'en'); } catch {}" }`。每項結束 `assert.deepEqual(page.consoleErrors, [])`。
  1. `E1 English wide 1280×800：清單不超過三列且不截斷，壁在可用範圍內（載入即英文、執行中切換兩種）`——(a) 以 EN 開、`COLLECT_WALL`、start：`#list button` 的 top 不同值 ≤ 3 個；每顆按鈕 `scrollWidth ≤ clientWidth` 且在 `#list-wrap` 矩形內；`WALL_BOUNDS` 在 `layout().rect` 內（容差 1）且下緣 ≤ 清單上緣；`checkUi`；截圖 `assets/preview/web-en-wide.png`。(b) 不帶 EN 開、`COLLECT_WALL`、start 後 4 秒內點 `#toolbar [data-lang="en"]`、settle：`layout().rect.bottom` 不大於切換前，壁仍在新的可用範圍內且下緣 ≤ 清單上緣。
  2. `E2 English wide 1280×800：一般狀態的名稱標籤數不比中文少 4 個以上`——不帶 EN 開、start、按 `#btn-labels`、frames(3)：記中文可見藥丸數 `nZh`；立刻點英文、frames(3)：`nEn`；印出兩數；`nEn ≥ nZh − 3`；藥丸不重疊、不蓋清單與工具列；截圖 `web-en-wide-labels.png`。
  3. `E3 English wide 1280×800：20 則面板都捲得到底，需要捲動的不超過 8 則；字級與寬度在範圍內；fps ≥ 50`——以 EN 開、start；依 `ORGANELLE_IDS` 逐一點清單、等 `#panel-title` 為英文名、frames(2)：`scrollHeight > clientHeight + 1` 記為需要捲動；`scrollTop = scrollHeight` 後最後一個可見子元素（fact 顯示時是 `#panel-fact`，否則 `#panel-body`）下緣 ≤ 面板下緣 + 1；`checkUi`；`#panel-body` 計算後字級 ≥ 13px、面板寬度 ≤ 380。印出 `en panel scroll <數量> <id 清單>`，斷言數量 ≤ 8。最後選 nucleus、`sleep(1500)`、`stats().fps ≥ 50`。截圖 `web-en-wide-panel.png`。
  4. `E4 English short（900×420）與 narrow（390×800）：工具列不溢出、不壓到取景範圍；最長答錯訊息不被裁切`（兩個尺寸各一項，用 for 迴圈）——以 EN 開、start；未切換時與按過 `#btn-explode`（Assemble）、`#btn-labels`（Hide names）後各量：`#toolbar` 完整在視窗內、`checkUi`；narrow 再加 `#toolbar` 下緣 ≤ `layout().rect.top + 0.5`。關掉兩者後進測驗，把 `#quiz-result` 設成 `data-state="wrong"`、文字 `t('en','quizWrong',{ picked, expected })`（picked、expected 取 `QUIZ_IDS` 英文名最長的兩個：Nucleus (nuclear envelope) 與 Cisternal rough ER），其餘斷言照抄 `layout.e2e.mjs:392-400`。截圖 `web-en-<layout>.png`、`web-en-quiz-longest-<layout>.png`。
  5. `E5 English 開場卡片（1280×800、900×420、390×800）：Start exploring 與切換鈕看得到、點得到，文字在卡片內捲得到底`（三個尺寸各一項）——以 EN 開：`#intro-start` 文字 'Start exploring'；它與兩顆 `#intro .lang-switch button` 都完整在視窗內與 `#intro-card` 矩形內，且 `elementFromPoint(中心)` 落在自己身上；`.intro-body` 的 `scrollHeight > clientHeight` 時捲到底，最後一段下緣 ≤ `.intro-body` 下緣 + 1。截圖 `web-en-intro-<layout>.png`。
- [ ] **Step 2:** `npm run build && node --test --test-concurrency=1 tests/e2e/layout-en.e2e.mjs` → 記下哪些紅燈（預期至少 E3 或 E5 會紅；已綠的照記）。
- [ ] **Step 3:** 只用上列可調的地方與 `.intro-body` 結構調整到全綠；動到字級時優先動 line-height，再動字級。調不過就停下回報（附量到的數字），不放寬斷言。
- [ ] **Step 4: 截圖檢查**：用 Read 逐張看 `assets/preview/web-en-*.png`，回報文字截斷、重疊、引線位置異常，以及 E1 列數、E2 `nZh`／`nEn`、E3 需要捲動的則數與 id。
- [ ] **Step 5: README**：「使用」（`:8-10`）第二點改為「拖曳旋轉、滾輪縮放；點細胞裡的構造或下方清單，會發亮並顯示介紹，介紹卡片有一條線指向那個構造。」，並新增一點「開場卡片與工具列最後面有「中文／English」兩顆按鈕，可隨時切換語言；選擇會記在這個瀏覽器裡。」；`:27` 的「約 4 分鐘」改成這次 `npm run e2e` 實際花的分鐘數（四捨五入）。
- [ ] **Step 6:** `npm test` → `# fail 0`；`npm run e2e` → `# fail 0`（43＋5＋8＋8 項）；殘留 Chrome 檢查。
- [ ] **Step 7: Commit**

```bash
git add web/styles.css web/src/ui/intro.js README.md tests/e2e/layout-en.e2e.mjs
git commit -m "feat: 英文模式版面調整與 README" -- web/styles.css web/src/ui/intro.js README.md tests/e2e/layout-en.e2e.mjs
```

## 規格對照（Self-Review）

| 規格 | 實作 | 驗證 |
|---|---|---|
| 3 元素、圖層、pointer-events、aria-hidden | T1 Step 7 | T1 e2e 1 |
| 3 線與圓點比照 `.leader`／`.anchor-dot` | T1 Step 7 | T1 e2e 1（stroke、r、fill） |
| 3 起點 wide／short、narrow、夾在面板內 | `calloutGeometry` | T1 單元 1–3；e2e 1、4、5 |
| 3 終點規則（清單、點選個體、代表個體、外殼類） | `calloutTargetOf` | T1 單元 9；e2e 2 |
| 3 顯示條件（explore、選取＋面板、鏡頭前方、內縮 4、不在面板內、≥ 12） | `calloutGeometry`＋`updateCallout` | T1 單元 4–7；e2e 1、3 |
| 3 每格更新、沒變不寫 DOM | `onBeforeRender`、`draw` | T1 e2e 2（旋轉、拉近、縮放、拆解）、e2e 1（MutationObserver） |
| 3 取消選取、測驗、開場隱藏；名稱標籤並存；`__cell.callout()` | T1 Step 7 | T1 e2e 1、3 |
| 4.1 `lang`、`setLang`、任何階段可切、走 `render` | T3、T4 Step 4 | T3 state 單元；T4 L1、L2、L5 |
| 4.1 切換保留階段、選取、拆解、名稱、測驗進度 | T4 Step 4 | T4 L4、L5 |
| 4.1 localStorage `plant-cell-lang`、try/catch、不看瀏覽器語言與網址 | `readLang`／`writeLang` | T3 單元；T4 L1、L3、L6 |
| 4.1 切換鈕兩處、固定文字、`aria-pressed` | `lang-switch.js` | T4 L1、L2 |
| 4.1 `<html lang>`、`<title>`；英文面板、清單、標籤、滑過、測驗用英文名 | T4 | T4 L1、L2、L5 |
| 4.2 介面文字定稿、FALLBACK／LOAD_FAIL | `UI_TEXT` | T3 單元；T4 L2、L5、L7 |
| 4.3 英文內容各條 | `organelles.en.js` | T2 單元 10 項＋逐句審查 |
| 4.4 清單、面板、標籤、測驗、開場、工具列 | T5 | T5 E1–E5；T4 L8 |
| 5 既有測試、單一檔離線、無外部請求、fps、語言不互相污染 | 各任務最後一步 | 全套 e2e；T4 L2；T1 e2e 1、T5 E3；Global Constraints 端對端隔離 |
