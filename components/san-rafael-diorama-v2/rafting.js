import * as THREE from 'three';
import { TAU, lerp, smoothstep, wave, VC_FLAT } from './utils.js';
import { ROAD, GORGE, riverCurve, RIVER_SAMPLES } from './layout.js';
import { makePerson, sit, SKINS } from './actors.js';

/* Rafting en el Atuel: un gomón baja del fondo del cañón, se agacha al pasar
   bajo el puente, cae por la cascada a la garganta con los brazos (y los
   remos) en alto y sigue remando hasta perderse en la bruma. */

const WATER_Y = 0.045;
// Fases dentro del loop: río alto → caída → garganta → (oculto)
const RIVER_END = 0.68;
const FALL_END = 0.72;
const GORGE_END = 0.985;
const LOW_Y = -GORGE.depth + 0.05;

export function buildRaft() {
  const group = new THREE.Group();
  const raft = new THREE.Group();
  group.add(raft);

  // Entra recortado por el borde trasero, como si viniera de más arriba del cañón.
  const clip = [];
  const mats = [];
  const m = (color, extra = {}) => {
    const mm = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, transparent: true, clippingPlanes: clip, ...extra });
    mats.push(mm);
    return mm;
  };
  const people = VC_FLAT.clone();
  Object.assign(people, { transparent: true, clippingPlanes: clip });
  mats.push(people);

  const add = (parent, geo, mat, pos, rot) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(...pos);
    if (rot) o.rotation.set(...rot);
    o.castShadow = true;
    parent.add(o);
    return o;
  };

  // Gomón: tubo perimetral, piso y bancadas
  const tube = add(raft, new THREE.TorusGeometry(0.3, 0.068, 10, 28).rotateX(Math.PI / 2), m('#e8452c', { roughness: 0.45 }), [0, 0.07, 0]);
  tube.scale.set(0.95, 1, 1.95);
  add(raft, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 20), m('#33383d'), [0, 0.03, 0]).scale.set(0.95, 1, 1.95);
  for (const z of [-0.18, 0.22]) add(raft, new THREE.CylinderGeometry(0.045, 0.045, 0.56, 10).rotateZ(Math.PI / 2), m('#e8452c', { roughness: 0.45 }), [0, 0.07, z]);
  add(raft, new THREE.SphereGeometry(0.03, 8, 6), m('#f2c230'), [0, 0.13, 0.6]);
  const foam = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes: clip })
  );
  foam.scale.set(1, 1, 1.9);
  foam.position.y = 0.006;
  mats.push(foam.material);
  raft.add(foam);

  // Tripulación: 4 remeros con casco y chaleco + guía atrás
  const paddleGeo = new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(0, -0.21, 0);
  const bladeGeo = new THREE.BoxGeometry(0.008, 0.11, 0.06).translate(0, -0.42, 0);
  const paddleMat = m('#2b2b2e'), bladeMat = m('#f2c230');
  const crew = [
    { x: 0.21, z: 0.32, vest: '#ff8a1f', helmet: '#e63b2e', ph: 0 },
    { x: -0.21, z: 0.32, vest: '#f6c445', helmet: '#3d7dd8', ph: 0.5 },
    { x: 0.21, z: -0.08, vest: '#f6c445', helmet: '#2bb3a3', ph: 0.08 },
    { x: -0.21, z: -0.08, vest: '#ff8a1f', helmet: '#f2f2f2', ph: 0.58 },
    { x: 0, z: -0.5, vest: '#e94f37', helmet: '#f6c445', ph: 0.25, guide: true },
  ].map((c, i) => {
    const p = makePerson({ shirt: c.vest, pants: '#22313f', skin: SKINS[(i + 1) % 4], hat: 'helmet', hatColor: c.helmet, m: people, scale: 1.05 });
    sit(p, 0.13, 1.05);
    const baseY = p.root.position.y;
    p.root.position.x = c.x;
    p.root.position.z = c.z;
    const side = c.guide ? 1 : Math.sign(c.x);
    const paddle = new THREE.Group();
    paddle.position.set(side * 0.16, 0.2, 0.04);
    add(paddle, paddleGeo, paddleMat, [0, 0, 0]);
    add(paddle, bladeGeo, bladeMat, [0, 0, 0]);
    paddle.rotation.z = side * 0.55;
    p.upper.add(paddle);
    raft.add(p.root);
    return { ...c, p, paddle, side, baseY };
  });

  const L = riverCurve.getLength();
  const N = RIVER_SAMPLES.length - 1;
  const arcAtZ = (z) => (RIVER_SAMPLES.findIndex((p) => p.z >= z) / N) * L;
  const sStart = arcAtZ(-15.5), sLip = arcAtZ(GORGE.z0), sLand = arcAtZ(GORGE.z1 + 0.05), sEnd = arcAtZ(19.8);
  const lip = riverCurve.getPointAt(sLip / L), land = riverCurve.getPointAt(sLand / L);
  const pos = new THREE.Vector3(), tan = new THREE.Vector3();
  const along = (s, y, T, rapids) => {
    const u = Math.min(1, Math.max(0, s / L));
    riverCurve.getPointAt(u, pos);
    riverCurve.getTangentAt(u, tan);
    raft.position.set(pos.x, y + 0.012 * rapids * wave(T, 37), pos.z);
    raft.rotation.set(0.035 * rapids * wave(T, 23, 0.2), Math.atan2(tan.x, tan.z) + 0.08 * wave(T, 5), 0.045 * rapids * wave(T, 29, 0.4));
  };

  return {
    group,
    update(T) {
      if (T >= GORGE_END) {
        group.visible = false;
        return;
      }
      group.visible = true;
      let excite = 0, duck = 0, splash = 0;
      if (T < RIVER_END) {
        // Río alto: desde la bruma del fondo hasta el borde de la cascada
        const s = lerp(sStart, sLip, T / RIVER_END);
        along(s, WATER_Y, T, pos.z < -4 ? 1.6 : 1);
        duck = smoothstep(1.85, 1.3, Math.abs(pos.z - ROAD.z));
        // Al acercarse al borde ya levantan los brazos
        excite = smoothstep(sLip - 2.6, sLip - 0.4, s);
      } else if (T < FALL_END) {
        // Caída por la cascada hasta el fondo de la garganta
        const f = (T - RIVER_END) / (FALL_END - RIVER_END);
        raft.position.set(lerp(lip.x, land.x, f), lerp(WATER_Y, LOW_Y, f * f), lerp(lip.z, land.z, f) + 0.12 * Math.sin(Math.PI * f));
        raft.rotation.set(1.1 * Math.sin(Math.PI * f), Math.atan2(land.x - lip.x, land.z - lip.z), 0.12 * Math.sin(f * 6));
        excite = 1;
      } else {
        // Garganta: rebote al caer, festejo y vuelven a remar hasta perderse en la bruma
        const f = (T - FALL_END) / (GORGE_END - FALL_END);
        along(lerp(sLand, sEnd, f), LOW_Y, T, 1.2);
        splash = 1 - smoothstep(0, 0.12, f);
        raft.position.y += 0.05 * Math.sin(f * 60) * splash;
        excite = 1 - smoothstep(0.08, 0.3, f);
      }
      foam.scale.set(1 + 0.8 * splash, 1, 1.9 * (1 + 0.5 * splash));
      for (const mm of mats) if (mm === foam.material) mm.opacity = 0.35 * (1 - excite) + 0.5 * splash;

      for (const c of crew) {
        const stroke = Math.sin(TAU * (T * 34 + c.ph));
        const row = 1 - duck;
        c.p.upper.rotation.x = lerp(0.18 + 0.12 * stroke * row, 1.45, duck) - 0.3 * excite;
        c.p.head.rotation.x = 0.4 * duck;
        c.p.root.position.y = c.baseY - 0.04 * duck;
        // Brazos en V y remos apuntando al cielo al caer
        const cheer = 0.12 * Math.sin(TAU * T * 40 + c.ph * 6) * excite;
        if (c.guide) {
          c.paddle.rotation.x = lerp(0.4 + 0.2 * Math.sin(TAU * T * 9) * row, Math.PI * 0.92, excite);
          c.p.armL.rotation.x = c.p.armR.rotation.x = lerp(-0.9, -2.95, excite) + cheer;
        } else {
          c.paddle.rotation.x = lerp(0.2 + 0.75 * stroke * row, Math.PI * 0.92, excite);
          c.p.armL.rotation.x = c.p.armR.rotation.x = lerp(-1.0 - 0.45 * stroke * row, -2.95, excite) + cheer;
        }
        c.p.armL.rotation.z = -0.42 * excite;
        c.p.armR.rotation.z = 0.42 * excite;
        c.p.head.rotation.x -= 0.35 * excite;
        c.paddle.visible = duck < 0.6;
      }
    },
  };
}
