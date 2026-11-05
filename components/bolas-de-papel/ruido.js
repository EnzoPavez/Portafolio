// Azar con semilla y ruido de gradiente 3D. Cada bola usa su propia semilla,
// así se arruga siempre igual entre visitas pero distinta de las demás.

export function generador(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function semillaDe(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Ruido de Perlin mejorado. Devuelve valores cerca de [-1, 1].
export function crearRuido(semilla) {
  const azar = generador(semilla);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];

  const suave = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const mezcla = (a, b, t) => a + t * (b - a);
  const grad = (h, x, y, z) => {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
  };

  return (x, y, z) => {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    X &= 255; Y &= 255; Z &= 255;
    const u = suave(x), v = suave(y), w = suave(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return mezcla(
      mezcla(
        mezcla(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        mezcla(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      mezcla(
        mezcla(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        mezcla(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  };
}
