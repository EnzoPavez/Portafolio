import * as THREE from 'three';
import { fbm, smoothstep } from './utils.js';

// Escena principal: x ∈ [-W/2, W/2] (izq → der), z ∈ [-D/2, D/2] (fondo → frente).
// Es lo que encuadra la cámara.
export const W = 36;
export const D = 26;
export const BASE = 2.0; // referencia de encuadre (alto de la antigua base de tierra)
// Mundo extendido alrededor: el paisaje sigue y se pierde en la bruma de los bordes.
export const EXT = { W: 52, D: 40 };
// Garganta rocosa donde cae la cascada, al frente de la escena
export const GORGE = { z0: 13.0, z1: 13.32, depth: 1.7 };

// Río (Atuel estilizado): baja del fondo del cañón, cae en la garganta y sigue hacia el frente.
const RIVER_POINTS = [
  [5.4, -20.5], [6.7, -16.6],
  [6.2, -13.0], [5.3, -10.6], [7.0, -8.0], [6.3, -5.4], [7.3, -2.6],
  [6.7, 0.6], [7.5, 3.5], [9.2, 6.2], [8.5, 9.0], [8.9, 11.6], [8.9, 13.0],
  [9.2, 15.2], [8.4, 17.6], [8.9, 20.5],
];
export const riverCurve = new THREE.CatmullRomCurve3(
  RIVER_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal'
);
export const RIVER_SAMPLES = riverCurve.getSpacedPoints(380);
export const riverWidth = (z) => (z < -4 ? 1.0 : z > GORGE.z0 ? 1.1 : 1.35);

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
    if (d < 1) {
      const soft = (1 - d * d) * (1 - d * d);
      h += p.h * (0.55 * soft + 0.45 * Math.pow(1 - d, 1.6));
    }
  }
  // Crestas suaves (ruido "ridged") + ondulación de baja frecuencia
  const rn = 1 - Math.abs(fbm(x * 0.2 + 11.3, z * 0.2 - 4.1, 3) * 2 - 1);
  h += (rn * rn - 0.45) * 1.6 * ramp * ramp;
  const rn2 = 1 - Math.abs(fbm(x * 0.5 - 2.7, z * 0.5 + 8.3, 2) * 2 - 1);
  h += (rn2 * rn2 - 0.45) * 0.5 * ramp * ramp;
  h += (fbm(x * 0.28 + 3.1, z * 0.28, 3) - 0.5) * 1.3 * ramp;
  // Crestas rocosas en la parte alta
  const rn3 = 1 - Math.abs(fbm(x * 0.75 + 1.7, z * 0.75 - 5.2, 2) * 2 - 1);
  h += rn3 * rn3 * rn3 * 0.6 * smoothstep(1.5, 4.5, h);
  // Fuera de la escena las montañas bajan hasta perderse en la bruma
  h *= (1 - smoothstep(W / 2 + 0.5, W / 2 + 5.5, Math.abs(x))) * (1 - smoothstep(D / 2 + 0.5, D / 2 + 5.5, -z));
  // Valle del río entre las dos montañas: laderas abiertas (en V), sin paredes verticales
  const c = smoothstep(0.8, 6.0, distToRiver(x, z));
  h = h * c - (1 - c) * 0.6;
  return h - 0.35;
}

// Manchas de bosque en la montaña (compartido entre el color del terreno y los pinos).
export const forestNoise = (x, z) => fbm(x * 0.22 + 5, z * 0.22 - 2, 3);
// Hasta dónde llega el verde antes de que aparezca la roca, y la cota de nieve.
export const vegetationLine = (x, z) => 0.4 + (fbm(x * 0.3 + 9, z * 0.3, 3) - 0.5) * 0.5;
export const snowLine = (x, z) => 5.0 + (fbm(x * 0.32, z * 0.32, 3) - 0.5) * 1.0;

// Garganta: el río cae desde el borde de la escena y sigue por un cauce rocoso más bajo.
// Asimétrica: acantilado de roca a la izquierda y ladera suave del lado de la cámara,
// así se ve el fondo de la garganta (y el gomón remando abajo). Del lado derecho la
// pared del fondo también baja en rampa, para que no quede una placa lisa.
export function gorgeHeight(x, z) {
  if (z <= GORGE.z0) return 0;
  const dr = distToRiver(x, z);
  const right = x > riverXAt(z);
  const wall = right ? 1 - smoothstep(0.8, 3.6, dr) : 1 - smoothstep(0.8, 1.45, dr);
  const ramp = GORGE.z1 - GORGE.z0 + (right ? 1.8 * smoothstep(0.7, 3.0, dr) : 0);
  return -GORGE.depth * smoothstep(GORGE.z0, GORGE.z0 + ramp, z) * wall;
}

// Caminos
export const ROAD = { z: 3.5, half: 0.65 };
export const LANE = { x: -6.3, half: 0.5 };
export const ACEQUIA_Z = 2.42;

// Parcelas de viñedo
export const PARCELS = [
  { name: 'B', x0: -16.6, x1: -7.3, z0: 5.0, z1: 12.4, dir: 'z', spacing: 0.8, palette: 'autumn', grapes: 0.12 },
  { name: 'C', x0: -5.0, x1: 5.4, z0: 5.0, z1: 12.4, dir: 'z', spacing: 0.8, palette: 'green', grapes: 0.75 },
  // Alrededores (se van perdiendo en la bruma)
  { name: 'D', lod: 'low', x0: -16.6, x1: -7.3, z0: 14.3, z1: 19.2, dir: 'z', spacing: 0.8, palette: 'autumn', grapes: 0.1 },
  { name: 'E', lod: 'low', x0: -5.0, x1: 5.4, z0: 14.3, z1: 19.2, dir: 'z', spacing: 0.8, palette: 'green', grapes: 0.45 },
  { name: 'F', lod: 'low', x0: -24.8, x1: -19.4, z0: 5.0, z1: 12.4, dir: 'z', spacing: 0.8, palette: 'green', grapes: 0.4 },
  { name: 'G', lod: 'low', x0: 19.6, x1: 25.0, z0: 5.0, z1: 12.4, dir: 'x', spacing: 0.8, palette: 'autumn', grapes: 0.1 },
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
export const SIGN = { x: 13.7, z: 12.25, ry: 0.62 };

// Patio criollo (donde antes había un viñedo): asado, mesa larga, mate y tango.
export const PATIO = { x0: -12.3, x1: -5.9, z0: -3.15, z1: 1.85 };
export const GRILL = { x: -11.6, z: -2.3 };
export const FIRE = { x: -9.3, z: -2.4 };
export const TABLE = { x: -9.5, z: -0.8, len: 2.6 };
export const TANGO = { x: -7.15, z: 0.75 };
export const MATE = { x: -11.0, z: 1.0 };
// Potrero con vacas lecheras y gallinero
export const PASTURE = { x0: -16.95, x1: -13.5, z0: -3.25, z1: 1.8 };
export const COOP = { x: -12.85, z: -2.6 };
