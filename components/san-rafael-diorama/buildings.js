import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO, TAU, rng, Batch } from './utils.js';
import {
  BODEGA, HOUSE, WINDMILL, CORRAL, PERGOLA, SIGN, ROAD, ACEQUIA_Z, riverXAt, W,
} from './layout.js';

// Prisma triangular (hastial): base en y=0 de -0.5..0.5 en z, cumbrera en y=1, largo 1 en x.
const tri = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
const PRISM = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);

const WALL = '#f1e6cf';
const ROOF = '#c8643b';
const WOOD = '#8b6744';
const DARK_WOOD = '#5b3a22';

function gableRoof(b, { x, z, w, d, top, pitch = 0.5, over = 0.25, color = ROOF, wall = WALL }) {
  const ridge = (d / 2) * Math.tan(pitch);
  b.add(PRISM, wall, { pos: [x, top, z], scale: [w, ridge, d] });
  const half = d / 2 + over;
  const slab = half / Math.cos(pitch);
  for (const s of [1, -1]) {
    b.add(GEO.boxC, color, {
      pos: [x, top + ridge - (half / 2) * Math.tan(pitch) + 0.035, z + (s * half) / 2],
      rot: [s * pitch, 0, 0], scale: [w + over * 1.2, 0.07, slab],
    });
  }
  b.add(GEO.boxC, '#a94f2e', { pos: [x, top + ridge + 0.04, z], scale: [w + over * 1.2, 0.07, 0.1] });
  return ridge;
}

function archWindow(b, x, y, z, { w = 0.26, h = 0.36, glass = '#4c5b69', frame = '#d9c9a8', face = 'z' } = {}) {
  const rot = face === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0];
  const dx = face === 'z' ? 0 : 0.015, dz = face === 'z' ? 0.015 : 0;
  b.add(GEO.box, frame, { pos: [x, y - 0.03, z], rot, scale: [w + 0.07, h + 0.06, 0.04] });
  b.add(GEO.box, glass, { pos: [x + dx, y, z + dz], rot, scale: [w, h, 0.04] });
  b.add(GEO.halfCyl, glass, { pos: [x + dx, y + h, z + dz], rot, scale: [w / 2, w / 2, 0.04] });
}

/* ----------------------------- Bodega ----------------------------- */
function addBodega(b, tanksBatch, ao) {
  const { x, z, w, d, h } = BODEGA;
  const front = z + d / 2;
  b.add(GEO.box, '#cdb995', { pos: [x, 0, z], scale: [w + 0.06, 0.2, d + 0.06] });
  b.add(GEO.box, WALL, { pos: [x, 0, z], scale: [w, h, d], ao: [0, 0.35, 0.78] });
  gableRoof(b, { x, z, w, d, top: h });

  // Frontón central con puerta en arco y cartel
  const fx = x, fw = 1.9, fh = h + 0.95;
  b.add(GEO.box, '#f6ecd8', { pos: [fx, 0, front + 0.1], scale: [fw, fh, 0.24], ao: [0, 0.3, 0.8] });
  b.add(PRISM, '#f6ecd8', { pos: [fx, fh, front + 0.1], rot: [0, Math.PI / 2, 0], scale: [0.24, 0.32, fw] });
  b.add(GEO.box, '#e2d3b6', { pos: [fx, fh - 0.08, front + 0.24], scale: [fw + 0.08, 0.08, 0.04] });
  b.add(GEO.box, '#d9c9a8', { pos: [fx, 0, front + 0.22], scale: [0.78, 0.86, 0.04] });
  b.add(GEO.box, DARK_WOOD, { pos: [fx, 0, front + 0.235], scale: [0.62, 0.78, 0.04] });
  b.add(GEO.halfCyl, DARK_WOOD, { pos: [fx, 0.78, front + 0.235], scale: [0.31, 0.31, 0.04] });
  b.add(GEO.box, '#3d2716', { pos: [fx, 0, front + 0.255], scale: [0.02, 0.9, 0.02] });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) archWindow(b, fx + side * (1.35 + i * 0.75), 0.48, front);
  }
  archWindow(b, x + w / 2, 0.48, z - 0.4, { face: 'x' });
  archWindow(b, x + w / 2, 0.48, z + 0.45, { face: 'x' });

  // Torre mirador
  const tx = x - w / 2 + 0.55, tz = z - 0.35;
  b.add(GEO.box, '#eadcc0', { pos: [tx, 0, tz], scale: [1.0, 2.45, 1.0], ao: [0, 0.25, 0.8] });
  b.add(GEO.box, '#dccbaa', { pos: [tx, 2.38, tz], scale: [1.1, 0.1, 1.1] });
  b.add(GEO.cone4, ROOF, { pos: [tx, 2.48, tz], scale: [0.8, 0.65, 0.8] });
  archWindow(b, tx, 1.65, tz + 0.5, { w: 0.22, h: 0.3 });
  archWindow(b, tx + 0.5, 1.65, tz, { w: 0.22, h: 0.3, face: 'x' });

  // Anexo
  const nx = x + w / 2 + 0.5, nz = z - 0.35;
  b.add(GEO.box, '#e8dcc5', { pos: [nx, 0, nz], scale: [1.0, 0.95, 1.6], ao: [0, 0.35, 0.8] });
  gableRoof(b, { x: nx, z: nz, w: 1.0, d: 1.6, top: 0.95, pitch: 0.42, over: 0.12, wall: '#e8dcc5' });
  b.add(GEO.box, '#6b5848', { pos: [nx + 0.5, 0, nz + 0.2], scale: [0.04, 0.6, 0.5] });

  ao.push({ type: 'rect', x, z, w: w + 0.3, d: d + 0.4, a: 0.5, blur: 0.45 });
  ao.push({ type: 'rect', x: nx, z: nz, w: 1.2, d: 1.8, a: 0.45, blur: 0.35 });

  // Tanques de acero inoxidable
  for (let i = 0; i < 3; i++) {
    const cx = x + w / 2 + 1.55 + i * 0.78, cz = z - 0.75;
    tanksBatch.add(GEO.cyl, '#d7dde2', { pos: [cx, 0.12, cz], scale: [0.33, 1.6, 0.33], ao: [0, 0.4, 0.7] });
    tanksBatch.add(GEO.cone, '#e8ecef', { pos: [cx, 1.72, cz], scale: [0.33, 0.22, 0.33] });
    for (const y of [0.55, 1.2]) tanksBatch.add(GEO.cyl, '#b9c1c7', { pos: [cx, y, cz], scale: [0.34, 0.04, 0.34] });
    for (const a of [0.4, 2.5, 4.6]) tanksBatch.add(GEO.cyl6, '#9aa3aa', { pos: [cx + Math.cos(a) * 0.26, 0, cz + Math.sin(a) * 0.26], scale: [0.025, 0.2, 0.025] });
    ao.push({ x: cx + 0.12, z: cz - 0.05, r: 0.6, a: 0.42 });
  }

  // Barricas apiladas
  const bx = x + 1.25, bz = front + 0.55;
  const barrel = (px, py, pz) => {
    b.add(GEO.cylC, '#8b5a2b', { pos: [px, py, pz], rot: [Math.PI / 2, 0, 0], scale: [0.16, 0.36, 0.16] });
    for (const o of [-0.12, 0.12]) b.add(GEO.cylC, '#4a3b30', { pos: [px, py, pz + o], rot: [Math.PI / 2, 0, 0], scale: [0.165, 0.035, 0.165] });
  };
  [[0, 0], [0.33, 0], [0.66, 0], [0.165, 1], [0.495, 1], [0.33, 2]].forEach(([dx, lvl]) => barrel(bx + dx, 0.16 + lvl * 0.29, bz));
  ao.push({ type: 'rect', x: bx + 0.33, z: bz, w: 1.1, d: 0.45, a: 0.4, blur: 0.2 });
}

/* ------------------- Pérgola de degustación ----------------------- */
function addPergola(b, ao) {
  const { x, z } = PERGOLA;
  const pw = 2.1, pd = 1.5, ph = 1.05;
  for (const px of [-pw / 2, 0, pw / 2]) {
    for (const pz of [-pd / 2, pd / 2]) b.add(GEO.box, WOOD, { pos: [x + px, 0, z + pz], scale: [0.07, ph, 0.07], ao: [0, 0.3, 0.7] });
  }
  for (const pz of [-pd / 2, pd / 2]) b.add(GEO.box, '#7a5a3a', { pos: [x, ph, z + pz], scale: [pw + 0.3, 0.07, 0.07] });
  for (let i = 0; i <= 7; i++) b.add(GEO.box, '#9a7550', { pos: [x - pw / 2 - 0.1 + i * ((pw + 0.2) / 7), ph + 0.07, z], scale: [0.04, 0.04, pd + 0.3] });
  const r = rng(61);
  for (let ix = 0; ix < 8; ix++) {
    for (let iz = 0; iz < 6; iz++) {
      if (r() < 0.12) continue;
      const vx = x - pw / 2 + (ix + 0.5) * (pw / 8) + (r() - 0.5) * 0.08;
      const vz = z - pd / 2 + (iz + 0.5) * (pd / 6) + (r() - 0.5) * 0.08;
      b.add(GEO.ico, ['#5a9b3f', '#4f8f3a', '#6aa94a', '#63a445'][(ix + iz) % 4], {
        pos: [vx, ph + 0.13 + r() * 0.04, vz], rot: [r(), r() * 3, r()], scale: [0.17, 0.11, 0.17], ao: [-1, 1, 0.7],
      });
      if (r() < 0.25) b.add(GEO.cone, '#5b2a62', { pos: [vx, ph + 0.03, vz], rot: [Math.PI, 0, 0], scale: [0.035, 0.09, 0.035] });
    }
  }
  // Mesas-barrica
  for (const tx of [-0.5, 0.55]) {
    b.add(GEO.cyl, '#8b5a2b', { pos: [x + tx, 0, z], scale: [0.14, 0.4, 0.14], ao: [0, 0.3, 0.7] });
    b.add(GEO.cyl, '#4a3b30', { pos: [x + tx, 0.4, z], scale: [0.15, 0.025, 0.15] });
    b.add(GEO.cyl6, '#7a1f33', { pos: [x + tx + 0.04, 0.425, z + 0.03], scale: [0.018, 0.09, 0.018] });
  }
  ao.push({ type: 'rect', x, z, w: pw + 0.2, d: pd + 0.2, a: 0.28, blur: 0.4 });
}

/* -------------------- Cartel de bienvenida ------------------------- */
function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 240;
  const g = cv.getContext('2d');
  g.fillStyle = '#7a4a2a';
  g.fillRect(0, 0, 640, 240);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,220,180,0.06)';
    g.fillRect(0, i * 40, 640, 40);
  }
  g.strokeStyle = '#f3e3c3';
  g.lineWidth = 6;
  g.strokeRect(14, 14, 612, 212);
  g.fillStyle = '#f7ead0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 92px system-ui, "Segoe UI", Helvetica, Arial, sans-serif';
  g.fillText('SAN RAFAEL', 320, 100);
  g.font = '600 34px system-ui, "Segoe UI", Helvetica, Arial, sans-serif';
  g.fillStyle = '#e9c98f';
  g.fillText('MENDOZA  ·  ARGENTINA', 320, 172);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildSign(b) {
  const { x, z } = SIGN;
  const ry = 0.3;
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const o of [-0.92, 0.92]) b.add(GEO.box, '#5b3d27', { pos: [x + o * c, 0, z - o * s], rot: [0, ry, 0], scale: [0.07, 1.25, 0.07], ao: [0, 0.3, 0.6] });
  const tex = signTexture();
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 0.06), [wood, wood, wood, wood, face, wood]);
  board.position.set(x, 0.82, z + 0.05);
  board.rotation.y = ry;
  board.castShadow = board.receiveShadow = true;
  return board;
}

/* ---------------------- Casa de campo ------------------------------ */
function addHouse(b, ao) {
  const { x, z, w, d, h } = HOUSE;
  const front = z + d / 2;
  b.add(GEO.box, '#f3dcc3', { pos: [x, 0, z], scale: [w, h, d], ao: [0, 0.35, 0.78] });
  gableRoof(b, { x, z, w, d, top: h, pitch: 0.45, color: '#a9563a', wall: '#f3dcc3' });
  b.add(GEO.box, '#c9b8a4', { pos: [x + 0.7, h + 0.25, z - 0.25], scale: [0.22, 0.6, 0.22] });
  b.add(GEO.box, '#8a7a6c', { pos: [x + 0.7, h + 0.85, z - 0.25], scale: [0.27, 0.05, 0.27] });
  // Galería
  b.add(GEO.box, '#c9876a', { pos: [x, 0, front + 0.45], scale: [w, 0.05, 0.95] });
  for (const px of [-w / 2 + 0.08, -0.45, 0.45, w / 2 - 0.08]) b.add(GEO.box, WOOD, { pos: [x + px, 0, front + 0.88], scale: [0.06, 0.85, 0.06] });
  b.add(GEO.boxC, '#8e9a9e', { pos: [x, 0.93, front + 0.48], rot: [0.16, 0, 0], scale: [w + 0.2, 0.05, 1.08] });
  b.add(GEO.box, DARK_WOOD, { pos: [x - 0.25, 0, front + 0.01], scale: [0.36, 0.66, 0.03] });
  for (const wx of [-0.95, 0.6]) {
    b.add(GEO.box, '#55636e', { pos: [x + wx, 0.35, front + 0.01], scale: [0.32, 0.32, 0.03] });
    for (const sx of [-0.24, 0.24]) b.add(GEO.box, '#3f7d5c', { pos: [x + wx + sx, 0.33, front + 0.02], scale: [0.14, 0.36, 0.03] });
  }
  b.add(GEO.box, '#55636e', { pos: [x + w / 2 + 0.01, 0.35, z], scale: [0.03, 0.32, 0.36] });
  // Silla y mesita del mate
  b.add(GEO.box, '#7a5a3a', { pos: [x + 0.95, 0, front + 0.5], scale: [0.18, 0.16, 0.18] });
  b.add(GEO.box, '#7a5a3a', { pos: [x + 0.95, 0.16, front + 0.4], scale: [0.18, 0.2, 0.03] });
  b.add(GEO.box, '#a77c52', { pos: [x + 1.22, 0, front + 0.58], scale: [0.14, 0.14, 0.14] });
  ao.push({ type: 'rect', x, z: z + 0.4, w: w + 0.3, d: d + 1.1, a: 0.45, blur: 0.4 });

  // Parrilla de ladrillo
  const gx = x - 1.3, gz = front + 1.75;
  b.add(GEO.box, '#b0603f', { pos: [gx, 0, gz], scale: [0.6, 0.38, 0.36], ao: [0, 0.4, 0.75] });
  b.add(GEO.box, '#3b3b3b', { pos: [gx, 0.38, gz], scale: [0.52, 0.03, 0.3] });
  b.add(GEO.box, '#b0603f', { pos: [gx, 0.38, gz - 0.15], scale: [0.6, 0.3, 0.06] });
  for (let i = 0; i < 3; i++) b.add(GEO.box, '#7a2f22', { pos: [gx - 0.14 + i * 0.14, 0.41, gz + 0.02], scale: [0.1, 0.03, 0.06] });
  ao.push({ type: 'rect', x: gx, z: gz, w: 0.8, d: 0.55, a: 0.35, blur: 0.15 });

  return {
    chimney: new THREE.Vector3(x + 0.7, h + 0.95, z - 0.25),
    grill: new THREE.Vector3(gx, 0.48, gz),
    mateSeat: new THREE.Vector3(x + 0.95, 0.16, front + 0.5),
    asador: new THREE.Vector3(gx, 0, gz + 0.38),
  };
}

/* ---------------------- Molino de viento --------------------------- */
function addWindmill(b, ao) {
  const { x, z } = WINDMILL;
  const H = 2.7, base = 0.42, topR = 0.09;
  const legs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const v = new THREE.Vector3();
  for (const [sx, sz] of legs) {
    const p0 = new THREE.Vector3(x + sx * base, 0, z + sz * base);
    const p1 = new THREE.Vector3(x + sx * topR, H, z + sz * topR);
    v.subVectors(p1, p0);
    const len = v.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    b.add(GEO.box, '#8f9599', { pos: [p0.x, p0.y, p0.z], rot: [e.x, e.y, e.z], scale: [0.035, len, 0.035] });
  }
  for (const y of [0.7, 1.4, 2.05]) {
    const rr = base + (topR - base) * (y / H);
    b.add(GEO.boxC, '#a3a9ad', { pos: [x, y, z + rr], scale: [rr * 2, 0.025, 0.025] });
    b.add(GEO.boxC, '#a3a9ad', { pos: [x + rr, y, z], scale: [0.025, 0.025, rr * 2] });
  }
  b.add(GEO.box, '#7b8186', { pos: [x, H, z], scale: [0.28, 0.06, 0.28] });
  b.add(GEO.box, '#6c7378', { pos: [x, H + 0.08, z - 0.35], scale: [0.03, 0.05, 0.6] });
  b.add(GEO.box, '#c33f33', { pos: [x, H - 0.05, z - 0.72], scale: [0.02, 0.36, 0.3] });

  // Tanque australiano
  const tx = x + 1.05, tz = z - 0.8;
  b.add(GEO.cyl, '#9fa9ad', { pos: [tx, 0, tz], scale: [0.62, 0.42, 0.62], ao: [0, 0.4, 0.7] });
  b.add(GEO.cyl, '#5cc2cf', { pos: [tx, 0.38, tz], scale: [0.58, 0.02, 0.58] });
  ao.push({ x: tx, z: tz, r: 1.0, a: 0.35 });
  ao.push({ x, z, r: 0.7, a: 0.3 });

  const rotor = new THREE.Group();
  rotor.position.set(x, H + 0.12, z + 0.08);
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#e8eaeb', flatShading: true, roughness: 0.6, side: THREE.DoubleSide });
  const bladeGeos = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const g = new THREE.BoxGeometry(0.1, 0.42, 0.012).translate(0, 0.3, 0).rotateY(0.35).rotateZ(a);
    bladeGeos.push(g);
  }
  bladeGeos.push(new THREE.TorusGeometry(0.5, 0.012, 4, 24), new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8).rotateX(Math.PI / 2));
  const blades = new THREE.Mesh(mergeGeometries(bladeGeos), bladeMat);
  blades.castShadow = true;
  rotor.add(blades);
  return rotor;
}

/* ---------------------- Corral, puente y varios -------------------- */
function addCorral(b, ao) {
  const { x0, x1, z0, z1 } = CORRAL;
  const post = (x, z) => b.add(GEO.box, '#7a5a3c', { pos: [x, 0, z], scale: [0.05, 0.45, 0.05] });
  const rail = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(bx - ax, bz - az);
    for (const y of [0.2, 0.38]) b.add(GEO.boxC, '#9a7652', { pos: [(ax + bx) / 2, y, (az + bz) / 2], rot: [0, ry, 0], scale: [0.03, 0.035, len] });
  };
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const zz = z0 + ((z1 - z0) * i) / n;
    post(x1, zz);
    if (i < 3 || i > 4) post(x0, zz);
  }
  for (let i = 1; i < 3; i++) {
    const xx = x0 + ((x1 - x0) * i) / 3;
    post(xx, z0);
    post(xx, z1);
  }
  rail(x1, z0, x1, z1);
  rail(x0, z0, x1, z0);
  rail(x0, z1, x1, z1);
  rail(x0, z0, x0, z0 + ((z1 - z0) * 2) / n);
  rail(x0, z0 + ((z1 - z0) * 5) / n, x0, z1);
  b.add(GEO.box, '#8d7660', { pos: [x1 - 0.3, 0, z0 + 0.7], scale: [0.3, 0.16, 0.8] });
  b.add(GEO.box, '#4fb3c2', { pos: [x1 - 0.3, 0.16, z0 + 0.7], scale: [0.24, 0.01, 0.72] });
  ao.push({ x: x1 - 0.3, z: z0 + 0.7, r: 0.6, a: 0.3 });
}

export const BRIDGE = (() => {
  const cx = riverXAt(ROAD.z);
  return { x: cx, x0: cx - 1.3, x1: cx + 1.3, top: 0.19 };
})();

// Altura del camino (sube al pasar el puente).
export function roadY(x) {
  const { x0, x1, top } = BRIDGE;
  const ramp = 0.35;
  if (x < x0 - ramp || x > x1 + ramp) return 0;
  if (x < x0) return ((x - (x0 - ramp)) / ramp) * top;
  if (x > x1) return ((x1 + ramp - x) / ramp) * top;
  return top;
}

function addBridge(b, ao) {
  const { x, x0, x1, top } = BRIDGE;
  const len = x1 - x0, wid = ROAD.half * 2 + 0.1;
  for (const e of [x0, x1]) b.add(GEO.box, '#b8ab98', { pos: [e, 0, ROAD.z], scale: [0.35, top - 0.04, wid + 0.1] });
  for (let i = 0; i < 12; i++) {
    b.add(GEO.box, i % 2 ? '#9c7650' : '#8b6744', { pos: [x0 + (i + 0.5) * (len / 12), top - 0.08, ROAD.z], scale: [len / 12 - 0.01, 0.08, wid] });
  }
  for (const s of [-1, 1]) {
    const zz = ROAD.z + s * (wid / 2 - 0.03);
    for (let i = 0; i <= 6; i++) b.add(GEO.box, '#6b4a2f', { pos: [x0 + (i * len) / 6, top, zz], scale: [0.05, 0.3, 0.05] });
    b.add(GEO.boxC, '#7a5a3c', { pos: [x, top + 0.3, zz], scale: [len + 0.06, 0.045, 0.06] });
  }
  ao.push({ type: 'rect', x, z: ROAD.z, w: len, d: wid + 0.3, a: 0.25, blur: 0.25 });
}

function addAcequiaEdges(b) {
  const ax1 = riverXAt(ACEQUIA_Z) - 0.4;
  const len = ax1 + W / 2;
  for (const s of [-1, 1]) b.add(GEO.box, '#c9c3b6', { pos: [(-W / 2 + ax1) / 2, 0, ACEQUIA_Z + s * 0.17], scale: [len, 0.07, 0.07] });
  b.add(GEO.box, '#d3ccbe', { pos: [BODEGA.x, 0.03, ACEQUIA_Z], scale: [1.5, 0.06, 0.5] });
  b.add(GEO.box, '#d3ccbe', { pos: [-6.3, 0.03, ACEQUIA_Z], scale: [1.0, 0.06, 0.5] });
}

function addBins(b, ao) {
  const r = rng(71);
  const spots = [[-3.6, 4.62], [-3.25, 4.62], [-2.9, 4.62], [-3.42, 4.62, 1], [1.6, 4.62], [1.95, 4.62], [1.78, 4.62, 1]];
  for (const [x, z, lvl = 0] of spots) {
    const y = lvl * 0.22;
    b.add(GEO.box, r() < 0.7 ? '#3f8f4a' : '#d2463a', { pos: [x, y, z], scale: [0.32, 0.2, 0.26], ao: [0, 0.6, 0.75] });
    for (let k = 0; k < 4; k++) b.add(GEO.ico, ['#5b2a62', '#4b2353', '#6a3270'][k % 3], { pos: [x + (r() - 0.5) * 0.18, y + 0.2, z + (r() - 0.5) * 0.12], scale: 0.07 });
  }
  ao.push({ type: 'rect', x: -3.25, z: 4.62, w: 1.1, d: 0.35, a: 0.35, blur: 0.12 });
  ao.push({ type: 'rect', x: 1.78, z: 4.62, w: 0.75, d: 0.35, a: 0.35, blur: 0.12 });
}

export function buildStructures(staticBatch, ao) {
  const group = new THREE.Group();
  const tanks = new Batch();
  addBodega(staticBatch, tanks, ao);
  addPergola(staticBatch, ao);
  const house = addHouse(staticBatch, ao);
  const rotor = addWindmill(staticBatch, ao);
  addCorral(staticBatch, ao);
  addBridge(staticBatch, ao);
  addAcequiaEdges(staticBatch);
  addBins(staticBatch, ao);
  group.add(buildSign(staticBatch));
  group.add(tanks.build(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.28, metalness: 0.35 })));
  group.add(rotor);
  return {
    group,
    house,
    update(T) {
      rotor.rotation.z = -T * TAU * 9;
    },
  };
}
