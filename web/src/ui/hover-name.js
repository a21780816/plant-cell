// 名稱標籤的位置：預設在游標右下方 gap 處；右邊放不下改到游標左邊、下面放不下改到游標上方；
// 結果一定完整落在視窗內（視窗比標籤小時貼齊左上）。純函式，不依賴 DOM。
export function placeHoverName({ x, y, width, height, viewportWidth, viewportHeight, gap = 14 }) {
  let left = x + gap;
  if (left + width > viewportWidth) left = x - gap - width;
  let top = y + gap;
  if (top + height > viewportHeight) top = y - gap - height;
  left = Math.max(0, Math.min(left, viewportWidth - width));
  top = Math.max(0, Math.min(top, viewportHeight - height));
  return { left: Math.max(0, left), top: Math.max(0, top) };
}
