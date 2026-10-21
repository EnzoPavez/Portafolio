import * as THREE from 'three';
import { fbm, smoothstep } from './utils.js';

// Plataforma: x ∈ [-W/2, W/2] (izq → der), z ∈ [-D/2, D/2] (fondo → frente).
export const W = 36;
export const D = 26;
export const BASE = 2.0; // espesor de tierra bajo la superficie

// Río (Atuel/Diamante estilizado): nace en el cañón del fondo y cae por el borde delantero.
const RIVER_POINTS = [
  [6.2, -13.0], [5.3, -10.6], [7.0, -8.0], [6.3, -5.4], [7.3, -2.6],
  [6.7, 0.6], [7.5, 3.5], [9.2, 6.2], [8.5, 9.0], [8.9, 11.6], [8.9, 13.0],
];
export const riverCurve = new THREE.CatmullRomCurve3(
  RIVER_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal'
);
export const RIVER_SAMPLES = riverCurve.getSpacedPoints(260);
export const riverWidth = (z) => (z < -4 ? 1.0 : 1.35);

export function riverXAt(z) {
  let best = RIVER_SAMPLES[0];
  for (const p of RIVER_SAMPLES) if (Math.abs(p.z - z) < Math.abs(best.z - z)) best = p;
  return best.x;
}

export function distToRiver(x, z) {
  let min = Infinity;
  for (let i = 0; i < RIVER_SAMPLES.length - 1; i++) {
    const a = RIVER_SAMPLES[i], b = RIVER_SAMPLES[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    const dx = a.x + abx * t - x, dz = a.z + abz * t - z;
    const d = dx * dx + dz * dz;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}

// Cordón montañoso del fondo (Andes / Sierra Pintada): picos + ruido + cañón del río.
const PEAKS = [
  { x: -14.5, z: -11.8, rx: 6.4, rz: 5.0, h: 3.9 },
  { x: -6.8, z: -12.3, rx: 7.4, rz: 5.6, h: 6.0 },
  { x: 0.8, z: -11.8, rx: 5.6, rz: 4.8, h: 3.4 },
  { x: 12.8, z: -12.0, rx: 7.0, rz: 5.4, h: 4.9 },
  { x: 17.5, z: -7.8, rx: 3.8, rz: 4.2, h: 1.6 },
  { x: -17.5, z: -7.0, rx: 3.6, rz: 4.4, h: 1.3 },
];

export const MOUNTAIN_Z1 = -2.4; // hasta dónde llega la malla de montaña

export function mountainHeight(x, z) {
  const dz = z + D / 2;
  const ramp = smoothstep(9.0, 0.5, dz);
  let h = ramp * ramp * 2.4;
  for (const p of PEAKS) {
    const ax = (x - p.x) / p.rx, az = (z - p.z) / p.rz;
    const d = Math.sqrt(ax * ax + az * az);
    if (d < 1) h += p.h * Math.pow(1 - d, 1.35);
  }
  h += (fbm(x * 0.3 + 3.1, z * 0.3) - 0.5) * 1.7 * ramp;
  h += (fbm(x * 0.9, z * 0.9 + 7.7) - 0.5) * 0.32 * ramp;
  // Cañón tallado por el río (Cañón del Atuel)
  const c = smoothstep(0.85, 2.6, distToRiver(x, z));
  h = h * c - (1 - c) * 0.6;
  return h - 0.35;
}

export const surfaceHeight = (x, z) => (z > MOUNTAIN_Z1 ? 0 : Math.max(0, mountainHeight(x, z)));

// Caminos
export const ROAD = { z: 3.5, half: 0.65 };
export const LANE = { x: -6.3, half: 0.5 };
export const ACEQUIA_Z = 2.42;

// Parcelas de viñedo
export const PARCELS = [
  { name: 'A', x0: -16.6, x1: -7.6, z0: -3.0, z1: 1.6, dir: 'x', spacing: 0.78, palette: 'green', grapes: 0.55 },
  { name: 'B', x0: -16.6, x1: -7.3, z0: 5.0, z1: 12.4, dir: 'z', spacing: 0.8, palette: 'autumn', grapes: 0.12 },
  { name: 'C', x0: -5.0, x1: 5.4, z0: 5.0, z1: 12.4, dir: 'z', spacing: 0.8, palette: 'green', grapes: 0.75 },
];

export function parcelRows(p) {
  const rows = [];
  if (p.dir === 'z') {
    for (let x = p.x0 + 0.3; x <= p.x1 - 0.2; x += p.spacing) rows.push({ a: [x, p.z0], b: [x, p.z1] });
  } else {
    for (let z = p.z0 + 0.3; z <= p.z1 - 0.2; z += p.spacing) rows.push({ a: [p.x0, z], b: [p.x1, z] });
  }
  return rows;
}

// Ubicaciones de construcciones
export const BODEGA = { x: -1.6, z: -1.3, w: 5.0, d: 2.5, h: 1.45 };
export const HOUSE = { x: 14.2, z: -1.5, w: 2.8, d: 1.7, h: 1.0 };
export const WINDMILL = { x: 11.4, z: -2.6 };
export const CORRAL = { x0: 15.9, x1: 17.6, z0: -3.4, z1: 1.3 };
export const PERGOLA = { x: 2.6, z: 0.9 };
export const SIGN = { x: -4.6, z: 2.05 };
