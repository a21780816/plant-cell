# 互動式 3D 植物細胞

用 Blender 建模、three.js 顯示的葉肉細胞。成品是單一檔案 `dist/plant-cell.html`，
點兩下就能用 Chrome 離線開啟（不連網、不需要伺服器）。

**線上展示：<https://a21780816.github.io/plant-cell/>**（用瀏覽器直接開啟，不用安裝）

## 使用

- 開啟 `dist/plant-cell.html`，按「開始探索」掀開細胞壁。
- 拖曳旋轉、滾輪縮放；點細胞裡的構造或下方清單，會發亮並顯示介紹，介紹卡片有一條線指向那個構造。
- 開場卡片與工具列最後面有「中文／English」兩顆按鈕，可隨時切換語言；選擇會記在這個瀏覽器裡。
- 下方清單標題旁的箭頭可以收起清單，讓模型變大；再按一次展開。
- 工具列：「拆解」把構造散開、「顯示名稱」貼上標籤、「測驗」十題點選題。

## 重建

```
npm install        # 只有 three 與 esbuild 兩個套件
npm run model      # 產生模型 assets/plant_cell.glb（第一次建置或跑測試之前必做）
npm run build      # 把程式、樣式、模型打包成 dist/plant-cell.html
npm run dev        # 開發：監看檔案並在本機提供預覽
```
模型檔 `assets/plant_cell.glb` 不在版本控制裡：第一次建置或跑測試之前要先執行 `npm run model`（需要安裝在
`/Applications/Blender.app` 的 Blender 5.2.2）。重建是決定性的（固定亂數種子），每次產生的模型都一樣。

## 測試

```
npm test           # 單元測試（不需要瀏覽器）
npm run e2e        # 先建置，再用無介面 Chrome 跑端對端測試，約 9 分鐘
```

端對端測試需要 `/Applications/Google Chrome.app`；截圖存到 `assets/preview/`（不納入版本控制）。

## 線上展示頁

線上展示頁放在 `gh-pages` 分支，裡面只有打包好的 `index.html`（就是 `dist/plant-cell.html`）。
原始碼改了之後它不會自動更新，要重新建置，再把新的 `dist/plant-cell.html` 放成該分支的 `index.html`。

## 授權

[MIT](LICENSE)
