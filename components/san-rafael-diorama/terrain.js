import * as THREE from 'three';
import { rng, fbm, lerp, smoothstep, GEO } from './utils.js';
import {
  W, D, BASE, RIVER_SAMPLES, riverWidth, riverXAt, mountainHeight, distToRiver, MOUNTAIN_Z1,
  ROAD, LANE, ACEQUIA_Z, PARCELS, parcelRows, BODEGA, HOUSE, CORRAL, PERGOLA,
} from './layout.js';

/* ------------------------------------------------------------------ */
/* Textura del suelo: pasto, parcelas, caminos, río y AO "pintado".     */
/* ------------------------------------------------------------------ */

export function buildGroundTexture(aoSpots, maxAniso = 8) {
  const S = 2048 / W;
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = Math.round(D * S);
  const g = cv.getContext('2d');
  const X = (x) => (x + W / 2) * S;
  const Y = (z) => (z + D / 2) * S;
  const r = rng(7);

  // Pasto base con franjas de cortadora
  g.fillStyle = '#8fbb5d';
  g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0, x = -W / 2; x < W / 2; x += 1.15, i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,230,0.06)' : 'rgba(20,60,10,0.045)';
    g.fillRect(X(x), 0, 1.15 * S, cv.height);
  }
  // Pie de montaña más oscuro
  const mg = g.createLinearGradient(0, Y(-6.5), 0, Y(-3.2));
  mg.addColorStop(0, '#6f9c49');
  mg.addColorStop(1, 'rgba(111,156,73,0)');
  g.fillStyle = mg;
  g.fillRect(0, 0, cv.width, Y(-3.2));

  speckle(g, r, 0, 0, cv.width, cv.height, 14000, ['rgba(40,80,20,0.12)', 'rgba(255,255,210,0.10)']);

  const rrect = (x0, z0, x1, z1, rad, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(X(x0), Y(z0), (x1 - x0) * S, (z1 - z0) * S, rad * S);
    g.fill();
  };

  // Parcelas de viñedo: tierra + franja de cobertura bajo cada hilera
  for (const p of PARCELS) {
    rrect(p.x0 - 0.25, p.z0 - 0.25, p.x1 + 0.25, p.z1 + 0.25, 0.35, '#cfb189');
    speckle(g, r, X(p.x0), Y(p.z0), (p.x1 - p.x0) * S, (p.z1 - p.z0) * S, 2200, ['rgba(120,80,40,0.16)', 'rgba(255,240,210,0.18)']);
    g.lineCap = 'round';
    for (const row of parcelRows(p)) {
      line(g, X(row.a[0]), Y(row.a[1]), X(row.b[0]), Y(row.b[1]), 0.46 * S, 'rgba(120,138,70,0.75)');
      line(g, X(row.a[0]), Y(row.a[1]), X(row.b[0]), Y(row.b[1]), 0.24 * S, 'rgba(60,45,25,0.28)');
    }
  }

  // Corral de tierra
  rrect(CORRAL.x0, CORRAL.z0, CORRAL.x1, CORRAL.z1, 0.3, '#c8a476');
  speckle(g, r, X(CORRAL.x0), Y(CORRAL.z0), (CORRAL.x1 - CORRAL.x0) * S, (CORRAL.z1 - CORRAL.z0) * S, 500, ['rgba(110,70,30,0.2)']);

  // Patio de la bodega (ripio) y terraza de la pérgola
  rrect(BODEGA.x - BODEGA.w / 2 - 0.6, BODEGA.z - BODEGA.d / 2 - 0.5, 4.6, BODEGA.z + BODEGA.d / 2 + 0.75, 0.5, '#e4d8bf');
  speckle(g, r, X(-4.6), Y(-3.1), 9 * S, 3.5 * S, 1600, ['rgba(140,120,90,0.25)', 'rgba(255,255,255,0.3)']);
  rrect(PERGOLA.x - 1.1, PERGOLA.z - 0.8, PERGOLA.x + 1.1, PERGOLA.z + 0.8, 0.12, '#d7b48a');
  g.strokeStyle = 'rgba(120,80,50,0.25)';
  g.lineWidth = 1.5;
  for (let x = PERGOLA.x - 1.1; x <= PERGOLA.x + 1.1; x += 0.27) line(g, X(x), Y(PERGOLA.z - 0.8), X(x), Y(PERGOLA.z + 0.8), 1.2, 'rgba(120,80,50,0.22)');

  // Patio de la casa
  rrect(HOUSE.x - HOUSE.w / 2 - 0.5, HOUSE.z - HOUSE.d / 2 - 0.4, HOUSE.x + HOUSE.w / 2 + 0.5, HOUSE.z + HOUSE.d / 2 + 1.3, 0.5, '#dcc8a0');

  // Caminos de tierra con huellas
  const dirt = '#e0c99e';
  g.fillStyle = dirt;
  g.fillRect(0, Y(ROAD.z - ROAD.half), cv.width, ROAD.half * 2 * S);
  rrect(LANE.x - LANE.half, ROAD.z, LANE.x + LANE.half, D / 2 + 0.1, 0.1, dirt);
  rrect(BODEGA.x - 0.7, BODEGA.z + BODEGA.d / 2 - 0.1, BODEGA.x + 0.7, ROAD.z, 0.1, '#e8dcc4');
  rrect(HOUSE.x - 0.45, HOUSE.z + HOUSE.d / 2, HOUSE.x + 0.45, ROAD.z, 0.1, dirt);
  speckle(g, r, 0, Y(ROAD.z - ROAD.half), cv.width, ROAD.half * 2 * S, 3000, ['rgba(130,95,55,0.18)', 'rgba(255,250,235,0.25)']);
  for (const dz of [-0.33, 0.33]) line(g, 0, Y(ROAD.z + dz), cv.width, Y(ROAD.z + dz), 0.17 * S, 'rgba(150,112,68,0.22)');
  for (const dx of [-0.22, 0.22]) line(g, X(LANE.x + dx), Y(ROAD.z + ROAD.half), X(LANE.x + dx), cv.height, 0.13 * S, 'rgba(150,112,68,0.2)');
  for (const e of [-ROAD.half, ROAD.half]) line(g, 0, Y(ROAD.z + e), cv.width, Y(ROAD.z + e), 0.07 * S, 'rgba(90,110,50,0.35)');

  // Acequia: canal de hormigón junto al camino
  const ax1 = riverXAt(ACEQUIA_Z) - 0.4;
  line(g, 0, Y(ACEQUIA_Z), X(ax1), Y(ACEQUIA_Z), 0.5 * S, '#bdb6a6');

  // Río: playa de canto rodado + borde húmedo
  const pts = RIVER_SAMPLES;
  const strokeRiver = (extra, color) => {
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < pts.length - 1; i++) {
      g.lineWidth = (riverWidth(pts[i].z) + extra) * S;
      g.beginPath();
      g.moveTo(X(pts[i].x), Y(pts[i].z));
      g.lineTo(X(pts[i + 1].x), Y(pts[i + 1].z));
      g.stroke();
    }
  };
  strokeRiver(1.5, '#dccdab');
  strokeRiver(0.5, '#a89874');
  for (let i = 0; i < 900; i++) {
    const p = pts[Math.floor(r() * pts.length)];
    const a = r() * Math.PI * 2, d = (riverWidth(p.z) / 2 + 0.15 + r() * 0.55) * S;
    g.fillStyle = r() < 0.5 ? 'rgba(150,140,125,0.55)' : 'rgba(240,235,225,0.6)';
    g.beginPath();
    g.ellipse(X(p.x) + Math.cos(a) * d, Y(p.z) + Math.sin(a) * d, 1.5 + r() * 3, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // AO de contacto bajo árboles, postes y edificios
  for (const s of aoSpots) {
    if (s.type === 'rect') {
      g.save();
      g.translate(X(s.x), Y(s.z));
      g.rotate(-(s.rot || 0));
      g.shadowColor = `rgba(30,35,15,${s.a})`;
      g.shadowBlur = s.blur * S;
      g.fillStyle = `rgba(30,35,15,${s.a})`;
      g.fillRect((-s.w / 2) * S, (-s.d / 2) * S, s.w * S, s.d * S);
      g.restore();
    } else {
      const gr = g.createRadialGradient(X(s.x), Y(s.z), 0, X(s.x), Y(s.z), s.r * S);
      gr.addColorStop(0, `rgba(25,40,10,${s.a})`);
      gr.addColorStop(1, 'rgba(25,40,10,0)');
      g.fillStyle = gr;
      g.fillRect(X(s.x - s.r), Y(s.z - s.r), s.r * 2 * S, s.r * 2 * S);
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function speckle(g, r, x, y, w, h, n, colors) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    const s = 1 + r() * 2.5;
    g.fillRect(x + r() * w, y + r() * h, s, s);
  }
}

function line(g, x0, y0, x1, y1, width, color) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

export function buildGround(texture) {
  const geo = new THREE.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */
/* Montañas low-poly con color por cara.                               */
/* ------------------------------------------------------------------ */

const SEG_X = 60;
const SEG_Z = 18;
const MZ0 = -D / 2;
const mgx = (i) => -W / 2 + (i / SEG_X) * W;
const mgz = (j) => MZ0 + (j / SEG_Z) * (MOUNTAIN_Z1 - MZ0);

function mountainColor(h, ny, r, x, z, dr) {
  const snowLine = 5.9 + (fbm(x * 0.4, z * 0.4) - 0.5) * 1.2;
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  if (h > snowLine) return ny > 0.45 ? pick(['#f4f7f9', '#eef2f6', '#ffffff']) : pick(['#dfe5ea', '#cfd6dd']);
  // Paredes rojizas del cañón del Atuel, sólo junto al río
  if (dr < 3.3 && ny < 0.8 && h < 4.2) return pick(['#c0643f', '#cf7a4c', '#b0583b', '#d18a5c']);
  if (h > snowLine - 0.9) return pick(['#8f9a80', '#a2aa92', '#87927a']);
  if (ny < 0.52) return pick(['#7f8d66', '#8c9670', '#738460']);
  if (h < 1.3) return pick(['#86b955', '#7cb050', '#91c25e']);
  if (h < 3.0) return pick(['#6aa64a', '#74ae4e', '#5f9c44', '#7db554']);
  return pick(['#5a9445', '#62994a', '#4f8a40', '#6c9c52']);
}

export function buildMountainGeometry() {
  const r = rng(21);
  const Hg = [];
  for (let j = 0; j <= SEG_Z; j++) {
    Hg[j] = [];
    for (let i = 0; i <= SEG_X; i++) Hg[j][i] = mountainHeight(mgx(i), mgz(j));
  }
  const pos = [], col = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), t = new THREE.Vector3(), color = new THREE.Color();
  const tri = (p0, p1, p2) => {
    if (p0[1] < -0.05 && p1[1] < -0.05 && p2[1] < -0.05) return;
    a.fromArray(p0); b.fromArray(p1); c.fromArray(p2);
    n.subVectors(c, b).cross(t.subVectors(a, b)).normalize();
    const h = (p0[1] + p1[1] + p2[1]) / 3;
    const cx = (p0[0] + p1[0] + p2[0]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
    color.set(mountainColor(h, n.y, r, cx, cz, distToRiver(cx, cz)));
    pos.push(...p0, ...p1, ...p2);
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
  };
  for (let j = 0; j < SEG_Z; j++) {
    for (let i = 0; i < SEG_X; i++) {
      const v00 = [mgx(i), Hg[j][i], mgz(j)];
      const v10 = [mgx(i + 1), Hg[j][i + 1], mgz(j)];
      const v01 = [mgx(i), Hg[j + 1][i], mgz(j + 1)];
      const v11 = [mgx(i + 1), Hg[j + 1][i + 1], mgz(j + 1)];
      if ((i + j) % 2) {
        tri(v00, v01, v11);
        tri(v00, v11, v10);
      } else {
        tri(v00, v01, v10);
        tri(v10, v01, v11);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Laterales de tierra con estratos (corte del diorama).               */
/* ------------------------------------------------------------------ */

const STRATA = [
  [-BASE, '#674430'], [-1.45, '#8f6143'], [-0.95, '#7a5238'], [-0.5, '#5f4231'],
  [0, '#9a7b62'], [0.9, '#b38c6c'], [1.9, '#8e7461'], [3.0, '#a7866a'], [4.3, '#937a66'],
  [5.6, '#ad927a'], [7.0, '#9b8a7c'], [8.6, '#b3a598'], [14, null],
];

function edgeSamples(edge) {
  // Muestras alineadas con la grilla de montaña para que el corte calce exacto.
  const out = [];
  if (edge === 'front' || edge === 'back') {
    for (let i = 0; i <= SEG_X; i++) out.push(mgx(i));
  } else {
    const dz = (MOUNTAIN_Z1 - MZ0) / SEG_Z;
    for (let z = MZ0; z < D / 2 - 1e-6; z += dz) out.push(z);
    out.push(D / 2);
  }
  return out;
}

export function buildSkirtGeometry() {
  const pos = [], col = [], nor = [];
  const color = new THREE.Color();
  const edges = [
    { name: 'front', p: (s) => [s, D / 2], n: [0, 0, 1] },
    { name: 'right', p: (s) => [W / 2, s], n: [1, 0, 0] },
    { name: 'back', p: (s) => [s, -D / 2], n: [0, 0, -1] },
    { name: 'left', p: (s) => [-W / 2, s], n: [-1, 0, 0] },
  ];
  const quad = (A, B, C, Dv, hex, n) => {
    color.set(hex);
    for (const v of [A, B, C, A, C, Dv]) {
      pos.push(...v);
      col.push(color.r, color.g, color.b);
      nor.push(...n);
    }
  };
  for (const e of edges) {
    const ss = edgeSamples(e.name);
    const top = ss.map((s) => {
      const [x, z] = e.p(s);
      return z <= MOUNTAIN_Z1 + 1e-6 ? Math.max(0, mountainHeight(x, z)) : 0;
    });
    const flip = e.name === 'front' || e.name === 'left'; // orientación de las caras
    const off = (v, k) => [v[0] + e.n[0] * k, v[1], v[2] + e.n[2] * k];
    for (let i = 0; i < ss.length - 1; i++) {
      const [xa, za] = e.p(ss[i]);
      const [xb, zb] = e.p(ss[i + 1]);
      for (let k = 0; k < STRATA.length - 1; k++) {
        const wav = (s) => (k === 0 ? 0 : 0.07 * Math.sin(s * 0.9 + k * 1.7) + 0.05 * Math.sin(s * 2.3 + k));
        const lo = (s, t) => Math.min(STRATA[k][0] + wav(s), t);
        const hi = (s, t) => Math.min(STRATA[k + 1][0] + (k + 1 === STRATA.length - 1 ? 0 : 0.07 * Math.sin(s * 0.9 + (k + 1) * 1.7) + 0.05 * Math.sin(s * 2.3 + k + 1)), t);
        const la = lo(ss[i], top[i]), ha = hi(ss[i], top[i]);
        const lb = lo(ss[i + 1], top[i + 1]), hb = hi(ss[i + 1], top[i + 1]);
        if (ha - la < 1e-4 && hb - lb < 1e-4) continue;
        const A = [xa, la, za], B = [xb, lb, zb], C = [xb, hb, zb], Dv = [xa, ha, za];
        flip ? quad(A, B, C, Dv, STRATA[k][1], e.n) : quad(B, A, Dv, C, STRATA[k][1], e.n);
      }
      // Labio superior (pasto o superficie de montaña), apenas hacia afuera
      const lipColor = (t) => (t > 5.9 ? '#eef2f5' : t > 0.05 ? '#5f9144' : '#77a74c');
      const A = off([xa, top[i] - 0.17, za], 0.012), B = off([xb, top[i + 1] - 0.17, zb], 0.012);
      const C = off([xb, top[i + 1] + 0.005, zb], 0.012), Dv = off([xa, top[i] + 0.005, za], 0.012);
      const lc = lipColor((top[i] + top[i + 1]) / 2);
      flip ? quad(A, B, C, Dv, lc, e.n) : quad(B, A, Dv, C, lc, e.n);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

// Piedras incrustadas en los laterales visibles.
export function addSkirtRocks(batch) {
  const r = rng(5);
  for (let i = 0; i < 34; i++) {
    const front = i % 2 === 0;
    const s = front ? lerp(-W / 2 + 0.6, W / 2 - 0.6, r()) : lerp(-1, D / 2 - 0.6, r());
    const y = lerp(-BASE + 0.3, -0.45, r());
    const sc = 0.08 + r() * 0.16;
    const p = front ? [s, y, D / 2 - sc * 0.3] : [W / 2 - sc * 0.3, y, s];
    batch.add(GEO.dodeca, r() < 0.5 ? '#8a7a6c' : '#a09080', { pos: p, rot: [r() * 3, r() * 3, 0], scale: [sc * 1.3, sc, sc] });
  }
}

/* ------------------------------------------------------------------ */
/* Agua: río, acequia y cascada por el borde.                          */
/* ------------------------------------------------------------------ */

function waterTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, '#8fdcdf');
  gr.addColorStop(0.22, '#45b6c8');
  gr.addColorStop(0.5, '#2d9db6');
  gr.addColorStop(0.78, '#45b6c8');
  gr.addColorStop(1, '#8fdcdf');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 256);
  const r = rng(3);
  for (let i = 0; i < 46; i++) {
    const x = 4 + r() * 56, y = r() * 256, len = 10 + r() * 34;
    g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 1.8;
    g.lineCap = 'round';
    for (const dy of [0, -256, 256]) {
      g.beginPath();
      g.moveTo(x, y + dy);
      g.lineTo(x + (r() - 0.5) * 3, y + len + dy);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Cinta a lo largo de una polilínea [{x,y,z}] con ancho por punto.
function ribbon(points, widthAt, vScale = 1 / 3, alphaAt = null) {
  const pos = [], uv = [], col = [], idx = [];
  let arc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x, tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const w = widthAt(p, i) / 2;
    if (i > 0) arc += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y, p.z - points[i - 1].z);
    pos.push(p.x + nx * w, p.y, p.z + nz * w, p.x - nx * w, p.y, p.z - nz * w);
    uv.push(0, arc * vScale, 1, arc * vScale);
    const al = alphaAt ? alphaAt(p, i) : 1;
    col.push(1, 1, 1, al, 1, 1, 1, al);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (alphaAt) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildWater() {
  const group = new THREE.Group();
  const base = waterTexture();
  const mk = (extra = {}) => {
    const map = base.clone();
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map, roughness: 0.25, metalness: 0.05, emissive: 0x0c4a55, emissiveIntensity: 0.35, side: THREE.DoubleSide, ...extra,
    });
  };

  // Río
  const riverMat = mk();
  const rpts = RIVER_SAMPLES.map((p) => ({ x: p.x, y: 0.045, z: p.z }));
  const river = new THREE.Mesh(ribbon(rpts, (p) => riverWidth(p.z)), riverMat);
  river.receiveShadow = true;
  group.add(river);

  // Acequia
  const acMat = mk();
  acMat.map.repeat.set(1, 1);
  const ax1 = riverXAt(ACEQUIA_Z) - 0.45;
  const apts = [];
  for (let x = -W / 2; x <= ax1; x += 0.5) apts.push({ x, y: 0.035, z: ACEQUIA_Z });
  const acequia = new THREE.Mesh(ribbon(apts, () => 0.26, 1 / 1.5), acMat);
  acequia.receiveShadow = true;
  group.add(acequia);

  // Cascada por el borde delantero
  const end = RIVER_SAMPLES[RIVER_SAMPLES.length - 1];
  const fallMat = mk({ transparent: true, vertexColors: true, depthWrite: false });
  const fpts = [
    { x: end.x, y: 0.045, z: D / 2 - 0.02 },
    { x: end.x, y: 0.02, z: D / 2 + 0.06 },
    { x: end.x, y: -0.12, z: D / 2 + 0.11 },
  ];
  for (let y = -0.35; y >= -BASE - 1.6; y -= 0.25) fpts.push({ x: end.x, y, z: D / 2 + 0.12 + Math.min(0.05, -y * 0.01) });
  // La cinta va en el plano vertical: construimos con el "ancho" sobre el eje x.
  const fgeo = fallRibbon(fpts, riverWidth(D / 2) * 0.92);
  const fall = new THREE.Mesh(fgeo, fallMat);
  group.add(fall);

  return {
    group,
    update(T) {
      riverMat.map.offset.y = -T * 12;
      acMat.map.offset.y = -T * 20;
      fallMat.map.offset.y = -T * 40;
    },
  };
}

function fallRibbon(pts, width) {
  const pos = [], uv = [], col = [], idx = [];
  let arc = 0;
  const yTop = pts[0].y, yBot = pts[pts.length - 1].y;
  pts.forEach((p, i) => {
    if (i > 0) arc += Math.hypot(p.y - pts[i - 1].y, p.z - pts[i - 1].z);
    const narrow = 1 - 0.18 * smoothstep(yTop, yBot, p.y);
    const w = (width / 2) * narrow;
    pos.push(p.x - w, p.y, p.z, p.x + w, p.y, p.z);
    uv.push(0, arc / 3, 1, arc / 3);
    const a = 1 - smoothstep(-1.2, yBot + 0.2, p.y);
    col.push(1, 1, 1, a * 0.92, 1, 1, 1, a * 0.92);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
