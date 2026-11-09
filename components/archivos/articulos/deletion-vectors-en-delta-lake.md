---
titulo: Deletion vectors en Delta Lake, un ejemplo práctico
bajada: Un ejemplo paso a paso de cómo Delta marca las filas borradas sin reescribir el archivo Parquet entero.
tema: Delta Lake
fecha: 2026-10-03
imagen: imagenes/deletion-vectors-en-delta-lake.jpg
---

## Qué son y qué problema resuelven

Los deletion vectors evitan reescribir archivos completos cada vez que haces un UPDATE, DELETE o MERGE. Los archivos Parquet de una tabla Delta no se pueden editar, así que sin deletion vectors cambiar una sola fila obliga a reescribir el archivo entero que la contiene.

Con deletion vectors, Delta guarda aparte una pequeña marca que dice qué filas de ese archivo ya no son válidas. Al consultar, el motor descarta esas filas y el usuario ve directamente el dato correcto.

La analogía de un libro ayuda a verlo.

| Libro | Delta Lake |
| --- | --- |
| El libro | La tabla |
| Cada página impresa | Un archivo Parquet (no se puede modificar) |
| Un post-it con la corrección | El deletion vector |
| El lector que mira página y post-it | El motor (Spark, SQL endpoint, Direct Lake) |
| Reimprimir las páginas corregidas | OPTIMIZE o REORG |
| Tirar las páginas viejas a la basura | VACUUM |

Sin deletion vectors, cada errata obliga a reimprimir la página. Con ellos, pegas un post-it, que es rápido y barato, y reimprimes de vez en cuando muchas correcciones juntas.

## Con y sin deletion vectors

La diferencia está en quién paga el cambio. Sin deletion vectors lo paga la escritura, que reescribe el archivo en el momento. Con ellos, la escritura es ligera y la lectura tiene que aplicar las marcas hasta que alguien consolida los archivos. En los formatos de tabla abiertos esta diferencia se suele llamar copy-on-write frente a merge-on-read.

| Aspecto | Sin deletion vectors | Con deletion vectors |
| --- | --- | --- |
| Al cambiar o borrar una fila | Se reescribe entero el archivo Parquet que la contiene | Se guarda una marca con las filas que dejan de valer y, en un UPDATE, un archivo pequeño con las filas nuevas |
| Coste de la escritura | Alto, aunque cambie una sola fila | Bajo |
| Al leer | El motor lee el archivo tal cual | El motor lee el archivo y descarta las filas marcadas |
| Mantenimiento | No hay marcas que consolidar | De vez en cuando, un OPTIMIZE o un REORG reescribe los archivos con filas marcadas |

## Paso 1. Crear la tabla y cargar datos

Creamos una tabla de clientes con los deletion vectors activados y cargamos cinco filas. "Sevila" está mal escrito a propósito para corregirlo después.

```sql
-- Tabla de clientes con deletion vectors activados
CREATE TABLE clientes (
    id INT,
    nombre STRING,
    ciudad STRING
)
TBLPROPERTIES ('delta.enableDeletionVectors' = true);

-- Cargamos unos clientes de prueba
INSERT INTO clientes VALUES
    (1, 'Ana', 'Madrid'),
    (2, 'Luis', 'Bilbao'),
    (3, 'Marta', 'Salamanca'),
    (4, 'Pedro', 'Sevila'),
    (5, 'Lucia', 'Valencia');

-- Vemos cómo queda
SELECT * FROM clientes;
```

| id | nombre | ciudad |
| --- | --- | --- |
| 1 | Ana | Madrid |
| 2 | Luis | Bilbao |
| 3 | Marta | Salamanca |
| 4 | Pedro | Sevila |
| 5 | Lucia | Valencia |

En este punto la tabla tiene un único archivo Parquet con las cinco filas, que hace de "página impresa".

## Paso 2. Corregir y borrar

Corregimos la errata de Pedro y eliminamos a Lucia. El usuario ve el resultado correcto, pero el archivo original no se toca.

```sql
-- Corregimos la errata de Pedro
UPDATE clientes SET ciudad = 'Sevilla' WHERE id = 4;

-- Lucia pide la baja y la eliminamos
DELETE FROM clientes WHERE id = 5;

-- Lo que ve cualquier usuario al consultar
SELECT * FROM clientes;
```

| id | nombre | ciudad |
| --- | --- | --- |
| 1 | Ana | Madrid |
| 2 | Luis | Bilbao |
| 3 | Marta | Salamanca |
| 4 | Pedro | Sevilla |

Para ver qué ha pasado por dentro, revisamos el historial.

```sql
-- Historial de operaciones de la tabla
DESCRIBE HISTORY clientes;
```

| operation | operationMetrics (lo importante) |
| --- | --- |
| DELETE | `numDeletionVectorsAdded: 1`, `numRemovedFiles: 0` |
| UPDATE | `numDeletionVectorsAdded: 1`, `numAddedFiles: 1`, `numRemovedFiles: 0` |
| WRITE | `numFiles: 1`, `numOutputRows: 5` |

- **`numRemovedFiles` vale 0.** No se reimprimió ninguna página. El archivo original sigue intacto, con la fila de Lucia y la de "Sevila".
- **`numDeletionVectorsAdded` vale 1.** Se pegó un post-it que marca como no válidas la versión vieja de Pedro y la fila de Lucia.
- **`numAddedFiles` vale 1 en el UPDATE.** Se escribió un archivo pequeño con la fila nueva de Pedro ya corregida.

Quien consulta la tabla nunca ve el registro malo, porque el motor aplica el post-it antes de devolver el resultado.

## Paso 3. Consolidar y limpiar

Primero "reimprimimos" el archivo con las correcciones aplicadas y después borramos del almacenamiento el archivo viejo.

```sql
-- Reescribe los archivos que tienen filas marcadas y descarta los post-its
REORG TABLE clientes APPLY (PURGE);

-- Revisamos qué ha hecho
DESCRIBE HISTORY clientes;
```

| operation | operationMetrics (lo importante) |
| --- | --- |
| REORG | `numRemovedFiles: 1`, `numAddedFiles: 1`, `numDeletionVectorsRemoved: 1` |

- **`numRemovedFiles` vale 1.** El archivo viejo deja de formar parte de la tabla.
- **`numAddedFiles` vale 1.** Se escribe uno nuevo limpio, con "Sevilla" y sin Lucia.
- **`numDeletionVectorsRemoved` vale 1.** El post-it ya no hace falta y se descarta.

Usamos REORG ... APPLY (PURGE) porque fuerza la limpieza. Un OPTIMIZE normal también lo haría aquí (2 de 5 filas marcadas supera el umbral del 5%), pero su objetivo principal es compactar archivos pequeños.

| Comando | Para qué sirve | Qué hace con las filas marcadas |
| --- | --- | --- |
| OPTIMIZE | Compactar archivos pequeños | Reescribe los archivos cuyas filas marcadas superan el umbral del 5% |
| REORG TABLE ... APPLY (PURGE) | Forzar la limpieza de las filas marcadas | Reescribe los archivos que tienen filas marcadas y descarta los deletion vectors |

El archivo viejo sigue existiendo físicamente para permitir el time travel. Para borrarlo de verdad hace falta un VACUUM.

```sql
-- Solo para la prueba: permite borrar archivos recientes
SET spark.databricks.delta.retentionDurationCheck.enabled = false;

-- Borra del almacenamiento los archivos que ya no usa la tabla
VACUUM clientes RETAIN 0 HOURS;
```

Tras el VACUUM, la fila de Lucia y la de "Sevila" han desaparecido físicamente y no se pueden recuperar ni con time travel.

**Aviso.** RETAIN 0 HOURS es solo para la demo. En producción se deja la retención por defecto (7 días). Borrar archivos que aún usa una consulta o un proceso puede romperlo, y además se pierde la posibilidad de volver atrás.

## Borrado lógico, paso intermedio y borrado físico

El ciclo completo pasa de un borrado lógico a uno físico, con un paso intermedio entre ambos.

| Fase | Comando | Qué ve el usuario | Qué hay en el almacenamiento |
| --- | --- | --- | --- |
| Borrado lógico | UPDATE / DELETE con deletion vectors | El dato ya no existe | El dato sigue dentro del archivo original, marcado |
| Paso intermedio | OPTIMIZE o REORG | El dato ya no existe | El dato ya no está en los archivos activos, pero el archivo viejo sigue guardado para el time travel |
| Borrado físico | VACUUM | El dato ya no existe | El archivo viejo se elimina y el dato desaparece del todo |

El paso intermedio es el que más fácil se pasa por alto. Después del OPTIMIZE o el REORG, el dato ya no está en los archivos activos de la tabla, pero el archivo viejo sigue en el almacenamiento por si quieres hacer time travel. Solo con el VACUUM desaparece del todo.

Si el borrado es por motivos legales (por ejemplo, eliminar datos personales), hay que completar el ciclo hasta el VACUUM.

## Uso en Fabric

En Fabric funciona igual, porque las tablas del lakehouse son Delta. Los deletion vectors se activan en las tablas escritas con Spark y los respetan Spark, el SQL analytics endpoint y Power BI Direct Lake. Microsoft recomienda mantenerlos activados en tablas con actualizaciones, borrados o merges frecuentes, junto con la compactación automática.

Para que todas las tablas nuevas de una sesión los tengan, basta con esta configuración.

```python
spark.conf.set("spark.databricks.delta.properties.defaults.enableDeletionVectors", "true")
```

Esa propiedad también puede ir en un Environment para aplicarla a todos los notebooks que lo usen. A diferencia de Databricks, en Fabric el OPTIMIZE y el VACUUM los programas tú, desde el lakehouse (Maintenance), un notebook o un pipeline.

## Resumen

1. **UPDATE / DELETE.** Se pegan post-its, rápido y barato.
2. **OPTIMIZE / REORG.** Se reimprime y se quitan los post-its, costoso pero solo de vez en cuando (por ejemplo, de noche).
3. **VACUUM.** Se tiran las páginas viejas, borrado físico real.

## Fuentes

- [Table maintenance and optimization - Microsoft Learn](https://learn.microsoft.com/en-us/fabric/fundamentals/table-maintenance-optimization)
- [Delta Lake overview - Microsoft Learn](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-overview)
