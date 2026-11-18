import {
  ACESFilmicToneMapping, DirectionalLight, HemisphereLight, PCFShadowMap,
  PerspectiveCamera, PMREMGenerator, Scene, Sphere, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// 沿 dir 方向、看向 target 的透視鏡頭，求讓 8 個角都落在畫面內的最小距離再乘 margin。
// 純數學，不依賴 DOM 與 WebGL。corners 為 [x, y, z] 陣列；dir 不必先正規化。
export function fitDistance({ corners, target, dir, fovDeg, aspect, margin = 1.08 }) {
  const dirN = new Vector3(...dir).normalize();
  const fwd = dirN.clone().negate();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, fwd).normalize();
  const ty = Math.tan((fovDeg * Math.PI) / 360);
  const tx = ty * aspect;
  let need = 0;
  for (const c of corners) {
    const v = new Vector3(c[0] - target[0], c[1] - target[1], c[2] - target[2]);
    // 角的深度 = d - v·dir；要 |v·right| <= 深度·tx 且 |v·up| <= 深度·ty
    const p = v.dot(dirN);
    need = Math.max(need, p + Math.abs(v.dot(right)) / tx, p + Math.abs(v.dot(up)) / ty);
  }
  return need * margin;
}

// 依實際的點取景：沿 dir 方向、看向 target 的透視鏡頭，求最小距離，使這些點投影後的範圍放得進 rect（畫布像素座標，
// 原點在左上）並留白 margin；再算出把範圍中心對到 rect 中心所需的畫面平移量（像素，內容往右、往下為正）。
// 呼叫端用 camera.setViewOffset(width, height, -offset.x, -offset.y, width, height) 套用平移。
// points：[x, y, z] 的陣列，或攤平的數字陣列／Float32Array。純數學，不依賴 DOM 與 WebGL。
export function fitToRect({ points, target, dir, fovDeg, width, height, rect, margin = 1.04 }) {
  const flat = points.length > 0 && typeof points[0] === 'number';
  const n = flat ? points.length / 3 : points.length;
  const dirN = new Vector3(...dir).normalize();
  const fwd = dirN.clone().negate();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, fwd).normalize();
  const A = new Float64Array(n); // 沿右方的座標
  const B = new Float64Array(n); // 沿上方的座標
  const Z = new Float64Array(n); // 沿 dir（朝向鏡頭）的座標；深度 = 距離 − Z
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = (flat ? points[3 * i] : points[i][0]) - target[0];
    const y = (flat ? points[3 * i + 1] : points[i][1]) - target[1];
    const z = (flat ? points[3 * i + 2] : points[i][2]) - target[2];
    A[i] = x * right.x + y * right.y + z * right.z;
    B[i] = x * up.x + y * up.y + z * up.z;
    Z[i] = x * dirN.x + y * dirN.y + z * dirN.z;
    if (Z[i] > zMax) zMax = Z[i];
  }
  const f = height / (2 * Math.tan((fovDeg * Math.PI) / 360)); // 焦距（像素）；水平與垂直相同
  const rw = (rect.right - rect.left) / margin;
  const rh = (rect.bottom - rect.top) / margin;
  const extent = (d, out) => {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = f / (d - Z[i]);
      const x = A[i] * k, y = B[i] * k;
      if (x < a0) a0 = x; if (x > a1) a1 = x;
      if (y < b0) b0 = y; if (y > b1) b1 = y;
    }
    out.a0 = a0; out.a1 = a1; out.b0 = b0; out.b1 = b1;
    return Math.max((a1 - a0) / rw, (b1 - b0) / rh);
  };
  const e = {};
  let lo = zMax + 1e-6; // 鏡頭在所有點之前
  let hi = Math.max(lo + 1, 1);
  while (extent(hi, e) > 1 && hi < 1e7) hi = lo + (hi - lo) * 2;
  for (let it = 0; it < 48; it++) {
    const mid = (lo + hi) / 2;
    if (extent(mid, e) > 1) lo = mid; else hi = mid;
  }
  const distance = hi;
  extent(distance, e);
  // 影像座標：x 向右、y 向下；範圍中心對到 rect 中心
  const cx = width / 2 + (e.a0 + e.a1) / 2;
  const cy = height / 2 - (e.b0 + e.b1) / 2;
  return { distance, offset: { x: (rect.left + rect.right) / 2 - cx, y: (rect.top + rect.bottom) / 2 - cy } };
}

// getLayout()：回傳 { width, height, rect }——畫布的大小（CSS 像素）與留給模型的「可用範圍」（畫布座標）。
// 沒給就用整個視窗。每次視窗縮放與初始化時呼叫。
export function createScene(canvas, { getLayout = null } = {}) {
  const readLayout = () => {
    const l = getLayout ? getLayout() : null;
    if (l) return l;
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    return { width: w, height: h, rect: { left: 0, top: 0, right: w, bottom: h } };
  };
  let lay = readLayout();
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  // 環境光貼圖：three 在 WebGL context 恢復後不會重畫 PMREM 的內容（畫面會變暗），所以恢復時重新產生
  const buildEnvironment = () => {
    const pmrem = new PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    const target = pmrem.fromScene(env, 0.04);
    pmrem.dispose();
    env.dispose();
    const old = scene.environment;
    scene.environment = target.texture;
    if (old && old !== target.texture) old.dispose();
  };
  buildEnvironment();
  scene.environmentIntensity = 0.35;
  canvas.addEventListener('webglcontextrestored', buildEnvironment);

  // 暖色主光（唯一投影的燈），從掀開那一角的斜上方照入。
  const key = new DirectionalLight(0xFFE6C8, 2.6);
  const keyDir = new Vector3(9, 16, 7).normalize();
  key.position.copy(keyDir).multiplyScalar(30);
  scene.add(key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = 5; // PCFShadowMap 的柔化量：以陰影貼圖 texel 為單位的取樣半徑
  scene.add(key);

  // 冷色輪廓光：從背面斜後方勾出邊緣。
  const rim = new DirectionalLight(0xBFD4F2, 0.9);
  rim.position.set(-10, 6, -12);
  scene.add(rim);

  // 半球補光：暗部不至於全黑。
  scene.add(new HemisphereLight(0xFFF6E6, 0xA79877, 0.5));

  const camera = new PerspectiveCamera(36, 1, 0.1, 200);
  camera.position.set(0.62, 0.48, 0.62); // 暫時位置；實際距離由 frame() 依模型大小決定

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.5;
  controls.maxDistance = 36;
  controls.autoRotateSpeed = 0.6; // 搭配 update(dt)：每秒 2π/60 × 0.6 弧度 = 3.6 度（約 100 秒一圈），與更新率無關

  const dirDefault = new Vector3(0.62, 0.48, 0.62).normalize();
  let boxFramed = null;
  let extentFramed = null; // 鏡頭距離上限、遠平面、陰影範圍要涵蓋的外框（可大於 boxFramed，例如拆解時的殘影外殼）
  let userMoved = false;
  let fitMargin = 1.08; // 取景留白（fitDistance 的 margin）
  let pointsFramed = null; // 取景依據的實際點（攤平陣列）；沒有就用 boxFramed 的八個角
  let fitCache = null; // { distance, offset }：版面、取景外框或點改變時作廢
  const offCur = { x: 0, y: 0 }; // 目前套用的畫面平移（像素）
  const offTgt = { x: 0, y: 0 };
  controls.addEventListener('start', () => { userMoved = true; }); // 拖曳或滾輪縮放

  const cornersOf = (b) => {
    const out = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(x, y, z);
    return out;
  };
  // 目前外框與版面下的預設距離與畫面平移（快取；只在取景或版面改變時重算）
  function currentFit() {
    if (!fitCache) {
      const c = boxFramed.getCenter(new Vector3());
      fitCache = fitToRect({
        points: pointsFramed || cornersOf(boxFramed), target: c.toArray(), dir: dirDefault.toArray(), fovDeg: camera.fov,
        width: lay.width, height: lay.height, rect: lay.rect, margin: fitMargin,
      });
    }
    return fitCache;
  }
  const defaultDistance = () => Math.max(currentFit().distance, controls.minDistance);

  // 目前畫面長寬比下的預設鏡頭位置（不移動鏡頭）；供鏡頭動畫當終點。
  function defaultPose() {
    const target = boxFramed.getCenter(new Vector3());
    return { target, position: target.clone().addScaledVector(dirDefault, defaultDistance()) };
  }

  // 讓 extentFramed 完整入鏡所需的距離（使用者拉到最遠時要能看到整個模型）：以外框八個角、整個畫布計算
  function extentDistance() {
    const b = extentFramed;
    const c = b.getCenter(new Vector3());
    const corners = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) corners.push([x, y, z]);
    }
    return Math.max(fitDistance({
      corners, target: c.toArray(), dir: dirDefault.toArray(), fovDeg: camera.fov, aspect: camera.aspect, margin: fitMargin,
    }), controls.minDistance);
  }

  // 畫面平移：以 setViewOffset 把投影中心移動 (x, y) 像素；不影響鏡頭位置、旋轉中心與射線
  function applyViewOffset() {
    camera.setViewOffset(lay.width, lay.height, -offCur.x, -offCur.y, lay.width, lay.height);
    camera.updateProjectionMatrix();
  }
  function syncOffset(immediate) {
    const o = currentFit().offset;
    offTgt.x = o.x; offTgt.y = o.y;
    if (immediate) { offCur.x = o.x; offCur.y = o.y; applyViewOffset(); }
  }
  // 平移量在拆解／組合切換時往新值緩動，不要一格跳過去
  function stepOffset(dt) {
    const dx = offTgt.x - offCur.x, dy = offTgt.y - offCur.y;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
      if (dx !== 0 || dy !== 0) { offCur.x = offTgt.x; offCur.y = offTgt.y; applyViewOffset(); }
      return;
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 8);
    offCur.x += dx * k; offCur.y += dy * k;
    applyViewOffset();
  }

  function applyDefaultCamera() {
    const c = boxFramed.getCenter(new Vector3());
    const dist = defaultDistance();
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(dirDefault, dist);
    const ed = extentDistance();
    controls.maxDistance = Math.max(36, dist * 1.8, ed * 1.8);
    camera.far = Math.max(200, dist * 4 + extentFramed.getBoundingSphere(new Sphere()).radius * 2, ed * 4);
    camera.updateProjectionMatrix();
    syncOffset(true);
    controls.update();
    return dist;
  }

  let lightHalf = 0;
  // 依外框設定主光的陰影範圍；onlyGrow 為真時只放大不縮小。
  function fitLight(box, onlyGrow) {
    const sphere = box.getBoundingSphere(new Sphere());
    const center = sphere.center;
    const radius = sphere.radius;
    const half = radius * 1.1;          // 視錐半寬：罩住整個包圍球
    if (onlyGrow && half <= lightHalf) return;
    lightHalf = half;
    const lightDist = radius * 3;
    key.target.position.copy(center);
    key.position.copy(center).addScaledVector(keyDir, lightDist);
    const sc = key.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = Math.max(0.1, lightDist - radius * 1.2);
    sc.far = lightDist + radius * 1.2;
    sc.updateProjectionMatrix();
    key.shadow.radius = Math.max(2, 5 * (11 / half)); // 視錐變大時維持相近的世界尺度柔和度
    key.shadow.needsUpdate = true;
  }

  // 依模型外框推導預設鏡頭與主光陰影範圍；回傳鏡頭距離。呼叫即回到預設位置。
  // points（可省略）：取景依據的實際點；省略就用 box 的八個角。
  function frame(box, extent = box, margin = 1.08, points = null) {
    boxFramed = box.clone();
    fitMargin = margin;
    extentFramed = extent.clone();
    pointsFramed = points;
    fitCache = null;
    userMoved = false;
    const dist = applyDefaultCamera();
    fitLight(extent, false);
    return dist;
  }

  // 只換「預設位置」依據的外框（鏡頭不動）：defaultPose() 與視窗縮放重新取景之後都以它為準。
  // 拆解與組合切換時用：鏡頭由鏡頭動畫慢慢移過去，所以 maxDistance、far 與陰影範圍先只放大不縮小，
  // 動畫結束後由 frame() 套用精確值。
  function setFrameBox(box, extent = box, margin = 1.08, points = null) {
    boxFramed = box.clone();
    fitMargin = margin;
    extentFramed = extent.clone();
    pointsFramed = points;
    fitCache = null;
    syncOffset(false); // 畫面平移往新的外框緩動
    const ed = extentDistance();
    controls.maxDistance = Math.max(controls.maxDistance, 36, defaultDistance() * 1.8, ed * 1.8);
    camera.far = Math.max(camera.far, 200, ed * 4 + extent.getBoundingSphere(new Sphere()).radius * 2);
    camera.updateProjectionMatrix();
    fitLight(extent, true);
  }

  function resize() {
    lay = readLayout();
    const w = lay.width;
    const h = lay.height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCache = null;
    if (boxFramed && !userMoved) applyDefaultCamera(); // 使用者沒動過鏡頭才重新取景
    else if (boxFramed) syncOffset(true); // 鏡頭不動，只更新畫面平移（版面改變後可用範圍的中心不同）
    else applyViewOffset();
  }
  window.addEventListener('resize', resize);
  resize();

  // 只有可用範圍變了（畫布大小沒變，例如構造清單收合）時的重新取景：不像 resize() 讓平移一格跳到終點、
  // 沒動過鏡頭時連距離也跳，這裡鏡頭不動，平移交給 stepOffset 緩動，距離由呼叫端用鏡頭動畫處理。
  // 回傳 { atDefault: 鏡頭還在預設位置, scale: 新預設距離 ÷ 舊預設距離 }；畫布大小變了就改走 resize()（一律回 { false, 1 }）。
  function relayout() {
    if (!boxFramed) { resize(); return { atDefault: false, scale: 1 }; }
    const oldDist = defaultDistance();
    const w0 = lay.width, h0 = lay.height;
    const next = readLayout();
    if (next.width !== w0 || next.height !== h0) { resize(); return { atDefault: false, scale: 1 }; }
    lay = next;
    fitCache = null;
    const scale = defaultDistance() / oldDist;
    syncOffset(false);
    return { atDefault: !userMoved, scale };
  }

  function start(onFrame) {
    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      stepOffset(dt);
      controls.update(Math.min(dt, 0.1)); // 傳入經過的秒數，自轉速度才不隨更新率改變（上限避免分頁暫停後一次轉很多）
      renderer.render(scene, camera);
      if (onFrame) onFrame(dt);
    });
  }

  // 程式移動鏡頭（鏡頭動畫）不會觸發 OrbitControls 的 start 事件，由呼叫端明確標記，
  // 否則 resize() 會把鏡頭拉回預設位置。動畫回到預設位置後以 false 重設。
  function setUserMoved(v) { userMoved = !!v; }

  // 自轉繞目前目標點水平旋轉。開始自轉就視為「鏡頭已離開預設位置」，視窗縮放才不會把鏡頭拉回預設。
  function setAutoRotate(on) {
    controls.autoRotate = !!on;
    if (on) userMoved = true;
  }
  const isAutoRotating = () => controls.autoRotate;

  return {
    renderer, scene, camera, controls, start, resize, relayout, frame, setFrameBox, defaultPose, setUserMoved,
    setAutoRotate, isAutoRotating,
  };
}
