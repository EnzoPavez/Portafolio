// Estantería de libros. Los libros se ven de lomo, uno al lado del otro, y el elegido
// gira y muestra su tapa. Al hacer clic en la tapa el libro se abre, la primera hoja
// crece hasta llenar el componente y aparece la ficha con la tapa grande, el título y
// la sinopsis. Cerrar hace el camino al revés.
//
// Uso
//   <div id="libros" style="height: 100svh"></div>
//   import { montarLibreria } from './libros.js';
//   montarLibreria(document.getElementById('libros'), { volver: { texto: 'Volver', href: '../../' } });
//
// El componente llena el alto y el ancho de su contenedor, así que el contenedor
// necesita una altura. Carga solo su CSS. Las letras (Fraunces e Inter) y los colores
// los toma de la página si están (--fondo, --texto, --texto-suave...).
//
// Opciones
//   lista     ruta a la lista de libros (por defecto lista.json, al lado de este archivo)
//             o directamente un arreglo de libros
//   titulo    lo que va arriba al centro ("Libros")
//   bajada    la línea chica bajo el título ("Lo que he leído")
//   volver    { texto, href } para el botón de arriba a la izquierda. Sin esto no va
//   inicial   qué libro arranca elegido. 'medio' (por defecto), 'primero', 'ultimo',
//             un número o el id de un libro
//   resumen   líneas de arriba a la derecha. Por defecto, cuántos libros y de qué años
//   indice    nombre de los botones de arriba para quien usa lector ("Años de lectura")
//
// Grupos en vez de años. Si los libros traen "grupo" (por ejemplo Habilidades, Formación),
// los botones de arriba son los grupos, en el orden en que aparecen, y los libros quedan en
// el orden de la lista. Cada libro puede traer además
//   detalle      la línea chica bajo el título en el estante (si no, "Leído en <leido>")
//   datos        la línea de datos de la ficha (si no, año · género · páginas)
//   tituloLomo   un título más corto para el lomo
//   autorLomo    lo que va en el lomo como autor; "" para no poner nada
//   etiquetas    lista corta (herramientas, temas) que va en la ficha como pastillas
//   enlace       https://... se abre aparte; una ruta sin protocolo queda en el sitio
//
// Devuelve { abrir, cerrar, activar, destruir }.

import { esc, estiloColores, lomoHTML, semillaDe, tapaHTML } from './tapas.js';
import { revelar } from './mancha.js';

const ESTILOS = new URL('./libros.css', import.meta.url);
const LISTA = new URL('./lista.json', import.meta.url);

const GIRO = 20; // grados que queda girado el libro elegido, así se le ve un poco el lomo
const ACERCAR = 1.07; // cuánto más grande se ve el elegido, que sale hacia adelante
const T_TAPA = 560; // lo que tarda la tapa en abrirse o cerrarse
const T_HOJA = 760; // lo que tarda la primera hoja en crecer hasta llenar todo
const CURVA = 'cubic-bezier(.16, 1, .3, 1)'; // la de revelar del portafolio
const CURVA_HOJA = 'cubic-bezier(.62, 0, .22, 1)';

const FLECHA_IZQ = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5.5M11 6.5 5.5 12l5.5 5.5"/></svg>';
const FLECHA_DER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/></svg>';
const CRUZ = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>';
const AFUERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16.5 7.5M9.5 7.5h7v7"/></svg>';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const cuadros = (n = 2) => new Promise((r) => { const paso = () => (--n <= 0 ? r() : requestAnimationFrame(paso)); requestAnimationFrame(paso); });
const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function cargarEstilos() {
  if (document.querySelector('link[data-libreria]')) return Promise.resolve();
  const enlace = document.createElement('link');
  enlace.rel = 'stylesheet';
  enlace.href = ESTILOS.href;
  enlace.dataset.libreria = '';
  const listo = new Promise((r) => { enlace.onload = r; enlace.onerror = r; });
  document.head.append(enlace);
  return listo;
}

async function leerLista(lista) {
  if (Array.isArray(lista)) return { crudos: lista, base: new URL(location.href) };
  const url = new URL(lista, location.href);
  const respuesta = await fetch(url, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo leer ${url.pathname} (${respuesta.status})`);
  return { crudos: await respuesta.json(), base: url };
}

// Con grupos, juntos por grupo en el orden en que aparece cada uno. Sin grupos, por el año
// en que se leyeron (los que no tienen año van al final). En los dos casos, a igualdad,
// en el orden de la lista.
function ordenar(crudos) {
  const libros = crudos
    .filter((l) => l && l.titulo)
    .map((l, i) => ({ ...l, id: l.id || slug(l.titulo) || `libro-${i}`, orden: i }));
  if (libros.some((l) => l.grupo)) {
    const grupos = [...new Set(libros.map((l) => l.grupo ?? ''))];
    return libros.sort((a, b) => grupos.indexOf(a.grupo ?? '') - grupos.indexOf(b.grupo ?? '') || a.orden - b.orden);
  }
  return libros.sort((a, b) => (Number(a.leido) || Infinity) - (Number(b.leido) || Infinity) || a.orden - b.orden);
}

// Lo que marca cada botón de arriba: el grupo si hay grupos, si no el año de lectura
const marca = (libro) => String(libro.grupo ?? libro.leido ?? '');

const etiqueta = (libro) => (libro.autor ? `${libro.titulo}, de ${libro.autor}` : libro.titulo);

function palabras(texto) {
  return esc(texto).split(/\s+/).map((p) => `<span class="lb-palabra"><span>${p}</span></span>`).join(' ');
}

export async function montarLibreria(contenedor, opciones = {}) {
  const {
    lista = LISTA,
    titulo = 'Libros',
    bajada = 'Lo que he leído',
    volver = null,
    inicial = 'medio',
    resumen: resumenPropio = null,
    indice: nombreIndice = 'Años de lectura',
    margenArriba = 0,
  } = opciones;

  const [, { crudos, base }] = await Promise.all([cargarEstilos(), leerLista(lista)]);
  const libros = ordenar(crudos);
  if (!libros.length) throw new Error('La lista de libros está vacía');

  const control = new AbortController();
  const { signal } = control;
  const prefijo = `lb-${Math.random().toString(36).slice(2, 8)}`;

  // Los botones de arriba: grupos o años, sin repetir
  const anios = [...new Set(libros.map(marca).filter(Boolean))];
  const resumen = resumenPropio ?? [
    `${libros.length} ${libros.length === 1 ? 'libro' : 'libros'}`,
    anios.length > 1 ? `${anios[0]} a ${anios.at(-1)}` : anios[0],
  ].filter(Boolean);

  const raiz = document.createElement('div');
  raiz.className = 'libreria lb-sin-transicion';
  raiz.dataset.estado = 'estante';
  raiz.style.setProperty('--l-t-tapa', `${T_TAPA}ms`);
  raiz.style.scrollMarginTop = `${margenArriba}px`;
  raiz.innerHTML = `
    <header class="lb-cabecera">
      <div class="lb-izq">
        ${volver?.href ? `<a class="lb-boton lb-volver" href="${esc(volver.href)}">${FLECHA_IZQ}<span>${esc(volver.texto ?? 'Volver')}</span></a>` : ''}
        <button class="lb-boton lb-cerrar" type="button">${CRUZ}<span>Cerrar</span></button>
      </div>
      <div class="lb-marca">
        <span class="lb-marca-titulo">${esc(titulo)}</span>
        ${bajada ? `<span class="lb-marca-bajada">${esc(bajada)}</span>` : ''}
      </div>
      <p class="lb-der">${resumen.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
    </header>
    <nav class="lb-indice" aria-label="${esc(nombreIndice)}">
      ${anios.length > 1 ? `<div class="lb-indice-grupo">${anios.map((a) => `<button class="lb-anio" type="button" data-anio="${esc(a)}" aria-pressed="false">${esc(a)}</button>`).join('')}</div>` : ''}
    </nav>
    <div class="lb-estante">
      <ul class="lb-pista" aria-label="${esc(titulo)}"></ul>
      <div class="lb-abrir" aria-hidden="true">Abrir</div>
    </div>
    <div class="lb-pie">
      <button class="lb-flecha" type="button" data-paso="-1" aria-label="Libro anterior">${FLECHA_IZQ}</button>
      <div class="lb-rotulo" aria-live="polite"></div>
      <button class="lb-flecha" type="button" data-paso="1" aria-label="Libro siguiente">${FLECHA_DER}</button>
    </div>
    <div class="lb-hoja" hidden></div>
    <section class="lb-ficha" role="dialog" aria-labelledby="${prefijo}-titulo" hidden></section>`;
  contenedor.replaceChildren(raiz);

  const $ = (sel) => raiz.querySelector(sel);
  const indice = $('.lb-indice');
  const estante = $('.lb-estante');
  const pista = $('.lb-pista');
  const disco = $('.lb-abrir');
  const pie = $('.lb-pie');
  const rotulo = $('.lb-rotulo');
  const hoja = $('.lb-hoja');
  const ficha = $('.lb-ficha');
  const botonCerrar = $('.lb-cerrar');
  const flechas = [...raiz.querySelectorAll('.lb-flecha')];
  const botonesAnio = [...raiz.querySelectorAll('.lb-anio')];

  const elementos = libros.map((libro) => {
    const li = document.createElement('li');
    li.className = 'lb-libro';
    li.style.cssText = estiloColores(libro);
    li.innerHTML = `
      <button class="lb-zona" type="button" tabindex="-1"></button>
      <div class="lb-alza" aria-hidden="true">
        <div class="lb-caja">
          <div class="lb-cara lb-lomo">${lomoHTML(libro)}</div>
          <div class="lb-cara lb-paginas"></div>
          <div class="lb-tapa">
            <div class="lb-cara lb-tapa-frente">${tapaHTML(libro, base)}</div>
            <div class="lb-cara lb-tapa-reverso"></div>
          </div>
        </div>
      </div>
      <div class="lb-sombra" aria-hidden="true"></div>`;
    return li;
  });
  pista.append(...elementos);

  let activo = typeof inicial === 'number' ? inicial
    : inicial === 'primero' ? 0
      : inicial === 'ultimo' ? libros.length - 1
        : libros.findIndex((l) => l.id === inicial);
  if (inicial === 'medio' || activo < 0) activo = Math.floor((libros.length - 1) / 2);
  activo = limitar(activo, 0, libros.length - 1);

  let abierto = false;
  let ocupado = false;
  let geo = null;
  const salidas = new Map();

  // Medidas. Todo sale del alto del libro (H): la tapa es 2:3 y el grosor del lomo
  // depende de las páginas.
  function medir() {
    const ancho = estante.clientWidth;
    // En pantallas angostas manda el ancho, para que quepan lomos a los dos lados del elegido
    const H = Math.round(Math.max(140, Math.min(estante.clientHeight * 0.8, raiz.clientHeight * 0.54, ancho * 0.8, 470)));
    const W = Math.round((H * 2) / 3);
    const perspectiva = Math.round(H * 3.6);
    const acercar = perspectiva * (1 - 1 / ACERCAR);
    const giro = (GIRO * Math.PI) / 180;
    geo = { ancho, H, W, hueco: Math.max(2, Math.round(H * 0.012)), margen: Math.round(H * 0.055), D: [], visible: [] };
    raiz.style.setProperty('--h', `${H}px`);
    raiz.style.setProperty('--w', `${W}px`);
    raiz.style.setProperty('--perspectiva', `${perspectiva}px`);
    raiz.style.setProperty('--giro', `${GIRO}deg`);
    raiz.style.setProperty('--subir', `${(-H * 0.025).toFixed(1)}px`);
    libros.forEach((libro, i) => {
      const paginas = Number(libro.paginas) || 300;
      const D = Math.round(H * limitar(0.055 + paginas * 0.00009, 0.062, 0.16));
      geo.D[i] = D;
      geo.visible[i] = (W * Math.cos(giro) + D * Math.sin(giro)) * ACERCAR;
      elementos[i].style.setProperty('--d', `${D}px`);
      elementos[i].style.setProperty('--tirar', `${(acercar - (D / 2) * Math.cos(giro)).toFixed(1)}px`);
    });

    // Flechas a los costados de los libros, a la altura de su centro. La distancia es la del
    // libro más alejado del centro (cuando está elegido el primero o el último), así no se
    // mueven al cambiar de libro. Nunca a menos de 72 px del borde.
    const lado = (i) => geo.visible[i] / 2 + geo.margen + geo.D.reduce((t, d, j) => t + (j === i ? 0 : d + geo.hueco), 0);
    const distancia = Math.min(Math.max(lado(0), lado(libros.length - 1)) + 56, ancho / 2 - 72);
    raiz.style.setProperty('--flechas-dist', `${Math.round(distancia)}px`);
    raiz.style.setProperty('--flechas-y', `${Math.round(estante.offsetTop + estante.clientHeight / 2 - pie.offsetTop)}px`);
  }

  // Pone cada libro en su lugar con el elegido al centro.
  function colocar() {
    let x = 0;
    const centros = [];
    libros.forEach((_, i) => {
      const es = i === activo;
      const visible = es ? geo.visible[i] : geo.D[i];
      if (es) x += geo.margen;
      centros[i] = x + visible / 2;
      x += visible + geo.hueco + (es ? geo.margen : 0);
      elementos[i].style.setProperty('--vis', `${visible.toFixed(1)}px`);
    });
    const corrimiento = geo.ancho / 2 - centros[activo];
    geo.paso = (x - geo.visible[activo] - 2 * geo.margen + geo.D[activo]) / libros.length;
    elementos.forEach((el, i) => {
      const es = i === activo;
      el.style.setProperty('--x', `${(corrimiento + centros[i] - geo.W / 2).toFixed(1)}px`);
      el.classList.toggle('lb-activo', es);
      const zona = el.firstElementChild;
      zona.tabIndex = es ? 0 : -1;
      zona.setAttribute('aria-label', `${es ? 'Abrir ' : ''}${etiqueta(libros[i])}`);
      if (es) zona.setAttribute('aria-current', 'true');
      else zona.removeAttribute('aria-current');
    });
    flechas[0].setAttribute('aria-disabled', String(activo === 0));
    flechas[1].setAttribute('aria-disabled', String(activo === libros.length - 1));
    const anio = marca(libros[activo]);
    for (const b of botonesAnio) b.setAttribute('aria-pressed', String(b.dataset.anio === anio));
    // Si los años no caben (celular), se corren para que el marcado quede a la vista
    const marcado = botonesAnio.find((b) => b.dataset.anio === anio);
    if (marcado && indice.scrollWidth > indice.clientWidth) {
      const izquierda = marcado.offsetLeft + marcado.offsetWidth / 2 - indice.clientWidth / 2;
      indice.scrollTo({ left: izquierda, behavior: raiz.classList.contains('lb-sin-transicion') || quieto() ? 'instant' : 'smooth' });
    }
  }

  // Achica la letra del lomo hasta que el título entra. Si ni así entra, lo parte en dos.
  function ajustarLomos() {
    const minimo = Math.max(7, geo.H * 0.022);
    for (const t of pista.querySelectorAll('.lb-lomo-titulo')) {
      t.style.fontSize = '';
      t.classList.remove('lb-dos', 'lb-corta');
      const sobra = () => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1;
      let letra = parseFloat(getComputedStyle(t).fontSize);
      while (sobra() && letra > minimo) {
        letra -= 0.5;
        t.style.fontSize = `${letra}px`;
      }
      if (!sobra()) continue;
      t.classList.add('lb-dos');
      letra = Math.max(minimo, letra * 1.15);
      t.style.fontSize = `${letra}px`;
      while (sobra() && letra > minimo * 0.9) {
        letra -= 0.5;
        t.style.fontSize = `${letra}px`;
      }
      if (sobra()) {
        t.classList.replace('lb-dos', 'lb-corta');
        t.style.fontSize = `${minimo}px`;
      }
    }
  }

  // El título del libro elegido, bajo la estantería. El de antes sube y se va.
  function rotular(direccion = 0) {
    const libro = libros[activo];
    const nuevo = document.createElement('div');
    nuevo.className = 'lb-rotulo-item';
    nuevo.innerHTML = `
      <span class="lb-rotulo-titulo">${esc(libro.titulo)}</span>
      ${libro.autor ? `<span class="lb-rotulo-autor">${esc(libro.autor)}</span>` : ''}
      ${(() => {
        const detalle = libro.detalle ?? (libro.leido ? `Leído en ${libro.leido}` : '');
        return detalle ? `<span class="lb-rotulo-anio">${esc(detalle)}</span>` : '';
      })()}`;
    const viejos = [...rotulo.querySelectorAll('.lb-rotulo-item:not(.lb-saliente)')];
    rotulo.append(nuevo);
    for (const viejo of viejos) {
      viejo.classList.add('lb-saliente');
      if (!direccion || quieto()) {
        viejo.remove();
        continue;
      }
      viejo.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px)', filter: 'blur(3px)' }],
        { duration: 260, easing: 'ease-in', fill: 'forwards' },
      ).onfinish = () => viejo.remove();
    }
    if (direccion && !quieto()) {
      nuevo.animate(
        [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
        { duration: 560, delay: 90, easing: CURVA, fill: 'backwards' },
      );
    }
  }

  function activar(i) {
    i = limitar(i, 0, libros.length - 1);
    if (i === activo || ocupado || abierto) return false;
    const antes = activo;
    activo = i;
    // El que se va queda un rato por encima de sus vecinos mientras vuelve a girar
    const viejo = elementos[antes];
    viejo.classList.add('lb-saliendo');
    clearTimeout(salidas.get(viejo));
    salidas.set(viejo, setTimeout(() => viejo.classList.remove('lb-saliendo'), 700));
    colocar();
    rotular(Math.sign(i - antes));
    ocultarDisco();
    return true;
  }

  const enfocar = () => elementos[activo].firstElementChild.focus({ preventScroll: true });

  // El círculo "Abrir" que sigue al mouse sobre la tapa del elegido.
  const sigue = { x: 0, y: 0, ax: 0, ay: 0, visible: false, cuadro: 0 };
  function moverDisco() {
    sigue.x += (sigue.ax - sigue.x) * 0.24;
    sigue.y += (sigue.ay - sigue.y) * 0.24;
    disco.style.translate = `${sigue.x.toFixed(1)}px ${sigue.y.toFixed(1)}px`;
    const falta = Math.abs(sigue.ax - sigue.x) + Math.abs(sigue.ay - sigue.y);
    sigue.cuadro = falta > 0.3 ? requestAnimationFrame(moverDisco) : 0;
  }
  function ocultarDisco() {
    if (!sigue.visible) return;
    sigue.visible = false;
    disco.classList.remove('lb-visible');
  }

  // Abrir. La tapa gira sobre el lomo, la primera hoja crece hasta llenar el
  // componente y sobre ella aparece la ficha.
  async function abrir() {
    if (ocupado || abierto) return;
    ocupado = true;
    ocultarDisco();
    const libro = libros[activo];
    const el = elementos[activo];
    llenarFicha(libro);
    raiz.dataset.estado = 'abierto';

    // Si la estantería no se ve entera (por ejemplo, tapada en parte por una barra fija
    // de la página), primero se lleva a la vista y recién entonces se abre el libro.
    await llevarALaVista();

    if (quieto()) {
      hoja.hidden = false;
      ficha.hidden = false;
      await ficha.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 }).finished;
    } else {
      el.classList.add('lb-abierto');
      await espera(T_TAPA * 0.5);
      const vuelo = hoja.animate(vueloHoja(rectDe(el.querySelector('.lb-paginas'))), { duration: T_HOJA, easing: CURVA_HOJA, fill: 'both' });
      hoja.hidden = false;
      await espera(T_HOJA * 0.66);
      ficha.hidden = false;
      revelarFicha(libro);
      await vuelo.finished;
    }
    // Si la ficha no entra, la estantería crece hacia abajo y se lee con el desplazamiento
    // de la página, sin una segunda barra ni el dedo atrapado dentro de la ficha.
    await crecerSiHaceFalta();
    for (const n of [indice, estante, pie]) n.inert = true;
    abierto = true;
    ocupado = false;
    botonCerrar.focus({ preventScroll: true });
  }

  async function cerrar() {
    if (ocupado || !abierto) return;
    ocupado = true;
    abierto = false;
    const el = elementos[activo];
    for (const n of [indice, estante, pie]) n.inert = false;
    raiz.dataset.estado = 'estante';

    if (quieto()) {
      await ficha.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished;
      volverAlAlto();
    } else {
      // Si creció, primero se va la ficha, vuelve a su alto y se acomoda la página
      const habiaCrecido = crecida;
      if (habiaCrecido) {
        await ficha.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished;
        volverAlAlto();
        await cuadros(2);
        await llevarALaVista();
      }
      const r = rectDe(el.querySelector('.lb-paginas'));
      const dx = r.left + r.width / 2 - raiz.clientWidth / 2;
      const dy = r.top + r.height / 2 - raiz.clientHeight / 2;
      // La ficha se va rápido, antes de que la hoja se achique y la deje afuera
      if (!habiaCrecido) ficha.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${dx * 0.2}px, ${dy * 0.2}px) scale(.94)` }],
        { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
      );
      const ida = vueloHoja(r);
      const vuelta = ida.reverse().map((k) => ({ ...k, offset: 1 - k.offset }));
      for (const a of hoja.getAnimations()) a.cancel();
      await hoja.animate(vuelta, { duration: T_HOJA * 0.85, easing: CURVA_HOJA, fill: 'both' }).finished;
    }
    hoja.hidden = true;
    ficha.hidden = true;
    for (const n of [hoja, ficha]) for (const a of n.getAnimations()) a.cancel();
    ficha.replaceChildren();
    el.classList.remove('lb-abierto');
    if (!quieto()) await espera(T_TAPA);
    ocupado = false;
    enfocar();
  }

  // Lleva la estantería a la vista (debajo de margenArriba) y espera a que la página se quede quieta
  async function llevarALaVista() {
    const caja = raiz.getBoundingClientRect();
    const cabe = caja.height <= innerHeight - margenArriba;
    if (caja.top >= margenArriba - 2 && (!cabe || caja.bottom <= innerHeight + 2)) return;
    const destino = Math.round(scrollY + caja.top - margenArriba);
    if (quieto()) {
      scrollTo({ top: destino, behavior: 'instant' });
      return;
    }
    scrollTo({ top: destino, behavior: 'smooth' });
    const inicio = performance.now();
    let ultimo = -1;
    let quietos = 0;
    while (performance.now() - inicio < 1200) {
      await cuadros(1);
      const y = Math.round(scrollY);
      if (Math.abs(y - destino) <= 1) break;
      quietos = y === ultimo ? quietos + 1 : 0;
      if (quietos >= 6) break; // no llega (por ejemplo, al final de la página)
      ultimo = y;
    }
  }

  // La estantería crece lo que le falta a la ficha para entrar, y vuelve a su alto al cerrar
  let crecida = false;
  async function crecerSiHaceFalta() {
    if (ficha.scrollHeight - ficha.clientHeight <= 1) return;
    // El título y la tapa se miden según el alto; se fijan para que no crezcan con la estantería
    const titulo = ficha.querySelector('.lb-ficha-titulo');
    const tapa = ficha.querySelector('.lb-ficha-tapa');
    if (titulo) titulo.style.fontSize = getComputedStyle(titulo).fontSize;
    if (tapa) tapa.style.width = `${tapa.offsetWidth}px`;
    for (let i = 0; i < 3; i++) {
      const falta = ficha.scrollHeight - ficha.clientHeight;
      if (falta <= 1) return;
      contenedor.style.minHeight = `${raiz.offsetHeight + falta + 2}px`;
      crecida = true;
      await cuadros(2);
    }
  }

  function volverAlAlto() {
    if (!crecida) return;
    contenedor.style.minHeight = '';
    crecida = false;
  }

  // Rectángulo de un elemento respecto del componente
  function rectDe(nodo) {
    const a = nodo.getBoundingClientRect();
    const b = raiz.getBoundingClientRect();
    return { left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height };
  }

  // La hoja va del tamaño de la página del libro al del componente, con un giro
  // leve a mitad de camino, como un papel que se suelta.
  function vueloHoja(r) {
    const W = raiz.clientWidth;
    const H = raiz.clientHeight;
    const sx = r.width / W;
    const sy = r.height / H;
    const tx = r.left + r.width / 2 - W / 2;
    const ty = r.top + r.height / 2 - H / 2;
    // Arranca con el mismo borde que la página del libro, así el cambio no se nota
    const borde = getComputedStyle(raiz).getPropertyValue('--l-borde-hoja').trim() || 'rgb(0 0 0 / .1)';
    const paso = (p, giro, sombra) => ({
      offset: p,
      transform: `translate(${(tx * (1 - p)).toFixed(1)}px, ${(ty * (1 - p)).toFixed(1)}px) rotate(${giro}deg) scale(${(sx + (1 - sx) * p).toFixed(4)}, ${(sy + (1 - sy) * p).toFixed(4)})`,
      boxShadow: sombra,
    });
    return [
      paso(0, 0, `0 0 0 1px ${borde}`),
      paso(0.45, -3.2, '0 30px 70px -30px rgb(0 0 0 / .28)'),
      paso(0.8, 1, '0 20px 60px -30px rgb(0 0 0 / .18)'),
      paso(1, 0, '0 0 0 0 rgb(0 0 0 / 0)'),
    ];
  }

  function llenarFicha(libro) {
    const datos = libro.datos ?? [libro.anio, libro.genero, libro.paginas && `${libro.paginas} páginas`].filter(Boolean).join(' · ');
    const nota = [!libro.grupo && libro.leido && `Leído en ${libro.leido}.`, libro.nota].filter(Boolean).join(' ');
    // Enlace externo (se abre aparte) o de la misma página o sitio (sin protocolo)
    const href = String(libro.enlace ?? '');
    const externo = /^https?:\/\//i.test(href);
    const enlace = externo || (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) ? href : '';
    const etiquetas = Array.isArray(libro.etiquetas) ? libro.etiquetas.filter(Boolean) : [];
    ficha.innerHTML = `
      <div class="lb-ficha-texto">
        ${libro.autor ? `<p class="lb-ficha-autor lb-entra">${esc(libro.autor)}</p>` : ''}
        <h2 class="lb-ficha-titulo" id="${prefijo}-titulo"${libro.titulo.length > 22 ? ' data-largo' : ''}>${palabras(libro.titulo)}</h2>
        ${datos ? `<p class="lb-ficha-datos lb-entra">${esc(datos)}</p>` : ''}
        ${libro.sinopsis ? `<p class="lb-ficha-sinopsis lb-entra">${esc(libro.sinopsis)}</p>` : ''}
        ${nota ? `<p class="lb-ficha-nota lb-entra">${esc(nota)}</p>` : ''}
        ${etiquetas.length ? `<ul class="lb-ficha-etiquetas lb-entra" aria-label="Herramientas">${etiquetas.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
        ${enlace ? `<a class="lb-ficha-boton lb-entra" href="${esc(enlace)}"${externo ? ' target="_blank" rel="noopener"' : ''}>${esc(libro.textoEnlace || 'Ver más')}${externo ? AFUERA : FLECHA_DER}</a>` : ''}
      </div>
      <div class="lb-ficha-tapa" style="${estiloColores(libro)}">${tapaHTML(libro, base)}</div>`;
  }

  // La tapa aparece con la mancha y el texto entra de a una línea.
  function revelarFicha(libro) {
    const tapa = ficha.querySelector('.lb-ficha-tapa');
    revelar(tapa, semillaDe(libro.id), { duracion: 720 }).then(() => tapa.classList.add('lb-revelada'));

    const entrar = [{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }];
    let t = 140;
    const autor = ficha.querySelector('.lb-ficha-autor');
    if (autor) {
      autor.animate(entrar, { duration: 900, delay: t, easing: CURVA, fill: 'backwards' });
      t += 80;
    }
    // Las palabras del título se agrupan por la línea en que cayeron
    const lineas = new Map();
    for (const p of ficha.querySelectorAll('.lb-palabra')) {
      const arriba = p.offsetTop;
      if (!lineas.has(arriba)) lineas.set(arriba, []);
      lineas.get(arriba).push(p.firstElementChild);
    }
    for (const linea of lineas.values()) {
      for (const s of linea) {
        s.animate([{ transform: 'translateY(108%)' }, { transform: 'none' }], { duration: 950, delay: t, easing: CURVA, fill: 'backwards' });
      }
      t += 95;
    }
    for (const el of ficha.querySelectorAll('.lb-ficha-texto > .lb-entra:not(.lb-ficha-autor)')) {
      t += 70;
      el.animate(entrar, { duration: 900, delay: t, easing: CURVA, fill: 'backwards' });
    }
  }

  // Eventos
  pista.addEventListener('click', (e) => {
    const zona = e.target.closest('.lb-zona');
    if (!zona || ignorarClic) return;
    const i = elementos.indexOf(zona.parentElement);
    if (i === activo) abrir();
    else activar(i);
  }, { signal });

  for (const b of flechas) {
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      activar(activo + Number(b.dataset.paso));
    }, { signal });
  }

  for (const b of botonesAnio) {
    b.addEventListener('click', () => {
      activar(libros.findIndex((l) => marca(l) === b.dataset.anio));
    }, { signal });
  }

  botonCerrar.addEventListener('click', cerrar, { signal });

  raiz.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto) {
      e.preventDefault();
      cerrar();
      return;
    }
    if (abierto || !pista.contains(e.target)) return;
    const destino = { ArrowLeft: activo - 1, ArrowRight: activo + 1, Home: 0, End: libros.length - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    activar(destino);
    enfocar();
  }, { signal });

  estante.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || ocupado || abierto || arrastre.activo) return;
    const r = estante.getBoundingClientRect();
    sigue.ax = e.clientX - r.left;
    sigue.ay = e.clientY - r.top;
    const sobreTapa = e.target.closest?.('.lb-zona')?.parentElement === elementos[activo];
    if (sobreTapa && !sigue.visible) {
      sigue.x = sigue.ax;
      sigue.y = sigue.ay;
      sigue.visible = true;
      disco.classList.add('lb-visible');
    } else if (!sobreTapa) {
      ocultarDisco();
    }
    if (!sigue.cuadro) sigue.cuadro = requestAnimationFrame(moverDisco);
  }, { signal });
  estante.addEventListener('pointerleave', ocultarDisco, { signal });

  // Arrastrar la estantería con el dedo o el mouse. Al soltar se elige el libro
  // que quedó más cerca del centro.
  const arrastre = { id: null, x0: 0, dx: 0, activo: false };
  let ignorarClic = false;
  estante.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || ocupado || abierto) return;
    Object.assign(arrastre, { id: e.pointerId, x0: e.clientX, dx: 0, activo: false });
  }, { signal });
  estante.addEventListener('pointermove', (e) => {
    if (e.pointerId !== arrastre.id) return;
    arrastre.dx = e.clientX - arrastre.x0;
    if (!arrastre.activo && Math.abs(arrastre.dx) > 8) {
      arrastre.activo = true;
      estante.setPointerCapture(e.pointerId);
      raiz.classList.add('lb-arrastrando');
      ocultarDisco();
    }
    if (arrastre.activo) pista.style.setProperty('--arrastre', `${arrastre.dx.toFixed(1)}px`);
  }, { signal });
  const soltar = (e) => {
    if (e.pointerId !== arrastre.id) return;
    arrastre.id = null;
    if (!arrastre.activo) return;
    arrastre.activo = false;
    ignorarClic = true;
    setTimeout(() => { ignorarClic = false; }, 0);
    const pasos = Math.round(-arrastre.dx / geo.paso);
    // La pista vuelve a cero mientras los libros se corren, así no hay salto
    raiz.classList.remove('lb-arrastrando');
    pista.style.setProperty('--arrastre', '0px');
    activar(activo + pasos);
  };
  estante.addEventListener('pointerup', soltar, { signal });
  estante.addEventListener('pointercancel', soltar, { signal });

  // Rueda o trackpad de lado (o con Mayús). La rueda vertical sigue moviendo la página.
  let acumulado = 0;
  let ultimo = 0;
  estante.addEventListener('wheel', (e) => {
    if (ocupado || abierto) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!d) return;
    e.preventDefault();
    acumulado += d;
    const ahora = performance.now();
    if (Math.abs(acumulado) > 50 && ahora - ultimo > 110) {
      activar(activo + Math.sign(acumulado));
      acumulado = 0;
      ultimo = ahora;
    }
  }, { passive: false, signal });

  // Medidas iniciales y cada vez que cambia el tamaño
  const sinSaltos = (fn) => {
    raiz.classList.add('lb-sin-transicion');
    fn();
    requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.remove('lb-sin-transicion')));
  };
  const observador = new ResizeObserver(() => sinSaltos(() => {
    medir();
    colocar();
    ajustarLomos();
  }));
  sinSaltos(() => {
    medir();
    colocar();
    rotular(0);
  });
  observador.observe(raiz);
  document.fonts?.ready.then(() => { if (!signal.aborted) ajustarLomos(); });

  return {
    abrir,
    cerrar,
    activar: (cual) => activar(typeof cual === 'number' ? cual : libros.findIndex((l) => l.id === cual)),
    destruir() {
      volverAlAlto();
      control.abort();
      observador.disconnect();
      cancelAnimationFrame(sigue.cuadro);
      for (const t of salidas.values()) clearTimeout(t);
      raiz.remove();
    },
  };
}
