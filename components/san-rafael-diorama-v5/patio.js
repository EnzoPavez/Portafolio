import * as THREE from 'three';
import { GEO, TAU, rng, lerp, smoothstep, wave, pingPong, matrix, colored, mergeColored, mat } from './utils.js';
import { PATIO, GRILL, FIRE, TABLE, TANGO, MATE, PASTURE, COOP } from './layout.js';
import { makePerson, sit, walkPose, standPose, SKINS, buildPuffs } from './actors.js';
import { buildCow, buildChicken } from './animals.js';

/* Patio criollo: parrilla, asado a la cruz, mesa larga con brindis, ronda de mate,
   pareja de tango con bandoneón, guirnaldas de luces, vacas lecheras y gallinas. */

const WOOD = '#8b6744';
const BRICK = '#b25f3e';
const yawTo = (dx, dz) => Math.atan2(dx, dz);

// Agrega una pieza al batch estático aplicando una matriz padre (para objetos inclinados).
function put(batch, geo, color, parent, pos, rot, scale) {
  const g = colored(geo, color);
  g.applyMatrix4(parent ? parent.clone().multiply(matrix(pos, rot, scale)) : matrix(pos, rot, scale));
  batch.addColored(g);
}

/* ------------------------------ Estático ------------------------------ */

function addFence(b, { x0, x1, z0, z1 }, gap) {
  const post = (x, z) => b.add(GEO.box, '#7a5a3c', { pos: [x, 0, z], scale: [0.05, 0.46, 0.05], ao: [0, 0.3, 0.6] });
  const rail = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(bx - ax, bz - az);
    for (const y of [0.2, 0.38]) b.add(GEO.boxC, '#9a7652', { pos: [(ax + bx) / 2, y, (az + bz) / 2], rot: [0, ry, 0], scale: [0.03, 0.035, len] });
  };
  const side = (ax, az, bx, bz, n) => {
    for (let i = 0; i <= n; i++) post(lerp(ax, bx, i / n), lerp(az, bz, i / n));
    rail(ax, az, bx, bz);
  };
  side(x0, z0, x1, z0, 6);
  side(x0, z1, x1, z1, 6);
  side(x0, z0, x0, z1, 9);
  side(x1, z0, x1, gap[0], 4);
  side(x1, gap[1], x1, z1, 3);
}

function addPasture(b, ao) {
  addFence(b, PASTURE, [-0.7, 0.3]);
  // Bebedero
  b.add(GEO.box, '#8d7660', { pos: [-14.15, 0, -2.85], scale: [0.85, 0.17, 0.3], ao: [0, 0.5, 0.75] });
  b.add(GEO.box, '#4fb3c2', { pos: [-14.15, 0.17, -2.85], scale: [0.78, 0.01, 0.24] });
  ao.push({ x: -14.15, z: -2.85, r: 0.7, a: 0.35 });
  // Rollos de pasto
  for (const [x, z, ry] of [[-15.25, -2.85, 0.3], [-16.45, -0.75, -0.5], [-16.05, -1.05, 0.9]]) {
    b.add(GEO.cylC, '#dcb963', { pos: [x, 0.22, z], rot: [0, ry, Math.PI / 2], scale: [0.22, 0.34, 0.22] });
    for (const s of [-1, 1]) {
      const ox = Math.cos(ry) * 0.171 * s, oz = -Math.sin(ry) * 0.171 * s;
      b.add(GEO.cylC, '#c39a48', { pos: [x + ox, 0.22, z + oz], rot: [0, ry, Math.PI / 2], scale: [0.15, 0.01, 0.15] });
      b.add(GEO.cylC, '#b08840', { pos: [x + ox * 1.03, 0.22, z + oz * 1.03], rot: [0, ry, Math.PI / 2], scale: [0.07, 0.01, 0.07] });
    }
    ao.push({ x, z, r: 0.5, a: 0.35 });
  }
}

function addCoop(b, ao) {
  const { x, z } = COOP;
  for (const [dx, dz] of [[-0.33, -0.23], [0.33, -0.23], [-0.33, 0.23], [0.33, 0.23]]) b.add(GEO.box, '#6b4a2f', { pos: [x + dx, 0, z + dz], scale: [0.05, 0.14, 0.05] });
  b.add(GEO.box, '#b47a4a', { pos: [x, 0.12, z], scale: [0.76, 0.44, 0.56], ao: [0, 0.6, 0.8] });
  for (let i = 0; i < 4; i++) b.add(GEO.box, '#9a6438', { pos: [x - 0.285 + i * 0.19, 0.12, z + 0.282], scale: [0.012, 0.44, 0.01] });
  const top = 0.56, ridge = 0.2, half = 0.36;
  b.add(GEO.boxC, '#a8553a', { pos: [x, top + ridge / 2, z + half / 2], rot: [Math.atan2(ridge, half), 0, 0], scale: [0.88, 0.04, Math.hypot(ridge, half) + 0.04] });
  b.add(GEO.boxC, '#a8553a', { pos: [x, top + ridge / 2, z - half / 2], rot: [-Math.atan2(ridge, half), 0, 0], scale: [0.88, 0.04, Math.hypot(ridge, half) + 0.04] });
  b.add(GEO.box, '#2c2018', { pos: [x + 0.12, 0.13, z + 0.285], scale: [0.16, 0.2, 0.01] });
  b.add(GEO.boxC, '#9a7652', { pos: [x + 0.12, 0.07, z + 0.45], rot: [0.55, 0, 0], scale: [0.14, 0.015, 0.36] });
  b.add(GEO.box, '#e8d9a0', { pos: [x - 0.18, 0.36, z + 0.283], scale: [0.14, 0.1, 0.01] });
  ao.push({ type: 'rect', x, z, w: 0.95, d: 0.75, a: 0.45, blur: 0.25 });
}

function addGrill(b, ao) {
  const { x, z } = GRILL;
  b.add(GEO.box, BRICK, { pos: [x, 0, z], scale: [0.6, 0.5, 1.25], ao: [0, 0.5, 0.75] });
  for (let i = 1; i < 4; i++) b.add(GEO.box, '#9c4f33', { pos: [x + 0.301, i * 0.125, z], scale: [0.005, 0.012, 1.25] });
  b.add(GEO.box, BRICK, { pos: [x - 0.26, 0.5, z], scale: [0.08, 0.62, 1.25], ao: [0, 1, 0.8] });
  for (const s of [-1, 1]) b.add(GEO.box, BRICK, { pos: [x, 0.5, z + s * 0.6], scale: [0.6, 0.62, 0.06] });
  b.add(GEO.box, '#a1543a', { pos: [x, 1.12, z], scale: [0.68, 0.1, 1.33] });
  b.add(GEO.cone4, '#a1543a', { pos: [x - 0.02, 1.22, z], scale: [0.45, 0.42, 0.9] });
  b.add(GEO.box, '#a1543a', { pos: [x - 0.03, 1.4, z], scale: [0.2, 0.55, 0.2] });
  b.add(GEO.box, '#6b3a28', { pos: [x - 0.03, 1.95, z], scale: [0.27, 0.05, 0.27] });
  b.add(GEO.box, '#333', { pos: [x + 0.04, 0.53, z], scale: [0.46, 0.02, 1.08] });
  const r = rng(81);
  for (let i = 0; i < 7; i++) b.add(GEO.box, i % 3 ? '#8a3b26' : '#a65a35', { pos: [x + 0.04 + (r() - 0.5) * 0.2, 0.55, z - 0.42 + i * 0.14], rot: [0, r() * 0.4, 0], scale: [0.16, 0.035, 0.09] });
  for (let i = 0; i < 4; i++) b.add(GEO.cylC, '#9c3f2a', { pos: [x + 0.18, 0.57, z - 0.3 + i * 0.2], rot: [Math.PI / 2, 0, 0], scale: [0.022, 0.14, 0.022] });
  // Leña
  for (let i = 0; i < 6; i++) b.add(GEO.cylC, i % 2 ? '#7a5434' : '#8c6340', { pos: [x - 0.05 + (i % 3) * 0.1, 0.05 + Math.floor(i / 3) * 0.09, z + 1.0], rot: [Math.PI / 2, 0, 0.1 * i], scale: [0.045, 0.42, 0.045] });
  ao.push({ type: 'rect', x, z, w: 0.8, d: 1.45, a: 0.5, blur: 0.3 });
}

function addFirePit(b, ao) {
  const { x, z } = FIRE;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    b.add(GEO.dodeca, i % 2 ? '#8f8678' : '#a39a8c', { pos: [x + Math.cos(a) * 0.32, 0.04, z + Math.sin(a) * 0.32], rot: [a, a * 2, 0], scale: [0.08, 0.06, 0.07] });
  }
  for (let i = 0; i < 3; i++) b.add(GEO.cylC, '#4a3020', { pos: [x, 0.05, z], rot: [Math.PI / 2, (i / 3) * Math.PI, 0.15], scale: [0.04, 0.5, 0.04] });
  // Dos cruces con cordero inclinadas hacia el fuego
  for (const dx of [-0.34, 0.34]) {
    const cross = matrix([x + dx, 0, z - 0.5], [0.38, dx * 0.5, 0]);
    put(b, GEO.box, '#2b2b2e', cross, [0, -0.1, 0], [0, 0, 0], [0.035, 1.35, 0.035]);
    put(b, GEO.boxC, '#2b2b2e', cross, [0, 1.0, 0], [0, 0, 0], [0.62, 0.03, 0.03]);
    put(b, GEO.ico1, '#b8692f', cross, [0, 0.78, 0.04], [0, 0, 0], [0.22, 0.3, 0.06]);
    put(b, GEO.ico1, '#d08a45', cross, [0, 0.8, 0.07], [0, 0, 0], [0.16, 0.22, 0.03]);
    for (const s of [-1, 1]) {
      put(b, GEO.boxC, '#a85f2c', cross, [s * 0.17, 0.93, 0.03], [0, 0, s * -0.7], [0.04, 0.16, 0.04]);
      put(b, GEO.boxC, '#a85f2c', cross, [s * 0.11, 0.5, 0.03], [0, 0, s * 0.35], [0.045, 0.16, 0.04]);
    }
  }
  ao.push({ x, z: z - 0.2, r: 1.0, a: 0.4 });
}

function addTable(b, ao) {
  const { x, z, len } = TABLE;
  b.add(GEO.box, '#f4f0e6', { pos: [x, 0.27, z], scale: [len + 0.06, 0.045, 0.66] });
  for (const s of [-1, 1]) b.add(GEO.box, '#ebe5d6', { pos: [x, 0.2, z + s * 0.33], scale: [len + 0.06, 0.08, 0.008] });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(GEO.box, '#5b3d27', { pos: [x + dx * (len / 2 - 0.1), 0, z + dz * 0.25], scale: [0.05, 0.27, 0.05] });
  for (const s of [-1, 1]) {
    b.add(GEO.box, WOOD, { pos: [x, 0.13, z + s * 0.5], scale: [len - 0.1, 0.035, 0.18] });
    for (const dx of [-1, 0, 1]) b.add(GEO.box, '#6b4a2f', { pos: [x + dx * (len / 2 - 0.2), 0, z + s * 0.5], scale: [0.04, 0.13, 0.14] });
  }
  b.add(GEO.box, WOOD, { pos: [x - len / 2 - 0.25, 0.13, z], scale: [0.2, 0.035, 0.2] });
  b.add(GEO.box, WOOD, { pos: [x - len / 2 - 0.34, 0.13, z], scale: [0.03, 0.25, 0.2] });
  const top = 0.315;
  const seats = [[-0.95, -0.17], [-0.33, -0.17], [0.33, -0.17], [1.0, -0.17], [-0.67, 0.17], [0, 0.17], [0.67, 0.17]];
  for (const [dx, dz] of seats) {
    b.add(GEO.cyl, '#ffffff', { pos: [x + dx, top, z + dz], scale: [0.075, 0.01, 0.075] });
    b.add(GEO.cyl, '#c7b9a6', { pos: [x + dx, top + 0.01, z + dz], scale: [0.045, 0.006, 0.045] });
  }
  b.add(GEO.box, '#8a5a33', { pos: [x, top, z], scale: [0.5, 0.025, 0.24] });
  const r = rng(91);
  for (let i = 0; i < 8; i++) b.add(GEO.box, i % 2 ? '#7a3a22' : '#93502c', { pos: [x - 0.18 + (i % 4) * 0.12, top + 0.025, z - 0.05 + Math.floor(i / 4) * 0.1], rot: [0, r(), 0], scale: [0.1, 0.03, 0.06] });
  for (const dx of [-0.75, 0.55, 1.15]) {
    b.add(GEO.cyl, '#1f3b26', { pos: [x + dx, top, z + 0.02], scale: [0.03, 0.13, 0.03] });
    b.add(GEO.cyl, '#1f3b26', { pos: [x + dx, top + 0.13, z + 0.02], scale: [0.012, 0.05, 0.012] });
    b.add(GEO.cyl, '#e8dcc0', { pos: [x + dx, top + 0.05, z + 0.02], scale: [0.031, 0.04, 0.031] });
  }
  b.add(GEO.cyl, '#2f86a8', { pos: [x - 0.35, top, z - 0.05], scale: [0.032, 0.13, 0.032] });
  b.add(GEO.cyl, '#c9ced2', { pos: [x - 0.35, top + 0.13, z - 0.05], scale: [0.024, 0.05, 0.024] });
  b.add(GEO.cyl, '#c99a5a', { pos: [x + 0.32, top, z + 0.05], scale: [0.08, 0.05, 0.08] });
  for (let i = 0; i < 3; i++) b.add(GEO.ico, '#e0b36a', { pos: [x + 0.29 + i * 0.03, top + 0.06, z + 0.03 + (i % 2) * 0.04], scale: 0.035 });
  b.add(GEO.sphere, '#6aa94a', { pos: [x - 0.95, top + 0.01, z + 0.03], scale: [0.08, 0.04, 0.08] });
  ao.push({ type: 'rect', x, z, w: len + 0.3, d: 1.3, a: 0.4, blur: 0.25 });
}

function addTango(b, ao) {
  const { x, z } = TANGO;
  b.add(GEO.box, '#6e4a2e', { pos: [x, 0, z], scale: [1.56, 0.05, 1.2] });
  for (let i = 0; i < 9; i++) b.add(GEO.box, i % 2 ? '#a77a4c' : '#b8895a', { pos: [x - 0.7 + i * 0.175, 0.05, z], scale: [0.17, 0.012, 1.14] });
  // Silla del bandoneonista
  const cx = x + 0.92, cz = z - 0.62;
  b.add(GEO.box, '#5b3d27', { pos: [cx, 0.13, cz], scale: [0.2, 0.03, 0.2] });
  b.add(GEO.box, '#5b3d27', { pos: [cx + 0.02, 0.13, cz - 0.1], scale: [0.2, 0.28, 0.03] });
  for (const [dx, dz] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) b.add(GEO.box, '#4a3020', { pos: [cx + dx, 0, cz + dz], scale: [0.025, 0.13, 0.025] });
  // Farol porteño
  const fx = x + 1.0, fz = z + 0.78;
  b.add(GEO.cyl, '#1e1f22', { pos: [fx, 0, fz], scale: [0.06, 0.08, 0.06] });
  b.add(GEO.cyl, '#1e1f22', { pos: [fx, 0.08, fz], scale: [0.025, 1.3, 0.025] });
  b.add(GEO.cone4, '#1e1f22', { pos: [fx, 1.62, fz], scale: [0.12, 0.1, 0.12] });
  ao.push({ type: 'rect', x, z, w: 1.7, d: 1.35, a: 0.3, blur: 0.2 });
  ao.push({ x: fx, z: fz, r: 0.35, a: 0.3 });
  return { lamp: new THREE.Vector3(fx, 1.5, fz), chair: new THREE.Vector3(cx, 0.16, cz) };
}

function addMateCircle(b, ao) {
  const { x, z } = MATE;
  const seats = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const sx = x + Math.cos(a) * 0.44, sz = z + Math.sin(a) * 0.44;
    const ry = yawTo(x - sx, z - sz);
    const back = [sx - Math.sin(ry) * 0.09, sz - Math.cos(ry) * 0.09];
    b.add(GEO.box, '#d8b56a', { pos: [sx, 0.12, sz], rot: [0, ry, 0], scale: [0.18, 0.03, 0.18] });
    b.add(GEO.box, '#7a5434', { pos: [back[0], 0.12, back[1]], rot: [0, ry, 0], scale: [0.18, 0.26, 0.025] });
    for (const [dx, dz] of [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]]) b.add(GEO.box, '#7a5434', { pos: [sx + dx, 0, sz + dz], scale: [0.02, 0.12, 0.02] });
    seats.push({ x: sx, z: sz, ry });
  }
  // Mesita con termo y pava
  const tx = x + 0.72, tz = z - 0.05;
  b.add(GEO.cyl, '#8b6744', { pos: [tx, 0, tz], scale: [0.025, 0.22, 0.025] });
  b.add(GEO.cyl, '#9c7650', { pos: [tx, 0.22, tz], scale: [0.13, 0.02, 0.13] });
  b.add(GEO.cyl, '#2f6b3a', { pos: [tx - 0.04, 0.24, tz], scale: [0.03, 0.17, 0.03] });
  b.add(GEO.cyl, '#c9ced2', { pos: [tx - 0.04, 0.41, tz], scale: [0.026, 0.03, 0.026] });
  b.add(GEO.sphere, '#3b6fa0', { pos: [tx + 0.05, 0.28, tz + 0.03], scale: [0.05, 0.045, 0.05] });
  b.add(GEO.cyl, '#3b6fa0', { pos: [tx + 0.1, 0.27, tz + 0.03], rot: [0, 0, -0.8], scale: [0.008, 0.06, 0.008] });
  ao.push({ x, z, r: 0.9, a: 0.3 });
  return seats;
}

// Guirnaldas de lamparitas sobre el patio.
function buildLights(b) {
  const { x0, x1, z0, z1 } = PATIO;
  const H = 1.75;
  const poles = { bl: [x0 + 0.15, z0 + 0.25], br: [x1 - 0.2, z0 + 0.25], fl: [x0 + 0.15, z1 - 0.15], fr: [x1 - 0.2, z1 - 0.15] };
  Object.values(poles).forEach(([x, z]) => b.add(GEO.cyl6, '#5b3d27', { pos: [x, 0, z], scale: [0.035, H, 0.035], ao: [0, 0.2, 0.6] }));
  const wires = [['bl', 'br'], ['fl', 'fr'], ['bl', 'fr'], ['fl', 'br']];
  const bulbs = [];
  const palette = ['#ffe9a8', '#ffe9a8', '#ff6b5b', '#ffe9a8', '#7fd16b', '#ffe9a8', '#6bb7ff', '#ffd23f'];
  let n = 0;
  for (const [a, c] of wires) {
    const A = poles[a], B = poles[c];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(new THREE.Vector3(lerp(A[0], B[0], t), H - 0.05 - 0.32 * 4 * t * (1 - t), lerp(A[1], B[1], t)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = colored(new THREE.TubeGeometry(curve, 24, 0.006, 3, false), '#2a2a2a');
    b.addColored(tube);
    const count = Math.round(len / 0.32);
    for (let i = 1; i < count; i++) {
      const p = curve.getPointAt(i / count);
      bulbs.push(colored(GEO.sphere, palette[n++ % palette.length], { pos: [p.x, p.y - 0.035, p.z], scale: 0.032 }));
    }
  }
  const m = new THREE.Mesh(mergeColored(bulbs), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  return m;
}

/* ------------------------------ Animado ------------------------------- */

function noteTexture(ch) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#3a2440';
  g.font = '700 54px "Segoe UI Symbol", "Apple Symbols", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 32, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildPatio(batch, ao) {
  addPasture(batch, ao);
  addCoop(batch, ao);
  addGrill(batch, ao);
  addFirePit(batch, ao);
  addTable(batch, ao);
  const tango = addTango(batch, ao);
  const mateSeats = addMateCircle(batch, ao);

  const group = new THREE.Group();
  group.add(buildLights(batch));
  const updates = [];
  const tmp = new THREE.Vector3();

  // Brasas y fuego (emisivos)
  const ember = new THREE.MeshStandardMaterial({ color: '#ff7a2a', emissive: '#ff4a12', emissiveIntensity: 1.0, flatShading: true, toneMapped: false });
  const flameO = new THREE.MeshBasicMaterial({ color: '#ff8a1e', toneMapped: false });
  const flameI = new THREE.MeshBasicMaterial({ color: '#ffd23a', toneMapped: false });
  const grillEmbers = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 1.0), ember);
  grillEmbers.position.set(GRILL.x + 0.04, 0.505, GRILL.z);
  const pitEmbers = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.04, 9), ember);
  pitEmbers.position.set(FIRE.x, 0.03, FIRE.z);
  group.add(grillEmbers, pitEmbers);
  const flames = [];
  const fr = rng(17);
  for (let i = 0; i < 7; i++) {
    const inner = i >= 4;
    const f = new THREE.Mesh(new THREE.ConeGeometry(inner ? 0.06 : 0.09, 1, 6).translate(0, 0.5, 0), inner ? flameI : flameO);
    const a = fr() * TAU, d = inner ? 0.04 : 0.12;
    f.position.set(FIRE.x + Math.cos(a) * d, 0.04, FIRE.z + Math.sin(a) * d);
    f.userData = { h: inner ? 0.22 : 0.32 + fr() * 0.12, k1: 17 + i * 3, k2: 29 + i * 2, ph: fr() };
    flames.push(f);
    group.add(f);
  }
  updates.push((T) => {
    for (const f of flames) {
      const { h, k1, k2, ph } = f.userData;
      const s = 0.78 + 0.16 * wave(T, k1, ph) + 0.08 * wave(T, k2, ph * 2);
      f.scale.set(1 + 0.12 * wave(T, k2, ph), h * s, 1 + 0.12 * wave(T, k1, ph + 0.3));
      f.rotation.z = 0.08 * wave(T, k1 + 4, ph);
    }
    ember.emissiveIntensity = 0.9 + 0.25 * wave(T, 23) + 0.1 * wave(T, 41);
  });

  // Humo
  const smoke = (origin, n, color, opacity, rise, size, k = 6) => {
    const puffs = buildPuffs(n, color, opacity);
    puffs.forEach((o) => group.add(o));
    updates.push((T) => {
      puffs.forEach((o, i) => {
        const f = (((T * k + i / n) % 1) + 1) % 1;
        o.position.set(origin.x + f * 0.5 + Math.sin(f * 6 + i) * 0.06, origin.y + f * rise, origin.z - f * 0.3);
        o.scale.setScalar(lerp(size * 0.3, size, f));
        o.material.opacity = o.userData.base * (1 - f) * smoothstep(0, 0.12, f);
      });
    });
  };
  smoke(new THREE.Vector3(GRILL.x - 0.03, 2.0, GRILL.z), 6, '#f2f2f2', 0.7, 1.6, 0.28);
  smoke(new THREE.Vector3(FIRE.x, 0.5, FIRE.z), 6, '#d8d4cf', 0.45, 1.3, 0.24, 5);

  // Asador en la parrilla
  {
    const p = makePerson({ shirt: '#f2efe6', pants: '#2f3d5e', skin: SKINS[2], hat: 'boina' });
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.01), mat('#7a1f2b'));
    apron.position.set(0, 0.1, 0.11);
    p.upper.add(apron);
    p.root.position.set(GRILL.x + 0.58, 0, GRILL.z + 0.12);
    p.root.rotation.y = -Math.PI / 2;
    const tongs = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.18), mat('#777'));
    tongs.position.set(0, -0.21, 0.08);
    p.armR.add(tongs);
    group.add(p.root);
    updates.push((T) => {
      const flip = smoothstep(0.55, 0.95, wave(T, 5));
      p.armR.rotation.x = -1.0 - 0.6 * flip;
      p.armR.rotation.z = 0.15 * wave(T, 10);
      p.armL.rotation.x = -0.25 - 0.3 * smoothstep(0.7, 1, wave(T, 3, 0.5));
      p.upper.rotation.x = 0.15;
      p.head.rotation.y = 0.7 * smoothstep(0.6, 0.9, wave(T, 2, 0.3));
    });
  }
  // Gaucho cuidando el asado a la cruz
  {
    const p = makePerson({ shirt: '#3d5a80', pants: '#2a2a2a', skin: SKINS[3], hat: 'boina' });
    p.root.position.set(FIRE.x + 0.68, 0, FIRE.z + 0.18);
    p.root.rotation.y = -Math.PI / 2 - 0.3;
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.42), mat('#5b3d27'));
    stick.position.set(0, -0.21, 0.18);
    p.armR.add(stick);
    group.add(p.root);
    updates.push((T) => {
      const poke = smoothstep(0.5, 1, wave(T, 4, 0.2));
      p.armR.rotation.x = -0.7 - 0.35 * poke;
      p.upper.rotation.x = 0.15 + 0.2 * poke;
      p.armL.rotation.x = -0.15;
    });
  }

  // Mesa larga: charla y brindis en grupo
  const diners = [
    { dx: -1.0, side: -1, shirt: '#e94f37' }, { dx: -0.33, side: -1, shirt: '#f6c445', hair: '#7a4a22', bun: true },
    { dx: 0.33, side: -1, shirt: '#3d7dd8', hat: 'boina' }, { dx: 1.0, side: -1, shirt: '#2bb3a3', hair: '#1d1d1d' },
    { dx: -0.67, side: 1, shirt: '#8e5cc9', hair: '#3a2416', bun: true }, { dx: 0, side: 1, shirt: '#ffffff', hat: 'straw' },
    { dx: 0.67, side: 1, shirt: '#3fa34d' }, { dx: -1.6, side: 0, shirt: '#7a1f33', hat: 'boina' },
  ];
  const dr = rng(23);
  diners.forEach((d, i) => {
    const p = makePerson({ shirt: d.shirt, pants: i % 2 ? '#3a3a3a' : '#2f3d5e', skin: SKINS[i % 4], hat: d.hat, hair: d.hair, bun: d.bun });
    sit(p, 0.15);
    const z = d.side ? TABLE.z + d.side * 0.5 : TABLE.z;
    p.root.position.x = TABLE.x + d.dx;
    p.root.position.z = z;
    p.root.rotation.y = d.side === -1 ? 0 : d.side === 1 ? Math.PI : Math.PI / 2;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.014, 0.05, 6), mat('#8e1b34'));
    glass.position.y = -0.22;
    p.armR.add(glass);
    group.add(p.root);
    const ph = dr();
    updates.push((T) => {
      const toast = smoothstep(0.8, 0.96, wave(T, 2, 0.08));
      const talk = smoothstep(0.3, 0.9, wave(T, 3 + (i % 3), ph));
      const sip = smoothstep(0.75, 1, wave(T, 4, ph + 0.5));
      p.armR.rotation.x = lerp(lerp(-0.75, -1.9, sip), -2.55, toast);
      p.armR.rotation.z = -0.2 * toast;
      p.armL.rotation.x = lerp(-0.7, -1.15 + 0.25 * wave(T, 13 + i, ph), talk * (1 - toast));
      p.head.rotation.y = 0.45 * wave(T, 2 + (i % 2), ph) * (1 - toast);
      p.head.rotation.x = -0.25 * toast;
      p.upper.rotation.x = 0.05 + 0.06 * Math.max(0, wave(T, 11 + i, ph)) * talk - 0.1 * toast;
    });
  });

  // Ronda de mate: el mate pasa de mano en mano
  {
    const people = mateSeats.map((s, k) => {
      const p = makePerson({ shirt: ['#f08a24', '#5b8c5a', '#c9a35c', '#2f6db5'][k], pants: k % 2 ? '#4a3b2f' : '#2f3d5e', skin: SKINS[(k + 1) % 4], hat: k === 2 ? 'straw' : null, hair: ['#3b2a20', '#7a4a22', '#1d1d1d', '#5a3b22'][k], bun: k === 1 });
      sit(p, 0.15);
      p.root.position.x = s.x;
      p.root.position.z = s.z;
      p.root.rotation.y = s.ry;
      group.add(p.root);
      return p;
    });
    const mate = new THREE.Group();
    const gourd = new THREE.Mesh(new THREE.IcosahedronGeometry(0.036, 1), mat('#7a4a26'));
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.09, 4), mat('#d7dade', { metalness: 0.6, roughness: 0.3 }));
    straw.position.set(0.01, 0.045, 0);
    straw.rotation.z = -0.3;
    mate.add(gourd, straw);
    group.add(mate);
    const handA = new THREE.Vector3(), handB = new THREE.Vector3();
    const HAND = new THREE.Vector3(0, -0.21, 0.02);
    const sipArm = (f) => {
      if (f < 0.12) return lerp(-1.35, -2.05, smoothstep(0, 0.12, f));
      if (f < 0.45) return -2.05 + 0.06 * Math.sin(f * 60);
      if (f < 0.6) return lerp(-2.05, -1.35, smoothstep(0.45, 0.6, f));
      return -1.35;
    };
    updates.push((T) => {
      const turns = T * 8;
      const holder = Math.floor(turns) % 4, next = (holder + 1) % 4, f = turns - Math.floor(turns);
      people.forEach((p, k) => {
        let arm = -0.35;
        if (k === holder) arm = sipArm(f);
        else if (k === next) arm = lerp(-0.35, -1.35, smoothstep(0.55, 0.75, f));
        p.armR.rotation.x = arm;
        p.armL.rotation.x = -0.55 + 0.1 * wave(T, 3, k * 0.25);
        p.head.rotation.y = k === holder ? 0 : 0.25 * wave(T, 2, k * 0.3);
        p.root.updateMatrixWorld(true);
      });
      people[holder].armR.localToWorld(handA.copy(HAND));
      if (f > 0.8) {
        people[next].armR.localToWorld(handB.copy(HAND));
        handA.lerp(handB, smoothstep(0.8, 1, f));
      }
      mate.position.copy(handA);
      mate.position.y += 0.02;
    });
  }

  // Tango: pareja girando sobre la tarima y bandoneonista
  {
    const man = makePerson({ shirt: '#22232a', pants: '#16161a', skin: SKINS[1], hat: 'fedora' });
    const woman = makePerson({ shirt: '#c8102e', pants: '#3b2420', skin: SKINS[0], hair: '#141414', bun: true, dress: '#c8102e', scale: 1.15 });
    group.add(man.root, woman.root);
    const f = new THREE.Vector3();
    updates.push((T) => {
      const cx = TANGO.x + 0.2 * Math.cos(TAU * T * 2), cz = TANGO.z + 0.14 * Math.sin(TAU * T * 2);
      const th = TAU * T * 3 + 0.7 * Math.sin(TAU * T * 6);
      f.set(Math.sin(th), 0, Math.cos(th));
      man.root.position.set(cx - f.x * 0.1, 0.05, cz - f.z * 0.1);
      woman.root.position.set(cx + f.x * 0.1, 0.05, cz + f.z * 0.1);
      man.root.rotation.y = th;
      woman.root.rotation.y = th + Math.PI;
      const step = TAU * T * 24;
      walkPose(man, step, 0.7);
      walkPose(woman, step + Math.PI, 0.7);
      const boleo = smoothstep(0.82, 1, wave(T, 4, 0.2));
      woman.legR.rotation.x = lerp(woman.legR.rotation.x, 1.35, boleo);
      man.armL.rotation.set(-1.45, 0, -0.45);
      man.armR.rotation.set(-1.05, 0, 0.45);
      woman.armR.rotation.set(-1.45, 0, 0.45);
      woman.armL.rotation.set(-1.55, 0, -0.3);
      man.upper.rotation.x = 0.12;
      woman.upper.rotation.x = 0.08 - 0.12 * boleo;
      woman.head.rotation.y = 0.5;
      man.head.rotation.y = -0.3;
    });

    const musician = makePerson({ shirt: '#2b2b30', pants: '#1c1c20', skin: SKINS[2], hat: 'fedora' });
    sit(musician, tango.chair.y);
    musician.root.position.x = tango.chair.x;
    musician.root.position.z = tango.chair.z;
    musician.root.rotation.y = -0.35;
    const bando = new THREE.Group();
    bando.position.set(0, 0.06, 0.15);
    musician.upper.add(bando);
    const endGeo = new THREE.BoxGeometry(0.06, 0.13, 0.12);
    const endL = new THREE.Mesh(endGeo, mat('#151517'));
    const endR = new THREE.Mesh(endGeo, mat('#151517'));
    const bellows = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 0.11), mat('#7a1f2b'));
    bando.add(endL, endR, bellows);
    for (const m of [endL, endR, bellows]) m.castShadow = true;
    group.add(musician.root);
    updates.push((T) => {
      const w = 0.06 + 0.12 * (0.5 + 0.5 * wave(T, 10));
      bellows.scale.x = w;
      endL.position.x = -(w / 2 + 0.03);
      endR.position.x = w / 2 + 0.03;
      musician.armL.rotation.set(-1.25, 0, -0.15 - w * 1.6);
      musician.armR.rotation.set(-1.25, 0, 0.15 + w * 1.6);
      musician.head.rotation.z = 0.12 * wave(T, 10, 0.25);
      musician.upper.rotation.x = 0.1 + 0.05 * wave(T, 10);
    });

    // Notas musicales flotando
    const notes = ['♪', '♫', '♪'].map((ch) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTexture(ch), transparent: true, depthWrite: false }));
      group.add(s);
      return s;
    });
    updates.push((T) => {
      notes.forEach((s, i) => {
        const f = (((T * 5 + i / 3) % 1) + 1) % 1;
        s.position.set(tango.chair.x - 0.1 + Math.sin(f * 7 + i) * 0.12 - f * 0.25, 0.75 + f * 0.9, tango.chair.z + 0.1);
        s.scale.setScalar(0.18 + 0.06 * f);
        s.material.opacity = smoothstep(0, 0.15, f) * (1 - smoothstep(0.7, 1, f));
      });
    });

    // Público mirando
    [[TANGO.x - 0.98, TANGO.z + 0.7, '#f6c445', '#4a3b2f'], [TANGO.x - 1.05, TANGO.z - 0.35, '#e86f9a', '#2f3d5e']].forEach(([x, z, shirt, pants], i) => {
      const p = makePerson({ shirt, pants, skin: SKINS[(i + 2) % 4], hair: i ? '#5a2a1a' : '#2b2b2b', bun: i === 1 });
      p.root.position.set(x, 0, z);
      p.root.rotation.y = yawTo(TANGO.x - x, TANGO.z - z);
      group.add(p.root);
      updates.push((T) => {
        p.upper.rotation.z = 0.06 * wave(T, 5, i * 0.3);
        p.head.rotation.y = 0.3 * wave(T, 3, i * 0.5);
        const clap = smoothstep(0.85, 1, wave(T, 2, 0.6 + i * 0.1));
        p.armL.rotation.set(-0.2 - 1.0 * clap, 0, -0.35 * clap * (1 + 0.5 * wave(T, 40)));
        p.armR.rotation.set(-0.2 - 1.0 * clap, 0, 0.35 * clap * (1 + 0.5 * wave(T, 40)));
      });
    });
  }

  // Vacas lecheras
  {
    const rot = (yaw, lx, lz) => [lx * Math.cos(yaw) + lz * Math.sin(yaw), -lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    const cowA = buildCow({ seed: 2 });
    cowA.g.position.set(-16.05, 0, -2.3);
    cowA.g.rotation.y = -0.7;
    const cowB = buildCow({ seed: 9 });
    const yawB = -0.9;
    cowB.g.position.set(-14.75, 0, -1.3);
    cowB.g.rotation.y = yawB;
    const cowC = buildCow({ seed: 15 });
    const calf = buildCow({ seed: 21 });
    calf.g.scale.setScalar(0.6);
    group.add(cowA.g, cowB.g, cowC.g, calf.g);

    // Ordeñe a mano
    const [mx, mz] = rot(yawB, 0.3, -0.12);
    const milker = makePerson({ shirt: '#c9a35c', pants: '#3a3a3a', skin: SKINS[1], hat: 'straw' });
    sit(milker, 0.11);
    milker.root.position.x = cowB.g.position.x + mx;
    milker.root.position.z = cowB.g.position.z + mz;
    milker.root.rotation.y = yawB - Math.PI / 2;
    milker.upper.rotation.x = 0.35;
    group.add(milker.root);
    const [bx, bz] = rot(yawB, 0.1, -0.16);
    batch.add(GEO.cyl, '#b9c0c4', { pos: [cowB.g.position.x + bx, 0, cowB.g.position.z + bz], scale: [0.06, 0.1, 0.06] });
    batch.add(GEO.cyl, '#fbfaf5', { pos: [cowB.g.position.x + bx, 0.095, cowB.g.position.z + bz], scale: [0.055, 0.01, 0.055] });
    const [sx, sz] = rot(yawB, 0.32, -0.12);
    batch.add(GEO.cyl6, '#7a5434', { pos: [cowB.g.position.x + sx, 0, cowB.g.position.z + sz], scale: [0.07, 0.11, 0.07] });

    const A = new THREE.Vector3(-16.3, 0, 1.05), B = new THREE.Vector3(-14.35, 0, 0.45);
    const yawAB = yawTo(B.x - A.x, B.z - A.z);
    updates.push((T) => {
      const graze = smoothstep(-0.3, 0.5, wave(T, 2, 0.15));
      cowA.neck.rotation.x = lerp(-0.1, 0.95, graze) + 0.04 * wave(T, 20) * graze;
      cowA.tail.rotation.z = 0.3 * wave(T, 5);
      cowB.neck.rotation.x = 0.15 + 0.1 * wave(T, 3, 0.4);
      cowB.neck.rotation.y = 0.2 * wave(T, 1, 0.2);
      cowB.tail.rotation.z = 0.35 * wave(T, 7, 0.3);
      milker.armL.rotation.x = -1.05 + 0.22 * wave(T, 36);
      milker.armR.rotation.x = -1.05 - 0.22 * wave(T, 36);

      const s = pingPong(T, 1, 0.22, 0.05);
      const cyc = TAU * T * 16;
      cowC.g.position.lerpVectors(A, B, s.p);
      cowC.g.rotation.y = s.dir > 0 ? yawAB : yawAB + Math.PI;
      const amt = s.moving ? 1 : 0;
      cowC.legs.forEach((l, i) => (l.rotation.x = 0.32 * amt * Math.sin(cyc + (i === 0 || i === 3 ? 0 : Math.PI))));
      cowC.neck.rotation.x = s.moving ? 0.15 + 0.05 * Math.sin(cyc * 2) : lerp(0.1, 0.9, smoothstep(-0.2, 0.6, wave(T, 3)));
      cowC.tail.rotation.z = 0.25 * wave(T, 6, 0.6);
      const ys = cowC.g.rotation.y;
      const [ox, oz] = rot(ys, 0.42, -0.25);
      calf.g.position.set(cowC.g.position.x + ox, 0, cowC.g.position.z + oz);
      calf.g.rotation.y = ys;
      calf.legs.forEach((l, i) => (l.rotation.x = 0.4 * amt * Math.sin(cyc * 1.5 + (i === 0 || i === 3 ? 0 : Math.PI))));
      calf.neck.rotation.x = 0.1 + 0.15 * wave(T, 4, 0.2);
      calf.tail.rotation.z = 0.4 * wave(T, 9);
    });
  }

  // Gallinas y gallo
  {
    const hens = [
      { c: [-12.95, -1.75], a: [0.32, 0.25], f: [2, 3], ph: 0.1, color: '#f6f1e6', wing: '#e4dccb' },
      { c: [-12.72, -0.85], a: [0.3, 0.3], f: [3, 2], ph: 0.4, color: '#b5652d', wing: '#8e4c1f' },
      { c: [-12.95, 0.15], a: [0.28, 0.35], f: [1, 2], ph: 0.7, color: '#f6f1e6', wing: '#e4dccb' },
      { c: [-12.62, 1.0], a: [0.25, 0.3], f: [2, 1], ph: 0.2, color: '#8f8f8f', wing: '#6d6d6d' },
    ];
    const pos = (h, T) => {
      const w = T + (0.6 * Math.sin(TAU * T * 3 + h.ph * 5)) / (TAU * 3);
      return [h.c[0] + h.a[0] * Math.sin(TAU * (h.f[0] * w + h.ph)), h.c[1] + h.a[1] * Math.sin(TAU * (h.f[1] * w + h.ph * 1.7))];
    };
    hens.forEach((h) => {
      const c = buildChicken({ color: h.color, wing: h.wing });
      group.add(c.g);
      updates.push((T) => {
        const [x, z] = pos(h, T);
        const [x2, z2] = pos(h, T + 0.002);
        const speed = Math.hypot(x2 - x, z2 - z);
        c.g.position.set(x, 0, z);
        if (speed > 1e-5) c.g.rotation.y = yawTo(x2 - x, z2 - z);
        const peck = smoothstep(0.55, 0.95, wave(T, 11, h.ph)) * (speed < 0.0011 ? 1 : 0.4);
        c.body.rotation.x = 0.35 * peck;
        c.head.rotation.x = 1.1 * peck;
        c.head.position.z = 0.06 + 0.012 * Math.sin(TAU * T * 60);
      });
    });
    const rooster = buildChicken({ rooster: true, color: '#b5512a', wing: '#7a2e17' });
    rooster.g.position.set(COOP.x - 0.1, 0.76, COOP.z);
    rooster.g.rotation.y = 0.7;
    group.add(rooster.g);
    updates.push((T) => {
      const crow = smoothstep(0.75, 0.95, wave(T, 3, 0.15));
      rooster.head.rotation.x = -0.75 * crow + 0.1 * wave(T, 15) * (1 - crow);
      rooster.body.rotation.x = -0.25 * crow;
      rooster.g.rotation.y = 0.7 + 0.5 * wave(T, 1, 0.3);
    });
  }

  return {
    group,
    lamp: tango.lamp,
    update(T) {
      for (const u of updates) u(T);
    },
  };
}
