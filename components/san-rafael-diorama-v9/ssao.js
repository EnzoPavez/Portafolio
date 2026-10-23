import * as THREE from 'three';
import { chainShader } from './utils.js';

/* Oclusión ambiental en pantalla (SSAO) para la cámara ortográfica.
   Antes de dibujar la escena se hace una pasada sólo de profundidad (sin color, a la
   resolución en píxeles CSS); de ahí sale cuánto queda tapado cada punto por lo que tiene
   alrededor, y un desenfoque 4×4 que respeta los bordes le saca el ruido. Los materiales
   leen ese valor en su píxel y oscurecen la luz ambiente (y algo de la directa): rincones,
   pies de paredes y postes, entre las hileras de la viña, bajo los aleros y donde las copas
   se tocan. Lo emisivo (ventanas, lamparitas) y los resplandores no se tocan.
   La AO pintada en el suelo y por vértice sigue estando: esto suma el contacto fino. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Posición en el espacio de la cámara a partir de la profundidad (ortográfica: es lineal).
const VIEWPOS = /* glsl */ `
uniform sampler2D tDepth;
uniform vec4 uFrustum; // left, right, bottom, top
uniform vec2 uClip;    // near, far
float viewZ(vec2 uv) {
  return -mix(uClip.x, uClip.y, texture2D(tDepth, uv).x);
}
vec3 viewPos(vec2 uv) {
  return vec3(mix(uFrustum.x, uFrustum.y, uv.x), mix(uFrustum.z, uFrustum.w, uv.y), viewZ(uv));
}`;

// 12 muestras en espiral dentro de un disco de radio uRadius (en unidades del mundo).
// La espiral gira según la posición del píxel en un mosaico de 4×4: el desenfoque de
// 4×4 promedia las 16 rotaciones y queda parejo, sin ruido.
const AO_FRAG = /* glsl */ `
${VIEWPOS}
uniform vec2 uTexel;
uniform float uRadius;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.9999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  // Normal a partir de los vecinos, del lado con menos salto (no cruza siluetas)
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)), pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)), pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  vec2 px = mod(floor(gl_FragCoord.xy), 4.0);
  float cell = px.x + px.y * 4.0;
  float a0 = cell * 2.3999632 * 0.4142;
  float j = fract(cell * 0.618034);
  vec2 toUv = 1.0 / vec2(uFrustum.y - uFrustum.x, uFrustum.w - uFrustum.z);
  float R2 = uRadius * uRadius;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = a0 + fi * 2.3999632;
    float r = uRadius * sqrt((fi + j) / 12.0);
    vec3 v = viewPos(vUv + vec2(cos(a), sin(a)) * r * toUv) - P;
    float dist2 = dot(v, v);
    // Lo que está mucho más cerca de la cámara (un álamo delante del pasto) no tapa
    float fall = 1.0 - smoothstep(R2 * 0.6, R2 * 2.2, dist2);
    occ += max(0.0, dot(N, v) * inversesqrt(dist2 + 1e-5) - 0.12) * fall;
  }
  gl_FragColor = vec4(vec3(clamp(1.0 - uIntensity * occ / 12.0, 0.0, 1.0)), 1.0);
}`;

// Desenfoque 4×4 que no mezcla puntos a distinta profundidad (no deja halos en los bordes).
const BLUR_FRAG = /* glsl */ `
${VIEWPOS}
uniform sampler2D tAO;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  float zc = viewZ(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int x = -2; x < 2; x++) {
    for (int y = -2; y < 2; y++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
      float w = max(0.0, 1.0 - abs(viewZ(uv) - zc) / 0.25);
      sum += texture2D(tAO, uv).r * w;
      wsum += w;
    }
  }
  float ao = wsum > 0.0 ? sum / wsum : 1.0;
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

export class SSAO {
  constructor({ radius = 0.7, intensity = 2.4, direct = 0.75 } = {}) {
    this.enabled = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const rt = (opts = {}) => new THREE.WebGLRenderTarget(1, 1, { format: THREE.RedFormat, depthBuffer: false, ...opts });
    this.depth = rt({ depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType) });
    this.raw = rt({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.out = rt({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    // Lo que leen los materiales: tAO = resultado, k = cuánto pesa (0 apagado)
    this.uniforms = {
      tSSAO: { value: this.out.texture }, uSSAOInv: { value: new THREE.Vector2(1, 1) },
      uSSAOk: { value: 0 }, uSSAODirect: { value: direct },
    };
    const shared = {
      tDepth: { value: this.depth.depthTexture }, uFrustum: { value: new THREE.Vector4() },
      uClip: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() },
    };
    const pass = (frag, extra) => new THREE.ShaderMaterial({
      uniforms: { ...shared, ...extra }, vertexShader: VERT, fragmentShader: frag,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    this.shared = shared;
    this.aoMat = pass(AO_FRAG, { uRadius: { value: radius }, uIntensity: { value: intensity } });
    this.blurMat = pass(BLUR_FRAG, { tAO: { value: this.raw.texture } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.aoMat);
    this.quad.frustumCulled = false;
    // Pasada de profundidad: un material sin color para todo (también lo instanciado)
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.hidden = [];
  }

  // Objetos que no tapan: humo, espuma, resplandores, carteles con transparencia, sprites.
  setOccluders(scene) {
    this.hidden = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const soft = o.isSprite || o.isPoints || ms.some((m) => !m.depthWrite || m.blending !== THREE.NormalBlending || m.opacity < 1 || m.isShaderMaterial);
      if (soft) this.hidden.push(o);
    });
  }

  // Suma la AO a un material iluminado (Standard/Lambert/Phong).
  apply(material) {
    const u = this.uniforms;
    chainShader(material, 'ssao', (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tSSAO;\nuniform vec2 uSSAOInv;\nuniform float uSSAOk;\nuniform float uSSAODirect;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          {
            float ssao = mix(1.0, texture2D(tSSAO, gl_FragCoord.xy * uSSAOInv).r, uSSAOk);
            reflectedLight.indirectDiffuse *= ssao;
            reflectedLight.indirectSpecular *= ssao;
            reflectedLight.directDiffuse *= mix(1.0, ssao, uSSAODirect);
          }`);
    });
  }

  // Tamaño del lienzo (buffer de dibujo) y escala de la AO respecto de él.
  setSize(w, h, scale = 1) {
    const aw = Math.max(1, Math.round(w * scale)), ah = Math.max(1, Math.round(h * scale));
    if (this.depth.width !== aw || this.depth.height !== ah) {
      this.depth.setSize(aw, ah);
      this.raw.setSize(aw, ah);
      this.out.setSize(aw, ah);
    }
    this.shared.uTexel.value.set(1 / aw, 1 / ah);
    this.uniforms.uSSAOInv.value.set(1 / w, 1 / h);
  }

  setEnabled(on) {
    this.enabled = on;
    this.uniforms.uSSAOk.value = on ? 1 : 0;
  }

  // Llamar con las matrices de mundo al día, justo antes de dibujar la escena.
  render(renderer, scene, camera) {
    if (!this.enabled) return;
    this.shared.uFrustum.value.set(camera.left, camera.right, camera.bottom, camera.top);
    this.shared.uClip.value.set(camera.near, camera.far);
    const vis = this.hidden.map((o) => o.visible);
    this.hidden.forEach((o) => (o.visible = false));
    // La sombra del sol no hace falta para la profundidad: se calcula en la pasada normal
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.depth);
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    renderer.shadowMap.autoUpdate = autoShadow;
    this.hidden.forEach((o, i) => (o.visible = vis[i]));

    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.raw);
    renderer.render(this.quad, this.camera);
    this.quad.material = this.blurMat;
    renderer.setRenderTarget(this.out);
    renderer.render(this.quad, this.camera);
    renderer.setRenderTarget(null);
  }

  dispose() {
    this.depth.depthTexture.dispose();
    this.depth.dispose();
    this.raw.dispose();
    this.out.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    this.depthMat.dispose();
    this.quad.geometry.dispose();
  }
}
