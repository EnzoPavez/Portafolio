import * as THREE from 'three';
import { EXT } from './layout.js';
import { chainShader } from './utils.js';

/* Fundido de bordes: la escena se ve completa y el paisaje de alrededor se
   disuelve en el fondo con un contorno redondeado e irregular. Además, cerca
   de los bordes izquierdo, derecho e inferior de la pantalla todo se funde,
   así nunca queda un corte recto contra el borde del lienzo.
   Dos modos:
   - 'mix'   (suelo, montañas, agua): se funde hacia el color de fondo.
   - 'alpha' (objetos): se vuelve transparente y deja ver lo que tiene detrás.
   v9: detrás de las cumbres puede haber un cielo (una mancha de color que se apaga
   antes de llegar a los bordes del lienzo). Lo que se funde va hacia el fondo que
   realmente queda atrás: la página mezclada con ese cielo, así no quedan manchas
   blancas recortadas contra el atardecer. */

// El cielo en pantalla (en sRGB, como la página): centro y radios en píxeles del lienzo.
const SKY = /* glsl */ `
uniform vec3 uSkyLow;
uniform vec3 uSkyTop;
uniform float uSkyK;
uniform vec4 uSkyGeo;
vec4 dioramaSky(vec2 fc) {
  vec2 d = (fc - uSkyGeo.xy) / uSkyGeo.zw;
  float a = smoothstep(1.0, 0.15, length(d));
  // Se apaga antes de los bordes del lienzo (arriba y a los costados)
  float m = min(uRes.x, uRes.y);
  float e = min(min(fc.x, uRes.x - fc.x), uRes.y - fc.y) / m;
  a *= smoothstep(0.0, 0.14, e);
  vec3 c = mix(uSkyLow, uSkyTop, smoothstep(-0.5, 0.7, d.y));
  return vec4(c, a * uSkyK);
}
vec3 dioramaBackdrop(vec2 fc) {
  vec4 s = dioramaSky(fc);
  return mix(uFadeColor, s.rgb, s.a);
}
`;

const GLSL = /* glsl */ `
uniform vec3 uFadeColor;
uniform vec2 uRes;
varying vec3 vEdgeWPos;
${SKY}
float dioramaEdgeFade(vec3 p) {
  vec2 q = abs(p.xz) / vec2(${(EXT.W / 2).toFixed(2)}, ${(EXT.D / 2).toFixed(2)});
  float r = pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25);
  float ang = atan(p.z, p.x);
  r += 0.03 * sin(ang * 5.0 + 1.3) + 0.022 * sin(ang * 9.0 + 4.1) + 0.018 * sin(p.x * 0.9 + p.z * 0.7);
  float f = smoothstep(0.8, 0.985, r);
  f = max(f, smoothstep(0.95, 0.997, max(q.x, q.y)));
  // Bordes del lienzo (no el de arriba: ahí están las cumbres y el cielo)
  float m = min(uRes.x, uRes.y);
  float d = min(min(gl_FragCoord.x, uRes.x - gl_FragCoord.x), gl_FragCoord.y) / m;
  return max(f, 1.0 - smoothstep(0.0, 0.05, d));
}
`;

export function applyEdgeFade(material, uniforms, mode = 'alpha') {
  if (material.userData.edgeFade || material.isSpriteMaterial) return;
  material.userData.edgeFade = mode;
  material.userData.wasTransparent = material.transparent;
  if (mode === 'alpha') material.transparent = true;
  // 'alpha': los objetos se empañan hacia el fondo y se desvanecen en una franja corta,
  // así se pierden parejo en la bruma en vez de quedar como siluetas translúcidas.
  const apply = mode === 'mix'
    ? `if (edgeF > 0.995) discard;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, dioramaBackdrop(gl_FragCoord.xy), edgeF);`
    : `float edgeA = 1.0 - smoothstep(0.15, 0.8, edgeF);
        if (edgeA < 0.01) discard;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, dioramaBackdrop(gl_FragCoord.xy), edgeF * 0.6);
        gl_FragColor.a *= edgeA;`;
  chainShader(material, `edgefade-${mode}`, (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vEdgeWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vEdgeWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float edgeF = dioramaEdgeFade(vEdgeWPos);
        ${apply}`);
  });
}

const srgb = (css) => {
  const s = new THREE.Color(css).convertLinearToSRGB();
  return new THREE.Vector3(s.r, s.g, s.b);
};

// Uniforms compartidos por todos los materiales: color de fondo (sRGB), tamaño del lienzo
// y el cielo (colores, intensidad 0..1 y ubicación en pantalla; los maneja timeofday.js).
export function edgeFadeUniforms(css = '#ffffff') {
  return {
    uFadeColor: { value: srgb(css) }, uRes: { value: new THREE.Vector2(1, 1) },
    uSkyLow: { value: new THREE.Vector3(1, 1, 1) }, uSkyTop: { value: new THREE.Vector3(1, 1, 1) },
    uSkyK: { value: 0 }, uSkyGeo: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
}

// Cielo detrás de las montañas: un cuadro a pantalla completa que se dibuja antes que todo
// (sin profundidad) y se compone con el alfa del lienzo sobre la página.
export function buildSky(uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform vec3 uFadeColor;\nuniform vec2 uRes;\n${SKY}
      void main() {
        vec4 s = dioramaSky(gl_FragCoord.xy);
        if (s.a < 0.002) discard;
        gl_FragColor = s;
      }`,
    depthTest: false, depthWrite: false,
    // Opaco para three (va primero, con renderOrder), pero mezclado con el alfa del lienzo
    transparent: false, blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  mat.userData.edgeFade = 'none';
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}
