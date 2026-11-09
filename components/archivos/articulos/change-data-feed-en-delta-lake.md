---
titulo: Change data feed (CDF) en Delta Lake
bajada: Cómo hacer que una tabla Delta registre cada inserción, cambio y borrado de fila, para leer solo lo que cambió.
tema: Delta Lake
fecha: 2026-10-06
imagen: imagenes/change-data-feed-en-delta-lake.jpg
---

## Qué es y qué resuelve

El change data feed (CDF) es una propiedad de las tablas Delta que hace que la tabla registre cada cambio a nivel de fila. Queda anotado qué filas se insertaron, cuáles se actualizaron (con su valor antes y después) y cuáles se borraron.

Sin CDF solo tienes la foto actual de la tabla. Para saber qué cambió anoche tendrías que comparar la tabla entera con su versión anterior, que es lento y costoso. Con CDF los cambios ya están registrados y solo lees esos.

**Analogía.** La tabla es un extracto bancario con tu saldo actual. CDF es la lista de movimientos (ingresos, cargos y anulaciones), cada uno con su fecha. Para actualizar tu contabilidad no comparas saldos, lees los movimientos nuevos.

Se usa sobre todo para tres cosas.

- Propagar cambios de bronze a silver o de silver a gold sin reprocesar toda la tabla.
- Mantener dimensiones SCD tipo 2 (historial de cambios).
- Sincronizar con otros sistemas o auditar qué cambió y cuándo.

## Cómo se activa y qué registra

```sql
-- En una tabla existente
ALTER TABLE ventas SET TBLPROPERTIES ('delta.enableChangeDataFeed' = true);

-- Al crear la tabla
CREATE TABLE ventas (id INT, importe DECIMAL(10,2))
TBLPROPERTIES ('delta.enableChangeDataFeed' = true);
```

Solo registra cambios desde que se activa, no hacia atrás.

Al leer los cambios, cada fila trae tres columnas extra.

| Columna | Qué indica |
| --- | --- |
| \_change\_type | insert, update\_preimage, update\_postimage o delete |
| \_commit\_version | Versión de la tabla en la que ocurrió el cambio |
| \_commit\_timestamp | Momento del cambio |

Así se ven unos cuantos cambios registrados.

| id | importe | \_change\_type | \_commit\_version |
| --- | --- | --- | --- |
| 7 | 100 | insert | 5 |
| 3 | 50 | update\_preimage | 6 |
| 3 | 80 | update\_postimage | 6 |
| 9 | 20 | delete | 7 |

Un UPDATE genera dos filas, una con el valor antiguo (preimage) y otra con el nuevo (postimage).

## Cómo se leen los cambios

En lote, indicas desde qué versión o fecha quieres leer.

```sql
-- Cambios desde la versión 5
SELECT * FROM table_changes('ventas', 5);

-- Cambios entre dos versiones
SELECT * FROM table_changes('ventas', 5, 10);

-- Cambios desde una fecha
SELECT * FROM table_changes('ventas', '2026-10-01');
```

```python
# Lo mismo en PySpark
cambios = (spark.read
           .format("delta")
           .option("readChangeFeed", "true")
           .option("startingVersion", 5)
           .table("ventas"))
```

En streaming, los cambios se procesan según van ocurriendo.

```python
# Lee solo los cambios nuevos en cada ejecución
cambios = (spark.readStream
           .format("delta")
           .option("readChangeFeed", "true")
           .table("ventas"))
```

La primera ejecución del stream devuelve la tabla actual como inserciones y, a partir de ahí, solo los cambios. El checkpoint guarda hasta qué versión se ha leído.

## Caso práctico, de silver a gold

La idea es que ventas\_gold refleje las inserciones, actualizaciones y borrados de ventas\_silver, procesando solo los cambios.

```python
from pyspark.sql import Window, functions as F

def aplicar_cambios(lote, batch_id):
    # Nos quedamos con el estado final de cada fila (sin las imágenes previas)
    ultimos = (lote
               .filter(F.col("_change_type") != "update_preimage")
               .withColumn("rn", F.row_number().over(
                   Window.partitionBy("id").orderBy(F.col("_commit_version").desc())))
               .filter("rn = 1"))
    ultimos.createOrReplaceTempView("cambios")

    # Aplicamos los cambios en la tabla destino
    lote.sparkSession.sql("""
        MERGE INTO ventas_gold AS d
        USING cambios AS c
        ON d.id = c.id
        WHEN MATCHED AND c._change_type = 'delete' THEN DELETE
        WHEN MATCHED THEN UPDATE SET d.importe = c.importe
        WHEN NOT MATCHED AND c._change_type != 'delete' THEN
            INSERT (id, importe) VALUES (c.id, c.importe)
    """)

(spark.readStream
   .format("delta")
   .option("readChangeFeed", "true")
   .table("ventas_silver")
   .writeStream
   .foreachBatch(aplicar_cambios)
   .option("checkpointLocation", "/Volumes/main/ventas/checkpoints/gold")
   .trigger(availableNow=True)
   .start())
```

- **Filtrar update\_preimage.** Solo interesa el valor nuevo de cada actualización.
- **Quedarse con la última versión por id.** Si una fila cambió varias veces en el lote, se aplica solo su estado final.
- **foreachBatch.** Permite usar MERGE dentro de un stream.

En canalizaciones declarativas, AUTO CDC (antes APPLY CHANGES) hace todo esto con unas pocas líneas, incluido SCD tipo 1 o tipo 2.

## Streams sobre tablas que cambian

Un stream normal sobre una tabla Delta solo admite anexados. Si el origen recibe un UPDATE, DELETE o MERGE, el stream falla. Estas opciones deciden qué hacer en ese caso.

| Opción | Qué hace | Cuándo usarla |
| --- | --- | --- |
| readChangeFeed | Lee los cambios fila a fila con su tipo | Cuando necesitas inserciones, actualizaciones y borrados |
| skipChangeCommits | Ignora las confirmaciones que modifican o borran datos | Cuando solo te interesan los anexados |
| ignoreChanges (antigua) | Reemite los archivos reescritos como filas nuevas, con duplicados y sin borrados | Sustituida por skipChangeCommits |
| ignoreDeletes | Ignora solo borrados de particiones completas | Casos muy concretos |

La elección depende de lo que necesite la canalización posterior. Si tiene que reflejar actualizaciones y borrados, activa CDF en el origen y lee con readChangeFeed. Si solo trabaja con filas nuevas y los cambios en el origen no le importan, skipChangeCommits evita que el stream falle sin necesidad de CDF.

## Coste y retención

CDF ocupa algo más de almacenamiento, porque guarda los cambios aparte (en la carpeta \_change\_data cuando hace falta). Esos datos se limpian con VACUUM según la retención de la tabla, así que solo puedes leer cambios dentro de ese periodo.

## CDF en Fabric

Existe igual en Fabric, porque las tablas del lakehouse son Delta. Se activa con la misma propiedad desde un notebook y se lee con table\_changes o readChangeFeed. Es la base habitual para cargas incrementales entre capas de una arquitectura medallion en Fabric.

## Diferencias con time travel y checkpoint

Las tres cosas tienen que ver con versiones y progreso, pero responden a preguntas distintas.

| Funcionalidad | Qué te da | Para qué sirve |
| --- | --- | --- |
| Change data feed | Los cambios fila a fila, con su tipo y la versión en que ocurrieron | Procesar solo lo que cambió, mantener SCD, auditar |
| Time travel | La tabla completa tal como estaba en una versión o fecha | Consultar un estado anterior de la tabla |
| Checkpoint | El progreso de un stream, hasta qué versión del origen ya leyó | Que el stream retome donde se quedó |

Con [time travel](time-travel-en-delta-lake.md) ves la foto entera de un momento pasado, pero no qué filas cambiaron. Para sacarlo tendrías que comparar dos versiones completas, que es justo lo que CDF te ahorra.

El [checkpoint](checkpoints-en-structured-streaming.md) no registra cambios de la tabla, solo recuerda por dónde va el stream que la lee. Cuando lees el change data feed en streaming, los dos trabajan juntos. CDF aporta los cambios y el checkpoint evita volver a procesar los que ya leíste.

## Errores comunes

- **Esperar cambios anteriores a la activación.** CDF solo registra desde que activas la propiedad. Lo que pasó antes no está en el feed.
- **Aplicar las update\_preimage como si fueran el valor nuevo.** Cada UPDATE trae dos filas, y la que vale para el destino es la update\_postimage.
- **Aplicar varios cambios de la misma fila sin ordenarlos.** Si un id cambió más de una vez en el lote, quédate con su último estado según \_commit\_version.
- **Sorprenderse con la primera ejecución del stream.** Devuelve la tabla actual completa como inserciones antes de empezar a dar solo los cambios.
- **Querer leer cambios muy antiguos.** VACUUM limpia los datos de cambios según la retención de la tabla, y fuera de ese periodo ya no se pueden leer.
- **Seguir usando ignoreChanges.** Reemite filas duplicadas y no informa de los borrados. Para ignorar los cambios, skipChangeCommits es la opción actual.

## Resumen

- Para llevar inserciones, actualizaciones y borrados de una tabla Delta a una canalización posterior, activa CDF en el origen y lee con readChangeFeed = true.
- Si un stream falla porque el origen recibe UPDATE o DELETE y solo te interesan los anexados, usa skipChangeCommits.
- CDF se activa con la propiedad de tabla delta.enableChangeDataFeed.
- Para leer en lote los cambios entre versiones, usa table\_changes.
- En canalizaciones declarativas, AUTO CDC (antes APPLY CHANGES) aplica los cambios y mantiene SCD por ti.
- No es lo mismo que el checkpoint (guarda el progreso de un stream) ni que el time travel (lee una versión completa de la tabla, no los cambios fila a fila).
