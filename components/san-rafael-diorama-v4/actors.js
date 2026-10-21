import * as THREE from 'three';
import { TAU, lerp, smoothstep, wave, pingPong, mat, colored, mergeColored, VC_FLAT, vcMesh } from './utils.js';
import { EXT, ROAD, PERGOLA, BODEGA, CORRAL } from './layout.js';
import { roadY } from './buildings.js';
import { buildHorse } from './animals.js';

/* ------------------------------------------------------------------ */
/* Personitas articuladas                                              */
/* ------------------------------------------------------------------ */

const PG = {
  leg: new THREE.BoxGeometry(0.075, 0.24, 0.085).translate(0, -0.12, 0),
  shoe: new THREE.BoxGeometry(0.08, 0.035, 0.11).translate(0, -0.235, 0.012),
  torso: new THREE.CylinderGeometry(0.088, 0.108, 0.22, 7).translate(0, 0.11, 0),
  head: new THREE.IcosahedronGeometry(0.068, 1),
  arm: new THREE.BoxGeometry(0.052, 0.19, 0.058).translate(0, -0.095, 0),
  hand: new THREE.IcosahedronGeometry(0.03, 0).translate(0, -0.2, 0),
  brim: new THREE.CylinderGeometry(0.125, 0.125, 0.012, 12),
  crown: new THREE.CylinderGeometry(0.052, 0.066, 0.055, 10),
  boina: new THREE.CylinderGeometry(0.078, 0.07, 0.032, 12).rotateX(-0.25),
  fedBrim: new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12),
  fedCrown: new THREE.CylinderGeometry(0.05, 0.062, 0.06, 10),
  fedBand: new THREE.CylinderGeometry(0.063, 0.063, 0.014, 10),
  hair: new THREE.IcosahedronGeometry(0.07, 1).scale(1.02, 0.85, 1.02),
  helmet: new THREE.SphereGeometry(0.078, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  bun: new THREE.IcosahedronGeometry(0.034, 1),
  dress: new THREE.CylinderGeometry(0.085, 0.175, 0.25, 10).translate(0, -0.1, 0),
  tiara: new THREE.CylinderGeometry(0.06, 0.062, 0.022, 12),
  tiaraTip: new THREE.ConeGeometry(0.012, 0.032, 5),
};

const SKINS = ['#f1c7a1', '#e2ad84', '#c98f66', '#a8714d'];
export { SKINS };

/* Multitud instanciada: todas las personas comparten un InstancedMesh por pieza
   (piernas, torso, mangas, manos, cabeza, pelo, cada tipo de sombrero...).
   Cada persona es sólo una jerarquía de nodos vacíos que se anima igual que
   antes; en cada cuadro se copian sus matrices a las instancias. Pasa de ~6
   draw calls por persona a ~14 en total para toda la gente. */

const pcache = new Map();
const cached = (key, build) => {
  if (!pcache.has(key)) pcache.set(key, build());
  return pcache.get(key);
};

// Geometrías en blanco (el color sale de cada instancia) o con colores fijos.
const PART_GEO = {
  leg: () => mergeColored([colored(PG.leg, '#ffffff'), colored(PG.shoe, '#4a4a4a')]),
  torso: () => colored(PG.torso, '#ffffff'),
  sleeve: () => colored(PG.arm, '#ffffff'),
  hand: () => colored(PG.hand, '#ffffff'),
  head: () => colored(PG.head, '#ffffff'),
  hair: () => colored(PG.hair, '#ffffff', { pos: [0, 0.018, -0.012] }),
  straw: () => mergeColored([colored(PG.brim, '#e9d08f', { pos: [0, 0.04, 0] }), colored(PG.crown, '#e2c47c', { pos: [0, 0.07, 0] })]),
  boina: () => colored(PG.boina, '#25262b', { pos: [0, 0.05, -0.008] }),
  fedora: () => mergeColored([colored(PG.fedBrim, '#1d1d20', { pos: [0, 0.045, 0] }), colored(PG.fedCrown, '#1d1d20', { pos: [0, 0.078, 0] }), colored(PG.fedBand, '#7a1f2b', { pos: [0, 0.058, 0] })]),
  helmet: () => colored(PG.helmet, '#ffffff', { pos: [0, 0.008, -0.004] }),
  crown: () => mergeColored([
    colored(PG.tiara, '#f2c230', { pos: [0, 0.062, -0.004] }),
    ...[0, 1, 2, 3, 4].map((i) => colored(PG.tiaraTip, i === 2 ? '#e94f8a' : '#f2c230', { pos: [Math.sin((i - 2) * 0.5) * 0.052, 0.088, Math.cos((i - 2) * 0.5) * 0.052 - 0.004] })),
  ]),
  bun: () => colored(PG.bun, '#ffffff', { pos: [0, 0.035, -0.075] }),
  flower: () => colored(PG.bun, '#d8322c', { pos: [0.05, 0.05, -0.03], scale: 0.5 }),
  dress: () => colored(PG.dress, '#ffffff'),
};

const VC_CROWD = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
let crowd = null;

// Abrir antes de crear personas y cerrar después: devuelve las instancias listas.
export function beginCrowd() {
  crowd = new Map();
}

function reg(key, node, color) {
  if (!crowd.has(key)) crowd.set(key, []);
  crowd.get(key).push({ node, color: new THREE.Color(color) });
}

export function endCrowd() {
  const group = new THREE.Group();
  const lists = [];
  for (const [key, items] of crowd) {
    const m = new THREE.InstancedMesh(cached(key, PART_GEO[key]), VC_CROWD, items.length);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    items.forEach((it, i) => m.setColorAt(i, it.color));
    m.instanceColor.needsUpdate = true;
    group.add(m);
    lists.push({ m, items });
  }
  crowd = null;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const shown = (n) => {
    for (let o = n; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  return {
    group,
    // Llamar con las matrices de mundo ya actualizadas.
    sync() {
      for (const { m, items } of lists) {
        for (let i = 0; i < items.length; i++) m.setMatrixAt(i, shown(items[i].node) ? items[i].node.matrixWorld : zero);
        m.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

export function makePerson({ shirt, pants = '#2f3d5e', skin = SKINS[1], hat = null, hatColor = '#e63b2e', hair = '#3b2a20', scale = 1.2, dress = null, bun = false }) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const hips = new THREE.Group();
  hips.position.y = 0.26;
  root.add(hips);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.x = -0.048;
  legR.position.x = 0.048;
  for (const l of [legL, legR]) {
    reg('leg', l, pants);
    hips.add(l);
  }
  if (dress) reg('dress', hips, dress);
  const upper = new THREE.Group();
  hips.add(upper);
  reg('torso', upper, shirt);
  const head = new THREE.Group();
  head.position.y = 0.3;
  upper.add(head);
  reg('head', head, skin);
  if (hat === 'straw' || hat === 'boina' || hat === 'fedora') reg(hat, head, '#ffffff');
  else if (hat === 'helmet') reg('helmet', head, hatColor);
  else reg('hair', head, hair);
  if (hat === 'crown') reg('crown', head, '#ffffff');
  if (bun) {
    reg('bun', head, hair);
    reg('flower', head, '#ffffff');
  }
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.122, 0.2, 0);
  armR.position.set(0.122, 0.2, 0);
  for (const a of [armL, armR]) {
    reg('sleeve', a, shirt);
    reg('hand', a, skin);
    upper.add(a);
  }
  return { root, hips, upper, head, legL, legR, armL, armR };
}

// Sentado: raíz bajada para que la cadera quede sobre un asiento de altura `seat`.
export function sit(p, seat = 0.16, scale = 1.2) {
  p.root.position.y = seat + 0.02 - 0.26 * scale;
  p.legL.rotation.x = p.legR.rotation.x = -1.4;
  return p;
}

export function walkPose(p, cyc, amt = 1) {
  const s = Math.sin(cyc) * amt;
  p.legL.rotation.x = s * 0.6;
  p.legR.rotation.x = -s * 0.6;
  p.armL.rotation.x = -s * 0.5;
  p.armR.rotation.x = s * 0.5;
  p.hips.position.y = 0.26 + Math.abs(Math.cos(cyc)) * 0.018 * amt;
}

export function standPose(p) {
  p.legL.rotation.x = p.legR.rotation.x = 0;
  p.hips.position.y = 0.26;
}

/* ------------------------------------------------------------------ */
/* Vehículos: piezas fusionadas con color por vértice (pocas draw calls) */
/* ------------------------------------------------------------------ */

const CLIP = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), EXT.W / 2), new THREE.Plane(new THREE.Vector3(1, 0, 0), EXT.W / 2)];
const clipCache = new Map();
export const VC_CLIP = VC_FLAT.clone();
VC_CLIP.clippingPlanes = CLIP;
const clipMat = (color) => {
  if (!clipCache.has(color)) clipCache.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, clippingPlanes: CLIP }));
  return clipCache.get(color);
};

export function part(parent, geo, color, pos, rot, m = clipMat) {
  const o = new THREE.Mesh(geo, m(color));
  o.position.set(...pos);
  if (rot) o.rotation.set(...rot);
  o.castShadow = true;
  parent.add(o);
  return o;
}

const B = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);

export function wheel(parent, r, w, pos, hub = '#f2c230') {
  const geo = cached(`wheel${r}${w}${hub}`, () => mergeColored([
    colored(new THREE.CylinderGeometry(r, r, w, 14).rotateX(Math.PI / 2), '#2b2b2b'),
    colored(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.01, 8).rotateX(Math.PI / 2), hub),
    colored(B(r * 1.6, r * 0.18, w + 0.02), '#3d3d3d'),
  ]));
  const g = new THREE.Group();
  g.position.set(...pos);
  g.add(vcMesh(geo, VC_CLIP));
  parent.add(g);
  return g;
}

function buildTractor() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  body.add(vcMesh(mergeColored([
    colored(B(0.62, 0.2, 0.26), '#d13a2c', { pos: [0.38, 0.33, 0] }),
    colored(B(0.66, 0.05, 0.28), '#b32c21', { pos: [0.38, 0.44, 0] }),
    colored(B(0.06, 0.16, 0.24), '#3a3a3a', { pos: [0.7, 0.32, 0] }),
    colored(B(0.3, 0.1, 0.5), '#d13a2c', { pos: [0.0, 0.44, 0] }),
    colored(B(0.14, 0.04, 0.2), '#2b2b2b', { pos: [-0.02, 0.5, 0] }),
    colored(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), '#444', { pos: [0.55, 0.6, 0.08] }),
    ...[-0.2, 0.2].map((z) => colored(B(0.03, 0.55, 0.03), '#2f2f2f', { pos: [-0.12, 0.72, z] })),
    colored(B(0.36, 0.04, 0.5), '#f1efe8', { pos: [-0.05, 1.0, 0] }),
  ]), VC_CLIP));
  const rear = [wheel(g, 0.25, 0.13, [0, 0.25, 0.27]), wheel(g, 0.25, 0.13, [0, 0.25, -0.27])];
  const front = [wheel(g, 0.13, 0.08, [0.58, 0.13, 0.2]), wheel(g, 0.13, 0.08, [0.58, 0.13, -0.2])];
  const driver = makePerson({ shirt: '#3d7dd8', hat: 'straw', skin: SKINS[2] });
  driver.root.position.set(-0.04, 0.21, 0);
  driver.root.rotation.y = Math.PI / 2;
  driver.legL.rotation.x = driver.legR.rotation.x = -1.3;
  driver.armL.rotation.x = driver.armR.rotation.x = -0.9;
  body.add(driver.root);

  // Acoplado con bins de uva
  const trailer = new THREE.Group();
  g.add(trailer);
  const load = [
    colored(B(0.5, 0.03, 0.03), '#333', { pos: [-0.45, 0.22, 0] }),
    colored(B(1.15, 0.06, 0.6), '#8b6744', { pos: [-1.25, 0.3, 0] }),
    ...[-0.29, 0.29].map((z) => colored(B(1.15, 0.12, 0.03), '#7a5a3c', { pos: [-1.25, 0.39, z] })),
  ];
  for (const bx of [-0.9, -1.25, -1.6]) {
    for (const bz of [-0.14, 0.14]) {
      load.push(colored(B(0.3, 0.16, 0.24), '#3f8f4a', { pos: [bx, 0.41, bz] }));
      load.push(colored(new THREE.IcosahedronGeometry(0.11, 0), '#5b2a62', { pos: [bx, 0.5, bz], rot: [0.4, bx, 0], scale: [1.2, 0.5, 1] }));
    }
  }
  trailer.add(vcMesh(mergeColored(load), VC_CLIP));
  const tw = [wheel(trailer, 0.15, 0.08, [-1.25, 0.15, 0.31], '#9a9a9a'), wheel(trailer, 0.15, 0.08, [-1.25, 0.15, -0.31], '#9a9a9a')];
  return { g, body, trailer, wheels: { rear, front, trailer: tw } };
}

function buildCyclist() {
  const g = new THREE.Group();
  const frame = '#1f8a7a';
  const wheelGeo = cached('bikewheel', () => mergeColored([
    colored(new THREE.TorusGeometry(0.13, 0.014, 6, 18).rotateY(Math.PI / 2), '#222'),
    colored(B(0.01, 0.24, 0.01), '#bbb'),
    colored(B(0.01, 0.01, 0.24), '#bbb'),
  ]));
  const wheels = [];
  for (const z of [-0.21, 0.21]) {
    const w = new THREE.Group();
    w.position.set(0, 0.14, z);
    w.add(vcMesh(wheelGeo, VC_CLIP));
    g.add(w);
    wheels.push(w);
  }
  g.add(vcMesh(mergeColored([
    colored(B(0.022, 0.022, 0.42), frame, { pos: [0, 0.27, 0] }),
    colored(B(0.022, 0.2, 0.022), frame, { pos: [0, 0.22, -0.06], rot: [0.25, 0, 0] }),
    colored(B(0.022, 0.2, 0.022), frame, { pos: [0, 0.24, 0.18], rot: [-0.2, 0, 0] }),
    colored(B(0.16, 0.02, 0.02), '#222', { pos: [0, 0.36, 0.19] }),
    colored(B(0.06, 0.02, 0.1), '#222', { pos: [0, 0.34, -0.08] }),
    colored(B(0.12, 0.06, 0.09), '#c9a35c', { pos: [0, 0.32, 0.27] }),
  ]), VC_CLIP));
  const rider = makePerson({ shirt: '#f6c445', pants: '#3a3a3a', skin: SKINS[0], hair: '#5a3b22' });
  rider.root.position.set(0, 0.04, -0.08);
  rider.upper.rotation.x = 0.4;
  rider.armL.rotation.x = rider.armR.rotation.x = -1.05;
  g.add(rider.root);
  return { g, wheels, rider };
}

/* ------------------------------------------------------------------ */
/* Animales                                                            */
/* ------------------------------------------------------------------ */

function buildDog() {
  const g = new THREE.Group();
  const c = '#b9773f';
  const m = (k) => mat(k);
  const B = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  part(g, B(0.08, 0.08, 0.22), c, [0, 0.13, 0], null, m);
  const head = part(g, B(0.08, 0.08, 0.09), c, [0, 0.2, 0.12], null, m);
  part(head, B(0.05, 0.04, 0.05), '#8a5530', [0, -0.01, 0.06], null, m);
  part(head, B(0.025, 0.04, 0.02), '#6b3f22', [0.03, 0.05, -0.01], null, m);
  part(head, B(0.025, 0.04, 0.02), '#6b3f22', [-0.03, 0.05, -0.01], null, m);
  const tail = new THREE.Group();
  tail.position.set(0, 0.16, -0.11);
  part(tail, B(0.02, 0.02, 0.1).translate(0, 0, -0.05), c, [0, 0, 0], [-0.6, 0, 0], m);
  g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.03, 0.08], [0.03, 0.08], [-0.03, -0.08], [0.03, -0.08]]) {
    const l = new THREE.Group();
    l.position.set(x, 0.1, z);
    part(l, B(0.025, 0.1, 0.025).translate(0, -0.05, 0), c, [0, 0, 0], null, m);
    g.add(l);
    legs.push(l);
  }
  g.scale.setScalar(1.3);
  return { g, legs, tail };
}

function buildBird(span, color, collar = null) {
  const g = new THREE.Group();
  const m = (k) => mat(k, { side: THREE.DoubleSide });
  part(g, new THREE.ConeGeometry(span * 0.07, span * 0.42, 5).rotateX(Math.PI / 2), color, [0, 0, 0], null, m);
  if (collar) part(g, new THREE.IcosahedronGeometry(span * 0.07, 0), collar, [0, 0.01, span * 0.12], null, m);
  const wing = (s) => {
    const shape = new THREE.Shape([new THREE.Vector2(0, 0.06 * span), new THREE.Vector2(s * span * 0.5, -0.02 * span), new THREE.Vector2(s * span * 0.42, -0.12 * span), new THREE.Vector2(0, -0.12 * span)]);
    const w = new THREE.Group();
    part(w, new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), color, [0, 0, 0], null, m);
    g.add(w);
    return w;
  };
  const wl = wing(1), wr = wing(-1);
  g.traverse((o) => (o.castShadow = false));
  return { g, wl, wr };
}

export function buildPuffs(n, color, opacity) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  return Array.from({ length: n }, () => {
    const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, flatShading: true, transparent: true, opacity, depthWrite: false, roughness: 1 }));
    o.userData.base = opacity;
    return o;
  });
}

/* ------------------------------------------------------------------ */

export function buildActors(house) {
  const group = new THREE.Group();
  const updates = [];

  // --- Cosecha en la parcela C ---
  const pickers = [
    { x: -2.7, z: 8.2, ry: Math.PI / 2, shirt: '#e94f37', hat: 'straw', ph: 0 },
    { x: 0.5, z: 10.4, ry: -Math.PI / 2, shirt: '#2bb3a3', hat: 'straw', ph: 0.33 },
    { x: 2.9, z: 7.0, ry: Math.PI / 2, shirt: '#8e5cc9', hat: null, ph: 0.6 },
    { x: -4.3, z: 11.2, ry: -Math.PI / 2, shirt: '#f08a24', hat: 'straw', ph: 0.15 },
  ];
  pickers.forEach((cfg, i) => {
    const p = makePerson({ shirt: cfg.shirt, hat: cfg.hat, skin: SKINS[(i + 1) % 4], pants: i % 2 ? '#4a3b2f' : '#2f3d5e' });
    p.root.position.set(cfg.x, 0, cfg.z);
    p.root.rotation.y = cfg.ry;
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 8), mat('#3f8f4a'));
    bucket.position.set(0.12, 0.05, 0.12);
    bucket.castShadow = true;
    p.root.add(bucket);
    group.add(p.root);
    updates.push((T) => {
      const b = 0.5 + 0.5 * wave(T, 2, cfg.ph);
      p.upper.rotation.x = lerp(0.25, 0.95, b);
      p.head.rotation.x = -0.3 * b;
      p.armL.rotation.x = lerp(-0.4, -1.25, b) + wave(T, 14, cfg.ph) * 0.18 * b;
      p.armR.rotation.x = lerp(-0.3, -1.1, b) + wave(T, 14, cfg.ph + 0.5) * 0.22 * b;
      p.hips.position.y = 0.26 - 0.035 * b;
    });
  });

  const carriers = [
    { x: -3.5, z0: 10.0, z1: 4.98, shirt: '#3d7dd8', ph: 0 },
    { x: 1.3, z0: 11.0, z1: 4.98, shirt: '#f6c445', ph: 0.5 },
  ];
  carriers.forEach((cfg, i) => {
    const p = makePerson({ shirt: cfg.shirt, hat: i ? 'boina' : 'straw', skin: SKINS[i * 2] });
    const bucket = new THREE.Group();
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.062, 0.11, 8), mat('#d2463a'));
    bk.castShadow = true;
    const grapes = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat('#5b2a62'));
    grapes.position.y = 0.05;
    grapes.scale.y = 0.6;
    bucket.add(bk, grapes);
    bucket.position.set(0.1, 0.4, -0.02);
    bucket.rotation.z = -0.3;
    p.upper.add(bucket);
    group.add(p.root);
    updates.push((T) => {
      const s = pingPong(T, 2, 0.12, cfg.ph);
      const z = lerp(cfg.z0, cfg.z1, s.p);
      p.root.position.set(cfg.x, 0, z);
      p.root.rotation.y = s.dir > 0 ? Math.PI : 0;
      grapes.visible = s.dir > 0;
      if (s.moving) walkPose(p, TAU * T * 38, 1);
      else standPose(p);
      p.armR.rotation.x = -2.75;
      p.armR.rotation.z = 0.25;
      p.upper.rotation.x = s.moving ? 0.08 : 0;
    });
  });

  // --- Bodega: visitantes brindando, empleado con cajón y perro ---
  const visitors = [
    { x: PERGOLA.x - 0.8, z: PERGOLA.z + 0.05, ry: Math.PI / 2, shirt: '#ffffff', pants: '#c4a77d', ph: 0 },
    { x: PERGOLA.x - 0.2, z: PERGOLA.z + 0.1, ry: -Math.PI / 2, shirt: '#e86f9a', pants: '#2f3d5e', ph: 0.5, hair: '#8a5a2a' },
    { x: PERGOLA.x + 0.55, z: PERGOLA.z + 0.36, ry: Math.PI, shirt: '#3fa34d', pants: '#3a3a3a', ph: 0.25 },
  ];
  visitors.forEach((cfg, i) => {
    const p = makePerson({ shirt: cfg.shirt, pants: cfg.pants, skin: SKINS[(i + 2) % 4], hair: cfg.hair });
    p.root.position.set(cfg.x, 0, cfg.z);
    p.root.rotation.y = cfg.ry;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.014, 0.05, 6), mat('#8e1b34'));
    glass.position.y = -0.22;
    p.armR.add(glass);
    group.add(p.root);
    updates.push((T) => {
      const sip = smoothstep(0.55, 0.95, wave(T, 3, cfg.ph));
      p.armR.rotation.x = lerp(-0.55, -2.0, sip);
      p.head.rotation.x = -0.25 * sip;
      p.armL.rotation.x = -0.1 + 0.08 * wave(T, 5, cfg.ph);
      p.upper.rotation.z = 0.04 * wave(T, 2, cfg.ph);
    });
  });

  {
    const p = makePerson({ shirt: '#7a1f33', pants: '#2a2a2a', skin: SKINS[1], hat: 'boina' });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.14), mat('#b8895a'));
    crate.position.set(0, 0.06, 0.15);
    crate.castShadow = true;
    p.upper.add(crate);
    group.add(p.root);
    // Recorrido puerta → pérgola, por delante de la pila de barricas
    const a = new THREE.Vector3(BODEGA.x + 0.55, 0, BODEGA.z + BODEGA.d / 2 + 1.05);
    const b = new THREE.Vector3(PERGOLA.x - 1.35, 0, PERGOLA.z + 0.3);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    updates.push((T) => {
      const s = pingPong(T, 3, 0.18, 0.1);
      p.root.position.lerpVectors(a, b, s.p);
      p.root.rotation.y = s.dir > 0 ? yaw : yaw + Math.PI;
      if (s.moving) walkPose(p, TAU * T * 54, 0.8);
      else standPose(p);
      p.armL.rotation.x = p.armR.rotation.x = -1.2;
      crate.visible = s.dir > 0;
    });
  }

  {
    const dog = buildDog();
    group.add(dog.g);
    const cx = -3.0, cz = 1.0, rx = 1.15, rz = 0.55;
    updates.push((T) => {
      const a = TAU * T * 5;
      dog.g.position.set(cx + Math.cos(a) * rx, 0, cz + Math.sin(a) * rz);
      dog.g.rotation.y = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
      dog.legs.forEach((l, i) => (l.rotation.x = Math.sin(TAU * T * 70 + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.2 : 0)) * 0.7));
      dog.tail.rotation.y = wave(T, 60) * 0.6;
    });
  }

  // --- Casa: mate en la galería y asado ---
  {
    const p = makePerson({ shirt: '#f2f2f2', pants: '#4a3b2f', skin: SKINS[2], hat: 'boina' });
    p.root.position.copy(house.mateSeat).add(new THREE.Vector3(0, -0.28, 0));
    p.legL.rotation.x = p.legR.rotation.x = -1.35;
    const mate = new THREE.Mesh(new THREE.IcosahedronGeometry(0.032, 0), mat('#8a5a2b'));
    mate.position.y = -0.22;
    p.armR.add(mate);
    group.add(p.root);
    updates.push((T) => {
      const sip = smoothstep(0.3, 0.9, wave(T, 2, 0.2));
      p.armR.rotation.x = lerp(-0.7, -2.1, sip);
      p.armL.rotation.x = -0.6;
      p.head.rotation.y = 0.3 * wave(T, 1);
    });
  }
  {
    const p = makePerson({ shirt: '#c33f33', pants: '#2f3d5e', skin: SKINS[3], hat: 'boina' });
    p.root.position.set(house.grill.x + 0.48, 0, house.grill.z + 0.12);
    p.root.rotation.y = -Math.PI / 2;
    const tongs = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.16), mat('#777'));
    tongs.position.set(0, -0.2, 0.07);
    p.armR.add(tongs);
    group.add(p.root);
    updates.push((T) => {
      const f = smoothstep(0.6, 1, wave(T, 5));
      p.armR.rotation.x = -1.0 - 0.5 * f;
      p.armR.rotation.z = 0.2 * wave(T, 10);
      p.armL.rotation.x = -0.2;
      p.upper.rotation.x = 0.12;
    });
  }

  // --- Humo de chimenea y parrilla ---
  const smoke = (origin, n, color, opacity, rise, size) => {
    const puffs = buildPuffs(n, color, opacity);
    puffs.forEach((o) => group.add(o));
    updates.push((T) => {
      puffs.forEach((o, i) => {
        const f = (((T * 6 + i / n) % 1) + 1) % 1;
        o.position.set(origin.x + f * 0.45 + Math.sin(f * 6 + i) * 0.05, origin.y + f * rise, origin.z - f * 0.25);
        o.scale.setScalar(lerp(size * 0.3, size, f));
        o.material.opacity = o.userData.base * (1 - f) * smoothstep(0, 0.12, f);
      });
    });
  };
  smoke(house.chimney, 6, '#f4f4f4', 0.75, 1.5, 0.26);
  smoke(house.grill, 5, '#d9d9d9', 0.5, 1.0, 0.18);

  // --- Caballos en el corral ---
  {
    const h1 = buildHorse({ coat: '#7b4a2a', mane: '#241812', points: '#241812' });
    h1.g.position.set(16.7, 0, -1.6);
    h1.g.rotation.y = -0.85;
    const h2 = buildHorse({ coat: '#f3eee6', spots: '#8a4f2a', mane: '#5a3a26', points: '#f3eee6', seed: 7 });
    h2.g.position.set(16.8, 0, 0.2);
    h2.g.rotation.y = 2.3;
    group.add(h1.g, h2.g);
    updates.push((T) => {
      const graze = smoothstep(-0.4, 0.4, wave(T, 2, 0.1));
      h1.neck.rotation.x = lerp(-0.1, 1.85, graze) + wave(T, 12) * 0.05 * graze;
      h1.neck.position.y = 0.62 - 0.07 * graze;
      h1.tail.rotation.z = wave(T, 6) * 0.25;
      h2.neck.rotation.x = 0.15 * wave(T, 3, 0.4);
      h2.neck.rotation.y = 0.25 * wave(T, 1, 0.2);
      h2.tail.rotation.z = wave(T, 8, 0.3) * 0.3;
    });
  }

  // --- Tractor y ciclista por el camino principal ---
  {
    const t = buildTractor();
    group.add(t.g);
    const x0 = -EXT.W / 2 - 1.0, x1 = EXT.W / 2 + 2.6;
    updates.push((T, T2) => {
      // Período doble (60 s): en la primera mitad pasa el tractor, en la segunda el carro alegórico
      t.g.visible = T2 < 0.5;
      if (!t.g.visible) return;
      const x = lerp(x0, x1, T2 * 2);
      t.g.position.set(x, 0, ROAD.z + 0.3);
      t.body.position.y = roadY(x) + Math.abs(wave(T, 90)) * 0.006;
      t.body.rotation.z = Math.atan2(roadY(x + 0.3) - roadY(x - 0.3), 0.6);
      t.wheels.rear.forEach((w) => (w.position.y = 0.25 + roadY(x)));
      t.wheels.front.forEach((w) => (w.position.y = 0.13 + roadY(x + 0.58)));
      t.trailer.position.y = roadY(x - 1.25);
      const dist = x - x0;
      t.wheels.rear.forEach((w) => (w.rotation.z = -dist / 0.25));
      t.wheels.front.forEach((w) => (w.rotation.z = -dist / 0.13));
      t.wheels.trailer.forEach((w) => (w.rotation.z = -dist / 0.15));
    });
  }
  {
    const c = buildCyclist();
    c.g.rotation.y = -Math.PI / 2;
    group.add(c.g);
    const x0 = EXT.W / 2 + 0.6, x1 = -EXT.W / 2 - 0.6;
    updates.push((T) => {
      const f = (T + 0.45) % 1;
      const x = lerp(x0, x1, f);
      c.g.position.set(x, roadY(x), ROAD.z - 0.3);
      const pedal = TAU * T * 45;
      c.wheels.forEach((w) => (w.rotation.x = (x0 - x) / 0.13));
      c.rider.legL.rotation.x = -1.0 + Math.sin(pedal) * 0.45;
      c.rider.legR.rotation.x = -1.0 - Math.sin(pedal) * 0.45;
    });
  }

  // --- Bandada y cóndor ---
  const flock = Array.from({ length: 7 }, (_, i) => ({ ...buildBird(0.36, '#3b3f45'), i }));
  flock.forEach((b) => group.add(b.g));
  const offsets = flock.map((b) => [((b.i % 2 ? 1 : -1) * Math.ceil(b.i / 2)) * 0.45, (b.i % 3) * 0.15, -Math.ceil(b.i / 2) * 0.4]);
  updates.push((T) => {
    const a = TAU * T;
    const cx = Math.cos(a) * 12, cz = 3 + Math.sin(a) * 6.5;
    const yaw = Math.atan2(-Math.sin(a) * 12, Math.cos(a) * 6.5);
    flock.forEach((b, k) => {
      const [ox, oy, oz] = offsets[k];
      const c = Math.cos(yaw), s = Math.sin(yaw);
      b.g.position.set(cx + ox * c + oz * s, 7.2 + oy + 0.25 * wave(T, 3, k * 0.1), cz - ox * s + oz * c);
      b.g.rotation.set(0, yaw, -0.2);
      const flap = Math.sin(TAU * T * 40 + k) * 0.7;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    });
  });

  const condor = buildBird(1.25, '#1f1f22', '#f2f2f2');
  group.add(condor.g);
  const C = CONDOR;
  updates.push((T) => {
    const a = -TAU * T;
    condor.g.position.set(C.x + Math.cos(a) * C.rx, C.y + 0.35 * wave(T, 2), C.z + Math.sin(a) * C.rz);
    condor.g.rotation.set(0, Math.atan2(Math.sin(a) * C.rx, -Math.cos(a) * C.rz), 0.32);
    const flex = 0.12 + 0.06 * wave(T, 4);
    condor.wl.rotation.z = flex;
    condor.wr.rotation.z = -flex;
  });

  // --- Nubes que pasan sobre la montaña (su sombra suave la dibuja el terreno) ---
  const cloudMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.12 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const clouds = [];
  [
    { x: -11.5, y: 8.4, z: -7.2, s: 1.0, ph: 0 },
    { x: 9.5, y: 8.9, z: -8.4, s: 0.8, ph: 0.45 },
  ].forEach((cfg, k) => {
    const geo = mergeColored([[0, 0, 0, 1], [0.95, -0.15, 0.1, 0.72], [-0.95, -0.2, -0.05, 0.66], [0.35, 0.35, -0.2, 0.62], [-0.45, 0.25, 0.25, 0.55]]
      .map(([x, y, z, s]) => colored(cloudGeo, '#ffffff', { pos: [x, y, z], scale: [s, s * 0.72, s * 0.85] })));
    const cloud = new THREE.Mesh(geo, cloudMat);
    cloud.scale.setScalar(cfg.s);
    group.add(cloud);
    clouds.push({ obj: cloud, radius: 2.8 * cfg.s });
    updates.push((T) => {
      cloud.position.set(cfg.x + 1.6 * wave(T, 1, cfg.ph), cfg.y + 0.15 * wave(T, 2, cfg.ph + k * 0.3), cfg.z + 0.4 * wave(T, 1, cfg.ph + 0.25));
    });
  });

  return {
    group,
    clouds,
    update(T, T2) {
      for (const u of updates) u(T, T2);
    },
  };
}

export const CONDOR = { x: -6.5, y: 10.4, z: -8.6, rx: 4.2, rz: 2.6 };

export function disposeActorMaterials() {
  clipCache.forEach((m) => m.dispose());
  clipCache.clear();
}
