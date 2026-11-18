# 構造清單收合與細胞質選取呈現 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wide／short 版面底部的構造清單可以收合成一條標題列（取景平滑地跟著放大）；選取「細胞質」時它明顯上色、其他構造不褪色；清單的色點與選取外框在白底上看得見。

**Architecture:** store 新增 `listCollapsed`／`toggleList`；`render` 把它寫到 `body[data-list]` 與收合鈕，CSS 只在探索階段且非 narrow 時藏起 `#list`。清單高度使版面結果改變時呼叫新的 `view.relayout()`：畫面平移往新值緩動，並回報新舊預設距離的比例；鏡頭在預設位置就 `moves.home()`，被動過（非特寫）就用新的 `moves.scaleDistance(k)` 依比例平滑改距離。細胞質上色是 `highlight.js` 新增的 `tint` 漸變通道，數值取自 `config.js` 的 `CYTOPLASM_SELECTED`。

**Tech Stack:** three 0.187.0、esbuild 0.28.2、Node.js 22（`node --test`）、無介面 Chrome（`scripts/cdp.mjs` 的 `openPage`）。

**Spec:** `docs/superpowers/specs/2026-11-18-list-collapse-cytoplasm-design.md`

## Global Constraints

- 只在分支 feat/list-collapse-cytoplasm 上新增 commit；提交一律 `git add <明確路徑>` 再 `git commit -m … -- <同樣路徑>`；禁止 `git add -A`、裸 commit、reset、rebase、amend、squash、切到其他分支。
- 這個 repo 已公開在 GitHub（遠端 origin）：實作過程中禁止 `git push`、禁止任何 `gh` 指令；不得動 `main`、`gh-pages`、`backup/pre-public` 三個分支。
- 相依套件只有 three 與 esbuild，不得新增任何套件；不得改 `package.json` 的 dependencies。
- `dist/` 與 `assets/*.glb` 不進版控，不得提交；不需要也不得跑 `npm run model`（Blender）。
- 註解與 commit 訊息用繁體中文；程式識別字用英文。受版控的檔案與 commit 訊息不得出現本機絕對路徑（例如家目錄開頭的路徑）、使用者名稱或信箱。
- 既有行為與既有測試（單元 118 項、端對端 74 項）必須維持通過；文字表多兩個鍵，檢查鍵數的斷言可改數字（定稿表跟著補兩鍵），其他斷言不得放寬。清單展開時 1280×800 中文的可用範圍仍是 `{ left: 0, top: 16, right: 1280, bottom: 674 }`、預設鏡頭距離仍是 22.17。
- 既有測試依賴的固定值不得改：閒置自轉門檻 4 秒、測驗揭曉 1.8 秒、鏡頭方向 (0.62, 0.48, 0.62)、fov 36。
- TDD：先寫會失敗的測試、確認紅燈、再實作到綠燈。單元單檔 `node --test tests/<名稱>.test.mjs`、全套 `npm test`；端對端單檔 `npm run build && node --test --test-concurrency=1 tests/e2e/<名稱>.e2e.mjs`（只跑一項加 `--test-name-pattern="<片段>"`）；全套 `npm run e2e`（約 8–10 分鐘，背景執行或逾時設 600000 ms）。
- 每次建置或跑端對端之前，先「單獨」跑 `pgrep -fl 'chrome-profile/p-' || echo 無殘留`（不與別的指令寫在同一條），印出「無殘留」才繼續；跑完再查一次。有殘留就 `pkill -f 'chrome-profile/p-'` 後重查，仍有就停下回報。
- 背景常駐預覽伺服器（`node scripts/build.mjs --watch --serve`，5173 埠），原始碼一變就把 `dist/plant-cell.html` 重打包成未壓縮的開發版：不要關掉它；跑端對端前一定先 `npm run build`；測試進行中不要改原始碼。
- 端對端隔離：每個 `test()` 自己 `openPage`、在 `finally` 裡 `close()`，測試之間不得共用頁面；新 e2e 檔照抄既有檔的輔助函式（本專案慣例，各檔自帶）。上一輪就存在的 e2e 檔不要動，除非是規格允許的機械性調整（本計畫沒有這種需要）。
- 成品仍是單一檔 `dist/plant-cell.html`，離線可開、沒有外部請求。截圖存 `assets/preview/`（不進版控）。
- 行號以本分支起點 `f981ec7` 為準；任務依序 1→2，Task 1 改過的 `web/src/main.js`、`web/styles.css` 到 Task 2 時行號會位移，以引號裡的程式片段定位。每個任務只改自己 Files 列出的檔。

## Review Focus

1. 鏡頭被動過（拖曳＋拉近、閒置自轉）再收合 → 距離乘上新舊預設距離的比例、方向與目標不變、平滑；特寫中收合只平移；比例動畫中使用者一拖曳就停。→ Task 1 單元 camera-moves、端對端 L6–L8
2. 收合狀態下開始測驗 → 測驗中的保留帶與取景和展開時相同（卡片不蓋模型），結束後回到收合。→ Task 1 端對端 L2
3. 收合後視窗縮成 narrow 再放大 → narrow 清單一律展開、沒有收合鈕；回到 wide 仍是收合。→ Task 1 端對端 L3
4. 收合時開名稱標籤或選取構造 → 標籤與面板不蓋住收合後的清單。→ Task 1 端對端 L6、L8
5. 選取細胞質時滑鼠滑過其他構造 → 與沒有選取時一樣（自發光 +0.15、不褪色）。→ Task 2 端對端 C1

---

### Task 1: 構造清單可收合

**Files:**
- Modify: `web/src/state.js:4-17`、`web/src/i18n.js:15,37`、`web/src/ui/list.js`（檔尾新增 export）、`web/src/scene.js:282-294,321-324`、`web/src/camera-moves.js:46,68-71`、`web/src/main.js:20,184,375-377,444`、`web/template.html:22`、`web/styles.css:158-166,580,632`（另新增規則）
- Modify（測試）: `tests/state.test.mjs`（檔尾新增）、`tests/i18n.test.mjs:10-36`
- Create: `tests/camera-moves.test.mjs`、`tests/e2e/list-collapse.e2e.mjs`

**已核對的現況：** 保留帶 `band = listWrap.offsetHeight + (short ? 8 : 12) + 8`、`rect.bottom = max(16 + H·0.3, H − band)`（`main.js:76-77`），寫進 `--band`（`:87`，面板 max-height 用它）。只有 `layoutCtl.update()` 會重量清單高度，它只在 `view.resize()`（視窗縮放、`main.js:185`、切換語言 `:387`）與工具列 ResizeObserver（`:289-295`）被呼叫，清單變矮目前沒有東西重算。`view.resize()`（`scene.js:282-294`）不論 `userMoved` 都讓平移一格跳到終點（沒動過時連距離也跳），所以要新的 `relayout()`。平移緩動在 `stepOffset`（`scene.js:205-214`）；`moves.home()`（`camera-moves.js:39-46`）0.8 秒 easeOutCubic、每格重讀 `defaultPose()`，`begin` 會設 `userMoved = true`，結束時 `view.frame()` 重設；controls 的 `start` 事件（只有使用者拖曳、滾輪會發出）中止動畫（`:66`）。自轉一開始 `userMoved` 就是 true（`scene.js:315-318`）。測驗時清單由 CSS 隱藏（`styles.css:438`，`opacity: 0; visibility: hidden`，仍佔版面高度），不是 `hidden` 屬性。

**Interfaces:**
- Consumes: `layoutCtl.update() → { mode, width, height, rect }`、`layoutCtl.current`、`layoutKey(l)`、`isShellSel(sel)`（`main.js:56-94,286,150`）；`moves.home(opts?)`、`moves.busy`（`camera-moves.js:39,70`）；`t(lang, key)`（`i18n.js:59`）。
- Produces:
  - `initialState.listCollapsed = false`；動作 `{ type: 'toggleList' }` → `{ ...state, listCollapsed: !state.listCollapsed }`，intro／explore／quiz 都有效（寫在 `state.js:17` 的 intro 判斷之前）；其他動作一律不改它；不寫 localStorage。
  - `UI_TEXT.zh.collapseList = '收起構造清單'`、`UI_TEXT.zh.expandList = '展開構造清單'`、`UI_TEXT.en.collapseList = 'Collapse structure list'`、`UI_TEXT.en.expandList = 'Expand structure list'`（共 22 鍵）。
  - `web/src/ui/list.js`：`export function mountListToggle(button, { onToggle }) → { set(collapsed: boolean, lang: 'zh'|'en'): void }`——click 呼叫 `onToggle()`；`set` 只在值改變時寫 `aria-expanded = String(!collapsed)` 與 `aria-label = t(lang, collapsed ? 'expandList' : 'collapseList')`。
  - `view.relayout() → { atDefault: boolean, scale: number }`（`createScene` 回傳物件新增）：先記下舊版面的 `defaultDistance()`，再重讀版面；畫布寬高與前次相同時作廢取景快取、算新版面的 `defaultDistance()`、`syncOffset(false)`（平移交給 `stepOffset` 緩動，鏡頭不動），回傳 `{ atDefault: !userMoved, scale: 新 ÷ 舊 }`；新舊都用同一個取景外框（目前的拆解與否）。寬高變了就改走 `resize()`；沒有取景外框或改走 `resize()` 時回傳 `{ atDefault: false, scale: 1 }`。
  - `moves.scaleDistance(k: number, opts?: { duration?, ease? }): void`（`camera-moves.js`）：用既有的 `begin`，終點固定為「開始時的 `controls.target`、開始時的方向、長度 `clamp(開始長度 × k, controls.minDistance, controls.maxDistance)`」，預設 0.8 秒 easeOutCubic，沒有 onDone（`userMoved` 維持 true）；使用者拖曳或滾輪由既有的 `start` 監聽中止；程式本身不得發出 `start`。
  - DOM：`#list-wrap` > `#list-head`（新）> `#list-title` + `<button id="list-toggle" type="button" aria-controls="list" aria-expanded="true" aria-label="收起構造清單">`，其後才是 `#list`；`body[data-list="open"|"collapsed"]`。

- [ ] **Step 1: 單元測試（`tests/state.test.mjs` 檔尾 3 項；`tests/i18n.test.mjs` 改 2 處、新增 1 項；新檔 `tests/camera-moves.test.mjs` 2 項）**

```js
test('initialState.listCollapsed 是 false');  // equal(initialState.listCollapsed, false)
test('toggleList 在 intro、explore、quiz 階段都有效，只改 listCollapsed');
// const quiz = reduce(explore, { type: 'quizStart' }); 對 [initialState, explore, quiz] 的每個 s：a = reduce(s, { type: 'toggleList' })
// → a.listCollapsed === true；deepEqual({ ...a, listCollapsed: s.listCollapsed }, s)；reduce(a, { type: 'toggleList' }).listCollapsed === false；s.listCollapsed 仍是 false
test('其他動作不改 listCollapsed');
// createStore({ ...initialState, listCollapsed: true }) 依序 dispatch：start、select nucleus 0、hover vacuole 0、unhover、deselect、toggleExplode、toggleLabels、
// setLang en、quizStart、quizReveal golgi false、quizNext、quizExit、{ type: 'noop' }；每次之後 listCollapsed === true（訊息帶 action.type）
// i18n.test.mjs：ZH／EN 定稿（:10-29）各補 collapseList、expandList（值同 Interfaces）；:33 名稱「（20 個）」改「（22 個）」、:36 改 22
test('t：收合鈕的文字標籤中英都有');  // t('zh','collapseList') 與 'expandList'、t('en', 同兩鍵) 各 equal 上面四個字串
// camera-moves.test.mjs：camera = new PerspectiveCamera()，位置 = target (1, 2, 3) 加上方向 (0.6, 0, 0.8) × 10；controls = { target, minDistance: 2.5, maxDistance: 36,
//   update() {}, addEventListener(type, fn) { 記下 } }；moves = createCameraMoves({ camera, controls })
test('scaleDistance：0.8 秒平滑到開始長度 × k，方向與目標不變，結果夾在 min／max 之間');
// scaleDistance(0.8)；update(0.4) 後距離嚴格介於 8 與 10、busy 為真；再 update(0.4) 後距離 8（±1e-9）、busy 為假、方向與 (0.6, 0, 0.8) 內積 > 1 − 1e-9、target 仍是 (1, 2, 3)；
// 重設回 10 後 scaleDistance(0.1) 跑完是 2.5、scaleDistance(10) 跑完是 36
test('scaleDistance：controls 的 start 事件（使用者拖曳或縮放）立刻中止');
// scaleDistance(0.5)、update(0.2)；呼叫記下的 start 監聽 → busy 為假；記下鏡頭位置，再 update(0.4) 位置不變
```

- [ ] **Step 2:** `node --test tests/state.test.mjs tests/i18n.test.mjs tests/camera-moves.test.mjs` → `# fail 7`（state 2、i18n 3、camera-moves 2；「其他動作不改」本來就會過，是回歸防護）。
- [ ] **Step 3:** 實作 `state.js`、`i18n.js`、`camera-moves.js` 的 `scaleDistance`（`:46` 之後新增，`:68-71` 的回傳物件加上它）→ 同指令 `# fail 0`；`npm test` → `# pass 124`、`# fail 0`。
- [ ] **Step 4: 端對端 `tests/e2e/list-collapse.e2e.mjs`（9 項）**——輔助函式：`sleep`、`READY`、`info`、`center`、`overlaps`、`inside`、`COLLECT_WALL`、`WALL_BOUNDS`、`startAndSettle` 照抄 `tests/e2e/layout.e2e.mjs:7-69`（`open` 照抄 `:10-18` 並加第三個參數 `initScript = null` 傳給 `openPage`），`pillsOf`、`frames`、`clickCenter` 照抄 `:106-111`，`setInnerWidth` 照抄 `:305-308`；`EN_INIT` 照抄 `tests/e2e/final-fixes.e2e.mjs:8`；`camDistance` 照抄 `tests/e2e/select.e2e.mjs:406`。新寫：
  - `settled(page)`：`waitFor('!window.__cell.cameraBusy()', 5000)`＋`frames(page, 3)`＋`sleep(300)`。`rect(page)` = `(await page.evaluate('window.__cell.layout()')).rect`。`defDist(page)`：頁面內 `const p = window.__cell.view.defaultPose(); return p.position.distanceTo(p.target)`（目前版面的預設距離）。`camDir(page)`：`camera.position − controls.target` 的單位向量陣列；`target(page)`：`controls.target` 陣列。
  - `toggleSmoothly(page, n = 50)`：先在頁面裡建立 `window.__samples = new Promise(…)`（連續 n 個 rAF，每格記 `[camera.view.offsetX, camera.view.offsetY, camera.position.distanceTo(controls.target)]`）並立即回傳；接著 `clickCenter(page, '#list-toggle')`（真的滑鼠點，會重設閒置計時）；再 `await page.evaluate('window.__samples')`。回傳並 `console.log` `{ maxStep, total, dStart, dEnd, maxDStep }`：maxStep＝相鄰兩格 offsetX、offsetY 變化絕對值的最大者；total＝首尾平移變化取 x、y 較大者；maxDStep＝相鄰兩格距離變化絕對值的最大者。前幾格在點擊之前，點擊當下的一格跳動也量得到。
  - `smoothOk(r)`：`r.maxStep <= 6`、`r.total > 1`；若 `|r.dEnd − r.dStart| > 0.05` 則 `r.maxDStep <= 0.2 × |r.dEnd − r.dStart|`。

```js
for (const [W, H, mode] of [[1280, 800, 'wide'], [900, 420, 'short']])
  test(`L1 收合（${mode} ${W}×${H}）：清單只剩標題列、取景平滑放大；再按一次回到原值`);
// open → COLLECT_WALL → startAndSettle。展開時：#list-toggle shown、aria-expanded 'true'、aria-controls 'list'、aria-label '收起構造清單'；
//   R0 = rect、d0 = camDistance、w0 = info('#list-wrap')。wide：deepEqual(R0, { left: 0, top: 16, right: 1280, bottom: 674 })、|d0 − 22.17| < 0.01；
//   short：|w0.height − (info('#list').height + 14)| ≤ 0.5（標題列不比按鈕列高，展開高度不變）。
// 收合：r = toggleSmoothly → smoothOk(r)、r.dEnd < r.dStart − 0.05；settled 後：info('#list').shown false、#list-wrap 高 ≤ 44、中心 x 與 w0 相差 ≤ 1；
//   R1 = rect：R1.bottom > R0.bottom，left/top/right 與 R0 相同；WALL_BOUNDS 在 R1 內（誤差 1）且 wall.bottom ≤ #list-wrap.top + 0.5；
//   d1 = camDistance < d0 − 0.05 且與 defDist 相差 < 0.01；aria-expanded 'false'、aria-label '展開構造清單'；localStorage.length === 0；截圖 assets/preview/web-list-collapsed-${mode}.png
// 展開：r2 = toggleSmoothly → smoothOk(r2)；settled 後 deepEqual(rect, R0)、|camDistance − d0| < 0.01、#list shown、aria-expanded 'true'；consoleErrors []
test('L2 收合後進入測驗：測驗中的保留帶與展開時相同，結束後回到收合');
// 1280×800：R0、d0 → 點收合鈕、settled → R1、d1 → 點 #btn-quiz、等 phase 'quiz'、settled：deepEqual(rect, R0)、|dist − d0| < 0.01、
//   store.getState().listCollapsed === true、#list-wrap 的 visibility 'hidden' → 點 #quiz-exit、等 phase 'explore' 與 #list-wrap opacity '1'、settled：
//   deepEqual(rect, R1)、|dist − d1| < 0.01、#list 不 shown、aria-expanded 'false'
test('L3 narrow：沒有收合鈕且清單一律展開；wide 收合後縮成 narrow 再放大仍是收合');
// (a) 390×800：startAndSettle 後 #list-toggle 不 shown、#list shown；store.dispatch({ type: 'toggleList' })、frames：#list 仍 shown、rect 不變。
// (b) 另開 1280×800：點收合鈕、settled、R1；setInnerWidth(390)、frames(3)：body.dataset.layout 'narrow'、#list shown、#list-toggle 不 shown；
//   setInnerWidth(1280)、frames(3)：#list 不 shown、#list-toggle shown 且 aria-expanded 'false'、#list-wrap 高 ≤ 44、rect.bottom === R1.bottom
test('L4 英文：收合鈕的文字標籤，切換語言時跟著換');
// open(1280, 800, EN_INIT)：aria-label 'Collapse structure list' → 點收合鈕、settled：'Expand structure list'、#list-wrap 高 ≤ 44、
//   #list-title 文字 'Cell structures'、截圖 assets/preview/web-list-collapsed-en.png → 點 #toolbar [data-lang="zh"]、frames：
//   aria-label '展開構造清單'、#list 仍不 shown、#list-wrap 高 ≤ 44
test('L5 鍵盤與 aria：原生按鈕、排在清單按鈕之前、操作後焦點留在收合鈕');
// 1280×800：#list-wrap 內第一個 button 是 #list-toggle；tagName 'BUTTON'、type 'button'、tabIndex 0、未停用、aria-controls 'list' 且 #list 存在；
//   頁面內 focus() → activeElement 是它；click()（原生按鈕的 Enter／空白鍵就是觸發 click，比照 layout.e2e.mjs:355 的做法）→ aria-expanded 'false'、
//   store 的 listCollapsed true、activeElement 仍是它；再 click() → 'true'、焦點仍在它
test('L6 拖曳並拉近後收合：距離依比例、方向與目標不變、過程平滑；名稱標籤不蓋住清單');
// 1280×800：page.drag(640, 400, 820, 330)、settled；頁面內 camera.position.lerp(controls.target, 0.3)、controls.update()、settled；
//   d = camDistance、u = camDir、T = target、k0 = defDist → r = toggleSmoothly：r.maxStep ≤ 6、r.maxDStep ≤ 0.2 × |r.dEnd − r.dStart| → settled：
//   k = defDist ÷ k0；|camDistance − d·k| ≤ 0.01·d·k；u 與 camDir 的夾角 < 0.5 度；target 每個分量與 T 差 < 1e-6；rect.bottom > 674。
//   點 #btn-labels、frames、sleep(300)：pillsOf 每個都不與 #list-wrap 重疊；consoleErrors []
test('L7 閒置自轉開始後收合：距離變成新版面的預設距離');
// 1280×800：startAndSettle、d0 = camDistance；waitFor('window.__cell.autoRotating()', 8000)；r = toggleSmoothly → smoothOk(r) → settled：
//   |camDistance − defDist| < 0.01 × defDist（與 L1 的 d1 同一種量法）、camDistance < d0 − 0.05
test('L8 特寫中收合：距離不變、只平移；面板不蓋住收合後的清單');
// 1280×800：點清單 nucleus、settled；d = camDistance、T = target → r = toggleSmoothly：r.maxStep ≤ 6、r.total > 1、r.maxDStep < 0.01、|r.dEnd − d| < 0.01 → settled：
//   |camDistance − d| < 0.01、target 與 T 差 < 1e-6、#panel 不與 #list-wrap 重疊且 panel.bottom ≤ wrap.top + 0.5；consoleErrors []
```

- [ ] **Step 5:** 殘留檢查後 `npm run build && node --test --test-concurrency=1 tests/e2e/list-collapse.e2e.mjs` → `# fail 9`（多為找不到 `#list-toggle`）。
- [ ] **Step 6: 實作**
  - `web/template.html:22`：換成 Interfaces 的 `#list-head` 結構（`#list-title` 的文字與 id 不變，`applyDocumentText` 照舊只寫它的 textContent）。
  - `web/styles.css`：`#list-title`（:158-166）的 `margin: 0 0 5px` 移到新的 `#list-head`（flex、置中、與標題同一列），`#list-title` 改 `margin: 0`；short 的 `#list-title { margin: 0; flex: none; … }`（:580）中 flex 項目的角色改由 `#list-head` 承擔（標題保留 `white-space: nowrap`）；narrow 的 `margin-bottom: 8px`（:632）移到 `#list-head`，並新增 `body[data-layout="narrow"] #list-toggle { display: none; }`。新增 `body[data-phase="explore"][data-list="collapsed"]:not([data-layout="narrow"]) #list { display: none; }`，同條件下 `#list-head` 的下邊距為 0。`#list-toggle`：版面高度 ≤ 18px（＝標題行高，展開高度才不變；點擊範圍用 `::before` 擴到至少 24×24，不佔版面）；`[aria-expanded="true"]` 畫向下箭頭、`"false"` 畫向上箭頭，用 CSS 畫、不放文字；要有 `:focus-visible` 外框。
  - `web/src/ui/list.js`、`web/src/scene.js`：照 Interfaces 實作 `mountListToggle`、`relayout`。
  - `web/src/main.js`：`:20` import `mountListToggle`；`:184`（`mountList` 之後）`const listToggle = mountListToggle(document.getElementById('list-toggle'), { onToggle: () => store.dispatch({ type: 'toggleList' }) })`；`:375` 的 `prev` 加 `listCollapsed: false`；`:377` 之後依序：`document.body.dataset.list = s.listCollapsed ? 'collapsed' : 'open'`、`listToggle.set(s.listCollapsed, s.lang)`、`let reframe = null`，若 `s.listCollapsed !== prev.listCollapsed || s.phase !== prev.phase` 就 `const before = layoutKey(layoutCtl.current); if (layoutKey(layoutCtl.update()) !== before) reframe = view.relayout();`。`:444` 之後：`reframe` 存在且 `!moves.busy`（同一次 render 沒開始別的鏡頭動畫、也沒有進行中的）時，`reframe.atDefault` → `moves.home()`；否則若不是特寫（`!(s.selected && !isShellSel(s.selected))`）且 `|reframe.scale − 1| > 1e-6` → `moves.scaleDistance(reframe.scale)`；其餘只靠 `relayout` 的平移緩動。進入測驗、拆解的 `EXPLODE_MOVE`、取消選取已開始的動畫不蓋掉，它們每格重讀 `defaultPose()`，已用新版面。（計畫的決定：測驗中清單照展開的高度佔位，測驗取景與現在相同。）
- [ ] **Step 7:** 單檔端對端 → `# pass 9`、`# fail 0`；`npm test` → `# pass 124`；`npm run e2e` → `# pass 83`、`# fail 0`；跑完殘留檢查印「無殘留」。回報附三張截圖路徑與 L1、L6、L7 印出的距離與 maxStep。
- [ ] **Step 8: Commit**

```bash
git add web/src/state.js web/src/i18n.js web/src/ui/list.js web/src/scene.js web/src/camera-moves.js web/src/main.js web/template.html web/styles.css tests/state.test.mjs tests/i18n.test.mjs tests/camera-moves.test.mjs tests/e2e/list-collapse.e2e.mjs
git commit -m "feat: 構造清單可以收合，取景平滑跟著放大" -- web/src/state.js web/src/i18n.js web/src/ui/list.js web/src/scene.js web/src/camera-moves.js web/src/main.js web/template.html web/styles.css tests/state.test.mjs tests/i18n.test.mjs tests/camera-moves.test.mjs tests/e2e/list-collapse.e2e.mjs
```

### Task 2: 細胞質的選取呈現與清單可見度

**Files:**
- Modify: `web/src/config.js`（`:4` 之後新增常數）、`web/src/highlight.js:4,17-23,56,77-92,94-110,124-134`、`web/src/main.js`（`window.__cell` 物件，原 `:488-521`）、`web/styles.css`（`#list button .dot` 的 box-shadow，原 `:191`；`#list button.active` 的 box-shadow，原 `:199`）
- Create: `tests/e2e/cytoplasm.e2e.mjs`

**已核對的現況：** 細胞質只有 1 個個體（`cytoplasm_0`，inst 0、rep 1，錨點 `cytoplasm_0_anchor`）與 1 個網格 `cytoplasm_main`（part main，不在蓋子裡）；材質（`materials.js:13,52,73-74`）顏色 `#EDE6D3`（`shared/palette.json:5`）、opacity 0.12、transparent、depthWrite false、renderOrder 2、不投影；`pickable: false`（`organelles.js:41`），只能從清單或名稱標籤選、`inst` 一律 null，也不在測驗題目裡。`GHOST_IDS` 含 cytoplasm（`config.js:2`），所以目前選它時：未拆解 `shellsGhosted` 為 false（`highlight.js:72`），它自己是 `family`（自發光 +0.2、沒有呼吸，`:85-86`），其他所有構造（含另外三個外殼）都是 `dim`（往 `#D8D2C4` 混 0.7，`:87`）；拆解時它走 `:84`（+0.2＋呼吸、ghost 1、lift 1，0.12 低於上限 0.4 所以不透明度不變），其他外殼是殘影、非外殼是 dim。選取中按鈕既有的 box-shadow 是 `0 0 0 1.5px var(--c), 0 2px 8px rgba(60, 50, 30, 0.12)`（`styles.css:199`）。

**Interfaces:**
- Consumes: `createHighlighter(index)`（`main.js:168`，呼叫方式不變）。Task 1 沒有本任務要用的介面，只讓 `main.js`、`styles.css` 的行號位移。
- Produces:
  - `web/src/config.js`：`export const CYTOPLASM_SELECTED = { color: '#E8B95A', opacity: 0.38, emissive: 0.25 };`（主持人看截圖後可能改值；測試一律讀這個常數）
  - `createHighlighter(index)` 的回傳物件新增 `setCytoplasmLook(look: { color: string, opacity: number, emissive: number }): void`：換掉目前外觀（起始為 `CYTOPLASM_SELECTED`），細胞質的網格在下一次 `update()` 一定重寫材質。
  - `window.__cell.setCytoplasmLook(look)`（除錯與截圖用，轉呼叫 highlighter）。

- [ ] **Step 1: 端對端 `tests/e2e/cytoplasm.e2e.mjs`（4 項）**——`import { CYTOPLASM_SELECTED } from '../../web/src/config.js'`；`sleep`、`READY`、`open`、`center`、`boot`、`clickSel`、`clickList`、`frames`、`settleCamera` 照抄 `tests/e2e/final-fixes.e2e.mjs:6-37`（`EN_INIT` 不用）；`MESH_SNAP`、`meshSnap`、`sameSnap` 照抄 `tests/e2e/play.e2e.mjs:695-702`。新寫：`settle` = `settleCamera`＋`sleep(600)`（等 0.25 秒的漸變收斂）；`away(page)` = 滑鼠移到 `#list-title` 中心、`waitFor('window.__cell.store.getState().hovered === null')`；`hex(s) = parseInt(s.slice(1), 16)`；`same(now, ref, skip)` = 除 `skip` 以外每個 id 都 `sameSnap`，不同的 id 列在訊息裡。

```js
test('C1 選取細胞質：其他構造與未選取時相同（含滑過），細胞質等於 CYTOPLASM_SELECTED 且有呼吸；改選細胞核與直接選相同；取消後完全還原');
// boot、away、settle → base = meshSnap；前提 base.cytoplasm.length === 1。clickList nucleus、settle → refN = meshSnap。
// clickList cytoplasm、settle → now：same(now, base, 'cytoplasm')（訊息特別點名 nucleus、chloroplast、mitochondrion）；cytoplasm[0]：c === hex(CYTOPLASM_SELECTED.color)、
//   |op − CYTOPLASM_SELECTED.opacity| < 1e-6、tr === true；每 170 ms 取 cytoplasm 的 ei 共 6 次：都在 CYTOPLASM_SELECTED.emissive ± 0.06（再寬 1e-6）內，且最大減最小 > 0.02
// 滑過：p = window.__cell.screenPointOf('nucleus')（非 null）→ mouseMove、等 hovered?.id === 'nucleus'、sleep(600)：nucleus 每個網格 c 等於 base、
//   max(ei − base.ei) 與 0.15 差 < 1e-6 → away、sleep(600)
// clickList nucleus、settle → same(meshSnap, refN, null)（細胞質回到 0.12 的殘影、其他照常褪色）→ 點 #panel-close、等 selected null、settle → same(meshSnap, base, null)；consoleErrors []
test('C2 拆解狀態選取細胞質：同樣上色，其他構造與拆解未選取時相同');
// boot → clickSel('#btn-explode')、等 explodeProgress() === 1、away、settle → baseE = meshSnap → clickList cytoplasm、settle：
//   cytoplasm 的 c、op、tr 同 C1 的斷言；same(meshSnap, baseE, 'cytoplasm')；consoleErrors []
test('C3 清單：色點的 box-shadow 等於規格值；選取中按鈕保留構造色光環與陰影，外側多一圈深色外環');
// boot：20 個 #list button .dot 的計算後 boxShadow 都是 'rgba(52, 48, 42, 0.28) 0px 0px 0px 1px inset'；clickList cytoplasm、away、sleep(300)（transition 0.15 s）：
//   #list [data-id="cytoplasm"] 的 boxShadow 完全等於
//   'rgb(237, 230, 211) 0px 0px 0px 1.5px, rgba(52, 48, 42, 0.45) 0px 0px 0px 3px, rgba(60, 50, 30, 0.12) 0px 2px 8px 0px'、
//   borderTopColor 'rgb(237, 230, 211)'、fontWeight '650'；clickList nucleus、away、sleep(300)：nucleus 按鈕 boxShadow 完全等於
//   'rgb(163, 150, 184) 0px 0px 0px 1.5px, rgba(52, 48, 42, 0.45) 0px 0px 0px 3px, rgba(60, 50, 30, 0.12) 0px 2px 8px 0px'、
//   borderTopColor 'rgb(163, 150, 184)'、fontWeight '650'；cytoplasm 按鈕 boxShadow 'none'
test('C4 候選值截圖：三組外觀各一張，材質等於該組數值');
// boot、away、clickList cytoplasm；依序 ['a', { color: '#E8B95A', opacity: 0.38, emissive: 0.25 }]、['b', { color: '#E8B95A', opacity: 0.5, emissive: 0.25 }]、
//   ['c', { color: '#8FC3E8', opacity: 0.35, emissive: 0.25 }]：page.evaluate(`window.__cell.setCytoplasmLook(${JSON.stringify(look)})`)、away、settle：
//   cytoplasm 的 c === hex(look.color)、|op − look.opacity| < 1e-6；截圖 assets/preview/web-cytoplasm-${name}.png
```

- [ ] **Step 2:** 殘留檢查後 `npm run build && node --test --test-concurrency=1 tests/e2e/cytoplasm.e2e.mjs` → `# fail 4`（C1 其他構造褪色、C2 不透明度 0.12、C3 box-shadow 不符、C4 `setCytoplasmLook is not a function`）。
- [ ] **Step 3: 實作**
  - `web/src/highlight.js`：`ROLE_TARGET` 五個目標、每筆 rec 的 `cur` 與 `written`、`update()` 的「沒變就跳過」比較都多一個 `tint`（平常 0，用同一個 `approach` 漸變）。`targetOf` 在 `sel && sel.id === 'cytoplasm'` 時優先處理：細胞質的網格回傳 `{ emi: look.emissive + breath, fade: 0, ghost: 0, lift: 0, tint: 1 }`（拆解與否相同；計畫的決定：未拆解時原本沒有呼吸，兩種狀態都加上）；其他網格照「`sel` 為 null」的規則算（`shellsGhosted && isShell` → ghost，否則 normal，滑過照常 hover）。其他 id 的選取路徑與 `apply()` 的 `shellsGhosted` 公式都不改（選細胞質時它等於 `exploded`，與沒有選取時相同）。`write`：顏色在既有的 `lerp(DIM_COLOR, fade)` 之後再 `lerp(look 的 Color, tint)`（`emissive` 照舊複製顏色）；既有公式算出不透明度 `o` 後取 `o + (look.opacity − o) × tint`。`tint` 為 0 時結果與現在逐位元相同。
  - `web/src/config.js`、`setCytoplasmLook`、`window.__cell.setCytoplasmLook`：照 Interfaces。
  - `web/styles.css`：`#list button .dot` 的 `box-shadow` 換成 `inset 0 0 0 1px rgba(52, 48, 42, 0.28)`；`#list button.active` 的 `box-shadow` 改為 `0 0 0 1.5px var(--c), 0 0 0 3px rgba(52, 48, 42, 0.45), 0 2px 8px rgba(60, 50, 30, 0.12)`（既有兩層原樣保留，深色外環插在構造色光環之後、擴散 1.5 + 1.5 = 3px），`border-color`、背景、`font-weight: 650` 不變。
- [ ] **Step 4:** 單檔端對端 → `# pass 4`、`# fail 0`；`npm test` → `# pass 124`；`npm run e2e` → `# pass 87`、`# fail 0`；跑完殘留檢查印「無殘留」。
- [ ] **Step 5:** 常數維持規格的起始值（`#E8B95A`、0.38、0.25）；回報附三張候選截圖 `assets/preview/web-cytoplasm-a.png`（起始值）、`-b.png`（同色、0.5）、`-c.png`（`#8FC3E8`、0.35），由主持人看圖決定最後的常數（改常數不在本計畫內）。
- [ ] **Step 6: Commit**

```bash
git add web/src/config.js web/src/highlight.js web/src/main.js web/styles.css tests/e2e/cytoplasm.e2e.mjs
git commit -m "feat: 選取細胞質時明顯上色、其他構造不褪色，清單色點與選取外框加深色描邊" -- web/src/config.js web/src/highlight.js web/src/main.js web/styles.css tests/e2e/cytoplasm.e2e.mjs
```
