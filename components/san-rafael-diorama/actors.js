import * as THREE from 'three';
import { TAU, lerp, smoothstep, wave, pingPong, mat } from './utils.js';
import { W, ROAD, PERGOLA, BODEGA, CORRAL } from './layout.js';
import { roadY } from './buildings.js';

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
  boina: new THREE.CylinderGeometry(0.078, 0.07, 0.032, 12),
  hair: new THREE.IcosahedronGeometry(0.07, 1),
};

const SKINS = ['#f1c7a1', '#e2ad84', '#c98f66', '#a8714d'];

export function makePerson({ shirt, pants = '#2f3d5e', skin = SKINS[1], hat = null, hair = '#3b2a20', m = mat, scale = 1.2 }) {
  const add = (parent, geo, color, pos) => {
    const o = new THREE.Mesh(geo, m(color));
    if (pos) o.position.set(...pos);
    o.castShadow = true;
    parent.add(o);
    return o;
  };
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const hips = new THREE.Group();
  hips.position.y = 0.26;
  root.add(hips);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.x = -0.048;
  legR.position.x = 0.048;
  for (const l of [legL, legR]) {
    add(l, PG.leg, pants);
    add(l, PG.shoe, '#3a2a22');
    hips.add(l);
  }
  const upper = new THREE.Group();
  hips.add(upper);
  add(upper, PG.torso, shirt);
  const head = new THREE.Group();
  head.position.y = 0.3;
  upper.add(head);
  add(head, PG.head, skin);
  if (hat === 'straw') {
    add(head, PG.brim, '#e9d08f', [0, 0.04, 0]);
    add(head, PG.crown, '#e2c47c', [0, 0.07, 0]);
  } else if (hat === 'boina') {
    const b = add(head, PG.boina, '#25262b', [0, 0.05, -0.008]);
    b.rotation.x = -0.25;
  } else {
    const h = add(head, PG.hair, hair, [0, 0.018, -0.012]);
    h.scale.set(1.02, 0.85, 1.02);
  }
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.122, 0.2, 0);
  armR.position.set(0.122, 0.2, 0);
  for (const a of [armL, armR]) {
    add(a, PG.arm, shirt);
    add(a, PG.hand, skin);
    upper.add(a);
  }
  return { root, hips, upper, head, legL, legR, armL, armR };
}

function walkPose(p, cyc, amt = 1) {
  const s = Math.sin(cyc) * amt;
  p.legL.rotation.x = s * 0.6;
  p.legR.rotation.x = -s * 0.6;
  p.armL.rotation.x = -s * 0.5;
  p.armR.rotation.x = s * 0.5;
  p.hips.position.y = 0.26 + Math.abs(Math.cos(cyc)) * 0.018 * amt;
}

function standPose(p) {
  p.legL.rotation.x = p.legR.rotation.x = 0;
  p.hips.position.y = 0.26;
}

/* ------------------------------------------------------------------ */
/* Vehículos con recorte en los bordes: entran y salen por el "corte".  */
/* ------------------------------------------------------------------ */

const CLIP = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), W / 2), new THREE.Plane(new THREE.Vector3(1, 0, 0), W / 2)];
const clipCache = new Map();
const clipMat = (color) => {
  if (!clipCache.has(color)) clipCache.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, clippingPlanes: CLIP }));
  return clipCache.get(color);
};

function part(parent, geo, color, pos, rot, m = clipMat) {
  const o = new THREE.Mesh(geo, m(color));
  o.position.set(...pos);
  if (rot) o.rotation.set(...rot);
  o.castShadow = true;
  parent.add(o);
  return o;
}

function wheel(parent, r, w, pos, hub = '#f2c230') {
  const g = new THREE.Group();
  g.position.set(...pos);
  part(g, new THREE.CylinderGeometry(r, r, w, 14).rotateX(Math.PI / 2), '#2b2b2b', [0, 0, 0]);
  part(g, new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.01, 8).rotateX(Math.PI / 2), hub, [0, 0, 0]);
  part(g, new THREE.BoxGeometry(r * 1.6, r * 0.18, w + 0.02), '#3d3d3d', [0, 0, 0]);
  parent.add(g);
  return g;
}

function buildTractor() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const B = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  part(body, B(0.62, 0.2, 0.26), '#d13a2c', [0.38, 0.33, 0]);
  part(body, B(0.66, 0.05, 0.28), '#b32c21', [0.38, 0.44, 0]);
  part(body, B(0.06, 0.16, 0.24), '#3a3a3a', [0.7, 0.32, 0]);
  part(body, B(0.3, 0.1, 0.5), '#d13a2c', [0.0, 0.44, 0]);
  part(body, B(0.14, 0.04, 0.2), '#2b2b2b', [-0.02, 0.5, 0]);
  part(body, new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), '#444', [0.55, 0.6, 0.08]);
  for (const z of [-0.2, 0.2]) part(body, B(0.03, 0.55, 0.03), '#2f2f2f', [-0.12, 0.72, z]);
  part(body, B(0.36, 0.04, 0.5), '#f1efe8', [-0.05, 1.0, 0]);
  const rear = [wheel(g, 0.25, 0.13, [0, 0.25, 0.27]), wheel(g, 0.25, 0.13, [0, 0.25, -0.27])];
  const front = [wheel(g, 0.13, 0.08, [0.58, 0.13, 0.2]), wheel(g, 0.13, 0.08, [0.58, 0.13, -0.2])];
  const driver = makePerson({ shirt: '#3d7dd8', hat: 'straw', skin: SKINS[2], m: clipMat });
  driver.root.position.set(-0.04, 0.21, 0);
  driver.root.rotation.y = Math.PI / 2;
  driver.legL.rotation.x = driver.legR.rotation.x = -1.3;
  driver.armL.rotation.x = driver.armR.rotation.x = -0.9;
  body.add(driver.root);

  // Acoplado con bins de uva
  const trailer = new THREE.Group();
  g.add(trailer);
  part(trailer, B(0.5, 0.03, 0.03), '#333', [-0.45, 0.22, 0]);
  part(trailer, B(1.15, 0.06, 0.6), '#8b6744', [-1.25, 0.3, 0]);
  for (const z of [-0.29, 0.29]) part(trailer, B(1.15, 0.12, 0.03), '#7a5a3c', [-1.25, 0.39, z]);
  const tw = [wheel(trailer, 0.15, 0.08, [-1.25, 0.15, 0.31], '#9a9a9a'), wheel(trailer, 0.15, 0.08, [-1.25, 0.15, -0.31], '#9a9a9a')];
  for (const bx of [-0.9, -1.25, -1.6]) {
    for (const bz of [-0.14, 0.14]) {
      part(trailer, B(0.3, 0.16, 0.24), '#3f8f4a', [bx, 0.41, bz]);
      part(trailer, new THREE.IcosahedronGeometry(0.11, 0), '#5b2a62', [bx, 0.5, bz], [0.4, bx, 0]).scale.set(1.2, 0.5, 1);
    }
  }
  return { g, body, trailer, wheels: { rear, front, trailer: tw } };
}

function buildCyclist() {
  const g = new THREE.Group();
  const frame = '#1f8a7a';
  const wheels = [];
  for (const z of [-0.21, 0.21]) {
    const w = new THREE.Group();
    w.position.set(0, 0.14, z);
    part(w, new THREE.TorusGeometry(0.13, 0.014, 6, 18).rotateY(Math.PI / 2), '#222', [0, 0, 0]);
    part(w, new THREE.BoxGeometry(0.01, 0.24, 0.01), '#bbb', [0, 0, 0]);
    part(w, new THREE.BoxGeometry(0.01, 0.01, 0.24), '#bbb', [0, 0, 0]);
    g.add(w);
    wheels.push(w);
  }
  part(g, new THREE.BoxGeometry(0.022, 0.022, 0.42), frame, [0, 0.27, 0]);
  part(g, new THREE.BoxGeometry(0.022, 0.2, 0.022), frame, [0, 0.22, -0.06], [0.25, 0, 0]);
  part(g, new THREE.BoxGeometry(0.022, 0.2, 0.022), frame, [0, 0.24, 0.18], [-0.2, 0, 0]);
  part(g, new THREE.BoxGeometry(0.16, 0.02, 0.02), '#222', [0, 0.36, 0.19]);
  part(g, new THREE.BoxGeometry(0.06, 0.02, 0.1), '#222', [0, 0.34, -0.08]);
  part(g, new THREE.BoxGeometry(0.12, 0.06, 0.09), '#c9a35c', [0, 0.32, 0.27]);
  const rider = makePerson({ shirt: '#f6c445', pants: '#3a3a3a', skin: SKINS[0], hair: '#5a3b22', m: clipMat });
  rider.root.position.set(0, 0.04, -0.08);
  rider.upper.rotation.x = 0.4;
  rider.armL.rotation.x = rider.armR.rotation.x = -1.05;
  g.add(rider.root);
  return { g, wheels, rider };
}

/* ------------------------------------------------------------------ */
/* Animales                                                            */
/* ------------------------------------------------------------------ */

function buildHorse(color, mane = '#2a211c') {
  const g = new THREE.Group();
  const m = (c) => mat(c);
  const B = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  part(g, B(0.17, 0.19, 0.5), color, [0, 0.42, 0], null, m);
  const legs = [];
  for (const [x, z] of [[-0.055, 0.19], [0.055, 0.19], [-0.055, -0.19], [0.055, -0.19]]) {
    const l = new THREE.Group();
    l.position.set(x, 0.34, z);
    part(l, B(0.05, 0.34, 0.05).translate(0, -0.17, 0), color, [0, 0, 0], null, m);
    part(l, B(0.055, 0.04, 0.06), '#2a211c', [0, -0.32, 0], null, m);
    g.add(l);
    legs.push(l);
  }
  const neck = new THREE.Group();
  neck.position.set(0, 0.47, 0.22);
  part(neck, B(0.1, 0.26, 0.12).translate(0, 0.11, 0.04), color, [0, 0, 0], [0.55, 0, 0], m);
  part(neck, B(0.03, 0.22, 0.08).translate(0, 0.11, -0.02), mane, [0, 0.02, 0], [0.55, 0, 0], m);
  const head = part(neck, B(0.09, 0.09, 0.2), color, [0, 0.22, 0.2], [0.35, 0, 0], m);
  part(head, B(0.03, 0.05, 0.03), color, [0.03, 0.06, -0.06], null, m);
  part(head, B(0.03, 0.05, 0.03), color, [-0.03, 0.06, -0.06], null, m);
  g.add(neck);
  const tail = new THREE.Group();
  tail.position.set(0, 0.48, -0.25);
  part(tail, B(0.04, 0.26, 0.04).translate(0, -0.13, 0), mane, [0, 0, 0], [-0.3, 0, 0], m);
  g.add(tail);
  g.scale.setScalar(1.45);
  return { g, neck, tail, legs };
}

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
  return { g, wl: wing(1), wr: wing(-1) };
}

function buildPuffs(n, color, opacity) {
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
    const h1 = buildHorse('#7b4a2a');
    h1.g.position.set(16.7, 0, -1.6);
    h1.g.rotation.y = -0.85;
    const h2 = buildHorse('#e3d9cc', '#9a8f84');
    h2.g.position.set(16.8, 0, 0.2);
    h2.g.rotation.y = 2.3;
    group.add(h1.g, h2.g);
    updates.push((T) => {
      const graze = smoothstep(-0.4, 0.4, wave(T, 2, 0.1));
      h1.neck.rotation.x = lerp(-0.1, 1.25, graze) + wave(T, 12) * 0.05 * graze;
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
    const x0 = -W / 2 - 1.0, x1 = W / 2 + 2.6;
    updates.push((T) => {
      const x = lerp(x0, x1, T);
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
    const x0 = W / 2 + 0.6, x1 = -W / 2 - 0.6;
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

  // --- Nubes que pasan sobre la montaña (y proyectan sombra) ---
  const cloudMat = mat('#ffffff', { roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.12 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  [
    { x: -11.5, y: 8.4, z: -7.2, s: 1.0, ph: 0 },
    { x: 9.5, y: 8.9, z: -8.4, s: 0.8, ph: 0.45 },
  ].forEach((cfg, k) => {
    const cloud = new THREE.Group();
    [[0, 0, 0, 1], [0.95, -0.15, 0.1, 0.72], [-0.95, -0.2, -0.05, 0.66], [0.35, 0.35, -0.2, 0.62], [-0.45, 0.25, 0.25, 0.55]].forEach(([x, y, z, s]) => {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(x, y, z);
      puff.scale.set(s, s * 0.72, s * 0.85);
      puff.castShadow = true;
      cloud.add(puff);
    });
    cloud.scale.setScalar(cfg.s);
    group.add(cloud);
    updates.push((T) => {
      cloud.position.set(cfg.x + 1.6 * wave(T, 1, cfg.ph), cfg.y + 0.15 * wave(T, 2, cfg.ph + k * 0.3), cfg.z + 0.4 * wave(T, 1, cfg.ph + 0.25));
    });
  });

  return {
    group,
    update(T) {
      for (const u of updates) u(T);
    },
  };
}

export const CONDOR = { x: -6.5, y: 10.4, z: -8.6, rx: 4.2, rz: 2.6 };

export function disposeActorMaterials() {
  clipCache.forEach((m) => m.dispose());
  clipCache.clear();
}
