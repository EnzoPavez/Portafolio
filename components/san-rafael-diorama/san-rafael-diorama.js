/**
 * <san-rafael-diorama> — Diorama isométrico animado de San Rafael, Mendoza (Argentina).
 *
 * Uso como Web Component (cualquier framework o HTML plano):
 *   <script type="module" src="./san-rafael-diorama.js"></script>
 *   <san-rafael-diorama style="height: 70vh"></san-rafael-diorama>
 *
 * Atributos:
 *   static   → renderiza un único cuadro, sin animación.
 *
 * Variables CSS:
 *   --diorama-bg  → fondo del componente (por defecto transparente).
 *
 * Uso imperativo (React, Vue, etc.):
 *   import { createSanRafaelDiorama } from './san-rafael-diorama.js';
 *   const app = createSanRafaelDiorama(containerElement);
 *   app.dispose();
 *
 * Requiere `three` resuelto como módulo (import map o bundler).
 */
import * as THREE from 'three';
import { LOOP, Batch, disposeMaterialCache } from './utils.js';
import { BASE } from './layout.js';
import { buildGroundTexture, buildGround, buildMountainGeometry, buildSkirtGeometry, addSkirtRocks, buildWater } from './terrain.js';
import { addVineyards, buildPoplars, addTrees, addDetails } from './flora.js';
import { buildStructures } from './buildings.js';
import { buildActors, disposeActorMaterials, CONDOR } from './actors.js';

const AZIMUTH = THREE.MathUtils.degToRad(38);
const ELEVATION = THREE.MathUtils.degToRad(31);

function floorShadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, 'rgba(40,35,25,0.34)');
  gr.addColorStop(0.55, 'rgba(40,35,25,0.14)');
  gr.addColorStop(1, 'rgba(40,35,25,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}

export function createSanRafaelDiorama(container, options = {}) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animate = options.animate ?? !reduceMotion;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.04;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Diorama animado de San Rafael, Mendoza: viñedos, álamos, río y montañas.');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  /* ---------------- Escena ---------------- */
  const scene = new THREE.Scene();

  const ao = [];
  const batch = new Batch();
  batch.addColored(buildMountainGeometry());
  batch.addColored(buildSkirtGeometry());
  addSkirtRocks(batch);
  addVineyards(batch);
  const poplars = buildPoplars(batch, ao);
  addTrees(batch, ao);
  addDetails(batch, ao);
  const structures = buildStructures(batch, ao);
  const staticMesh = batch.build(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86 }));

  const groundTex = buildGroundTexture(ao, renderer.capabilities.getMaxAnisotropy());
  const water = buildWater();
  const actors = buildActors(structures.house);
  scene.add(buildGround(groundTex), staticMesh, poplars.object, structures.group, water.group, actors.group);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(58, 46).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: floorShadowTexture(), transparent: true, depthWrite: false, toneMapped: false })
  );
  floor.position.set(1.5, -BASE - 1.4, -1);
  floor.renderOrder = -1;
  scene.add(floor);

  /* ---------------- Luces ---------------- */
  scene.add(new THREE.HemisphereLight('#eef6ff', '#b39b78', 1.45));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
  sun.position.set(-0.45, 0.8, 0.42).normalize().multiplyScalar(50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowMapSize ?? 2048, options.shadowMapSize ?? 2048);
  Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 25, bottom: -25, near: 10, far: 110 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.028;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#d6e4ff', 0.5);
  fill.position.set(30, 16, -12);
  scene.add(fill);

  /* ---------------- Cámara ortográfica fija ---------------- */
  const dir = new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  camera.position.copy(dir).multiplyScalar(120);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

  // Encuadre a partir de los vértices reales (las montañas no son una caja).
  const ext = { r0: Infinity, r1: -Infinity, u0: Infinity, u1: -Infinity };
  const pa = staticMesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pa.count; i += 3) {
    v.fromBufferAttribute(pa, i);
    const r = v.dot(right), u = v.dot(up);
    if (r < ext.r0) ext.r0 = r;
    if (r > ext.r1) ext.r1 = r;
    if (u < ext.u0) ext.u0 = u;
    if (u > ext.u1) ext.u1 = u;
  }
  // El cóndor vuela por encima de los picos: su órbita también entra en el encuadre.
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    v.set(CONDOR.x + Math.cos(a) * (CONDOR.rx + 0.7), CONDOR.y + 0.6, CONDOR.z + Math.sin(a) * (CONDOR.rz + 0.7));
    ext.u1 = Math.max(ext.u1, v.dot(up));
  }

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const cw = ext.r1 - ext.r0, ch = ext.u1 - ext.u0;
    const pad = 1.05;
    let hw, hh;
    if (cw / ch > aspect) {
      hw = (cw * pad) / 2;
      hh = hw / aspect;
    } else {
      hh = (ch * pad) / 2;
      hw = hh * aspect;
    }
    const cr = (ext.r0 + ext.r1) / 2, cu = (ext.u0 + ext.u1) / 2;
    Object.assign(camera, { left: cr - hw, right: cr + hw, top: cu + hh, bottom: cu - hh });
    camera.updateProjectionMatrix();
    if (!running) render(staticTime);
  }

  /* ---------------- Loop ---------------- */
  let raf = 0, running = false, elapsed = 0, last = 0;
  const staticTime = LOOP * 0.32;

  function render(t) {
    const T = (t % LOOP) / LOOP;
    water.update(T);
    poplars.update(T);
    structures.update(T);
    actors.update(T);
    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    elapsed += Math.min(0.1, (now - last) / 1000);
    last = now;
    render(elapsed);
  }

  function start() {
    if (running || !animate) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()));
  io.observe(container);
  resize();
  if (!animate) render(staticTime);

  return {
    renderer,
    scene,
    camera,
    start,
    stop,
    dispose() {
      stop();
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      });
      disposeMaterialCache();
      disposeActorMaterials();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export class SanRafaelDioramaElement extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display: block; position: relative; width: 100%; aspect-ratio: 16 / 10; background: var(--diorama-bg, transparent); }
        .stage { position: absolute; inset: 0; }
      </style>
      <div class="stage"></div>`;
    this._app = createSanRafaelDiorama(root.querySelector('.stage'), { animate: this.hasAttribute('static') ? false : undefined });
  }

  disconnectedCallback() {
    this._app?.dispose();
    this._app = null;
  }
}

if (!customElements.get('san-rafael-diorama')) customElements.define('san-rafael-diorama', SanRafaelDioramaElement);
