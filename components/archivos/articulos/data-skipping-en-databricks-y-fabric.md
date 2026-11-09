---
titulo: Data skipping en Databricks y Fabric
bajada: Cómo el motor descarta archivos enteros antes de leerlos, y qué hacer para que pueda saltarse la mayor parte de la tabla.
tema: Rendimiento
fecha: 2026-10-07
imagen: imagenes/data-skipping-en-databricks-y-fabric.jpg
---

## Qué es y por qué importa

El data skipping es la capacidad del motor de no leer los archivos que seguro no contienen los datos que pide una consulta. En lugar de abrir toda la tabla y filtrar después, descarta archivos enteros antes de leerlos.

**Por qué importa.** En tablas grandes, leer datos es lo que más cuesta, tanto en tiempo como en capacidad (DBUs en Databricks, CUs en Fabric). Si una consulta puede saltarse el 95 % de los archivos, tarda y cuesta una fracción de lo que costaría leerlos todos.

**Ejemplo.** Una consulta con WHERE cliente\_id = 500 sobre una tabla de tres archivos.

| Archivo | cliente\_id mínimo | cliente\_id máximo | ¿Se lee? |
| --- | --- | --- | --- |
| A | 1 | 300 | No |
| B | 301 | 600 | Sí |
| C | 601 | 900 | No |

El motor sabe sin abrir los archivos que el 500 solo puede estar en B.

**Analogía.** Son las etiquetas de las estanterías de una biblioteca ("A-C", "D-F"). No entras en las que no pueden tener tu libro. Pero solo funciona si los libros están ordenados. Si cada estantería tiene libros de todas las letras, tienes que revisarlas todas.

## Cómo funciona por dentro

El descarte ocurre en varios niveles, de más grueso a más fino.

**1. Particiones (partition pruning).** Si la tabla está particionada por fecha y filtras por fecha, el motor ni siquiera mira las carpetas de otras fechas.

**2. Archivos (estadísticas de Delta).** Cada vez que se escribe un archivo, Delta guarda en el registro de transacciones sus estadísticas por columna.

| Estadística | Para qué sirve |
| --- | --- |
| minValues / maxValues | Descartar archivos cuyo rango no incluye el valor buscado |
| nullCount | Descartar archivos en filtros IS NULL o IS NOT NULL |
| numRecords | Optimizar planes y conteos |

El motor lee estas estadísticas del log (que es pequeño) y decide qué archivos abrir. Este es el nivel que más ahorra y al que suele referirse "data skipping".

**3. Row groups dentro de cada archivo (estadísticas de Parquet).** Cada archivo Parquet se divide en bloques (row groups) que también tienen su mínimo y máximo. Dentro de un archivo que sí hay que abrir, el lector puede saltarse los bloques que no interesan.

**4. Columnas (formato columnar).** De cada archivo solo se leen las columnas que usa la consulta. Por eso SELECT \* es más caro que seleccionar las columnas necesarias.

**En joins (dynamic file pruning).** Al cruzar una tabla grande con una pequeña filtrada (por ejemplo, ventas con una dimensión de fechas filtrada a un mes), Databricks puede usar los valores de la pequeña para descartar archivos de la grande en tiempo de ejecución. Spark también tiene una versión a nivel de particiones (dynamic partition pruning).

## Qué lo rompe

Hay causas que vienen del diseño de la tabla.

- **Datos desordenados.** Si cada archivo contiene valores de todo el rango, los mínimos y máximos son iguales en todos y no se puede descartar ninguno. Es la causa más habitual.
- **Columna sin estadísticas.** Por defecto solo se calculan para las primeras 32 columnas. Una columna de filtro en la posición 40 no permite saltar archivos.
- **Textos largos.** En columnas de texto, las estadísticas guardan solo los primeros caracteres (unos 32), así que valores con el mismo comienzo no se distinguen bien.
- **Muchos archivos pequeños.** Aunque se descarten bien, leer las estadísticas y abrir miles de archivos tiene un coste propio.

Otras vienen de cómo se escribe el filtro. El motor solo puede comparar con las estadísticas si el filtro usa la columna tal cual.

| Filtro | ¿Permite skipping? | Alternativa |
| --- | --- | --- |
| WHERE fecha = '2026-10-01' | Sí | No hace falta |
| WHERE YEAR(fecha) = 2026 | Normalmente no, la función oculta la columna | WHERE fecha >= '2026-01-01' AND fecha < '2027-01-01' |
| WHERE CAST(cliente\_id AS STRING) = '500' | No | Comparar con el tipo original (cliente\_id = 500) |
| WHERE nombre LIKE 'Gar%' | Sí, es un rango por prefijo | No hace falta |
| WHERE nombre LIKE '%cia' | No | Repensar la búsqueda o una columna auxiliar |
| WHERE UPPER(region) = 'NORTE' | No | Normalizar los valores al escribir y filtrar sin función |
| WHERE a = 1 OR b = 2 | Limitado | Separar en dos consultas con UNION si es crítico |

Spark y Databricks reescriben algunas expresiones sencillas por su cuenta, pero no conviene contar con ello. Escribir el filtro sobre la columna original es lo más fiable.

## Cómo mejorarlo

**1. Ordenar los datos por las columnas de filtro.** Es lo que más impacto tiene, porque estrecha los rangos de cada archivo.

```sql
-- Liquid clustering (recomendado)
ALTER TABLE ventas CLUSTER BY (cliente_id, fecha);
OPTIMIZE ventas;

-- Alternativa clásica: Z-order
OPTIMIZE ventas ZORDER BY (cliente_id, fecha);
```

Las dos técnicas estrechan los rangos de cada archivo, pero se mantienen de forma distinta. Liquid clustering guarda las columnas en la tabla, agrupa de forma incremental (cada OPTIMIZE solo reescribe lo que aún no está agrupado) y deja cambiar las columnas sin reescribir los datos existentes. Con Z-order las columnas se indican en cada OPTIMIZE, y cada ejecución reescribe gran parte de los datos. Liquid clustering no se combina con particionamiento ni con Z-order en la misma tabla. La comparación completa está en el artículo sobre [Z-order, liquid clustering y V-Order](z-order-liquid-clustering-y-v-order.md).

**2. Particionar solo por columnas de baja cardinalidad** (fecha, país) y solo en tablas grandes. Nunca por identificadores.

**3. Asegurar estadísticas en las columnas de filtro.** Colócalas entre las primeras de la tabla o indícalas explícitamente con una propiedad de tabla.

```sql
ALTER TABLE ventas SET TBLPROPERTIES (
    'delta.dataSkippingStatsColumns' = 'fecha,cliente_id,region'
);
```

**4. Evitar archivos pequeños** con OPTIMIZE periódico, optimize write o autoCompact.

**5. Escribir bien los filtros.** Usa la columna original, sin funciones ni conversiones, y rangos en vez de extraer partes de fechas.

**6. Crear columnas auxiliares** cuando se filtra mucho por algo derivado. Por ejemplo, si siempre filtras por mes, guarda una columna mes al escribir y agrupa por ella.

**7. Seleccionar solo las columnas necesarias**, evitando SELECT \* en consultas sobre tablas anchas.

## Cómo comprobar si funciona

**1. El plan de la consulta.** Con explain ves si el filtro llega al lector de archivos.

```python
spark.table("ventas").where("cliente_id = 500").explain()
```

En el nodo de lectura (Scan o FileScan) busca dos cosas.

- **PartitionFilters.** Son los filtros que descartan particiones.
- **PushedFilters / DataFilters.** Son los filtros que se comparan con las estadísticas. Si tu filtro aparece envuelto en una función o no aparece, probablemente no hay skipping.

**2. Las métricas de ejecución.** Son la prueba definitiva, porque dicen cuántos archivos había y cuántos se leyeron.

- **Databricks, notebooks y jobs.** En la Spark UI, pestaña SQL / DataFrame, el nodo de lectura muestra number of files read y files pruned.
- **Databricks, SQL warehouses.** El perfil de la consulta (query profile) muestra archivos leídos y descartados, y bytes leídos.
- **Fabric, notebooks.** Desde el monitor de la sesión de Spark se abre la Spark UI, y las métricas del nodo de lectura son las mismas.

**3. Comparar con el total de archivos de la tabla.**

```python
# Archivos totales de la tabla, para comparar con los leídos en la Spark UI
spark.sql("DESCRIBE DETAIL ventas").select("numFiles").show()
```

Si una consulta filtrada lee casi todos los archivos de la tabla, el data skipping no está funcionando. Revisa el orden de los datos, las estadísticas de la columna y cómo está escrito el filtro.

## Databricks frente a Fabric

El mecanismo base es el mismo, porque ambos usan Delta y Parquet. Lo que cambia son las herramientas alrededor.

|  | Databricks | Fabric |
| --- | --- | --- |
| Estadísticas Delta | Sí | Sí (Spark) |
| Liquid clustering | Recomendado; con CLUSTER BY AUTO elige las columnas según las consultas | Disponible en runtimes recientes; columnas elegidas por ti |
| Z-order y particionamiento | Sí | Sí |
| Mantenimiento automático | Optimización predictiva (OPTIMIZE y estadísticas) | Manual o programado |
| Descarte dinámico en joins | Dynamic file pruning, sobre todo con Photon | Dynamic partition pruning de Spark |
| Optimización propia | Photon | V-Order, que mejora los row groups y la lectura desde Power BI |
| Otros motores que leen la tabla | SQL warehouses | SQL analytics endpoint y Direct Lake, con sus propios motores |

**En Fabric, un matiz.** El SQL analytics endpoint y Direct Lake no usan Spark. Se benefician de un buen diseño (pocos archivos, datos ordenados, V-Order), pero las métricas de la Spark UI solo describen lo que hace Spark. Para Direct Lake, lo que más importa es mantener bajo el número de archivos y row groups.

## Checklist

- [ ] Las columnas por las que más se filtra están en el clustering (o en el Z-order)
- [ ] Esas columnas tienen estadísticas (primeras 32 o en dataSkippingStatsColumns)
- [ ] La tabla no tiene miles de archivos pequeños
- [ ] La partición, si existe, es de baja cardinalidad
- [ ] Los filtros usan la columna original, sin funciones ni conversiones
- [ ] Se comprobó en la Spark UI que las consultas típicas leen una fracción de los archivos
