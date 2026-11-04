---
titulo: Change data feed (CDF) en Delta Lake
bajada: Cómo hacer que una tabla Delta registre cada inserción, cambio y borrado de fila, para leer solo lo que cambió.
tema: Delta Lake
fecha: 2026-10-06
---

## Qué es y qué resuelve

El change data feed (CDF) es una propiedad de las tablas Delta que hace que la tabla registre cada cambio a nivel de fila: qué filas se insertaron, cuáles se actualizaron (con su valor antes y después) y cuáles se borraron.

**El problema que resuelve:** sin CDF solo tienes la foto actual de la tabla. Para saber qué cambió anoche tendrías que comparar la tabla entera con su versión anterior, que es lento y costoso. Con CDF los cambios ya están registrados y solo lees esos.

**Analogía:** la tabla es un extracto bancario con tu saldo actual. CDF es la lista de movimientos: ingresos, cargos y anulaciones, cada uno con su fecha. Para actualizar tu contabilidad no comparas saldos: lees los movimientos nuevos.

**Para qué se usa:**

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

Al leer los cambios, cada fila trae tres columnas extra:

| Columna | Qué indica |
| --- | --- |
| \_change\_type | insert, update\_preimage, update\_postimage o delete |
| \_commit\_version | Versión de la tabla en la que ocurrió el cambio |
| \_commit\_timestamp | Momento del cambio |

**Ejemplo de cambios registrados:**

| id | importe | \_change\_type | \_commit\_version |
| --- | --- | --- | --- |
| 7 | 100 | insert | 5 |
| 3 | 50 | update\_preimage | 6 |
| 3 | 80 | update\_postimage | 6 |
| 9 | 20 | delete | 7 |

Un UPDATE genera dos filas: el valor antiguo (preimage) y el nuevo (postimage).

## Cómo se leen los cambios

**En lote**, indicando desde qué versión o fecha:

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

**En streaming**, para procesar los cambios según van ocurriendo:

```python
# Lee solo los cambios nuevos en cada ejecución
cambios = (spark.readStream
           .format("delta")
           .option("readChangeFeed", "true")
           .table("ventas"))
```

En streaming, la primera ejecución devuelve la tabla actual como inserciones y, a partir de ahí, solo los cambios. El checkpoint guarda hasta qué versión se ha leído.

## Caso práctico: propagar cambios de silver a gold

Objetivo: que ventas\_gold refleje las inserciones, actualizaciones y borrados de ventas\_silver, procesando solo los cambios.

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

- **Filtrar update\_preimage:** solo interesa el valor nuevo de cada actualización.
- **Quedarse con la última versión por id:** si una fila cambió varias veces en el lote, se aplica solo su estado final.
- **foreachBatch:** permite usar MERGE dentro de un stream.

En canalizaciones declarativas, AUTO CDC (antes APPLY CHANGES) hace todo esto con unas pocas líneas, incluido SCD tipo 1 o tipo 2.

## Opciones de streaming, coste y Fabric

Un stream normal sobre una tabla Delta solo admite anexados: si el origen recibe un UPDATE, DELETE o MERGE, el stream falla. Estas opciones deciden qué hacer:

| Opción | Qué hace | Cuándo usarla |
| --- | --- | --- |
| readChangeFeed | Lee los cambios fila a fila con su tipo | Cuando necesitas inserciones, actualizaciones y borrados |
| skipChangeCommits | Ignora las confirmaciones que modifican o borran datos | Cuando solo te interesan los anexados |
| ignoreChanges (antigua) | Reemite los archivos reescritos como filas nuevas, con duplicados y sin borrados | Sustituida por skipChangeCommits |
| ignoreDeletes | Ignora solo borrados de particiones completas | Casos muy concretos |

**Coste:** CDF ocupa algo más de almacenamiento, porque guarda los cambios aparte (en la carpeta \_change\_data cuando hace falta). Esos datos se limpian con VACUUM según la retención de la tabla, así que solo puedes leer cambios dentro de ese periodo.

**En Fabric:** existe igual, porque las tablas del lakehouse son Delta. Se activa con la misma propiedad desde un notebook y se lee con table\_changes o readChangeFeed. Es la base habitual para cargas incrementales entre capas de una arquitectura medallion en Fabric.

## Para el examen

- Ingerir **inserciones, actualizaciones y eliminaciones** de una tabla Delta en una canalización posterior: **readChangeFeed = true** (con CDF activado en el origen).
- Un stream que **falla porque el origen recibe UPDATE o DELETE** y solo te interesan los anexados: **skipChangeCommits**.
- Activar CDF: propiedad de tabla **delta.enableChangeDataFeed**.
- Leer cambios en lote entre versiones: **table\_changes**.
- Aplicar cambios o mantener SCD en canalizaciones declarativas: **AUTO CDC** (antes APPLY CHANGES).
- No confundir con el **checkpoint** (guarda el progreso de un stream) ni con el **time travel** (lee una versión completa de la tabla, no los cambios fila a fila).
