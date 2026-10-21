import * as THREE from 'three';
import { rng, fbm, lerp, smoothstep, valueNoise, chainShader, GEO } from './utils.js';
import {
  W, D, EXT, GORGE, gorgeHeight, RIVER_SAMPLES, riverWidth, riverXAt, mountainHeight, distToRiver, forestNoise, vegetationLine, snowLine, MOUNTAIN_Z1,
  ROAD, LANE, ACEQUIA_Z, PARCELS, parcelRows, BODEGA, HOUSE, CORRAL, PERGOLA,
  PATIO, PASTURE, COOP, FIRE,
} from './layout.js';

/* ------------------------------------------------------------------ */
/* Textura del suelo: pasto, parcelas, caminos, río y AO "pintado".     */
/* ------------------------------------------------------------------ */

// Pinta el suelo de un rectángulo del mundo (en coordenadas x/z). Se usa dos veces:
// la escena en alta resolución y los alrededores en baja (mismo dibujo, sin costura).
export const SCENE_RECT = { x0: -W / 2, z0: -D / 2, w: W, d: D };
export const EXT_RECT = { x0: -EXT.W / 2, z0: -EXT.D / 2, w: EXT.W, d: EXT.D };

export function buildGroundTexture(aoSpots, maxAniso = 8, rect = SCENE_RECT, pxW = 2048) {
  const S = pxW / rect.w;
  const cv = document.createElement('canvas');
  cv.width = pxW;
  cv.height = Math.round(rect.d * S);
  const g = cv.getContext('2d');
  const X = (x) => (x - rect.x0) * S;
  const Y = (z) => (z - rect.z0) * S;
  const r = rng(7);
  const dens = (pxW / 2048) * (pxW / 2048);

  // Pasto base con franjas de cortadora (alineadas al mundo, no al lienzo)
  g.fillStyle = '#8fbb5d';
  g.fillRect(0, 0, cv.width, cv.height);
  const k0 = Math.floor((rect.x0 + W / 2) / 1.15);
  for (let i = k0, x = -W / 2 + k0 * 1.15; x < rect.x0 + rect.w; x += 1.15, i++) {
    g.fillStyle = ((i % 2) + 2) % 2 ? 'rgba(255,255,230,0.06)' : 'rgba(20,60,10,0.045)';
    g.fillRect(X(x), 0, 1.15 * S, cv.height);
  }
  // Pie de montaña más oscuro
  const mg = g.createLinearGradient(0, Y(-6.5), 0, Y(-3.2));
  mg.addColorStop(0, '#87ba57');
  mg.addColorStop(1, 'rgba(135,186,87,0)');
  g.fillStyle = mg;
  g.fillRect(0, 0, cv.width, Y(-3.2));

  speckle(g, r, 0, 0, cv.width, cv.height, Math.round((cv.width * cv.height) / 216), ['rgba(40,80,20,0.12)', 'rgba(255,255,210,0.10)']);

  // Campos de los alrededores: alfalfa, rastrojo arado y pastura
  const field = (x0, z0, x1, z1, base, stripe, along = 'x', step = 0.55) => {
    rrectRaw(x0, z0, x1, z1, base);
    if (along === 'x') for (let z = z0 + step / 2; z < z1; z += step) line(g, X(x0 + 0.2), Y(z), X(x1 - 0.2), Y(z), 0.16 * S, stripe);
    else for (let x = x0 + step / 2; x < x1; x += step) line(g, X(x), Y(z0 + 0.2), X(x), Y(z1 - 0.2), 0.16 * S, stripe);
  };
  const rrectRaw = (x0, z0, x1, z1, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(X(x0), Y(z0), (x1 - x0) * S, (z1 - z0) * S, 0.4 * S);
    g.fill();
  };
  field(-25.6, -2.6, -19.2, 2.5, '#7fb04c', 'rgba(60,110,30,0.35)', 'x');
  field(19.4, -3.0, 25.8, 2.4, '#c9a87a', 'rgba(120,85,50,0.35)', 'z', 0.4);
  field(18.6, 14.0, 25.8, 19.6, '#9dc25c', 'rgba(70,120,40,0.3)', 'x', 0.7);

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

  // Potrero: pasto más tupido con zonas pisadas
  rrect(PASTURE.x0, PASTURE.z0, PASTURE.x1, PASTURE.z1, 0.3, '#86b456');
  for (let i = 0; i < 7; i++) {
    const px = lerp(PASTURE.x0 + 0.4, PASTURE.x1 - 0.4, r()), pz = lerp(PASTURE.z0 + 0.4, PASTURE.z1 - 0.4, r());
    const gr = g.createRadialGradient(X(px), Y(pz), 0, X(px), Y(pz), (0.35 + r() * 0.4) * S);
    gr.addColorStop(0, 'rgba(190,160,105,0.55)');
    gr.addColorStop(1, 'rgba(190,160,105,0)');
    g.fillStyle = gr;
    g.fillRect(X(px) - S, Y(pz) - S, 2 * S, 2 * S);
  }
  speckle(g, r, X(PASTURE.x0), Y(PASTURE.z0), (PASTURE.x1 - PASTURE.x0) * S, (PASTURE.z1 - PASTURE.z0) * S, 1400, ['rgba(40,90,20,0.2)', 'rgba(230,240,170,0.2)']);
  // Gallinero: tierra picoteada
  const cg = g.createRadialGradient(X(COOP.x + 0.2), Y(COOP.z + 1.2), 0, X(COOP.x + 0.2), Y(COOP.z + 1.2), 1.9 * S);
  cg.addColorStop(0, 'rgba(201,165,115,0.95)');
  cg.addColorStop(0.7, 'rgba(201,165,115,0.6)');
  cg.addColorStop(1, 'rgba(201,165,115,0)');
  g.fillStyle = cg;
  g.fillRect(X(COOP.x - 2), Y(COOP.z - 1), 4.4 * S, 4.4 * S);

  // Patio criollo: tierra apisonada + baldosas bajo la mesa y tarima
  rrect(PATIO.x0, PATIO.z0, PATIO.x1, PATIO.z1, 0.6, '#dcc39a');
  speckle(g, r, X(PATIO.x0), Y(PATIO.z0), (PATIO.x1 - PATIO.x0) * S, (PATIO.z1 - PATIO.z0) * S, 2600, ['rgba(140,105,60,0.2)', 'rgba(255,245,225,0.25)']);
  rrect(-11.25, -1.65, -7.75, 0.05, 0.12, '#c98b62');
  for (let x = -11.25; x <= -7.75; x += 0.29) line(g, X(x), Y(-1.65), X(x), Y(0.05), 1.4, 'rgba(110,60,35,0.35)');
  for (let z = -1.65; z <= 0.05; z += 0.29) line(g, X(-11.25), Y(z), X(-7.75), Y(z), 1.4, 'rgba(110,60,35,0.35)');
  const fg = g.createRadialGradient(X(FIRE.x), Y(FIRE.z), 0, X(FIRE.x), Y(FIRE.z), 0.9 * S);
  fg.addColorStop(0, 'rgba(60,40,30,0.6)');
  fg.addColorStop(1, 'rgba(60,40,30,0)');
  g.fillStyle = fg;
  g.fillRect(X(FIRE.x - 1), Y(FIRE.z - 1), 2 * S, 2 * S);

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
  rrect(LANE.x - LANE.half, ROAD.z, LANE.x + LANE.half, EXT.D / 2 + 0.1, 0.1, dirt);
  // Huella que separa la escena de los viñedos de adelante
  rrect(-EXT.W / 2, D / 2 + 0.35, riverXAt(D / 2 + 0.6) - 1.6, D / 2 + 0.95, 0.1, dirt);
  rrect(BODEGA.x - 0.7, BODEGA.z + BODEGA.d / 2 - 0.1, BODEGA.x + 0.7, ROAD.z, 0.1, '#e8dcc4');
  rrect(HOUSE.x - 0.45, HOUSE.z + HOUSE.d / 2, HOUSE.x + 0.45, ROAD.z, 0.1, dirt);
  speckle(g, r, 0, Y(ROAD.z - ROAD.half), cv.width, ROAD.half * 2 * S, Math.round(3000 * dens * (rect.w / W)), ['rgba(130,95,55,0.18)', 'rgba(255,250,235,0.25)']);
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
  // Garganta rocosa al frente: paredes y lecho de piedra
  const gorgePts = pts.filter((p) => p.z > GORGE.z0 - 0.05);
  for (const [w, c] of [[2.9, '#b3a797'], [2.1, '#a19484'], [1.4, '#857a6c']]) {
    g.strokeStyle = c;
    g.lineWidth = w * S;
    g.beginPath();
    gorgePts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
    g.stroke();
  }
  for (let i = 0; i < 1300; i++) {
    const p = pts[Math.floor(r() * pts.length)];
    if (p.z > GORGE.z0) continue;
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

export function buildGround(texture, outerTexture) {
  const group = new THREE.Group();
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  inner.receiveShadow = true;

  // Alrededores: grilla gruesa (es plano) y densa sólo donde está la garganta;
  // bajo la escena queda escondida.
  const lines = (coarse, dense, extra) => [...new Set([...coarse, ...dense, ...extra].map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
  const range = (a, b, st) => Array.from({ length: Math.round((b - a) / st) + 1 }, (_, i) => a + i * st);
  const xs = lines(range(-EXT.W / 2, EXT.W / 2, 2), range(3.5, 15.5, 0.25), [-W / 2 + 0.1, W / 2 - 0.1]);
  const zs = lines(range(-EXT.D / 2, EXT.D / 2, 2), range(GORGE.z0 - 0.25, EXT.D / 2, 0.25), [-D / 2, -D / 2 + 0.1, D / 2 - 0.1, D / 2]);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i;
      let y = 0;
      if (Math.abs(x) < W / 2 - 0.05 && Math.abs(z) < D / 2 - 0.05) y = -0.03;
      else if (z > GORGE.z0) y = gorgeHeight(x, z);
      pos.set([x, y, z], k * 3);
      uv.set([(x + EXT.W / 2) / EXT.W, 1 - (z + EXT.D / 2) / EXT.D], k * 2);
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const col = new Float32Array(nx * nz * 3);
  for (let k = 0; k < nx * nz; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    let shade = 1 + Math.min(0, y) * 0.09; // un poco más oscuro hacia el fondo de la garganta
    // Paredes empinadas: vetas de roca para que no se vean como una placa lisa
    if (nrm.getY(k) < 0.85) shade *= 0.74 + 0.36 * valueNoise(x * 2.6 + y * 3.1, z * 2.6 - y * 2.3);
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const outer = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: outerTexture, vertexColors: true, roughness: 1 }));
  outer.receiveShadow = true;
  outer.castShadow = true;
  group.add(inner, outer);
  return group;
}

/* ------------------------------------------------------------------ */
/* Montañas low-poly con color por cara.                               */
/* ------------------------------------------------------------------ */

// Grilla de resolución variable: densa sobre la escena (filas muy juntas en
// profundidad para que las laderas no se estiren en pantalla) y gruesa en los
// alrededores, que igual se pierden en la bruma.
function axis(a0, a1, d0, d1, fine, coarse) {
  const out = [];
  const seg = (from, to, step) => {
    const n = Math.max(1, Math.ceil((to - from) / step - 1e-6));
    for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / n);
  };
  if (d0 > a0) seg(a0, d0, coarse);
  seg(d0, d1, fine);
  if (a1 > d1) seg(d1, a1, coarse);
  out.push(a1);
  return out;
}
const MX = axis(-EXT.W / 2, EXT.W / 2, -W / 2 - 0.6, W / 2 + 0.6, 0.24, 0.7);
const MZ = axis(-EXT.D / 2, MOUNTAIN_Z1, -D / 2 - 0.6, MOUNTAIN_Z1, 0.135, 0.7);
const SEG_X = MX.length - 1;
const SEG_Z = MZ.length - 1;
const mgx = (i) => MX[i];
const mgz = (j) => MZ[j];

const MC = Object.fromEntries(Object.entries({
  low: '#88b958', mid: '#6fa34c', high: '#5f9049', forest: '#3f7838', meadow: '#9fc466',
  rock: '#8e8a83', rockDark: '#6c6a66', rockLight: '#aba69d', rockWarm: '#9b8b7c',
  red: '#b07560', red2: '#8f6252', snow: '#f6f9fb', moss: '#68745a',
}).map(([k, v]) => [k, new THREE.Color(v)]));

// Color por vértice: verde en las faldas (con bosques), roca gris con vetas
// arriba, tono terracota apagado en el cañón del Atuel, nieve en las cumbres
// y AO por concavidad para marcar quebradas y crestas.
const _rk = new THREE.Color(), _gr = new THREE.Color(), _red = new THREE.Color();
function mountainVertexColor(out, x, z, h, ny, dr, cav) {
  const n1 = forestNoise(x, z);
  const tint = fbm(x * 0.5 - 7, z * 0.5 + 3, 2);
  const slope = 1 - ny;
  // Roca gris con estratos suaves
  const strata = 0.5 + 0.5 * Math.sin(h * 2.4 + tint * 4);
  _rk.copy(MC.rock).lerp(MC.rockLight, smoothstep(0.5, 0.75, tint))
    .lerp(MC.rockWarm, smoothstep(0.4, 0.25, tint) * 0.45)
    .lerp(MC.rockDark, smoothstep(0.65, 0.95, strata) * 0.3 + smoothstep(0.55, 0.8, slope) * 0.35);
  // Pasto según altura
  _gr.copy(MC.low).lerp(MC.mid, smoothstep(0.3, 1.8, h)).lerp(MC.high, smoothstep(1.8, 3.2, h));
  _gr.lerp(MC.meadow, smoothstep(0.36, 0.33, n1) * 0.45 * (1 - smoothstep(1.4, 2.6, h)));
  const vl = vegetationLine(x, z);
  const veg = smoothstep(vl + 0.2, vl - 0.2, h) * smoothstep(0.66, 0.5, slope);
  out.copy(_rk).lerp(_gr, veg);
  out.lerp(MC.forest, smoothstep(0.56, 0.59, n1) * veg * 0.8);
  // Bajo los bosques de pinos, la roca toma un tono musgo
  out.lerp(MC.moss, smoothstep(0.55, 0.6, n1) * (1 - veg) * 0.5 * (1 - smoothstep(3.4, 4.0, h)));
  // Cañón: roca con tinte terracota (no marrón pleno)
  const canyon = smoothstep(3.4, 1.8, dr) * smoothstep(0.1, 0.22, slope) * (1 - smoothstep(1.6, 2.4, h)) * 0.6;
  if (canyon > 0) {
    const t = h * 2.2 + tint;
    const band = smoothstep(0.4, 0.5, t - Math.floor(t)) - smoothstep(0.8, 0.9, t - Math.floor(t));
    _red.copy(MC.red).lerp(MC.red2, band).lerp(_rk, 0.35);
    out.lerp(_red, canyon * 0.85);
  }
  return out;
}

const mountainAO = (cav) => 1 - Math.min(0.34, Math.max(0, cav) * 1.3) + Math.min(0.08, Math.max(0, -cav) * 0.35);

// La nieve se calcula por píxel (con la cota interpolada por vértice): borde limpio,
// sin el serrucho que deja interpolar un color "escalón" entre vértices.
export function buildMountainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 snowData;\nvarying vec3 vSnow;\nvarying float vHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnow = snowData;\nvHeight = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnow;\nvarying float vHeight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Nieve principal (también en caras empinadas) + manchones en cornisas planas más abajo
        float snowMain = smoothstep(vSnow.x - 0.09, vSnow.x + 0.09, vHeight) * smoothstep(0.03, 0.14, vSnow.y);
        float ledges = smoothstep(vSnow.x - 0.75, vSnow.x - 0.2, vHeight) * smoothstep(0.74, 0.88, vSnow.y) * 0.85;
        float snowMask = max(snowMain, ledges);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.955) * vSnow.z, snowMask);`);
  };
  return m;
}

// Sombra de nubes: una mancha suave que el terreno oscurece proyectando cada punto
// hacia el sol hasta la altura de la nube (sin el borde duro del shadow map).
export function cloudShadowUniforms() {
  return { uClouds: { value: [new THREE.Vector4(0, 100, 0, 1), new THREE.Vector4(0, 100, 0, 1)] } };
}

export function applyCloudShadow(material, uniforms) {
  chainShader(material, 'cloudshadow', (sh) => {
    sh.uniforms.uClouds = uniforms.uClouds;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vCloudWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vCloudWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uClouds[2];
        varying vec3 vCloudWPos;
        float cloudShade(vec3 p) {
          vec3 L = normalize(vec3(-0.45, 0.8, 0.42));
          float s = 0.0;
          for (int i = 0; i < 2; i++) {
            vec4 c = uClouds[i];
            vec3 q = p + L * ((c.y - p.y) / L.y);
            vec2 d = (q.xz - c.xz) / vec2(c.w, c.w * 0.7);
            s = max(s, 1.0 - smoothstep(0.1, 1.0, length(d)));
          }
          return s * s * (3.0 - 2.0 * s);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float cloudS = cloudShade(vCloudWPos);
        reflectedLight.directDiffuse *= 1.0 - 0.7 * cloudS;
        reflectedLight.directSpecular *= 1.0 - 0.7 * cloudS;
        reflectedLight.indirectDiffuse *= 1.0 - 0.18 * cloudS;`);
  });
}

export function buildMountainGeometry() {
  const nx = SEG_X + 1, nz = SEG_Z + 1;
  const Hg = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) Hg[j * nx + i] = mountainHeight(mgx(i), mgz(j));
  const at = (i, j) => Hg[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];

  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = mgx(i);
      pos[k * 3 + 1] = Hg[k];
      pos[k * 3 + 2] = mgz(j);
    }
  }
  const idx = [];
  for (let j = 0; j < SEG_Z; j++) {
    for (let i = 0; i < SEG_X; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (Hg[a] < -0.12 && Hg[b] < -0.12 && Hg[c] < -0.12 && Hg[d] < -0.12) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const col = new Float32Array(nx * nz * 3);
  const snow = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = mgx(i), z = mgz(j), h = Hg[k];
      const cav = (at(i - 2, j) + at(i + 2, j) + at(i, j - 4) + at(i, j + 4)) / 4 - h;
      const ao = mountainAO(cav);
      mountainVertexColor(c, x, z, h, nrm.getY(k), distToRiver(x, z), cav).multiplyScalar(ao);
      snow[k * 3] = snowLine(x, z);
      snow[k * 3 + 1] = nrm.getY(k);
      snow[k * 3 + 2] = Math.min(1, ao + 0.06);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('snowData', new THREE.BufferAttribute(snow, 3));
  return geo;
}

/* ------------------------------------------------------------------ */
/* Agua: río, cascada hacia la garganta y acequia.                    */
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

  // Río alto (hasta el borde de la garganta) y río bajo (en la garganta)
  const riverMat = mk();
  const lipX = riverXAt(GORGE.z0);
  const lowY = -GORGE.depth + 0.05;
  const up = RIVER_SAMPLES.filter((p) => p.z < GORGE.z0 - 0.02).map((p) => ({ x: p.x, y: 0.045, z: p.z }));
  up.push({ x: lipX, y: 0.045, z: GORGE.z0 });
  const low = [{ x: riverXAt(GORGE.z1 + 0.05), y: lowY, z: GORGE.z1 + 0.05 }];
  for (const p of RIVER_SAMPLES) if (p.z > GORGE.z1 + 0.12) low.push({ x: p.x, y: lowY, z: p.z });
  for (const pts of [up, low]) {
    const m = new THREE.Mesh(ribbon(pts, (p) => riverWidth(p.z)), riverMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // Acequia
  const acMat = mk();
  const ax1 = riverXAt(ACEQUIA_Z) - 0.45;
  const apts = [];
  for (let x = -EXT.W / 2; x <= ax1; x += 0.5) apts.push({ x, y: 0.035, z: ACEQUIA_Z });
  const acequia = new THREE.Mesh(ribbon(apts, () => 0.26, 1 / 1.5), acMat);
  acequia.receiveShadow = true;
  group.add(acequia);

  // Cascada: del borde de la escena al fondo de la garganta, por delante de la pared
  const fallMat = mk({ transparent: true, vertexColors: true, depthWrite: false });
  const fpts = [[GORGE.z0, 0.045], [GORGE.z0 + 0.06, 0.0], [GORGE.z0 + 0.12, -0.15], [GORGE.z0 + 0.17, -0.5], [GORGE.z0 + 0.21, -1.0], [GORGE.z0 + 0.25, -1.5], [GORGE.z1, lowY]]
    .map(([z, y]) => ({ x: lipX, y, z }));
  const fall = new THREE.Mesh(fallRibbon(fpts, riverWidth(GORGE.z1) * 0.92), fallMat);
  fall.renderOrder = 2;
  group.add(fall);

  // Espuma y rocío al pie de la cascada
  const foamMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
  const foam = new THREE.Mesh(new THREE.CircleGeometry(0.62, 22).rotateX(-Math.PI / 2), foamMat);
  foam.position.set(lipX, lowY + 0.012, GORGE.z1 + 0.25);
  foam.scale.set(1, 1, 0.7);
  foam.renderOrder = 3;
  group.add(foam);
  const sprayGeo = new THREE.IcosahedronGeometry(1, 1);
  const spray = Array.from({ length: 7 }, (_, i) => {
    const o = new THREE.Mesh(sprayGeo, new THREE.MeshStandardMaterial({ color: '#f4fbfd', transparent: true, opacity: 0.5, depthWrite: false, roughness: 1 }));
    o.renderOrder = 3;
    o.userData.ph = i / 7;
    group.add(o);
    return o;
  });

  return {
    group,
    update(T) {
      riverMat.map.offset.y = -T * 12;
      acMat.map.offset.y = -T * 20;
      fallMat.map.offset.y = -T * 40;
      foam.scale.set(1 + 0.06 * Math.sin(T * Math.PI * 2 * 9), 1, 0.7 + 0.05 * Math.sin(T * Math.PI * 2 * 7));
      spray.forEach((o, i) => {
        const f = (T * 10 + o.userData.ph) % 1;
        const a = i * 2.4;
        o.position.set(lipX + Math.cos(a) * 0.35 * f, lowY + 0.05 + f * 0.55, GORGE.z1 + 0.25 + Math.sin(a) * 0.25 * f);
        o.scale.setScalar(0.08 + 0.2 * f);
        o.material.opacity = 0.55 * (1 - f) * smoothstep(0, 0.15, f);
      });
    },
  };
}

// La cinta va en el plano vertical, con el ancho sobre el eje x.
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
    col.push(1, 1, 1, 0.92, 1, 1, 1, 0.92);
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
