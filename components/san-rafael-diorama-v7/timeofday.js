import * as THREE from 'three';
import { VIEW } from './layout.js';
import { softDot } from './terrain.js';
import { lerp, smoothstep } from './utils.js';

/* Día y atardecer. Las dos luces y los colores se interpolan entre dos ajustes;
   al atardecer el sol baja y se pone naranja (sombras largas), el cielo que
   rellena las sombras se vuelve lavanda y, sobre el final, se encienden las
   ventanas y el resplandor de las lamparitas, el farol y el fuego. */

const PRESETS = {
  day: {
    sky: '#eef6ff', ground: '#b39b78', hemi: 1.45,
    sun: '#fff0d8', sunI: 2.7, dir: [-0.45, 0.8, 0.42], bias: 0.028,
    fill: '#d6e4ff', fillI: 0.5, exposure: 1.04,
    water: '#0c4a55', cloud: '#ffffff', cloudI: 0.12,
  },
  // Sol bajo desde adelante a la izquierda: ilumina las caras que ve la cámara
  // y tira las sombras largas hacia el fondo.
  sunset: {
    sky: '#c4b6de', ground: '#8f6b55', hemi: 1.22,
    sun: '#ffab66', sunI: 2.7, dir: [-0.66, 0.33, 0.56], bias: 0.045,
    fill: '#7f8fd9', fillI: 0.6, exposure: 1.06,
    water: '#3a2c58', cloud: '#ffb08a', cloudI: 0.3,
  },
};

const resolve = (p) => ({
  ...p,
  sky: new THREE.Color(p.sky), ground: new THREE.Color(p.ground), sun: new THREE.Color(p.sun),
  fill: new THREE.Color(p.fill), water: new THREE.Color(p.water), cloud: new THREE.Color(p.cloud),
  dir: new THREE.Vector3(...p.dir).normalize(),
});

// Resplandores: planos mirando a cámara con suma de luz, uno por fuente.
// Se adelantan hacia la cámara para que el piso no los corte.
// Cada fuente: { p, r (radio), color, k (intensidad, 1 por defecto) }.
export function buildGlows(spots) {
  const mat = new THREE.MeshBasicMaterial({
    color: '#ffffff', alphaMap: softDot(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, spots.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(-VIEW.elevation, VIEW.azimuth, 0, 'YXZ'));
  const toCam = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach((g, i) => {
    p.copy(g.p).addScaledVector(toCam, g.r * 0.6);
    mesh.setMatrixAt(i, m.compose(p, facing, s.setScalar(g.r * 2)));
    // Con suma de luz el color es la intensidad: las lamparitas juntas no se queman a blanco
    mesh.setColorAt(i, c.set(g.color).multiplyScalar(g.k ?? 1));
  });
  return {
    mesh,
    set(k) {
      mat.opacity = 0.85 * k;
      mesh.visible = k > 0.001;
    },
  };
}

// Controla la transición. `step(dt)` avanza hacia el modo pedido y devuelve true si cambió algo.
export function timeOfDay({ hemi, sun, fill, renderer, waterMats, cloudMat, detU, cloudU, glows, duration = 1.6 }) {
  const A = resolve(PRESETS.day), B = resolve(PRESETS.sunset);
  const dir = new THREE.Vector3();
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
    // Las luces se prenden recién cuando el sol ya bajó
    const night = smoothstep(0.4, 1, k);
    detU.uNight.value = night;
    glows.set(night);
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
