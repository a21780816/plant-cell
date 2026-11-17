import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, candidateOrder, nearestDir, dirVector, DISTANCES } from '../web/src/labels.js';

const VIEW = { width: 1280, height: 800 };
const item = (o = {}) => ({ ax: 640, ay: 400, w: 80, h: 22, ox: 1, oy: 0, ...o });
const rectOf = (it, p) => ({ left: p.x - it.w / 2, right: p.x + it.w / 2, top: p.y - it.h / 2, bottom: p.y + it.h / 2 });
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test('往外的方向優先：標籤落在錨點「遠離模型中心」的那一側', () => {
  for (const [ox, oy, sx, sy] of [[1, 0, 1, 0], [-1, 0, -1, 0], [0, -1, 0, -1], [0, 1, 0, 1]]) {
    const it = item({ ox, oy, w: 60 });
    const [p] = layoutLabels([it], VIEW);
    assert.ok(p);
    assert.equal(Math.sign(p.x - it.ax), sx);
    assert.equal(Math.sign(p.y - it.ay), sy);
  }
  assert.equal(nearestDir(1, 0), 0);
  assert.equal(nearestDir(0, 1), 2);
  assert.equal(nearestDir(0, 0), 6);
  const order = candidateOrder(1, 0);
  assert.equal(order.length, 32);
  assert.deepEqual(order[0], { dir: 0, dist: 0 }, '最近的距離、往外的方向最先');
  assert.deepEqual(order.slice(0, 3).map((c) => c.dir), [0, 1, 7], '往兩側展開');
  assert.ok(order[8].dist === 1, '距離由近到遠');
});

test('重疊時改用下一個候選：兩個錨點相同，後面的不與前面的重疊', () => {
  const a = item();
  const b = item();
  const out = layoutLabels([a, b], VIEW);
  assert.ok(out[0] && out[1]);
  assert.equal(overlap(rectOf(a, out[0]), rectOf(b, out[1])), false);
  assert.notDeepEqual(out[0].cand, out[1].cand);
  assert.equal(out[0].cand.dist <= out[1].cand.dist, true, '先放的標籤拿到較近的候選');
});

test('藥丸不蓋住任何標籤的錨點圓點，也不蓋住自己的', () => {
  const a = item({ ax: 640, ay: 400 });
  const b = item({ ax: 640 + DISTANCES[0], ay: 400 }); // 剛好在 a 的第一候選位置上
  const out = layoutLabels([a, b], VIEW);
  const dot = (it) => ({ left: it.ax - 3, right: it.ax + 3, top: it.ay - 3, bottom: it.ay + 3 });
  assert.equal(overlap(rectOf(a, out[0]), dot(b)), false);
  assert.equal(overlap(rectOf(a, out[0]), dot(a)), false);
  assert.equal(overlap(rectOf(b, out[1]), dot(a)), false);
});

test('介面矩形（面板、清單、工具列）當障礙物', () => {
  const it = item({ w: 60 });
  const wall = { left: 640 + 20, right: 1280, top: 0, bottom: 800 };
  const [p] = layoutLabels([it], { ...VIEW, obstacles: [wall] });
  assert.ok(p);
  assert.equal(overlap(rectOf(it, p), wall), false);
});

test('全部候選都不合格就隱藏（回傳 null）；null 的項目維持 null', () => {
  const tiny = { width: 60, height: 20 }; // 放不下任何候選
  assert.deepEqual(layoutLabels([item({ ax: 30, ay: 10 })], tiny), [null]);
  assert.deepEqual(layoutLabels([null, item()], VIEW).map((x) => x === null), [true, false]);
});

test('超出視窗的候選不合格：靠邊的錨點會改往內側', () => {
  const it = item({ ax: 1270, ay: 400, ox: 1, oy: 0, w: 70 });
  const [p] = layoutLabels([it], VIEW);
  assert.ok(p);
  const r = rectOf(it, p);
  assert.ok(r.left >= 0 && r.right <= 1280 && r.top >= 0 && r.bottom <= 800);
  assert.ok(p.x < it.ax);
});

test('沿用上一格採用的候選：仍合格就不換，不合格才重選', () => {
  const it = item();
  const prev = { dir: 3, dist: 2 };
  const [p] = layoutLabels([it], { ...VIEW, prev: [prev] });
  assert.deepEqual(p.cand, prev, '上一格的候選仍合格就沿用，即使它不是第一順位');
  const [vx, vy] = dirVector(3);
  assert.ok(Math.abs(p.x - (it.ax + vx * DISTANCES[2])) < 1e-9 && Math.abs(p.y - (it.ay + vy * DISTANCES[2])) < 1e-9);
  const wall = { left: 0, right: 640, top: 0, bottom: 800 }; // 上一格的位置（錨點左下）現在被擋住
  const [q] = layoutLabels([it], { ...VIEW, obstacles: [wall], prev: [prev] });
  assert.notDeepEqual(q.cand, prev);
  assert.ok(q.x > 640);
});
