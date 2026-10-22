import * as THREE from 'three';

/* Efecto miniatura (tilt-shift): la franja del medio queda nítida y el desenfoque
   crece hacia arriba y hacia abajo, como en una foto de maqueta.
   Se dibuja la escena normal en el lienzo (con su antialiasing), se copia ese
   cuadro a una textura y se desenfoca en dos pasadas (horizontal a un buffer,
   vertical de vuelta al lienzo). Los colores ya vienen en sRGB y con el alfa
   premultiplicado, así que se promedian tal cual y el borde transparente se
   funde bien con la página. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 9 muestras con pesos gaussianos (sigma = 2 muestras), separadas radio / 4.
const FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uStep;     // un píxel en la dirección de esta pasada (en uv)
uniform float uMax;     // radio máximo en píxeles
uniform float uFocus;   // centro de la franja nítida (0 abajo, 1 arriba)
uniform float uBand;    // media franja nítida
uniform float uRamp;    // distancia en la que el desenfoque llega al máximo
varying vec2 vUv;
void main() {
  float r = uMax * smoothstep(uBand, uBand + uRamp, abs(vUv.y - uFocus));
  vec4 c = texture2D(tMap, vUv);
  if (r < 0.1) {
    gl_FragColor = c;
    return;
  }
  vec2 d = uStep * r * 0.25;
  vec4 s = c * 0.2042;
  s += (texture2D(tMap, vUv + d) + texture2D(tMap, vUv - d)) * 0.1802;
  s += (texture2D(tMap, vUv + d * 2.0) + texture2D(tMap, vUv - d * 2.0)) * 0.1238;
  s += (texture2D(tMap, vUv + d * 3.0) + texture2D(tMap, vUv - d * 3.0)) * 0.0663;
  s += (texture2D(tMap, vUv + d * 4.0) + texture2D(tMap, vUv - d * 4.0)) * 0.0276;
  gl_FragColor = s;
}`;

export class TiltShift {
  constructor({ strength = 0.004, focus = 0.5, band = 0.15, ramp = 0.36 } = {}) {
    // Radio máximo como fracción del alto del lienzo: se ve igual en cualquier tamaño
    this.strength = strength;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.frame = null;
    const pass = (map) => new THREE.ShaderMaterial({
      uniforms: {
        tMap: { value: map }, uStep: { value: new THREE.Vector2() }, uMax: { value: 0 },
        uFocus: { value: focus }, uBand: { value: band }, uRamp: { value: ramp },
      },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    this.h = pass(null);
    this.v = pass(this.target.texture);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.h);
    this.quad.frustumCulled = false;
  }

  // Tamaño del buffer de dibujo (en píxeles reales).
  setSize(w, h) {
    if (!this.frame || this.frame.image.width !== w || this.frame.image.height !== h) {
      this.frame?.dispose();
      this.frame = new THREE.FramebufferTexture(w, h);
      this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
      this.h.uniforms.tMap.value = this.frame;
      this.target.setSize(w, h);
    }
    this.h.uniforms.uStep.value.set(1 / w, 0);
    this.v.uniforms.uStep.value.set(0, 1 / h);
    this.h.uniforms.uMax.value = this.v.uniforms.uMax.value = this.strength * h;
  }

  // Llamar justo después de renderer.render(scene, camera) al lienzo.
  render(renderer) {
    renderer.copyFramebufferToTexture(this.frame);
    this.quad.material = this.h;
    renderer.setRenderTarget(this.target);
    renderer.render(this.quad, this.camera);
    this.quad.material = this.v;
    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.camera);
  }

  dispose() {
    this.frame?.dispose();
    this.target.dispose();
    this.h.dispose();
    this.v.dispose();
    this.quad.geometry.dispose();
  }
}
