import {
  ACESFilmicToneMapping, DirectionalLight, HemisphereLight, PCFSoftShadowMap,
  PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, WebGLRenderer,
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
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  // 暖色主光（唯一投影的燈），從掀開那一角的斜上方照入。
  const key = new DirectionalLight(0xFFE6C8, 2.6);
  key.position.set(9, 16, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -11;
  key.shadow.camera.right = 11;
  key.shadow.camera.top = 11;
  key.shadow.camera.bottom = -11;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = 5;
  scene.add(key);

  // 冷色輪廓光：從背面斜後方勾出邊緣。
  const rim = new DirectionalLight(0xBFD4F2, 0.9);
  rim.position.set(-10, 6, -12);
  scene.add(rim);

  // 半球補光：暗部不至於全黑。
  scene.add(new HemisphereLight(0xFFF6E6, 0xA79877, 0.5));

  const camera = new PerspectiveCamera(36, 1, 0.1, 200);
  camera.position.set(0.62, 0.48, 0.62).normalize().multiplyScalar(20);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 36;

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

  return { renderer, scene, camera, controls, start, resize };
}
