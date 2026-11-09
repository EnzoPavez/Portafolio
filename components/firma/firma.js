// Firma sobre el nombre. Toma la firma de un SVG (firma.svg), la pinta del color --firma
// con una textura leve de tinta y la descubre de izquierda a derecha cuando aparece en
// pantalla, como si se firmara en ese momento. Va detrás del texto, así el nombre se lee encima.
//
// Uso
//   <header style="position: relative">
//     <div class="firma" aria-hidden="true"></div>   (posicionada con CSS, el ancho manda)
//     <h1 style="position: relative">Enzo Pavez</h1>
//   </header>
//   import { montarFirma } from './firma.js';
//   montarFirma(document.querySelector('.firma'));
//
// Opciones
//   firma     ruta a otro SVG. Sirve cualquiera con figuras rellenas (path). Si trae
//             data-base, es la altura de su línea base en fracción del alto
//   animar      false la muestra entera desde el principio (también si el sistema pide menos movimiento)
//   automatico  false no la firma sola al verse; queda oculta hasta que se llame a dibujar()
//   retraso     ms que espera antes de empezar
//   duracion    ms que tarda en firmarse entera
//
// Al contenedor le deja la variable --firma-base, para que la página alinee la línea base
// de la firma con la del nombre. Devuelve { dibujar, ocultar, destruir }; dibujar() la vuelve
// a firmar desde cero y ocultar() la borra.

const DATOS = new URL('./firma.svg', import.meta.url);
const SVG = 'http://www.w3.org/2000/svg';
const FUNDIDO = 0.22; // largo del borde difuso que avanza, en fracción del ancho

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function leer(ruta) {
  const respuesta = await fetch(new URL(ruta, location.href), { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo leer la firma (${respuesta.status})`);
  const doc = new DOMParser().parseFromString(await respuesta.text(), 'image/svg+xml');
  const raiz = doc.querySelector('svg');
  const [, , ancho, alto] = (raiz?.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (!ancho || !alto) throw new Error('La firma no tiene viewBox');
  const figuras = [...doc.querySelectorAll('path')].map((p) => ({ d: p.getAttribute('d'), regla: p.getAttribute('fill-rule') || 'nonzero' }));
  return { ancho, alto, base: Number(raiz.dataset.base) || 0.6, figuras };
}

// Tinta un poco irregular. El ruido apenas mueve el borde y deja zonas algo más claras.
function filtro(id) {
  return `
    <filter id="${id}" x="-2%" y="-4%" width="104%" height="108%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="7" result="ruido"/>
      <feDisplacementMap in="SourceGraphic" in2="ruido" scale="0.9" xChannelSelector="R" yChannelSelector="B" result="borde"/>
      <feColorMatrix in="ruido" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 0.45" result="motas"/>
      <feComposite in="borde" in2="motas" operator="in"/>
    </filter>`;
}

export async function montarFirma(contenedor, opciones = {}) {
  const { firma = DATOS, animar = true, automatico = true, retraso = 250, duracion = 1500 } = opciones;
  const { ancho, alto, base, figuras } = await leer(firma);
  const id = `firma-${Math.random().toString(36).slice(2, 8)}`;
  const barrido = ancho * (1 + FUNDIDO);

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  Object.assign(svg.style, {
    display: 'block', width: '100%', height: 'auto', overflow: 'visible',
    color: 'var(--firma, #cf3b38)', pointerEvents: 'none',
  });
  // La máscara es una franja blanca con el borde derecho difuso que avanza hacia la derecha
  svg.innerHTML = `
    <defs>
      ${filtro(`${id}-tinta`)}
      <linearGradient id="${id}-borde">
        <stop offset="0" stop-color="#fff"/>
        <stop offset="${(1 / (1 + FUNDIDO)).toFixed(3)}" stop-color="#fff"/>
        <stop offset="1" stop-color="#000"/>
      </linearGradient>
      <mask id="${id}-mascara" maskUnits="userSpaceOnUse" x="${-ancho * 0.05}" y="${-alto * 0.1}" width="${ancho * 1.1}" height="${alto * 1.2}">
        <rect x="0" y="${-alto * 0.1}" width="${barrido}" height="${alto * 1.2}" fill="url(#${id}-borde)"/>
      </mask>
    </defs>
    <g mask="url(#${id}-mascara)">
      <g filter="url(#${id}-tinta)" fill="currentColor">
        ${figuras.map((f) => `<path fill-rule="${f.regla}" d="${f.d}"/>`).join('')}
      </g>
    </g>`;
  contenedor.replaceChildren(svg);
  contenedor.style.setProperty('--firma-base', String(base));

  const franja = svg.querySelector('mask rect');
  const oculta = `translateX(${-barrido}px)`;
  let animacion = null;
  let turno = 0;

  async function dibujar() {
    animacion?.cancel();
    if (!animar || quieto()) {
      franja.style.transform = '';
      return;
    }
    const mio = ++turno;
    franja.style.transform = oculta;
    await espera(retraso);
    if (mio !== turno) return;
    animacion = franja.animate(
      [{ transform: oculta }, { transform: 'translateX(0px)' }],
      { duration: duracion, easing: 'cubic-bezier(.45, .05, .35, 1)', fill: 'forwards' },
    );
  }

  function ocultar() {
    turno++;
    animacion?.cancel();
    animacion = null;
    franja.style.transform = oculta;
  }

  // Se firma la primera vez que se ve
  const observador = new IntersectionObserver((entradas) => {
    if (!entradas.some((e) => e.isIntersecting)) return;
    observador.disconnect();
    dibujar();
  }, { threshold: 0.35 });
  if (!automatico) franja.style.transform = oculta;
  else if (animar && !quieto()) {
    franja.style.transform = oculta;
    observador.observe(contenedor);
  }

  return {
    dibujar,
    ocultar,
    destruir() {
      observador.disconnect();
      turno++;
      animacion?.cancel();
      svg.remove();
    },
  };
}
