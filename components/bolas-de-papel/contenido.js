// Lo que hay escrito o impreso en cada hoja. Se dibuja una vez en un canvas
// y la forma lo usa como textura, así que se ve también dentro de la bola.
//
// Tipos de papel (en papeles/lista.json). Las rutas de imagen son relativas a la lista.
//   nota    escrita a mano. "lineas" son los renglones (uno entre ~tildes~ sale tachado)
//           y "fecha" va arriba a la derecha. "papel" puede ser cuaderno (por defecto),
//           liso o postit.
//   carta   escrita a máquina. "titulo" es el membrete, "fecha", "parrafos", "firma"
//           (a mano), "nombre" (a máquina bajo la firma) y "sello" (un timbre rojo).
//   dibujo  una imagen sobre papel, como un boceto escaneado. Va mejor un PNG con fondo
//           transparente, porque se mezcla con el papel. "papel" puede ser liso,
//           cuaderno o cuadriculado.
//   foto    una imagen impresa. "marco" puede ser borde (por defecto), polaroid o ninguno,
//           y "pie" se escribe a mano en el borde de abajo.

import { generador, semillaDe } from './ruido.js';

const LETRA = 'Caveat';
const MAQUINA = '"Special Elite"';
const TINTA = '#27324f';
const TINTA_MAQUINA = '#26262b';
const FUENTES = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400..600&family=Special+Elite&display=swap';

// Colores de cada papel. El acabado limpio es blanco neutro, para que no choque con la página.
const PAPELES = {
  gastado: {
    cuaderno: '#f3f0e7', liso: '#f4f2ec', cuadriculado: '#f4f3ee', postit: '#f4dc6e', carta: '#f6f4ef', foto: '#f7f5ef',
  },
  limpio: {
    cuaderno: '#fbfbf9', liso: '#fcfcfb', cuadriculado: '#fbfbfa', postit: '#f7eaa8', carta: '#fcfcfb', foto: '#fdfdfc',
  },
};

const aRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// Color del papel y de su dorso (un poco más apagado) en 0..1, para el shader.
function colores(tono) {
  const rgb = aRgb(tono);
  return { tono: rgb, dorso: rgb.map((c) => c * 0.96) };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function cargarLetra() {
  if (!document.querySelector('link[data-bolas-de-papel]')) {
    const enlace = document.createElement('link');
    enlace.rel = 'stylesheet';
    enlace.href = FUENTES;
    enlace.dataset.bolasDePapel = '';
    const listo = new Promise((r) => { enlace.onload = r; enlace.onerror = r; });
    document.head.append(enlace);
    await Promise.race([listo, espera(2500)]);
  }
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 40px ${LETRA}`),
        document.fonts.load(`600 40px ${LETRA}`),
        document.fonts.load(`400 20px ${MAQUINA}`),
      ]),
      espera(2500),
    ]);
  } catch {
    // Sin las letras se usan la cursiva y la monoespaciada del sistema.
  }
}

function cargarImagen(url) {
  return new Promise((resolver, fallar) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolver(img);
    img.onerror = fallar;
    img.src = url;
  });
}

function crearLienzo(ancho, alto, escala) {
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  return { lienzo, ctx: lienzo.getContext('2d', { willReadFrequently: true }) };
}

// Papel con grano, manchas suaves y los bordes un poco más gastados.
// El limpio lleva apenas grano, sin manchas ni bordes gastados.
function fondoDePapel(ctx, w, h, azar, tono, limpio) {
  ctx.fillStyle = tono;
  ctx.fillRect(0, 0, w, h);

  for (let k = 0; k < (limpio ? 0 : 7); k++) {
    const x = azar() * w;
    const y = azar() * h;
    const r = (0.25 + azar() * 0.5) * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150, 125, 85, ${0.025 + azar() * 0.03})`);
    g.addColorStop(1, 'rgba(150, 125, 85, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const borde = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  borde.addColorStop(0, 'rgba(120, 100, 70, 0)');
  borde.addColorStop(1, `rgba(120, 100, 70, ${limpio ? 0.02 : 0.07})`);
  ctx.fillStyle = borde;
  ctx.fillRect(0, 0, w, h);

  const datos = ctx.getImageData(0, 0, w, h);
  const px = datos.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = (azar() - 0.5) * (limpio ? 3.5 : 9);
    px[i] += g;
    px[i + 1] += g;
    px[i + 2] += g;
  }
  ctx.putImageData(datos, 0, 0);
}

// Renglones o cuadrícula muy tenues.
function rayar(ctx, tipo, ancho, alto, { arriba = 46, interlinea = 25 } = {}) {
  ctx.save();
  if (tipo === 'cuaderno') {
    ctx.strokeStyle = 'rgba(70, 110, 170, 0.13)';
    ctx.lineWidth = 0.7;
    for (let y = arriba; y < alto - 12; y += interlinea) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(ancho, y + 0.5);
      ctx.stroke();
    }
  } else if (tipo === 'cuadriculado') {
    ctx.strokeStyle = 'rgba(70, 120, 180, 0.15)';
    ctx.lineWidth = 0.5;
    const paso = 10;
    for (let x = paso / 2; x < ancho; x += paso) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, alto);
      ctx.stroke();
    }
    for (let y = paso / 2; y < alto; y += paso) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ancho, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Escribe un renglón a mano con un leve temblor. Devuelve el ancho escrito.
function escribir(ctx, texto, x, y, tam, azar, { peso = 450, tachado = false, tinta = TINTA } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((azar() - 0.5) * 0.025);
  ctx.font = `${peso} ${tam}px ${LETRA}, "Segoe Script", cursive`;
  ctx.fillStyle = tinta;
  ctx.globalAlpha = 0.88 + azar() * 0.1;
  ctx.fillText(texto, 0, 0);
  const ancho = ctx.measureText(texto).width;
  if (tachado) {
    ctx.strokeStyle = tinta;
    ctx.lineWidth = tam * 0.075;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const yt = -tam * 0.27;
    ctx.moveTo(-tam * 0.12, yt + (azar() - 0.5) * tam * 0.1);
    const pasos = 6;
    for (let k = 1; k <= pasos; k++) {
      ctx.lineTo(-tam * 0.12 + ((ancho + tam * 0.24) * k) / pasos, yt + (azar() - 0.5) * tam * 0.14);
    }
    ctx.stroke();
  }
  ctx.restore();
  return ancho;
}

// Escribe a máquina, letra por letra, con la tinta despareja y algún tipo corrido.
function teclear(ctx, texto, x, y, tam, azar, { espacio = 0 } = {}) {
  ctx.save();
  ctx.font = `400 ${tam}px ${MAQUINA}, "Courier New", monospace`;
  ctx.fillStyle = TINTA_MAQUINA;
  let cx = x;
  for (const letra of texto) {
    ctx.globalAlpha = 0.68 + azar() * 0.3;
    ctx.fillText(letra, cx + (azar() - 0.5) * 0.25, y + (azar() - 0.5) * 0.35);
    cx += ctx.measureText(letra).width + espacio;
  }
  ctx.restore();
  return cx - x;
}

// Parte un texto en renglones que entren en el ancho, con la letra que tenga ctx.
function partir(ctx, texto, anchoMax) {
  const palabras = texto.split(/\s+/);
  const renglones = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > anchoMax && actual) {
      renglones.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}

function dibujarNota(papel, escala, limpio) {
  const tipo = papel.papel === 'postit' || papel.papel === 'liso' ? papel.papel : 'cuaderno';
  const postit = tipo === 'postit';
  const ancho = postit ? 176 : 200;
  const alto = postit ? 176 : 258;
  const { lienzo, ctx } = crearLienzo(ancho, alto, escala);
  const azar = generador(semillaDe(papel.id));
  const tono = PAPELES[limpio ? 'limpio' : 'gastado'][tipo];
  fondoDePapel(ctx, lienzo.width, lienzo.height, azar, tono, limpio);
  ctx.scale(escala, escala);

  const tam = postit ? 23 : 21;
  const interlinea = postit ? 27 : 25;
  const arriba = postit ? 22 : 46;
  if (postit) {
    // La franja de pegamento queda un poco más oscura.
    const franja = ctx.createLinearGradient(0, 0, 0, 34);
    franja.addColorStop(0, 'rgba(150, 110, 0, 0.09)');
    franja.addColorStop(1, 'rgba(150, 110, 0, 0)');
    ctx.fillStyle = franja;
    ctx.fillRect(0, 0, ancho, 34);
  } else {
    rayar(ctx, tipo, ancho, alto, { arriba, interlinea });
  }

  if (papel.fecha) {
    ctx.font = `400 15px ${LETRA}, cursive`;
    const w = ctx.measureText(papel.fecha).width;
    escribir(ctx, papel.fecha, ancho - 18 - w, postit ? 24 : 28, 15, azar);
  }

  ctx.font = `450 ${tam}px ${LETRA}, cursive`;
  let y = arriba - 6 + (postit && papel.fecha ? 14 : 0);
  for (const linea of papel.lineas || []) {
    const tachado = /^~.*~$/.test(linea);
    const texto = tachado ? linea.slice(1, -1) : linea;
    for (const renglon of partir(ctx, texto, ancho - 40)) {
      y += interlinea;
      if (y > alto - 14) break;
      escribir(ctx, renglon, 20 + (azar() - 0.5) * 3, y, tam, azar, { tachado });
    }
  }
  return { lienzo, ancho, alto, brillo: 0.05, ...colores(tono) };
}

// Timbre de goma, con doble marco, letras mayúsculas y la tinta comida en partes.
// Se dibuja en un canvas aparte para que los huecos no perforen el papel.
function sellar(ctx, texto, cx, cy, azar) {
  const tam = 10;
  const fuente = `400 ${tam}px ${MAQUINA}, "Courier New", monospace`;
  ctx.save();
  ctx.font = fuente;
  const w = ctx.measureText(texto).width + texto.length * 1.6 + 16;
  ctx.restore();
  const h = 22;
  const escala = ctx.getTransform().a;
  const timbre = document.createElement('canvas');
  timbre.width = Math.ceil((w + 6) * escala);
  timbre.height = Math.ceil((h + 6) * escala);
  const t = timbre.getContext('2d');
  t.scale(escala, escala);
  t.translate((w + 6) / 2, (h + 6) / 2);
  t.font = fuente;
  t.strokeStyle = '#b8322d';
  t.fillStyle = '#b8322d';
  t.lineWidth = 1.4;
  t.strokeRect(-w / 2, -h / 2, w, h);
  t.lineWidth = 0.6;
  t.strokeRect(-w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5);
  let x = -w / 2 + 8;
  for (const letra of texto) {
    t.fillText(letra, x, tam * 0.36);
    x += t.measureText(letra).width + 1.6;
  }
  // Huecos donde la goma no tomó tinta.
  t.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 45; k++) {
    t.beginPath();
    t.arc((azar() - 0.5) * w, (azar() - 0.5) * h, 0.25 + azar() * 0.6, 0, Math.PI * 2);
    t.fill();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.14 + (azar() - 0.5) * 0.06);
  ctx.globalAlpha = 0.78;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(timbre, -(w + 6) / 2, -(h + 6) / 2, w + 6, h + 6);
  ctx.restore();
}

function dibujarCarta(papel, escala, limpio) {
  const ancho = 200;
  const alto = 258;
  const { lienzo, ctx } = crearLienzo(ancho, alto, escala);
  const azar = generador(semillaDe(papel.id));
  const tono = PAPELES[limpio ? 'limpio' : 'gastado'].carta;
  fondoDePapel(ctx, lienzo.width, lienzo.height, azar, tono, limpio);
  ctx.scale(escala, escala);

  const margen = 18;
  let y = 28;
  if (papel.titulo) {
    ctx.font = `400 10px ${MAQUINA}, monospace`;
    const espacio = 2.2;
    const w = ctx.measureText(papel.titulo).width + papel.titulo.length * espacio;
    teclear(ctx, papel.titulo, (ancho - w) / 2, y, 10, azar, { espacio });
    ctx.strokeStyle = 'rgba(38, 38, 43, 0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(margen, y + 7);
    ctx.lineTo(ancho - margen, y + 7);
    ctx.stroke();
    y += 24;
  }
  if (papel.fecha) {
    ctx.font = `400 7px ${MAQUINA}, monospace`;
    teclear(ctx, papel.fecha, ancho - margen - ctx.measureText(papel.fecha).width, y, 7, azar);
    y += 16;
  }

  const tam = 7.4;
  const interlinea = 10.6;
  ctx.font = `400 ${tam}px ${MAQUINA}, monospace`;
  for (const parrafo of papel.parrafos || []) {
    for (const renglon of partir(ctx, parrafo, ancho - margen * 2)) {
      if (y > alto - 58) break;
      teclear(ctx, renglon, margen, y, tam, azar);
      y += interlinea;
    }
    y += 5;
  }

  if (papel.firma) {
    y += 14;
    escribir(ctx, papel.firma, margen + 4, y, 24, azar, { peso: 500 });
    if (papel.nombre) teclear(ctx, papel.nombre, margen, y + 13, 7, azar);
  }
  if (papel.sello) sellar(ctx, papel.sello, ancho - 58, alto - 34, azar);
  return { lienzo, ancho, alto, brillo: 0.05, ...colores(tono) };
}

async function dibujarDibujo(papel, escala, base, limpio) {
  const img = await cargarImagen(new URL(papel.imagen, base).href);
  const proporcion = img.naturalWidth / img.naturalHeight;
  const ancho = proporcion >= 1 ? 236 : 200;
  const alto = Math.round(ancho / proporcion);
  const tipo = papel.papel === 'cuaderno' || papel.papel === 'cuadriculado' ? papel.papel : 'liso';
  const { lienzo, ctx } = crearLienzo(ancho, alto, escala);
  const azar = generador(semillaDe(papel.id));
  const tono = PAPELES[limpio ? 'limpio' : 'gastado'][tipo];
  fondoDePapel(ctx, lienzo.width, lienzo.height, azar, tono, limpio);
  ctx.scale(escala, escala);
  rayar(ctx, tipo, ancho, alto);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.92;
  ctx.drawImage(img, 0, 0, ancho, alto);
  return { lienzo, ancho, alto, brillo: 0.05, ...colores(tono) };
}

async function dibujarFoto(papel, escala, base, limpio) {
  const img = await cargarImagen(new URL(papel.imagen, base).href);
  const proporcion = img.naturalWidth / img.naturalHeight;
  const marco = papel.marco === 'polaroid' || papel.marco === 'ninguno' ? papel.marco : 'borde';

  // Recorte de la imagen (para la polaroid, el cuadrado del centro) y medidas de la hoja.
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  let ancho, alto, borde, abajo;
  if (marco === 'polaroid') {
    const lado = Math.min(sw, sh);
    sx = (sw - lado) / 2;
    sy = (sh - lado) / 2;
    sw = sh = lado;
    ancho = 196;
    borde = 11;
    abajo = 48;
    alto = ancho - borde * 2 + borde + abajo;
  } else {
    const largo = marco === 'ninguno' ? 236 : 228;
    borde = marco === 'ninguno' ? 0 : 9;
    abajo = marco === 'ninguno' ? 0 : papel.pie ? 34 : borde;
    if (proporcion >= 1) {
      ancho = largo;
      alto = Math.round((ancho - borde * 2) / proporcion + borde + abajo);
    } else {
      alto = largo;
      ancho = Math.round((alto - borde - abajo) * proporcion + borde * 2);
    }
  }

  const { lienzo, ctx } = crearLienzo(ancho, alto, escala);
  const azar = generador(semillaDe(papel.id));
  const tono = PAPELES[limpio ? 'limpio' : 'gastado'].foto;
  fondoDePapel(ctx, lienzo.width, lienzo.height, azar, tono, limpio);
  ctx.scale(escala, escala);

  const iw = ancho - borde * 2;
  const ih = alto - borde - abajo;
  ctx.drawImage(img, sx, sy, sw, sh, borde, borde, iw, ih);
  // Un velo cálido y apenas apagado para que parezca impreso y no una pantalla.
  if (!limpio) {
    ctx.fillStyle = 'rgba(235, 220, 190, 0.12)';
    ctx.fillRect(borde, borde, iw, ih);
  }
  if (borde) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(borde + 0.25, borde + 0.25, iw - 0.5, ih - 0.5);
  }

  if (papel.pie && abajo > 20) {
    const tam = marco === 'polaroid' ? 22 : 19;
    escribir(ctx, papel.pie, borde + (marco === 'polaroid' ? 6 : 4), alto - (marco === 'polaroid' ? 17 : 11), tam, azar);
  }
  return { lienzo, ancho, alto, brillo: marco === 'ninguno' ? 0.2 : 0.14, ...colores(tono) };
}

// limpio usa el papel blanco neutro del acabado suave y del de facetas.
export function dibujarPapel(papel, base, { limpio = false } = {}) {
  const escala = Math.min(2, Math.max(1, window.devicePixelRatio || 1)) * 1.3;
  if (papel.tipo === 'foto') return dibujarFoto(papel, escala, base, limpio);
  if (papel.tipo === 'dibujo') return dibujarDibujo(papel, escala, base, limpio);
  if (papel.tipo === 'carta') return Promise.resolve(dibujarCarta(papel, escala, limpio));
  return Promise.resolve(dibujarNota(papel, escala, limpio));
}
