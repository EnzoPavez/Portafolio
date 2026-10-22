import * as THREE from 'three';
import { colored, mergeColored, valueNoise3, smoothstep, VC_SMOOTH } from './utils.js';

/* Animales de formas redondeadas (sombreado suave) armados con piezas
   pivotables: cuerpo, patas, cuello+cabeza y cola. Las manchas (vacas Holando,
   caballo overo) salen de un ruido 3D evaluado en el espacio del animal,
   así continúan de una pieza a la otra. */

const sphere = (r = 1, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const capsule = (r, len, seg = 14) => new THREE.CapsuleGeometry(r, len, 6, seg);

function painter(base, spot, { offset = [0, 0, 0], freq = 5, threshold = 0.55, seed = 0, rule } = {}) {
  const cb = new THREE.Color(base), cs = spot ? new THREE.Color(spot) : null, out = new THREE.Color();
  return (x, y, z) => {
    const X = x + offset[0], Y = y + offset[1], Z = z + offset[2];
    if (rule) {
      const forced = rule(X, Y, Z);
      if (forced) return out.set(forced);
    }
    if (!cs) return out.copy(cb);
    const n = valueNoise3(X * freq + seed, Y * freq - seed * 0.7, Z * freq + seed * 0.3);
    return out.copy(cb).lerp(cs, smoothstep(threshold - 0.035, threshold + 0.035, n));
  };
}

function pivot(parent, geo, pos) {
  const g = new THREE.Group();
  g.position.set(...pos);
  const m = new THREE.Mesh(geo, VC_SMOOTH);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  parent.add(g);
  return g;
}

/* ------------------------------ Caballo ------------------------------ */
export function buildHorse({ coat = '#7b4a2a', mane = '#2a1d16', points = '#2a1d16', spots = null, seed = 3 } = {}) {
  const g = new THREE.Group();
  const paint = (offset) => painter(coat, spots, { offset, seed, freq: 4.2, threshold: 0.58 });
  const hoof = '#2b2420';

  const body = mergeColored([
    colored(capsule(0.12, 0.36), paint([0, 0, 0]), { pos: [0, 0.56, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.1] }),
    colored(sphere(0.125), paint([0, 0, 0]), { pos: [0, 0.575, 0.19] }),
    colored(sphere(0.132), paint([0, 0, 0]), { pos: [0, 0.6, -0.18] }),
    colored(sphere(0.12), paint([0, 0, 0]), { pos: [0, 0.52, 0], scale: [1, 0.9, 1.55] }),
  ]);
  const bm = new THREE.Mesh(body, VC_SMOOTH);
  bm.castShadow = bm.receiveShadow = true;
  g.add(bm);

  const legs = [];
  for (const [x, y, z, thick] of [[-0.065, 0.5, 0.2, 0.05], [0.065, 0.5, 0.2, 0.05], [-0.07, 0.52, -0.2, 0.06], [0.07, 0.52, -0.2, 0.06]]) {
    const geo = mergeColored([
      colored(cyl(thick, 0.03, 0.3).translate(0, -0.15, 0), paint([x, y, z])),
      colored(cyl(0.027, 0.024, 0.19).translate(0, -0.385, 0), points),
      colored(cyl(0.028, 0.034, 0.04).translate(0, -(y - 0.02), 0), hoof),
    ]);
    legs.push(pivot(g, geo, [x, y, z]));
  }

  const neckOff = [0, 0.62, 0.25];
  const neckGeo = mergeColored([
    colored(cyl(0.048, 0.08, 0.4).translate(0, 0.2, 0).rotateX(0.6), paint(neckOff)),
    colored(sphere(1, 8, 6).scale(0.024, 0.21, 0.05).translate(0, 0.2, -0.05).rotateX(0.6), mane),
    colored(sphere(0.065), paint(neckOff), { pos: [0, 0.35, 0.25], scale: [0.85, 0.95, 1.1] }),
    colored(capsule(0.04, 0.12, 10).rotateX(Math.PI / 2 + 0.75), coat, { pos: [0, 0.285, 0.33] }),
    colored(sphere(0.02, 6, 5), mane, { pos: [0, 0.405, 0.27], scale: [1, 0.6, 1.4] }),
    colored(new THREE.ConeGeometry(0.018, 0.065, 6), coat, { pos: [0.03, 0.43, 0.22], rot: [-0.2, 0, -0.2] }),
    colored(new THREE.ConeGeometry(0.018, 0.065, 6), coat, { pos: [-0.03, 0.43, 0.22], rot: [-0.2, 0, 0.2] }),
    colored(sphere(0.011, 6, 5), '#111', { pos: [0.052, 0.37, 0.28] }),
    colored(sphere(0.011, 6, 5), '#111', { pos: [-0.052, 0.37, 0.28] }),
  ]);
  const neck = pivot(g, neckGeo, neckOff);

  const tailGeo = mergeColored([
    colored(cyl(0.03, 0.042, 0.12).translate(0, -0.06, 0), mane),
    colored(new THREE.ConeGeometry(0.06, 0.34, 9).translate(0, -0.25, 0), mane),
  ]);
  const tail = pivot(g, tailGeo, [0, 0.66, -0.3]);
  tail.rotation.x = -0.28;
  return { g, neck, tail, legs };
}

/* ------------------------- Vaca Holando ------------------------------ */
const WHITE = '#f6f4ee', BLACK = '#1e1e21', PINK = '#efb0ab';

export function buildCow({ seed = 1 } = {}) {
  const g = new THREE.Group();
  const paint = (offset, rule) => painter(WHITE, BLACK, { offset, seed, freq: 5.2, threshold: 0.5, rule });

  const body = mergeColored([
    colored(capsule(0.15, 0.42, 16), paint([0, 0, 0]), { pos: [0, 0.5, 0], rot: [Math.PI / 2, 0, 0] }),
    colored(sphere(0.14), paint([0, 0, 0]), { pos: [0, 0.46, 0.02], scale: [1, 0.95, 1.7] }),
    colored(sphere(0.135), paint([0, 0, 0]), { pos: [0, 0.52, 0.22] }),
    colored(sphere(0.055, 8, 6), paint([0, 0, 0]), { pos: [0.085, 0.63, -0.25] }),
    colored(sphere(0.055, 8, 6), paint([0, 0, 0]), { pos: [-0.085, 0.63, -0.25] }),
    colored(sphere(0.066), PINK, { pos: [0, 0.34, -0.17], scale: [1, 0.8, 1.15] }),
    ...[[-0.025, -0.14], [0.025, -0.14], [-0.025, -0.2], [0.025, -0.2]].map(([x, z]) => colored(cyl(0.008, 0.006, 0.035, 5), PINK, { pos: [x, 0.29, z] })),
  ]);
  const bm = new THREE.Mesh(body, VC_SMOOTH);
  bm.castShadow = bm.receiveShadow = true;
  g.add(bm);

  const legs = [];
  for (const [x, z] of [[-0.085, 0.24], [0.085, 0.24], [-0.085, -0.24], [0.085, -0.24]]) {
    const y = 0.42;
    const geo = mergeColored([
      colored(cyl(0.05, 0.036, 0.36).translate(0, -0.18, 0), paint([x, y, z], (X, Y) => (Y < 0.16 ? WHITE : null))),
      colored(cyl(0.036, 0.042, 0.05).translate(0, -0.395, 0), '#3a302a'),
    ]);
    legs.push(pivot(g, geo, [x, y, z]));
  }

  const neckOff = [0, 0.56, 0.32];
  const headPaint = paint(neckOff, (X, Y, Z) => (Math.abs(X) < 0.022 && Z > 0.52 && Y > 0.6 ? WHITE : null));
  const neckGeo = mergeColored([
    colored(cyl(0.075, 0.105, 0.22).translate(0, 0.11, 0).rotateX(1.05), paint(neckOff)),
    colored(sphere(0.08), headPaint, { pos: [0, 0.08, 0.26], rot: [0.5, 0, 0], scale: [0.9, 1, 1.35] }),
    colored(sphere(1, 12, 8), PINK, { pos: [0, 0.01, 0.355], scale: [0.072, 0.052, 0.058] }),
    colored(sphere(0.01, 5, 4), '#3a2424', { pos: [0.025, 0.012, 0.41] }),
    colored(sphere(0.01, 5, 4), '#3a2424', { pos: [-0.025, 0.012, 0.41] }),
    colored(new THREE.ConeGeometry(0.014, 0.065, 6), '#efe3c2', { pos: [0.06, 0.16, 0.21], rot: [0, 0, -0.95] }),
    colored(new THREE.ConeGeometry(0.014, 0.065, 6), '#efe3c2', { pos: [-0.06, 0.16, 0.21], rot: [0, 0, 0.95] }),
    colored(sphere(1, 8, 6), BLACK, { pos: [0.09, 0.115, 0.2], scale: [0.055, 0.022, 0.035] }),
    colored(sphere(1, 8, 6), BLACK, { pos: [-0.09, 0.115, 0.2], scale: [0.055, 0.022, 0.035] }),
    colored(sphere(0.012, 6, 5), '#111', { pos: [0.062, 0.12, 0.29] }),
    colored(sphere(0.012, 6, 5), '#111', { pos: [-0.062, 0.12, 0.29] }),
  ]);
  const neck = pivot(g, neckGeo, neckOff);

  const tailGeo = mergeColored([
    colored(cyl(0.013, 0.018, 0.36).translate(0, -0.18, 0), paint([0, 0.62, -0.36])),
    colored(sphere(1, 8, 6), BLACK, { pos: [0, -0.39, 0], scale: [0.03, 0.06, 0.03] }),
  ]);
  const tail = pivot(g, tailGeo, [0, 0.62, -0.37]);
  tail.rotation.x = -0.12;
  return { g, neck, tail, legs };
}

/* ------------------------------ Gallinas ----------------------------- */
export function buildChicken({ rooster = false, color = '#f6f1e6', wing = '#e4dccb' } = {}) {
  const g = new THREE.Group();
  const comb = '#d8322c', beak = '#f2a93b';
  const parts = [
    colored(sphere(1, 12, 9), color, { pos: [0, 0.12, 0], scale: [0.075, 0.07, 0.095] }),
    colored(sphere(0.06, 10, 8), color, { pos: [0, 0.118, 0.05] }),
    colored(sphere(1, 8, 6), wing, { pos: [0.067, 0.126, -0.005], scale: [0.02, 0.045, 0.07] }),
    colored(sphere(1, 8, 6), wing, { pos: [-0.067, 0.126, -0.005], scale: [0.02, 0.045, 0.07] }),
    colored(cyl(0.008, 0.008, 0.07, 5), beak, { pos: [0.026, 0.035, 0] }),
    colored(cyl(0.008, 0.008, 0.07, 5), beak, { pos: [-0.026, 0.035, 0] }),
  ];
  if (rooster) {
    parts.push(
      colored(new THREE.ConeGeometry(0.055, 0.2, 7), '#1f3d2e', { pos: [0, 0.21, -0.1], rot: [-0.55, 0, 0] }),
      colored(new THREE.ConeGeometry(0.04, 0.16, 7), '#4a2f6b', { pos: [0, 0.2, -0.12], rot: [-0.95, 0, 0] }),
    );
  } else {
    parts.push(colored(new THREE.ConeGeometry(0.048, 0.11, 7), color, { pos: [0, 0.17, -0.085], rot: [-0.6, 0, 0] }));
  }
  const bm = new THREE.Mesh(mergeColored(parts), VC_SMOOTH);
  bm.castShadow = true;
  g.add(bm);

  const big = rooster ? 1.5 : 1;
  const headGeo = mergeColored([
    colored(sphere(1, 8, 6), color, { pos: [0, 0.02, 0.01], scale: [0.034, 0.05, 0.034] }),
    colored(sphere(0.036, 10, 8), color, { pos: [0, 0.058, 0.025] }),
    colored(sphere(1, 8, 6), comb, { pos: [0, 0.095, 0.02], scale: [0.011, 0.024 * big, 0.034 * big] }),
    colored(sphere(1, 6, 5), comb, { pos: [0, 0.03, 0.058], scale: [0.011, 0.02 * big, 0.012] }),
    colored(new THREE.ConeGeometry(0.012, 0.032, 6).rotateX(Math.PI / 2), beak, { pos: [0, 0.055, 0.068] }),
    colored(sphere(0.007, 5, 4), '#111', { pos: [0.03, 0.066, 0.04] }),
    colored(sphere(0.007, 5, 4), '#111', { pos: [-0.03, 0.066, 0.04] }),
  ]);
  const head = pivot(g, headGeo, [0, 0.16, 0.06]);
  g.scale.setScalar(rooster ? 1.6 : 1.4);
  return { g, head, body: bm };
}
