---
titulo: Deletion vectors en Delta Lake: ejemplo práctico
bajada: Un ejemplo paso a paso de cómo Delta marca las filas borradas sin reescribir el archivo Parquet entero.
tema: Delta Lake
fecha: 2026-10-03
---

## Qué son y qué problema resuelven

Los deletion vectors evitan reescribir archivos completos cada vez que haces un UPDATE, DELETE o MERGE. Los archivos Parquet de una tabla Delta no se pueden editar: sin deletion vectors, cambiar una sola fila obliga a reescribir el archivo entero que la contiene.

Con deletion vectors, Delta guarda aparte una pequeña marca que dice qué filas de ese archivo ya no son válidas. Al consultar, el motor descarta esas filas y el usuario ve directamente el dato correcto.

**Analogía del libro:**

| Libro | Delta Lake |
| --- | --- |
| El libro | La tabla |
| Cada página impresa | Un archivo Parquet (no se puede modificar) |
| Un post-it con la corrección | El deletion vector |
| El lector que mira página y post-it | El motor (Spark, SQL endpoint, Direct Lake) |
| Reimprimir las páginas corregidas | OPTIMIZE o REORG |
| Tirar las páginas viejas a la basura | VACUUM |

Sin deletion vectors, cada errata obliga a reimprimir la página. Con ellos, pegas un post-it, que es rápido y barato, y reimprimes de vez en cuando muchas correcciones juntas.

## Paso 1: crear la tabla y cargar datos

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

En este punto la tabla tiene un único archivo Parquet con las cinco filas: la "página impresa".

## Paso 2: corregir y borrar

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

Para ver qué ha pasado por dentro, revisamos el historial:

```sql
-- Historial de operaciones de la tabla
DESCRIBE HISTORY clientes;
```

| operation | operationMetrics (lo importante) |
| --- | --- |
| DELETE | numDeletionVectorsAdded: 1, numRemovedFiles: 0 |
| UPDATE | numDeletionVectorsAdded: 1, numAddedFiles: 1, numRemovedFiles: 0 |
| WRITE | numFiles: 1, numOutputRows: 5 |

- **numRemovedFiles: 0:** no se reimprimió ninguna página. El archivo original sigue intacto, con la fila de Lucia y la de "Sevila".
- **numDeletionVectorsAdded: 1:** se pegó un post-it que marca como no válidas la versión vieja de Pedro y la fila de Lucia.
- **numAddedFiles: 1 en el UPDATE:** se escribió un archivo pequeño con la fila nueva de Pedro ya corregida.

Quien consulta la tabla nunca ve el registro malo: el motor aplica el post-it antes de devolver el resultado.

## Paso 3: consolidar y limpiar

Primero "reimprimimos" el archivo con las correcciones aplicadas y después borramos del almacenamiento el archivo viejo.

```sql
-- Reescribe los archivos que tienen filas marcadas y descarta los post-its
REORG TABLE clientes APPLY (PURGE);

-- Revisamos qué ha hecho
DESCRIBE HISTORY clientes;
```

| operation | operationMetrics (lo importante) |
| --- | --- |
| REORG | numRemovedFiles: 1, numAddedFiles: 1, numDeletionVectorsRemoved: 1 |

- **numRemovedFiles: 1:** el archivo viejo deja de formar parte de la tabla.
- **numAddedFiles: 1:** se escribe uno nuevo limpio, con "Sevilla" y sin Lucia.
- **numDeletionVectorsRemoved: 1:** el post-it ya no hace falta y se descarta.

Usamos REORG ... APPLY (PURGE) porque fuerza la limpieza. Un OPTIMIZE normal también lo haría aquí (2 de 5 filas marcadas supera el umbral del 5%), pero su objetivo principal es compactar archivos pequeños.

El archivo viejo sigue existiendo físicamente para permitir el time travel. Para borrarlo de verdad:

```sql
-- Solo para la prueba: permite borrar archivos recientes
SET spark.databricks.delta.retentionDurationCheck.enabled = false;

-- Borra del almacenamiento los archivos que ya no usa la tabla
VACUUM clientes RETAIN 0 HOURS;
```

Tras el VACUUM, la fila de Lucia y la de "Sevila" han desaparecido físicamente y no se pueden recuperar ni con time travel.

**Aviso:** RETAIN 0 HOURS es solo para la demo. En producción se deja la retención por defecto (7 días): borrar archivos que aún usa una consulta o un proceso puede romperlo, y además se pierde la posibilidad de volver atrás.

## Borrado lógico, paso intermedio y borrado físico

El ciclo equivale a pasar de un borrado lógico a uno físico, con un paso intermedio entre ambos.

| Fase | Comando | Qué ve el usuario | Qué hay en el almacenamiento |
| --- | --- | --- | --- |
| Borrado lógico | UPDATE / DELETE con deletion vectors | El dato ya no existe | El dato sigue dentro del archivo original, marcado |
| Paso intermedio | OPTIMIZE o REORG | El dato ya no existe | El dato ya no está en los archivos activos, pero el archivo viejo sigue guardado para el time travel |
| Borrado físico | VACUUM | El dato ya no existe | El archivo viejo se elimina y el dato desaparece del todo |

Con un matiz: entre ambos hay un paso intermedio. Después del OPTIMIZE o el REORG, el dato ya no está en los archivos activos de la tabla, pero el archivo viejo sigue en el almacenamiento por si quieres hacer time travel. Solo con el VACUUM desaparece del todo.

Si el borrado es por motivos legales (por ejemplo, eliminar datos personales), hay que completar el ciclo hasta el VACUUM.

## Resumen y uso en Fabric

1. **UPDATE / DELETE:** se pegan post-its, rápido y barato.
2. **OPTIMIZE / REORG:** se reimprime y se quitan los post-its, costoso pero solo de vez en cuando (por ejemplo, de noche).
3. **VACUUM:** se tiran las páginas viejas, borrado físico real.

En Fabric funciona igual, porque las tablas del lakehouse son Delta. Los deletion vectors se activan en las tablas escritas con Spark y los respetan Spark, el SQL analytics endpoint y Power BI Direct Lake. Microsoft recomienda mantenerlos activados en tablas con actualizaciones, borrados o merges frecuentes, junto con la compactación automática.

Para que todas las tablas nuevas de una sesión los tengan:

```python
spark.conf.set("spark.databricks.delta.properties.defaults.enableDeletionVectors", "true")
```

Esa propiedad también puede ir en un Environment para aplicarla a todos los notebooks que lo usen. A diferencia de Databricks, en Fabric el OPTIMIZE y el VACUUM los programas tú: desde el lakehouse (Maintenance), un notebook o un pipeline.

## Fuentes

- [Table maintenance and optimization - Microsoft Learn](https://learn.microsoft.com/en-us/fabric/fundamentals/table-maintenance-optimization)
- [Delta Lake overview - Microsoft Learn](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-overview)
