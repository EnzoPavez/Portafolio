---
titulo: Chuleta de Markdown
bajada: Todo lo que se puede escribir en un archivo de esta sección, con el código a la vista y el resultado debajo.
tema: Referencia
fecha: 2026-09-15
---

Markdown es texto plano con algunas marcas para dar formato. Esta chuleta sirve de referencia rápida y, de paso, para revisar cómo se ve cada elemento con los estilos de la sección.

## Texto

```markdown
Un párrafo normal. Para separar párrafos se deja una línea en blanco.

Texto en **negrita**, en *cursiva* y con `código` dentro de la línea.
```

Un párrafo normal. Para separar párrafos se deja una línea en blanco.

Texto en **negrita**, en *cursiva* y con `código` dentro de la línea.

## Subtítulos

```markdown
## Subtítulo de sección, aparece en el índice
### Subtítulo menor, no aparece en el índice
```

### Así se ve un subtítulo menor

Sirve para dividir una sección larga sin llenar el índice de entradas.

## Listas

```markdown
- Un punto
- Otro punto
  - Uno dentro del anterior

1. Primer paso
2. Segundo paso
```

- Un punto
- Otro punto
  - Uno dentro del anterior

1. Primer paso
2. Segundo paso

## Citas

```markdown
> Lo que se cita de otro texto va con un signo mayor al principio.
```

> Lo que se cita de otro texto va con un signo mayor al principio.

## Código

Un bloque de código va entre dos líneas de tres comillas invertidas, y en la primera se puede indicar el lenguaje.

````markdown
```js
const saludo = "hola";
console.log(saludo);
```
````

```js
const saludo = "hola";
console.log(saludo);
```

## Tablas

```markdown
| Tema | Archivos |
| --- | ---: |
| Diseño | 4 |
| Lecturas | 12 |
```

| Tema | Archivos |
| --- | ---: |
| Diseño | 4 |
| Lecturas | 12 |

## Enlaces e imágenes

```markdown
[Un enlace a otra página](https://ejemplo.com)
[Otro archivo de esta sección](como-agregar-un-archivo.md)
![Descripción](imagen.jpg "Pie de foto")
```

Los enlaces a otras páginas se abren en una pestaña nueva. Los que terminan en `.md` llevan a otro archivo de la sección, como [esta guía para agregar archivos](como-agregar-un-archivo.md).

## Separadores

```markdown
---
```

Tres guiones solos en una línea dibujan una raya que separa partes del texto.

---

Y con eso alcanza para casi todo.
