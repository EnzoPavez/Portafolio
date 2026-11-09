// La forma de la hoja. Una malla plana que se dobla entre dos estados.
//   p = 0  bola de papel (la hoja envuelve una esfera y lleva pliegues finos)
//   p = 1  hoja abierta (plana, con un resto de arrugas que se nota solo en la luz)
// Entre medio la hoja se abre como un paraguas que pierde curvatura, con pliegues
// grandes que aparecen a mitad de camino. El centro se abre antes que los bordes.

import * as THREE from 'three';
import { generador, crearRuido } from './ruido.js';

const RETRASO = 0.22; // cuánto esperan los bordes respecto del centro al abrirse

// Un pliegue es un segmento recto con perfil de carpa. Sumados dan caras planas
// y aristas rectas, que es como se ve el papel arrugado (el ruido suave parece cerebro).
function crearPliegues(azar, cantidad, ancho, alto, { anchoMin, anchoMax, largoMin, largoMax }) {
  const lista = [];
  for (let k = 0; k < cantidad; k++) {
    const angulo = azar() * Math.PI;
    lista.push({
      cx: (azar() - 0.5) * ancho * 1.15,
      cy: (azar() - 0.5) * alto * 1.15,
      nx: Math.cos(angulo),
      ny: Math.sin(angulo),
      w: anchoMin + azar() * (anchoMax - anchoMin),
      l: largoMin + azar() * (largoMax - largoMin),
      a: (azar() < 0.5 ? -1 : 1) * (0.55 + azar() * 0.45),
    });
  }
  return (x, y) => {
    let h = 0;
    for (const f of lista) {
      const dx = x - f.cx;
      const dy = y - f.cy;
      const d = Math.abs(dx * f.nx + dy * f.ny);
      if (d >= f.w) continue;
      const t = (dy * f.nx - dx * f.ny) / f.l;
      if (t * t >= 1) continue;
      h += f.a * (f.w - d) * (1 - t * t);
    }
    return h;
  };
}

// Deja un campo con media 0 y desviación 1, así las amplitudes quedan en px.
// Los extremos se achatan para que no salgan puntas donde se juntan varios pliegues.
function normalizar(campo) {
  let suma = 0;
  for (const v of campo) suma += v;
  const media = suma / campo.length;
  let var2 = 0;
  for (const v of campo) var2 += (v - media) ** 2;
  const desv = Math.sqrt(var2 / campo.length) || 1;
  for (let i = 0; i < campo.length; i++) campo[i] = 2.2 * Math.tanh((campo[i] - media) / desv / 2.2);
}

const suavizar = (t) => t * t * (3 - 2 * t);

// paso son los px entre vértices (más grande da caras planas más grandes) y pliegues
// multiplica la fuerza de los finos, los gruesos y lo que queda marcado en la hoja abierta.
export function crearForma({ ancho, alto, radio, semilla, paso = 2.7, pliegues = {} }) {
  const fuerza = { fino: 1, grueso: 1, abierta: 1, ...pliegues };
  const sx = Math.max(16, Math.round(ancho / paso));
  const sy = Math.max(16, Math.round(alto / paso));
  const geometria = new THREE.PlaneGeometry(ancho, alto, sx, sy);
  const posicion = geometria.attributes.position;
  const n = posicion.count;

  const sombra = new Float32Array(n).fill(1);
  geometria.setAttribute('aSombra', new THREE.BufferAttribute(sombra, 1));

  const azar = generador(semilla);
  const ruido = crearRuido(semilla ^ 0x9e3779b9);
  const finos = crearPliegues(azar, 240, ancho, alto, { anchoMin: 2.5, anchoMax: 7, largoMin: 14, largoMax: 55 });
  const gruesos = crearPliegues(azar, 30, ancho, alto, { anchoMin: 12, anchoMax: 34, largoMin: 60, largoMax: 200 });

  // En la bola la hoja se reparte sobre un disco (el cuadrado se estira a círculo)
  // de radio tal que los bordes casi se juntan detrás de la esfera.
  const radioDisco = 0.93 * Math.PI * radio;
  const curvaturaBola = 1 / radio;

  const plano = new Float32Array(n * 2);
  const disco = new Float32Array(n * 2);
  const radial = new Float32Array(n);
  const fino = new Float32Array(n);
  const grueso = new Float32Array(n);
  const bulto = new Float32Array(n);
  const deriva = new Float32Array(n * 2);

  for (let i = 0; i < n; i++) {
    const x = posicion.getX(i);
    const y = posicion.getY(i);
    const u = x / (ancho / 2);
    const v = y / (alto / 2);
    const dx = u * Math.sqrt(Math.max(0, 1 - (v * v) / 2));
    const dy = v * Math.sqrt(Math.max(0, 1 - (u * u) / 2));
    plano[i * 2] = x;
    plano[i * 2 + 1] = y;
    disco[i * 2] = dx * radioDisco;
    disco[i * 2 + 1] = dy * radioDisco;
    radial[i] = Math.min(1, Math.hypot(dx, dy));
    fino[i] = finos(x, y);
    grueso[i] = gruesos(x, y);
    bulto[i] = ruido(dx * 1.7, dy * 1.7, 3.1) + 0.5 * ruido(dx * 3.4, dy * 3.4, 7.7);
    deriva[i * 2] = ruido(x * 0.011, y * 0.011, 11.3);
    deriva[i * 2 + 1] = ruido(x * 0.011, y * 0.011, 23.9);
  }
  normalizar(fino);
  normalizar(grueso);
  normalizar(bulto);

  const amp = {
    finoBola: radio * 0.085 * fuerza.fino,
    gruesoBola: radio * 0.08 * fuerza.grueso,
    gruesoMedio: 12 * fuerza.grueso,
    gruesoAbierta: 0.55 * fuerza.abierta,
    finoAbierta: 0.18 * fuerza.abierta,
    bultoBola: radio * 0.09,
    deriva: 14,
  };

  function actualizar(p) {
    for (let i = 0; i < n; i++) {
      const q = Math.min(1, Math.max(0, (p - RETRASO * radial[i]) / (1 - RETRASO)));
      const e = suavizar(q);
      const bola = 1 - e;
      const medio = Math.sin(Math.PI * e);

      let px = disco[i * 2] + (plano[i * 2] - disco[i * 2]) * e;
      let py = disco[i * 2 + 1] + (plano[i * 2 + 1] - disco[i * 2 + 1]) * e;
      px += deriva[i * 2] * amp.deriva * medio;
      py += deriva[i * 2 + 1] * amp.deriva * medio;

      // Curvatura que se va a cero, así la esfera se abre como un paraguas.
      const k = curvaturaBola * bola * bola;
      const s = Math.hypot(px, py) || 1e-6;
      const ux = px / s;
      const uy = py / s;
      let x, y, z, nx, ny, nz;
      let compresion = 1; // cuánto se aprieta la hoja a lo ancho (1 nada, 0 en el polo de atrás)
      if (k > 1e-6) {
        const fi = s * k;
        const sen = Math.sin(fi);
        const cos = Math.cos(fi);
        x = (ux * sen) / k;
        y = (uy * sen) / k;
        z = (cos - 1) / k;
        nx = ux * sen;
        ny = uy * sen;
        nz = cos;
        compresion = fi > 1e-4 ? Math.max(0, sen / fi) : 1;
      } else {
        x = px; y = py; z = 0;
        nx = 0; ny = 0; nz = 1;
      }

      // Donde la hoja se aprieta los pliegues finos quedan muy juntos y dibujan un borde
      // de sierra, así que ahí se atenúan.
      const aFino = amp.finoBola * Math.pow(bola, 1.3) * (0.25 + 0.75 * compresion ** 1.5) + amp.finoAbierta;
      const aGrueso = amp.gruesoBola * bola + amp.gruesoMedio * medio + amp.gruesoAbierta;
      const aBulto = amp.bultoBola * bola * bola;
      const d = fino[i] * aFino + grueso[i] * aGrueso + bulto[i] * aBulto;
      posicion.setXYZ(i, x + nx * d, y + ny * d, z + nz * d);

      // Los valles de los pliegues quedan un poco a la sombra, sobre todo en la bola.
      const hundido = Math.max(0, -(fino[i] * bola + grueso[i] * (0.6 * bola + 0.5 * medio)));
      sombra[i] = 1 - Math.min(0.42, hundido * 0.2) * (0.35 + 0.65 * bola);
    }
    posicion.needsUpdate = true;
    geometria.attributes.aSombra.needsUpdate = true;
    geometria.computeVertexNormals();
  }

  return { geometria, actualizar };
}
