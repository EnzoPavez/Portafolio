---
titulo: Z-order, liquid clustering y V-Order
bajada: Tres técnicas para que las consultas lean menos, en qué parte actúa cada una y cuándo conviene usarlas.
tema: Rendimiento
fecha: 2026-10-03
imagen: imagenes/z-order-liquid-clustering-y-v-order.jpg
---

## La idea común

Las tres técnicas buscan que las consultas lean menos y más rápido, pero actúan en sitios distintos.

- **Z-order y liquid clustering** deciden qué filas van juntas en qué archivo, para que al filtrar el motor pueda saltarse archivos enteros (data skipping).
- **V-Order** decide cómo se escribe cada archivo por dentro, para que leerlo sea más rápido.

Se entiende mejor con una biblioteca como ejemplo.

- **Z-order.** Ordenas los libros en las estanterías por dos criterios a la vez (autor y año). Si buscas "García, 2020", vas directo a un par de estanterías. El problema es que, cuando llegan libros nuevos, para mantener el orden tienes que reorganizar gran parte de la biblioteca otra vez.
- **Liquid clustering.** La misma idea, pero más inteligente. Solo coloca los libros nuevos que aún no están ordenados, sin tocar lo que ya estaba bien. Y si mañana quieres ordenar por editorial en vez de por autor, cambias el criterio sin reconstruir todo.
- **V-Order.** No mueve libros entre estanterías. Imprime cada libro de forma más compacta y con mejor índice, para que leerlo sea más rápido.

**Cómo se saltan archivos.** Cada archivo Delta guarda en el [registro de transacciones](registro-de-transacciones-y-acid.md) el valor mínimo y máximo de cada columna. Si los datos están bien agrupados, al filtrar CustomerId = 500 el motor descarta todos los archivos cuyo rango no incluye el 500, sin abrirlos. El mecanismo completo está en el artículo sobre [data skipping](data-skipping-en-databricks-y-fabric.md).

## El particionamiento como punto de partida

El particionamiento fue la primera forma de organizar datos. Separa la tabla en carpetas por el valor de una columna.

```sql
-- Una carpeta por cada fecha
CREATE TABLE ventas (id INT, cliente STRING, fecha DATE)
PARTITIONED BY (fecha);
```

- **Funciona bien** con columnas de baja cardinalidad (pocos valores distintos), como fecha o país, y tablas grandes.
- **Funciona mal** con columnas de alta cardinalidad, como CustomerId, porque crea miles de carpetas con archivos diminutos.
- **Es rígido.** Cambiar la columna de partición obliga a reescribir toda la tabla.

Z-order y liquid clustering nacieron para cubrir esas limitaciones. Liquid clustering, además, sustituye al particionamiento en tablas nuevas. No se pueden usar los dos en la misma tabla.

## Z-order

Z-order reordena las filas para que valores parecidos de varias columnas queden en los mismos archivos. Se aplica al ejecutar [OPTIMIZE](optimize-vacuum-y-optimizaciones-delta.md).

```sql
-- Agrupa los datos por cliente y fecha
OPTIMIZE ventas ZORDER BY (cliente, fecha);
```

- **Ventaja.** Mejora mucho los filtros por esas columnas, incluso combinadas.
- **Inconveniente.** No es incremental. Cada OPTIMIZE ZORDER reescribe gran parte de los datos, y hay que repetirlo según llegan datos nuevos.
- **Columnas.** Se indican en cada ejecución y no quedan guardadas en la tabla.
- **Recomendación.** Pocas columnas (1 a 4), las más usadas en filtros. Cuantas más añades, menos eficaz es con cada una.

Es compatible con el particionamiento. Se suele particionar por fecha y aplicar Z-order dentro de cada partición.

## Liquid clustering

Liquid clustering agrupa los datos por unas columnas clave que quedan guardadas en la tabla, y lo hace de forma incremental. Es la técnica que Databricks recomienda para tablas nuevas.

```sql
-- Definir las columnas de clustering al crear la tabla
CREATE TABLE ventas (id INT, cliente STRING, fecha DATE)
CLUSTER BY (cliente, fecha);

-- Agrupar los datos pendientes (solo reescribe lo que aún no está agrupado)
OPTIMIZE ventas;

-- Cambiar las columnas sin reescribir los datos existentes
ALTER TABLE ventas CLUSTER BY (cliente, region);

-- Dejar que Databricks elija las columnas según las consultas
ALTER TABLE ventas CLUSTER BY AUTO;
```

- **Incremental.** OPTIMIZE solo agrupa lo nuevo, no toda la tabla.
- **Flexible.** Las columnas se pueden cambiar en cualquier momento.
- **Sin mantenimiento manual.** En tablas administradas de Unity Catalog, la optimización predictiva lanza el OPTIMIZE sola.
- **Ideal para** columnas de alta cardinalidad, tablas que crecen rápido y patrones de consulta que cambian.
- **Restricción.** No se combina con particionamiento ni con Z-order en la misma tabla.

## V-Order (solo Fabric)

V-Order es una optimización de escritura de Fabric que reorganiza el interior de cada archivo Parquet (orden de filas, codificación y compresión) para que se lea más rápido. Los archivos siguen siendo Parquet estándar, legibles por cualquier motor.

```python
# Activarlo para todo lo que escriba la sesión
spark.conf.set("spark.sql.parquet.vorder.default", "true")
```

```sql
-- Activarlo en una tabla concreta
ALTER TABLE ventas SET TBLPROPERTIES ('delta.parquet.vorder.enabled' = 'true');

-- Aplicarlo a los datos existentes al compactar
OPTIMIZE ventas VORDER;
```

- **Beneficia sobre todo** a Power BI Direct Lake y al SQL analytics endpoint, que leen con motores parecidos a VertiPaq.
- **Coste.** Las escrituras son algo más lentas.
- **Cuándo activarlo.** En tablas de la capa gold o de consumo, leídas por informes. En tablas de ingesta con muchas escrituras puede no compensar.
- **Por defecto.** Depende del perfil de recursos del área de trabajo. En los perfiles orientados a escritura viene desactivado, así que conviene comprobarlo.
- **Combina con** liquid clustering o Z-order, porque actúa dentro de cada archivo y no entre archivos.

## Comparativa

|  | Particionamiento | Z-order | Liquid clustering | V-Order |
| --- | --- | --- | --- | --- |
| Qué organiza | Filas en carpetas | Filas entre archivos | Filas entre archivos | El interior de cada archivo |
| Cómo se aplica | PARTITIONED BY al crear | OPTIMIZE ... ZORDER BY | CLUSTER BY al crear, luego OPTIMIZE | Al escribir (sesión o tabla) |
| Incremental | No aplica | No, reescribe mucho | Sí, solo lo pendiente | Se aplica a lo que se escribe |
| Cambiar columnas | Reescribiendo la tabla | En cada OPTIMIZE, reescribiendo | Sin reescribir lo anterior | No aplica |
| Mejor para | Baja cardinalidad (fecha, país) | Filtros por varias columnas | Alta cardinalidad, tablas que crecen | Direct Lake y SQL endpoint |
| Dónde | Databricks y Fabric | Databricks y Fabric | Databricks (recomendado) y Fabric en runtimes recientes | Solo Fabric |

## Cómo se combinan

- **Liquid clustering es excluyente.** No se usa junto con particionamiento ni con Z-order en la misma tabla.
- **Particionamiento y Z-order sí se combinan.** Particionar por fecha y aplicar Z-order dentro de cada partición era el patrón clásico.
- **V-Order es complementario a todo.** Organiza cada archivo por dentro, así que suma con cualquiera de los otros.

## Cuándo usar cada una

- **Liquid clustering** para tablas nuevas en Databricks, sobre todo si crecen rápido, se filtran por columnas de alta cardinalidad o quieres reducir el mantenimiento al mínimo.
- **Z-order** es la técnica anterior a liquid clustering. Sigue funcionando y tiene sentido en tablas que ya están particionadas, porque liquid clustering no se combina con el particionamiento. Para tablas nuevas en Databricks se recomienda liquid clustering.
- **Particionamiento** solo con columnas de baja cardinalidad, como fecha o país, y en tablas grandes.
- **V-Order** si trabajas en Fabric y la tabla la leen Power BI en Direct Lake o el SQL analytics endpoint. Se suma a cualquiera de las otras tres.

## Errores comunes

- **Particionar por una columna de alta cardinalidad**, como CustomerId. Crea miles de carpetas con archivos diminutos. Para filtrar por ese tipo de columnas está liquid clustering.
- **Meter demasiadas columnas en Z-order.** Cuantas más añades, menos eficaz es con cada una. Lo razonable son de 1 a 4, las más usadas en filtros.
- **Ejecutar Z-order una vez y olvidarse.** No es incremental, así que hay que repetirlo según llegan datos nuevos, y cada vez reescribe gran parte de la tabla.
- **Intentar combinar liquid clustering con particionamiento o con Z-order** en la misma tabla. No se puede.
- **Dar por hecho cómo está V-Order.** Que venga activado o no depende del perfil de recursos del área de trabajo, así que conviene comprobarlo.
- **Activar V-Order en tablas de ingesta con muchas escrituras.** Las escrituras se vuelven algo más lentas y puede no compensar si esas tablas apenas se consultan desde informes.
