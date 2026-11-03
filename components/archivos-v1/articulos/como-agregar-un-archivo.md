---
titulo: Cómo agregar un archivo
bajada: Lo que hay que hacer para sumar un artículo o un documento a esta sección, desde el archivo vacío hasta verlo publicado.
tema: Guía
fecha: 2026-11-03
---

Cada archivo de esta sección es un texto en Markdown guardado en la carpeta `articulos`. La portada y la vista de lectura se arman solas a partir de esos textos, así que para publicar algo nuevo no hace falta tocar nada de HTML.

Son cinco pasos, y el único que lleva trabajo de verdad es escribir.

## Crear el archivo

Crea un archivo nuevo dentro de `components/archivos/articulos` con la extensión `.md`. El nombre del archivo es también su dirección, así que conviene que sea corto y que use solo minúsculas, números y guiones, sin tildes ni espacios.

| Nombre | ¿Sirve? |
| --- | --- |
| `diseno-de-formularios.md` | Sí |
| `Diseño de formularios.md` | No, tiene mayúsculas, tilde y espacios |
| `notas_2026.md` | No, usa guion bajo |

## La cabecera

Arriba de todo va una cabecera entre dos líneas de tres guiones. Cada línea es un dato, con su nombre, dos puntos y el valor.

```yaml
---
titulo: El título que se ve arriba
bajada: Una o dos frases que resumen el texto.
tema: Diseño
fecha: 2026-11-03
autor: Quien lo escribió, si no fuiste tú
fuente: https://enlace-al-original.com
---
```

- **titulo** y **tema** son los importantes. El tema decide en qué grupo de la portada aparece el archivo, y mayúsculas o tildes de más no crean un grupo nuevo.
- **bajada** es opcional, pero ayuda mucho a quien llega desde la portada.
- **fecha** ordena los archivos dentro de cada tema, del más nuevo al más viejo. Va como año, mes y día. Los de los últimos 30 días llevan la etiqueta "Nuevo".
- **autor** y **fuente** son para los textos de otras personas. Con una fuente aparece el botón "Ver original" y el enlace al sitio debajo del título.

## Escribir el texto

Debajo de la cabecera va el texto, en Markdown normal. Cada subtítulo de nivel dos (una línea que empieza con `##`) se convierte en una entrada del índice lateral, así que conviene que sean cortos. Los de nivel tres (`###`) ordenan el texto sin aparecer en el índice.

Si tienes dudas con la sintaxis, la [chuleta de Markdown](chuleta-de-markdown.md) tiene todos los elementos que se pueden usar y cómo se ven.

> Para guardar un artículo de otra persona, pega el texto, ponle la cabecera con su autor y su fuente, y agrega arriba un párrafo con lo que te interesó. Así queda claro qué es tuyo y qué no.

## Imágenes y documentos

Las imágenes y los PDF van en la misma carpeta que el texto y se nombran directo, sin ruta.

```markdown
![Descripción de la imagen](mi-imagen.jpg "Pie de foto opcional")

[Descargar el informe completo](informe.pdf)
```

El texto entre comillas después del nombre de la imagen se muestra como pie de foto. Para enlazar otro archivo de esta sección basta con poner su nombre con `.md`, como en el enlace a la chuleta de más arriba.

## Sumarlo a la lista

El navegador no puede ver qué hay dentro de una carpeta, así que la portada usa `articulos/lista.json` para saber qué archivos existen. Agrega ahí el nombre del archivo nuevo, sin el `.md`.

```json
[
  "como-agregar-un-archivo",
  "chuleta-de-markdown",
  "diseno-de-formularios"
]
```

El orden de la lista no importa, porque la portada ordena por tema y por fecha.

## Verlo en el navegador

Las páginas leen los archivos con JavaScript, por eso no funcionan abriendo `index.html` con doble clic. Hay que levantar un servidor local desde la carpeta del portafolio.

```bash
npx serve components/archivos
```

Después se abre la dirección que muestra la terminal, normalmente `http://localhost:3000`. La extensión Live Server de VS Code también sirve.
