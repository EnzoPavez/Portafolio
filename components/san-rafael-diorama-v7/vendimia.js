import * as THREE from 'three';
import { GEO, TAU, lerp, wave, colored, mergeColored, vcMesh } from './utils.js';
import { EXT, ROAD, BODEGA, PERGOLA } from './layout.js';
import { makePerson, SKINS, VC_CLIP, wheel } from './actors.js';
import { roadY } from './buildings.js';

/* Fiesta de la Vendimia: un carro alegórico con la reina y sus virreinas pasa
   por el camino (en los loops pares, alternando con el tractor) y la entrada
   de la bodega se viste con banderines y un pasacalle. */

const B = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
const FLOWERS = ['#ffffff', '#f7a8c8', '#f6c445', '#e94f37', '#b48be0'];
const FLAGS = ['#6a2c70', '#f2c230', '#3fa34d', '#ffffff', '#c8102e', '#7cc6ec'];

/* ---------------------------- Carro alegórico ---------------------------- */
function buildFloat() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const parts = [
    // Camioncito que lo tira
    colored(B(0.78, 0.12, 0.5), '#2b2b2b', { pos: [0.98, 0.2, 0] }),
    colored(B(0.32, 0.2, 0.46), '#2e7d4f', { pos: [1.22, 0.36, 0] }),
    colored(B(0.3, 0.34, 0.5), '#2e7d4f', { pos: [0.9, 0.43, 0] }),
    colored(B(0.02, 0.16, 0.42), '#2c3e50', { pos: [1.06, 0.5, 0] }),
    colored(B(0.34, 0.03, 0.52), '#256b43', { pos: [0.9, 0.615, 0] }),
    colored(B(0.02, 0.14, 0.3), '#d9d9d9', { pos: [1.385, 0.34, 0] }),
    colored(B(0.25, 0.03, 0.03), '#333', { pos: [0.67, 0.22, 0] }),
    // Plataforma con pollera violeta y ribetes dorados
    colored(B(1.92, 0.22, 0.66), '#5e2a73', { pos: [-0.35, 0.21, 0] }),
    colored(B(1.9, 0.06, 0.64), '#6a2c70', { pos: [-0.35, 0.35, 0] }),
    colored(B(1.96, 0.025, 0.7), '#f2c230', { pos: [-0.35, 0.385, 0] }),
    colored(B(1.96, 0.025, 0.7), '#f2c230', { pos: [-0.35, 0.11, 0] }),
    // Barrica gigante al frente
    colored(GEO.cylC, '#8b5a2b', { pos: [0.3, 0.58, 0], rot: [Math.PI / 2, 0, 0], scale: [0.19, 0.48, 0.19] }),
    ...[-0.17, 0.17].map((z) => colored(GEO.cylC, '#4a3b30', { pos: [0.3, 0.58, z], rot: [Math.PI / 2, 0, 0], scale: [0.195, 0.035, 0.195] })),
    colored(GEO.cylC, '#7a1f33', { pos: [0.3, 0.58, 0.245], rot: [Math.PI / 2, 0, 0], scale: [0.12, 0.012, 0.12] }),
    // Pedestal y arco de flores para la reina
    colored(GEO.cyl, '#f2c230', { pos: [-0.35, 0.385, 0], scale: [0.15, 0.12, 0.15] }),
    colored(new THREE.TorusGeometry(0.33, 0.022, 6, 18, Math.PI).rotateY(Math.PI / 2), '#3fa34d', { pos: [-0.35, 0.4, 0] }),
  ];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    parts.push(colored(GEO.ico, FLOWERS[i % FLOWERS.length], { pos: [-0.35, 0.4 + Math.sin(a) * 0.33, Math.cos(a) * 0.33], scale: 0.04 }));
  }
  for (let i = 0; i < 14; i++) {
    for (const s of [-1, 1]) parts.push(colored(GEO.ico, FLOWERS[(i + (s > 0 ? 2 : 0)) % FLOWERS.length], { pos: [-1.25 + i * 0.14, 0.24, s * 0.34], scale: 0.035 }));
  }
  body.add(vcMesh(mergeColored(parts), VC_CLIP));

  // Racimo gigante que gira sobre la plataforma
  const grapes = new THREE.Group();
  grapes.position.set(-1.0, 0.38, 0);
  const gp = [];
  const layers = [[6, 0.17, 0.78], [5, 0.14, 0.66], [4, 0.11, 0.54], [3, 0.08, 0.43], [1, 0, 0.33]];
  layers.forEach(([n, rad, y], l) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + l * 0.5;
      gp.push(colored(GEO.ico1, ['#5b2a62', '#6a3270', '#4b2353'][(i + l) % 3], { pos: [Math.cos(a) * rad, y, Math.sin(a) * rad], scale: 0.075 }));
    }
  });
  gp.push(colored(GEO.cyl6, '#6b4a2f', { pos: [0, 0.84, 0], scale: [0.018, 0.12, 0.018] }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    gp.push(colored(GEO.ico, '#4f8f3a', { pos: [Math.cos(a) * 0.09, 0.9, Math.sin(a) * 0.09], rot: [0.3, a, 0], scale: [0.11, 0.03, 0.08] }));
  }
  grapes.add(vcMesh(mergeColored(gp), VC_CLIP));
  body.add(grapes);

  const wheels = [
    wheel(g, 0.11, 0.07, [1.16, 0.11, 0.24], '#d9d9d9'), wheel(g, 0.11, 0.07, [1.16, 0.11, -0.24], '#d9d9d9'),
    wheel(g, 0.11, 0.07, [0.8, 0.11, 0.24], '#d9d9d9'), wheel(g, 0.11, 0.07, [0.8, 0.11, -0.24], '#d9d9d9'),
  ];

  // Reina de la Vendimia (corona y vestido blanco) y dos virreinas, saludando
  const queen = makePerson({ shirt: '#f7f1f8', pants: '#f2c230', dress: '#f7f1f8', skin: SKINS[1], hair: '#3b2a20', hat: 'crown', scale: 1.0 });
  queen.root.position.set(-0.35, 0.505, 0);
  queen.root.rotation.y = 0.35;
  body.add(queen.root);
  const court = [['#f7a8c8', 0.2], ['#b48be0', -0.2]].map(([c, z], i) => {
    const p = makePerson({ shirt: c, pants: '#f2c230', dress: c, skin: SKINS[i * 2], hair: i ? '#7a4a22' : '#1d1d1d', bun: true, scale: 0.92 });
    p.root.position.set(-0.72, 0.385, z);
    p.root.rotation.y = 0.35 + (i ? -0.3 : 0.3);
    body.add(p.root);
    return p;
  });
  return { g, body, grapes, wheels, queen, court };
}

/* --------------------- Banderines y pasacalle ----------------------- */
function bannerTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#5e2a73';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#f2c230';
  g.lineWidth = 7;
  g.strokeRect(9, 9, 494, 110);
  g.fillStyle = '#f6c445';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 74px "Arial Black", "Segoe UI Black", Arial, sans-serif';
  g.fillText('VENDIMIA', 256, 68);
  g.fillStyle = '#b06ac0';
  for (const cx of [46, 466]) {
    for (const [dx, dy] of [[-10, -16], [10, -16], [0, -2], [-10, 12], [10, 12], [0, 26]]) {
      g.beginPath();
      g.arc(cx + dx * 0.9, 58 + dy * 0.9, 8, 0, TAU);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Guirnalda de banderines triangulares entre dos puntos (con caída de catenaria).
function flagString(A, Bp, sag, pos, col, nor, k0) {
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...Bp);
  const len = a.distanceTo(b);
  const n = Math.max(2, Math.round(len / 0.15));
  const p = new THREE.Vector3(), q = new THREE.Vector3(), tip = new THREE.Vector3(), nrm = new THREE.Vector3();
  const dir = b.clone().sub(a).normalize();
  const c = new THREE.Color();
  const at = (t, out) => out.lerpVectors(a, b, t).setY(lerp(a.y, b.y, t) - sag * 4 * t * (1 - t));
  for (let i = 0; i < n; i++) {
    at(i / n + 0.12 / n, p);
    at((i + 0.78) / n, q);
    tip.addVectors(p, q).multiplyScalar(0.5);
    tip.y -= 0.13;
    nrm.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    c.set(FLAGS[(i + k0) % FLAGS.length]);
    for (const v of [p, q, tip]) {
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
      nor.push(nrm.x, nrm.y, nrm.z);
    }
  }
  return new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => at(i / 12, new THREE.Vector3())));
}

function buildBunting(batch) {
  const front = BODEGA.z + BODEGA.d / 2;
  // Las guirnaldas salen de las esquinas del frontón (no del centro): así no cruzan
  // por delante del cartel "BODEGA" vistas desde la cámara
  const cornerL = [BODEGA.x - 0.95, BODEGA.h + 0.9, front + 0.26], cornerR = [BODEGA.x + 0.95, BODEGA.h + 0.9, front + 0.26];
  const poleL = [BODEGA.x - 0.85, 1.85, 2.05], poleR = [BODEGA.x + 0.85, 1.85, 2.05];
  for (const p of [poleL, poleR]) {
    batch.add(GEO.cyl6, '#6b4a2f', { pos: [p[0], 0, p[2]], scale: [0.035, 1.92, 0.035], ao: [0, 0.2, 0.6] });
    batch.add(GEO.cone, '#f2c230', { pos: [p[0], 1.92, p[2]], scale: [0.05, 0.08, 0.05] });
  }
  const towerTop = [BODEGA.x - BODEGA.w / 2 + 1.05, 2.4, BODEGA.z + 0.15];
  const strings = [
    [cornerL, poleL, 0.18], [cornerR, poleR, 0.18], [[poleL[0], 1.72, poleL[2]], [poleR[0], 1.72, poleR[2]], 0.08],
    [towerTop, cornerL, 0.12], [poleR, [PERGOLA.x - 1.05, 1.12, PERGOLA.z - 0.75], 0.22],
  ];
  const pos = [], col = [], nor = [];
  const wires = [];
  strings.forEach(([A, Bp, sag], k) => {
    const curve = flagString(A, Bp, sag, pos, col, nor, k * 2);
    wires.push(colored(new THREE.TubeGeometry(curve, 16, 0.006, 3, false), '#3a3a3a'));
  });
  const flags = new THREE.BufferGeometry();
  flags.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  flags.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  flags.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  wires.forEach((w) => batch.addColored(w));
  const mesh = new THREE.Mesh(flags, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }));
  mesh.castShadow = true;

  const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.8, side: THREE.DoubleSide }));
  banner.position.set(BODEGA.x, 1.42, 2.06);
  banner.castShadow = true;
  return [mesh, banner];
}

export function buildVendimia(batch) {
  const group = new THREE.Group();
  group.add(...buildBunting(batch));
  const f = buildFloat();
  group.add(f.g);
  const x0 = -EXT.W / 2 - 1.5, x1 = EXT.W / 2 + 1.4;
  return {
    group,
    update(T, T2) {
      // Pasa en la segunda mitad del período doble (el tractor pasa en la primera)
      f.g.visible = T2 >= 0.5;
      if (!f.g.visible) return;
      const x = lerp(x0, x1, (T2 - 0.5) * 2);
      f.g.position.set(x, 0, ROAD.z + 0.3);
      f.body.position.y = roadY(x) + Math.abs(wave(T, 80)) * 0.005;
      f.body.rotation.z = Math.atan2(roadY(x + 0.5) - roadY(x - 0.5), 1.0);
      f.wheels.forEach((w, i) => {
        w.position.y = 0.11 + roadY(x + (i < 2 ? 1.16 : 0.8));
        w.rotation.z = -(x - x0) / 0.11;
      });
      f.grapes.rotation.y = TAU * T * 2;
      // La reina saluda con la mano en alto; las virreinas, alternadas
      f.queen.armR.rotation.set(-2.7, 0, 0.35 + 0.3 * wave(T, 12));
      f.queen.armL.rotation.set(-0.25, 0, -0.1);
      f.queen.head.rotation.y = 0.25 * wave(T, 2);
      f.court.forEach((p, i) => {
        p.armR.rotation.set(-2.5, 0, 0.3 + 0.35 * wave(T, 14, i * 0.5));
        p.armL.rotation.set(-0.3, 0, -0.1);
        p.upper.rotation.z = 0.05 * wave(T, 4, i * 0.3);
      });
    },
  };
}
