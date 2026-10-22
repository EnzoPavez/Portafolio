import * as THREE from 'three';
import { GEO, FX, TAU, rng, lerp, wave, smoothstep } from './utils.js';
import { EXT, ROAD, BODEGA, HOUSE, ACEQUIA_Z, PARCELS, GORGE, RIVER_SAMPLES, riverWidth, riverXAt } from './layout.js';
import { BRIDGE } from './buildings.js';

/* Detalles chicos (v4 y v5). Lo fijo va al batch estático (no suma draw calls);
   lo animado usa una sola malla instanciada por tipo. */

const SIGN_FONT = '"Segoe UI", system-ui, Arial, sans-serif';

/* ------------------------- Malla antigranizo ------------------------ */
// Típica de los viñedos mendocinos: una red oscura tensada sobre las hileras.
function hailNet(batch) {
  const p = PARCELS.find((q) => q.name === 'E');
  const x0 = p.x0 - 0.2, x1 = p.x1 + 0.2, z0 = p.z0 - 0.2, z1 = p.z1 + 0.2, H = 0.95;
  for (const x of [x0, (x0 + x1) / 2, x1]) for (const z of [z0, z1]) batch.add(GEO.cyl4o, '#5b5e60', { pos: [x, 0, z], scale: [0.025, H, 0.025], shadow: false });
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(28,30,34,0.22)'; // velo oscuro: así se ve la malla desde arriba
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(25,27,30,0.7)';
  g.lineWidth = 5;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((x1 - x0) / 0.9, (z1 - z0) / 0.9);
  tex.anisotropy = 8;
  // Cumbreras: la red cae en "capillas" entre cables (perfil en zigzag suave)
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 24, 1).rotateX(-Math.PI / 2);
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setY(i, H - 0.12 * Math.abs(Math.sin(((pa.getX(i) + (x1 - x0) / 2) / 0.8) * Math.PI)));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1 }));
  m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  m.renderOrder = 4;
  return m;
}

/* -------------------- Cartel turístico (marrón) -------------------- */
function atuelSign(batch) {
  const x = BRIDGE.x1 + BRIDGE.ramp + 0.9, z = ROAD.z + ROAD.half + 0.45, ry = 0.62;
  batch.add(GEO.box, '#d9d9d9', { pos: [x, 0, z], rot: [0, ry, 0], scale: [0.05, 0.95, 0.05], shadow: false });
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const g = cv.getContext('2d');
  g.fillStyle = '#6b3a1f';
  g.beginPath();
  g.roundRect(0, 0, 512, 192, 22);
  g.fill();
  g.strokeStyle = '#f5efe6';
  g.lineWidth = 8;
  g.beginPath();
  g.roundRect(12, 12, 488, 168, 14);
  g.stroke();
  g.fillStyle = '#f5efe6';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `800 60px ${SIGN_FONT}`;
  g.fillText('CAÑÓN', 40, 70);
  g.font = `700 44px ${SIGN_FONT}`;
  g.fillText('DEL ATUEL', 40, 130);
  // Flecha
  g.beginPath();
  g.moveTo(390, 70); g.lineTo(460, 96); g.lineTo(390, 122); g.lineTo(390, 106); g.lineTo(330, 106); g.lineTo(330, 86); g.lineTo(390, 86);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.4, roughness: 0.7 });
  const back = new THREE.MeshStandardMaterial({ color: '#8a8f93', roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.36, 0.03), [back, back, back, back, face, back]);
  m.position.set(x, 0.8, z + 0.03);
  m.rotation.y = ry;
  m.castShadow = true;
  return m;
}

/* ---------------------- Estáticos chicos (batch) ---------------------- */
function staticBits(batch) {
  // Damajuanas con canasto de mimbre junto a las barricas
  const front = BODEGA.z + BODEGA.d / 2;
  for (const [x, z, s] of [[BODEGA.x + 0.72, front + 0.5, 1], [BODEGA.x + 0.9, front + 0.72, 0.85], [BODEGA.x + 0.58, front + 0.76, 0.9]]) {
    batch.add(GEO.ico1, '#2f6b3a', { pos: [x, 0.11 * s, z], scale: [0.1 * s, 0.11 * s, 0.1 * s], shadow: false });
    batch.add(GEO.cyl4o, '#2f6b3a', { pos: [x, 0.19 * s, z], scale: [0.025 * s, 0.07 * s, 0.025 * s], shadow: false });
    batch.add(GEO.cyl, '#b48a4f', { pos: [x, 0, z], scale: [0.105 * s, 0.09 * s, 0.105 * s], ao: [0, 0.08, 0.7], fx: [0, 3] });
  }
  // Compuerta de la acequia, con su volante
  const gx = riverXAt(ACEQUIA_Z) - 2.6;
  for (const s of [-1, 1]) batch.add(GEO.box, '#7d8286', { pos: [gx, 0, ACEQUIA_Z + s * 0.2], scale: [0.06, 0.42, 0.06] });
  batch.add(GEO.box, '#8f969b', { pos: [gx, 0.03, ACEQUIA_Z], scale: [0.04, 0.24, 0.36] });
  batch.add(GEO.box, '#7d8286', { pos: [gx, 0.42, ACEQUIA_Z], scale: [0.07, 0.05, 0.46] });
  batch.add(GEO.cylC, '#c33f33', { pos: [gx, 0.52, ACEQUIA_Z], rot: [0, 0, Math.PI / 2], scale: [0.09, 0.015, 0.09] });
  // Tendedero en el patio de la casa, entre el sendero y el corral (la ropa se anima aparte)
  const lz = HOUSE.z + 3.05, x0 = HOUSE.x + 0.4, x1 = HOUSE.x + 1.55;
  for (const x of [x0, x1]) batch.add(GEO.box, '#7a5a3c', { pos: [x, 0, lz], scale: [0.04, 0.72, 0.04] });
  batch.add(GEO.boxC, '#e8e2d4', { pos: [(x0 + x1) / 2, 0.68, lz], scale: [x1 - x0, 0.008, 0.008] });
  return { line: { x0, x1, y: 0.68, z: lz } };
}

/* -------------------------- Ropa tendida -------------------------- */
function laundry(line) {
  const colors = ['#ffffff', '#7cc6ec', '#e94f37', '#f6c445', '#ffffff', '#8e5cc9'];
  const n = colors.length;
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
  const inst = new THREE.InstancedMesh(geo, mat, n);
  inst.castShadow = true;
  const c = new THREE.Color();
  const items = colors.map((col, i) => {
    inst.setColorAt(i, c.set(col));
    return { x: lerp(line.x0 + 0.1, line.x1 - 0.1, i / (n - 1)), w: 0.13 + (i % 3) * 0.03, h: 0.17 + ((i * 7) % 3) * 0.05, ph: i * 0.17 };
  });
  inst.instanceColor.needsUpdate = true;
  const d = new THREE.Object3D();
  return {
    object: inst,
    update(T) {
      items.forEach((it, i) => {
        d.position.set(it.x, line.y, line.z);
        d.rotation.set(-0.3 - 0.22 * wave(T, 13, it.ph) - 0.08 * wave(T, 31, it.ph), 0, 0);
        d.scale.set(it.w, it.h, 1);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}

/* ---------------------------- Mariposas ---------------------------- */
function butterflies() {
  const r = rng(91);
  const homes = [[-6.8, 1.3], [3.8, 4.6], [-9.2, 4.4], [11.6, 2.6], [-14.7, 0.5], [0.8, -0.3], [9.8, 10.4], [-2.2, 4.5]];
  const colors = ['#ffffff', '#f6c445', '#ff8a1f', '#ffffff', '#f6c445', '#7cc6ec', '#ffffff', '#ff8a1f'];
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.04, 0.1, 0, 0.07, 0, 0, -0.03, 0.1, 0, 0.07, 0.085, 0, -0.06, 0, 0, -0.03], 3));
  wingGeo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.6 });
  const wl = new THREE.InstancedMesh(wingGeo, mat, homes.length);
  const wr = new THREE.InstancedMesh(wingGeo.clone().scale(-1, 1, 1), mat, homes.length);
  const c = new THREE.Color();
  for (const m of [wl, wr]) {
    homes.forEach((_, i) => m.setColorAt(i, c.set(colors[i])));
    m.instanceColor.needsUpdate = true;
  }
  const data = homes.map(([x, z]) => ({ x, z, a: 0.5 + r() * 0.5, b: 0.3 + r() * 0.4, k: 1 + Math.floor(r() * 3), ph: r() }));
  const body = new THREE.Object3D(), wing = new THREE.Object3D();
  const group = new THREE.Group();
  group.add(wl, wr);
  return {
    group,
    update(T) {
      data.forEach((d, i) => {
        // Vuelo en ocho, subiendo y bajando, con aleteo rápido
        const t = TAU * (T * d.k + d.ph);
        const x = d.x + Math.sin(t) * d.a, z = d.z + Math.sin(2 * t) * d.b;
        const dx = Math.cos(t) * d.a, dz = 2 * Math.cos(2 * t) * d.b;
        body.position.set(x, 0.35 + 0.12 * Math.sin(t * 3) + 0.04 * Math.sin(TAU * T * 90 + i), z);
        body.rotation.set(0, Math.atan2(dx, dz), 0);
        body.updateMatrix();
        const flap = 0.15 + 1.1 * Math.abs(Math.sin(TAU * T * 140 + i * 1.7));
        for (const [m, s] of [[wl, 1], [wr, -1]]) {
          wing.rotation.set(0, 0, s * flap);
          wing.updateMatrix();
          m.setMatrixAt(i, wing.matrix.premultiply(body.matrix));
          m.instanceMatrix.needsUpdate = true;
        }
      });
    },
  };
}

/* ------------------- Polvo detrás de los vehículos ------------------- */
function dust() {
  const N = 12;
  const mat = new THREE.MeshStandardMaterial({ color: '#e7d6b4', transparent: true, opacity: 0.42, depthWrite: false, roughness: 1, flatShading: true });
  const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, N);
  inst.renderOrder = 5;
  const d = new THREE.Object3D();
  const tractor = { x0: -EXT.W / 2 - 1.0, x1: EXT.W / 2 + 2.6, rear: 1.9 };
  const float = { x0: -EXT.W / 2 - 1.5, x1: EXT.W / 2 + 1.4, rear: 1.4 };
  return {
    object: inst,
    update(T, T2) {
      const v = T2 < 0.5 ? tractor : float;
      const x = lerp(v.x0, v.x1, T2 < 0.5 ? T2 * 2 : (T2 - 0.5) * 2);
      for (let i = 0; i < N; i++) {
        const age = (((T * 30 + i / N) % 1) + 1) % 1;
        // Sobre el puente (tablas de madera) no levanta polvo
        const px = x - v.rear - age * 1.6;
        const onBridge = px > BRIDGE.x0 - 0.2 && px < BRIDGE.x1 + 0.2;
        const s = onBridge ? 0 : (0.06 + 0.22 * age) * (1 - smoothstep(0.6, 1, age));
        d.position.set(px, 0.06 + age * 0.35, ROAD.z + 0.3 + Math.sin(i * 2.3) * 0.25 * age);
        d.scale.set(s * 1.3, s * 0.8, s);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}

/* ------------------- Piedras en el río con espuma ------------------- */
// Espuma (para alphaMap: blanco sobre negro). La piedra queda arriba a la izquierda:
// a la izquierda está la orilla y hacia abajo corre el agua.
function foamTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const g = cv.getContext('2d');
  const r = rng(13);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  g.filter = 'blur(1.5px)';
  g.lineCap = 'round';
  // Remolino alrededor de la piedra: sólo del lado del agua
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(34, 70, 46, -2.6, 1.9);
  g.stroke();
  g.strokeStyle = '#9a9a9a';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(34, 70, 58, -2.2, 1.4);
  g.stroke();
  // Estela río abajo que se va abriendo y apagando
  for (let i = 0; i < 12; i++) {
    const x0 = 40 + r() * 50, y0 = 95 + r() * 35, len = 60 + r() * 110;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#a0a0a0');
    gr.addColorStop(1, '#000000');
    g.strokeStyle = gr;
    g.lineWidth = 4 + r() * 6;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + 6, y0 + len * 0.5, x0 + 4 + r() * 14, y0 + len);
    g.stroke();
  }
  // Burbujas
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.arc(40 + r() * 70, 20 + r() * 150, 1 + r() * 2.2, 0, TAU);
    g.fill();
  }
  return new THREE.CanvasTexture(cv);
}

// Piedras grandes en el borde del agua (del lado de la orilla, así el gomón pasa libre),
// con un remolino de espuma alrededor y una estela río abajo.
function riverRocks(batch) {
  const r = rng(29);
  const spots = [];
  let last = -Infinity;
  for (let i = 4; i < RIVER_SAMPLES.length - 4; i++) {
    const p = RIVER_SAMPLES[i];
    if (p.z < -12 || p.z > GORGE.z0 - 0.8 || Math.abs(p.z - ROAD.z) < 1.6 || Math.abs(p.z - ACEQUIA_Z) < 1) continue;
    if (i - last < 16 || r() > 0.5) continue;
    last = i;
    const a = RIVER_SAMPLES[i - 2], b = RIVER_SAMPLES[i + 2];
    const tl = Math.hypot(b.x - a.x, b.z - a.z);
    const tx = (b.x - a.x) / tl, tz = (b.z - a.z) / tl;
    const side = r() < 0.5 ? -1 : 1;
    const s = 0.15 + r() * 0.06;
    // (tz, -tx) es la normal derecha del flujo; la piedra va contra la orilla de ese lado
    const off = riverWidth(p.z) / 2 + s * 0.5;
    spots.push({ x: p.x + tz * side * off, z: p.z - tx * side * off, tx, tz, side, s });
  }
  for (const sp of spots) {
    batch.add(GEO.dodeca, r() < 0.5 ? '#8f8a82' : '#a39d93', {
      pos: [sp.x, 0.045 - sp.s * 0.2, sp.z], rot: [r() * 0.5, r() * 3, r() * 0.5], scale: [sp.s * 1.3, sp.s * 0.8, sp.s * 1.1], ao: [-1, 0.5, 0.7], fx: [0, FX.STONE],
    });
    // Una piedra más chica pegada, río abajo, del lado de la orilla
    const o = sp.s * 1.1;
    batch.add(GEO.ico, '#9a948a', {
      pos: [sp.x + sp.tx * o + sp.tz * sp.side * o * 0.5, 0.03, sp.z + sp.tz * o - sp.tx * sp.side * o * 0.5], rot: [r(), r() * 3, 0], scale: [sp.s * 0.6, sp.s * 0.45, sp.s * 0.55], fx: [0, FX.STONE], shadow: false,
    });
  }

  // Espuma: un plano por piedra, girado para que la estela vaya río abajo y hacia el centro
  // DoubleSide: el espejado por instancia invierte la cara
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', alphaMap: foamTexture(), transparent: true, depthWrite: false, opacity: 0.9, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, spots.length);
  inst.renderOrder = 3;
  const d = new THREE.Object3D();
  return {
    object: inst,
    update(T) {
      spots.forEach((sp, i) => {
        // El remolino late apenas, como si el agua empujara
        const k = 1 + 0.05 * wave(T, 11 + i, i * 0.37);
        // Local +z = río abajo; local +x = hacia el centro (espejado según la orilla)
        const sx = -sp.side * sp.s * 4 * k, l = sp.s * 8 * k;
        // La piedra está en (-0.234, -0.227) del plano: se corre el centro para que coincida
        const a = 0.234 * sx, b = 0.227 * l;
        d.position.set(sp.x + a * sp.tz + b * sp.tx, 0.05, sp.z - a * sp.tx + b * sp.tz);
        d.rotation.set(0, Math.atan2(sp.tx, sp.tz), 0);
        d.scale.set(sx, 1, l);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}

export function buildDetails(batch) {
  const group = new THREE.Group();
  const bits = staticBits(batch);
  group.add(hailNet(batch), atuelSign(batch));
  const clothes = laundry(bits.line);
  const flies = butterflies();
  const dusty = dust();
  const rocks = riverRocks(batch);
  group.add(clothes.object, flies.group, dusty.object, rocks.object);
  return {
    group,
    update(T, T2) {
      clothes.update(T);
      flies.update(T);
      dusty.update(T, T2);
      rocks.update(T);
    },
  };
}
