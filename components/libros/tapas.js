// Lomos y tapas de los libros. Si un libro no trae imagen de tapa, se dibuja una
// con su color, su título y un motivo geométrico, así la estantería se ve completa
// aunque falten las tapas reales. Lo mismo para el lomo, que siempre se dibuja.
//
// Campos de cada libro que se usan acá (ver lista.json)
//   titulo, autor     lo que va escrito en la tapa y en el lomo
//   autorLomo         el apellido que va en el lomo, si no es la última palabra del autor
//   color             un nombre de PALETA, un hex (#2f4b3f) o { fondo, texto, acento }
//   motivo            uno de MOTIVOS. Si no viene, sale uno fijo a partir del título
//   simbolo           uno de SIMBOLOS, el ícono de la cabeza del lomo. Si no viene, el lomo
//                     usa la versión chica del motivo
//   portada           imagen de la tapa, relativa a lista.json. Si viene, reemplaza la dibujada
//   insignia          imagen de una insignia (relativa a la lista). La tapa pasa a ser un
//                     certificado: fondo azul marino, tarjeta blanca, la insignia y el nombre.
//                     Usa también "emisor" (arriba) y "fechaTapa" (abajo).
//                     Con estiloTapa "diploma" es un diploma: papel del color del libro,
//                     doble filete, la insignia (el logo) arriba y el título completo

// Colores apagados, para que la estantería no le gane a la página.
export const PALETA = {
  bosque: { fondo: '#2f4b3f', texto: '#ece6d6', acento: '#d9a441' },
  tinta: { fondo: '#26365a', texto: '#e9e6dd', acento: '#e0b25c' },
  ladrillo: { fondo: '#8a3a2c', texto: '#f2e8da', acento: '#f0c987' },
  hueso: { fondo: '#ebe5d8', texto: '#2a2724', acento: '#a8432f' },
  grafito: { fondo: '#2a2a2c', texto: '#ebe6dc', acento: '#d8b26a' },
  arena: { fondo: '#d3c09d', texto: '#2a251e', acento: '#7c3b2a' },
  salvia: { fondo: '#93a18a', texto: '#1e241d', acento: '#f3ecdb' },
  mostaza: { fondo: '#c99a3d', texto: '#211b11', acento: '#f5ead1' },
  ciruela: { fondo: '#4a2f3f', texto: '#eee2e6', acento: '#e7a77d' },
  niebla: { fondo: '#cfd2cf', texto: '#232425', acento: '#2f4b6b' },
  certificado: { fondo: '#1d3a6b', texto: '#eef2f8', acento: '#8ab4f8' },
  oceano: { fondo: '#2c5868', texto: '#e7eeec', acento: '#f0c78a' },
};

export const MOTIVOS = ['montanas', 'sol', 'olas', 'circulos', 'rejilla', 'arcos', 'laberinto', 'tunel'];

const NOMBRES = Object.keys(PALETA);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export function semillaDe(texto) {
  let h = 2166136261;
  for (const c of String(texto)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Números al azar repetibles (mulberry32). La misma semilla dibuja siempre la misma tapa.
export function generador(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const sobre = (hex) => (luminancia(hex) > 0.3 ? '#232220' : '#efebe2');

export function colores(libro) {
  const c = libro.color;
  if (typeof c === 'string' && PALETA[c]) return PALETA[c];
  if (typeof c === 'string' && HEX.test(c)) return { fondo: c, texto: sobre(c), acento: sobre(c) };
  if (c && typeof c === 'object' && HEX.test(c.fondo)) {
    return { fondo: c.fondo, texto: c.texto ?? sobre(c.fondo), acento: c.acento ?? c.texto ?? sobre(c.fondo) };
  }
  return PALETA[NOMBRES[semillaDe(libro.id) % NOMBRES.length]];
}

export function motivoDe(libro) {
  return MOTIVOS.includes(libro.motivo) ? libro.motivo : MOTIVOS[semillaDe(`${libro.id}:motivo`) % MOTIVOS.length];
}

// "Gabriel García Márquez" daría "Márquez", por eso existe autorLomo.
// Con varios autores ("Andrew Hunt y David Thomas") va el apellido de cada uno.
function apellido(libro) {
  if (libro.autorLomo != null) return libro.autorLomo;
  if (!libro.autor) return '';
  return libro.autor
    .split(/\s+y\s+|\s*&\s*|,\s*/)
    .map((nombre) => nombre.trim().split(/\s+/).at(-1))
    .join(' y ');
}

// Variables de color para el elemento que contiene el lomo o la tapa.
export function estiloColores(libro) {
  const c = colores(libro);
  return `--c-fondo:${c.fondo};--c-texto:${c.texto};--c-acento:${c.acento}`;
}

export function lomoHTML(libro) {
  const icono = SIMBOLOS[libro.simbolo] ?? ICONOS[motivoDe(libro)];
  return `
    <svg class="lb-lomo-icono" viewBox="0 0 20 20" aria-hidden="true">${icono}</svg>
    <span class="lb-lomo-titulo">${esc(libro.tituloLomo ?? libro.titulo)}</span>
    <span class="lb-lomo-autor">${esc(apellido(libro))}</span>
    <span class="lb-lomo-marca"></span>`;
}

export function tapaHTML(libro, base) {
  if (libro.insignia) {
    const src = new URL(libro.insignia, base).href;
    const diploma = libro.estiloTapa === 'diploma';
    return `
    <div class="lb-tapa-cert" data-estilo="${diploma ? 'diploma' : 'certificado'}">
      <div class="lb-tapa-cert-hoja">
        ${libro.emisor ? `<span class="lb-tapa-cert-emisor">${esc(libro.emisor)}</span>` : ''}
        <span class="lb-tapa-cert-titulo">${esc(diploma ? libro.titulo : (libro.tituloLomo ?? libro.titulo))}</span>
        <img class="lb-tapa-cert-insignia" src="${esc(src)}" alt="" decoding="async" draggable="false">
        ${libro.fechaTapa ? `<span class="lb-tapa-cert-fecha">${esc(libro.fechaTapa)}</span>` : ''}
      </div>
    </div>`;
  }
  if (libro.portada) {
    const src = new URL(libro.portada, base).href;
    return `<img class="lb-tapa-img" src="${esc(src)}" alt="" decoding="async" draggable="false">`;
  }
  const motivo = motivoDe(libro);
  const azar = generador(semillaDe(`${libro.id}:${motivo}`));
  const largo = libro.titulo.length > 30 ? 'largo' : libro.titulo.length > 15 ? 'medio' : 'corto';
  return `
    <div class="lb-tapa-gen" data-largo="${largo}">
      <svg class="lb-tapa-gen-motivo" viewBox="0 0 100 80" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${DIBUJOS[motivo](azar)}</svg>
      <span class="lb-tapa-gen-autor">${esc(libro.autor ?? '')}</span>
      <span class="lb-tapa-gen-titulo">${esc(libro.titulo)}</span>
    </div>`;
}

// Motivos de la tapa. Ocupan la parte de abajo (viewBox 100 x 80, pegado abajo) y
// usan las clases de color de libros.css (relleno o trazo con fondo, texto o acento).
const n = (v) => Math.round(v * 10) / 10;
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

const DIBUJOS = {
  montanas(r) {
    let s = `<circle class="lb-m-acento" cx="${n(58 + r() * 26)}" cy="${n(16 + r() * 8)}" r="${n(7 + r() * 4)}"/>`;
    for (const [base, amp, op] of [[34, 15, 0.22], [47, 13, 0.45], [61, 10, 0.9]]) {
      const puntos = [];
      let y = base + (r() - 0.5) * amp;
      for (let x = 0; x <= 100; x += 5) {
        y = limitar(y + (r() - 0.5) * amp * 0.8, base - amp, base + amp * 0.6);
        puntos.push(`${x},${n(y)}`);
      }
      s += `<polygon class="lb-m-texto" opacity="${op}" points="0,80 ${puntos.join(' ')} 100,80"/>`;
    }
    return s;
  },

  sol(r) {
    const cx = n(44 + r() * 12);
    let s = `<circle class="lb-m-acento" cx="${cx}" cy="40" r="25"/>`;
    for (let i = 0; i < 6; i++) {
      s += `<rect class="lb-m-fondo" x="0" y="${n(43 + i * 4)}" width="100" height="${n(0.6 + i * 0.55)}"/>`;
    }
    for (let i = 0; i < 4; i++) {
      const ancho = 30 + r() * 60;
      s += `<rect class="lb-m-texto" opacity="${0.55 - i * 0.1}" x="${n((100 - ancho) / 2)}" y="${69 + i * 3}" width="${n(ancho)}" height=".7"/>`;
    }
    return s;
  },

  olas(r) {
    const destacada = Math.floor(r() * 8);
    let s = '';
    for (let i = 0; i < 9; i++) {
      const y0 = 12 + i * 7.6;
      const amp = 1.5 + r() * 2.5;
      const frec = 0.08 + r() * 0.05;
      const fase = r() * Math.PI * 2;
      let d = `M0 ${n(y0 + Math.sin(fase) * amp)}`;
      for (let x = 4; x <= 100; x += 4) d += `L${x} ${n(y0 + Math.sin(x * frec + fase) * amp)}`;
      const es = i === destacada;
      s += `<path class="${es ? 'lb-t-acento' : 'lb-t-texto'}" stroke-width="${es ? 2 : 1.1}" opacity="${es ? 1 : 0.55}" d="${d}"/>`;
    }
    return s;
  },

  circulos(r) {
    const cx = n(40 + r() * 20);
    const cy = n(38 + r() * 10);
    let s = `<circle class="lb-m-acento" cx="${cx}" cy="${cy}" r="11"/>`;
    for (let radio = 16; radio < 72; radio += 6) {
      s += `<circle class="lb-t-texto" stroke-width=".9" opacity=".45" cx="${cx}" cy="${cy}" r="${radio}"/>`;
    }
    return s;
  },

  rejilla(r) {
    let s = '';
    for (let x = 6; x <= 94; x += 8) {
      for (let y = 12; y <= 76; y += 8) s += `<circle class="lb-m-texto" opacity=".3" cx="${x}" cy="${y}" r=".8"/>`;
    }
    const puntos = [];
    let y = 52 + r() * 16;
    for (let x = 6; x <= 94; x += 8) {
      y = limitar(y + (r() - 0.6) * 16, 14, 74);
      puntos.push([x, n(y)]);
    }
    s += `<polyline class="lb-t-acento" stroke-width="1.6" points="${puntos.map((p) => p.join(',')).join(' ')}"/>`;
    s += puntos.filter((_, i) => i % 3 === 0).map(([x, py]) => `<circle class="lb-m-acento" cx="${x}" cy="${py}" r="1.9"/>`).join('');
    return s;
  },

  arcos(r) {
    const cx = n(42 + r() * 16);
    let s = '';
    for (let i = 0; i < 8; i++) {
      const radio = 58 - i * 7;
      s += `<path class="${i % 2 ? 'lb-m-fondo' : 'lb-m-acento'}" d="M${n(cx - radio)} 80A${radio} ${radio} 0 0 1 ${n(cx + radio)} 80Z"/>`;
    }
    return s;
  },

  laberinto(r) {
    const cx = 50;
    const cy = 45;
    let s = '';
    for (let i = 1; i <= 6; i++) {
      const lado = i * 11;
      const x = cx - lado / 2;
      const y = cy - lado / 2;
      s += `<rect class="lb-t-texto" stroke-width="1.3" opacity=".75" x="${n(x)}" y="${n(y)}" width="${lado}" height="${lado}"/>`;
      // Una salida en cada vuelta, en un lado al azar
      const cara = Math.floor(r() * 4);
      const t = 0.2 + r() * 0.6;
      const hueco = [
        [x + t * lado - 2, y - 1.5, 4, 3],
        [x + lado - 1.5, y + t * lado - 2, 3, 4],
        [x + t * lado - 2, y + lado - 1.5, 4, 3],
        [x - 1.5, y + t * lado - 2, 3, 4],
      ][cara];
      s += `<rect class="lb-m-fondo" x="${n(hueco[0])}" y="${n(hueco[1])}" width="${hueco[2]}" height="${hueco[3]}"/>`;
    }
    return `${s}<rect class="lb-m-acento" x="${cx - 3}" y="${cy - 3}" width="6" height="6"/>`;
  },

  tunel(r) {
    const vx = 50 + (r() - 0.5) * 16;
    const vy = 44;
    let s = '';
    for (const [x, y] of [[0, 0], [100, 0], [0, 80], [100, 80]]) {
      s += `<line class="lb-t-texto" stroke-width=".7" opacity=".3" x1="${x}" y1="${y}" x2="${n(vx)}" y2="${vy}"/>`;
    }
    for (let i = 0; i < 9; i++) {
      const t = (i / 9) ** 1.6;
      const ancho = 100 * (1 - t) + 8 * t;
      const alto = 80 * (1 - t) + 6 * t;
      const x = t * (vx - 4);
      const y = t * (vy - 3);
      s += `<rect class="lb-t-texto" stroke-width=".8" opacity=".5" x="${n(x)}" y="${n(y)}" width="${n(ancho)}" height="${n(alto)}"/>`;
    }
    return `${s}<rect class="lb-m-acento" x="${n(vx - 4)}" y="${vy - 3}" width="8" height="6"/>`;
  },
};

// Versión chica de cada motivo para la cabeza del lomo (viewBox 20 x 20).
const ICONOS = {
  montanas: '<path class="lb-m-acento" d="M1 17 7.5 6.5l4 6 2.5-3.5L19 17Z"/>',
  sol: '<circle class="lb-m-acento" cx="10" cy="10" r="6.5"/>',
  olas: '<path class="lb-t-acento" stroke-width="1.6" d="M2 8q2-2.5 4 0t4 0 4 0 4 0M2 13q2-2.5 4 0t4 0 4 0 4 0"/>',
  circulos: '<circle class="lb-t-acento" stroke-width="1.5" cx="10" cy="10" r="7"/><circle class="lb-m-acento" cx="10" cy="10" r="3"/>',
  rejilla: [4, 10, 16].flatMap((x) => [4, 10, 16].map((y) => `<circle class="lb-m-acento" cx="${x}" cy="${y}" r="1.6"/>`)).join(''),
  arcos: '<path class="lb-t-acento" stroke-width="1.6" d="M3 16a7 7 0 0 1 14 0M6.5 16a3.5 3.5 0 0 1 7 0"/>',
  laberinto: '<path class="lb-t-acento" stroke-width="1.5" d="M8 3H3v14h14V3h-5M7 7h6v6H7z"/>',
  tunel: '<path class="lb-t-acento" stroke-width="1.3" d="M2.5 2.5h15v15h-15zM6.5 6.5h7v7h-7zM9 9h2v2H9z"/>',
};

// Íconos con significado para la cabeza del lomo (viewBox 20 x 20), cuando el libro trae
// "simbolo". Sirven para distinguir libros que no son de lectura (habilidades, estudios).
const trazo = (d, ancho = 1.5) => `<path class="lb-t-acento" stroke-width="${ancho}" d="${d}"/>`;
export const SIMBOLOS = {
  diana: `<circle class="lb-t-acento" stroke-width="1.5" cx="10" cy="10" r="7"/><circle class="lb-t-acento" stroke-width="1.5" cx="10" cy="10" r="3.6"/><circle class="lb-m-acento" cx="10" cy="10" r="1.3"/>`,
  pluma: `${trazo('M10 2.5 15 9.5 10 17.5 5 9.5Z')}${trazo('M10 2.5v7')}<circle class="lb-m-acento" cx="10" cy="11" r="1.4"/>`,
  codigo: trazo('M7 6 3 10l4 4M13 6l4 4-4 4M11.3 4.5 8.7 15.5', 1.6),
  base: `<ellipse class="lb-t-acento" stroke-width="1.5" cx="10" cy="5" rx="6" ry="2.3"/>${trazo('M4 5v10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V5M4 10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3')}`,
  capas: `${trazo('M10 3 17 6.8 10 10.6 3 6.8Z')}${trazo('m3 10.2 7 3.8 7-3.8M3 13.6l7 3.8 7-3.8')}`,
  escudo: `${trazo('M10 2.5 16 5v5c0 3.6-2.6 6.4-6 7.5-3.4-1.1-6-3.9-6-7.5V5Z')}${trazo('m7.3 10 2 2 3.6-3.8')}`,
  engranaje: `<circle class="lb-t-acento" stroke-width="1.5" cx="10" cy="10" r="2.5"/><circle class="lb-t-acento" stroke-width="1.5" cx="10" cy="10" r="5.4"/>${trazo('M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4', 1.8)}`,
  grafico: trazo('M3.5 16.5h13M6.3 13.5v-3M10 13.5v-7M13.7 13.5V4.5', 1.7),
  dialogo: `${trazo('M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9.2l-3.7 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z')}${trazo('M7 8.2h6M7 11h3.5')}`,
  insignia: `<circle class="lb-t-acento" stroke-width="1.5" cx="10" cy="8" r="5"/>${trazo('m7.1 12.3-1.3 5.2 4.2-1.9 4.2 1.9-1.3-5.2')}<path class="lb-m-acento" d="m10 5.3.85 1.75 1.9.27-1.38 1.33.33 1.9L10 9.64l-1.7.9.33-1.9-1.38-1.33 1.9-.27Z"/>`,
};
