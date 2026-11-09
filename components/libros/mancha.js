// La mancha con que aparece la tapa en la ficha. Es una forma irregular, de borde
// rasgado, que crece desde el centro de la tapa hasta cubrirla. Van varias capas
// de máscara (una grande y otras más chicas corridas) que crecen a destiempo, así
// el borde cambia mientras crece y al principio quedan islas sueltas.

import { generador } from './tapas.js';

const VUELTA = Math.PI * 2;

// Una forma cerrada en un cuadrado de 100. Devuelve la URL para mask-image y el
// radio más chico (en fracción del lado), que sirve para saber cuánto tiene que
// crecer hasta tapar todo.
function forma(azar, { radio = 36, irregular = 8, dientes = 2.2, puntos = 96 } = {}) {
  const ondas = [2, 3, 5, 8].map((k) => ({ k, amp: (irregular * (0.2 + azar() * 0.8)) / Math.sqrt(k), fase: azar() * VUELTA }));
  let d = '';
  let minimo = Infinity;
  for (let i = 0; i < puntos; i++) {
    const t = (i / puntos) * VUELTA;
    let r = radio;
    for (const o of ondas) r += o.amp * Math.sin(o.k * t + o.fase);
    r += (azar() - 0.5) * dientes * 2;
    minimo = Math.min(minimo, r);
    d += `${i ? 'L' : 'M'}${(50 + Math.cos(t) * r).toFixed(1)} ${(50 + Math.sin(t) * r).toFixed(1)}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}Z"/></svg>`;
  return { url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, minimo: minimo / 100 };
}

const curvaMedio = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const curvaSalida = (p) => 1 - (1 - p) ** 3;

function fijar(el, propiedad, valor) {
  el.style[propiedad] = valor;
  el.style[`webkit${propiedad[0].toUpperCase()}${propiedad.slice(1)}`] = valor;
}

// Descubre el elemento con la mancha. Devuelve una promesa que se cumple al terminar.
export function revelar(el, semilla, { duracion = 720 } = {}) {
  const azar = generador(semilla);
  const ancho = el.offsetWidth;
  const alto = el.offsetHeight;
  const principal = forma(azar);
  const capas = [
    // La grande, desde el centro. Su tamaño final alcanza para tapar hasta las esquinas.
    { ...principal, cx: 0.5, cy: 0.5, hasta: (Math.hypot(ancho, alto) / 2 / principal.minimo) * 1.04, desde: 0, fin: 1, curva: curvaMedio },
    { ...forma(azar, { radio: 34 }), cx: 0.66, cy: 0.3, hasta: alto * 1.1, desde: 0.06, fin: 0.8, curva: curvaMedio },
    { ...forma(azar, { radio: 30, irregular: 10 }), cx: 0.3, cy: 0.74, hasta: alto * 0.9, desde: 0.16, fin: 0.86, curva: curvaMedio },
    // Una isla chica que aparece antes y después queda adentro de las otras
    { ...forma(azar, { radio: 26, irregular: 9 }), cx: 0.78, cy: 0.84, hasta: alto * 0.34, desde: 0.04, fin: 0.5, curva: curvaSalida },
  ];

  fijar(el, 'maskImage', capas.map((c) => c.url).join(', '));
  fijar(el, 'maskRepeat', 'no-repeat');
  fijar(el, 'maskSize', capas.map(() => '0px 0px').join(', '));

  return new Promise((listo) => {
    const inicio = performance.now();
    const cuadro = (ahora) => {
      const p = Math.min(1, (ahora - inicio) / duracion);
      const tamanos = [];
      const lugares = [];
      for (const c of capas) {
        const local = Math.max(0, Math.min(1, (p - c.desde) / (c.fin - c.desde)));
        const lado = c.hasta * c.curva(local);
        tamanos.push(`${lado.toFixed(1)}px ${lado.toFixed(1)}px`);
        lugares.push(`${(c.cx * ancho - lado / 2).toFixed(1)}px ${(c.cy * alto - lado / 2).toFixed(1)}px`);
      }
      fijar(el, 'maskSize', tamanos.join(', '));
      fijar(el, 'maskPosition', lugares.join(', '));
      if (p < 1) {
        requestAnimationFrame(cuadro);
        return;
      }
      for (const propiedad of ['maskImage', 'maskRepeat', 'maskSize', 'maskPosition']) fijar(el, propiedad, '');
      listo();
    };
    requestAnimationFrame(cuadro);
  });
}
