import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Duración del loop de animación (segundos). Todo lo animado usa frecuencias
// enteras de este período para que el loop sea perfecto.
export const LOOP = 30;
export const TAU = Math.PI * 2;

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// RNG determinista para que la escena sea siempre igual.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, y, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * f + i * 17.3, y * f - i * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// Onda periódica dentro del loop: k vueltas por loop, fase en [0,1).
export const wave = (T, k, phase = 0) => Math.sin(TAU * (T * k + phase));

// Ida y vuelta entre 0 y 1 con pausas en los extremos.
// Devuelve { p: progreso 0..1, dir: +1 | -1, moving: bool }.
export function pingPong(T, k, pause = 0.15, phase = 0) {
  const f = (((T * k + phase) % 1) + 1) % 1;
  const move = (1 - 2 * pause) / 2;
  if (f < move) return { p: f / move, dir: 1, moving: true };
  if (f < move + pause) return { p: 1, dir: 1, moving: false };
  if (f < 2 * move + pause) return { p: 1 - (f - move - pause) / move, dir: -1, moving: true };
  return { p: 0, dir: -1, moving: false };
}

// Geometrías base (no indexadas, con la base en y = 0 cuando aplica).
const ni = (g) => (g.index ? g.toNonIndexed() : g);
export const GEO = {
  box: ni(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  boxC: ni(new THREE.BoxGeometry(1, 1, 1)),
  cyl: ni(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0)),
  cyl6: ni(new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0)),
  cylC: ni(new THREE.CylinderGeometry(1, 1, 1, 14)),
  cone: ni(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0)),
  cone4: ni(new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0)),
  ico: ni(new THREE.IcosahedronGeometry(1, 0)),
  ico1: ni(new THREE.IcosahedronGeometry(1, 1)),
  dodeca: ni(new THREE.DodecahedronGeometry(1, 0)),
  sphere: ni(new THREE.SphereGeometry(1, 10, 7)),
  halfCyl: ni(new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2)),
  // Versiones livianas sin tapas (las tapas quedan ocultas en el piso o bajo el follaje)
  octa: ni(new THREE.OctahedronGeometry(1, 0)),
  cone3o: ni(new THREE.ConeGeometry(1, 1, 3, 1, true).translate(0, 0.5, 0)),
  cone5o: ni(new THREE.ConeGeometry(1, 1, 5, 1, true).translate(0, 0.5, 0)),
  cone6o: ni(new THREE.ConeGeometry(1, 1, 6, 1, true).translate(0, 0.5, 0)),
  cyl4o: ni(new THREE.CylinderGeometry(1, 1, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0)),
};

// Efectos por vértice del batch estático: fx = [viento, patrón de material].
// El patrón se dibuja en el shader (tejas, ladrillo, madera, revoque, piedra, hojas):
// detalle sin un solo triángulo extra.
export const FX = { NONE: 0, ROOF: 1, BRICK: 2, WOOD: 3, PLASTER: 4, STONE: 5, LEAF: 6 };

// Patrón automático según el color de la pieza (edificios, cercos, barricas...).
const AUTO_FX = {};
const tag = (pattern, colors) => colors.forEach((c) => (AUTO_FX[c] = [0, pattern]));
tag(FX.ROOF, ['#c8643b', '#a94f2e', '#a9563a', '#a8553a']);
tag(FX.PLASTER, ['#f1e6cf', '#f6ecd8', '#eadcc0', '#e8dcc5', '#f3dcc3', '#e2d3b6', '#dccbaa', '#cdb995']);
tag(FX.BRICK, ['#b25f3e', '#b0603f', '#9c4f33', '#a1543a']);
tag(FX.WOOD, ['#8b6744', '#9c7650', '#7a5a3c', '#9a7652', '#6b4a2f', '#5b3d27', '#8b5a2b', '#9a7550', '#7a5434', '#6b4226', '#b47a4a', '#9a6438', '#8d7660', '#7a5434', '#a77c52', '#7b6a55', '#6e4f35']);
tag(FX.STONE, ['#b8ab98', '#8f8678', '#a39a8c', '#c9c3b6', '#d3ccbe']);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function matrix(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _p.set(pos[0], pos[1], pos[2]);
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return _m.clone().compose(_p, _q, _s);
}

const _c = new THREE.Color();

// Junta muchas piezas estáticas en un único mesh con colores por vértice:
// una sola draw call para casi todo el escenario.
export class Batch {
  constructor() {
    this.parts = [];
    this.flat = []; // piezas que no proyectan sombra (pasto, flores, piedritas, uvas...)
  }

  _fx(g, fx) {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 2);
    if (fx) for (let i = 0; i < n; i++) a.set(fx, i * 2);
    g.setAttribute('fx', new THREE.BufferAttribute(a, 2));
  }

  // opts.ao = [y0, y1, min]: oscurece la geometría (en coords locales) entre y0 e y1,
  // un "ambient occlusion" falso barato que da mucho volumen a escala miniatura.
  // opts.fx = [viento 0..1, patrón FX]; opts.shadow = false para piezas chicas sin sombra.
  add(geo, color, { pos, rot, scale, ao, jitter = 0, rand, fx, shadow = true } = {}) {
    if (!fx && typeof color === 'string') fx = AUTO_FX[color.toLowerCase()];
    const g = geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    _c.set(color);
    if (jitter && rand) _c.offsetHSL((rand() - 0.5) * jitter * 0.2, 0, (rand() - 0.5) * jitter);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let f = 1;
      if (ao) f = lerp(ao[2], 1, smoothstep(ao[0], ao[1], p.getY(i)));
      col[i * 3] = _c.r * f;
      col[i * 3 + 1] = _c.g * f;
      col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this._fx(g, fx);
    g.applyMatrix4(matrix(pos, rot, scale));
    (shadow ? this.parts : this.flat).push(g);
    return this;
  }

  // Agrega una geometría ya armada que trae su propio atributo color.
  addColored(g, { fx, shadow = true } = {}) {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'fx'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.fx) this._fx(g, fx);
    (shadow ? this.parts : this.flat).push(g.index ? g.toNonIndexed() : g);
    return this;
  }

  // Devuelve dos meshes con el mismo material: el que proyecta sombra y el que no.
  build(material) {
    const make = (list, cast) => {
      if (!list.length) return null;
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      return mesh;
    };
    const cast = make(this.parts, true), flat = make(this.flat, false);
    this.parts = [];
    this.flat = [];
    return { cast, flat, meshes: [cast, flat].filter(Boolean) };
  }
}

// Caché de materiales para los personajes y objetos animados.
const matCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...extra }));
  }
  return matCache.get(key);
}

export function disposeMaterialCache() {
  matCache.forEach((m) => m.dispose());
  matCache.clear();
}

export function mesh(geo, material, { pos, rot, scale, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale !== undefined) typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/* ---------- Helpers v2: geometrías con color por vértice ---------- */

export function valueNoise3(x, y, z) {
  const zi = Math.floor(z), zf = z - zi;
  const w = zf * zf * (3 - 2 * zf);
  return lerp(valueNoise(x + zi * 31.7, y - zi * 17.3), valueNoise(x + (zi + 1) * 31.7, y - (zi + 1) * 17.3), w);
}

// Clona una geometría (sin índices) aplicando transformación y un color fijo
// o una función color(x, y, z) → THREE.Color evaluada por vértice.
export function colored(geo, color, { pos, rot, scale } = {}) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (pos || rot || scale) g.applyMatrix4(matrix(pos, rot, scale));
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const fixed = typeof color === 'function' ? null : new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const c = fixed || color(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function mergeColored(list) {
  const g = mergeGeometries(list, false);
  list.forEach((x) => x.dispose());
  return g;
}

// Material compartido para todo lo que usa color por vértice.
export const VC_FLAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
export const VC_SMOOTH = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });

export function vcMesh(geo, material = VC_FLAT, pos) {
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Encadena modificaciones de shader (onBeforeCompile) con una clave de caché
// distinta por combinación, para que three no mezcle programas entre materiales.
export function chainShader(material, key, fn) {
  const prev = material.onBeforeCompile;
  const keys = material.userData.shaderKeys || (material.userData.shaderKeys = [prev.toString()]);
  if (keys.includes(key)) return; // material compartido entre varias mallas: ya tiene este efecto
  keys.push(key);
  material.onBeforeCompile = (sh, renderer) => {
    prev.call(material, sh, renderer);
    fn(sh, renderer);
  };
  material.customProgramCacheKey = () => keys.join('|');
  material.needsUpdate = true;
}
