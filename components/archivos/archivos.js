// Punto de entrada. Con ?a=nombre muestra ese archivo, sin nada muestra la portada.
// Es una sola página para que los enlaces funcionen con cualquier servidor
// (algunos, como serve, quitan el .html y se llevan los parámetros por delante).

// iOS solo aplica :active al tocar si la página escucha algún evento táctil
document.addEventListener("touchstart", () => {}, { passive: true });

const slug = new URLSearchParams(location.search).get("a");

if (slug !== null) {
  const { mostrarArticulo } = await import("./articulo.js");
  mostrarArticulo(slug);
} else {
  const { mostrarPortada } = await import("./portada.js");
  mostrarPortada();
}
