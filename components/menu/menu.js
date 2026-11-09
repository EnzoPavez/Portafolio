// Barra de arriba, de borde a borde y sin caja. A la izquierda la firma chica y el menú,
// a la derecha el contacto, el cambio de modo claro u oscuro y la hora de Salamanca.
//
// En la portada la firma grande está sobre el nombre. La chica de la barra aparece recién
// cuando la grande sale de la vista, y se escribe igual que ella. Al volver arriba se borra.
// En las páginas sin firma grande, la chica se escribe al cargar y queda.
//
// Uso
//   import { montarMenu } from './components/menu/menu.js';
//   montarMenu({
//     origen: document.querySelector('.firma'),   (opcional) donde va la firma grande
//     inicio: '#inicio',                           a dónde lleva la firma de la barra
//     correo: 'yo@ejemplo.com',
//     enlaces: [{ texto: 'Proyectos', href: '#proyectos' }, ...],
//   });
//
// Un enlace con actual: true es la página en la que se está; se marca con aria-current.
//
// El modo claro u oscuro se guarda en el navegador y se aplica con data-tema en <html>.
// Para que no parpadee al cargar, cada página lo lee en el <head> (ver index.html).

import { montarFirma } from '../firma/firma.js';

const ESTILOS = new URL('./menu.css', import.meta.url);
const ZONA = 'Europe/Madrid';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LUNA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';
const SOL = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';

function cargarEstilos() {
  if (document.querySelector('link[data-menu]')) return Promise.resolve();
  const enlace = document.createElement('link');
  enlace.rel = 'stylesheet';
  enlace.href = ESTILOS.href;
  enlace.dataset.menu = '';
  const listo = new Promise((r) => { enlace.onload = r; enlace.onerror = r; });
  document.head.append(enlace);
  return listo;
}

// Modo claro u oscuro
const sistemaOscuro = () => matchMedia('(prefers-color-scheme: dark)').matches;
const temaActual = () => document.documentElement.dataset.tema || (sistemaOscuro() ? 'oscuro' : 'claro');

function guardarTema(tema) {
  document.documentElement.dataset.tema = tema;
  try { localStorage.setItem('tema', tema); } catch { /* sin almacenamiento, vale solo para esta visita */ }
}

export async function montarMenu({ enlaces = [], inicio = '#', origen = null, correo = '', retraso = 650 } = {}) {
  await cargarEstilos();

  const lista = enlaces.map((e) => `<li><a class="menu-enlace" href="${esc(e.href)}"${e.actual ? ' aria-current="page"' : ''}>${esc(e.texto)}</a></li>`).join('');
  const contacto = correo ? `<a class="menu-contacto" href="mailto:${esc(correo)}">Escríbeme</a>` : '';
  const barra = document.createElement('header');
  barra.className = 'menu';
  barra.innerHTML = `
    <a class="menu-inicio" href="${esc(inicio)}" aria-label="Enzo Pavez, ir al inicio"><span class="menu-firma"></span></a>
    <nav class="menu-nav" aria-label="Secciones"><ul class="menu-lista">${lista}</ul></nav>
    <div class="menu-derecha">
      ${contacto}
      <button class="menu-tema" type="button"></button>
      <span class="menu-hora" title="Hora en Salamanca"><span class="menu-zona"></span><span class="menu-raya" aria-hidden="true"></span><time class="menu-reloj"></time></span>
    </div>
    <button class="menu-boton" type="button" aria-expanded="false" aria-controls="menu-panel">Menú</button>
    <div class="menu-panel" id="menu-panel" hidden>
      <nav aria-label="Secciones"><ul>${lista}</ul></nav>
      <div class="menu-panel-pie">${contacto}<button class="menu-tema" type="button"></button></div>
    </div>`;
  document.body.prepend(barra);

  // La niebla de debajo de la barra solo aparece cuando ya se bajó algo
  const marcarBajada = () => barra.classList.toggle('menu-bajando', scrollY > 8);
  addEventListener('scroll', marcarBajada, { passive: true });
  marcarBajada();

  // Firma de la barra
  const firmaChica = await montarFirma(barra.querySelector('.menu-firma'), { automatico: false, retraso: 0, duracion: 1100 });
  const lugar = barra.querySelector('.menu-firma');

  if (origen) {
    await montarFirma(origen, { retraso });
    // Aparece cuando la grande ya casi no se ve, y se borra cuando vuelve
    let visible = false;
    const vigia = new IntersectionObserver(([e]) => {
      const fuera = e.intersectionRatio < 0.3;
      if (fuera === visible) return;
      visible = fuera;
      lugar.classList.toggle('menu-firma-visible', fuera);
      if (fuera) firmaChica.dibujar();
      // Se borra después de desvanecerse, salvo que haya vuelto a aparecer
      else setTimeout(() => { if (!visible) firmaChica.ocultar(); }, 260);
    }, { threshold: [0, 0.3, 0.6, 1], rootMargin: '-46px 0px 0px 0px' });
    vigia.observe(origen);
  } else {
    lugar.classList.add('menu-firma-visible');
    firmaChica.dibujar();
  }

  // Modo claro u oscuro. El botón dice el modo al que se cambia, como un interruptor.
  const botonesTema = [...barra.querySelectorAll('.menu-tema')];
  const pintarTema = () => {
    const oscuro = temaActual() === 'oscuro';
    for (const b of botonesTema) {
      b.innerHTML = `${oscuro ? SOL : LUNA}<span>${oscuro ? 'Claro' : 'Oscuro'}</span>`;
      b.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    }
  };
  for (const b of botonesTema) {
    b.addEventListener('click', () => {
      guardarTema(temaActual() === 'oscuro' ? 'claro' : 'oscuro');
      pintarTema();
    });
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', pintarTema);
  pintarTema();

  // Hora de Salamanca, con su desfase (GMT+1 en invierno, GMT+2 en verano)
  const reloj = barra.querySelector('.menu-reloj');
  const zona = barra.querySelector('.menu-zona');
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const desfase = new Intl.DateTimeFormat('en', { timeZone: ZONA, timeZoneName: 'shortOffset' });
  const tic = () => {
    const ahora = new Date();
    reloj.textContent = hora.format(ahora);
    reloj.dateTime = ahora.toISOString();
    zona.textContent = desfase.formatToParts(ahora).find((p) => p.type === 'timeZoneName')?.value ?? '';
  };
  tic();
  setInterval(tic, 1000);

  // Menú del celular
  const boton = barra.querySelector('.menu-boton');
  const panel = barra.querySelector('.menu-panel');
  const abrirPanel = (abrir) => {
    panel.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    barra.classList.toggle('menu-abierto', abrir);
  };
  boton.addEventListener('click', () => abrirPanel(panel.hidden));
  panel.addEventListener('click', (e) => { if (e.target.closest('a')) abrirPanel(false); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      abrirPanel(false);
      boton.focus();
    }
  });
  document.addEventListener('click', (e) => { if (!panel.hidden && !barra.contains(e.target)) abrirPanel(false); });
}
