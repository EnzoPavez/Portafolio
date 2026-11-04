---
titulo: Time travel en Delta Lake
bajada: Cómo consultar una tabla Delta tal como estaba en una versión o fecha anterior, y hasta dónde se puede volver.
tema: Delta Lake
fecha: 2026-10-06
---

## Qué es y cómo funciona

Time travel es la capacidad de Delta Lake de consultar una tabla tal como estaba en una versión o momento anterior. Viene integrado en todas las tablas Delta: no hay que activarlo ni construir nada.

**Cómo funciona por dentro:** cada escritura (INSERT, UPDATE, DELETE, MERGE, OPTIMIZE...) crea una nueva versión de la tabla y queda anotada en el registro de transacciones (\_delta\_log). Cada versión sabe qué archivos Parquet la forman. Como los archivos no se modifican, sino que se añaden otros nuevos, los archivos de versiones anteriores siguen existiendo hasta que VACUUM los borra.

| Versión | Operación | Archivos activos |
| --- | --- | --- |
| 0 | CREATE + INSERT | A |
| 1 | INSERT | A, B |
| 2 | UPDATE (reescribe A) | B, C |

Para leer la versión 1, Delta lee los archivos A y B, aunque A ya no forme parte de la versión actual.

**Analogía:** es el historial de versiones de un documento de Word en OneDrive. Puedes abrir cómo estaba el documento ayer sin perder la versión actual, pero solo mientras esas versiones antiguas se conserven.

## Cómo consultar versiones anteriores

Primero, ver qué versiones existen:

```sql
-- Lista de versiones con fecha, operación y usuario
DESCRIBE HISTORY clientes;
```

Después, consultar la que interese, por número de versión o por fecha:

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

Ejemplo de análisis: comparar la versión actual con la de ayer para ver qué clientes son nuevos.

```sql
SELECT id FROM clientes
EXCEPT
SELECT id FROM clientes TIMESTAMP AS OF date_sub(current_date(), 1);
```

## Restaurar y otros usos

**Deshacer un error:** si un proceso borra o corrompe datos, se puede devolver la tabla a una versión anterior.

```sql
-- Vuelve la tabla al estado de la versión 5
RESTORE TABLE clientes TO VERSION AS OF 5;

-- O al de una fecha concreta
RESTORE TABLE clientes TO TIMESTAMP AS OF '2026-10-01 08:00:00';
```

RESTORE no borra el historial: crea una versión nueva cuyo contenido es igual al de la versión elegida. Si te equivocas, puedes volver a restaurar.

**Otros usos habituales:**

- **Auditoría:** ver cómo estaban los datos en una fecha concreta.
- **Reproducibilidad:** repetir un análisis o entrenar un modelo con exactamente los mismos datos que se usaron entonces.
- **Recuperar filas concretas:** insertar de nuevo registros borrados por error leyendo una versión antigua.

```sql
-- Recuperar un cliente borrado por error
INSERT INTO clientes
SELECT * FROM clientes VERSION AS OF 5 WHERE id = 42;
```

## Límites: retención y VACUUM

Time travel solo llega hasta donde se conservan dos cosas a la vez:

| Qué se necesita | Propiedad que lo controla | Por defecto |
| --- | --- | --- |
| El historial de versiones (el log) | delta.logRetentionDuration | 30 días |
| Los archivos de datos antiguos | delta.deletedFileRetentionDuration | 7 días |

Con los valores por defecto, en la práctica solo puedes viajar unos 7 días atrás: después, VACUUM borra los archivos antiguos y, aunque el log recuerde la versión, sus datos ya no existen.

Se puede ampliar subiendo ambas propiedades (por ejemplo, a 90 días), pero tiene un coste: los archivos antiguos siguen ocupando almacenamiento. Por eso la documentación de Databricks desaconseja usar el historial de la tabla como archivo a largo plazo.

**Regla:** time travel sirve para corto plazo (auditoría reciente, deshacer errores, reproducibilidad). Para historial de años, el historial tiene que estar en los propios datos, por ejemplo con una SCD de tipo 2.

## Time travel frente a SCD tipo 2 y CDF

Los tres tienen que ver con el historial, pero responden a preguntas distintas:

|  | Time travel | SCD tipo 2 | Change data feed |
| --- | --- | --- | --- |
| Pregunta que responde | ¿Cómo estaba la tabla entera en un momento? | ¿Qué valores tuvo cada registro y cuándo? | ¿Qué filas cambiaron desde la última vez? |
| Dónde vive el historial | En los archivos y el log de Delta | En las filas de la propia tabla | En registros de cambios aparte |
| Duración | Corta, limitada por la retención | Permanente | Limitada por la retención |
| Esfuerzo | Ninguno, viene integrado | Hay que diseñarla o usar AUTO CDC | Activar una propiedad |
| Uso típico | Deshacer errores, auditoría reciente | Análisis histórico a largo plazo | Propagar cambios a otras capas |

**Cómo es una SCD tipo 2:** en vez de sobrescribir, se cierra la fila vieja y se inserta una nueva.

| id | ciudad | inicio | fin | vigente |
| --- | --- | --- | --- | --- |
| 7 | Madrid | 2024-01-01 | 2026-03-15 | false |
| 7 | Bilbao | 2026-03-15 | null | true |

Por eso, en la pregunta 54, la respuesta combina SCD tipo 2 (historial persistente a largo plazo) y time travel (consultar versiones anteriores de la tabla): se complementan.

## Fabric y examen

**En Fabric:**

- **Lakehouse (Spark):** funciona igual que en Databricks, porque las tablas son Delta. VERSION AS OF, TIMESTAMP AS OF, DESCRIBE HISTORY y RESTORE se usan desde un notebook.
- **Warehouse (T-SQL):** tiene su propio time travel con la cláusula OPTION (FOR TIMESTAMP AS OF '...') al final de la consulta, con una retención limitada (en torno a 30 días). También tiene puntos de restauración para devolver todo el warehouse a un momento anterior.
- **La retención y VACUUM** limitan igual el time travel en el lakehouse; y como el VACUUM lo lanzas tú, conviene no usar retenciones muy cortas.

```sql
-- Time travel en un Warehouse de Fabric
SELECT * FROM dbo.clientes
OPTION (FOR TIMESTAMP AS OF '2026-10-01T08:00:00');
```

**Pistas para el examen:**

- **Consultar versiones anteriores de una tabla Delta:** time travel (VERSION AS OF o TIMESTAMP AS OF).
- **Deshacer un borrado o actualización errónea:** RESTORE TABLE.
- **Historial persistente a largo plazo:** SCD tipo 2, no time travel.
- **Ver qué operaciones se hicieron y quién:** DESCRIBE HISTORY.
- **Time travel deja de funcionar tras unos días:** revisar deletedFileRetentionDuration y VACUUM.
- **Distractores habituales:** checkpoints (progreso de streaming, no versiones) y copias instantáneas manuales (más esfuerzo y almacenamiento).
