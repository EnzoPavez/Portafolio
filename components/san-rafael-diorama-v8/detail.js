import { chainShader } from './utils.js';

/* Detalle "gratis": todo lo de este archivo se dibuja en el shader, sin agregar
   triángulos ni draw calls.
   - Viento: las hojas, el pasto y las copas se mecen (atributo fx.x).
   - Patrones de material según fx.y: tejas, ladrillo, madera, revoque, piedra, hojas.
   - Montañas: grano de roca, vetas en las paredes empinadas y estratos en grises.
   - Pasto: manchones grandes de pasto seco y tupido (suelo y faldas de la montaña).
   - Agua: destellos de sol que titilan. */

// uLoop = 2π·T: todas las animaciones usan frecuencias enteras para que el loop empalme.
// uNight: 0 de día, 1 al atardecer (ventanas encendidas).
export function detailUniforms() {
  return { uLoop: { value: 0 }, uNight: { value: 0 } };
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

// Pasto con manchones grandes: más seco (amarillento) en unos, más tupido y oscuro en otros.
// Sólo toca lo que es claramente verde (no caminos, tierra ni roca). Usa la posición en el
// mundo, así el suelo y las faldas de la montaña empalman sin costura.
const GRASS = /* glsl */ `
vec3 grassTone(vec3 col, vec2 p) {
  float grassF = smoothstep(0.02, 0.07, col.g - max(col.r, col.b));
  // El ruido se queda cerca de 0.5: se estira para que haya manchones de verdad
  float n = (dNoise(p * 0.17 + 3.1) * 0.65 + dNoise(p * 0.47 - 1.7) * 0.35 - 0.5) * 2.6 + 0.5;
  vec3 lush = col * vec3(0.7, 0.83, 0.8);
  vec3 dry = col * vec3(1.32, 1.06, 0.6);
  vec3 t = n < 0.5 ? mix(lush, col, smoothstep(0.0, 0.5, n)) : mix(col, dry, smoothstep(0.5, 1.0, n));
  t *= 0.94 + 0.12 * dNoise(p * 1.9 + 11.0);
  return mix(col, t, grassF);
}
`;

// Estratos: capas de roca en distintos grises (claro, oscuro, pizarra, gris cálido),
// onduladas e inclinadas. Es un multiplicador sobre el gris de la roca, así conserva
// la luz, el AO y el grano.
const STRATA = /* glsl */ `
vec3 strataTint(float h) {
  if (h < 0.2) return vec3(1.2);
  if (h < 0.38) return vec3(0.8, 0.8, 0.82);
  if (h < 0.56) return vec3(0.92, 0.95, 1.02);
  if (h < 0.76) return vec3(1.08, 1.05, 1.0);
  return vec3(1.0);
}
vec3 strata(vec3 p) {
  // Capas inclinadas y plegadas (no curvas de nivel): la cota se tuerce con ruido grande
  float fold = dNoise(p.xz * 0.22 + 2.0) * 3.6 + dNoise(p.xz * 0.6 - 4.0) * 0.9 + dNoise(p.xz * 1.6 + 7.0) * 0.25;
  float sy = p.y * 1.15 + p.x * 0.13 - p.z * 0.09 + fold;
  // Espesor desparejo: unas capas anchas y otras finitas
  sy += 0.32 * sin(sy * 2.3);
  float id = floor(sy), f = fract(sy);
  vec3 a = strataTint(dHash(vec3(id, 4.0, 1.0))), b = strataTint(dHash(vec3(id + 1.0, 4.0, 1.0)));
  vec3 t = mix(a, b, smoothstep(0.82, 0.96, f));
  // Laminado fino dentro de cada capa y una línea más oscura en el borde
  t *= 0.97 + 0.06 * smoothstep(0.35, 0.65, fract(sy * 4.0 + id * 0.37));
  return t * (1.0 - 0.1 * smoothstep(0.93, 0.97, f) * (1.0 - smoothstep(0.97, 1.0, f)));
}
`;

// Suelo (escena y alrededores): manchones de pasto, y en las paredes de la garganta
// los mismos estratos que la montaña (es el Cañón del Atuel).
export function applyGroundDetail(material) {
  chainShader(material, 'detail-ground', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}\n${NOISE}\n${GRASS}\n${STRATA}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = grassTone(diffuseColor.rgb, vDetW.xz);
        diffuseColor.rgb *= mix(vec3(1.0), strata(vDetW), 0.85 * (1.0 - smoothstep(0.55, 0.85, normalize(vDetN).y)));`);
  });
}

// Batch estático: viento + patrones según el atributo fx + ventanas que se encienden.
export function applyStaticDetail(material, uniforms) {
  chainShader(material, 'detail-static', (sh) => {
    sh.uniforms.uLoop = uniforms.uLoop;
    sh.uniforms.uNight = uniforms.uNight;
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
      .replace('#include <common>', `#include <common>\nuniform float uNight;\nvarying float vPat;\n${WORLD_VARYINGS}\n${NOISE}\n${PATTERNS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = detailPattern(diffuseColor.rgb, vPat, vDetW, normalize(vDetN));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Luz cálida de adentro
        if (abs(vPat - 9.0) < 0.5) totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * uNight * 1.3;`);
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
// en la roca que en el pasto, y los estratos en grises (más marcados en las paredes).
// Va antes que la nieve (que se mezcla encima y queda limpia).
// En la roca y la nieve, además, la normal se aplana por triángulo: facetas low-poly
// como el resto de la escena, sin agregar geometría.
export function applyMountainDetail(material) {
  chainShader(material, 'detail-mountain', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}\n${NOISE}\n${GRASS}\n${STRATA}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Roca o pasto según el color: el pasto es claramente verde, la roca gris
        float rockF = 1.0 - smoothstep(0.015, 0.06, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
        diffuseColor.rgb = grassTone(diffuseColor.rgb, vDetW.xz);
        {
          vec3 n = normalize(vDetN);
          float steep = 1.0 - smoothstep(0.42, 0.62, n.y);
          diffuseColor.rgb *= mix(vec3(1.0), strata(vDetW), rockF * mix(0.6, 1.0, steep));
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

// Agua: destellos de sol que aparecen y se apagan (sólo emisivo, muy barato) y una
// línea de espuma cortada contra las orillas que late con la corriente.
export function applyWaterSparkle(material, uniforms) {
  chainShader(material, 'detail-water', (sh) => {
    sh.uniforms.uLoop = uniforms.uLoop;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_ASSIGN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLoop;\n${WORLD_VARYINGS}\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_MAP
        {
          // vMapUv.x cruza el cauce de orilla a orilla (la textura sólo corre en y)
          float edge = min(vMapUv.x, 1.0 - vMapUv.x);
          float k = dNoise(vDetW.xz * 2.2);
          float w = 0.07 + 0.03 * sin(uLoop * 9.0 + k * 14.0);
          float broken = smoothstep(0.3, 0.55, dNoise(vDetW.xz * 6.0 + 4.0));
          float foam = (1.0 - smoothstep(w * 0.5, w, edge)) * broken * step(0.6, abs(normalize(vDetN).y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 0.98), foam * 0.75);
        }
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 q = vDetW.xz * 14.0;
          vec2 cell = floor(q);
          float h = dHash(vec3(cell, 5.0));
          float tw = 0.5 + 0.5 * sin(uLoop * (12.0 + floor(h * 8.0)) + h * 40.0);
          // Punto redondo dentro de la celda (no el cuadradito entero)
          float dotm = 1.0 - smoothstep(0.16, 0.32, length(fract(q) - 0.5));
          // abs: la cinta del río tiene la normal hacia abajo (se ve por DoubleSide)
          float sp = step(0.945, h) * smoothstep(0.75, 1.0, tw) * dotm * step(0.6, abs(normalize(vDetN).y));
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.9) * sp * 0.9;
        }`);
  });
}
