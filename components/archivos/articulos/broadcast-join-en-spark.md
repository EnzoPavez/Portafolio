---
titulo: Broadcast join en Spark
bajada: Por qué el shuffle es lo más caro de un join en Spark y cómo evitarlo enviando la tabla pequeña a cada executor.
tema: Rendimiento
fecha: 2026-10-07
---

## El problema: el shuffle

En Spark, los datos de una tabla están repartidos entre muchos executors (los trabajadores del clúster o de la sesión). Para hacer un join, las filas que comparten clave tienen que coincidir en el mismo executor.

Si las dos tablas son grandes, Spark las **redistribuye** por la clave del join: cada executor envía por red sus filas al executor que les corresponde. Eso es el **shuffle**, y suele ser la parte más cara de un proceso:

- Mueve muchos datos por la red.
- Escribe datos intermedios en disco.
- Si las claves están mal repartidas (skew), unos pocos executors reciben casi todo y el proceso se queda esperando por ellos.

**Ejemplo típico:** una tabla de ventas con 500 millones de filas cruzada con una tabla de productos de 5.000 filas. Con un shuffle, Spark mueve por la red las 500 millones de ventas solo para juntarlas con una tabla diminuta. Es mucho trabajo para algo que debería ser sencillo.

**Analogía:** tienes 100 personas revisando facturas y una lista de precios de una página. Con shuffle, reorganizas todas las facturas entre las 100 personas según el producto. Con broadcast, simplemente le das una fotocopia de la lista de precios a cada persona y cada una revisa sus facturas sin moverlas.

## Qué es y cómo funciona

En un broadcast join, Spark envía una **copia completa de la tabla pequeña a cada executor**. Así, cada executor puede cruzar la parte de la tabla grande que ya tiene con su copia local, sin mover la tabla grande.

**Los pasos:**

1. El driver recoge la tabla pequeña completa.
2. La convierte en una estructura de búsqueda en memoria (una tabla hash por la clave del join).
3. La envía (broadcast) a todos los executors.
4. Cada executor recorre su parte de la tabla grande y busca cada clave en su copia local.

**Qué se gana:**

|  | Shuffle (sort merge join) | Broadcast join |
| --- | --- | --- |
| Datos movidos por red | Las dos tablas completas | Solo la tabla pequeña, una vez por executor |
| Escritura intermedia en disco | Sí | No |
| Ordenación de las tablas | Sí | No |
| Sensible a claves desbalanceadas (skew) | Mucho | Poco: la tabla grande no se redistribuye |

En joins entre una tabla de hechos grande y dimensiones pequeñas, el cambio puede pasar de minutos a segundos.

**Tipos de join compatibles:** inner, left (con la tabla pequeña a la derecha), semi y anti joins. En un full outer join no se puede hacer broadcast.

## Estrategias de join en Spark

Spark elige entre varias estrategias según el tamaño de las tablas y el tipo de join. Estas son las que verás en los planes:

| Estrategia | Cómo funciona | Cuándo la usa Spark | Coste |
| --- | --- | --- | --- |
| Broadcast hash join | Copia la tabla pequeña a cada executor | Una tabla por debajo del umbral de broadcast | El más barato |
| Shuffle hash join | Redistribuye ambas tablas y construye una tabla hash con la menor en cada partición | Una tabla mediana, sin llegar al umbral de broadcast | Medio |
| Sort merge join | Redistribuye y ordena ambas tablas, luego las recorre a la vez | Dos tablas grandes; es la opción por defecto | Alto, pero escala a cualquier tamaño |
| Broadcast nested loop join | Copia una tabla y compara cada fila con todas | Joins sin igualdad (por ejemplo, rangos con BETWEEN) con una tabla pequeña | Alto si las tablas crecen |
| Cartesian product | Combina cada fila con todas las de la otra | CROSS JOIN o joins sin condición | Muy alto; casi siempre es un error |

**Regla general:** Spark empieza por intentar un broadcast; si las tablas son demasiado grandes, recurre a sort merge join. Los joins sin condición de igualdad son los más caros y conviene evitarlos o reescribirlos.

## Cómo usarlo

**1. Automático, por umbral.** Spark hace broadcast solo si estima que una tabla ocupa menos que spark.sql.autoBroadcastJoinThreshold (10 MB por defecto en Spark; algunas plataformas usan valores mayores).

```python
# Ver el umbral actual
spark.conf.get("spark.sql.autoBroadcastJoinThreshold")

# Subirlo a 100 MB si las dimensiones son algo mayores
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", 100 * 1024 * 1024)
```

El problema es que Spark estima el tamaño antes de ejecutar, y la estimación puede fallar (por ejemplo, tras filtros o agregaciones).

**2. Forzarlo con un hint.** Cuando sabes que una tabla es pequeña, lo más fiable es decírselo:

```python
from pyspark.sql.functions import broadcast

# La tabla de productos es pequeña: se envía a todos los executors
resultado = ventas.join(broadcast(productos), "producto_id")
```

```sql
SELECT /*+ BROADCAST(p) */ v.*, p.nombre
FROM ventas v
JOIN productos p ON v.producto_id = p.producto_id;
```

**3. Adaptive Query Execution (AQE).** Con AQE activado (por defecto en Spark 3 y en Databricks y Fabric), Spark revisa el plan durante la ejecución. Si tras un filtro descubre que una tabla ha quedado pequeña, convierte un sort merge join en broadcast sobre la marcha. AQE también reparte automáticamente las particiones desbalanceadas en joins con skew.

```python
# Comprobar que AQE está activo
spark.conf.get("spark.sql.adaptive.enabled")
```

**Otros hints útiles:** MERGE (forzar sort merge join), SHUFFLE\_HASH y SHUFFLE\_REPLICATE\_NL, para casos en que la elección automática no sea la adecuada.

## Cuándo no usarlo y cómo comprobarlo

**Cuándo no forzar un broadcast:**

- **La tabla "pequeña" no lo es:** el driver tiene que cargarla entera y cada executor guarda una copia. Con una tabla de varios GB puedes provocar errores de memoria (OutOfMemory) en el driver o en los executors.
- **La tabla crece con el tiempo:** un hint que hoy va bien puede romper el proceso dentro de un año. Revísalo cuando cambie el volumen.
- **Full outer join:** no admite broadcast.
- **Tabla pequeña en el lado equivocado:** en un left join, solo se puede hacer broadcast de la tabla de la derecha.

Como referencia orientativa, tablas de hasta unos cientos de MB suelen ir bien en broadcast; por encima, conviene medir.

**Cómo comprobar qué join se usa:**

```python
ventas.join(broadcast(productos), "producto_id").explain()
```

Busca en el plan:

| Aparece en el plan | Significa |
| --- | --- |
| BroadcastHashJoin y BroadcastExchange | Se está haciendo broadcast |
| SortMergeJoin con Exchange en ambas ramas | Shuffle de las dos tablas |
| ShuffledHashJoin | Shuffle con tabla hash |
| BroadcastNestedLoopJoin o CartesianProduct | Join sin igualdad: revisar la condición |

Con AQE, el plan final puede ser distinto al inicial: compruébalo en la **Spark UI**, pestaña SQL / DataFrame, que muestra el plan tal como se ejecutó y cuántos datos se movieron en cada paso (shuffle read/write).

## En Fabric y en Databricks

El broadcast join es una función de Spark, así que funciona igual en los notebooks y Spark Job Definitions de Fabric que en Databricks: mismo hint, misma configuración y mismo plan.

**Diferencias prácticas:**

|  | Fabric | Databricks |
| --- | --- | --- |
| Hint broadcast() y umbral | Igual | Igual |
| AQE | Activado por defecto | Activado por defecto |
| Motor nativo | Native Execution Engine, que también acelera los broadcast joins | Photon |
| Tamaño de executors | Lo marca el pool o el Environment; tablas grandes en broadcast pueden quedarse sin memoria en nodos pequeños | Lo marca el tipo de nodo del clúster o serverless |
| SQL analytics endpoint / SQL warehouse | Motor propio, elige la estrategia de join solo; no se usan estos hints | Los SQL warehouses aceptan los mismos hints de Spark SQL |

**Dónde aplicarlo en una arquitectura medallion:**

- **Silver a gold:** al enriquecer hechos con dimensiones (productos, clientes, fechas, centros). Es el caso más claro.
- **Tablas de mapeo y códigos:** equivalencias, catálogos de estados, calendarios.
- **Filtros por lista:** un semi join con una lista pequeña de IDs a procesar.
- **MERGE:** si el origen del MERGE es pequeño (pocas filas nuevas), Spark puede hacer broadcast del origen y el MERGE es mucho más rápido.

## Checklist

- [ ] Identificar los joins con tablas de búsqueda pequeñas (dimensiones, catálogos)
- [ ] Comprobar en el plan o en la Spark UI si ya se hace broadcast
- [ ] Si no, añadir broadcast() o subir el umbral con criterio
- [ ] Filtrar y seleccionar columnas de la tabla pequeña antes del join, para que ocupe menos
- [ ] Confirmar que AQE está activado
- [ ] Revisar los hints cuando cambie el volumen de las tablas
