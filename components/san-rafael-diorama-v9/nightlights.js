import * as THREE from 'three';
import { GEO, TAU, rng, lerp } from './utils.js';
import { BODEGA, PERGOLA, HOUSE, SIGN, ROAD, TABLE, PARCELS, RIVER_SAMPLES } from './layout.js';
import { BRIDGE } from './buildings.js';

/* Luces del atardecer que faltaban (v8): faroles en la puerta de la bodega, lamparitas
   colgando en la pérgola y en la galería de la casa, faroles en el puente, reflectores
   del cartel, velas en la mesa larga y luciérnagas. La geometría va al batch estático;
   los vidrios usan colores marcados como GLASS (se encienden en el shader) y cada luz
   devuelve sus resplandores (halo y mancha en el piso) para buildGlows. */

const IRON = '#2a2a2c';
const BULB = '#efe8d2'; // GLASS: se enciende al atardecer
const PANE = '#4c5b69'; // GLASS: vidrio de farol
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Farol colgado o de poste: base, vidrio y techito.
function lantern(b, x, y, z, s = 1) {
  b.add(GEO.box, IRON, { pos: [x, y - 0.01 * s, z], scale: [0.09 * s, 0.02 * s, 0.09 * s] });
  b.add(GEO.box, PANE, { pos: [x, y, z], scale: [0.07 * s, 0.11 * s, 0.07 * s] });
  b.add(GEO.cone4, IRON, { pos: [x, y + 0.11 * s, z], scale: [0.065 * s, 0.06 * s, 0.065 * s] });
}

// Lamparita colgando de un cable.
function hangingBulb(b, x, y, z, cable) {
  b.add(GEO.box, '#2a2a2a', { pos: [x, y + 0.03, z], scale: [0.006, cable, 0.006], shadow: false });
  b.add(GEO.sphere, BULB, { pos: [x, y, z], scale: 0.035, shadow: false });
}

export function buildNightLights(b) {
  const spots = [];
  const warm = '#ffc77a', pool = '#ffcf8a';

  // Bodega: dos faroles a los lados de la puerta y la luz que cae en el ripio
  const face = BODEGA.z + BODEGA.d / 2 + 0.22; // frente del frontón
  for (const s of [-1, 1]) {
    const x = BODEGA.x + s * 0.6;
    b.add(GEO.box, IRON, { pos: [x, 0.97, face + 0.04], scale: [0.025, 0.025, 0.08] });
    lantern(b, x, 0.84, face + 0.08);
    spots.push({ p: V(x, 0.9, face + 0.08), r: 0.32, color: warm, k: 0.6 });
  }
  spots.push({ p: V(BODEGA.x, 0, face + 0.75), flat: true, sx: 1.9, sz: 1.2, color: pool, k: 0.45 });

  // Pérgola de degustación: una lamparita sobre cada mesa-barrica
  for (const dx of [-0.5, 0.55]) {
    hangingBulb(b, PERGOLA.x + dx, 0.87, PERGOLA.z, 0.15);
    spots.push({ p: V(PERGOLA.x + dx, 0.87, PERGOLA.z), r: 0.3, color: '#ffd59a', k: 0.55 });
  }
  spots.push({ p: V(PERGOLA.x, 0, PERGOLA.z), flat: true, sx: 2.2, sz: 1.6, color: pool, k: 0.4 });

  // Galería de la casa: lamparita colgando del borde del techo (más adentro el techo la
  // tapa desde la cámara y el halo quedaría encima de la chapa) y su luz en el piso.
  const hf = HOUSE.z + HOUSE.d / 2;
  hangingBulb(b, HOUSE.x - 0.2, 0.7, hf + 0.92, 0.14);
  spots.push({ p: V(HOUSE.x - 0.2, 0.7, hf + 0.92), r: 0.3, color: '#ffd59a', k: 0.6 });
  spots.push({ p: V(HOUSE.x - 0.1, 0.05, hf + 0.55), flat: true, sx: 2.6, sz: 1.3, color: pool, k: 0.65 });
  spots.push({ p: V(HOUSE.x - 0.1, 0, hf + 1.35), flat: true, sx: 2.4, sz: 1.0, color: pool, k: 0.35 });

  // Puente: un farol en cada punta, del lado de la cámara
  const bz = ROAD.z + ROAD.half + 0.02;
  for (const x of [BRIDGE.x0, BRIDGE.x1]) {
    b.add(GEO.box, IRON, { pos: [x, BRIDGE.top + 0.3, bz], scale: [0.025, 0.2, 0.025] });
    lantern(b, x, BRIDGE.top + 0.52, bz);
    spots.push({ p: V(x, BRIDGE.top + 0.58, bz), r: 0.3, color: warm, k: 0.6 });
    spots.push({ p: V(x + (x < BRIDGE.x ? 0.35 : -0.35), BRIDGE.top, ROAD.z + 0.2), flat: true, sx: 1.1, sz: 1.3, color: pool, k: 0.35 });
  }

  // Cartel de bienvenida: dos reflectores en el piso apuntando al cartel
  const fwd = V(Math.sin(SIGN.ry), 0, Math.cos(SIGN.ry)), side = V(Math.cos(SIGN.ry), 0, -Math.sin(SIGN.ry));
  for (const s of [-1, 1]) {
    const x = SIGN.x + fwd.x * 0.6 + side.x * s * 0.9, z = SIGN.z + fwd.z * 0.6 + side.z * s * 0.9;
    // La óptica mira al cartel (hacia atrás de la caja)
    b.add(GEO.box, IRON, { pos: [x, 0, z], rot: [0, SIGN.ry, 0], scale: [0.1, 0.07, 0.08] });
    b.add(GEO.box, BULB, { pos: [x - fwd.x * 0.045, 0.01, z - fwd.z * 0.045], rot: [0, SIGN.ry, 0], scale: [0.08, 0.05, 0.01], shadow: false });
    spots.push({ p: V(x, 0.07, z), r: 0.14, color: '#fff1d6', k: 0.6 });
  }
  spots.push({ p: V(SIGN.x + fwd.x * 0.35, 0, SIGN.z + fwd.z * 0.35), flat: true, sx: 3.4, sz: 0.9, yaw: SIGN.ry, color: '#fff0d0', k: 0.35 });

  // Velas en la mesa larga (la llama titila)
  const top = 0.315;
  [-0.55, 0.85].forEach((dx, i) => {
    const x = TABLE.x + dx, z = TABLE.z - 0.03;
    b.add(GEO.cyl, '#f3efe2', { pos: [x, top, z], scale: [0.016, 0.07, 0.016], shadow: false });
    b.add(GEO.cone, BULB, { pos: [x, top + 0.07, z], scale: [0.012, 0.035, 0.012], shadow: false });
    const p = V(x, top + 0.09, z);
    spots.push({ at: (T, out) => (out.copy(p), 0.8 + 0.12 * Math.sin(TAU * T * 47 + i * 2) + 0.08 * Math.sin(TAU * T * 83 + i)), r: 0.2, color: '#ffbf6a', k: 0.6 });
  });

  return [...spots, ...fireflies()];
}

// Luciérnagas: sobre las parcelas del frente y a lo largo del río. Dan vueltas lentas
// y se prenden en destellos cortos (frecuencias enteras: el loop empalma).
function fireflies() {
  const r = rng(101);
  const homes = [];
  for (let i = 0; i < 16; i++) {
    const p = PARCELS[i % 2];
    homes.push([lerp(p.x0 + 0.3, p.x1 - 0.3, r()), lerp(0.55, 0.9, r()), lerp(p.z0 + 0.3, p.z1 - 0.3, r())]);
  }
  while (homes.length < 28) {
    const s = RIVER_SAMPLES[Math.floor(lerp(0.36, 0.8, r()) * RIVER_SAMPLES.length)];
    if (Math.abs(s.z - ROAD.z) < 1.2) continue;
    homes.push([s.x + (r() < 0.5 ? -1 : 1) * (0.9 + r() * 0.8), lerp(0.3, 0.7, r()), s.z]);
  }
  return homes.map(([hx, hy, hz], i) => {
    const kx = 1 + (i % 3), ky = 2 + (i % 2), kb = 5 + (i % 5), ph = r(), ph2 = r();
    return {
      r: 0.07, color: '#dfff70', k: 1,
      at(T, out) {
        const t = TAU * (T * kx + ph);
        out.set(hx + 0.35 * Math.sin(t), hy + 0.12 * Math.sin(TAU * (T * ky + ph2)), hz + 0.3 * Math.cos(t + ph2 * 3));
        return Math.pow(Math.max(0, Math.sin(TAU * (T * kb + ph2))), 6);
      },
    };
  });
}
