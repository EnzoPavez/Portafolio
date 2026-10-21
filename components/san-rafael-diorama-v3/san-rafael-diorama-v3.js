/**
 * <san-rafael-diorama-v3> — Diorama isométrico animado de San Rafael, Mendoza (Argentina).
 * v3: igual que la v2 + Vendimia (carro alegórico y banderines), multitud instanciada y calidad automática según los FPS.
 *
 * Uso como Web Component (cualquier framework o HTML plano):
 *   <script type="module" src="./san-rafael-diorama-v3.js"></script>
 *   <san-rafael-diorama-v3 style="height: 70vh"></san-rafael-diorama-v3>
 *
 * Atributos:
 *   static   → renderiza un único cuadro, sin animación.
 *   nosound  → oculta el botón de sonido ambiente (por defecto el sonido está apagado).
 *   quality  → "auto" (por defecto: baja la calidad sola si caen los FPS), "high" o "low".
 *
 * Variables CSS:
 *   --diorama-bg    → fondo del componente (por defecto transparente).
 *   --diorama-fade  → color en el que se pierden los bordes del paisaje (por defecto #ffffff;
 *                     conviene que coincida con el fondo de la página).
 *
 * Uso imperativo (React, Vue, etc.):
 *   import { createSanRafaelDioramaV3 } from './san-rafael-diorama-v3.js';
 *   const app = createSanRafaelDioramaV3(containerElement);
 *   app.setSound(true);   // sonido ambiente (llamar desde un click del usuario)
 *   app.quality;          // nivel de calidad actual: 0 alta, 1 media, 2 baja
 *   app.dispose();
 *
 * Requiere `three` resuelto como módulo (import map o bundler).
 */
import * as THREE from 'three';
import { LOOP, Batch, disposeMaterialCache } from './utils.js';
import { W, D, BASE } from './layout.js';
import { buildGroundTexture, buildGround, buildMountainGeometry, buildMountainMaterial, buildWater, EXT_RECT, applyCloudShadow, cloudShadowUniforms } from './terrain.js';
import { addVineyards, buildPoplars, addTrees, addDetails } from './flora.js';
import { buildStructures } from './buildings.js';
import { buildActors, disposeActorMaterials, CONDOR, beginCrowd, endCrowd } from './actors.js';
import { buildPatio } from './patio.js';
import { buildRaft } from './rafting.js';
import { buildVendimia } from './vendimia.js';
import { Ambience } from './ambience.js';
import { applyEdgeFade, edgeFadeUniforms } from './edgefade.js';

const AZIMUTH = THREE.MathUtils.degToRad(38);
const ELEVATION = THREE.MathUtils.degToRad(31);

export function createSanRafaelDioramaV3(container, options = {}) {
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
  const mountains = new THREE.Mesh(buildMountainGeometry(), buildMountainMaterial());
  mountains.castShadow = mountains.receiveShadow = true;
  addVineyards(batch);
  const poplars = buildPoplars(batch, ao);
  addTrees(batch, ao);
  addDetails(batch, ao);
  const structures = buildStructures(batch, ao);
  beginCrowd();
  const patio = buildPatio(batch, ao);
  const vendimia = buildVendimia(batch);
  const staticMesh = batch.build(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86 }));

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const groundTex = buildGroundTexture(ao, aniso);
  const outerTex = buildGroundTexture(ao, aniso, EXT_RECT, 1024);
  const water = buildWater();
  const actors = buildActors(structures.house);
  const raft = buildRaft();
  const crowd = endCrowd();
  const ground = buildGround(groundTex, outerTex);
  scene.add(ground, mountains, staticMesh, poplars.object, structures.group, water.group, actors.group, patio.group, raft.group, vendimia.group, crowd.group);
  // Las matrices se actualizan a mano en cada cuadro (antes de copiar las de la multitud)
  scene.matrixWorldAutoUpdate = false;

  // Sombra suave de las nubes sobre el terreno y lo que está apoyado en él
  const cloudU = cloudShadowUniforms();
  ground.traverse((o) => o.material && applyCloudShadow(o.material, cloudU));
  for (const m of [mountains.material, staticMesh.material, poplars.object.material]) applyCloudShadow(m, cloudU);

  // El paisaje de alrededor se pierde en la bruma (contorno irregular + bordes del lienzo):
  // suelo, montañas y agua se funden al color de fondo; los objetos se vuelven transparentes.
  const fade = edgeFadeUniforms(options.fadeColor);
  ground.traverse((o) => o.material && applyEdgeFade(o.material, fade, 'mix'));
  applyEdgeFade(mountains.material, fade, 'mix');
  water.group.traverse((o) => o.material?.map && applyEdgeFade(o.material, fade, 'mix'));
  scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    ms.forEach((m) => {
      applyEdgeFade(m, fade, 'alpha');
      // Humo, espuma y demás efectos semitransparentes se dibujan después de lo sólido
      if (m.userData.wasTransparent) o.renderOrder = Math.max(o.renderOrder, 5);
    });
  });

  /* ---------------- Luces ---------------- */
  scene.add(new THREE.HemisphereLight('#eef6ff', '#b39b78', 1.45));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
  sun.position.set(-0.45, 0.8, 0.42).normalize().multiplyScalar(50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowMapSize ?? 2048, options.shadowMapSize ?? 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 29, bottom: -29, near: 5, far: 120 });
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
  const v = new THREE.Vector3();
  // Se encuadra la escena (no los alrededores), igual que la versión con base de tierra:
  // así se ve del mismo tamaño y lo de alrededor llena los márgenes hasta perderse.
  const add = (p) => {
    const r = p.dot(right), u = p.dot(up);
    if (r < ext.r0) ext.r0 = r;
    if (r > ext.r1) ext.r1 = r;
    if (u < ext.u0) ext.u0 = u;
    if (u > ext.u1) ext.u1 = u;
  };
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) add(v.set(x, -BASE, z));
  for (const geo of [staticMesh.geometry, mountains.geometry]) {
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i += 3) {
      v.fromBufferAttribute(pa, i);
      if (Math.abs(v.x) > W / 2 + 0.3 || Math.abs(v.z) > D / 2 + 0.3) continue;
      const r = v.dot(right), u = v.dot(up);
      if (r < ext.r0) ext.r0 = r;
      if (r > ext.r1) ext.r1 = r;
      if (u < ext.u0) ext.u0 = u;
      if (u > ext.u1) ext.u1 = u;
    }
  }
  // El cóndor vuela por encima de los picos: su órbita también entra en el encuadre.
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    v.set(CONDOR.x + Math.cos(a) * (CONDOR.rx + 0.7), CONDOR.y + 0.6, CONDOR.z + Math.sin(a) * (CONDOR.rz + 0.7));
    ext.u1 = Math.max(ext.u1, v.dot(up));
  }

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(fade.uRes.value);
    const aspect = w / h;
    const cw = ext.r1 - ext.r0, ch = ext.u1 - ext.u0;
    const pad = 1.08;
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

  // Casi todo repite cada LOOP (30 s); el tractor y el carro alegórico se turnan,
  // así que el ciclo completo dura 2 × LOOP y sigue empalmando sin saltos.
  function render(t) {
    const T = (((t % LOOP) + LOOP) % LOOP) / LOOP;
    const T2 = (((t % (2 * LOOP)) + 2 * LOOP) % (2 * LOOP)) / (2 * LOOP);
    water.update(T);
    poplars.update(T);
    structures.update(T);
    actors.update(T, T2);
    patio.update(T);
    raft.update(T);
    vendimia.update(T, T2);
    actors.clouds.forEach((c, i) => cloudU.uClouds.value[i].set(c.obj.position.x, c.obj.position.y, c.obj.position.z, c.radius));
    scene.updateMatrixWorld();
    crowd.sync();
    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, (now - last) / 1000);
    elapsed += Math.min(0.1, dt);
    last = now;
    trackFps(dt);
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

  /* ---------------- Calidad automática ---------------- */
  // 0: alta (resolución nativa hasta 2x, sombras 2048) · 1: media (1.25x, sombras 1024)
  // 2: baja (1x, sin sombras). En "auto" arranca en media en equipos táctiles o de pocos
  // núcleos y baja un escalón si el promedio de FPS cae de 40.
  const dprCap = options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
  const LEVELS = [
    { dpr: dprCap, shadow: options.shadowMapSize ?? 2048, shadows: true },
    { dpr: Math.min(dprCap, 1.25), shadow: 1024, shadows: true },
    { dpr: 1, shadow: 1024, shadows: false },
  ];
  const qMode = options.quality ?? 'auto';
  const weak = window.matchMedia?.('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  let level = qMode === 'low' ? 2 : qMode === 'high' ? 0 : weak ? 1 : 0;
  function setQuality(l) {
    level = Math.max(0, Math.min(2, l));
    const q = LEVELS[level];
    renderer.setPixelRatio(q.dpr);
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    resize();
  }
  const perf = { frames: 0, time: 0, warm: 0 };
  function trackFps(dt) {
    if (qMode !== 'auto' || level >= 2) return;
    if (dt > 0.5) {
      perf.frames = perf.time = perf.warm = 0; // volvió de una pausa: no cuenta
      return;
    }
    if ((perf.warm += dt) < 2.5) return; // deja estabilizar tras cada cambio
    perf.frames++;
    perf.time += dt;
    if (perf.time >= 2) {
      const fps = perf.frames / perf.time;
      perf.frames = perf.time = 0;
      if (fps < 40) {
        setQuality(level + 1);
        perf.warm = 0;
      }
    }
  }

  // Sonido ambiente: se crea recién cuando el usuario lo activa
  const ambience = new Ambience();
  let onScreen = true;
  const syncAudio = () => ambience.setPaused(!onScreen || document.hidden);
  document.addEventListener('visibilitychange', syncAudio);

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    onScreen ? start() : stop();
    syncAudio();
  });
  io.observe(container);
  setQuality(level);
  if (!animate) render(staticTime);

  return {
    renderer,
    scene,
    camera,
    start,
    stop,
    // Dibuja el cuadro correspondiente a `t` segundos del loop (útil para capturas/posters).
    renderAt(t) {
      render(t);
    },
    get sound() {
      return ambience.enabled;
    },
    get quality() {
      return level;
    },
    setQuality,
    setSound(on) {
      if (on) return ambience.enable();
      ambience.disable();
    },
    dispose() {
      stop();
      ambience.dispose();
      document.removeEventListener('visibilitychange', syncAudio);
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

export class SanRafaelDioramaV3Element extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display: block; position: relative; width: 100%; aspect-ratio: 16 / 10; background: var(--diorama-bg, transparent); }
        .stage { position: absolute; inset: 0; }
        .sound {
          position: absolute; right: 12px; bottom: 12px; width: 38px; height: 38px; padding: 0;
          display: grid; place-items: center; border-radius: 50%; cursor: pointer;
          border: 1px solid rgba(0, 0, 0, 0.08); background: rgba(255, 255, 255, 0.88); color: #3a3a3a;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); backdrop-filter: blur(4px);
          transition: background 0.2s, color 0.2s, transform 0.15s;
        }
        .sound:hover { background: #fff; transform: scale(1.05); }
        .sound:focus-visible { outline: 2px solid #3d7dd8; outline-offset: 2px; }
        .sound[aria-pressed="true"] { color: #b3122e; }
        .sound .on, .sound[aria-pressed="true"] .off { display: none; }
        .sound[aria-pressed="true"] .on { display: inline; }
        :host([nosound]) .sound { display: none; }
      </style>
      <div class="stage"></div>
      <button class="sound" type="button" part="sound-toggle" aria-pressed="false" aria-label="Activar sonido ambiente" title="Sonido ambiente">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor"/>
          <g class="on" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>
          </g>
          <g class="off" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>
          </g>
        </svg>
      </button>`;
    const fadeColor = getComputedStyle(this).getPropertyValue('--diorama-fade').trim() || '#ffffff';
    const quality = this.getAttribute('quality') || undefined;
    this._app = createSanRafaelDioramaV3(root.querySelector('.stage'), { animate: this.hasAttribute('static') ? false : undefined, fadeColor, quality });
    const btn = root.querySelector('.sound');
    btn.addEventListener('click', async () => {
      const on = !this._app.sound;
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Silenciar sonido ambiente' : 'Activar sonido ambiente');
      await this._app.setSound(on);
    });
  }

  disconnectedCallback() {
    this._app?.dispose();
    this._app = null;
  }
}

if (!customElements.get('san-rafael-diorama-v3')) customElements.define('san-rafael-diorama-v3', SanRafaelDioramaV3Element);
