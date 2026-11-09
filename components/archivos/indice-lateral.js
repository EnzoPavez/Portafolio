// Índice lateral. Una fila por título. Cerrado se ve como una columna de rayas
// (la de la sección actual más larga y oscura) y al pasar el cursor, o al llegar
// con el teclado, cada raya se abre en su título, una fila tras otra.
// El movimiento está en archivos.css. Aquí solo se arma la lista y se sigue el scroll.

// Un título pasa a ser la sección actual cuando su borde superior sube de esta línea (px)
const LINEA_ACTIVA = 161; // justo debajo de donde quedan los títulos al saltar (--margen-salto)
// Al final de la página la línea baja hasta esta distancia del borde inferior (px)
const MARGEN_INFERIOR = 120;
// A partir de la quinta fila todas se abren a la vez, para que una lista larga no tarde
const PASOS_MAX = 4;
// Si el navegador no avisa del final del desplazamiento, se suelta la fila elegida tras este tiempo
const ESPERA_MAX = 1600;

export function crearIndice(titulos, { etiqueta = "Índice" } = {}) {
  if (!titulos.length) return null;

  const nav = document.createElement("nav");
  nav.className = "indice";
  nav.setAttribute("aria-label", etiqueta);

  const lista = document.createElement("div");
  lista.className = "indice-lista";

  const filas = titulos.map((titulo, i) => {
    const fila = document.createElement("a");
    fila.className = "indice-fila";
    fila.href = `#${titulo.id}`;
    fila.style.setProperty("--i", Math.min(i, PASOS_MAX));
    fila.innerHTML = '<span class="indice-raya-caja"><span class="indice-raya"></span></span><span class="indice-texto"></span>';
    fila.querySelector(".indice-texto").textContent = titulo.dataset.indice || titulo.textContent.trim();
    lista.append(fila);
    return fila;
  });

  nav.append(lista);

  // Cuántas líneas ocupa cada título (1 o 2), para que la fila abierta tenga el alto justo.
  // Se mide al entrar en la página, al cargar la letra y cada vez que cambia el ancho.
  const medirLineas = () => {
    for (const fila of filas) {
      const texto = fila.querySelector(".indice-texto");
      const alto = parseFloat(getComputedStyle(texto).lineHeight) || 18;
      fila.style.setProperty("--lineas", Math.min(2, Math.max(1, Math.round(texto.scrollHeight / alto))));
    }
  };
  new ResizeObserver(medirLineas).observe(nav);
  document.fonts?.ready.then(medirLineas);

  let actual = -1;
  // Fila elegida con un clic. Se respeta mientras dura el desplazamiento suave,
  // porque una sección corta al final de la página nunca llega a la línea activa.
  let elegida = null;
  let espera = 0;

  const marcar = (n) => {
    if (n === actual) return;
    filas[actual]?.removeAttribute("aria-current");
    filas[n]?.setAttribute("aria-current", "location");
    actual = n;
  };

  // Las secciones cortas del final nunca suben hasta la línea, porque la página se acaba antes.
  // Por eso, durante la última pantalla de recorrido, la línea baja poco a poco hasta cerca
  // del borde inferior y al llegar al final todas las secciones visibles quedan atrás.
  const linea = () => {
    const alto = innerHeight;
    const maximo = document.documentElement.scrollHeight - alto;
    if (maximo <= 0) return LINEA_ACTIVA;
    const tramo = Math.min(alto, maximo);
    const avance = Math.min(1, Math.max(0, (scrollY - (maximo - tramo)) / tramo));
    return LINEA_ACTIVA + avance * Math.max(0, alto - LINEA_ACTIVA - MARGEN_INFERIOR);
  };

  const calcular = () => {
    if (elegida !== null) return;
    const limite = linea();
    let n = 0;
    titulos.forEach((titulo, i) => {
      if (titulo.getBoundingClientRect().top <= limite) n = i;
    });
    marcar(n);
  };

  let cuadro = 0;
  const alMover = () => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(calcular);
  };

  const soltar = () => {
    elegida = null;
    clearTimeout(espera);
  };

  const elegir = (i) => {
    elegida = i;
    marcar(i);
    clearTimeout(espera);
    espera = setTimeout(soltar, ESPERA_MAX);
  };

  // Lo mismo si se llega con #seccion en la dirección o se vuelve atrás entre secciones
  const elegirAncla = () => {
    const ancla = decodeURIComponent(location.hash.slice(1));
    const i = titulos.findIndex((titulo) => titulo.id === ancla);
    if (i !== -1) elegir(i);
  };

  filas.forEach((fila, i) => fila.addEventListener("click", () => elegir(i)));

  addEventListener("scroll", alMover, { passive: true });
  addEventListener("resize", alMover, { passive: true });
  addEventListener("scrollend", soltar);
  addEventListener("hashchange", elegirAncla);

  elegirAncla();
  calcular();
  return nav;
}
