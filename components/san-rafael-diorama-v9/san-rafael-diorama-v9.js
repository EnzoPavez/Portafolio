/**
 * <san-rafael-diorama-v9> — Diorama isométrico animado de San Rafael, Mendoza (Argentina).
 * v4: igual que la v3 + más detalle sin costo de geometría (texturas, shaders y viento).
 * v5: pedreros y roca facetada en la montaña, alambres de espaldera, chapa y acero con
 *     textura, espuma en el río y bruma en la cascada, pinos más grandes y banderines
 *     que ya no tapan el cartel de la bodega.
 * v6: estratos plegados en grises en la roca (también en la garganta del Atuel),
 *     manchones de pasto seco y tupido, nubes con panza sombreada, espuma en las
 *     orillas del río y destellos de sol visibles. Todo en shaders: sin triángulos extra.
 * v7: modo atardecer (sol bajo, sombras largas, ventanas, lamparitas y fuego encendidos),
 *     paralaje suave con el mouse y efecto miniatura (tilt-shift).
 * v8: más luces al atardecer. Faros que iluminan el camino, baliza y luces traseras en el
 *     tractor, la bici y el carro alegórico (con guirnalda de lamparitas); faroles en la
 *     bodega y el puente, lamparitas en la pérgola y la galería, reflectores en el cartel,
 *     velas en la mesa y luciérnagas.
 * v9: oclusión ambiental en pantalla (los rincones, los pies de las cosas y el espacio
 *     entre hileras se oscurecen como en una maqueta de verdad), el cielo del atardecer
 *     detrás de las cumbres, ráfagas de viento que cruzan la escena (los álamos titilan
 *     plateados) y hojas que caen de los álamos dorados.
 *
 * Uso como Web Component (cualquier framework o HTML plano):
 *   <script type="module" src="./san-rafael-diorama-v9.js"></script>
 *   <san-rafael-diorama-v9 style="height: 70vh"></san-rafael-diorama-v9>
 *
 * Atributos:
 *   static       → renderiza un único cuadro, sin animación.
 *   time         → "day" (por defecto) o "sunset". Se puede cambiar en vivo (hace la transición).
 *   nosound      → oculta el botón de sonido ambiente (por defecto el sonido está apagado).
 *   nosunset     → oculta el botón de atardecer.
 *   noparallax   → la cámara no sigue al mouse.
 *   notiltshift  → sin el desenfoque de maqueta.
 *   noao         → sin la oclusión ambiental en pantalla.
 *   quality      → "auto" (por defecto: baja la calidad sola si caen los FPS), "high" o "low".
 *
 * Variables CSS:
 *   --diorama-bg    → fondo del componente (por defecto transparente).
 *   --diorama-fade  → color en el que se pierden los bordes del paisaje (por defecto #ffffff;
 *                     conviene que coincida con el fondo de la página).
 *
 * Uso imperativo (React, Vue, etc.):
 *   import { createSanRafaelDioramaV9 } from './san-rafael-diorama-v9.js';
 *   const app = createSanRafaelDioramaV9(containerElement);
 *   app.setSound(true);   // sonido ambiente (llamar desde un click del usuario)
 *   app.setTime('sunset'); // 'day' o 'sunset', con transición
 *   app.quality;          // nivel de calidad actual: 0 alta, 1 media, 2 baja
 *   app.dispose();
 *
 * Requiere `three` resuelto como módulo (import map o bundler).
 */
import * as THREE from 'three';
import { LOOP, TAU, FX, Batch, disposeMaterialCache } from './utils.js';
import { W, D, BASE, VIEW } from './layout.js';
import { buildGroundTexture, buildGround, buildMountainGeometry, buildMountainMaterial, buildWater, EXT_RECT, applyCloudShadow, cloudShadowUniforms } from './terrain.js';
import { addVineyards, buildPoplars, addTrees, addDetails } from './flora.js';
import { buildStructures } from './buildings.js';
import { buildActors, disposeActorMaterials, CONDOR, beginCrowd, endCrowd } from './actors.js';
import { buildPatio } from './patio.js';
import { buildRaft } from './rafting.js';
import { buildVendimia } from './vendimia.js';
import { buildDetails } from './details.js';
import { detailUniforms, applyStaticDetail, applyConstantPattern, applyPoplarGust, applyMountainDetail, applyGroundDetail, applyWaterSparkle } from './detail.js';
import { Ambience } from './ambience.js';
import { applyEdgeFade, edgeFadeUniforms, buildSky } from './edgefade.js';
import { buildGlows, timeOfDay } from './timeofday.js';
import { TiltShift } from './tiltshift.js';
import { buildNightLights } from './nightlights.js';
import { SSAO } from './ssao.js';
import { buildLeaves } from './leaves.js';

const AZIMUTH = VIEW.azimuth;
const ELEVATION = VIEW.elevation;
// Cielo de fondo: a la altura de la cumbre más alta, centrado en el lienzo, con radios en
// unidades del mundo (así acompaña el tamaño del diorama)
const SKY_AT = { peak: [-6.8, 5.2, -12.3], rx: 30, ry: 12 };

export function createSanRafaelDioramaV9(container, options = {}) {
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
  canvas.setAttribute('aria-label', 'Diorama animado de San Rafael, Mendoza: viñedos, álamos, río, montañas y la Fiesta de la Vendimia.');
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
  const details = buildDetails(batch);
  const nightSpots = buildNightLights(batch);
  // Dos mallas con el mismo material: lo que proyecta sombra y lo chico que no (pasto, flores, uvas, piedritas)
  const statics = batch.build(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86 }));
  const staticMat = statics.cast.material;

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const groundTex = buildGroundTexture(ao, aniso);
  const outerTex = buildGroundTexture(ao, aniso, EXT_RECT, 1024);
  const water = buildWater();
  const actors = buildActors(structures.house);
  const raft = buildRaft();
  const crowd = endCrowd();
  const leaves = buildLeaves(poplars.golden);
  const ground = buildGround(groundTex, outerTex);
  // Resplandores del atardecer: patio, parrilla de la casa, faroles y velas, vehículos y luciérnagas
  const glows = buildGlows([
    ...patio.glows, { p: structures.house.grill.clone().setY(0.55), r: 0.5, color: '#ff7a2a', k: 0.6 },
    ...nightSpots, ...actors.glows, ...vendimia.glows,
  ]);
  scene.add(ground, mountains, ...statics.meshes, poplars.object, structures.group, water.group, actors.group, patio.group, raft.group, vendimia.group, details.group, crowd.group, glows.group, leaves.mesh);

  // Detalle en el shader (sin geometría extra): viento, tejas/ladrillo/madera/revoque/piedra/hojas,
  // grano de roca en la montaña y destellos en el agua
  const detU = detailUniforms();
  applyStaticDetail(staticMat, detU);
  applyStaticDetail(structures.tanksMat, detU);
  applyConstantPattern(poplars.object.material, FX.LEAF);
  applyPoplarGust(poplars.object.material);
  applyMountainDetail(mountains.material);
  ground.traverse((o) => o.material && applyGroundDetail(o.material));
  water.group.traverse((o) => o.material?.map && applyWaterSparkle(o.material, detU));
  // Las matrices se actualizan a mano en cada cuadro (antes de copiar las de la multitud)
  scene.matrixWorldAutoUpdate = false;

  // Sombra suave de las nubes sobre el terreno y lo que está apoyado en él
  const cloudU = cloudShadowUniforms();
  ground.traverse((o) => o.material && applyCloudShadow(o.material, cloudU));
  for (const m of [mountains.material, staticMat, poplars.object.material]) applyCloudShadow(m, cloudU);

  // El paisaje de alrededor se pierde en la bruma (contorno irregular + bordes del lienzo):
  // suelo, montañas y agua se funden al color de fondo; los objetos se vuelven transparentes.
  // El fondo puede llevar el cielo del atardecer detrás de las cumbres (va antes que todo).
  const fade = edgeFadeUniforms(options.fadeColor);
  const sky = buildSky(fade);
  scene.add(sky);
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

  // Oclusión ambiental: lo sólido la recibe y la proyecta; humo, resplandores y demás, no.
  const ssao = new SSAO();
  ssao.setOccluders(scene);
  const soft = new Set(ssao.hidden);
  scene.traverse((o) => {
    if (!o.isMesh || soft.has(o)) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && ssao.apply(m));
  });
  const aoWanted = options.ao ?? true;

  /* ---------------- Luces (colores, intensidades y dirección del sol: timeofday.js) ---------------- */
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowMapSize ?? 2048, options.shadowMapSize ?? 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 29, bottom: -29, near: 5, far: 120 });
  sun.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight();
  fill.position.set(30, 16, -12);
  scene.add(hemi, sun, fill);
  const waterMats = new Set(), nightMats = new Set();
  water.group.traverse((o) => o.material?.map && waterMats.add(o.material));
  // Faros, balizas, luces traseras y el cartel: se encienden con el atardecer
  scene.traverse((o) => (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.userData.night && nightMats.add(m)));
  const time = timeOfDay({ hemi, sun, fill, renderer, waterMats: [...waterMats], cloudMat: actors.cloudMat, detU, cloudU, glows, skyU: fade, nightMats: [...nightMats] });
  time.set(options.time === 'sunset' ? 'sunset' : 'day', true);

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
  for (const geo of [...statics.meshes.map((m) => m.geometry), mountains.geometry]) {
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

  // La cámara mira al centro del encuadre (pivot) con un frustum simétrico: así el paralaje
  // gira alrededor de la escena en vez de correrla.
  const pivot = new THREE.Vector3(), view = new THREE.Vector3();
  // En pantallas táctiles no hay puntero que seguir
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  const parallaxOn = (options.parallax ?? true) && animate && !touch;
  const PAR_AZ = THREE.MathUtils.degToRad(3), PAR_EL = THREE.MathUtils.degToRad(1.5);
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  function aim() {
    const az = AZIMUTH + par.x * PAR_AZ, el = ELEVATION - par.y * PAR_EL;
    view.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(pivot).addScaledVector(view, 120);
    camera.lookAt(pivot);
    camera.updateMatrixWorld();
  }
  const pointerTarget = options.pointerTarget ?? container;
  const clamp1 = (v) => Math.max(-1, Math.min(1, v));
  const onPointerMove = (e) => {
    const r = pointerTarget.getBoundingClientRect();
    par.tx = clamp1(((e.clientX - r.left) / r.width) * 2 - 1);
    par.ty = clamp1(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onPointerLeave = () => (par.tx = par.ty = 0);
  if (parallaxOn) {
    pointerTarget.addEventListener('pointermove', onPointerMove);
    pointerTarget.addEventListener('pointerleave', onPointerLeave);
  }

  const tilt = new TiltShift();
  const tiltWanted = options.tiltShift ?? true;

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(fade.uRes.value);
    tilt.setSize(fade.uRes.value.x, fade.uRes.value.y);
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
    pivot.copy(right).multiplyScalar(cr).addScaledVector(up, cu);
    Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    camera.updateProjectionMatrix();
    aim();
    // Cielo detrás de las cumbres, del ancho del cordón. Queda quieto con el paralaje
    // (está "más lejos" que las montañas).
    const bw = fade.uRes.value.x, bh = fade.uRes.value.y, ppu = bh / (2 * hh);
    v.set(...SKY_AT.peak).project(camera);
    fade.uSkyGeo.value.set(bw / 2, (v.y * 0.5 + 0.5) * bh, SKY_AT.rx * ppu, SKY_AT.ry * ppu);
    // La AO va a la resolución en píxeles CSS (en pantallas 2x, la mitad del lienzo)
    ssao.setSize(bw, bh, Math.min(1, 1 / renderer.getPixelRatio()));
    ssao.setEnabled(aoWanted && LEVELS[level].ao);
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
    details.update(T, T2);
    leaves.update(T);
    detU.uLoop.value = TAU * T;
    actors.clouds.forEach((c, i) => cloudU.uClouds.value[i].set(c.obj.position.x, c.obj.position.y, c.obj.position.z, c.radius));
    scene.updateMatrixWorld();
    crowd.sync();
    glows.update(T);
    // Las estadísticas (renderer.info) suman todas las pasadas del cuadro: profundidad y AO,
    // la escena y el tilt-shift
    renderer.info.reset();
    renderer.info.autoReset = false;
    ssao.render(renderer, scene, camera);
    renderer.render(scene, camera);
    if (tiltWanted && LEVELS[level].tilt) tilt.render(renderer);
    renderer.info.autoReset = true;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, (now - last) / 1000);
    const step = Math.min(0.1, dt);
    elapsed += step;
    last = now;
    trackFps(dt);
    time.step(step);
    if (parallaxOn) {
      const k = 1 - Math.exp(-step * 4);
      par.x += (par.tx - par.x) * k;
      par.y += (par.ty - par.y) * k;
      aim();
    }
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
  // 0: alta (resolución nativa hasta 2x, sombras 2048, tilt-shift, AO) · 1: media (1.25x,
  // sombras 1024, tilt-shift) · 2: baja (1x, sin sombras ni tilt-shift). En "auto" arranca
  // en media en equipos táctiles o de pocos núcleos y baja un escalón si el promedio de FPS
  // cae de 40.
  const dprCap = options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
  const LEVELS = [
    { dpr: dprCap, shadow: options.shadowMapSize ?? 2048, shadows: true, tilt: true, ao: true },
    { dpr: Math.min(dprCap, 1.25), shadow: 1024, shadows: true, tilt: true, ao: false },
    { dpr: 1, shadow: 1024, shadows: false, tilt: false, ao: false },
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
    ssao,
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
    get time() {
      return time.value;
    },
    // 'day' o 'sunset'. Con la animación corriendo hace la transición; si no, cambia de una.
    setTime(name) {
      time.set(name, !running);
      if (!running) render(staticTime);
    },
    dispose() {
      stop();
      ambience.dispose();
      document.removeEventListener('visibilitychange', syncAudio);
      pointerTarget.removeEventListener('pointermove', onPointerMove);
      pointerTarget.removeEventListener('pointerleave', onPointerLeave);
      ro.disconnect();
      io.disconnect();
      tilt.dispose();
      ssao.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          m.map?.dispose();
          m.alphaMap?.dispose();
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

export class SanRafaelDioramaV9Element extends HTMLElement {
  static observedAttributes = ['time'];

  attributeChangedCallback(name, old, value) {
    if (name !== 'time' || !this._app) return;
    this._app.setTime(value === 'sunset' ? 'sunset' : 'day');
    this._syncTimeButton();
  }

  _syncTimeButton() {
    const on = this._app.time === 'sunset';
    const btn = this.shadowRoot.querySelector('.time');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Volver al día' : 'Ver el atardecer');
  }

  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display: block; position: relative; width: 100%; aspect-ratio: 16 / 10; background: var(--diorama-bg, transparent); }
        .stage { position: absolute; inset: 0; }
        .controls { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 8px; }
        .controls button {
          width: 38px; height: 38px; padding: 0;
          display: grid; place-items: center; border-radius: 50%; cursor: pointer;
          border: 1px solid rgba(0, 0, 0, 0.08); background: rgba(255, 255, 255, 0.88); color: #3a3a3a;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); backdrop-filter: blur(4px);
          transition: background 0.2s, color 0.2s, transform 0.15s;
        }
        .controls button:hover { background: #fff; transform: scale(1.05); }
        .controls button:focus-visible { outline: 2px solid #3d7dd8; outline-offset: 2px; }
        .sound[aria-pressed="true"] { color: #b3122e; }
        .time[aria-pressed="true"] { color: #d9682b; }
        .sound .on, .sound[aria-pressed="true"] .off { display: none; }
        .sound[aria-pressed="true"] .on { display: inline; }
        :host([nosound]) .sound, :host([nosunset]) .time { display: none; }
      </style>
      <div class="stage"></div>
      <div class="controls">
      <button class="time" type="button" part="time-toggle" aria-pressed="false" aria-label="Ver el atardecer" title="Atardecer">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M7 16.5a5 5 0 0 1 10 0"/><path d="M3 16.5h18M8 20h8"/>
          <path d="M12 5.5v2.5M5.3 8.8l1.6 1.6M18.7 8.8l-1.6 1.6M3.2 13h1.8M19 13h1.8"/>
        </svg>
      </button>
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
      </button>
      </div>`;
    const fadeColor = getComputedStyle(this).getPropertyValue('--diorama-fade').trim() || '#ffffff';
    const quality = this.getAttribute('quality') || undefined;
    this._app = createSanRafaelDioramaV9(root.querySelector('.stage'), {
      animate: this.hasAttribute('static') ? false : undefined,
      fadeColor,
      quality,
      time: this.getAttribute('time') || undefined,
      parallax: !this.hasAttribute('noparallax'),
      tiltShift: !this.hasAttribute('notiltshift'),
      ao: !this.hasAttribute('noao'),
      pointerTarget: this,
    });
    this._syncTimeButton();
    // El botón cambia el atributo: así queda reflejado y lo maneja attributeChangedCallback
    root.querySelector('.time').addEventListener('click', () => {
      this.setAttribute('time', this._app.time === 'sunset' ? 'day' : 'sunset');
    });
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

if (!customElements.get('san-rafael-diorama-v9')) customElements.define('san-rafael-diorama-v9', SanRafaelDioramaV9Element);
