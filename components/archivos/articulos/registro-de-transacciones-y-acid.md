---
titulo: Registro de transacciones de Delta y ACID
bajada: Qué garantizan las cuatro letras de ACID y cómo las cumple Delta con su registro de transacciones.
tema: Delta Lake
fecha: 2026-10-07
imagen: imagenes/registro-de-transacciones-y-acid.jpg
---

## Qué significa ACID

ACID son cuatro garantías que una base de datos ofrece sobre sus operaciones (transacciones). Que un sistema cumpla ACID significa que, pase lo que pase (fallos, procesos en paralelo, cortes), los datos quedan siempre en un estado correcto.

Se entiende bien con el ejemplo clásico de una transferencia bancaria de 100 € de la cuenta A a la B.

| Letra | Propiedad | Qué garantiza | En la transferencia |
| --- | --- | --- | --- |
| A | Atomicidad | Todo o nada. La operación se aplica completa o no se aplica | No puede quitarse el dinero de A sin añadirlo a B |
| C | Consistencia | Los datos siempre cumplen las reglas definidas | El saldo no puede quedar en un estado no permitido, como un tipo de dato incorrecto |
| I | Aislamiento | Las operaciones simultáneas no se pisan | Si alguien consulta mientras tanto, ve el saldo de antes o el de después, nunca uno a medias |
| D | Durabilidad | Lo confirmado no se pierde | Si el sistema se cae justo después, la transferencia sigue hecha |

En datos, el equivalente sería una carga de un millón de filas. Con ACID, o se cargan todas o ninguna, nadie ve la tabla a medio cargar y, una vez terminada, queda guardada aunque falle el clúster.

## Por qué un data lake sin Delta no es ACID

Un data lake tradicional es una carpeta con archivos Parquet o CSV. Una "tabla" es simplemente todo lo que hay en esa carpeta, y eso provoca los problemas que recoge esta tabla.

| Situación | Sin Delta (solo Parquet) | Con Delta |
| --- | --- | --- |
| Una carga falla a mitad | Quedan archivos sueltos y la tabla tiene datos a medias | La carga no existe hasta que se confirma, así que la tabla no cambia |
| Alguien lee mientras se escribe | Puede ver parte de los archivos nuevos | Ve la versión anterior completa |
| Dos procesos escriben a la vez | Se pisan o se mezclan | Uno confirma y el otro detecta el conflicto |
| Se quiere actualizar o borrar una fila | Hay que reescribir archivos a mano | UPDATE, DELETE y MERGE nativos |
| Se escriben datos con columnas erróneas | Se aceptan sin más | Se rechazan (schema enforcement) |

La diferencia no está en los archivos de datos (Delta sigue usando Parquet), sino en una pieza adicional, el **registro de transacciones**, que decide qué archivos forman parte de la tabla en cada momento.

## Qué es el registro de transacciones

El registro de transacciones (transaction log o Delta log) es la carpeta \_delta\_log que hay dentro de cada tabla Delta. Es la única fuente de verdad sobre qué contiene la tabla. Un archivo Parquet que no esté registrado en el log no forma parte de la tabla, aunque esté en la carpeta.

Así se ve una tabla Delta por dentro.

```text
ventas/
├── part-0000-a1.parquet
├── part-0001-b2.parquet
├── part-0002-c3.parquet
└── _delta_log/
    ├── 00000000000000000000.json      <- versión 0
    ├── 00000000000000000001.json      <- versión 1
    ├── ...
    ├── 00000000000000000010.checkpoint.parquet
    └── _last_checkpoint
```

Esto es lo que guarda cada archivo de \_delta\_log.

- **Un JSON por versión (commit).** Cada operación confirmada crea uno, numerado en orden. Dentro van acciones como estas.
  - **add**. Archivo que entra en la tabla, con sus estadísticas (mínimos, máximos, recuentos).
  - **remove**. Archivo que deja de formar parte de la tabla. No se borra físicamente. De eso se encarga VACUUM.
  - **metaData**. Esquema, columnas de partición y propiedades de la tabla.
  - **protocol**. Versión mínima necesaria para leer o escribir la tabla.
  - **commitInfo**. Qué operación fue, cuándo y quién la hizo.
- **Checkpoints en Parquet.** Cada cierto número de versiones (normalmente 10, o según el tamaño), Delta resume el estado completo de la tabla en un archivo Parquet, para no tener que leer cientos de JSON.
- **\_last\_checkpoint.** Indica cuál es el último checkpoint.

Para leer la tabla, el motor lee el último checkpoint, aplica los JSON posteriores y obtiene la lista exacta de archivos activos. Solo lee esos.

El log funciona como el libro de contabilidad de una empresa. Los archivos Parquet son los documentos guardados en el archivo, pero lo que vale es lo que está anotado en el libro. Un documento sin asiento no existe para la contabilidad, y cada cierto tiempo se hace un balance (checkpoint) para no tener que repasar todos los asientos desde el principio.

## Cómo garantiza cada propiedad

Cada letra de ACID se apoya en un mecanismo distinto de Delta.

### Atomicidad, un único archivo por commit

Una escritura primero crea los archivos Parquet nuevos y, al final, escribe un solo JSON con la versión siguiente. Hasta que ese JSON existe, los archivos nuevos no forman parte de la tabla. Si el proceso falla antes, quedan archivos huérfanos que nadie lee (y que VACUUM limpiará), pero la tabla no ha cambiado. Todo o nada.

La atomicidad no depende del tipo de operación, sino de que pase por el log. Un INSERT OVERWRITE, por ejemplo, es atómico porque se confirma con un commit, igual que cualquier otra escritura de Delta. Por la misma razón, añadir archivos Parquet directamente a la carpeta, sin pasar por el log, se salta este mecanismo y rompe las garantías.

### Consistencia, el log guarda las reglas

El esquema y las restricciones están en el log, y cada escritura se valida contra ellos antes de confirmarse. Sobre esa base funcionan tres mecanismos.

- Schema enforcement, que rechaza columnas que no existen o tipos incompatibles.
- Restricciones CHECK y NOT NULL.
- Las [expectations](expectations-calidad-de-datos.md) de las canalizaciones declarativas, que se apoyan en esto.

### Aislamiento, concurrencia optimista

Delta trata de forma distinta a quien lee y a quien escribe.

- **Lectores.** Cada consulta lee una versión concreta (una instantánea). Aunque alguien escriba mientras tanto, el lector sigue viendo su versión completa. Lectores y escritores nunca se bloquean.
- **Escritores.** Cada uno trabaja sin bloquear a los demás. Al confirmar, intenta crear el JSON de la versión siguiente. Si otro proceso ya la ha creado, Delta comprueba si los cambios chocan. Si no chocan (por ejemplo, dos inserciones), reintenta con la versión siguiente. Si chocan (los dos modificaron los mismos archivos), una operación falla con un error de concurrencia.

### Durabilidad, todo en almacenamiento persistente

Tanto los datos como el log están en ADLS u OneLake, no en memoria del clúster. Una vez escrito el JSON del commit, la operación sobrevive a cualquier fallo del cómputo.

### Las cuatro de un vistazo

| Propiedad | Mecanismo en Delta |
| --- | --- |
| Atomicidad | Un único archivo JSON por commit |
| Consistencia | Esquema y restricciones guardados en el log |
| Aislamiento | Instantáneas para lectores, concurrencia optimista para escritores |
| Durabilidad | Datos y log en almacenamiento persistente |

## Qué más se apoya en el log

El log no solo sostiene ACID. Muchas funcionalidades de Delta leen de él lo que necesitan.

| Funcionalidad | Qué usa del log |
| --- | --- |
| [Time travel](time-travel-en-delta-lake.md) | La lista de archivos de cada versión |
| DESCRIBE HISTORY | El commitInfo de cada versión |
| [Data skipping](data-skipping-en-databricks-y-fabric.md) | Las estadísticas guardadas en cada acción add |
| Streaming desde una tabla Delta | Las versiones nuevas que van apareciendo |
| [Change data feed](change-data-feed-en-delta-lake.md) | Los cambios asociados a cada versión |
| [Deletion vectors](deletion-vectors-en-delta-lake.md) | Las marcas de filas borradas, referenciadas desde el log |
| [VACUUM](optimize-vacuum-y-optimizaciones-delta.md) | Los archivos que aparecen como remove y superan la retención |

## Cómo inspeccionar el log

La forma más directa de consultarlo son dos comandos SQL.

```sql
-- Historial de operaciones: versión, fecha, usuario y métricas
DESCRIBE HISTORY ventas;

-- Estado actual: ubicación, número de archivos, tamaño y protocolo
DESCRIBE DETAIL ventas;
```

Si quieres ver qué escribe exactamente cada operación, puedes leer el JSON de un commit como cualquier otro archivo.

```python
# Leer directamente el JSON de un commit para ver sus acciones
commit = spark.read.json("Tables/ventas/_delta_log/00000000000000000001.json")
commit.printSchema()
commit.select("add.path", "remove.path", "commitInfo.operation").show(truncate=False)
```

Leer el log a mano es útil para entender qué hace cada operación, pero en el día a día basta con DESCRIBE HISTORY y DESCRIBE DETAIL.

## El registro de transacciones en Fabric

En Fabric, todas las tablas de OneLake son Delta y tienen su \_delta\_log, tanto las del lakehouse (escritas por Spark, Dataflows o pipelines) como las del Warehouse. Gracias a eso, Spark, el SQL analytics endpoint, Direct Lake y los accesos directos leen la misma tabla con las mismas garantías, sin copias. En el explorador del lakehouse, la vista de archivos de una tabla muestra la carpeta \_delta\_log.

Hay un matiz. El SQL analytics endpoint necesita unos segundos para sincronizar los metadatos tras un commit, así que puede ver la nueva versión con un pequeño retraso respecto a Spark.

## Buenas prácticas

- **Nunca tocar la carpeta de una tabla a mano.** Borrar, mover o añadir archivos Parquet sin pasar por Delta deja el log y los datos desincronizados, y la tabla puede quedar ilegible.
- **No borrar \_delta\_log.** Sin él, los archivos son solo Parquet sueltos y se pierde la tabla, el historial y las garantías.
- **Usar comandos de Delta para todo.** DELETE en lugar de borrar archivos, VACUUM en lugar de limpiar a mano, RESTORE en lugar de copiar versiones viejas.
- **Vigilar la retención del log** (logRetentionDuration) si dependes del historial para auditoría.
