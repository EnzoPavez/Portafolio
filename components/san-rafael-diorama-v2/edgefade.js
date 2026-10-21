import * as THREE from 'three';
import { EXT } from './layout.js';

/* Fundido de bordes: la escena se ve completa y el paisaje de alrededor se
   disuelve en el fondo con un contorno redondeado e irregular. Además, cerca
   de los bordes izquierdo, derecho e inferior de la pantalla todo se funde,
   así nunca queda un corte recto contra el borde del lienzo.
   Dos modos:
   - 'mix'   (suelo, montañas, agua): se funde hacia el color de fondo.
   - 'alpha' (objetos): se vuelve transparente y deja ver lo que tiene detrás. */

const GLSL = /* glsl */ `
uniform vec3 uFadeColor;
uniform vec2 uRes;
varying vec3 vEdgeWPos;
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
  const prev = material.onBeforeCompile;
  const prevKey = prev.toString();
  const apply = mode === 'mix' ? 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, edgeF);' : 'gl_FragColor.a *= 1.0 - edgeF;';
  material.onBeforeCompile = (sh, renderer) => {
    prev.call(material, sh, renderer);
    sh.uniforms.uFadeColor = uniforms.uFadeColor;
    sh.uniforms.uRes = uniforms.uRes;
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
        if (edgeF > 0.995) discard;
        ${apply}`);
  };
  material.customProgramCacheKey = () => `edgefade-${mode}|${prevKey}`;
  material.needsUpdate = true;
}

// Uniforms compartidos por todos los materiales: color de fondo (sRGB) y tamaño del lienzo.
export function edgeFadeUniforms(css = '#ffffff') {
  const s = new THREE.Color(css).convertLinearToSRGB();
  return { uFadeColor: { value: new THREE.Vector3(s.r, s.g, s.b) }, uRes: { value: new THREE.Vector2(1, 1) } };
}
