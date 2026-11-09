---
titulo: Auto Loader en Databricks
bajada: Cómo cargar los archivos que van llegando a un almacenamiento sin leer dos veces el mismo ni romperse cuando cambia el esquema.
tema: Ingesta y streaming
fecha: 2026-10-06
imagen: imagenes/auto-loader-en-databricks.jpg
---

## Qué es y qué resuelve

Auto Loader es la forma de Databricks de ingerir archivos que van llegando a un almacenamiento (ADLS Gen2, S3, volúmenes de Unity Catalog) de manera incremental. Detecta los archivos nuevos, los procesa una sola vez y los escribe en una tabla Delta. Se usa con el formato cloudFiles dentro de Structured Streaming.

**El problema que resuelve.** Sin Auto Loader, en cada carga tienes que averiguar qué archivos son nuevos, llevar un registro de los ya leídos, gestionar cambios de esquema y evitar duplicados. Es código propio que hay que mantener.

**Analogía.** Es como un buzón con portero. Cada vez que llega una carta nueva, el portero la recoge, la registra en su libreta (el checkpoint) y la entrega. Nunca entrega dos veces la misma carta, y si llega una carta con un formato distinto, la acepta y lo anota.

Esto es lo que aporta.

- Detección automática de archivos nuevos, incluso con millones de archivos.
- Exactly-once. Cada archivo se procesa una sola vez gracias al checkpoint.
- Inferencia y evolución del esquema.
- Lee JSON, CSV, Parquet, Avro, ORC, XML, texto y binario.
- Funciona en tiempo casi real o como lote programado, con el mismo código.

## Cómo detecta archivos nuevos

Auto Loader tiene dos modos para enterarse de que ha llegado un archivo.

|  | Listado de directorios | Notificación de archivos |
| --- | --- | --- |
| Cómo funciona | Lista la carpeta en cada lote y compara con lo ya procesado | Se suscribe a eventos del almacenamiento (Event Grid y una cola) que avisan de cada archivo nuevo |
| Configuración | Ninguna, es el modo por defecto | cloudFiles.useNotifications = true y permisos para crear los recursos de eventos |
| Mejor para | Volúmenes pequeños o medianos | Carpetas con muchísimos archivos o mucho volumen |
| Coste | Crece con el número de archivos de la carpeta | Constante, no depende del tamaño de la carpeta |

En ambos casos, la lista de archivos ya procesados se guarda en el checkpoint (en una base de datos interna RocksDB), así que nunca se procesa dos veces el mismo archivo.

Databricks ha añadido también eventos de archivo gestionados a través de las external locations de Unity Catalog, que dan las ventajas de la notificación sin crear tú los recursos de eventos.

## Ejemplo básico

Este ejemplo ingiere CSV desde ADLS Gen2 a una tabla Delta administrada.

```python
# Lectura incremental de los CSV que vayan llegando
df = (spark.readStream
      .format("cloudFiles")
      .option("cloudFiles.format", "csv")
      .option("header", "true")
      .option("cloudFiles.schemaLocation", "/Volumes/main/ventas/checkpoints/pedidos_schema")
      .load("abfss://raw@cuenta.dfs.core.windows.net/pedidos/"))

# Escritura en la tabla Delta guardando el progreso
(df.writeStream
   .option("checkpointLocation", "/Volumes/main/ventas/checkpoints/pedidos")
   .toTable("main.ventas.pedidos_bronze"))
```

Estas son las opciones principales.

| Opción | Para qué sirve |
| --- | --- |
| cloudFiles.format | Formato de los archivos (csv, json, parquet...) |
| cloudFiles.schemaLocation | Dónde guardar el esquema inferido y su historial de cambios |
| checkpointLocation | Dónde guardar el progreso (en la escritura) |
| cloudFiles.schemaEvolutionMode | Qué hacer cuando aparecen columnas nuevas |
| cloudFiles.useNotifications | Activar el modo de notificación de archivos |
| cloudFiles.maxFilesPerTrigger | Límite de archivos por lote, para controlar la carga |
| pathGlobFilter | Filtrar archivos por patrón, por ejemplo \*.csv |

## Inferencia y evolución del esquema

**Inferencia.** La primera vez, Auto Loader lee una muestra de archivos, deduce las columnas y guarda el esquema en schemaLocation. En CSV y JSON, por defecto, infiere todas las columnas como texto (string) para no fallar. Con cloudFiles.inferColumnTypes = true intenta detectar números, fechas, etc.

**Evolución (schema drift).** Cuando llega un archivo con columnas nuevas, el comportamiento depende de cloudFiles.schemaEvolutionMode.

| Modo | Qué hace |
| --- | --- |
| addNewColumns (por defecto) | Detiene el stream, añade las columnas nuevas al esquema y al reiniciar continúa con ellas |
| rescue | No cambia el esquema; los datos que no encajan van a la columna \_rescued\_data |
| failOnNewColumns | Falla y no continúa hasta que actualices el esquema a mano |
| none | Ignora las columnas nuevas |

**La columna \_rescued\_data** recoge en formato JSON los valores que no encajan en el esquema (columnas desconocidas, tipos incorrectos). Así no se pierde información aunque los archivos cambien.

**Consejo práctico.** Con addNewColumns, el stream se detiene al detectar cambios. En un job, configura reintentos automáticos para que se reinicie solo y siga con el esquema nuevo.

**Tipos fijados a mano (schema hints).** Con cloudFiles.schemaHints puedes fijar el tipo de algunas columnas y dejar que infiera el resto, por ejemplo "fecha DATE, importe DECIMAL(10,2)".

## Modos de ejecución

El mismo código sirve para tiempo casi real o para lotes. Solo cambia el trigger.

| Trigger | Comportamiento | Cuándo usarlo |
| --- | --- | --- |
| Sin trigger o processingTime='1 minute' | Se queda escuchando y procesa cada poco tiempo | Casi tiempo real (NRT) |
| availableNow=True | Procesa todo lo pendiente y se detiene | Job programado cada hora o cada día; ahorra coste |

```python
# Como lote incremental: procesa lo nuevo y termina
(df.writeStream
   .option("checkpointLocation", "/Volumes/main/ventas/checkpoints/pedidos")
   .trigger(availableNow=True)
   .toTable("main.ventas.pedidos_bronze"))
```

## En canalizaciones declarativas (Lakeflow SDP)

Es la forma más sencilla, porque Databricks gestiona checkpoints, esquema y reintentos.

```sql
-- Tabla de streaming que ingiere los CSV con Auto Loader
CREATE OR REFRESH STREAMING TABLE pedidos_bronze
AS SELECT *
FROM STREAM read_files(
    'abfss://raw@cuenta.dfs.core.windows.net/pedidos/',
    format => 'csv',
    header => true
);
```

read\_files con STREAM usa Auto Loader por debajo. También existe COPY INTO, que es incremental pero por lotes y pensado para volúmenes moderados.

## Frente a otras formas de ingerir

Auto Loader no es la única manera de llevar archivos a una tabla en Databricks. Esta tabla resume en qué se diferencia de las alternativas más habituales.

| Alternativa | Incremental | Latencia | Esquema cambiante | Esfuerzo |
| --- | --- | --- | --- | --- |
| Auto Loader | Sí, automático | Casi tiempo real o lote | Sí | Mínimo |
| COPY INTO | Sí (no repite archivos) | Lote | Limitado | Bajo |
| spark.read programado | No, lo controlas tú | Lote | No | Alto |
| Tabla externa sobre los archivos | No ingiere | Consulta directa | No | Bajo, pero sin ventajas de Delta |
| Azure Data Factory | Según diseño | Lote | Limitado | Medio, otro servicio |

COPY INTO se acerca a Auto Loader porque tampoco repite archivos, pero trabaja solo por lotes y su manejo de esquemas cambiantes es más limitado. Un spark.read programado te obliga a llevar tú el control de lo ya leído. Una tabla externa no copia nada, solo consulta los archivos donde están, así que pierdes lo que aporta Delta.

## Y en Microsoft Fabric

Auto Loader no existe en Fabric. Según de dónde vengan los datos, tienes estas alternativas.

- **Structured Streaming con format("json") o format("csv")** sobre Files del lakehouse, con checkpoint. Es incremental, pero el esquema hay que indicarlo tú y no hay evolución automática.
- **Pipelines de Data Factory** con copia incremental o filtrado por fecha de modificación.
- **Eventstream** para datos en tiempo real desde Event Hubs u otras fuentes.
- **Dataflow Gen2** con actualización incremental, para escenarios sin código.

## Cuándo usarlo

- Si te llegan archivos a un almacenamiento y quieres cargarlos de forma incremental o casi en tiempo real con poco código, Auto Loader es la herramienta pensada para eso.
- Si el esquema de los archivos cambia con el tiempo (schema drift), apóyate en la evolución de esquema y en la columna \_rescued\_data.
- Si la carpeta tiene millones de archivos o recibe mucho volumen, usa el modo de **notificación de archivos** en vez del listado de directorios.
- Si basta con una ingesta programada que solo procese lo nuevo, usa Auto Loader con el **trigger availableNow**. Procesa lo pendiente y se detiene, así que ahorras coste.
- Si los datos no llegan como archivos sino como eventos desde Event Hubs o Kafka, Auto Loader no aplica. Ahí lo que corresponde es Structured Streaming con el conector de Event Hubs o de Kafka.

## Errores comunes

- **Quedarse con todo como texto.** En CSV y JSON, si no activas cloudFiles.inferColumnTypes, todas las columnas llegan como string. Actívalo o fija los tipos que importan con cloudFiles.schemaHints.
- **No configurar reintentos con addNewColumns.** El stream se detiene cada vez que aparece una columna nueva y, sin reintentos en el job, se queda parado hasta que alguien lo reinicie.
- **Usar el listado de directorios en carpetas enormes.** Su coste crece con el número de archivos de la carpeta. A partir de cierto volumen conviene el modo de notificación.
- **Tocar el checkpoint.** Es la libreta del portero, donde está la lista de archivos ya procesados. Si lo borras o cambias la ruta de checkpointLocation, Auto Loader pierde esa memoria y no sabe qué archivos ya cargó.
