import * as THREE from 'three';
import { VIEW } from './layout.js';
import { softDot } from './terrain.js';
import { lerp, smoothstep } from './utils.js';

/* Día y atardecer. Las dos luces y los colores se interpolan entre dos ajustes;
   al atardecer el sol baja y se pone naranja (sombras largas), el cielo que
   rellena las sombras se vuelve lavanda y, sobre el final, se encienden las
   ventanas y el resplandor de las lamparitas, el farol y el fuego.
   v9: detrás de las cumbres aparece el cielo del atardecer (rosado abajo, lavanda
   arriba, el "cinturón de Venus" del lado opuesto al sol). */

const PRESETS = {
  day: {
    sky: '#eef6ff', ground: '#b39b78', hemi: 1.45,
    sun: '#fff0d8', sunI: 2.7, dir: [-0.45, 0.8, 0.42], bias: 0.028,
    fill: '#d6e4ff', fillI: 0.5, exposure: 1.04,
    water: '#0c4a55', cloud: '#ffffff', cloudI: 0.12,
    skyLow: '#e4eff8', skyTop: '#d2e4f4', skyK: 0.55,
  },
  // Sol bajo desde adelante a la izquierda: ilumina las caras que ve la cámara
  // y tira las sombras largas hacia el fondo.
  sunset: {
    sky: '#c4b6de', ground: '#8f6b55', hemi: 1.22,
    sun: '#ffab66', sunI: 2.7, dir: [-0.66, 0.33, 0.56], bias: 0.045,
    fill: '#7f8fd9', fillI: 0.6, exposure: 1.06,
    water: '#3a2c58', cloud: '#ffb08a', cloudI: 0.3,
    skyLow: '#f7b8a0', skyTop: '#a7a3d9', skyK: 0.9,
  },
};

const resolve = (p) => ({
  ...p,
  sky: new THREE.Color(p.sky), ground: new THREE.Color(p.ground), sun: new THREE.Color(p.sun),
  fill: new THREE.Color(p.fill), water: new THREE.Color(p.water), cloud: new THREE.Color(p.cloud),
  dir: new THREE.Vector3(...p.dir).normalize(),
  // El cielo se compone en sRGB, como la página
  skyLow: new THREE.Color(p.skyLow).convertLinearToSRGB(), skyTop: new THREE.Color(p.skyTop).convertLinearToSRGB(),
});

const FACING = new THREE.Quaternion().setFromEuler(new THREE.Euler(-VIEW.elevation, VIEW.azimuth, 0, 'YXZ'));
const TO_CAM = new THREE.Vector3(0, 0, 1).applyQuaternion(FACING);
const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const shown = (n) => {
  for (let o = n; o; o = o.parent) if (!o.visible) return false;
  return true;
};

// Fuente pegada a algo que se mueve (vehículos): la posición sale de su matriz de mundo
// y se apaga cuando el objeto está oculto. `dir` (local) orienta la mancha del piso hacia
// adelante; `blink(T)` la hace titilar (0..1).
export function attached(node, offset, spot) {
  const o = new THREE.Vector3(...offset), d = spot.dir ? new THREE.Vector3(...spot.dir) : null;
  return {
    ...spot,
    at(T, out, rot) {
      if (!shown(node)) return 0;
      out.copy(o).applyMatrix4(node.matrixWorld);
      if (d) {
        _d.copy(d).transformDirection(node.matrixWorld);
        rot.yaw = Math.atan2(-_d.z, _d.x);
      }
      return spot.blink ? spot.blink(T) : 1;
    },
  };
}

// Resplandores con suma de luz, en dos capas instanciadas:
// - halos: planos mirando a cámara, adelantados para que el piso no los corte;
// - manchas (flat): la luz que cae al piso, acostada y orientada (faros, faroles).
// Cada fuente: { p | at(T, out, rot) → intensidad, r (radio), color, k (intensidad),
//   flat, sx/sz (largo y ancho de la mancha), yaw }.
// Con suma de luz el color es la intensidad: así las lamparitas juntas no se queman a blanco.
export function buildGlows(spots) {
  const group = new THREE.Group();
  const dot = softDot();
  const layers = [false, true].map((flat) => {
    const list = spots.filter((s) => !!s.flat === flat);
    list.forEach((s) => (s.rgb = new THREE.Color(s.color).multiplyScalar(s.k ?? 1)));
    const geo = new THREE.PlaneGeometry(1, 1);
    if (flat) geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff', alphaMap: dot, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: flat, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.count = list.length;
    mesh.frustumCulled = false;
    mesh.renderOrder = flat ? 5 : 6;
    mesh.visible = false;
    group.add(mesh);
    return { list, mesh, mat, flat, peak: flat ? 0.8 : 0.85, moving: list.some((s) => s.at) };
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), rot = { yaw: 0 };
  const place = (L, i, g, T) => {
    rot.yaw = g.yaw ?? 0;
    let f = 1;
    if (g.at) f = g.at(T, p, rot);
    else p.copy(g.p);
    if (f <= 0) {
      L.mesh.setMatrixAt(i, zero);
      return;
    }
    if (L.flat) {
      q.setFromAxisAngle(UP, rot.yaw);
      s.set(g.sx ?? g.r * 2, 1, g.sz ?? g.r * 2);
      p.y += 0.02;
    } else {
      q.copy(FACING);
      s.setScalar(g.r * 2);
      p.addScaledVector(TO_CAM, g.r * 0.6);
    }
    L.mesh.setMatrixAt(i, m.compose(p, q, s));
    L.mesh.setColorAt(i, c.copy(g.rgb).multiplyScalar(f));
  };
  for (const L of layers) L.list.forEach((g, i) => place(L, i, g, 0));
  let night = 0;
  return {
    group,
    set(k) {
      night = k;
      for (const L of layers) {
        L.mat.opacity = L.peak * k;
        L.mesh.visible = k > 0.001 && L.list.length > 0;
      }
    },
    // Mueve las que siguen a vehículos o vuelan (llamar con las matrices de mundo al día)
    update(T) {
      if (night <= 0.001) return;
      for (const L of layers) {
        if (!L.moving) continue;
        L.list.forEach((g, i) => g.at && place(L, i, g, T));
        L.mesh.instanceMatrix.needsUpdate = true;
        L.mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}

// Controla la transición. `step(dt)` avanza hacia el modo pedido y devuelve true si cambió algo.
// nightMats: materiales con userData.night = { base, add } (faros, lamparitas, el cartel):
// su emissiveIntensity va de base (día) a base + add (atardecer).
// skyU: uniforms del cielo de fondo (edgeFadeUniforms).
export function timeOfDay({ hemi, sun, fill, renderer, waterMats, cloudMat, detU, cloudU, glows, skyU, nightMats = [], duration = 1.6 }) {
  const A = resolve(PRESETS.day), B = resolve(PRESETS.sunset);
  const dir = new THREE.Vector3(), sc = new THREE.Color();
  let k = 0, target = 0;

  function apply() {
    const e = smoothstep(0, 1, k);
    hemi.color.lerpColors(A.sky, B.sky, e);
    hemi.groundColor.lerpColors(A.ground, B.ground, e);
    hemi.intensity = lerp(A.hemi, B.hemi, e);
    sun.color.lerpColors(A.sun, B.sun, e);
    sun.intensity = lerp(A.sunI, B.sunI, e);
    dir.lerpVectors(A.dir, B.dir, e).normalize();
    sun.position.copy(dir).multiplyScalar(50);
    sun.updateMatrixWorld();
    sun.shadow.normalBias = lerp(A.bias, B.bias, e);
    cloudU.uSunDir.value.copy(dir);
    fill.color.lerpColors(A.fill, B.fill, e);
    fill.intensity = lerp(A.fillI, B.fillI, e);
    renderer.toneMappingExposure = lerp(A.exposure, B.exposure, e);
    for (const m of waterMats) m.emissive.lerpColors(A.water, B.water, e);
    cloudMat.emissive.lerpColors(A.cloud, B.cloud, e);
    cloudMat.emissiveIntensity = lerp(A.cloudI, B.cloudI, e);
    sc.lerpColors(A.skyLow, B.skyLow, e);
    skyU.uSkyLow.value.set(sc.r, sc.g, sc.b);
    sc.lerpColors(A.skyTop, B.skyTop, e);
    skyU.uSkyTop.value.set(sc.r, sc.g, sc.b);
    skyU.uSkyK.value = lerp(A.skyK, B.skyK, e);
    // Las luces se prenden recién cuando el sol ya bajó
    const night = smoothstep(0.4, 1, k);
    detU.uNight.value = night;
    glows.set(night);
    for (const m of nightMats) m.emissiveIntensity = m.userData.night.base + m.userData.night.add * night;
  }
  apply();

  return {
    get value() {
      return target ? 'sunset' : 'day';
    },
    set(name, instant = false) {
      target = name === 'sunset' ? 1 : 0;
      if (instant) {
        k = target;
        apply();
      }
    },
    step(dt) {
      if (k === target) return false;
      k = target > k ? Math.min(target, k + dt / duration) : Math.max(target, k - dt / duration);
      apply();
      return true;
    },
  };
}
