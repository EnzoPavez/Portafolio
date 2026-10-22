import { chainShader } from './utils.js';

/* Detalle "gratis": todo lo de este archivo se dibuja en el shader, sin agregar
   triángulos ni draw calls.
   - Viento: las hojas, el pasto y las copas se mecen (atributo fx.x).
   - Patrones de material según fx.y: tejas, ladrillo, madera, revoque, piedra, hojas.
   - Montañas: grano de roca y vetas en las paredes empinadas.
   - Agua: destellos de sol que titilan. */

// uLoop = 2π·T: todas las animaciones usan frecuencias enteras para que el loop empalme.
export function detailUniforms() {
  return { uLoop: { value: 0 } };
}

const NOISE = /* glsl */ `
float dHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dHash(vec3(i, 1.0)), b = dHash(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = dHash(vec3(i + vec2(0.0, 1.0), 1.0)), d = dHash(vec3(i + vec2(1.0, 1.0), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// Varyings comunes: posición y normal en el mundo (con o sin instancias).
const WORLD_VARYINGS = 'varying vec3 vDetW;\nvarying vec3 vDetN;';
const WORLD_ASSIGN = /* glsl */ `
  #ifdef USE_INSTANCING
    vDetW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    vDetN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  #else
    vDetW = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vDetN = normalize(mat3(modelMatrix) * objectNormal);
  #endif
`;

const PATTERNS = /* glsl */ `
vec3 detailPattern(vec3 col, float patF, vec3 p, vec3 n) {
  int pat = int(patF + 0.5);
  if (pat == 0) return col;
  // Coordenada horizontal sobre la cara: x en caras que miran a ±z, z en las que miran a ±x
  float u = abs(n.x) > abs(n.z) ? p.z : p.x;
  bool top = n.y > 0.75;
  if (pat == 1) { // tejas coloniales: hileras horizontales trabadas
    float row = p.y / 0.052;
    float fr = fract(row);
    float c = fract(u / 0.072 + floor(row) * 0.5);
    float sh = 1.0 - 0.24 * smoothstep(0.55, 1.0, fr) - 0.14 * smoothstep(0.78, 1.0, abs(c * 2.0 - 1.0));
    sh *= 0.93 + 0.14 * dHash(vec3(floor(u / 0.072 + floor(row) * 0.5), floor(row), 3.0));
    return col * sh;
  }
  if (pat == 2) { // ladrillo con juntas claras
    if (top) return col * (0.92 + 0.12 * dNoise(p.xz * 18.0));
    float row = p.y / 0.045;
    float c = fract(u / 0.1 + floor(row) * 0.5);
    float mortar = max(step(0.86, fract(row)), step(0.92, c));
    vec3 brick = col * (0.93 + 0.12 * dHash(vec3(floor(u / 0.1 + floor(row) * 0.5), floor(row), 7.0)));
    return mix(brick, col * 1.25 + 0.06, mortar * 0.45);
  }
  if (pat == 3) { // madera: tablas y veta
    float a = top ? (abs(n.x) > abs(n.z) ? p.x : p.z) : u;
    float line = smoothstep(0.9, 1.0, fract(a / 0.065));
    float grain = dNoise(vec2(a * 6.0, (top ? u : p.y) * 55.0));
    return col * (0.9 + 0.16 * grain - 0.2 * line);
  }
  if (pat == 4) { // revoque: manchas suaves y suciedad cerca del piso
    float st = dNoise(vec2(u, p.y) * 3.2) * 0.6 + dNoise(vec2(u, p.y) * 11.0) * 0.4;
    float dirt = mix(0.84, 1.0, smoothstep(0.0, 0.32, p.y));
    return col * (0.93 + 0.1 * st) * dirt;
  }
  if (pat == 5) { // piedra: granulado
    return col * (0.82 + 0.3 * dHash(floor(p * 34.0)));
  }
  if (pat == 6) { // hojas: moteado de luz y sombra
    float h = dHash(floor(p * 26.0));
    return col * (0.86 + 0.26 * h) * (0.95 + 0.1 * smoothstep(0.0, 1.0, n.y));
  }
  if (pat == 7) { // chapa acanalada galvanizada: canaletas a lo largo de la caída en techos,
                  // horizontales en paredes (tanque australiano), con el moteado del zinc
    float a = top ? p.x : p.y;
    float rib = 0.5 + 0.5 * sin(a * 6.2832 / 0.055);
    float spangle = dHash(floor(p * 40.0));
    return col * (0.8 + 0.26 * rib) * (0.94 + 0.1 * spangle);
  }
  if (pat == 8) { // acero inoxidable: anillos de soldadura, paneles y cepillado vertical
    if (top) return col * (0.93 + 0.1 * dNoise(p.xz * 30.0));
    float row = p.y / 0.3;
    float fr = fract(row);
    float seam = smoothstep(0.9, 0.94, fr) * (1.0 - smoothstep(0.96, 1.0, fr));
    float panel = 0.93 + 0.1 * dHash(vec3(floor(u / 0.21), floor(row), 11.0));
    float brushed = 0.95 + 0.08 * dNoise(vec2(u * 90.0, p.y * 2.5));
    return col * panel * brushed * (1.0 - 0.3 * seam);
  }
  return col;
}
`;

// Batch estático: viento + patrones según el atributo fx.
export function applyStaticDetail(material, uniforms) {
  chainShader(material, 'detail-static', (sh) => {
    sh.uniforms.uLoop = uniforms.uLoop;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 fx;\nuniform float uLoop;\nvarying float vPat;\n${WORLD_VARYINGS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Viento: sólo se mueve lo que está por encima del piso
        float swayH = fx.x * smoothstep(0.0, 0.3, position.y);
        float ph = position.x * 0.7 + position.z * 0.45;
        transformed.x += swayH * (0.028 * sin(uLoop * 20.0 + ph) + 0.012 * sin(uLoop * 47.0 + ph * 2.3));
        transformed.z += swayH * 0.018 * sin(uLoop * 17.0 + ph * 1.3);
        vPat = fx.y;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vPat;\n${WORLD_VARYINGS}\n${NOISE}\n${PATTERNS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = detailPattern(diffuseColor.rgb, vPat, vDetW, normalize(vDetN));`);
  });
}

// Patrón fijo para un material entero (p. ej. el follaje instanciado de los álamos).
export function applyConstantPattern(material, pattern) {
  chainShader(material, `detail-const-${pattern}`, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}\n${NOISE}\n${PATTERNS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = detailPattern(diffuseColor.rgb, ${pattern.toFixed(1)}, vDetW, normalize(vDetN));`);
  });
}

// Montañas: grano de roca a dos escalas y vetas en las paredes empinadas, más marcados
// en la roca que en el pasto. Va antes que la nieve (que se mezcla encima y queda limpia).
// En la roca y la nieve, además, la normal se aplana por triángulo: facetas low-poly
// como el resto de la escena, sin agregar geometría.
export function applyMountainDetail(material) {
  chainShader(material, 'detail-mountain', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Roca o pasto según el color: el pasto es claramente verde, la roca gris
        float rockF = 1.0 - smoothstep(0.015, 0.06, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
        {
          vec3 n = normalize(vDetN);
          float steep = 1.0 - smoothstep(0.42, 0.62, n.y);
          float grain = dNoise(vDetW.xz * 2.6 + vDetW.y * 1.7) * 0.6 + dNoise(vDetW.xz * 9.0 - vDetW.y * 3.0) * 0.4;
          // Estratos sólo en paredes empinadas, ondulados y cortados en manchones
          float band = fract(vDetW.y * 1.5 + dNoise(vDetW.xz * 0.7) * 2.4 + dNoise(vDetW.xz * 2.3) * 0.5);
          float vein = smoothstep(0.7, 0.86, band) * (1.0 - smoothstep(0.86, 1.0, band));
          float patchy = smoothstep(0.5, 0.7, dNoise(vDetW.xz * 0.55 + 3.7));
          float amp = mix(0.18, 0.34, rockF);
          diffuseColor.rgb *= (1.0 - amp * 0.55 + amp * grain) * (1.0 - mix(0.12, 0.18, rockF) * vein * steep * patchy);
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(mix(normal, normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), 0.7 * rockF));`);
  });
}

// Agua: destellos de sol que aparecen y se apagan (sólo emisivo, muy barato).
export function applyWaterSparkle(material, uniforms) {
  chainShader(material, 'detail-water', (sh) => {
    sh.uniforms.uLoop = uniforms.uLoop;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLoop;\n${WORLD_VARYINGS}\n${NOISE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 cell = floor(vDetW.xz * 14.0);
          float h = dHash(vec3(cell, 5.0));
          float tw = 0.5 + 0.5 * sin(uLoop * (12.0 + floor(h * 8.0)) + h * 40.0);
          float sp = step(0.93, h) * smoothstep(0.75, 1.0, tw) * step(0.6, normalize(vDetN).y);
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.9) * sp * 0.9;
        }`);
  });
}
