---
titulo: Registro de transacciones de Delta y ACID
bajada: Qué garantizan las cuatro letras de ACID y cómo las cumple Delta con su registro de transacciones.
tema: Delta Lake
fecha: 2026-10-07
---

## Qué significa ACID

ACID son cuatro garantías que una base de datos ofrece sobre sus operaciones (transacciones). "Garantizar el cumplimiento de ACID" significa que, pase lo que pase (fallos, procesos en paralelo, cortes), los datos quedan siempre en un estado correcto.

Con el ejemplo clásico de una transferencia bancaria de 100 € de la cuenta A a la B:

| Letra | Propiedad | Qué garantiza | En la transferencia |
| --- | --- | --- | --- |
| A | Atomicidad | Todo o nada: la operación se aplica completa o no se aplica | No puede quitarse el dinero de A sin añadirlo a B |
| C | Consistencia | Los datos siempre cumplen las reglas definidas | El saldo no puede quedar en un estado no permitido, como un tipo de dato incorrecto |
| I | Aislamiento | Las operaciones simultáneas no se pisan | Si alguien consulta mientras tanto, ve el saldo de antes o el de después, nunca uno a medias |
| D | Durabilidad | Lo confirmado no se pierde | Si el sistema se cae justo después, la transferencia sigue hecha |

En datos, el equivalente sería una carga de un millón de filas: con ACID, o se cargan todas o ninguna, nadie ve la tabla a medio cargar, y una vez terminada, queda guardada aunque falle el clúster.

## Por qué un data lake sin Delta no es ACID

Un data lake tradicional es una carpeta con archivos Parquet o CSV. Una "tabla" es simplemente todo lo que hay en esa carpeta. Eso provoca problemas:

| Situación | Sin Delta (solo Parquet) | Con Delta |
| --- | --- | --- |
| Una carga falla a mitad | Quedan archivos sueltos y la tabla tiene datos a medias | La carga no existe hasta que se confirma: la tabla no cambia |
| Alguien lee mientras se escribe | Puede ver parte de los archivos nuevos | Ve la versión anterior completa |
| Dos procesos escriben a la vez | Se pisan o se mezclan | Uno confirma y el otro detecta el conflicto |
| Se quiere actualizar o borrar una fila | Hay que reescribir archivos a mano | UPDATE, DELETE y MERGE nativos |
| Se escriben datos con columnas erróneas | Se aceptan sin más | Se rechazan (schema enforcement) |

La diferencia no está en los archivos de datos (Delta sigue usando Parquet), sino en una pieza adicional: el **registro de transacciones**, que decide qué archivos forman parte de la tabla en cada momento.

## Qué es el registro de transacciones

El registro de transacciones (transaction log o Delta log) es la carpeta \_delta\_log que hay dentro de cada tabla Delta. Es la única fuente de verdad sobre qué contiene la tabla: un archivo Parquet que no esté registrado en el log no forma parte de la tabla, aunque esté en la carpeta.

**Estructura de una tabla Delta:**

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

**Qué hay en cada archivo:**

- **Un JSON por versión (commit):** cada operación confirmada crea uno, numerado en orden. Contiene acciones como:
  - **add:** archivo que entra en la tabla, con sus estadísticas (mínimos, máximos, recuentos).
  - **remove:** archivo que deja de formar parte de la tabla (no se borra físicamente; eso lo hace VACUUM).
  - **metaData:** esquema, columnas de partición y propiedades de la tabla.
  - **protocol:** versión mínima necesaria para leer o escribir la tabla.
  - **commitInfo:** qué operación fue, cuándo y quién la hizo.
- **Checkpoints en Parquet:** cada cierto número de versiones (normalmente 10, o según el tamaño), Delta resume el estado completo de la tabla en un archivo Parquet, para no tener que leer cientos de JSON.
- **\_last\_checkpoint:** indica cuál es el último checkpoint.

**Cómo se lee la tabla:** el motor lee el último checkpoint, aplica los JSON posteriores y obtiene la lista exacta de archivos activos. Solo lee esos.

**Analogía:** es el libro de contabilidad de una empresa. Los archivos Parquet son los documentos guardados en el archivo, pero lo que vale es lo que está anotado en el libro. Un documento sin asiento no existe para la contabilidad, y cada cierto tiempo se hace un balance (checkpoint) para no tener que repasar todos los asientos desde el principio.

## Cómo garantiza cada propiedad

**Atomicidad: el commit es un único archivo.** Una escritura primero crea los archivos Parquet nuevos y, al final, escribe un solo JSON con la versión siguiente. Hasta que ese JSON existe, los archivos nuevos no forman parte de la tabla. Si el proceso falla antes, quedan archivos huérfanos que nadie lee (y que VACUUM limpiará), pero la tabla no ha cambiado. Todo o nada.

**Consistencia: el log guarda las reglas.** El esquema y las restricciones están en el log, y cada escritura se valida contra ellos antes de confirmarse:

- Schema enforcement: rechaza columnas que no existen o tipos incompatibles.
- Restricciones CHECK y NOT NULL.
- Las expectations de las canalizaciones declarativas se apoyan en esto.

**Aislamiento: control de concurrencia optimista.**

- **Lectores:** cada consulta lee una versión concreta (una instantánea). Aunque alguien escriba mientras tanto, el lector sigue viendo su versión completa. Lectores y escritores nunca se bloquean.
- **Escritores:** cada uno trabaja sin bloquear a los demás. Al confirmar, intenta crear el JSON de la versión siguiente; si otro proceso ya la ha creado, Delta comprueba si los cambios chocan. Si no chocan (por ejemplo, dos inserciones), reintenta con la versión siguiente. Si chocan (los dos modificaron los mismos archivos), una operación falla con un error de concurrencia.

**Durabilidad: todo está en almacenamiento persistente.** Tanto los datos como el log están en ADLS u OneLake, no en memoria del clúster. Una vez escrito el JSON del commit, la operación sobrevive a cualquier fallo del cómputo.

| Propiedad | Mecanismo en Delta |
| --- | --- |
| Atomicidad | Un único archivo JSON por commit |
| Consistencia | Esquema y restricciones guardados en el log |
| Aislamiento | Instantáneas para lectores, concurrencia optimista para escritores |
| Durabilidad | Datos y log en almacenamiento persistente |

## Qué más permite y cómo inspeccionarlo

Casi todo lo que hemos visto en otros documentos se apoya en el log:

| Funcionalidad | Qué usa del log |
| --- | --- |
| Time travel | La lista de archivos de cada versión |
| DESCRIBE HISTORY | El commitInfo de cada versión |
| Data skipping | Las estadísticas guardadas en cada acción add |
| Streaming desde una tabla Delta | Las versiones nuevas que van apareciendo |
| Change data feed | Los cambios asociados a cada versión |
| Deletion vectors | Las marcas de filas borradas, referenciadas desde el log |
| VACUUM | Los archivos que aparecen como remove y superan la retención |

**Cómo inspeccionarlo:**

```sql
-- Historial de operaciones: versión, fecha, usuario y métricas
DESCRIBE HISTORY ventas;

-- Estado actual: ubicación, número de archivos, tamaño y protocolo
DESCRIBE DETAIL ventas;
```

```python
# Leer directamente el JSON de un commit para ver sus acciones
commit = spark.read.json("Tables/ventas/_delta_log/00000000000000000001.json")
commit.printSchema()
commit.select("add.path", "remove.path", "commitInfo.operation").show(truncate=False)
```

Leer el log a mano es útil para entender qué hace cada operación, pero en el día a día basta con DESCRIBE HISTORY y DESCRIBE DETAIL.

## En Fabric y buenas prácticas

**En Fabric:** todas las tablas de OneLake son Delta y tienen su \_delta\_log, tanto las del lakehouse (escritas por Spark, Dataflows o pipelines) como las del Warehouse. Gracias a eso, Spark, el SQL analytics endpoint, Direct Lake y los accesos directos leen la misma tabla con las mismas garantías, sin copias. En el explorador del lakehouse, la vista de archivos de una tabla muestra la carpeta \_delta\_log.

Un matiz: el SQL analytics endpoint necesita unos segundos para sincronizar los metadatos tras un commit, así que puede ver la nueva versión con un pequeño retraso respecto a Spark.

**Buenas prácticas:**

- **Nunca tocar la carpeta de una tabla a mano:** borrar, mover o añadir archivos Parquet sin pasar por Delta deja el log y los datos desincronizados, y la tabla puede quedar ilegible.
- **No borrar \_delta\_log:** sin él, los archivos son solo Parquet sueltos y se pierde la tabla, el historial y las garantías.
- **Usar comandos de Delta para todo:** DELETE en lugar de borrar archivos, VACUUM en lugar de limpiar a mano, RESTORE en lugar de copiar versiones viejas.
- **Vigilar la retención del log** (logRetentionDuration) si dependes del historial para auditoría.

## Por qué no las otras opciones

- **INSERT OVERWRITE:** es una operación de escritura; es atómica gracias al log, pero no es lo que garantiza ACID.
- **Anexión directa de archivos:** añadir Parquet a la carpeta sin pasar por el log es precisamente lo que rompe las garantías.
- **Transformación de RDD de Spark:** es procesamiento en memoria; no tiene nada que ver con cómo se confirman los datos en almacenamiento.
