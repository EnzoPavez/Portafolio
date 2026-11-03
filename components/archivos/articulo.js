// Vista de lectura. Carga el Markdown de un archivo y arma el texto, el índice y las acciones.

import { marked } from "marked";
import { crearAcciones } from "./acciones.js";
import { aSlug, avatarHTML, cargarArchivo, dominio, escapar, fechaLarga } from "./datos.js";
import { icono } from "./iconos.js";
import { crearIndice } from "./indice-lateral.js";

const PORTADA = "./";

const principal = document.querySelector("main");

// Avatar con el enlace de vuelta a la portada a su lado. En pantallas anchas queda fijo arriba a la izquierda.
const volverArriba = () =>
  `<a class="avatar avatar-con-volver" href="${PORTADA}" aria-label="Volver a Archivos">${avatarHTML()}<span class="avatar-volver">${icono("atras")}Archivos</span></a>`;

export async function mostrarArticulo(slug) {
  let archivo = null;
  try {
    archivo = await cargarArchivo(slug);
  } catch {
    archivo = null;
  }

  if (!archivo) {
    mostrarNoEncontrado();
    return;
  }

  document.title = `${archivo.titulo} · Archivos`;

  const meta = [archivo.tema, fechaLarga(archivo.fecha), archivo.autor]
    .filter(Boolean)
    .map((t) => `<span>${escapar(t)}</span>`);
  if (archivo.fuente) {
    meta.push(`<a href="${escapar(archivo.fuente)}" target="_blank" rel="noopener noreferrer">${escapar(dominio(archivo.fuente))}</a>`);
  }

  principal.innerHTML = `
    ${volverArriba()}
    <article>
      <header class="entrar" style="--paso:0">
        <h1 class="titulo"></h1>
        ${archivo.bajada ? '<p class="bajada"></p>' : ""}
        ${meta.length ? `<p class="meta">${meta.join("")}</p>` : ""}
      </header>
      <div class="prosa entrar" style="--paso:1"></div>
    </article>
    <footer class="pie entrar" style="--paso:2">
      <a class="volver" href="${PORTADA}">${icono("atras")}Volver a Archivos</a>
    </footer>`;

  principal.querySelector(".titulo").textContent = archivo.titulo;
  if (archivo.bajada) principal.querySelector(".bajada").textContent = archivo.bajada;

  const prosa = principal.querySelector(".prosa");
  prosa.innerHTML = marked.parse(archivo.cuerpo, { gfm: true });
  ajustarContenido(prosa, archivo.url);

  const { lateral, pie } = crearAcciones(archivo);
  principal.querySelector(".pie").prepend(pie);

  const titulos = [...prosa.querySelectorAll("h2")];
  const indice = crearIndice(titulos, { etiqueta: "Secciones del texto" });
  if (indice) document.body.append(indice);
  document.body.append(lateral);

  irAlAncla(prosa);
}

// Arreglos sobre el HTML que genera marked
function ajustarContenido(prosa, urlArchivo) {
  // Ids únicos para los subtítulos, así el índice y los enlaces con # pueden apuntar a ellos
  const usados = new Set();
  for (const titulo of prosa.querySelectorAll("h2, h3, h4")) {
    const base = aSlug(titulo.textContent);
    let id = base;
    for (let n = 2; usados.has(id) || document.getElementById(id); n++) id = `${base}-${n}`;
    usados.add(id);
    titulo.id = id;
  }

  // Enlaces. Los .md apuntan a otro archivo de la sección, lo relativo se lee junto al .md
  // y lo externo se abre en otra pestaña.
  for (const enlace of prosa.querySelectorAll("a[href]")) {
    const href = enlace.getAttribute("href");
    if (href.startsWith("#")) continue;
    const otroArchivo = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/.exec(href);
    if (otroArchivo) {
      enlace.href = `?a=${otroArchivo[1]}${otroArchivo[2] || ""}`;
      continue;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) enlace.href = new URL(href, urlArchivo).href;
    if (/^https?:/i.test(enlace.href) && new URL(enlace.href).origin !== location.origin) {
      enlace.target = "_blank";
      enlace.rel = "noopener noreferrer";
    }
  }

  // Imágenes relativas al .md. Si tienen título, este pasa a ser el pie.
  // Sin carga diferida, para que las que quedan sobre un #ancla carguen y el salto se pueda corregir.
  for (const imagen of prosa.querySelectorAll("img")) {
    const src = imagen.getAttribute("src");
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) imagen.src = new URL(src, urlArchivo).href;
    imagen.decoding = "async";
    const parrafo = imagen.parentElement;
    if (imagen.title && parrafo.tagName === "P" && parrafo.childNodes.length === 1) {
      const figura = document.createElement("figure");
      const pie = document.createElement("figcaption");
      pie.textContent = imagen.title;
      imagen.removeAttribute("title");
      figura.append(imagen, pie);
      parrafo.replaceWith(figura);
    }
  }

  // Las tablas anchas se desplazan de lado sin romper la columna
  for (const tabla of prosa.querySelectorAll("table")) {
    const caja = document.createElement("div");
    caja.className = "tabla";
    tabla.replaceWith(caja);
    caja.append(tabla);
  }
}

// Si se llega con #seccion en la dirección, se salta ahí cuando el texto ya existe.
// Las imágenes de más arriba pueden terminar de cargar después y correr la página,
// así que al llegar se repite el salto, salvo que la persona ya se haya movido.
function irAlAncla(prosa) {
  if (!location.hash) return;
  const destino = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!destino) return;
  const saltar = () => destino.scrollIntoView({ behavior: "instant", block: "start" });
  saltar();

  const pendientes = [...prosa.querySelectorAll("img")].filter(
    (imagen) => !imagen.complete && imagen.compareDocumentPosition(destino) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  if (!pendientes.length) return;

  let movida = false;
  const marcar = () => (movida = true);
  const eventos = ["wheel", "touchstart", "keydown"];
  eventos.forEach((evento) => addEventListener(evento, marcar, { once: true, passive: true }));
  Promise.all(pendientes.map((imagen) => imagen.decode().catch(() => {}))).then(() => {
    eventos.forEach((evento) => removeEventListener(evento, marcar));
    if (!movida) saltar();
  });
}

function mostrarNoEncontrado() {
  document.title = "No encontrado · Archivos";
  principal.innerHTML = `
    ${volverArriba()}
    <header class="entrar">
      <h1 class="titulo">No encontré este archivo</h1>
      <p class="bajada">Puede que el enlace esté mal escrito o que el archivo ya no esté en la lista.</p>
    </header>
    <footer class="pie entrar" style="--paso:1">
      <a class="volver" href="${PORTADA}">${icono("atras")}Volver a Archivos</a>
    </footer>`;
}
