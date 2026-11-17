import {
  ACESFilmicToneMapping, DirectionalLight, HemisphereLight, PCFShadowMap,
  PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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

  // 依模型的中心與半徑推導預設鏡頭與主光陰影範圍；回傳鏡頭距離。
  function frame(center, radius) {
    const dist = Math.max(20, radius * 2.5);
    const dir = new Vector3(0.62, 0.48, 0.62).normalize();
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.minDistance = 7;
    controls.maxDistance = Math.max(36, dist * 1.8);
    camera.far = Math.max(200, dist * 4 + radius * 2);
    camera.updateProjectionMatrix();
    controls.update();

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
