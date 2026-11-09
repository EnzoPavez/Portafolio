---
titulo: Checkpoints en Structured Streaming
bajada: La carpeta donde una consulta de streaming guarda su progreso, y cómo cuidarla para que un reinicio no duplique ni pierda datos.
tema: Ingesta y streaming
fecha: 2026-10-06
imagen: imagenes/checkpoints-en-structured-streaming.jpg
---

## Qué es y qué resuelve

Un checkpoint es una carpeta donde una consulta de Structured Streaming guarda su progreso, es decir, qué datos del origen ya leyó y qué lotes ya escribió en el destino. Gracias a él, si el clúster se reinicia o el trabajo falla, la consulta continúa exactamente donde lo dejó.

**El problema sin checkpoint.** Tras un reinicio, la consulta no sabe por dónde iba. O vuelve a empezar desde el principio y duplica datos, o empieza desde lo último y pierde lo que había en medio.

**Analogía.** Es el marcapáginas de un libro. Si cierras el libro de golpe, al abrirlo sigues leyendo en la página exacta, sin releer capítulos ni saltarte ninguno.

El checkpoint te da tres cosas.

- **Recuperación tras fallos.** La consulta se reanuda sin intervención manual.
- **Exactly-once.** Junto con un destino Delta, cada dato se escribe una sola vez, aunque haya reinicios.
- **Estado guardado.** En agregaciones, deduplicaciones o joins en streaming, conserva los resultados parciales para no recalcularlos.

## Qué guarda y cómo recupera

Dentro de la carpeta del checkpoint hay varias subcarpetas, cada una con una parte del progreso.

| Carpeta | Qué contiene |
| --- | --- |
| metadata | El identificador único de la consulta |
| offsets | Hasta dónde se va a leer en cada lote (por ejemplo, la posición en Event Hubs o los archivos de una carpeta) |
| commits | Qué lotes se completaron y escribieron con éxito |
| state | Los resultados parciales de agregaciones, deduplicaciones o joins (solo si la consulta tiene estado) |
| sources | Información del origen, por ejemplo qué archivos ya se han leído |

Cada lote sigue tres pasos.

1. Antes de leer, anota en offsets qué rango va a procesar (por ejemplo, el lote 42 cubre las posiciones 1000 a 1500).
2. Procesa los datos y los escribe en la tabla Delta.
3. Al terminar, anota en commits que el lote 42 está completo.

**Al reiniciar.** La consulta compara offsets y commits. Si el lote 42 aparece en offsets pero no en commits, lo repite con exactamente el mismo rango; Delta detecta que ese lote ya pudo escribirse y no lo duplica. Si está en commits, empieza directamente por el lote 43.

## En Databricks

El checkpoint se indica con la opción checkpointLocation al escribir. Con Unity Catalog, lo recomendable es guardarlo en un volumen.

```python
# Lectura de archivos JSON con Auto Loader
df = (spark.readStream
      .format("cloudFiles")
      .option("cloudFiles.format", "json")
      .option("cloudFiles.schemaLocation", "/Volumes/main/telemetria/checkpoints/eventos_schema")
      .load("abfss://raw@cuenta.dfs.core.windows.net/eventos/"))

# Escritura en una tabla Delta guardando el progreso
(df.writeStream
   .option("checkpointLocation", "/Volumes/main/telemetria/checkpoints/eventos")
   .trigger(availableNow=True)
   .toTable("main.telemetria.raw_events"))
```

- **checkpointLocation.** Guarda el progreso de la consulta.
- **cloudFiles.schemaLocation.** Es propio de Auto Loader y guarda el esquema inferido y su evolución. No sustituye al checkpoint.
- **trigger(availableNow=True).** Procesa lo pendiente y se detiene. Es muy útil en jobs programados, porque el checkpoint permite que cada ejecución siga donde acabó la anterior.

En las canalizaciones declarativas (Lakeflow SDP), Databricks gestiona los checkpoints automáticamente, así que no hay que indicarlos.

## En Fabric

Funciona igual, porque Fabric usa el mismo Spark Structured Streaming. Lo que cambia es el lugar donde se guarda, que es la sección Files de un lakehouse, dentro de OneLake.

```python
# Lectura en streaming de archivos JSON que van llegando a Files
df = (spark.readStream
      .format("json")
      .schema(esquema_eventos)
      .load("Files/landing/eventos/"))

# Escritura en una tabla del lakehouse guardando el progreso
(df.writeStream
   .format("delta")
   .option("checkpointLocation", "Files/checkpoints/eventos")
   .trigger(availableNow=True)
   .toTable("raw_events"))
```

- **Ruta relativa (Files/...).** Funciona cuando el notebook tiene un lakehouse predeterminado adjunto.
- **Ruta completa.** Tiene la forma abfss://\<workspace>@onelake.dfs.fabric.microsoft.com/\<lakehouse>.Lakehouse/Files/checkpoints/eventos y es útil en Spark Job Definitions o cuando trabajas con varios lakehouses.
- **Esquema explícito.** En Fabric no hay Auto Loader, así que al leer archivos en streaming se indica el esquema con .schema().

**Ejecución continua.** Para streaming 24/7 en Fabric se usa un Spark Job Definition con política de reintentos. Si el trabajo falla y se reinicia, el checkpoint hace que continúe sin duplicar datos.

**Alternativa sin código.** Eventstream lleva datos de Event Hubs u otras fuentes a un lakehouse o a un Eventhouse y gestiona el progreso internamente, sin checkpoints que configurar.

## Diferencias con otros conceptos de streaming

Varios conceptos de Structured Streaming aparecen cerca del checkpoint y es fácil mezclarlos con él. Solo el checkpoint guarda el progreso de la consulta; los demás resuelven otras cosas.

| Concepto | Para qué sirve | Relación con el checkpoint |
| --- | --- | --- |
| Checkpoint | Guardar el progreso de la consulta | Es lo que permite reanudar sin duplicar ni perder datos |
| Trigger | Decidir cada cuánto se procesa un lote | No guarda nada, solo marca el ritmo |
| Watermark | Decidir cuánto esperar datos tardíos en agregaciones por ventanas | Gestiona tiempos, no progreso |
| Change data feed (CDF) | Leer los cambios de una tabla Delta como origen | Actúa en la lectura de cambios, no en la recuperación. Si lo lees en streaming, la consulta también necesita su checkpoint |
| schemaLocation (Auto Loader) | Guardar el esquema inferido y su evolución | Complementa al checkpoint, no lo sustituye |

Siguiendo con la analogía del libro, el checkpoint es el marcapáginas, el trigger es cada cuánto lees y el watermark es cuánto esperas a las páginas que llegan tarde.

En la práctica, si lo que necesitas es que una consulta se reanude tras un reinicio sin duplicar ni perder datos, o escribir en Delta con exactly-once, la pieza que lo resuelve es el checkpoint. Si el problema es el ritmo de procesamiento, ajusta el trigger, y si son los datos que llegan con retraso a una agregación por ventanas, el watermark.

Si quieres profundizar en schemaLocation y en el change data feed, el artículo sobre [Auto Loader](auto-loader-en-databricks.md) explica cómo se guarda el esquema y el de [change data feed](change-data-feed-en-delta-lake.md) cuenta cómo leer los cambios de una tabla Delta.

## Buenas prácticas y errores comunes

- **Un checkpoint por consulta.** Nunca compartas la misma carpeta entre dos consultas, porque se mezclaría el progreso.
- **No lo borres por error.** Borrar el checkpoint equivale a empezar de cero y reprocesar todo el origen, con riesgo de duplicados.
- **Reinícialo a propósito cuando haga falta.** Si quieres recargar desde el principio, apunta a una carpeta nueva (o borra la vieja) y vacía la tabla destino antes.
- **Cambios en la consulta.** Añadir filtros o columnas suele ser compatible. Cambiar el origen, las claves de agregación o la lógica con estado puede hacer que el checkpoint ya no sirva y haya que crear uno nuevo.
- **Ubicación duradera.** Guárdalo en almacenamiento persistente (volumen de Unity Catalog, Files del lakehouse), nunca en disco local del clúster.
- **Nombres claros.** Una estructura como checkpoints/\<capa>/\<tabla> facilita saber a qué consulta pertenece cada carpeta.
- **No es una copia de seguridad de los datos.** Solo guarda el progreso; los datos están en la tabla destino.
