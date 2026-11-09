---
titulo: Time travel en Delta Lake
bajada: Cómo consultar una tabla Delta tal como estaba en una versión o fecha anterior, y hasta dónde se puede volver.
tema: Delta Lake
fecha: 2026-10-06
imagen: imagenes/time-travel-en-delta-lake.jpg
---

## Qué es y cómo funciona

Time travel es la capacidad de Delta Lake de consultar una tabla tal como estaba en una versión o momento anterior. Viene integrado en todas las tablas Delta, así que no hay que activarlo ni construir nada.

**Cómo funciona por dentro.** Cada escritura (INSERT, UPDATE, DELETE, MERGE, OPTIMIZE...) crea una nueva versión de la tabla y queda anotada en el [registro de transacciones](registro-de-transacciones-y-acid.md) (`_delta_log`). Cada versión sabe qué archivos Parquet la forman. Como los archivos no se modifican, sino que se añaden otros nuevos, los archivos de versiones anteriores siguen existiendo hasta que VACUUM los borra.

| Versión | Operación | Archivos activos |
| --- | --- | --- |
| 0 | CREATE + INSERT | A |
| 1 | INSERT | A, B |
| 2 | UPDATE (reescribe A) | B, C |

Para leer la versión 1, Delta lee los archivos A y B, aunque A ya no forme parte de la versión actual.

**Analogía.** Es el historial de versiones de un documento de Word en OneDrive. Puedes abrir cómo estaba el documento ayer sin perder la versión actual, pero solo mientras esas versiones antiguas se conserven.

## Cómo consultar versiones anteriores

Primero, mira qué versiones existen con DESCRIBE HISTORY.

```sql
-- Lista de versiones con fecha, operación y usuario
DESCRIBE HISTORY clientes;
```

Después, consulta la que te interese, por número de versión o por fecha.

```sql
-- Por número de versión
SELECT * FROM clientes VERSION AS OF 5;

-- Por fecha y hora
SELECT * FROM clientes TIMESTAMP AS OF '2026-10-01 08:00:00';

-- Forma abreviada por versión
SELECT * FROM clientes@v5;
```

```python
# Lo mismo en PySpark
df = spark.read.option("versionAsOf", 5).table("clientes")
df = spark.read.option("timestampAsOf", "2026-10-01").table("clientes")
```

Un ejemplo de análisis es comparar la versión actual con la de ayer para ver qué clientes son nuevos.

```sql
SELECT id FROM clientes
EXCEPT
SELECT id FROM clientes TIMESTAMP AS OF date_sub(current_date(), 1);
```

## Deshacer errores con RESTORE

Si un proceso borra o corrompe datos, puedes devolver la tabla a una versión anterior.

```sql
-- Vuelve la tabla al estado de la versión 5
RESTORE TABLE clientes TO VERSION AS OF 5;

-- O al de una fecha concreta
RESTORE TABLE clientes TO TIMESTAMP AS OF '2026-10-01 08:00:00';
```

RESTORE no borra el historial. Crea una versión nueva cuyo contenido es igual al de la versión elegida, así que si te equivocas puedes volver a restaurar.

## Otros usos habituales

- **Auditoría.** Ver cómo estaban los datos en una fecha concreta.
- **Reproducibilidad.** Repetir un análisis o entrenar un modelo con exactamente los mismos datos que se usaron entonces.
- **Recuperar filas concretas.** Insertar de nuevo registros borrados por error leyendo una versión antigua, sin restaurar la tabla entera.

```sql
-- Recuperar un cliente borrado por error
INSERT INTO clientes
SELECT * FROM clientes VERSION AS OF 5 WHERE id = 42;
```

## Límites de retención y VACUUM

Time travel solo llega hasta donde se conservan a la vez el historial de versiones y los archivos de datos de esas versiones. Cada uno tiene su propia propiedad de tabla.

| Qué se necesita | Propiedad que lo controla | Por defecto |
| --- | --- | --- |
| El historial de versiones (el log) | delta.logRetentionDuration | 30 días |
| Los archivos de datos antiguos | delta.deletedFileRetentionDuration | 7 días |

Con los valores por defecto, en la práctica solo puedes viajar unos 7 días atrás. Pasado ese plazo, [VACUUM](optimize-vacuum-y-optimizaciones-delta.md) borra los archivos antiguos y, aunque el log recuerde la versión, sus datos ya no existen.

Se puede ampliar subiendo ambas propiedades (por ejemplo, a 90 días), pero tiene un coste, porque los archivos antiguos siguen ocupando almacenamiento. Por eso la documentación de Databricks desaconseja usar el historial de la tabla como archivo a largo plazo.

**Regla práctica.** Time travel sirve para el corto plazo (auditoría reciente, deshacer errores, reproducibilidad). Para un historial de años, el historial tiene que estar en los propios datos, por ejemplo con una SCD de tipo 2.

## Time travel frente a SCD tipo 2 y CDF

Los tres tienen que ver con el historial, pero responden a preguntas distintas.

|  | Time travel | SCD tipo 2 | Change data feed |
| --- | --- | --- | --- |
| Qué responde | ¿Cómo estaba la tabla entera en un momento? | ¿Qué valores tuvo cada registro y cuándo? | ¿Qué filas cambiaron desde la última vez? |
| Dónde vive el historial | En los archivos y el log de Delta | En las filas de la propia tabla | En registros de cambios aparte |
| Duración | Corta, limitada por la retención | Permanente | Limitada por la retención |
| Esfuerzo | Ninguno, viene integrado | Hay que diseñarla o usar AUTO CDC | Activar una propiedad |
| Uso típico | Deshacer errores, auditoría reciente | Análisis histórico a largo plazo | Propagar cambios a otras capas |

En una SCD tipo 2, en vez de sobrescribir, se cierra la fila vieja y se inserta una nueva.

| id | ciudad | inicio | fin | vigente |
| --- | --- | --- | --- | --- |
| 7 | Madrid | 2024-01-01 | 2026-03-15 | false |
| 7 | Bilbao | 2026-03-15 | null | true |

No se excluyen, se complementan. Puedes combinar una SCD tipo 2 para el historial persistente a largo plazo con time travel para consultar versiones recientes de la tabla o deshacer errores. El change data feed se explica en detalle en [Change data feed en Delta Lake](change-data-feed-en-delta-lake.md).

## Time travel en Microsoft Fabric

- **Lakehouse (Spark).** Funciona igual que en Databricks, porque las tablas son Delta. VERSION AS OF, TIMESTAMP AS OF, DESCRIBE HISTORY y RESTORE se usan desde un notebook.
- **Warehouse (T-SQL).** Tiene su propio time travel con la cláusula OPTION (FOR TIMESTAMP AS OF '...') al final de la consulta, con una retención limitada (en torno a 30 días). También tiene puntos de restauración para devolver todo el warehouse a un momento anterior.
- **Retención y VACUUM.** Limitan igual el time travel en el lakehouse. Como el VACUUM lo lanzas tú, conviene no usar retenciones muy cortas.

```sql
-- Time travel en un Warehouse de Fabric
SELECT * FROM dbo.clientes
OPTION (FOR TIMESTAMP AS OF '2026-10-01T08:00:00');
```

## Errores comunes

- **Usarlo como archivo histórico.** Time travel está pensado para días o semanas, no para años. Si necesitas el historial de forma permanente, guárdalo en los datos con una SCD tipo 2.
- **Contar con más días de los que permite la retención.** Si time travel deja de funcionar para versiones de hace unos días, revisa delta.deletedFileRetentionDuration y cuándo se ejecutó VACUUM.
- **Confundirlo con los checkpoints de streaming.** Un [checkpoint](checkpoints-en-structured-streaming.md) guarda el progreso de una consulta de streaming, no versiones de la tabla, así que no sirve para volver a un estado anterior de los datos.
- **Hacer copias manuales de la tabla para poder volver atrás.** Dentro del plazo de retención, time travel ya conserva las versiones. Una copia instantánea manual exige más esfuerzo y ocupa más almacenamiento.

## Qué usar en cada caso

| Necesidad | Qué usar |
| --- | --- |
| Consultar una versión anterior de una tabla Delta | VERSION AS OF o TIMESTAMP AS OF |
| Deshacer un borrado o una actualización errónea | RESTORE TABLE |
| Ver qué operaciones se hicieron, cuándo y quién | DESCRIBE HISTORY |
| Mantener el historial a largo plazo | SCD tipo 2 |
| Saber qué filas cambiaron para propagarlas | Change data feed |
