---
titulo: Ingesta incremental y evolución del esquema
bajada: Cómo cargar solo los archivos nuevos de una carpeta y aceptar los campos que la fuente va sumando sin que la carga se rompa.
tema: Ingesta y streaming
fecha: 2026-10-07
imagen: imagenes/ingesta-incremental-y-evolucion-del-esquema.jpg
---

## El problema

Una fuente envía archivos JSON a una carpeta de forma continua y hay que cargarlos en una tabla Delta. La carga tiene que cumplir dos cosas.

- **Ingesta incremental.** Procesar solo los archivos nuevos en cada ejecución, sin releer los anteriores ni duplicar datos, aunque haya millones.
- **Esquema cambiante (schema drift).** La fuente añade campos con el tiempo (por ejemplo, un sensor nuevo que envía "humedad") y la carga no debe romperse ni perder esos datos.

Si no preparas nada, pasa esto.

| Situación | Resultado |
| --- | --- |
| Se lee la carpeta entera en cada carga | Cada vez más lento y con duplicados si no se controla qué se leyó |
| Llega un campo nuevo y la tabla tiene esquema fijo | El campo se ignora y se pierde, o la escritura falla por esquema incompatible |
| Un campo cambia de tipo (número que llega como texto) | Valores nulos o errores al escribir |

Para resolverlo hacen falta dos piezas.

- **Para la ingesta incremental**, algo que recuerde qué archivos se procesaron. En Databricks es Auto Loader y en Fabric, Structured Streaming con checkpoint.
- **Para el esquema cambiante**, la evolución del esquema de Delta, que permite añadir columnas a la tabla al escribir, y un sitio donde guardar lo que no encaje.

## Evolución del esquema en Delta

Por defecto, Delta aplica **schema enforcement**. Si intentas escribir datos con columnas que la tabla no tiene, la escritura falla. Es una protección para no meter basura sin querer. La evolución del esquema consiste en permitir, de forma explícita, que la tabla cambie.

Estos son los cambios que admite y cómo se hace cada uno.

| Cambio | ¿Se puede evolucionar? | Cómo |
| --- | --- | --- |
| Añadir columnas nuevas | Sí | mergeSchema |
| Ampliar un tipo (INT a BIGINT, FLOAT a DOUBLE) | Sí, en versiones recientes | Type widening |
| Renombrar o borrar columnas | Sí, sin reescribir | Column mapping |
| Cambiar a un tipo incompatible (texto a número) | No | Reescribir la tabla con overwriteSchema |

**Añadir columnas al escribir.** Con la opción mergeSchema, las columnas que traiga el DataFrame y que la tabla no tenga se añaden a la tabla.

```python
# Si df trae columnas que la tabla no tiene, se añaden
df.write.format("delta").mode("append").option("mergeSchema", "true").saveAsTable("eventos")
```

**Añadir columnas en un MERGE.** Aquí mergeSchema no aplica. Se usa una configuración de la sesión o, en Databricks, la cláusula específica.

```python
# Permite que un MERGE añada columnas nuevas del origen
spark.conf.set("spark.databricks.delta.schema.autoMerge.enabled", "true")
```

```sql
-- En Databricks también existe la forma explícita
MERGE WITH SCHEMA EVOLUTION INTO eventos AS d
USING nuevos AS o ON d.id = o.id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;
```

**Ampliar tipos sin reescribir.** Con type widening puedes pasar una columna a un tipo más amplio sin reescribir la tabla.

```sql
ALTER TABLE eventos SET TBLPROPERTIES ('delta.enableTypeWidening' = true);
ALTER TABLE eventos ALTER COLUMN contador TYPE BIGINT;
```

**Reescribir el esquema por completo.** Para los cambios incompatibles queda overwriteSchema, que reescribe toda la tabla.

```python
df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("eventos")
```

Type widening y column mapping suben la versión de protocolo de la tabla, así que conviene comprobar que todos los lectores la soportan antes de activarlos.

## Auto Loader en Databricks

En Databricks, Auto Loader resuelve las dos piezas a la vez. El detalle está en el [artículo de Auto Loader](auto-loader-en-databricks.md), y este es el ejemplo aplicado al caso de los JSON.

```python
df = (spark.readStream
      .format("cloudFiles")
      .option("cloudFiles.format", "json")
      .option("cloudFiles.schemaLocation", "/Volumes/main/iot/checkpoints/eventos_schema")
      .option("cloudFiles.schemaEvolutionMode", "addNewColumns")
      .load("abfss://raw@cuenta.dfs.core.windows.net/eventos/"))

(df.writeStream
   .option("checkpointLocation", "/Volumes/main/iot/checkpoints/eventos")
   .option("mergeSchema", "true")
   .trigger(availableNow=True)
   .toTable("main.iot.eventos_bronze"))
```

- **Ingesta incremental.** El checkpoint recuerda qué archivos se procesaron.
- **Esquema.** Auto Loader infiere el esquema y lo guarda en schemaLocation. Al detectar columnas nuevas se detiene, las añade y continúa al reiniciarse (si el job tiene reintentos, esto es automático).
- **Lo que no encaja.** Va a la columna \_rescued\_data, sin perder nada.

Fabric no trae esto de serie. Las secciones siguientes muestran cómo conseguir lo mismo.

## Fabric, bronze crudo y esquema en silver

Es el patrón más robusto en Fabric. Consiste en separar "traer los datos" de "interpretarlos".

- **Bronze.** Guarda cada registro JSON tal cual, como texto, junto con el archivo de origen y la fecha de carga. Nunca falla por el esquema, porque no lo interpreta.
- **Silver.** Convierte el texto en columnas, deja que la tabla añada las columnas nuevas y aparta lo que no se puede leer.

**Paso 1. Bronze incremental con streaming y checkpoint**

```python
from pyspark.sql import functions as F

# Cada línea del JSON se guarda como texto, con su archivo de origen
crudo = (spark.readStream
         .format("text")
         .load("Files/landing/eventos/")
         .select(
             F.col("value").alias("json_crudo"),
             F.col("_metadata.file_path").alias("archivo"),
             F.current_timestamp().alias("fecha_carga")))

(crudo.writeStream
   .option("checkpointLocation", "Files/checkpoints/eventos_bronze")
   .trigger(availableNow=True)
   .toTable("eventos_bronze"))
```

El checkpoint garantiza que cada archivo se lee una sola vez, igual que con Auto Loader. Si los JSON vienen en varias líneas por registro (no uno por línea), usa format("json") con la opción multiLine y un esquema de una sola columna de texto, o pide a la fuente formato JSON Lines.

**Paso 2. Silver con el esquema inferido en cada lote**

```python
def cargar_silver(lote, batch_id):
    # Se infiere el esquema de los JSON de este lote, incluidos campos nuevos
    jsons = lote.select("json_crudo").rdd.map(lambda r: r.json_crudo)
    datos = spark.read.option("columnNameOfCorruptRecord", "_registro_corrupto").json(jsons)

    # Los registros ilegibles se apartan para revisarlos
    if "_registro_corrupto" in datos.columns:
        datos.where("_registro_corrupto IS NOT NULL").write.mode("append").saveAsTable("eventos_cuarentena")
        datos = datos.where("_registro_corrupto IS NULL").drop("_registro_corrupto")

    # Las columnas nuevas se añaden a la tabla automáticamente
    datos.write.mode("append").option("mergeSchema", "true").saveAsTable("eventos_silver")

(spark.readStream.table("eventos_bronze")
   .writeStream
   .foreachBatch(cargar_silver)
   .option("checkpointLocation", "Files/checkpoints/eventos_silver")
   .trigger(availableNow=True)
   .start())
```

Con los dos pasos, cada necesidad queda cubierta.

| Necesidad | Cómo se resuelve |
| --- | --- |
| Solo archivos nuevos | Checkpoint en bronze |
| Campos nuevos | Inferencia por lote + mergeSchema en silver |
| Registros ilegibles | Tabla de cuarentena, sin parar la carga |
| Reprocesar si cambias la lógica | El JSON original sigue en bronze |

Hay un matiz. Si un campo cambia de tipo entre lotes (por ejemplo, número en uno y texto en otro), mergeSchema fallará. Para esos campos conviene fijar el tipo con un esquema parcial o convertirlos explícitamente antes de escribir.

## Fabric, alternativas más simples

**Streaming directo del JSON.** Si el esquema cambia poco, puedes leer el JSON directamente, sin la capa de texto crudo. Structured Streaming exige un esquema para leer archivos y hay dos formas de dárselo.

```python
# Opción A: esquema explícito (los campos que no estén en él se ignoran)
eventos = spark.readStream.schema(esquema_eventos).json("Files/landing/eventos/")

# Opción B: que Spark lo infiera al arrancar la consulta
spark.conf.set("spark.sql.streaming.schemaInference", "true")
eventos = spark.readStream.json("Files/landing/eventos/")
```

Con el esquema explícito, los campos que no estén en él se ignoran. Con la inferencia, el esquema se fija al iniciar la consulta, de modo que los campos que aparezcan después solo se recogen en la siguiente ejecución. Con trigger availableNow en un job programado, cada ejecución vuelve a inferir, así que en la práctica se adapta, aunque con un desfase de una ejecución.

Frente al patrón de bronze crudo, es más rápido de montar pero menos robusto. La diferencia queda así.

| Aspecto | Bronze crudo y silver | Streaming directo |
| --- | --- | --- |
| Montaje | Dos flujos, cada uno con su checkpoint | Un solo flujo, más rápido de montar |
| Campos nuevos | Se infieren en cada lote de silver | Se ignoran con esquema explícito, o llegan en la siguiente ejecución con inferencia al arrancar |
| Registros ilegibles | Van a una tabla de cuarentena | El ejemplo no los aparta |
| Conviene si | El esquema cambia a menudo o necesitas reprocesar | El esquema cambia poco |

**Sin código.** Fabric también tiene caminos que no pasan por un notebook.

- **Pipelines de Data Factory.** La actividad de copia hacia una tabla del lakehouse puede mapear columnas automáticamente, y filtrar por fecha de modificación para hacer cargas incrementales.
- **Eventstream.** Sirve si los eventos llegan desde Event Hubs u otra fuente en tiempo real, en lugar de archivos.

## Detectar columnas nuevas en Fabric

Aunque la carga absorba sola las columnas nuevas, conviene saber cuándo cambia el esquema para revisar si afecta a capas posteriores o a informes. Este ejemplo compara el esquema de los últimos JSON con el de la tabla silver.

```python
# Compara el esquema de los últimos JSON con el de la tabla silver
nuevos = spark.read.json("Files/landing/eventos/").columns
actuales = spark.table("eventos_silver").columns

columnas_nuevas = sorted(set(nuevos) - set(actuales))
if columnas_nuevas:
    print(f"Columnas nuevas detectadas: {columnas_nuevas}")
    # aquí se puede guardar en una tabla de control o lanzar una alerta
```

En un caso real conviene limitar la lectura a los archivos recientes (por ejemplo, una subcarpeta por fecha) para no inferir sobre todo el histórico.

## Buenas prácticas

- **Evolución en bronze y silver, control en gold.** Las capas de entrada absorben los cambios. La capa gold, que alimenta informes, debe tener un esquema estable y cambiar solo de forma deliberada.
- **Guardar siempre el dato original.** En bronze, como texto o como columna de rescate, para poder reprocesar.
- **Fijar el tipo de los campos críticos.** Importes, fechas y claves con tipo explícito, y dejar que el resto se infiera.
- **Registrar los cambios de esquema.** Saber cuándo apareció una columna ahorra mucho tiempo al investigar problemas.
- **No borrar el checkpoint al cambiar la lógica de silver**, salvo que quieras reprocesar todo. En ese caso, vacía también la tabla destino.
- **Revisar la cuarentena** con regularidad. Si crece, la fuente está enviando algo que no se está interpretando bien.

## Errores comunes

- **Usar mergeSchema en un MERGE.** Ahí no aplica. Para que un MERGE añada columnas hace falta autoMerge o, en Databricks, MERGE WITH SCHEMA EVOLUTION.
- **Dar un esquema explícito al streaming y esperar campos nuevos.** Los campos que no estén en el esquema se ignoran sin avisar.
- **Contar con mergeSchema para un cambio de tipo.** mergeSchema añade columnas, pero si un campo llega como número en un lote y como texto en otro, la escritura falla. Fija el tipo o conviértelo antes de escribir. Si el cambio en la tabla es incompatible, hace falta overwriteSchema, que la reescribe entera.
- **Activar type widening o column mapping sin revisar los lectores.** Los dos suben la versión de protocolo de la tabla, y antes de activarlos hay que comprobar que todos los que leen la tabla la soportan.

## Databricks frente a Fabric

Las dos plataformas cubren las mismas necesidades con piezas distintas.

| Necesidad | Databricks | Fabric |
| --- | --- | --- |
| Detectar archivos nuevos | Auto Loader | Structured Streaming con checkpoint |
| Inferir el esquema | Auto Loader (schemaLocation) | Inferencia por lote en silver, o schemaInference al arrancar |
| Añadir columnas nuevas | schemaEvolutionMode + mergeSchema | mergeSchema |
| Guardar lo que no encaja | \_rescued\_data | JSON crudo en bronze y columna de registros corruptos |
| Fijar tipos de algunos campos | schemaHints | Esquema parcial o conversión explícita |
| Columnas nuevas en MERGE | MERGE WITH SCHEMA EVOLUTION o autoMerge | autoMerge |
| Ampliar tipos o renombrar columnas | Type widening y column mapping | Igual, según versión de runtime |

En resumen, en Databricks Auto Loader da todo hecho. En Fabric se consigue lo mismo combinando checkpoint, bronze crudo y mergeSchema, con algo más de código pero el mismo resultado.
