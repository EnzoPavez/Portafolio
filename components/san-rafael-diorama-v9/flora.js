import * as THREE from 'three';
import { rng, lerp, wave, smoothstep, windGust, WIND, GEO, FX } from './utils.js';
import {
  W, D, GORGE, gorgeHeight, PARCELS, parcelRows, RIVER_SAMPLES, riverWidth, mountainHeight, distToRiver, forestNoise, vegetationLine, snowLine,
  LANE, ROAD, ACEQUIA_Z, PATIO, SCREE,
} from './layout.js';

const PALETTES = {
  green: ['#4f8f3a', '#5a9b3f', '#468434', '#63a445', '#3f7a31', '#6aa94a'],
  autumn: ['#e0b13a', '#d9962e', '#c9672b', '#b8452f', '#e6c652', '#cf7f2a', '#a8b23e'],
};
const GRAPES = ['#4b2353', '#5b2a62', '#3d1d48', '#6a3270'];
const ROSES = ['#e8475f', '#f28ca0', '#d62f45', '#f6c1cc', '#fbe7a1'];
const LEAF = (sway) => [sway, FX.LEAF];
const WOOD = [0, FX.WOOD];
const STONE = [0, FX.STONE];
const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _e = new THREE.Euler();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _fwd = new THREE.Vector3(0, 0, 1);

// Alambre recto entre dos puntos (una caja finita estirada).
function wire(batch, a, b, color, t = 0.012) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  _e.setFromQuaternion(_q.setFromUnitVectors(_fwd, _b.sub(_a).normalize()));
  batch.add(GEO.boxC, color, { pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: [_e.x, _e.y, _e.z], scale: [t, t, len], shadow: false });
}

// Roca apoyada según la normal del terreno (no queda flotando del lado de abajo).
function groundRock(batch, r, geo, color, x, z, s, sink) {
  const h = mountainHeight(x, z);
  const hx = mountainHeight(x + 0.2, z) - mountainHeight(x - 0.2, z), hz = mountainHeight(x, z + 0.2) - mountainHeight(x, z - 0.2);
  _n.set(-hx / 0.4, 1, -hz / 0.4).normalize();
  _q.setFromUnitVectors(_up, _n).multiply(_qy.setFromAxisAngle(_up, r() * Math.PI * 2));
  _e.setFromQuaternion(_q);
  const g = Math.hypot(hx, hz) / 0.4;
  batch.add(geo, color, {
    pos: [x, h - s * (sink + 0.12 * g), z], rot: [_e.x, _e.y, _e.z], scale: [s * 1.5, s * 0.6, s * 1.2], ao: [-1, 0.6, 0.72], fx: STONE, shadow: s > 0.15,
  });
}

/* Viñedos en espaldera: postes, troncos, follaje y racimos. */
export function addVineyards(batch) {
  const r = rng(11);
  for (const p of PARCELS) {
    const pal = PALETTES[p.palette];
    const low = p.lod === 'low';
    const step = low ? 0.44 : 0.29;
    for (const row of parcelRows(p)) {
      const [ax, az] = row.a, [bx, bz] = row.b;
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const ry = Math.atan2(dx, dz);
      const at = (s) => [ax + dx * s, az + dz * s];
      const rowBase = pal[Math.floor(r() * pal.length)];
      if (!low) {
        const [x, z] = at(-0.32);
        batch.add(GEO.cyl4o, '#4f7a35', { pos: [x, 0, z], scale: [0.015, 0.3, 0.015], shadow: false });
        batch.add(GEO.ico, '#3f7a31', { pos: [x, 0.3, z], rot: [r(), r() * 3, 0], scale: [0.11, 0.1, 0.11], fx: LEAF(1), shadow: false });
        for (let k = 0; k < 3; k++) {
          const a = r() * Math.PI * 2;
          batch.add(GEO.ico, ROSES[Math.floor(r() * ROSES.length)], { pos: [x + Math.cos(a) * 0.07, 0.34 + r() * 0.06, z + Math.sin(a) * 0.07], scale: 0.035, fx: [1, 0], shadow: false });
        }
      }

      for (let s = 0; s <= len + 1e-3; s += low ? len : len / Math.max(1, Math.round(len / 1.6))) {
        const end = s < 0.01 || s > len - 0.01;
        const [x, z] = at(s);
        batch.add(GEO.cyl4o, '#6b4a2f', { pos: [x, 0, z], scale: [end ? 0.035 : 0.024, end ? 0.74 : 0.64, end ? 0.035 : 0.024], ao: [0, 0.3, 0.6], fx: WOOD });
      }
      // Alambres de la espaldera y las riendas que tensan los postes de cabecera
      if (!low) {
        for (const y of [0.34, 0.6]) wire(batch, [ax, y, az], [bx, y, bz], '#4d4f52');
        for (const [s, out] of [[0, -0.38], [len, 0.38]]) {
          const [x, z] = at(s);
          wire(batch, [x, 0.7, z], [x + dx * out, 0, z + dz * out], '#4d4f52');
        }
      }
      for (let s = 0.2; s < len - 0.15; s += step) {
        const [x, z] = at(s);
        const c = r() < 0.55 ? rowBase : pal[Math.floor(r() * pal.length)];
        if (!low && Math.round(s / 0.29) % 2 === 0) batch.add(GEO.cyl4o, '#5b3d27', { pos: [x, 0, z], scale: [0.022, 0.26, 0.022], shadow: false });
        batch.add(GEO.ico, c, {
          pos: [x, 0.42 + (r() - 0.5) * 0.04, z], rot: [r() * 0.4, ry + r() * 0.6, r() * 0.3],
          scale: [0.17 + r() * 0.03, 0.2 + r() * 0.04, low ? 0.3 : 0.23], ao: [-0.9, 0.6, 0.62], jitter: 0.12, rand: r, fx: LEAF(1),
        });
        if (!low && r() < 0.5) {
          batch.add(GEO.ico, c, { pos: [x + (r() - 0.5) * 0.06, 0.6, z], rot: [r(), r() * 3, 0], scale: 0.11 + r() * 0.04, jitter: 0.15, rand: r, fx: LEAF(1), shadow: false });
        }
        for (const side of [-1, 1]) {
          if (r() > p.grapes * (low ? 0.3 : 1)) continue;
          const ox = Math.cos(ry) * 0.13 * side, oz = -Math.sin(ry) * 0.13 * side;
          batch.add(GEO.cone5o, GRAPES[Math.floor(r() * GRAPES.length)], {
            pos: [x + ox, 0.32, z + oz], rot: [Math.PI, r() * 3, 0], scale: [0.045, 0.11, 0.045], fx: [1, 0], shadow: false,
          });
        }
      }
    }
  }
}

/* Álamos: el sello de Mendoza. Instanciados para poder mecerlos con el viento.
   v9: con las ráfagas se mecen más, se inclinan y las hojas titilan (aGust).
   Devuelve también dónde están los dorados, de los que caen hojas (leaves.js). */
export function buildPoplars(batch, ao) {
  const r = rng(31);
  const spots = [];
  for (let z = -3.2; z <= D / 2 + 3.2; z += 1.15) spots.push([-W / 2 + 0.45, z, 1]);
  // Alrededores: la hilera del fondo sigue hacia la izquierda y otra cortina en el campo
  for (let x = -21.4; x < -16.8; x += 1.25) spots.push([x, -3.75, 1.0]);
  for (let z = 6.6; z <= 12.6; z += 1.2) spots.push([-21.7, z, 0.95]);
  for (let x = -16.6; x <= 4.8; x += 1.25) spots.push([x, -3.75, 1.05]);
  for (let z = 5.3; z <= D / 2 - 0.4; z += 1.2) spots.push([LANE.x + 0.78, z, 0.82]);
  for (let z = 4.9; z <= D / 2 - 0.4; z += 1.25) spots.push([W / 2 - 0.45, z, 0.85]);

  const profile = [[0, 0], [0.3, 0.12], [0.42, 0.55], [0.44, 1.2], [0.36, 2.0], [0.22, 2.7], [0.08, 3.1], [0, 3.25]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(profile, 7).toNonIndexed();
  const pa = geo.attributes.position;
  const col = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    const f = lerp(0.55, 1.08, Math.min(1, pa.getY(i) / 2.4));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const gustAttr = new THREE.InstancedBufferAttribute(new Float32Array(spots.length), 1);
  geo.setAttribute('aGust', gustAttr);
  const inst = new THREE.InstancedMesh(geo, material, spots.length);
  inst.castShadow = true;
  inst.receiveShadow = true;
  const greens = ['#5c9a3a', '#6aa843', '#4f8a35', '#78b34c', '#5f9e41'];
  const golds = ['#d4b23c', '#e3c24c', '#bfae3a'];
  const data = [];
  const golden = [];
  const c = new THREE.Color();
  spots.forEach(([x, z, hs], i) => {
    const s = 0.85 + r() * 0.25;
    const h = (0.95 + r() * 0.25) * hs;
    const gold = r() < 0.14;
    c.set(gold ? golds[Math.floor(r() * golds.length)] : greens[Math.floor(r() * greens.length)]);
    inst.setColorAt(i, c);
    if (gold) golden.push({ x, z, top: 0.42 + 3.1 * h, color: c.getHexString() });
    data.push({ x, z, s, h, phase: r(), amp: 0.025 + r() * 0.02 });
    batch.add(GEO.cyl6, '#7a5a3c', { pos: [x, 0, z], scale: [0.065, 0.55, 0.065], ao: [0, 0.4, 0.6] });
    ao.push({ x: x + 0.25, z: z - 0.15, r: 0.85, a: 0.32 });
  });

  const dummy = new THREE.Object3D();
  const update = (T) => {
    data.forEach((d, i) => {
      // La ráfaga: más vaivén y la copa inclinada hacia donde sopla
      const g = windGust(d.x, d.z, T);
      const a = d.amp * (0.7 + 1.4 * g), lean = 0.045 * g;
      dummy.position.set(d.x, 0.42, d.z);
      dummy.rotation.set(wave(T, 3, d.phase) * a + lean * WIND.z, 0, wave(T, 4, d.phase + 0.3) * a * 1.3 - lean * WIND.x);
      dummy.scale.set(d.s, d.h, d.s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      gustAttr.setX(i, g);
    });
    inst.instanceMatrix.needsUpdate = true;
    gustAttr.needsUpdate = true;
  };
  update(0);
  inst.computeBoundingSphere();
  return { object: inst, update, golden };
}

/* Árbol redondo genérico (sauces, moreras). */
function roundTree(batch, ao, r, x, z, size, colors, { trunk = '#6e4f35', willow = false } = {}) {
  const th = 0.5 * size;
  batch.add(GEO.cyl6, trunk, { pos: [x, 0, z], scale: [0.08 * size, th + 0.35 * size, 0.08 * size], ao: [0, 0.3, 0.55], fx: WOOD });
  const blobs = willow ? 6 : 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r();
    const rad = i === 0 ? 0 : 0.42 * size;
    const s = (i === 0 ? 0.62 : 0.42 + r() * 0.12) * size;
    const y = th + 0.55 * size + (i === 0 ? 0.25 * size : (r() - 0.3) * 0.3 * size);
    batch.add(GEO.ico1, colors[Math.floor(r() * colors.length)], {
      pos: [x + Math.cos(a) * rad, y, z + Math.sin(a) * rad], rot: [r(), r() * 3, r()],
      scale: [s, s * (willow ? 1.05 : 0.9), s], ao: [-1, 0.7, 0.62], jitter: 0.1, rand: r, fx: LEAF(willow ? 0.8 : 0.5),
    });
  }
  ao.push({ x: x + 0.3 * size, z: z - 0.2 * size, r: 1.25 * size, a: 0.38 });
}

function oliveTree(batch, ao, r, x, z) {
  for (const k of [-1, 1]) {
    batch.add(GEO.cyl4o, '#7b6a55', { pos: [x + k * 0.04, 0, z], rot: [0, 0, k * 0.25], scale: [0.05, 0.5, 0.05], fx: WOOD });
  }
  const greys = ['#8fa16a', '#99a874', '#7f9461', '#a3b07e'];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    batch.add(GEO.ico1, greys[Math.floor(r() * greys.length)], {
      pos: [x + Math.cos(a) * 0.28, 0.62 + r() * 0.12, z + Math.sin(a) * 0.28], rot: [r(), r(), r()],
      scale: [0.4, 0.3, 0.4], ao: [-1, 0.6, 0.6], jitter: 0.08, rand: r, fx: LEAF(0.5),
    });
  }
  ao.push({ x: x + 0.2, z: z - 0.1, r: 0.9, a: 0.35 });
}

export function addTrees(batch, ao) {
  const r = rng(41);
  const willow = ['#9cc85a', '#a8cf63', '#8fbf52'];
  const round = ['#5f9a45', '#6aa64c', '#548c3e'];
  [[10.6, 0.3, 1.0], [11.0, 8.0, 1.1], [10.7, 11.9, 0.9], [5.7, 9.4, 1.0], [5.9, 1.6, 0.85], [10.4, -3.2, 0.8], [5.4, -3.0, 0.8]]
    .forEach(([x, z, s]) => roundTree(batch, ao, r, x, z, s, willow, { willow: true }));
  [[-5.6, -2.7, 0.9], [4.9, -0.7, 0.75], [12.1, 1.5, 0.95], [16.9, 2.3, 0.8], [-12.05, 1.45, 0.78]]
    .forEach(([x, z, s]) => roundTree(batch, ao, r, x, z, s, round));
  for (const z of [6.0, 8.4]) for (const x of [11.9, 14.2, 16.4]) oliveTree(batch, ao, r, x + (r() - 0.5) * 0.3, z + (r() - 0.5) * 0.3);
  // Alrededores: olivar del frente y árboles sueltos (todo bajo, para no tapar la escena)
  for (const z of [15.2, 17.6]) for (const x of [13.6, 15.8, 18.0]) oliveTree(batch, ao, r, x + (r() - 0.5) * 0.4, z + (r() - 0.5) * 0.4);
  [[-23.6, -5.6, 0.9], [-20.4, -8.6, 0.8], [-24.2, 1.4, 0.85], [-19.4, 13.6, 0.7], [22.4, -4.6, 0.6]]
    .forEach(([x, z, s]) => roundTree(batch, ao, r, x, z, s, round));
}

/* Arbustos y piedras en la montaña, piedras en el río, matas de pasto y flores. */
export function addDetails(batch, ao) {
  const r = rng(51);
  // Bosques de pinos agrupados en las manchas oscuras + arbustos y rocas sueltas
  // Los pinos proyectan sombra: así se asientan en la ladera
  const pine = (x, y, z, s, c) => {
    batch.add(GEO.cyl4o, '#5b4330', { pos: [x, y - 0.05, z], scale: [0.1 * s, 0.48 * s, 0.1 * s], shadow: false });
    batch.add(GEO.cone6o, c, { pos: [x, y + 0.32 * s, z], scale: [0.44 * s, 0.88 * s, 0.44 * s], ao: [0, 0.6, 0.7], fx: LEAF(0.35) });
    batch.add(GEO.cone6o, c, { pos: [x, y + 0.8 * s, z], scale: [0.32 * s, 0.72 * s, 0.32 * s], fx: LEAF(0.35) });
  };
  let pines = 0, others = 0;
  for (let i = 0; i < 6000 && (pines < 200 || others < 70); i++) {
    const x = lerp(-W / 2 + 0.5, W / 2 - 0.5, r());
    const z = lerp(-D / 2 + 0.4, -3.7, r());
    const h = mountainHeight(x, z);
    if (h < 0.12 || h > Math.min(3.8, snowLine(x, z) - 1.0)) continue;
    const gx = mountainHeight(x + 0.25, z) - h, gz = mountainHeight(x, z + 0.25) - h;
    if (Math.hypot(gx, gz) > 0.42) continue;
    if (distToRiver(x, z) < 2.6) continue;
    const n = forestNoise(x, z);
    const green = h < vegetationLine(x, z) - 0.05;
    if (n > 0.575 && pines < 200) {
      // Menos pinos pero más grandes; cerca del límite del bosque quedan achaparrados
      const s = (0.26 + r() * 0.16) * lerp(1.2, 0.75, smoothstep(0.6, 3.6, h));
      pine(x, h, z, s, ['#2f5f2f', '#386b33', '#2b5629', '#41763a'][Math.floor(r() * 4)]);
      pines++;
    } else if (n < 0.5 && others < 70 && r() < 0.08) {
      const s = 0.1 + r() * 0.12;
      // Arbustos sólo sobre el pasto, bajos y pegados al suelo; en la roca, lajas chatas
      if (green && r() < 0.6) batch.add(GEO.ico, r() < 0.5 ? '#5d8c43' : '#6f9a4e', { pos: [x, h + s * 0.15, z], rot: [r() * 0.3, r() * 3, r() * 0.3], scale: [s * 1.2, s * 0.55, s * 1.2], fx: LEAF(0.3), shadow: false });
      // Lajas en gris medio: más claras que la roca se ven como papelitos sueltos
      else batch.add(GEO.ico, r() < 0.5 ? '#97948c' : '#a5a198', { pos: [x, h + s * 0.1, z], rot: [r() * 0.4, r() * 3, 0], scale: [s * 1.2, s * 0.45, s], fx: STONE, shadow: false });
      others++;
    }
  }
  // Pedreros al pie de las paredes: una roca grande (con sombra), algunas medianas y
  // piedritas que rodaron ladera abajo abriéndose en abanico
  const greys = ['#8e8a83', '#a39e95', '#7a7772', '#aaa59c'];
  const reds = ['#a8796a', '#93705f', '#b58a77'];
  for (const c of SCREE) {
    const pal = c.red ? reds : greys;
    const col = () => pal[Math.floor(r() * pal.length)];
    const at = (along, lat) => [c.x + c.dx * along - c.dz * lat, c.z + c.dz * along + c.dx * lat];
    groundRock(batch, r, GEO.dodeca, col(), c.x, c.z, 0.24 + r() * 0.08, 0.3);
    for (let k = 0; k < 10; k++) {
      const along = 0.15 + r() * 1.4, lat = (r() - 0.5) * (0.3 + along * 0.75);
      const big = k < 3;
      const [x, z] = at(along, lat);
      groundRock(batch, r, big ? GEO.ico : GEO.octa, col(), x, z, big ? 0.12 + r() * 0.05 : 0.05 + r() * 0.04, big ? 0.3 : 0.15);
    }
  }
  // Algunas rocas sueltas en las pendientes más fuertes
  let rocks = 0;
  for (let i = 0; i < 9000 && rocks < 30; i++) {
    const x = lerp(-W / 2 + 0.4, W / 2 - 0.4, r());
    const z = lerp(-D / 2 + 0.3, -3.4, r());
    const h = mountainHeight(x, z);
    if (h < 0.35 || h > snowLine(x, z) - 0.2) continue;
    const g = Math.hypot(mountainHeight(x + 0.2, z) - mountainHeight(x - 0.2, z), mountainHeight(x, z + 0.2) - mountainHeight(x, z - 0.2)) / 0.4;
    if (g > 2.3 || g < (h > vegetationLine(x, z) ? 0.9 : 1.4)) continue;
    const s = 0.1 + r() * 0.14;
    groundRock(batch, r, r() < 0.5 ? GEO.dodeca : GEO.ico, (distToRiver(x, z) < 3.9 ? reds : greys)[Math.floor(r() * 3)], x, z, s, 0.3);
    rocks++;
  }

  // Piedras en el borde y el lecho de la garganta
  for (const p of RIVER_SAMPLES) {
    if (p.z < GORGE.z1 + 0.2 || r() > 0.55) continue;
    for (const side of [-1, 1]) {
      const s = 0.12 + r() * 0.2;
      const off = r() < 0.5 ? 1.0 + r() * 0.8 : riverWidth(p.z) / 2 + 0.05 + r() * 0.15;
      const rx = p.x + side * off, rz = p.z + (r() - 0.5) * 0.3;
      batch.add(GEO.dodeca, r() < 0.5 ? '#8f8578' : '#a69b8d', {
        pos: [rx, gorgeHeight(rx, rz) + s * 0.2, rz], rot: [r() * 3, r() * 3, 0], scale: [s * 1.3, s * 0.8, s], fx: STONE,
      });
    }
  }

  // Afloramientos en las paredes de la garganta, apoyados según la pendiente
  let wall = 0;
  for (let i = 0; i < 5000 && wall < 70; i++) {
    const x = lerp(5.5, 13.5, r()), z = lerp(GORGE.z0 + 0.02, 18.5, r());
    const h = gorgeHeight(x, z);
    if (h > -0.12) continue;
    const hx = gorgeHeight(x + 0.12, z) - gorgeHeight(x - 0.12, z), hz = gorgeHeight(x, z + 0.12) - gorgeHeight(x, z - 0.12);
    const g = Math.hypot(hx, hz) / 0.24;
    if (g < 0.7 || distToRiver(x, z) < 0.75) continue;
    _n.set(-hx / 0.24, 1, -hz / 0.24).normalize();
    _q.setFromUnitVectors(_up, _n).multiply(_qy.setFromAxisAngle(_up, r() * Math.PI * 2));
    _e.setFromQuaternion(_q);
    const s = 0.12 + r() * 0.2;
    batch.add(r() < 0.5 ? GEO.dodeca : GEO.ico, ['#9a8f82', '#857a6e', '#aca191', '#7a7066'][Math.floor(r() * 4)], {
      pos: [x, h - s * 0.25, z], rot: [_e.x, _e.y, _e.z], scale: [s * 1.5, s * 0.55, s * 1.2], fx: STONE,
    });
    wall++;
  }

  // Piedras de río y del cañón
  for (let i = 0; i < 70; i++) {
    const p = RIVER_SAMPLES[Math.floor(r() * RIVER_SAMPLES.length)];
    if (Math.abs(p.z - ROAD.z) < 1.3 || p.z > GORGE.z0 - 0.3) continue;
    const side = r() < 0.5 ? -1 : 1;
    const off = riverWidth(p.z) / 2 + 0.1 + r() * 0.5;
    const s = 0.07 + r() * (p.z < -4 ? 0.26 : 0.14);
    batch.add(GEO.dodeca, r() < 0.5 ? '#a8a092' : '#bdb4a6', { pos: [p.x + side * off, s * 0.25, p.z + (r() - 0.5) * 0.4], rot: [r() * 3, r() * 3, 0], scale: [s * 1.3, s * 0.8, s], fx: STONE, shadow: false });
  }
  // Matas de pasto en bordes, caminos y acequia
  const tuft = (x, z, s = 1) => {
    for (let k = 0; k < 3; k++) {
      batch.add(GEO.cone3o, k === 1 ? '#5f9a3c' : '#73ab48', {
        pos: [x + (r() - 0.5) * 0.08, 0, z + (r() - 0.5) * 0.08], rot: [(r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6],
        scale: [0.025 * s, (0.12 + r() * 0.08) * s, 0.025 * s], fx: [1, 0], shadow: false,
      });
    }
  };
  const free = (x, z) => distToRiver(x, z) > 1.3 && !PARCELS.some((p) => x > p.x0 - 0.3 && x < p.x1 + 0.3 && z > p.z0 - 0.3 && z < p.z1 + 0.3);
  for (let i = 0; i < 110; i++) {
    const x = lerp(-W / 2 + 0.15, W / 2 - 0.15, r());
    if (free(x, D / 2 - 0.15)) tuft(x, D / 2 - 0.12 - r() * 0.2, 1.1);
  }
  for (let i = 0; i < 60; i++) {
    const z = lerp(-2, D / 2 - 0.15, r());
    if (free(W / 2 - 0.15, z)) tuft(W / 2 - 0.12 - r() * 0.2, z, 1.1);
  }
  for (let i = 0; i < 120; i++) {
    const x = lerp(-W / 2 + 0.3, W / 2 - 0.3, r());
    const z = r() < 0.5 ? ROAD.z + (ROAD.half + 0.12) * (r() < 0.5 ? -1 : 1) : ACEQUIA_Z - 0.34;
    if (free(x, z)) tuft(x, z);
  }
  // Flores silvestres
  const flowers = ['#f7d64a', '#ffffff', '#e86f9a', '#b48be0'];
  for (let i = 0; i < 200; i++) {
    const x = lerp(-W / 2 + 0.4, W / 2 - 0.4, r()), z = lerp(-3, D / 2 - 0.3, r());
    if (!free(x, z) || Math.abs(z - ROAD.z) < 1 || Math.abs(x - LANE.x) < 0.7) continue;
    if (x > PATIO.x0 && x < PATIO.x1 && z > PATIO.z0 && z < PATIO.z1) continue;
    batch.add(GEO.octa, flowers[i % flowers.length], { pos: [x, 0.06, z], scale: 0.035, fx: [0.6, 0], shadow: false });
    if (i % 3 === 0) batch.add(GEO.cone3o, '#5f9a3c', { pos: [x, 0, z], scale: [0.006, 0.06, 0.006], shadow: false });
  }
}
