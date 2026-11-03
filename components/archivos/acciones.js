// Acciones de un archivo (compartir, copiar como Markdown y ver el original).
// Se arman dos veces, fijas abajo a la izquierda en pantallas anchas y al final del texto en las demás.

import { escapar } from "./datos.js";
import { icono, iconoCambio } from "./iconos.js";

const DURACION_AVISO = 2000;

export function crearAcciones(archivo) {
  const enlace = `${location.origin}${location.pathname}?a=${archivo.slug}`;
  const markdown = comoMarkdown(archivo);
  const textoCompartir = archivo.bajada ? `${archivo.titulo}. ${archivo.bajada}` : archivo.titulo;

  const estado = document.createElement("span");
  estado.className = "solo-lectores";
  estado.setAttribute("role", "status");

  const verOriginal = archivo.fuente
    ? `<a class="accion" href="${escapar(archivo.fuente)}" target="_blank" rel="noopener noreferrer">${icono("externo")}Ver original</a>`
    : "";

  const lateral = document.createElement("div");
  lateral.className = "acciones";
  lateral.setAttribute("role", "group");
  lateral.setAttribute("aria-label", "Acciones");
  lateral.innerHTML = `
    <div class="compartir">
      <button type="button" class="accion" aria-expanded="false" aria-controls="opciones-compartir">${icono("compartir")}Compartir</button>
      <div class="submenu" id="opciones-compartir">
        <div class="submenu-entrada" style="--i:0">
          <button type="button" class="accion" data-copiar-enlace><span class="submenu-texto">${iconoCambio("enlace", "check")}<span data-texto>Copiar enlace</span></span></button>
        </div>
        <div class="submenu-entrada" style="--i:1">
          <a class="accion" href="https://wa.me/?text=${encodeURIComponent(`${textoCompartir} ${enlace}`)}" target="_blank" rel="noopener noreferrer"><span class="submenu-texto">${icono("mensaje")}WhatsApp</span></a>
        </div>
        <div class="submenu-entrada" style="--i:2">
          <a class="accion" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(enlace)}" target="_blank" rel="noopener noreferrer"><span class="submenu-texto">${icono("maletin")}LinkedIn</span></a>
        </div>
      </div>
    </div>
    <button type="button" class="accion" data-copiar-markdown>${iconoCambio("copiar", "check")}<span data-texto>Copiar como Markdown</span></button>
    ${verOriginal}`;

  const pie = document.createElement("div");
  pie.className = "pie-acciones";
  pie.innerHTML = `
    <button type="button" class="accion" data-compartir-nativo>${iconoCambio("compartir", "check")}<span data-texto>Compartir</span></button>
    <button type="button" class="accion" data-copiar-markdown>${iconoCambio("copiar", "check")}<span data-texto>Copiar como Markdown</span></button>
    ${verOriginal}`;

  // Si sale bien avisa con el icono (pasa a check). Si falla, el botón cambia de texto un momento.
  // En los dos casos hay un mensaje para lectores de pantalla.
  const avisar = (boton, { visible = "", lector }) => {
    const etiqueta = boton.querySelector("[data-texto]");
    etiqueta.dataset.original ??= etiqueta.textContent;
    boton.toggleAttribute("data-hecho", !visible);
    etiqueta.textContent = visible || etiqueta.dataset.original;
    estado.textContent = lector;
    clearTimeout(boton._aviso);
    boton._aviso = setTimeout(() => {
      boton.removeAttribute("data-hecho");
      etiqueta.textContent = etiqueta.dataset.original;
      estado.textContent = "";
    }, DURACION_AVISO);
  };

  const copiarCon = async (boton, texto, mensaje) => {
    if (await copiar(texto)) avisar(boton, { lector: mensaje });
    else avisar(boton, { visible: "No se pudo copiar", lector: "No se pudo copiar. Prueba otra vez." });
  };

  for (const boton of [...lateral.querySelectorAll("[data-copiar-markdown]"), ...pie.querySelectorAll("[data-copiar-markdown]")]) {
    boton.addEventListener("click", () => copiarCon(boton, markdown, "Copiado como Markdown"));
  }

  const botonEnlace = lateral.querySelector("[data-copiar-enlace]");
  botonEnlace.addEventListener("click", () => copiarCon(botonEnlace, enlace, "Enlace copiado"));

  // En pantallas chicas se usa el menú de compartir del sistema si existe, y si no se copia el enlace
  const botonNativo = pie.querySelector("[data-compartir-nativo]");
  botonNativo.addEventListener("click", async () => {
    const datos = { title: archivo.titulo, text: archivo.bajada, url: enlace };
    if (navigator.share && (!navigator.canShare || navigator.canShare(datos))) {
      try {
        await navigator.share(datos);
      } catch {
        // Cancelado por la persona, no hay nada que hacer
      }
      return;
    }
    copiarCon(botonNativo, enlace, "Enlace copiado");
  });

  // El submenú de compartir se abre con clic y queda abierto. En CSS también se abre al pasar
  // el cursor o al llegar con el teclado, así que aria-expanded sigue lo que se ve, venga de donde venga.
  const compartir = lateral.querySelector(".compartir");
  const botonCompartir = compartir.querySelector("button[aria-expanded]");
  const conCursor = matchMedia("(hover: hover)");
  const sincronizar = () => {
    const abierto =
      compartir.hasAttribute("data-abierto") ||
      (conCursor.matches && compartir.matches(":hover")) ||
      compartir.querySelector(":focus-visible") !== null;
    botonCompartir.setAttribute("aria-expanded", String(abierto));
  };
  // Se espera un cuadro porque el cursor y el foco todavía no llegaron a su destino cuando saltan estos eventos
  const sincronizarLuego = () => requestAnimationFrame(sincronizar);
  for (const evento of ["pointerenter", "pointerleave", "focusin", "focusout"]) {
    compartir.addEventListener(evento, sincronizarLuego);
  }
  const alternar = (abrir) => {
    compartir.toggleAttribute("data-abierto", abrir);
    sincronizar();
  };
  botonCompartir.addEventListener("click", () => alternar(!compartir.hasAttribute("data-abierto")));
  document.addEventListener("click", (e) => {
    if (!compartir.contains(e.target)) alternar(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && compartir.hasAttribute("data-abierto")) {
      alternar(false);
      botonCompartir.focus();
    }
  });

  // Fuera de las acciones, porque en pantallas chicas el bloque lateral está oculto y no se anunciaría
  document.body.append(estado);
  return { lateral, pie };
}

function comoMarkdown(archivo) {
  const partes = [`# ${archivo.titulo}`];
  if (archivo.bajada) partes.push(archivo.bajada);
  partes.push(archivo.cuerpo.trim());
  if (archivo.fuente) partes.push("---", `Original en ${archivo.fuente}`);
  return `${partes.join("\n\n")}\n`;
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sin permiso o sin contexto seguro, se intenta a la antigua
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    let hecho = false;
    try {
      hecho = document.execCommand("copy");
    } catch {
      hecho = false;
    }
    area.remove();
    return hecho;
  }
}
