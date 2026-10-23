import * as THREE from 'three';
import { rng, lerp, smoothstep, TAU, WIND } from './utils.js';
import { mountainHeight, MOUNTAIN_Z1 } from './layout.js';

/* Hojas de otoño: caen de los álamos dorados dando vueltas, el viento las corre hacia
   donde sopla, quedan un rato en el pasto y se van achicando hasta desaparecer; después
   vuelven a salir de la copa. Una sola malla instanciada (una draw call).
   Cada hoja hace 2 o 3 vueltas por loop, así todo empalma. */

// Más anaranjadas que la copa: así se distinguen cuando pasan por delante de ella
const COLORS = ['#e0902c', '#d9a23a', '#c9732a', '#e3b440', '#b8642a'];

export function buildLeaves(golden, perTree = 8) {
  const r = rng(91);
  // Rombo chico, un poco curvado al medio para que no sea un papel plano
  const geo = new THREE.BufferGeometry();
  const P = [[0, 0, -0.065], [0.045, 0.008, 0], [0, 0, 0.065], [-0.045, 0.008, 0]];
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3].flatMap((i) => P[i]), 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, flatShading: true, roughness: 0.8 });
  const list = [];
  for (const t of golden) {
    for (let k = 0; k < perTree; k++) {
      // Salen de la superficie de la copa, del lado hacia donde sopla (y se ven caer)
      const a = Math.atan2(WIND.z, WIND.x) + (r() - 0.5) * Math.PI * 1.3, rad = 0.5 + r() * 0.12;
      const x0 = t.x + Math.cos(a) * rad, z0 = t.z + Math.sin(a) * rad;
      const y0 = lerp(1.1, t.top - 0.4, r());
      // Cuánto la corre el viento: más cuanto más alto sale (pasa por delante de los vecinos)
      const drift = (1.4 + r() * 1.2) * (y0 / 2.4);
      const sw = 0.12 + r() * 0.1, swF = 2 + Math.floor(r() * 2), swP = r();
      const x1 = x0 + WIND.x * drift + 0.7 * sw * Math.sin(TAU * (swF + swP));
      const z1 = z0 + WIND.z * drift + 0.7 * sw * Math.cos(TAU * (swF + swP));
      list.push({
        x0, y0, z0, x1, z1, drift, sw, swF, swP,
        // Donde termina: el pasto o, al pie del cordón, la ladera
        ground: (z1 < MOUNTAIN_Z1 ? Math.max(0, mountainHeight(x1, z1)) : 0) + 0.012,
        k: 2 + Math.floor(r() * 2), ph: r(), spin: 2 + r() * 3, rest: r() * TAU,
        color: new THREE.Color(r() < 0.25 ? '#' + t.color : COLORS[Math.floor(r() * COLORS.length)]),
      });
    }
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  list.forEach((l, i) => mesh.setColorAt(i, l.color));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();

  return {
    mesh,
    update(T) {
      list.forEach((l, i) => {
        const f = (((T * l.k + l.ph) % 1) + 1) % 1;
        // 0..0.62 cae · hasta 0.9 queda en el pasto · hasta 1 se achica
        const fall = Math.min(1, f / 0.62);
        const y = lerp(l.y0, l.ground, fall);
        const swing = l.sw * (1 - fall * 0.3);
        p.set(
          l.x0 + WIND.x * l.drift * fall + swing * Math.sin(TAU * (fall * l.swF + l.swP)),
          y,
          l.z0 + WIND.z * l.drift * fall + swing * Math.cos(TAU * (fall * l.swF + l.swP))
        );
        if (f < 0.62) {
          // Vaivén de hoja que cae: se mece de costado y gira sobre sí misma
          const sway = Math.sin(TAU * (fall * l.swF + l.swP));
          e.set(0.9 * sway, TAU * fall * l.spin, 0.5 * Math.cos(TAU * fall * l.spin * 0.5));
        } else {
          e.set(0, l.rest, 0);
        }
        q.setFromEuler(e);
        const grow = smoothstep(0, 0.03, f) * (1 - smoothstep(0.9, 1, f));
        s.setScalar(Math.max(1e-4, grow));
        mesh.setMatrixAt(i, m.compose(p, q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
