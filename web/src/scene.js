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

export function createScene(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

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
  controls.minDistance = 7;
  controls.maxDistance = 36;

  const dirDefault = new Vector3(0.62, 0.48, 0.62).normalize();
  let boxFramed = null;
  let userMoved = false;
  controls.addEventListener('start', () => { userMoved = true; }); // 拖曳或滾輪縮放

  function defaultDistance() {
    const b = boxFramed;
    const corners = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) corners.push([x, y, z]);
    }
    const c = b.getCenter(new Vector3());
    const d = fitDistance({
      corners, target: c.toArray(), dir: dirDefault.toArray(), fovDeg: camera.fov, aspect: camera.aspect,
    });
    return Math.max(d, controls.minDistance);
  }

  function applyDefaultCamera() {
    const c = boxFramed.getCenter(new Vector3());
    const dist = defaultDistance();
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(dirDefault, dist);
    controls.maxDistance = Math.max(36, dist * 1.8);
    camera.far = Math.max(200, dist * 4 + boxFramed.getBoundingSphere(new Sphere()).radius * 2);
    camera.updateProjectionMatrix();
    controls.update();
    return dist;
  }

  // 依模型外框推導預設鏡頭與主光陰影範圍；回傳鏡頭距離。呼叫即回到預設位置。
  function frame(box) {
    boxFramed = box.clone();
    userMoved = false;
    const sphere = box.getBoundingSphere(new Sphere());
    const center = sphere.center;
    const radius = sphere.radius;
    const dist = applyDefaultCamera();

    const half = radius * 1.1;          // 視錐半寬：罩住整個包圍球
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
    return dist;
  }

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (boxFramed && !userMoved) applyDefaultCamera(); // 使用者沒動過鏡頭才重新取景
  }
  window.addEventListener('resize', resize);
  resize();

  function start(onFrame) {
    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      controls.update();
      renderer.render(scene, camera);
      if (onFrame) onFrame(dt);
    });
  }

  return { renderer, scene, camera, controls, start, resize, frame };
}
