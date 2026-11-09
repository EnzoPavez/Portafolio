// Vista de lectura. Carga el Markdown de un archivo y arma el texto, el índice y las acciones.

import { marked } from "marked";
import { crearAcciones } from "./acciones.js";
import { aSlug, cargarArchivo, dominio, escapar, fechaLarga } from "./datos.js";
import { icono } from "./iconos.js";
import { crearIndice } from "./indice-lateral.js";

// Volver lleva a la sección Publicaciones de la portada del sitio, no a la lista de esta carpeta
const PORTADA = "../../#publicaciones";

const principal = document.querySelector("main");

// Enlace de vuelta a la portada de Publicaciones, arriba del título. El resto de la navegación
// la pone la barra de arriba (index.html).
const volverArriba = () =>
  `<a class="volver volver-arriba" href="${PORTADA}">${icono("atras")}Publicaciones</a>`;

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

  document.title = `${archivo.titulo} · Publicaciones`;

  const meta = [archivo.tema, fechaLarga(archivo.fecha), archivo.autor]
    .filter(Boolean)
    .map((t) => `<span>${escapar(t)}</span>`);
  if (archivo.fuente) {
    meta.push(`<a href="${escapar(archivo.fuente)}" target="_blank" rel="noopener noreferrer">${escapar(dominio(archivo.fuente))}</a>`);
  }

  principal.innerHTML = `
    ${volverArriba()}
    <article>
      ${archivo.imagen ? ficha(archivo) : ""}
      <header class="entrar" style="--paso:0">
        <h1 class="titulo"></h1>
        ${archivo.bajada ? '<p class="bajada"></p>' : ""}
        ${meta.length ? `<p class="meta">${meta.join("")}</p>` : ""}
      </header>
      <div class="prosa entrar" style="--paso:1"></div>
    </article>
    <footer class="pie entrar" style="--paso:2">
      <a class="volver" href="${PORTADA}">${icono("atras")}Volver a Publicaciones</a>
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

// Tarjeta del artículo con su imagen. En pantallas anchas queda fija a la derecha del texto,
// como una ficha que acompaña la lectura. En las angostas solo se ve la imagen, arriba del título.
// Los datos van en una sola línea, por eso la fecha es la corta ("7 oct 2026").
const fechaFicha = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });

function ficha(archivo) {
  const datos = [
    archivo.fecha ? fechaFicha.format(archivo.fecha).replace(".", "") : "",
    `${archivo.minutos} min de lectura`,
  ].filter(Boolean);
  return `
    <aside class="ficha entrar" style="--paso:1" aria-label="Ficha del artículo">
      <img class="ficha-imagen" src="${escapar(archivo.imagen)}" alt="" decoding="async" />
      <div class="ficha-texto">
        <p class="ficha-titulo">${escapar(archivo.titulo)}</p>
        <p class="ficha-datos">${datos.map(escapar).join(" · ")}</p>
        ${archivo.bajada ? `<p class="ficha-bajada">${escapar(archivo.bajada)}</p>` : ""}
      </div>
    </aside>`;
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

  // Cada tabla va en una caja propia. Si la esquina de arriba a la izquierda está vacía, la
  // primera columna son etiquetas de fila y pasan a th. Cada celda guarda el encabezado de su
  // columna, que se muestra encima del dato cuando la tabla se apila en tarjetas. Los roles
  // ARIA mantienen la tabla para los lectores de pantalla aunque se apile con display:block.
  for (const tabla of prosa.querySelectorAll("table")) {
    const caja = document.createElement("div");
    caja.className = "tabla";
    tabla.replaceWith(caja);
    caja.append(tabla);

    const encabezados = [...(tabla.tHead?.rows[0]?.cells || [])].map((celda) => celda.textContent.trim());
    if (encabezados.length && !encabezados[0]) {
      for (const fila of tabla.tBodies[0]?.rows || []) {
        const celda = fila.cells[0];
        if (!celda || celda.tagName === "TH") continue;
        const etiqueta = document.createElement("th");
        etiqueta.scope = "row";
        etiqueta.innerHTML = celda.innerHTML;
        celda.replaceWith(etiqueta);
      }
    }

    // Los nombres largos sin espacios (spark.databricks.delta.retentionDurationCheck.enabled)
    // pueden pasar a la línea siguiente después de un punto, un guion bajo o una barra.
    for (const celda of tabla.querySelectorAll("td, th")) cortesEnNombresLargos(celda);

    tabla.setAttribute("role", "table");
    for (const grupo of tabla.querySelectorAll("thead, tbody")) grupo.setAttribute("role", "rowgroup");
    for (const fila of tabla.rows) {
      fila.setAttribute("role", "row");
      [...fila.cells].forEach((celda, i) => {
        const enCabecera = fila.parentElement.tagName === "THEAD";
        celda.setAttribute("role", enCabecera ? "columnheader" : celda.tagName === "TH" ? "rowheader" : "cell");
        if (!enCabecera && encabezados[i]) celda.dataset.columna = encabezados[i];
      });
    }
  }
  vigilarTablas(prosa);
}

function cortesEnNombresLargos(elemento) {
  const recorrido = document.createTreeWalker(elemento, NodeFilter.SHOW_TEXT);
  const nodos = [];
  while (recorrido.nextNode()) nodos.push(recorrido.currentNode);
  for (const nodo of nodos) {
    if (!/\S{20,}/.test(nodo.textContent)) continue;
    const partes = nodo.textContent.split(/(\S{20,})/);
    const fragmento = document.createDocumentFragment();
    for (const parte of partes) {
      if (!/^\S{20,}$/.test(parte)) {
        fragmento.append(parte);
        continue;
      }
      for (const trozo of parte.split(/(?<=[._/])/)) {
        fragmento.append(trozo, document.createElement("wbr"));
      }
      fragmento.lastChild.remove();
    }
    nodo.replaceWith(fragmento);
  }
}

// Ninguna tabla se desplaza de lado. El navegador reparte el ancho en proporción al texto más
// largo de cada columna, y con tres o más columnas en 560px las etiquetas cortas quedan en
// columnas angostas y se parten ("Se aplica" / "a"). Acá cada celda corta (hasta cuatro
// palabras) va en una línea, lo que fija el mínimo de su columna, y el texto largo se reparte
// el resto. Si con la letra del texto no entra cómoda, se baja un paso en la escala del sitio
// (la letra chica) y desde ahí se recalcula todo, porque los mínimos van en em y el
// interlineado de la tabla compacta sale de ese tamaño. Si tampoco entra cómoda, la tabla se
// apila en tarjetas. Apretar las columnas de texto por debajo de unas 20 letras se probó y
// deja más etiquetas partidas que las tarjetas.
const TEXTO_COMODO = 9.5; // em por columna de texto, unas 20 letras por línea
const COLUMNA_MINIMA = 8; // em por columna. Menos, y no vale la pena intentarlo
const INTENTOS = [
  { compacta: false, textoMinimo: TEXTO_COMODO },
  { compacta: true, textoMinimo: TEXTO_COMODO },
];

function repartirColumnas(prosa) {
  for (const tabla of prosa.querySelectorAll(".tabla > table")) {
    if (INTENTOS.some((intento) => acomodar(tabla, intento))) continue;
    limpiar(tabla);
    const columnas = Math.max(...[...tabla.rows].map((fila) => fila.cells.length));
    // Con dos columnas no hay tarjetas que valgan. Se corta en cualquier punto.
    tabla.parentElement.classList.add(columnas >= 3 ? "tabla--apilada" : "tabla--partir");
  }
}

function limpiar(tabla) {
  tabla.parentElement.classList.remove("tabla--apilada", "tabla--partir", "tabla--compacta");
  for (const celda of tabla.querySelectorAll(".sin-cortar")) celda.classList.remove("sin-cortar");
  for (const celda of tabla.querySelectorAll("[style]")) celda.style.minWidth = "";
}

// Intenta que la tabla entre en su columna con un tamaño de letra y un mínimo para las
// columnas de texto. Devuelve true si entró, y la deja así.
function acomodar(tabla, { compacta, textoMinimo }) {
  limpiar(tabla);
  const caja = tabla.parentElement;
  caja.classList.toggle("tabla--compacta", compacta);
  const disponible = caja.clientWidth;
  const em = parseFloat(getComputedStyle(tabla).fontSize);
  const columnas = Math.max(...[...tabla.rows].map((fila) => fila.cells.length));
  if (columnas >= 3 && disponible < columnas * COLUMNA_MINIMA * em) return false;

  // Lo más angosta que puede quedar cada columna sin cortar palabras (su palabra más larga).
  tabla.classList.add("midiendo-minimo");
  const filaCompleta = [...tabla.rows].find((fila) => fila.cells.length === columnas);
  const palabraMasLarga = [...filaCompleta.cells].map((celda) => celda.getBoundingClientRect().width);
  tabla.classList.remove("midiendo-minimo");
  if (palabraMasLarga.reduce((a, b) => a + b, 0) > disponible) return false;

  // Ancho del texto de cada celda en una línea, más su relleno. Se mide el texto con un
  // Range porque la caja de una celda siempre mide lo que toda su columna.
  tabla.classList.add("midiendo");
  const rango = document.createRange();
  const celdas = [...tabla.rows].flatMap((fila) =>
    [...fila.cells].map((celda, i) => {
      rango.selectNodeContents(celda);
      const estilo = getComputedStyle(celda);
      const relleno = parseFloat(estilo.paddingLeft) + parseFloat(estilo.paddingRight);
      const palabras = celda.textContent.trim().split(/\s+/).length;
      return { celda, i, palabras, ancho: rango.getBoundingClientRect().width + relleno };
    }),
  );
  tabla.classList.remove("midiendo");
  const natural = Array(columnas).fill(0);
  for (const { i, ancho } of celdas) natural[i] = Math.max(natural[i], ancho);
  if (natural.reduce((a, b) => a + b, 0) <= disponible) return true;

  // Ancho mínimo de cada columna si van en una línea las celdas cortas que no pasan del
  // tope. En las columnas con texto largo, ese mínimo se fija en sus celdas, porque el
  // navegador no lo respeta solo y las deja más angostas.
  const minimosCon = (tope) => {
    const etiqueta = Array(columnas).fill(0);
    const texto = Array(columnas).fill(0);
    for (const { i, palabras, ancho } of celdas) {
      if (palabras <= 4 && ancho <= tope) etiqueta[i] = Math.max(etiqueta[i], ancho);
      else texto[i] = Math.max(Math.min(textoMinimo * em, natural[i]), palabraMasLarga[i]);
    }
    return { etiqueta, texto };
  };
  const suma = ({ etiqueta, texto }) => etiqueta.reduce((s, e, i) => s + Math.max(e, texto[i]), 0);

  for (let tope = disponible / 2; tope >= 4 * em; tope -= 8) {
    const minimos = minimosCon(tope);
    if (suma(minimos) > disponible) continue;
    for (const { celda, i, palabras, ancho } of celdas) {
      if (palabras <= 4 && ancho <= tope) celda.classList.add("sin-cortar");
      if (minimos.texto[i] > minimos.etiqueta[i]) celda.style.minWidth = `${Math.ceil(minimos.texto[i])}px`;
    }
    return true;
  }
  return false;
}

// Se reparte cuando cargan las letras (cambian los anchos) y cuando cambia el ancho de la columna.
let vigiaTablas = null;
let alCargarLetras = null;
function vigilarTablas(prosa) {
  vigiaTablas?.disconnect();
  if (alCargarLetras) document.fonts.removeEventListener("loadingdone", alCargarLetras);
  if (!prosa.querySelector("table")) return;
  alCargarLetras = () => repartirColumnas(prosa);
  document.fonts.addEventListener("loadingdone", alCargarLetras);
  let ancho = 0;
  let cuadro = 0;
  vigiaTablas = new ResizeObserver(([entrada]) => {
    const nuevo = Math.round(entrada.contentRect.width);
    if (nuevo === ancho) return;
    ancho = nuevo;
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => repartirColumnas(prosa));
  });
  vigiaTablas.observe(prosa);
  document.fonts.ready.then(() => repartirColumnas(prosa));
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
  document.title = "No encontrado · Publicaciones";
  principal.innerHTML = `
    ${volverArriba()}
    <header class="entrar">
      <h1 class="titulo">No encontré este archivo</h1>
      <p class="bajada">Puede que el enlace esté mal escrito o que el archivo ya no esté en la lista.</p>
    </header>
    <footer class="pie entrar" style="--paso:1">
      <a class="volver" href="${PORTADA}">${icono("atras")}Volver a Publicaciones</a>
    </footer>`;
}
