// Bolas de papel tiradas por la página. Al pasar el mouse una se abre y muestra
// lo que tenía (una nota, una foto) y al salir se vuelve a arrugar. No llevan
// ningún texto que las explique.
//
// Uso
//   <span data-papel="nota-supabase" style="left: 8%; top: 420px"></span>
//   import { montarBolasDePapel } from './bolas-de-papel.js';
//   montarBolasDePapel({ acabado: 'suave' });
//
// Cada [data-papel] es el centro de una bola y su valor es un id de papeles/lista.json.
// La página que las usa decide dónde va cada una (left/top) y necesita el import map de three.
//
// Todas las bolas comparten un solo WebGL fuera de pantalla. Cada una tiene su canvas 2D
// y solo se vuelve a dibujar mientras se mueve, así que quietas no gastan nada.

import * as THREE from 'three';
import { crearForma } from './forma.js';
import { cargarLetra, dibujarPapel } from './contenido.js';
import { generador, semillaDe } from './ruido.js';

const LISTA = new URL('./papeles/lista.json', import.meta.url);
const MARGEN = 1.07; // lado del lienzo respecto de la diagonal de la hoja, para que quepan el giro y la inclinación
const LUZ = new THREE.Vector3(-0.45, 0.55, 0.7).normalize(); // de arriba a la izquierda, como en la referencia

// Tres acabados para el mismo papel.
//   papel    como papel de verdad. Grano, sombras cálidas y la bola con todo su color.
//   suave    más cerca de la página. Blanco neutro, poco contraste, sombra gris fina como
//            las tarjetas, y la bola cerrada casi en blanco (el contenido aparece al abrirse).
//   facetas  low-poly. Caras planas grandes, en la línea del diorama, y la hoja abierta lisa.
export const ACABADOS = {
  papel: {
    radio: 32, paso: 2.7, facetas: false, limpio: false, calido: 1,
    ambiente: 0.42, oclusion: 1, brillo: 1, velo: 0,
    pliegues: { fino: 1, grueso: 1, abierta: 1 }, sombra: 'calida',
  },
  suave: {
    radio: 32, paso: 2.7, facetas: false, limpio: true, calido: 0,
    ambiente: 0.64, oclusion: 0.55, brillo: 0.35, velo: 0.72,
    pliegues: { fino: 0.7, grueso: 0.9, abierta: 0.4 }, sombra: 'fina',
  },
  facetas: {
    radio: 32, paso: 9, facetas: true, limpio: true, calido: 0,
    ambiente: 0.6, oclusion: 0.4, brillo: 0, velo: 0.6,
    pliegues: { fino: 0.55, grueso: 1.15, abierta: 0 }, sombra: 'fina',
  },
};

const VERTICE = /* glsl */ `
  attribute float aSombra;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  varying float vSombra;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 pos = modelViewMatrix * vec4(position, 1.0);
    vPos = pos.xyz;
    vSombra = aSombra;
    gl_Position = projectionMatrix * pos;
  }
`;

const FRAGMENTO = /* glsl */ `
  uniform sampler2D mapa;
  uniform vec3 luz;
  uniform vec3 dorso;
  uniform vec3 tono;
  uniform float revelado;
  uniform float ambiente;
  uniform float oclusion;
  uniform float calido;
  uniform float brillo;
  uniform float tinte;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  varying float vSombra;
  void main() {
    #ifdef FACETAS
      // Normal de cada cara, sin suavizar entre vecinas. Siempre mira a la cámara.
      vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    #else
      vec3 n = normalize(vNormal);
      if (!gl_FrontFacing) n = -n;
    #endif
    // En la bola cerrada el contenido se apaga hacia el color del papel.
    vec3 base = gl_FrontFacing ? mix(tono, texture2D(mapa, vUv).rgb, revelado) : dorso;
    // Ambiente + luz directa, medidas para que la hoja plana quede con su color real.
    float d = max(dot(n, luz), 0.0);
    float l = ambiente + (1.0 - ambiente) * d / luz.z;
    float sombra = mix(1.0, vSombra, oclusion);
    // En el acabado papel las sombras tiran a cálido. En gris frío parece papel de aluminio.
    vec3 color = mix(mix(vec3(1.0), vec3(0.9, 0.86, 0.8), calido), vec3(1.0), clamp(l * sombra, 0.0, 1.0));
    vec3 h = normalize(luz + vec3(0.0, 0.0, 1.0));
    float s = pow(max(dot(n, h), 0.0), 36.0) * brillo;
    gl_FragColor = vec4((base * l * sombra * color + s) * tinte, 1.0);
  }
`;

const ESTILOS = `
  .bola-de-papel { position: absolute; width: 0; height: 0; z-index: 2; }
  .bola-de-papel--abierta { z-index: 30; }
  .bola-de-papel__dibujo, .bola-de-papel__toque { position: absolute; left: 0; top: 0; translate: -50% -50%; }
  .bola-de-papel__dibujo { pointer-events: none; }
  .bola-de-papel__toque {
    margin: 0; padding: 0; border: 0; background: none; border-radius: 50%;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  .bola-de-papel--abierta .bola-de-papel__toque { border-radius: 4px; }
  .bola-de-papel__toque:focus { outline: none; }
  .bola-de-papel__toque:focus-visible { outline: 2px solid var(--foco, #8d8d8d); outline-offset: 6px; }
`;

const suave = (t) => t * t * (3 - 2 * t);
const mezcla = (a, b, t) => a + (b - a) * t;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const tramo = (a, b, t) => suave(limitar((t - a) / (b - a), 0, 1));

const oscuro = window.matchMedia('(prefers-color-scheme: dark)');
const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');

let motor = null;
function obtenerMotor() {
  if (motor !== null) return motor;
  try {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);
    const camara = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
    camara.position.z = 2000;
    motor = { renderer, camara, lado: 0 };
  } catch {
    motor = false;
  }
  return motor;
}

// Un solo bucle para todas las bolas que se están moviendo.
const activas = new Set();
let cuadro = 0;
let ultimo = 0;
function bucle(t) {
  const dt = Math.min(0.05, Math.max(0.001, (t - ultimo) / 1000));
  ultimo = t;
  for (const bola of activas) {
    const sigue = bola.paso(dt);
    bola.dibujar();
    if (!sigue) activas.delete(bola);
  }
  cuadro = activas.size ? requestAnimationFrame(bucle) : 0;
}
function despertar(bola) {
  activas.add(bola);
  if (!cuadro) {
    ultimo = performance.now();
    cuadro = requestAnimationFrame(bucle);
  }
}

// Sombra en CSS sobre el lienzo. "alto" es cuánto se despegó la hoja del piso (0 a ~1.3).
function sombraCalida(e, alto) {
  const tono = oscuro.matches ? '0, 0, 0' : '70, 52, 32';
  const fuerza = oscuro.matches ? 1.9 : 1;
  return `drop-shadow(0 1px 1px rgba(${tono}, ${(0.22 * (1 - 0.6 * e) * fuerza).toFixed(3)})) ` +
    `drop-shadow(${(2 + 5 * alto).toFixed(1)}px ${(4 + 9 * alto).toFixed(1)}px ${(4 + 9 * alto).toFixed(1)}px ` +
    `rgba(${tono}, ${((0.26 - 0.08 * alto) * fuerza).toFixed(3)}))`;
}

// Como la sombra de las tarjetas de la página: un borde casi invisible y una caída corta hacia abajo.
function sombraFina(e, alto) {
  const fuerza = oscuro.matches ? 3 : 1;
  return `drop-shadow(0 0 0.6px rgba(0, 0, 0, ${(0.16 * fuerza).toFixed(3)})) ` +
    `drop-shadow(0 ${(1.5 + 7 * alto).toFixed(1)}px ${(3 + 12 * alto).toFixed(1)}px ` +
    `rgba(0, 0, 0, ${((0.09 - 0.025 * alto) * fuerza).toFixed(3)}))`;
}

class Bola {
  constructor(ancla, papel, hoja, acabado) {
    this.ancla = ancla;
    this.acabado = acabado;
    this.ancho = hoja.ancho;
    this.alto = hoja.alto;
    this.p = 0;
    this.v = 0;
    this.objetivo = 0;
    this.modo = null;
    this.corrimiento = 0;

    const semilla = semillaDe(papel.id);
    const azar = generador(semilla ^ 0x5bd1e995);
    this.giroBola = (azar() * 2 - 1) * 0.6;
    this.giroAbierta = (azar() * 2 - 1) * 0.04;
    this.vuelta = (azar() < 0.5 ? -1 : 1) * (0.16 + azar() * 0.12);
    this.ejeInclinacion = azar() * Math.PI * 2;
    this.inclinacion = 0.26 + azar() * 0.14;
    this.radio = acabado.radio * (0.92 + azar() * 0.16);

    this.forma = crearForma({
      ancho: hoja.ancho, alto: hoja.alto, radio: this.radio, semilla,
      paso: acabado.paso, pliegues: acabado.pliegues,
    });
    this.textura = new THREE.CanvasTexture(hoja.lienzo);
    this.textura.anisotropy = 4;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTICE,
      fragmentShader: FRAGMENTO,
      side: THREE.DoubleSide,
      defines: acabado.facetas ? { FACETAS: '' } : {},
      uniforms: {
        mapa: { value: this.textura },
        luz: { value: LUZ },
        dorso: { value: new THREE.Vector3(...hoja.dorso) },
        tono: { value: new THREE.Vector3(...hoja.tono) },
        revelado: { value: 1 - acabado.velo },
        ambiente: { value: acabado.ambiente },
        oclusion: { value: acabado.oclusion },
        calido: { value: acabado.calido },
        brillo: { value: hoja.brillo * acabado.brillo },
        tinte: { value: oscuro.matches ? 0.86 : 1 },
      },
    });
    this.malla = new THREE.Mesh(this.forma.geometria, this.material);
    this.malla.frustumCulled = false;
    this.escena = new THREE.Scene();
    this.escena.add(this.malla);

    // El lienzo cubre la hoja abierta con su giro y su inclinación.
    this.lado = Math.ceil(Math.hypot(hoja.ancho, hoja.alto) * MARGEN);
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.lienzo = document.createElement('canvas');
    this.lienzo.className = 'bola-de-papel__dibujo';
    this.lienzo.width = this.lienzo.height = Math.round(this.lado * this.dpr);
    this.lienzo.style.width = this.lienzo.style.height = `${this.lado}px`;
    this.lienzo.setAttribute('aria-hidden', 'true');
    this.ctx = this.lienzo.getContext('2d');

    this.boton = document.createElement('button');
    this.boton.type = 'button';
    this.boton.className = 'bola-de-papel__toque';
    this.boton.setAttribute('aria-label', papel.alt || 'Papel arrugado');
    this.boton.setAttribute('aria-expanded', 'false');

    ancla.classList.add('bola-de-papel');
    ancla.append(this.lienzo, this.boton);
    this.ajustarToque();
    this.escuchar();
  }

  escuchar() {
    const deMouse = (e) => e.pointerType === 'mouse' || e.pointerType === 'pen';
    this.boton.addEventListener('pointerenter', (e) => { if (deMouse(e)) this.abrir('mouse'); });
    this.boton.addEventListener('pointerleave', (e) => { if (deMouse(e)) this.cerrar(); });
    // Toque y teclado abren y cierran con el clic. Con mouse ya se abrió al pasar por encima.
    this.boton.addEventListener('click', () => {
      if (this.modo === 'mouse') return;
      if (this.objetivo) this.cerrar();
      else this.abrir('clic');
    });
    this.boton.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.cerrar(); });
    this.boton.addEventListener('blur', () => { if (this.modo === 'clic') this.cerrar(); });
    this.fuera = (e) => {
      if (this.modo === 'clic' && !this.ancla.contains(e.target)) this.cerrar();
    };
    document.addEventListener('pointerdown', this.fuera);
  }

  // Cerrada solo se puede tocar la bola. Abierta, toda la hoja.
  ajustarToque() {
    const abierta = this.objetivo === 1;
    const w = abierta ? this.ancho : this.radio * 2.2;
    const h = abierta ? this.alto : this.radio * 2.2;
    this.boton.style.width = `${w}px`;
    this.boton.style.height = `${h}px`;
    this.boton.style.translate = abierta ? `calc(-50% + ${this.corrimiento}px) -50%` : '';
  }

  // Si la bola está pegada al borde, la hoja abierta se corre lo justo para entrar en pantalla.
  medirCorrimiento() {
    const x = this.ancla.getBoundingClientRect().left;
    const ancho = document.documentElement.clientWidth;
    const mitad = this.ancho / 2 + 12;
    this.corrimiento = ancho < mitad * 2 ? ancho / 2 - x : limitar(x, mitad, ancho - mitad) - x;
  }

  abrir(modo) {
    this.modo = modo;
    this.ir(1);
  }

  cerrar() {
    this.modo = null;
    this.ir(0);
  }

  ir(objetivo) {
    if (this.objetivo === objetivo) return;
    this.objetivo = objetivo;
    if (objetivo === 1) this.medirCorrimiento();
    this.ancla.classList.toggle('bola-de-papel--abierta', objetivo === 1);
    this.boton.setAttribute('aria-expanded', String(objetivo === 1));
    this.ajustarToque();
    if (sinMovimiento.matches) {
      this.p = objetivo;
      this.v = 0;
      this.dibujar();
      return;
    }
    despertar(this);
  }

  // Resorte con amortiguación crítica: si se cambia de idea a mitad de camino,
  // vuelve sin saltos. Abrir es un poco más lento que arrugar.
  paso(dt) {
    const w = this.objetivo > this.p ? 5.4 : 6.6;
    const a = w * w * (this.objetivo - this.p) - 2 * w * this.v;
    this.v += a * dt;
    this.p += this.v * dt;
    if (Math.abs(this.objetivo - this.p) < 0.0008 && Math.abs(this.v) < 0.004) {
      this.p = this.objetivo;
      this.v = 0;
      return false;
    }
    return true;
  }

  dibujar() {
    if (!motor) return;
    const p = limitar(this.p, 0, 1);
    this.forma.actualizar(p);

    const e = suave(p);
    const medio = Math.sin(Math.PI * e);
    this.malla.rotation.set(
      Math.cos(this.ejeInclinacion) * this.inclinacion * medio,
      Math.sin(this.ejeInclinacion) * this.inclinacion * medio,
      mezcla(this.giroBola, this.giroAbierta, e) + this.vuelta * medio,
    );
    this.malla.scale.setScalar(1 + 0.04 * medio);
    this.material.uniforms.revelado.value = mezcla(1 - this.acabado.velo, 1, tramo(0.1, 0.7, e));
    this.lienzo.style.translate = this.corrimiento ? `calc(-50% + ${(this.corrimiento * e).toFixed(1)}px) -50%` : '';

    const { renderer, camara } = motor;
    const px = this.lienzo.width;
    if (motor.lado !== px) {
      renderer.setSize(px, px, false);
      motor.lado = px;
    }
    const m = this.lado / 2;
    camara.left = -m;
    camara.right = m;
    camara.top = m;
    camara.bottom = -m;
    camara.updateProjectionMatrix();
    renderer.render(this.escena, camara);
    this.ctx.clearRect(0, 0, px, px);
    this.ctx.drawImage(renderer.domElement, 0, 0);

    // La sombra va pegada al piso en la bola, se despega a mitad de camino y se asienta abierta.
    const alto = 0.35 * e + medio;
    this.lienzo.style.filter = this.acabado.sombra === 'calida' ? sombraCalida(e, alto) : sombraFina(e, alto);
  }

  destruir() {
    activas.delete(this);
    document.removeEventListener('pointerdown', this.fuera);
    this.lienzo.remove();
    this.boton.remove();
    this.ancla.classList.remove('bola-de-papel', 'bola-de-papel--abierta');
    this.forma.geometria.dispose();
    this.material.dispose();
    this.textura.dispose();
  }
}

function ponerEstilos() {
  if (document.querySelector('style[data-bolas-de-papel]')) return;
  const estilo = document.createElement('style');
  estilo.dataset.bolasDePapel = '';
  estilo.textContent = ESTILOS;
  document.head.append(estilo);
}

export async function montarBolasDePapel({ raiz = document, lista = LISTA, acabado = 'suave' } = {}) {
  const anclas = [...raiz.querySelectorAll('[data-papel]')];
  if (!anclas.length || !obtenerMotor()) return null;
  ponerEstilos();
  const elegido = ACABADOS[acabado] || ACABADOS.suave;

  const urlLista = new URL(lista, document.baseURI);
  const [papeles] = await Promise.all([fetch(urlLista).then((r) => r.json()), cargarLetra()]);
  const porId = new Map(papeles.map((papel) => [papel.id, papel]));

  const bolas = [];
  for (const ancla of anclas) {
    const papel = porId.get(ancla.dataset.papel);
    if (!papel) continue;
    try {
      const hoja = await dibujarPapel(papel, urlLista, { limpio: elegido.limpio });
      bolas.push(new Bola(ancla, papel, hoja, elegido));
    } catch (error) {
      console.warn('bolas de papel: no se pudo armar', papel.id, error);
    }
  }

  // Cada bola se dibuja la primera vez cuando se acerca a la pantalla.
  const porLienzo = new Map(bolas.map((b) => [b.lienzo, b]));
  const vigia = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      porLienzo.get(entrada.target)?.dibujar();
      vigia.unobserve(entrada.target);
    }
  }, { rootMargin: '400px 0px' });
  for (const b of bolas) vigia.observe(b.lienzo);

  const alCambiarTema = () => {
    for (const b of bolas) {
      b.material.uniforms.tinte.value = oscuro.matches ? 0.86 : 1;
      b.dibujar();
    }
  };
  oscuro.addEventListener('change', alCambiarTema);

  return {
    bolas,
    // Deja todas las bolas en un punto fijo (0 bola, 1 abierta). Sirve para revisar estados.
    fijar(p) {
      for (const b of bolas) {
        b.p = p;
        b.v = 0;
        b.dibujar();
      }
    },
    destruir() {
      vigia.disconnect();
      oscuro.removeEventListener('change', alCambiarTema);
      for (const b of bolas) b.destruir();
    },
  };
}
