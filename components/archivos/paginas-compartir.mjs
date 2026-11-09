// Arma una página chica por artículo, solo para compartir (a/<nombre>/index.html).
//
// LinkedIn, WhatsApp y las demás redes no ejecutan JavaScript: leen las etiquetas del HTML
// para armar la vista previa (título, descripción e imagen). Como los artículos se muestran
// todos con la misma página (?a=nombre), cada uno necesita su propia página con sus
// etiquetas. Quien la abre en el navegador pasa enseguida al artículo.
//
// Se corre a mano cada vez que se suma o se cambia un artículo, desde la raíz del repo:
//   node components/archivos/paginas-compartir.mjs
//
// La imagen de la vista previa es imagenes/<nombre>-compartir.jpg (1200 x 630, menos de
// 300 KB para que WhatsApp la muestre). Si no existe, usa la imagen del artículo.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// La dirección pública del sitio (la misma que SITIO en datos.js). Las redes necesitan
// direcciones completas para la página y la imagen.
const SITIO = "https://portafolio-lake-eight.vercel.app";
const RUTA = "/components/archivos/";

const CARPETA = dirname(fileURLToPath(import.meta.url));
const ARTICULOS = join(CARPETA, "articulos");
const SALIDA = join(CARPETA, "a");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// La misma lectura de cabecera que datos.js
function cabecera(texto) {
  const datos = {};
  texto = texto.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  if (!texto.startsWith("---\n")) return datos;
  const fin = texto.indexOf("\n---", 4);
  for (const linea of texto.slice(4, fin).split("\n")) {
    const m = /^\s*([A-Za-zÁÉÍÓÚáéíóúñÑ_]+)\s*:\s*(.*)$/.exec(linea);
    if (!m) continue;
    const clave = m[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    datos[clave] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return datos;
}

function pagina(slug, d) {
  const url = `${SITIO}${RUTA}a/${slug}/`;
  const articulo = `../../?a=${slug}`;
  const titulo = d.titulo || slug;
  const descripcion = d.bajada || "";

  let imagen = "";
  if (d.imagen) {
    const compartir = d.imagen.replace(/(\.[a-z0-9]+)$/i, "-compartir$1");
    const usada = existsSync(join(ARTICULOS, compartir)) ? compartir : d.imagen;
    imagen = `
  <meta property="og:image" content="${esc(`${SITIO}${RUTA}articulos/${usada}`)}" />
  ${usada === compartir ? '<meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />' : ""}
  <meta property="og:image:alt" content="${esc(titulo)}" />`;
  }

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- Página solo para compartir. La genera paginas-compartir.mjs; no se edita a mano. -->
  <title>${esc(titulo)} · Enzo Pavez</title>
  <meta name="description" content="${esc(descripcion)}" />
  <meta name="robots" content="noindex, follow" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Enzo Pavez" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:title" content="${esc(titulo)}" />
  <meta property="og:description" content="${esc(descripcion)}" />
  <meta property="og:url" content="${esc(url)}" />${imagen}
  ${d.fecha ? `<meta property="article:published_time" content="${esc(d.fecha)}" />` : ""}
  <meta property="article:author" content="Enzo Pavez" />
  <meta name="twitter:card" content="summary_large_image" />
  <script>location.replace(${JSON.stringify(articulo)} + location.hash);</script>
</head>
<body>
  <p><a href="${esc(articulo)}">Leer ${esc(titulo)}</a></p>
</body>
</html>
`;
}

const nombres = JSON.parse(readFileSync(join(ARTICULOS, "lista.json"), "utf8"))
  .map((n) => String(n).replace(/\.md$/i, ""))
  .filter((n) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n));

mkdirSync(SALIDA, { recursive: true });
for (const viejo of readdirSync(SALIDA)) {
  if (!nombres.includes(viejo)) rmSync(join(SALIDA, viejo), { recursive: true, force: true });
}

let hechas = 0;
for (const slug of nombres) {
  const md = join(ARTICULOS, `${slug}.md`);
  if (!existsSync(md)) continue;
  mkdirSync(join(SALIDA, slug), { recursive: true });
  writeFileSync(join(SALIDA, slug, "index.html"), pagina(slug, cabecera(readFileSync(md, "utf8"))));
  hechas++;
}
console.log(`${hechas} páginas para compartir en ${SALIDA}`);
