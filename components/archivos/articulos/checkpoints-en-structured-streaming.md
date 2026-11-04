---
titulo: Checkpoints en Structured Streaming
bajada: La carpeta donde una consulta de streaming guarda su progreso, y cómo cuidarla para que un reinicio no duplique ni pierda datos.
tema: Ingesta y streaming
fecha: 2026-10-06
---

## Qué es y qué resuelve

Un checkpoint es una carpeta donde una consulta de Structured Streaming guarda su progreso: qué datos del origen ya leyó y qué lotes ya escribió en el destino. Gracias a él, si el clúster se reinicia o el trabajo falla, la consulta continúa exactamente donde lo dejó.

**El problema sin checkpoint:** tras un reinicio, la consulta no sabe por dónde iba. O vuelve a empezar desde el principio y duplica datos, o empieza desde lo último y pierde lo que había en medio.

**Analogía:** es el marcapáginas de un libro. Si cierras el libro de golpe, al abrirlo sigues leyendo en la página exacta, sin releer capítulos ni saltarte ninguno.

**Para qué sirve:**

- **Recuperación tras fallos:** reanudar sin intervención manual.
- **Exactly-once:** junto con un destino Delta, cada dato se escribe una sola vez, aunque haya reinicios.
- **Guardar estado:** en agregaciones, deduplicaciones o joins en streaming, conserva los resultados parciales para no recalcularlos.

## Qué guarda y cómo recupera

Dentro de la carpeta del checkpoint hay varias subcarpetas:

| Carpeta | Qué contiene |
| --- | --- |
| metadata | El identificador único de la consulta |
| offsets | Hasta dónde se va a leer en cada lote (por ejemplo, la posición en Event Hubs o los archivos de una carpeta) |
| commits | Qué lotes se completaron y escribieron con éxito |
| state | Los resultados parciales de agregaciones, deduplicaciones o joins (solo si la consulta tiene estado) |
| sources | Información del origen, por ejemplo qué archivos ya se han leído |

**Cómo funciona cada lote:**

1. Antes de leer, anota en offsets qué rango va a procesar (lote 42: posiciones 1000 a 1500).
2. Procesa los datos y los escribe en la tabla Delta.
3. Al terminar, anota en commits que el lote 42 está completo.

**Al reiniciar:** compara offsets y commits. Si el lote 42 aparece en offsets pero no en commits, lo repite con exactamente el mismo rango; Delta detecta que ese lote ya pudo escribirse y no lo duplica. Si está en commits, empieza directamente por el lote 43.

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

- **checkpointLocation:** el progreso de la consulta.
- **cloudFiles.schemaLocation:** propio de Auto Loader; guarda el esquema inferido y su evolución. No sustituye al checkpoint.
- **trigger(availableNow=True):** procesa lo pendiente y se detiene. Muy útil en jobs programados, porque el checkpoint permite que cada ejecución siga donde acabó la anterior.

En las canalizaciones declarativas (Lakeflow SDP), Databricks gestiona los checkpoints automáticamente: no hay que indicarlos.

## En Fabric

Funciona igual, porque Fabric usa el mismo Spark Structured Streaming. La diferencia es dónde se guarda: en la sección Files de un lakehouse, dentro de OneLake.

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

- **Ruta relativa (Files/...):** funciona cuando el notebook tiene un lakehouse predeterminado adjunto.
- **Ruta completa:** abfss://\<workspace>@onelake.dfs.fabric.microsoft.com/\<lakehouse>.Lakehouse/Files/checkpoints/eventos, útil en Spark Job Definitions o cuando trabajas con varios lakehouses.
- **Esquema explícito:** en Fabric no hay Auto Loader, así que al leer archivos en streaming se indica el esquema con .schema().

**Ejecución continua en Fabric:** para streaming 24/7 se usa un Spark Job Definition con política de reintentos. Si el trabajo falla y se reinicia, el checkpoint hace que continúe sin duplicar datos.

**Alternativa sin código:** Eventstream lleva datos de Event Hubs u otras fuentes a un lakehouse o a un Eventhouse y gestiona el progreso internamente, sin checkpoints que configurar.

## Buenas prácticas y errores comunes

- **Un checkpoint por consulta:** nunca compartas la misma carpeta entre dos consultas; se mezclaría el progreso.
- **No lo borres por error:** borrar el checkpoint equivale a empezar de cero y reprocesar todo el origen, con riesgo de duplicados.
- **Reinícialo a propósito cuando haga falta:** si quieres recargar desde el principio, apunta a una carpeta nueva (o borra la vieja) y vacía la tabla destino antes.
- **Cambios en la consulta:** añadir filtros o columnas suele ser compatible; cambiar el origen, las claves de agregación o la lógica con estado puede hacer que el checkpoint ya no sirva y haya que crear uno nuevo.
- **Ubicación duradera:** guárdalo en almacenamiento persistente (volumen de Unity Catalog, Files del lakehouse), nunca en disco local del clúster.
- **Nombres claros:** una estructura como checkpoints/\<capa>/\<tabla> facilita saber a qué consulta pertenece cada carpeta.
- **No es una copia de seguridad de los datos:** solo guarda el progreso; los datos están en la tabla destino.

## Para el examen

Si la pregunta habla de **reprocesar datos tras un reinicio**, **reanudar sin duplicar** o **exactly-once**, la respuesta es el checkpoint.

Conceptos que suelen aparecer como distractores:

| Concepto | Para qué sirve | Por qué no evita reprocesar |
| --- | --- | --- |
| Checkpoint | Guardar el progreso de la consulta | Es la respuesta correcta |
| Trigger | Cada cuánto se procesa un lote | No guarda nada |
| Watermark | Cuánto esperar datos tardíos en agregaciones por ventanas | Gestiona tiempos, no progreso |
| Change data feed (CDF) | Leer los cambios de una tabla Delta como origen | Actúa en la lectura de cambios, no en la recuperación |
| schemaLocation (Auto Loader) | Guardar el esquema inferido y su evolución | Complementa al checkpoint, no lo sustituye |

Regla fácil: el checkpoint es el marcapáginas, el trigger es cada cuánto lees y el watermark es cuánto esperas a las páginas que llegan tarde.
