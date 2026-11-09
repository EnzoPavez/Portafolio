// Resumen de las publicaciones para otra página (la portada del sitio). Es la misma lista
// que la portada de Publicaciones, agrupada por tema y con la imagen de cada artículo, pero
// muestra solo los primeros de cada tema. Si un tema tiene más, abajo va un botón que
// despliega el resto ahí mismo, sin salir de la página.
//
// Uso
//   import { montarResumen } from './components/archivos/resumen.js';
//   montarResumen(document.getElementById('publicaciones-lista'), { porTema: 4 });
//
// Carga solo su CSS (resumen.css) y toma los colores de la página (--fondo-hover, --texto...).

import { aSlug, cargarTodos, escapar, fechaCorta } from "./datos.js";

const ESTILOS = new URL("./resumen.css", import.meta.url);
const ARTICULO = (slug) => new URL(`./?a=${encodeURIComponent(slug)}`, import.meta.url).href;
// Hasta cuántas filas entran escalonadas al desplegar; las demás entran a la vez
const PASOS_MAX = 6;

function cargarEstilos() {
  if (document.querySelector("link[data-resumen]")) return Promise.resolve();
  const enlace = document.createElement("link");
  enlace.rel = "stylesheet";
  enlace.href = ESTILOS.href;
  enlace.dataset.resumen = "";
  const listo = new Promise((r) => { enlace.onload = r; enlace.onerror = r; });
  document.head.append(enlace);
  return listo;
}

function fila(archivo, i = 0) {
  const fecha = fechaCorta(archivo.fecha);
  const imagen = archivo.miniatura
    ? `<img class="pub-imagen" src="${escapar(archivo.miniatura)}" alt="" width="44" height="44" loading="lazy" decoding="async" />`
    : "";
  return `
    <a class="pub-fila" href="${escapar(ARTICULO(archivo.slug))}" style="--i:${Math.min(i, PASOS_MAX)}">
      <span class="pub-miniatura" aria-hidden="true">${imagen}</span>
      <span class="pub-titulo">${escapar(archivo.titulo)}</span>
      ${fecha ? `<span class="pub-fecha">${fecha}</span>` : ""}
    </a>`;
}

export async function montarResumen(contenedor, { porTema = 4 } = {}) {
  const [, archivos] = await Promise.all([cargarEstilos(), cargarTodos()]);
  if (!archivos.length) {
    contenedor.innerHTML = '<p class="pub-vacio">Todavía no hay publicaciones.</p>';
    return;
  }

  // Igual que la portada de Publicaciones: temas en orden alfabético y, dentro de cada uno,
  // lo más nuevo primero. "Diseño" y "diseno" cuentan como el mismo tema.
  const grupos = new Map();
  for (const archivo of archivos) {
    const clave = aSlug(archivo.tema);
    if (!grupos.has(clave)) grupos.set(clave, { tema: archivo.tema, clave, lista: [] });
    grupos.get(clave).lista.push(archivo);
  }
  const temas = [...grupos.values()].sort((a, b) => a.tema.localeCompare(b.tema, "es", { sensitivity: "base" }));

  contenedor.innerHTML = temas
    .map(({ tema, clave, lista }) => {
      lista.sort((a, b) => (b.fecha?.getTime() ?? 0) - (a.fecha?.getTime() ?? 0));
      const primeros = lista.slice(0, porTema);
      const resto = lista.slice(porTema);
      const id = `pub-${clave}`;
      return `
        <section class="pub-tema" aria-labelledby="${id}">
          <h3 class="pub-tema-titulo" id="${id}">${escapar(tema)}<span class="pub-tema-cuenta">${lista.length}</span></h3>
          <div class="pub-lista">${primeros.map((a) => fila(a)).join("")}</div>
          ${resto.length ? `
            <div class="pub-mas" id="${id}-mas" inert>
              <div class="pub-mas-dentro"><div class="pub-lista">${resto.map(fila).join("")}</div></div>
            </div>
            <button class="pub-boton" type="button" aria-expanded="false" aria-controls="${id}-mas">
              <span class="pub-boton-texto">Ver los ${lista.length}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>
            </button>` : ""}
        </section>`;
    })
    .join("");

  for (const boton of contenedor.querySelectorAll(".pub-boton")) {
    const mas = document.getElementById(boton.getAttribute("aria-controls"));
    const texto = boton.querySelector(".pub-boton-texto");
    const verTodos = texto.textContent;
    boton.addEventListener("click", () => {
      const abrir = boton.getAttribute("aria-expanded") !== "true";
      boton.setAttribute("aria-expanded", String(abrir));
      mas.toggleAttribute("inert", !abrir);
      mas.classList.toggle("pub-mas-abierto", abrir);
      texto.textContent = abrir ? "Ver menos" : verTodos;
    });
  }
}
