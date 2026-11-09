// Portada de Publicaciones (la carpeta sigue llamándose archivos). Agrupa los archivos por tema y usa el mismo índice lateral para saltar entre temas.

import { aSlug, cargarTodos, esNuevo, escapar, fechaCorta } from "./datos.js";
import { crearIndice } from "./indice-lateral.js";

const principal = document.querySelector("main");

// A partir del cuarto tema todos entran a la vez, para que una portada larga no tarde en aparecer
const PASOS_MAX = 4;

export async function mostrarPortada() {
  // La navegación (firma, menú y vuelta al inicio) la pone la barra de arriba, en index.html
  principal.innerHTML = `
    <header class="entrar" style="--paso:0">
      <h1 class="titulo">Publicaciones</h1>
      <p class="bajada">Artículos y documentos que guardo, ordenados por tema.</p>
    </header>
    <div id="temas"></div>`;

  const caja = principal.querySelector("#temas");

  let archivos;
  try {
    archivos = await cargarTodos();
  } catch {
    caja.innerHTML = '<p class="aviso entrar" style="--paso:1">No pude leer la lista de archivos. Revisa que exista <code>articulos/lista.json</code> y que sea una lista válida.</p>';
    return;
  }

  if (!archivos.length) {
    caja.innerHTML = '<p class="aviso entrar" style="--paso:1">Todavía no hay archivos. Crea el primero en <code>articulos/</code> y suma su nombre a <code>lista.json</code>.</p>';
    return;
  }

  // "Diseño" y "diseno" cuentan como el mismo tema. Se muestra como aparece la primera vez.
  const grupos = new Map();
  for (const archivo of archivos) {
    const clave = aSlug(archivo.tema);
    if (!grupos.has(clave)) grupos.set(clave, { tema: archivo.tema, lista: [] });
    grupos.get(clave).lista.push(archivo);
  }

  const ordenados = [...grupos.values()].sort((a, b) => a.tema.localeCompare(b.tema, "es", { sensitivity: "base" }));
  const usados = new Set();

  caja.innerHTML = ordenados
    .map(({ tema, lista: sinOrden }, i) => {
      const lista = sinOrden.sort((a, b) => (b.fecha?.getTime() ?? 0) - (a.fecha?.getTime() ?? 0));
      let id = `tema-${aSlug(tema)}`;
      for (let n = 2; usados.has(id); n++) id = `tema-${aSlug(tema)}-${n}`;
      usados.add(id);
      return `
        <section class="tema entrar" style="--paso:${Math.min(i + 1, PASOS_MAX)}" aria-labelledby="${id}">
          <h2 class="tema-titulo" id="${id}" data-indice="${escapar(tema)}">${escapar(tema)}<span class="tema-cuenta">${lista.length}<span class="solo-lectores"> ${lista.length === 1 ? "archivo" : "archivos"}</span></span></h2>
          <div class="lista">
            <span class="lista-resalte" aria-hidden="true"></span>
            ${lista.map(fila).join("")}
          </div>
        </section>`;
    })
    .join("");

  caja.querySelectorAll(".lista").forEach(activarResalte);

  const titulos = [...caja.querySelectorAll(".tema-titulo")];
  if (titulos.length > 1) {
    const indice = crearIndice(titulos, { etiqueta: "Temas" });
    document.body.append(indice);
  }

  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: "instant" });
}

function fila(archivo) {
  const fecha = fechaCorta(archivo.fecha);
  return `
    <a class="fila" href="?a=${archivo.slug}">
      <span class="miniatura" aria-hidden="true">${
        archivo.miniatura
          ? `<img class="miniatura-imagen" src="${escapar(archivo.miniatura)}" alt="" width="44" height="44" loading="lazy" decoding="async" />`
          : `<span class="miniatura-hoja">${barras(archivo)}</span>`
      }</span>
      <span class="fila-cuerpo">
        <span class="fila-titulo">${escapar(archivo.titulo)}</span>
        ${esNuevo(archivo.fecha) ? '<span class="etiqueta-nuevo">Nuevo</span>' : ""}
      </span>
      ${fecha ? `<span class="fila-fecha">${fecha}</span>` : ""}
    </a>`;
}

// Miniatura de la hoja. Cuatro rayas cuyo largo sale del título y de las secciones del texto,
// así cada archivo tiene su propia silueta y recuerda a las rayas del índice.
function barras(archivo) {
  const textos = [archivo.titulo, ...archivo.secciones, archivo.bajada].filter(Boolean);
  while (textos.length < 4) textos.push(`${archivo.titulo}${textos.length}`);
  return textos
    .slice(0, 4)
    .map((texto, i) => {
      const ancho = i === 0 ? limitar(texto.length * 0.35, 8, 14) : limitar(texto.length * 0.55, 7, 22);
      return `<i style="width:${Math.round(ancho)}px"></i>`;
    })
    .join("");
}

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));


// Un solo fondo que se desliza a la fila bajo el cursor
function activarResalte(lista) {
  const resalte = lista.querySelector(".lista-resalte");
  let visible = false;

  lista.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const destino = e.target.closest(".fila");
    if (!destino) return;
    if (!visible) resalte.setAttribute("data-quieto", "");
    resalte.style.translate = `0 ${destino.offsetTop}px`;
    resalte.style.height = `${destino.offsetHeight}px`;
    if (!visible) {
      resalte.getBoundingClientRect();
      resalte.removeAttribute("data-quieto");
    }
    resalte.style.opacity = "1";
    visible = true;
  });

  lista.addEventListener("pointerleave", () => {
    resalte.style.opacity = "0";
    visible = false;
  });
}
