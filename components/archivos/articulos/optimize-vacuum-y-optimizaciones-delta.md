---
titulo: OPTIMIZE, VACUUM y cómo combinar las optimizaciones Delta
bajada: Qué hace cada comando de mantenimiento, en qué orden conviene correrlos y cómo se combinan con el resto de optimizaciones de Delta.
tema: Rendimiento
fecha: 2026-10-06
---

## Guía rápida

**Al crear una tabla:**

- [ ] Columnas de filtro y claves al principio, para que tengan estadísticas ([Estadísticas](#estadisticas-y-orden-de-columnas))
- [ ] Liquid clustering por las columnas más filtradas, o particionamiento solo si son de baja cardinalidad ([Combinaciones](#combinaciones))
- [ ] Deletion vectors si habrá UPDATE, DELETE o MERGE frecuentes
- [ ] Change data feed si alimenta a otras capas
- [ ] Retención acorde a auditoría y time travel que se necesite
- [ ] Revisar quién la lee antes de activar características que suben el protocolo ([Esquema y protocolo](#esquema-column-mapping-y-protocolo))

**Al escribir:**

- [ ] Optimize write o autoCompact en tablas con escrituras frecuentes ([Prevenir archivos pequeños](#prevenir-archivos-pequenos-en-la-escritura))
- [ ] V-Order en tablas que lee Power BI (Fabric)
- [ ] MERGE con origen deduplicado y filtros en el ON ([MERGE](#rendimiento-de-merge))

**Para mantenerla:**

- [ ] Diagnosticar con DESCRIBE DETAIL antes de optimizar ([Diagnóstico](#para-el-dia-a-dia-diagnosticar-antes-de-optimizar))
- [ ] OPTIMIZE primero, VACUUM después ([Orden y frecuencia](#orden-frecuencia-y-automatizacion))
- [ ] Mantenimiento fuera del horario de cargas ([Concurrencia](#conflictos-de-concurrencia))
- [ ] Excluir tablas que llegan por shortcut ([Shortcuts](#mantenimiento-y-accesos-directos))
- [ ] Medir el coste y ajustar la frecuencia ([Coste](#medir-el-coste-del-mantenimiento))

**Si algo va mal:**

- Consultas lentas: número de archivos, estadísticas y clustering.
- Informe de Direct Lake lento de repente: número de archivos de sus tablas ([Direct Lake](#direct-lake-y-mantenimiento-automatizado)).
- Error de concurrencia: coincidencia con otro proceso; reintentar y separar horarios.
- El almacenamiento no deja de crecer: VACUUM y retención.
- Time travel no llega tan atrás como esperabas: deletedFileRetentionDuration.

## Visión general

Todas estas piezas actúan en momentos distintos de la vida de una tabla Delta. Agruparlas así ayuda a ver qué se combina con qué:

| Momento | Pieza | Qué hace |
| --- | --- | --- |
| Diseño de la tabla | Particionamiento, liquid clustering | Decide cómo se agrupan las filas entre archivos |
| Al escribir | V-Order, deletion vectors, autoCompact | Cómo se escribe cada archivo y cómo se aplican los cambios |
| Mantenimiento: reorganizar | OPTIMIZE (con Z-order, liquid o V-Order) | Compacta archivos pequeños y reordena datos |
| Mantenimiento: limpiar | VACUUM | Borra físicamente archivos que ya no usa la tabla |
| Reglas | Propiedades de tabla (retención, DV, CDF...) | Fijan el comportamiento de todo lo anterior |

**Con la analogía de la biblioteca:**

- **Liquid clustering o Z-order:** en qué estantería va cada libro.
- **V-Order:** cómo se imprime cada libro.
- **Deletion vectors:** post-its con correcciones en vez de reimprimir.
- **OPTIMIZE:** reordenar estanterías, juntar folletos sueltos en tomos y reimprimir páginas con muchos post-its.
- **VACUUM:** tirar a la basura los libros viejos que ya nadie usa.
- **Propiedades de tabla:** las normas de la biblioteca (cuánto se guardan los libros viejos, si se permiten post-its...).

## OPTIMIZE

**Qué hace:** junta muchos archivos pequeños en pocos archivos grandes (compactación) y, según la variante, reordena los datos. Lee más rápido porque el motor abre menos archivos y puede saltarse más.

**Lo que NO hace:** no borra nada del almacenamiento. Los archivos antiguos quedan marcados como eliminados y siguen ocupando espacio hasta el VACUUM.

**Variantes:**

```sql
-- Compactación simple (y, si la tabla tiene liquid clustering, agrupa lo pendiente)
OPTIMIZE ventas;

-- Solo una parte de una tabla particionada
OPTIMIZE ventas WHERE fecha >= '2026-10-01';

-- Con Z-order (tablas sin liquid clustering)
OPTIMIZE ventas ZORDER BY (cliente, fecha);

-- Liquid clustering: reagrupar toda la tabla, por ejemplo tras cambiar las columnas
OPTIMIZE ventas FULL;

-- Fabric: compactar aplicando V-Order
OPTIMIZE ventas VORDER;
```

**Cuándo usarlo:**

- Tablas que reciben muchas escrituras pequeñas (streaming, cargas frecuentes).
- Después de muchos UPDATE, DELETE o MERGE, para consolidar deletion vectors.
- Tablas que se consultan mucho filtrando por ciertas columnas.

**Cuándo no hace falta:** tablas pequeñas, tablas que se reescriben enteras cada vez, o tablas donde autoCompact u optimización predictiva ya lo hacen.

**Coste:** consume cómputo, porque reescribe datos. Es una operación segura: las consultas siguen funcionando mientras se ejecuta.

## VACUUM

**Qué hace:** borra físicamente del almacenamiento los archivos de datos que la versión actual de la tabla ya no usa y que superan el periodo de retención. Recupera espacio y elimina de verdad los datos borrados.

**Lo que NO hace:** no compacta, no reordena y no toca el registro de transacciones (el log se limpia solo según logRetentionDuration).

```sql
-- Ver qué archivos borraría, sin borrarlos
VACUUM ventas DRY RUN;

-- Borrar usando la retención de la tabla (por defecto, 7 días)
VACUUM ventas;

-- Borrar con una retención concreta
VACUUM ventas RETAIN 168 HOURS;
```

**Cuándo usarlo:**

- Después de OPTIMIZE, para liberar el espacio de los archivos reemplazados.
- Tras borrados por cumplimiento normativo, para eliminar físicamente los datos.
- De forma periódica (por ejemplo, semanal) en tablas con muchos cambios.

**Precauciones:**

- Limita el time travel: tras el VACUUM no se puede volver a versiones cuyos archivos se han borrado.
- No uses una retención menor de 7 días en producción: podrías borrar archivos que una consulta o un stream en marcha aún necesita.
- La retención se controla con delta.deletedFileRetentionDuration; para retenciones cortas, Delta exige desactivar una comprobación de seguridad, y eso es una señal de que no deberías hacerlo.
- Es seguro para las consultas en curso sobre la versión actual: no borra nada que esa versión use.

## Orden, frecuencia y automatización

**Orden:** primero OPTIMIZE, después VACUUM. OPTIMIZE genera archivos nuevos y deja los viejos marcados; VACUUM los borra cuando ha pasado la retención. Al revés no tiene sentido.

**Frecuencia orientativa:**

| Tipo de tabla | OPTIMIZE | VACUUM |
| --- | --- | --- |
| Streaming o cargas cada pocos minutos | Diario (o autoCompact) | Semanal |
| Carga diaria por lotes | Semanal | Semanal o mensual |
| Muchos UPDATE, DELETE o MERGE | Diario o semanal | Semanal |
| Tabla pequeña o que se reescribe entera | Rara vez | Semanal |

**En Databricks:** en tablas administradas de Unity Catalog, la **optimización predictiva** ejecuta OPTIMIZE, VACUUM y ANALYZE automáticamente cuando detecta que hace falta. Es la opción de mínimo esfuerzo y la que suele buscar el examen.

**En Fabric:** no hay optimización predictiva. Opciones:

- **Mantenimiento del lakehouse:** clic derecho sobre la tabla, Maintenance, y eliges OPTIMIZE (con o sin V-Order) y VACUUM con su retención.
- **Notebook programado** con los comandos SQL o con la API de mantenimiento de tablas, lanzado desde un pipeline.
- **autoCompact** y **optimize write** para reducir archivos pequeños en la escritura, de forma que el OPTIMIZE haga falta menos a menudo.

## Combinaciones

**Qué se puede usar junto y qué no:**

|  | Particionamiento | Z-order | Liquid clustering | V-Order | Deletion vectors |
| --- | --- | --- | --- | --- | --- |
| Particionamiento | — | Sí | No | Sí | Sí |
| Z-order | Sí | — | No | Sí | Sí |
| Liquid clustering | No | No | — | Sí | Sí |
| V-Order | Sí | Sí | Sí | — | Sí |
| Deletion vectors | Sí | Sí | Sí | Sí | — |

**Reglas para recordarlo:**

- **Organizar filas entre archivos:** elige una estrategia. Liquid clustering sola, o bien particionamiento con Z-order (el patrón clásico). Liquid no se mezcla con ninguna de las otras dos.
- **V-Order:** complementa a cualquiera, porque actúa dentro de cada archivo. Solo en Fabric.
- **Deletion vectors:** complementan a cualquiera, porque solo cambian cómo se aplican UPDATE, DELETE y MERGE.

**Cómo interactúan con OPTIMIZE y VACUUM:**

| Pieza | Relación con OPTIMIZE | Relación con VACUUM |
| --- | --- | --- |
| Z-order | Se aplica con OPTIMIZE ZORDER BY; hay que repetirlo y reescribe mucho | Deja muchos archivos viejos: conviene VACUUM después |
| Liquid clustering | OPTIMIZE agrupa solo lo pendiente; FULL para reagrupar todo | Genera menos archivos viejos que Z-order |
| V-Order | Se aplica al escribir u OPTIMIZE ... VORDER | Sin relación directa |
| Deletion vectors | OPTIMIZE consolida las marcas al reescribir archivos | Los datos borrados solo desaparecen tras OPTIMIZE o REORG + VACUUM |
| autoCompact | Un OPTIMIZE ligero tras cada escritura; reduce la necesidad del manual | También deja archivos viejos para el VACUUM |

**Propiedades de tabla que condicionan todo:**

- **deletedFileRetentionDuration:** cuánto esperará VACUUM antes de borrar. Más largo = más time travel y más almacenamiento.
- **logRetentionDuration:** cuánto historial se guarda. Debe ser igual o mayor que la anterior.
- **enableDeletionVectors:** activa los post-its; obliga a pensar en OPTIMIZE y VACUUM si hay datos personales que borrar de verdad.
- **autoOptimize.autoCompact:** reduce archivos pequeños sin intervención.
- **enableChangeDataFeed:** los datos de cambios también los limpia VACUUM según la retención.

**Cuidado con estas combinaciones:**

- **VACUUM con retención corta + streaming:** un stream que lee la tabla puede fallar si VACUUM borra archivos que aún no ha procesado.
- **VACUUM + time travel largo:** si necesitas volver 30 días atrás, la retención debe ser de al menos 30 días.
- **Deletion vectors + borrado legal:** el DELETE solo marca; sin REORG o OPTIMIZE y VACUUM, el dato sigue físicamente en el archivo.
- **Z-order en una tabla con liquid clustering:** no está permitido.

## Recetas por tipo de tabla

**1. Tabla bronze de ingesta (streaming o cargas frecuentes)**

- autoCompact activado para evitar archivos pequeños.
- Liquid clustering por la fecha de ingesta si se filtra por ella.
- Sin V-Order (penaliza la escritura y nadie lee directamente desde Power BI).
- OPTIMIZE diario y VACUUM semanal con 7 días de retención.

**2. Tabla silver con muchas correcciones (UPDATE, MERGE, DELETE)**

- Deletion vectors activados.
- Liquid clustering por las columnas de filtro y de cruce (por ejemplo, CustomerId).
- Change data feed si alimenta a otras capas.
- OPTIMIZE frecuente para consolidar los deletion vectors.

**3. Tabla gold que se lee desde Power BI (Fabric)**

- V-Order activado, pensando en Direct Lake.
- Liquid clustering o Z-order por las columnas más filtradas.
- OPTIMIZE ... VORDER tras las cargas y VACUUM semanal.

**4. Tabla con datos personales sujetos a borrado legal**

- Deletion vectors para que los borrados sean rápidos.
- Tras los borrados: REORG TABLE ... APPLY (PURGE) u OPTIMIZE, y después VACUUM.
- Retención ajustada al plazo legal: lo bastante corta para cumplirlo y lo bastante larga para no romper procesos.

```sql
-- Ejemplo completo para la receta 2 en Databricks
CREATE TABLE clientes_silver (id INT, nombre STRING, ciudad STRING)
CLUSTER BY (id)
TBLPROPERTIES (
    'delta.enableDeletionVectors' = true,
    'delta.enableChangeDataFeed' = true,
    'delta.autoOptimize.autoCompact' = true,
    'delta.deletedFileRetentionDuration' = 'interval 7 days'
);
```

## Para el día a día: diagnosticar antes de optimizar

Antes de lanzar OPTIMIZE a ciegas, mira el estado de la tabla:

```sql
-- Número de archivos, tamaño total, propiedades y clustering
DESCRIBE DETAIL ventas;
```

```python
# Tamaño medio de archivo en MB
d = spark.sql("DESCRIBE DETAIL ventas").collect()[0]
print(d.numFiles, round(d.sizeInBytes / d.numFiles / 1024 / 1024, 1))
```

**Cómo interpretarlo:**

- Tamaño medio por debajo de unos 32 MB con muchos archivos: hay problema de archivos pequeños, toca OPTIMIZE.
- Entre 128 MB y 1 GB: tamaño sano para la mayoría de tablas.
- Pocos archivos muy grandes en una tabla con muchos MERGE: puede compensar un tamaño objetivo menor.

DESCRIBE HISTORY complementa el diagnóstico: muestra cuántos archivos añade cada escritura (numAddedFiles) y cuánto tardan las operaciones.

## Prevenir archivos pequeños en la escritura

Es más barato no generar archivos pequeños que compactarlos después.

**Optimize write:** antes de escribir, reagrupa los datos para producir menos archivos y más grandes. Añade algo de coste a la escritura, pero ahorra OPTIMIZE posteriores. Muy útil en MERGE y en cargas con muchas particiones.

```sql
-- Como propiedad de tabla
ALTER TABLE ventas SET TBLPROPERTIES ('delta.autoOptimize.optimizeWrite' = true);
```

```python
# En Fabric, para toda la sesión
spark.conf.set("spark.microsoft.delta.optimizeWrite.enabled", "true")
```

**Tamaño objetivo de archivo:** delta.targetFileSize indica el tamaño que buscan OPTIMIZE, autoCompact y optimize write. Valores más pequeños favorecen MERGE y UPDATE frecuentes; más grandes, las lecturas masivas.

```sql
ALTER TABLE ventas SET TBLPROPERTIES ('delta.targetFileSize' = '256mb');
```

**Perfiles de recursos en Fabric:** el área de trabajo o el Environment pueden tener un perfil (por ejemplo, writeHeavy o perfiles orientados a lectura) que activa o desactiva de golpe V-Order, optimize write y otras opciones. Comprueba cuál está en uso antes de ajustar propiedades una a una, porque cambia el comportamiento por defecto de todas las tablas.

```python
# Ver el perfil activo en la sesión
spark.conf.get("spark.fabric.resourceProfile", "no definido")
```

## Estadísticas y orden de columnas

El salto de archivos (data skipping) depende de las estadísticas mínimo/máximo que Delta guarda por archivo. Por defecto, solo las calcula para las **primeras 32 columnas** de la tabla. Si filtras por una columna que está en la posición 40, el motor no puede descartar archivos por ella, aunque uses liquid clustering o Z-order.

**Cómo evitarlo:**

- Pon las columnas de filtro, fechas y claves al principio de la tabla al diseñarla.
- O indica explícitamente en qué columnas calcular estadísticas.

```sql
-- Calcular estadísticas solo en las columnas que importan
ALTER TABLE ventas SET TBLPROPERTIES (
    'delta.dataSkippingStatsColumns' = 'fecha,cliente_id,region'
);

-- Recalcular las estadísticas de los archivos existentes (Databricks)
ANALYZE TABLE ventas COMPUTE DELTA STATISTICS;
```

Evita además calcular estadísticas sobre columnas de texto largo (descripciones, JSON): encarecen la escritura y no ayudan a filtrar.

## Rendimiento de MERGE

MERGE suele ser el proceso más caro de una arquitectura medallion. Las claves para abaratarlo:

1. **Deduplicar el origen:** si el origen trae varias filas para la misma clave, MERGE falla o hace trabajo de más. Quédate con la última por clave antes de fusionar.
2. **Limitar qué parte del destino se lee:** añade al ON condiciones que permitan saltar archivos, por ejemplo por fecha.
3. **Agrupar el destino por la clave del MERGE:** liquid clustering por esa clave hace que cada MERGE toque pocos archivos.
4. **Deletion vectors:** las filas actualizadas no obligan a reescribir archivos completos.
5. **Solo actualizar lo que cambió:** añade una condición al WHEN MATCHED para no reescribir filas idénticas.

```sql
MERGE INTO ventas AS d
USING ventas_nuevas AS o
ON d.id = o.id
   AND d.fecha >= date_sub(current_date(), 7)   -- solo lee la última semana del destino
WHEN MATCHED AND d.importe <> o.importe THEN     -- solo si algo cambió
    UPDATE SET d.importe = o.importe
WHEN NOT MATCHED THEN
    INSERT *;
```

La condición por fecha solo es válida si sabes que los cambios nunca afectan a filas más antiguas; si no, podrías insertar duplicados.

## Esquema, column mapping y protocolo

**Añadir columnas nuevas sin romper la carga:**

```python
# Acepta columnas nuevas del origen al escribir
df.write.format("delta").mode("append").option("mergeSchema", "true").saveAsTable("ventas")
```

**Renombrar o borrar columnas sin reescribir la tabla:** requiere activar column mapping.

```sql
ALTER TABLE ventas SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name');
ALTER TABLE ventas RENAME COLUMN imp TO importe;
ALTER TABLE ventas DROP COLUMN columna_obsoleta;
```

**Versiones de protocolo:** activar deletion vectors, liquid clustering, column mapping o CDF sube la versión de protocolo de la tabla. Es un cambio sin vuelta atrás sencilla, y lectores más antiguos o herramientas externas pueden dejar de leerla.

Antes de activarlas en una tabla compartida, comprueba quién la lee: otros runtimes de Spark, Power BI por Direct Lake, el SQL analytics endpoint, accesos directos desde otras plataformas o herramientas de terceros. DESCRIBE DETAIL muestra minReaderVersion, minWriterVersion y las características activas.

## Direct Lake y mantenimiento automatizado

**Direct Lake:** los modelos semánticos en Direct Lake tienen límites según la capacidad (número de archivos Parquet, row groups y filas por tabla). Si una tabla los supera, el modelo cae a DirectQuery y las consultas se vuelven mucho más lentas. Un OPTIMIZE regular (con V-Order) mantiene bajo el número de archivos y evita esa caída. Si un informe se vuelve lento de repente, revisa primero el número de archivos de las tablas que usa.

**Mantenimiento automatizado:** en Fabric no hay optimización predictiva, así que un notebook que recorra las tablas y solo optimice las que lo necesitan ahorra mucho tiempo. Se lanza desde un pipeline, por ejemplo cada semana.

```python
# Revisa todas las tablas del lakehouse y aplica mantenimiento solo donde hace falta
UMBRAL_MB = 64
MIN_ARCHIVOS = 50

for t in spark.catalog.listTables():
    d = spark.sql(f"DESCRIBE DETAIL {t.name}").collect()[0]
    if d.numFiles == 0:
        continue

    medio_mb = d.sizeInBytes / d.numFiles / 1024 / 1024
    print(f"{t.name}: {d.numFiles} archivos, {medio_mb:.1f} MB de media")

    # Compactamos solo si hay muchos archivos pequeños
    if d.numFiles >= MIN_ARCHIVOS and medio_mb < UMBRAL_MB:
        spark.sql(f"OPTIMIZE {t.name}")

    # Limpieza de archivos antiguos con la retención de cada tabla
    spark.sql(f"VACUUM {t.name}")
```

**Mejoras habituales sobre esta base:**

- Guardar el resultado de cada ejecución en una tabla de log (tabla, archivos antes y después, duración) para ver la evolución.
- Añadir VORDER al OPTIMIZE en las tablas de la capa gold.
- Excluir tablas que se reescriben enteras en cada carga.
- Ejecutarlo fuera del horario de cargas para no competir por la capacidad.

## Conflictos de concurrencia

Delta permite que varios procesos escriban en la misma tabla, pero si dos operaciones tocan los mismos archivos a la vez, una de ellas falla al confirmar. Errores típicos:

| Error | Causa habitual |
| --- | --- |
| ConcurrentAppendException | Otro proceso añadió datos en la zona que tu operación leía (por ejemplo, dos MERGE sobre la misma partición) |
| ConcurrentDeleteReadException | Otro proceso borró o reescribió archivos que tu operación estaba leyendo |
| ConcurrentDeleteDeleteException | Dos procesos intentaron reescribir los mismos archivos, por ejemplo un OPTIMIZE y un UPDATE |

**Cómo evitarlos:**

- **Separar horarios:** que el mantenimiento (OPTIMIZE, VACUUM) no coincida con las cargas.
- **Deletion vectors y liquid clustering:** en Databricks permiten concurrencia a nivel de fila, de modo que dos escrituras sobre filas distintas del mismo archivo ya no chocan.
- **Condiciones explícitas:** en MERGE y UPDATE, añadir filtros (por fecha o partición) que dejen claro que dos procesos trabajan en zonas distintas.
- **Reintentos:** configurar reintentos en la actividad del pipeline o en el job. Estos errores suelen ser transitorios y el segundo intento funciona.
- **No escribir en paralelo en la misma tabla desde varios pipelines** si se puede evitar; mejor encadenarlos.

## Mantenimiento y accesos directos

Una tabla que llega a tu lakehouse mediante un acceso directo (shortcut) no es tuya: sus archivos viven en otro lakehouse, en otra área de trabajo o en un almacenamiento externo. El mantenimiento se hace en el origen, por quien es dueño de esa tabla.

**Riesgos de mantenerla desde el destino:**

- Un VACUUM con una retención distinta a la del origen puede borrar archivos que otros procesos del origen necesitan.
- Puede fallar por falta de permisos de escritura, o competir con el mantenimiento del propietario.
- Si el shortcut apunta a otra plataforma (por ejemplo, ADLS usado por Databricks), las optimizaciones pueden no ser compatibles.

**En el notebook automatizado:** excluye los shortcuts. La forma más sencilla es una lista de exclusión; para algo más robusto, la API REST de Fabric permite listar los shortcuts de un lakehouse.

```python
# Tablas que llegan por shortcut y no se mantienen desde aquí
EXCLUIDAS = {"clientes_crm", "tipos_cambio"}

for t in spark.catalog.listTables():
    if t.name in EXCLUIDAS:
        continue
    # ... diagnóstico y mantenimiento como en el apartado anterior
```

Lo mismo aplica en sentido contrario: si otros consumen tus tablas por shortcut, avisa antes de cambiar la retención o activar características que suban el protocolo.

## Medir el coste del mantenimiento

OPTIMIZE y VACUUM consumen capacidad. Si los lanzas con demasiada frecuencia, gastas CU sin mejorar nada; si los lanzas poco, las consultas se degradan. Hay que medir para encontrar el punto.

**Dónde mirarlo en Fabric:**

- **App Capacity Metrics:** muestra cuántas CU consume cada elemento (el notebook o el pipeline de mantenimiento) y en qué momentos. Sirve para ver si el mantenimiento provoca picos o throttling que afectan a otras cargas.
- **Monitoring hub:** duración de cada ejecución del notebook o pipeline.
- **DESCRIBE HISTORY:** en las filas de OPTIMIZE, operationMetrics indica cuántos archivos se eliminaron y añadieron. Si un OPTIMIZE apenas cambia archivos, lo estás lanzando más de lo necesario.

**Señales para ajustar:**

| Señal | Ajuste |
| --- | --- |
| OPTIMIZE que apenas compacta archivos | Reducir frecuencia o subir el umbral del notebook |
| Consultas o informes que se degradan entre ejecuciones | Aumentar frecuencia o activar optimize write y autoCompact |
| Picos de CU que coinciden con cargas | Mover el mantenimiento a otra franja horaria |
| El almacenamiento crece aunque los datos no | Revisar que el VACUUM se ejecuta y la retención configurada |

Guardar en una tabla de log los archivos antes y después de cada mantenimiento (como se propone en el apartado anterior) convierte estas decisiones en algo medible.

## Para el examen

| Si la pregunta dice... | La respuesta suele ser... |
| --- | --- |
| Muchos archivos pequeños, lecturas lentas | OPTIMIZE (o autoCompact) |
| Recuperar almacenamiento, borrar archivos antiguos | VACUUM |
| Borrar datos de más de X días | deletedFileRetentionDuration + VACUUM |
| Conservar X días para auditoría | logRetentionDuration + deletedFileRetentionDuration |
| Filtros por columnas de alta cardinalidad, tablas que crecen | Liquid clustering |
| Muchas actualizaciones y borrados | Deletion vectors |
| Mínimo esfuerzo de mantenimiento en tablas administradas | Optimización predictiva |
| Las tablas deben seguir disponibles durante la limpieza | VACUUM u OPTIMIZE (nunca borrar y recrear) |

**Trampas habituales:**

- OPTIMIZE no libera espacio: lo hace VACUUM.
- VACUUM no mejora el rendimiento de las consultas: lo hace OPTIMIZE.
- Z-order y liquid clustering no se combinan.
- Particionar por una columna de alta cardinalidad es casi siempre incorrecto.
- V-Order no aparece en el examen de Databricks: es de Fabric.
