// Carga de los archivos en Markdown y utilidades compartidas.

export const PERFIL = {
  nombre: "Enzo Pavez",
  iniciales: "EP",
  // Ruta a una foto (por ejemplo "avatar.jpg" dentro de esta carpeta). Vacío muestra las iniciales.
  avatar: "",
  // Dirección de la página principal del portafolio. Vacío deja el avatar de la portada sin enlace.
  inicio: "../../",
};

// Días que un archivo lleva la etiqueta "Nuevo" en la portada
const DIAS_NUEVO = 30;

const CARPETA = new URL("./articulos/", import.meta.url);
const SLUG_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function esSlugValido(slug) {
  return typeof slug === "string" && SLUG_VALIDO.test(slug);
}

// Lee articulos/lista.json y carga cada archivo que nombra.
export async function cargarTodos() {
  const respuesta = await fetch(new URL("lista.json", CARPETA), { cache: "no-cache" });
  if (!respuesta.ok) throw new Error(`No se pudo leer lista.json (${respuesta.status})`);
  const nombres = await respuesta.json();
  const slugs = [...new Set(nombres.map((n) => String(n).replace(/\.md$/i, "")))].filter(esSlugValido);
  const archivos = await Promise.all(slugs.map((slug) => cargarArchivo(slug).catch(() => null)));
  return archivos.filter(Boolean);
}

// Carga un archivo por su nombre (sin .md). Devuelve null si no existe.
export async function cargarArchivo(slug) {
  if (!esSlugValido(slug)) return null;
  const url = new URL(`${slug}.md`, CARPETA);
  const respuesta = await fetch(url, { cache: "no-cache" });
  if (!respuesta.ok) return null;
  const texto = (await respuesta.text()).replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const { datos, cuerpo } = leerCabecera(texto);
  return {
    slug,
    url,
    titulo: datos.titulo || slug,
    bajada: datos.bajada || "",
    tema: datos.tema || "Sin tema",
    fecha: leerFecha(datos.fecha),
    autor: datos.autor || "",
    fuente: datos.fuente || "",
    cuerpo,
    secciones: extraerSecciones(cuerpo),
  };
}

// La cabecera va entre dos líneas "---" al principio del archivo, con una clave por línea.
function leerCabecera(texto) {
  const datos = {};
  if (!texto.startsWith("---\n")) return { datos, cuerpo: texto };
  const fin = texto.indexOf("\n---", 4);
  if (fin === -1) return { datos, cuerpo: texto };
  for (const linea of texto.slice(4, fin).split("\n")) {
    const m = /^\s*([A-Za-zÁÉÍÓÚáéíóúñÑ_]+)\s*:\s*(.*)$/.exec(linea);
    if (!m) continue;
    const clave = m[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    datos[clave] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  const despues = texto.indexOf("\n", fin + 4);
  return { datos, cuerpo: despues === -1 ? "" : texto.slice(despues + 1).replace(/^\n+/, "") };
}

// Títulos de nivel 2 (los que forman el índice), saltando los bloques de código.
function extraerSecciones(cuerpo) {
  const secciones = [];
  let enCodigo = false;
  for (const linea of cuerpo.split("\n")) {
    if (/^\s*(```|~~~)/.test(linea)) enCodigo = !enCodigo;
    else if (!enCodigo) {
      const m = /^##\s+(.+?)\s*#*\s*$/.exec(linea);
      if (m) secciones.push(m[1]);
    }
  }
  return secciones;
}

export function aSlug(texto) {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "seccion"
  );
}

function leerFecha(valor) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(valor || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const formatoCorto = new Intl.DateTimeFormat("es", { month: "short", year: "numeric" });
const formatoLargo = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" });

export const fechaCorta = (fecha) => (fecha ? formatoCorto.format(fecha).replace(".", "") : "");
export const fechaLarga = (fecha) => (fecha ? formatoLargo.format(fecha) : "");

export function esNuevo(fecha) {
  if (!fecha) return false;
  const dias = (Date.now() - fecha.getTime()) / 86_400_000;
  return dias >= -1 && dias <= DIAS_NUEVO;
}

export function dominio(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function avatarHTML() {
  if (PERFIL.avatar) {
    const src = new URL(PERFIL.avatar, import.meta.url).href;
    return `<img class="avatar-imagen" src="${src}" alt="" width="44" height="44" />`;
  }
  return `<span class="avatar-imagen" aria-hidden="true">${PERFIL.iniciales}</span>`;
}

export function escapar(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
