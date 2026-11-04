---
titulo: Runtime 2.0 en Fabric: guía práctica
bajada: Diez cambios de Runtime 2.0 (Spark 4.1 y Delta 4.2) para aprovechar en notebooks y SQL de Fabric, cada uno con sus pasos y código.
tema: Rendimiento
fecha: 2026-10-02
---

Diez cambios para aprovechar Runtime 2.0 (Spark 4.1, Delta 4.2) en notebooks y SQL de Fabric, cada uno con sus pasos y código. Antes de migrar, conviene probar los notebooks en un environment aparte: el modo ANSI de Spark 4 hace fallar casts inválidos y divisiones por cero que antes devolvían NULL.

## Resumen

| Punto | Qué cambia | Beneficio | Dónde usarlo |
| --- | --- | --- | --- |
| 1. Native Execution Engine | Activar el motor nativo en el environment | Consultas más rápidas y menos CU, sin tocar código | Todas las capas |
| 2. Reducir UDFs de Python | Sustituirlas por funciones nativas o UDFs de SQL | Transformaciones más rápidas y lógica centralizada | Todas las capas |
| 3. Resource profile | `readHeavyForPBI` y V-Order en gold | Power BI lee las tablas más rápido | Gold (bronze y silver con `writeHeavy`) |
| 4. Collation | `COLLATE UTF8_LCASE` en lugar de `lower()` | Comparaciones de texto más limpias | Filtros y joins; no guardar en tablas |
| 5. VARIANT | Analizar JSON sin esquema fijo | Ingestas que no se rompen si cambia el origen | Silver; no guardar VARIANT en tablas |
| 6. Variables de sesión | `DECLARE` y `SET VAR` en SQL | Notebooks parametrizables sin f-strings | Cargas incrementales |
| 7. Pipe syntax | Consultas encadenadas con `\|>` | SQL largo más legible y fácil de depurar | Transformaciones largas |
| 8. Gráficos con `df.plot` | Gráficos sin `toPandas()` | Explorar y validar sin saturar el driver | Desarrollo y validación |
| 9. Liquid Clustering | `CLUSTER BY` en lugar de particionado o Z-order | Menos ficheros leídos, mantenimiento barato | Tablas grandes, incluida gold |
| 10. Python Data Source | Conectores propios para APIs | Ingestas en paralelo y reutilizables | Bronze desde APIs |

## Punto 1: Native Execution Engine

El motor nativo ejecuta las consultas de Spark en C++ vectorizado (Velox + Apache Gluten), sin cambios de código y sin coste adicional. Cuando una operación no está soportada, vuelve sola al Spark clásico (fallback). No acelera Structured Streaming ni la lectura de JSON y XML.

### Paso 1: activarlo

**Opción A: en el environment (recomendada para producción)**

1. Abrir el item Environment (mejor uno nuevo solo para pruebas, para no afectar a otros notebooks).
2. En Ejecución, seleccionar el runtime **2.0 (Spark 4.1, Delta 4.2)**.
3. Ir a Computación Spark > **Aceleración** y marcar **Habilitar el motor de ejecución nativo**.
4. Pulsar **Guardar** y después **Publicar**. Sin publicar no se aplica nada.
5. En el notebook, seleccionar ese environment en el desplegable de entorno de la barra superior.

**Opción B: solo en un notebook concreto** (primera celda del notebook)

```python
%%configure
{
    "conf": {
        "spark.native.enabled": "true"
    }
}
```

### Paso 2: comprobar que se está usando

```python
from pyspark.sql import functions as F

# Primero confirmamos que la sesión tiene el motor activado
print(spark.conf.get("spark.native.enabled"))

df = spark.read.table("ventas")

resumen = (
    df.filter(F.col("anio") == 2026)
      .groupBy("region")
      .agg(F.sum("importe").alias("total"))
)

# Plan físico: aquí se ve qué parte ejecuta el motor nativo
resumen.explain()
```

Qué buscar:

- El `print` devuelve `true`.
- En el plan, nodos que terminan en **Transformer** (`ProjectExecTransformer`, `HashAggregateTransformer`...) o que contienen **NativeFileScan** o **VeloxColumnarToRowExec**: esa parte la ejecuta el motor nativo.
- Nodos normales (`HashAggregate`, `Filter`) sin ese sufijo: esa parte ha hecho fallback.

Sin código también se ve en los avisos del Spark Advisor debajo de la celda, y en la Spark UI, pestaña **Gluten SQL / DataFrame** (nodos en verde = nativo, azul claro = JVM).

### Paso 3: comparar tiempos con y sin el motor

```python
import time
from pyspark.sql import functions as F

def medir(consulta, nativo, repeticiones=3):
    spark.conf.set("spark.native.enabled", str(nativo).lower())
    tiempos = []

    for _ in range(repeticiones):
        inicio = time.perf_counter()
        # "noop" obliga a calcular todo el resultado sin escribirlo en ningún sitio
        consulta.write.format("noop").mode("overwrite").save()
        tiempos.append(time.perf_counter() - inicio)

    # La primera ejecución suele ser más lenta por arranque, nos quedamos con la mejor
    return min(tiempos)


df = spark.read.table("ventas")

consulta = (
    df.filter(F.col("anio") == 2026)
      .groupBy("region")
      .agg(F.sum("importe").alias("total"))
)

t_clasico = medir(consulta, nativo=False)
t_nativo = medir(consulta, nativo=True)

print(f"Spark clásico: {t_clasico:.2f} s")
print(f"Motor nativo:  {t_nativo:.2f} s")
print(f"Mejora:        {t_clasico / t_nativo:.1f}x")
```

Para que la comparación sea justa: usar una tabla grande (millones de filas) y una consulta parecida a las reales. El código deja el motor activado al terminar.

**Resultado:** menos tiempo de ejecución, y por tanto menos consumo de CU, sin tocar el código existente.

## Punto 2: reducir las UDFs de Python

Una UDF (User Defined Function) es una función propia que se registra para aplicarla sobre columnas cuando Spark no trae una función que haga lo que necesitas. El motor nativo ya soporta UDFs de Python, pero siguen siendo lentas: los datos salen del motor, se envían a un proceso de Python y vuelven, y el optimizador no puede ver qué hacen por dentro.

Tipos habituales:

- **UDF de Python**: la más común en notebooks.
- **Pandas UDF**: procesa por bloques con pandas, más rápida que la anterior.
- **UDF de SQL**: novedad de Spark 4, se ejecuta dentro del motor.

### Paso 1: localizar UDFs y sustituirlas por funciones nativas

Buscar en los notebooks `@udf`, `F.udf(`, `@pandas_udf` y `spark.udf.register`. Las de limpieza de texto, condiciones, fechas o redondeos casi siempre se pueden reescribir con `pyspark.sql.functions`.

**Antes: UDF de Python**

```python
from pyspark.sql import functions as F
from pyspark.sql.types import StringType
import re

# Limpia el código de producto: quita símbolos, espacios y lo pasa a mayúsculas
@F.udf(StringType())
def limpiar_codigo(codigo):
    if codigo is None:
        return None
    return re.sub(r"[^A-Za-z0-9]", "", codigo).strip().upper()

df = df.withColumn("codigo_limpio", limpiar_codigo("codigo"))
```

**Después: funciones nativas**

```python
from pyspark.sql import functions as F

df = df.withColumn(
    "codigo_limpio",
    F.upper(F.trim(F.regexp_replace("codigo", r"[^A-Za-z0-9]", "")))
)
```

**Otro ejemplo: clasificación con condiciones**

```python
# En lugar de una UDF con if/else, usamos when/otherwise
df = df.withColumn(
    "segmento",
    F.when(F.col("importe_total").isNull(), "Sin datos")
     .when(F.col("importe_total") >= 1000, "Premium")
     .otherwise("Estándar")
)
```

Mismo resultado, los nulos se gestionan solos y todo se queda dentro del motor.

### Paso 2: lógica reutilizable como UDF de SQL

Cuando la misma transformación se repite en varios notebooks, se puede guardar como función SQL y usarla en cualquier celda `%%sql` o en `spark.sql()`.

```sql
%%sql
-- Función reutilizable para limpiar códigos de producto
CREATE OR REPLACE FUNCTION limpiar_codigo(codigo STRING)
RETURNS STRING
RETURN upper(trim(regexp_replace(codigo, '[^A-Za-z0-9]', '')))
```

```sql
%%sql
SELECT codigo, limpiar_codigo(codigo) AS codigo_limpio
FROM silver_productos
```

**Resultado:** transformaciones más rápidas y lógica de negocio centralizada sin pasar por Python.

## Punto 3: resource profile según la capa

Un resource profile es un conjunto de configuraciones de Spark predefinido que cambia sobre todo cómo se escriben los ficheros Delta. Por eso importa en el notebook que escribe la tabla, no en el que la lee. Los workspaces nuevos usan `writeHeavy`, que desactiva V-Order.

| Perfil | Pensado para | Qué hace |
| --- | --- | --- |
| `writeHeavy` | Ingesta y ETL (bronze, silver) | Sin V-Order, ficheros de 128 MB, escritura rápida |
| `readHeavyForPBI` | Tablas que lee Power BI (gold) | V-Order, optimize write, ficheros de 1 GB |
| `readHeavyForSpark` | Tablas que se leen mucho desde Spark | Optimize write, ficheros de 128 MB |
| `custom` | Configuración propia | Lo que definas |

- **V-Order**: optimización de Fabric que ordena y comprime los Parquet para que Power BI (Direct Lake) y el SQL endpoint lean más rápido. Escribir tarda algo más.
- **Optimize write**: genera menos ficheros y más grandes al escribir.
- **Bin size**: tamaño objetivo de esos ficheros.

### Paso 1: revisar con qué configuración escribe el notebook

```python
# Revisamos con qué configuración se están escribiendo las tablas
print("Perfil:  ", spark.conf.get("spark.fabric.resourceProfile", "no definido"))
print("V-Order: ", spark.conf.get("spark.sql.parquet.vorder.default", "no definido"))

# En writeHeavy esta propiedad no tiene valor, por eso la leemos aparte
try:
    optimize_write = spark.conf.get("spark.databricks.delta.optimizeWrite.enabled")
except Exception:
    optimize_write = "sin valor (no forzado)"

print("Optimize write:", optimize_write)
```

Resultado en el notebook de gold revisado: perfil `writeHeavy`, V-Order `false`, optimize write `None`. Correcto para bronze y silver; mejorable para gold que consume Power BI.

### Paso 2: aplicar `readHeavyForPBI` en el notebook de gold

Primera celda del notebook, antes de cualquier escritura:

```python
# Las tablas de esta capa las lee Power BI, así que priorizamos la lectura
spark.conf.set("spark.fabric.resourceProfile", "readHeavyForPBI")

print("Perfil:  ", spark.conf.get("spark.fabric.resourceProfile"))
print("V-Order: ", spark.conf.get("spark.sql.parquet.vorder.default"))
```

Debe devolver `readHeavyForPBI` y `true`. A tener en cuenta:

- Solo afecta a lo que se escribe desde ese momento; los ficheros existentes siguen igual (se resuelve en el paso 3).
- La escritura será algo más lenta a cambio de lecturas más rápidas en Power BI.
- Con varios notebooks de gold, se puede fijar en un environment propio de gold con `spark.fabric.resourceProfile = readHeavyForPBI`. Si se define en los dos sitios, manda el notebook.

### Paso 3: comprobar la tabla y aplicar V-Order a los datos existentes

```sql
%%sql
-- Cuántos ficheros tiene y cuánto ocupa antes de optimizar
DESCRIBE DETAIL gold_ventas
```

```sql
%%sql
-- Reorganiza los ficheros actuales: los compacta y les aplica V-Order
OPTIMIZE gold_ventas VORDER
```

```sql
%%sql
-- Así la tabla se escribe siempre con V-Order, aunque el notebook use otro perfil
ALTER TABLE gold_ventas SET TBLPROPERTIES ('delta.parquet.vorder.enabled' = 'true')
```

- El `OPTIMIZE` reescribe la tabla y consume capacidad: en tablas grandes, mejor fuera de horario.
- Los ficheros antiguos se mantienen para el historial hasta que se ejecute un `VACUUM`.
- Al repetir el `DESCRIBE DETAIL`, `numFiles` debería bajar y `properties` mostrar `delta.parquet.vorder.enabled -> true`.
- La prueba final: comparar en Power BI el tiempo de carga de los visuales con el Analizador de rendimiento.

**Resultado:** las tablas de gold quedan optimizadas para Power BI, ahora y en las escrituras futuras.

## Punto 4: collation en lugar de lower()

Una collation es la regla que define cómo se comparan y ordenan los textos. Spark 4 permite indicarla en la consulta, en lugar de llenar filtros y joins de `lower()` y `upper()`. Se usa en las consultas, no en la definición de columnas: guardar una collation en una tabla Delta puede impedir que el SQL endpoint o Power BI la lean.

| Collation | Mayúsculas | Tildes | Uso típico |
| --- | --- | --- | --- |
| `UTF8_BINARY` | Distingue | Distingue | La de siempre (por defecto) |
| `UTF8_LCASE` | No distingue | Distingue | Sustituir `lower()`. La más eficiente |
| `UNICODE_CI` | No distingue | Distingue | Ordenación correcta según Unicode |
| `UNICODE_CI_AI` | No distingue | No distingue | Nombres y direcciones con tildes inconsistentes |

### Paso 1: probar cómo funcionan

```sql
%%sql
-- Comparamos el mismo texto con distintas reglas
SELECT
    'Enzo' = 'enzo'                          AS binaria,
    'Enzo' COLLATE UTF8_LCASE = 'enzo'       AS sin_mayusculas,
    'José' COLLATE UTF8_LCASE = 'jose'       AS sin_mayusculas_con_tilde,
    'José' COLLATE UNICODE_CI_AI = 'jose'    AS sin_mayusculas_ni_tildes
```

Resultado esperado: `false`, `true`, `false`, `true`.

### Paso 2: sustituir lower() en filtros, joins y agrupaciones

**Filtros**

```sql
%%sql
-- Antes
SELECT * FROM silver_clientes WHERE lower(provincia) = 'salamanca';

-- Después
SELECT * FROM silver_clientes WHERE provincia COLLATE UTF8_LCASE = 'salamanca';

-- También con IN y LIKE
SELECT *
FROM silver_clientes
WHERE provincia COLLATE UTF8_LCASE IN ('salamanca', 'madrid')
   OR nombre COLLATE UTF8_LCASE LIKE 'enzo%';
```

**Joins**

```sql
%%sql
-- Antes
SELECT c.id_cliente, u.id_usuario
FROM silver_clientes c
JOIN silver_usuarios u
  ON lower(trim(c.email)) = lower(trim(u.email));

-- Después
SELECT c.id_cliente, u.id_usuario
FROM silver_clientes c
JOIN silver_usuarios u
  ON trim(c.email) COLLATE UTF8_LCASE = trim(u.email);
```

Basta con la collation en un lado. El `trim()` sigue haciendo falta: la collation no afecta a los espacios.

**PySpark**

```python
from pyspark.sql import functions as F

# Filtro sin distinguir mayúsculas
df_salamanca = clientes.filter(
    F.collate(F.col("provincia"), "UTF8_LCASE") == "salamanca"
)

# Join por email sin distinguir mayúsculas
cruce = clientes.join(
    usuarios,
    F.collate(F.trim(clientes.email), "UTF8_LCASE") == F.trim(usuarios.email)
)
```

**Agrupaciones (con cuidado)**

```sql
%%sql
-- "Madrid", "MADRID" y "madrid" cuentan como el mismo grupo
SELECT
    provincia COLLATE UTF8_LCASE AS provincia,
    count(*) AS clientes
FROM silver_clientes
GROUP BY provincia COLLATE UTF8_LCASE;
```

- El texto del resultado es uno cualquiera de los valores del grupo, no uno normalizado. Para informes, mejor `initcap()` o `upper()`.
- La columna resultante conserva la collation: si se guarda en una tabla Delta, la collation va con ella.

Regla práctica: en filtros y joins, collation sin miedo; en agrupaciones o columnas que se van a guardar, normalizar el texto o quitar la collation antes de escribir.

### Paso 3: detectar y evitar columnas guardadas con collation

**Comprobar una tabla existente**

```sql
%%sql
-- Las columnas con collation aparecen como "string collate ..."
DESCRIBE TABLE gold_clientes
```

En `DESCRIBE DETAIL gold_clientes`, una entrada relacionada con collations en `tableFeatures` indica que la tabla activó esa funcionalidad del protocolo Delta.

**Revisar el DataFrame antes de escribir**

```python
from pyspark.sql import functions as F

def quitar_collation(df):
    # Devuelve las columnas de texto con collation a la comparación binaria de siempre
    for campo in df.schema.fields:
        tipo = campo.dataType.simpleString()
        if tipo.startswith("string collate") and "UTF8_BINARY" not in tipo:
            print(f"Columna con collation: {campo.name} ({tipo})")
            df = df.withColumn(campo.name, F.collate(F.col(campo.name), "UTF8_BINARY"))
    return df


resultado = quitar_collation(resultado)
resultado.write.mode("overwrite").saveAsTable("gold_clientes")
```

**Corregir una tabla que ya la tiene**

```sql
%%sql
-- Reescribimos la tabla con la columna en su comparación binaria
CREATE OR REPLACE TABLE gold_clientes AS
SELECT
    * EXCEPT (provincia),
    provincia COLLATE UTF8_BINARY AS provincia
FROM gold_clientes
```

La columna pasa al final y la funcionalidad puede seguir figurando en `tableFeatures`. Si la tabla la consume Power BI y sigue apareciendo, lo más limpio es crear una tabla nueva y apuntar el modelo a ella.

**Resultado:** comparaciones de texto más limpias y sin `lower()` repartidos por el código, sin romper la compatibilidad de las tablas de gold.

## Punto 5: VARIANT para datos JSON

VARIANT es un tipo de dato que acepta cualquier estructura JSON sin definir esquema y la guarda ya analizada en formato binario, así que leer un campo es mucho más rápido que buscarlo en un texto. Se usa para procesar en Spark; las tablas que lee Power BI o el SQL endpoint deben tener los campos ya extraídos en columnas normales, porque guardar VARIANT en Delta activa una funcionalidad nueva del protocolo.

| Función | Para qué sirve |
| --- | --- |
| `parse_json(texto)` | Convierte un texto JSON en VARIANT |
| `try_parse_json(texto)` | Igual, pero devuelve NULL si el JSON no es válido |
| `variant_get(v, ruta, tipo)` | Extrae un campo y lo convierte al tipo indicado |
| `try_variant_get(v, ruta, tipo)` | Igual, pero devuelve NULL si el tipo no encaja |
| `schema_of_variant(v)` | Muestra la estructura de un registro |
| `schema_of_variant_agg(v)` | Estructura combinada de todos los registros |
| `variant_explode(v)` | Una fila por cada elemento de una lista u objeto |

### Paso 1: probar cómo funciona

```sql
%%sql
-- Simulamos la respuesta de una API con un pedido
SELECT
    variant_get(v, '$.pedido.id', 'int')            AS id_pedido,
    variant_get(v, '$.pedido.total', 'double')      AS total,
    variant_get(v, '$.cliente.nombre', 'string')    AS cliente,
    variant_get(v, '$.cliente.telefono', 'string')  AS telefono,
    try_variant_get(v, '$.cliente.nombre', 'int')   AS nombre_como_numero,
    schema_of_variant(v)                            AS estructura
FROM (
    SELECT parse_json('{"pedido": {"id": 101, "total": 59.9}, "cliente": {"nombre": "Enzo"}}') AS v
)
```

- `telefono` sale NULL porque el campo no existe, sin que la consulta falle.
- `nombre_como_numero` sale NULL porque el tipo no encaja; con `variant_get` y el modo ANSI daría error.

### Paso 2: ingesta real de bronze a silver

Bronze guarda el JSON como texto y silver lo analiza con VARIANT y guarda columnas normales. Así no se guarda VARIANT en ninguna tabla.

**Bronze: JSON en bruto**

```python
from pyspark.sql import functions as F

# Leemos cada línea del fichero como texto, sin interpretar nada todavía
raw = spark.read.text("Files/raw/pedidos/")

bronze = (
    raw.withColumnRenamed("value", "json_original")
       .withColumn("fecha_ingesta", F.current_timestamp())
       .withColumn("fichero_origen", F.col("_metadata.file_path"))
)

bronze.write.mode("append").saveAsTable("bronze_pedidos")
```

**Silver: campos extraídos con su tipo**

```sql
%%sql
-- Analizamos el JSON una sola vez y sacamos cada campo con su tipo
CREATE OR REPLACE TABLE silver_pedidos AS
SELECT
    try_variant_get(v, '$.pedido.id', 'int')              AS id_pedido,
    try_variant_get(v, '$.pedido.fecha', 'date')          AS fecha_pedido,
    try_variant_get(v, '$.pedido.total', 'decimal(12,2)') AS total,
    try_variant_get(v, '$.cliente.id', 'int')             AS id_cliente,
    try_variant_get(v, '$.cliente.email', 'string')       AS email_cliente,
    fecha_ingesta
FROM (
    SELECT try_parse_json(json_original) AS v, fecha_ingesta
    FROM bronze_pedidos
)
WHERE v IS NOT NULL
```

**Listas dentro del JSON (líneas del pedido)**

```sql
%%sql
-- Una fila por cada línea del pedido
CREATE OR REPLACE TABLE silver_pedidos_lineas AS
SELECT
    try_variant_get(p.v, '$.pedido.id', 'int')             AS id_pedido,
    l.pos + 1                                              AS num_linea,
    try_variant_get(l.value, '$.producto', 'string')       AS producto,
    try_variant_get(l.value, '$.cantidad', 'int')          AS cantidad,
    try_variant_get(l.value, '$.precio', 'decimal(12,2)')  AS precio
FROM (
    SELECT try_parse_json(json_original) AS v
    FROM bronze_pedidos
) p,
LATERAL variant_explode(variant_get(p.v, '$.lineas', 'variant')) l
WHERE p.v IS NOT NULL
```

Antes de adaptarlo, ver las rutas reales del JSON:

```sql
%%sql
SELECT schema_of_variant(try_parse_json(json_original)) AS estructura
FROM bronze_pedidos
LIMIT 5
```

### Paso 3: detectar cambios en la estructura del JSON

Con `try_variant_get`, un campo renombrado en el origen no rompe la carga: llena la columna de NULL sin avisar. Este control lo detecta.

**Vista rápida**

```sql
%%sql
-- Estructura combinada de todo lo que llegó en la última carga
SELECT schema_of_variant_agg(try_parse_json(json_original)) AS estructura
FROM bronze_pedidos
WHERE fecha_ingesta = (SELECT max(fecha_ingesta) FROM bronze_pedidos)
```

**Control automático**

```python
# Campos que extrae el notebook de silver, agrupados por bloque del JSON
campos_esperados = {
    "$.pedido": {"id", "fecha", "total", "lineas"},
    "$.cliente": {"id", "email"},
}

cambios = []

for ruta, esperados in campos_esperados.items():
    recibidos = {
        fila.key
        for fila in spark.sql(f"""
            SELECT DISTINCT e.key
            FROM (
                SELECT try_parse_json(json_original) AS v
                FROM bronze_pedidos
                WHERE fecha_ingesta = (SELECT max(fecha_ingesta) FROM bronze_pedidos)
            ) b,
            LATERAL variant_explode(variant_get(b.v, '{ruta}', 'variant')) e
        """).collect()
    }

    nuevos = recibidos - esperados
    desaparecidos = esperados - recibidos

    if nuevos:
        cambios.append(f"{ruta}: campos nuevos {sorted(nuevos)}")
    if desaparecidos:
        cambios.append(f"{ruta}: campos que ya no llegan {sorted(desaparecidos)}")

if cambios:
    print("La estructura del JSON ha cambiado:")
    for cambio in cambios:
        print(" -", cambio)
else:
    print("Estructura sin cambios")
```

- **Campos nuevos:** información que no se está guardando; puede interesar añadirla a silver.
- **Campos que ya no llegan:** esa columna de silver se llenará de NULL; suele ser un campo renombrado o eliminado.

**Parar la carga si falta un campo**

```python
# Un campo que deja de llegar vacía columnas de silver, así que paramos la carga
if any("ya no llegan" in c for c in cambios):
    raise Exception("Faltan campos esperados en el JSON. Revisar antes de cargar silver.")
```

Desde un pipeline de Fabric, el error hace fallar la actividad y permite configurar una alerta en esa rama.

**Resultado:** ingestas de JSON que no se rompen cuando cambia el origen, con tablas de silver en columnas normales y un aviso cuando la estructura cambia.

## Punto 6: variables de sesión

Las variables de sesión permiten declarar un valor en SQL y reutilizarlo en las consultas siguientes, sin construir la consulta en Python con f-strings. Duran lo que dura la sesión de Spark, así que una variable declarada en una celda `%%sql` sigue disponible en las siguientes.

| Instrucción | Para qué sirve |
| --- | --- |
| `DECLARE VARIABLE nombre tipo DEFAULT valor` | Crea la variable con un valor inicial |
| `DECLARE OR REPLACE VARIABLE ...` | La crea o la sustituye si ya existe |
| `SET VAR nombre = valor` | Cambia su valor |
| `SET VAR nombre = (SELECT ...)` | Le asigna el resultado de una consulta |
| `DROP TEMPORARY VARIABLE nombre` | La elimina |

### Paso 1: probar cómo funcionan

Cada bloque en una celda distinta, para comprobar que la variable se mantiene entre celdas:

```sql
%%sql
-- Declaramos la fecha de carga: por defecto, ayer
DECLARE OR REPLACE VARIABLE v_fecha_carga DATE DEFAULT current_date() - 1;

SELECT v_fecha_carga;
```

```sql
%%sql
-- En otra celda, la variable sigue disponible
SELECT
    v_fecha_carga                    AS fecha,
    date_format(v_fecha_carga, 'MM') AS mes,
    year(v_fecha_carga)              AS anio;
```

```sql
%%sql
-- Cambiamos el valor y volvemos a consultarla
SET VAR v_fecha_carga = DATE'2026-09-15';

SELECT v_fecha_carga;
```

También se le puede asignar un valor calculado a partir de los datos:

```sql
%%sql
DECLARE OR REPLACE VARIABLE v_ultima_fecha DATE;

SET VAR v_ultima_fecha = (SELECT max(fecha) FROM silver_ventas);

SELECT v_ultima_fecha;
```

### Paso 2: carga incremental y notebook parametrizado desde un pipeline

El notebook carga solo lo nuevo desde la última ejecución, pero el pipeline puede indicarle una fecha para reprocesar.

**Celda 1: parámetro del pipeline (Python)**

```python
# Vacío = carga incremental normal. Con fecha = reprocesar desde ese día
fecha_desde = ""
```

Marcarla como celda de parámetros (menú de la celda > Alternar celda de parámetros).

**Celda 2: decidir desde dónde cargar (SQL)**

```sql
%%sql
-- Por defecto cargamos lo que haya entrado después de la última ingesta procesada
DECLARE OR REPLACE VARIABLE v_cargar_desde TIMESTAMP;

SET VAR v_cargar_desde = (
    SELECT coalesce(max(fecha_ingesta), TIMESTAMP'1900-01-01')
    FROM silver_pedidos
);
```

**Celda 3: si llega una fecha desde el pipeline, manda esa (Python)**

```python
# El valor viaja como parámetro, sin concatenarlo dentro de la consulta
if fecha_desde:
    spark.sql(
        "SET VAR v_cargar_desde = CAST(:fecha AS TIMESTAMP)",
        args={"fecha": fecha_desde}
    )

spark.sql("SELECT v_cargar_desde").show()
```

**Celda 4: carga incremental (SQL)**

```sql
%%sql
-- Solo procesamos lo que ha entrado en bronze desde la fecha calculada
MERGE INTO silver_pedidos AS destino
USING (
    SELECT
        try_variant_get(v, '$.pedido.id', 'int')              AS id_pedido,
        try_variant_get(v, '$.pedido.fecha', 'date')          AS fecha_pedido,
        try_variant_get(v, '$.pedido.total', 'decimal(12,2)') AS total,
        try_variant_get(v, '$.cliente.id', 'int')             AS id_cliente,
        try_variant_get(v, '$.cliente.email', 'string')       AS email_cliente,
        fecha_ingesta
    FROM (
        SELECT try_parse_json(json_original) AS v, fecha_ingesta
        FROM bronze_pedidos
        WHERE fecha_ingesta > v_cargar_desde
    )
    WHERE v IS NOT NULL
) AS origen
ON destino.id_pedido = origen.id_pedido
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
```

`MERGE` requiere que `silver_pedidos` ya exista (creada en el punto 5).

**Configuración en el pipeline**

Actividad Notebook > Configuración > Parámetros base:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `fecha_desde` | String | Vacío para la carga diaria, o una fecha como `2026-09-01` para reprocesar |

- **Carga diaria:** `fecha_desde` vacío, se cargan solo los registros nuevos.
- **Reproceso:** con una fecha, se reprocesa desde ese día sin duplicar gracias al `MERGE`.
- **Primera ejecución:** silver vacía, `coalesce` devuelve 1900 y se carga todo bronze.

### Paso 3: buenas prácticas

**Prefijo para no chocar con columnas.** Si una variable y una columna se llaman igual, Spark usa la columna sin avisar. Usar el prefijo `v_` en todas las variables, o calificar con `session.`:

```sql
%%sql
SELECT count(*) FROM bronze_pedidos WHERE fecha_ingesta >= session.fecha_ingesta;
```

**Declarar al principio del notebook con `OR REPLACE`.** Permite relanzar celdas sin errores y no depender de variables de otros notebooks o ejecuciones anteriores.

**Registrar con qué valores se ejecutó cada carga**

```sql
%%sql
-- Tabla de registro de ejecuciones, se crea una sola vez
CREATE TABLE IF NOT EXISTS control_cargas (
    tabla           STRING,
    cargar_desde    TIMESTAMP,
    filas_origen    BIGINT,
    fecha_ejecucion TIMESTAMP
)
```

```sql
%%sql
-- Al terminar la carga, guardamos con qué valores se ejecutó
INSERT INTO control_cargas
SELECT
    'silver_pedidos',
    v_cargar_desde,
    (SELECT count(*) FROM bronze_pedidos WHERE fecha_ingesta > v_cargar_desde),
    current_timestamp()
```

**Limpiar al final en notebooks largos**

```sql
%%sql
DROP TEMPORARY VARIABLE IF EXISTS v_cargar_desde;
```

**Resultado:** notebooks parametrizables y cargas incrementales escritas en SQL, sin f-strings y con un registro de cada ejecución.

## Punto 7: pipe syntax

La pipe syntax permite escribir una consulta en el mismo orden en que se ejecuta: se parte de la tabla y se encadenan pasos con `|>`, sin subconsultas ni CTEs intermedios. No cambia el rendimiento (Spark genera el mismo plan), solo mejora la legibilidad, y se puede mezclar con SQL clásico.

| Operador | Qué hace | Equivalente clásico |
| --- | --- | --- |
| `FROM tabla` | Punto de partida | `FROM` |
| `\|> WHERE` | Filtra filas en cualquier punto | `WHERE` o `HAVING` |
| `\|> EXTEND` | Añade columnas manteniendo las demás | `SELECT *, expr AS col` |
| `\|> SET` | Modifica una columna existente | `SELECT` reescribiendo la columna |
| `\|> DROP` | Quita columnas | `SELECT` con todas menos esas |
| `\|> AGGREGATE ... GROUP BY` | Agrupa y agrega | `SELECT ... GROUP BY` |
| `\|> JOIN` | Une con otra tabla | `JOIN` |
| `\|> SELECT` | Elige las columnas finales | `SELECT` |
| `\|> ORDER BY` / `\|> LIMIT` | Ordena y limita | Igual |

### Paso 1: la misma consulta de las dos formas

Forma clásica:

```sql
%%sql
SELECT
    region,
    sum(importe_con_iva) AS total
FROM (
    SELECT region, importe * 1.21 AS importe_con_iva
    FROM silver_ventas
    WHERE anio = 2026
)
GROUP BY region
HAVING sum(importe_con_iva) > 10000
ORDER BY total DESC
```

Con pipe syntax:

```sql
%%sql
FROM silver_ventas
|> WHERE anio = 2026
|> EXTEND importe * 1.21 AS importe_con_iva
|> AGGREGATE sum(importe_con_iva) AS total GROUP BY region
|> WHERE total > 10000
|> ORDER BY total DESC
```

Se lee de arriba abajo, el `WHERE` tras agregar sustituye al `HAVING`, y `EXTEND` añade la columna sin repetir las demás.

### Paso 2: caso real con joins y transformaciones encadenadas

Ventas mensuales por cliente, con segmento y ranking del mes.

**Forma clásica con CTEs**

```sql
%%sql
WITH pedidos_2026 AS (
    SELECT id_cliente, fecha_pedido, total
    FROM silver_pedidos
    WHERE year(fecha_pedido) = 2026
),
con_cliente AS (
    SELECT
        p.id_cliente,
        c.nombre,
        c.provincia,
        date_trunc('MONTH', p.fecha_pedido) AS mes,
        p.total
    FROM pedidos_2026 p
    JOIN silver_clientes c ON p.id_cliente = c.id_cliente
),
agregado AS (
    SELECT
        mes, id_cliente, nombre, provincia,
        sum(total) AS total_mes,
        count(*)   AS num_pedidos
    FROM con_cliente
    GROUP BY mes, id_cliente, nombre, provincia
)
SELECT
    *,
    CASE WHEN total_mes >= 1000 THEN 'Premium' ELSE 'Estándar' END AS segmento,
    rank() OVER (PARTITION BY mes ORDER BY total_mes DESC)        AS ranking_mes
FROM agregado
WHERE num_pedidos >= 2
ORDER BY mes, ranking_mes
```

**Con pipe syntax**

```sql
%%sql
FROM silver_pedidos AS p
|> WHERE year(p.fecha_pedido) = 2026
|> JOIN silver_clientes AS c ON p.id_cliente = c.id_cliente
|> EXTEND date_trunc('MONTH', p.fecha_pedido) AS mes
|> AGGREGATE
       sum(p.total) AS total_mes,
       count(*)     AS num_pedidos
   GROUP BY mes, p.id_cliente, c.nombre, c.provincia
|> WHERE num_pedidos >= 2
|> EXTEND
       CASE WHEN total_mes >= 1000 THEN 'Premium' ELSE 'Estándar' END AS segmento,
       rank() OVER (PARTITION BY mes ORDER BY total_mes DESC)        AS ranking_mes
|> ORDER BY mes, ranking_mes
```

**Depurar paso a paso:** basta con cortar la consulta en el punto que se quiere revisar.

```sql
%%sql
FROM silver_pedidos AS p
|> WHERE year(p.fecha_pedido) = 2026
|> JOIN silver_clientes AS c ON p.id_cliente = c.id_cliente
|> LIMIT 20
```

**Guardar el resultado en una tabla**

```sql
%%sql
CREATE OR REPLACE TABLE gold_ventas_mensuales_cliente AS
FROM silver_pedidos AS p
|> WHERE year(p.fecha_pedido) = 2026
|> JOIN silver_clientes AS c ON p.id_cliente = c.id_cliente
|> EXTEND date_trunc('MONTH', p.fecha_pedido) AS mes
|> AGGREGATE
       sum(p.total) AS total_mes,
       count(*)     AS num_pedidos
   GROUP BY mes, p.id_cliente, c.nombre, c.provincia
|> WHERE num_pedidos >= 2
|> EXTEND
       CASE WHEN total_mes >= 1000 THEN 'Premium' ELSE 'Estándar' END AS segmento,
       rank() OVER (PARTITION BY mes ORDER BY total_mes DESC)        AS ranking_mes
```

- **Usarla en:** transformaciones largas, consultas que se depuran a menudo, notebooks nuevos.
- **No hace falta en:** consultas cortas o código existente que funciona; no mejora el rendimiento.
- **Equipo:** acordarlo si otras personas mantienen los notebooks, porque es una sintaxis nueva.

**Resultado:** transformaciones SQL largas más fáciles de leer, mantener y depurar.

## Punto 8: gráficos rápidos sin pasar a pandas

Spark 4 añade `df.plot` sobre los DataFrames de PySpark, con Plotly por debajo (gráficos interactivos). Evita `toPandas()`, que trae todos los datos al driver. Los histogramas y box plots se calculan en Spark de forma distribuida; para barras, líneas o tarta solo se usa un número limitado de filas, así que hay que agregar antes de dibujar. Es para explorar mientras se desarrolla; los informes siguen siendo cosa de Power BI.

| Quiero comprobar... | Gráfico |
| --- | --- |
| Si una métrica evoluciona como se espera | `plot.line` |
| Si las cargas llegan todos los días | `plot.bar` por fecha de ingesta |
| Cómo se reparten los valores de una columna | `plot.hist` |
| Si hay valores atípicos | `plot.box` |
| Qué categorías pesan más | `plot.bar` o `plot.barh` |
| Relación entre dos variables numéricas | `plot.scatter` |

### Paso 1: probar cómo funciona

```python
# Datos de ejemplo: ventas por mes
datos = [
    ("2026-01", 12500), ("2026-02", 13800), ("2026-03", 11200),
    ("2026-04", 15600), ("2026-05", 16900), ("2026-06", 18300),
]
df = spark.createDataFrame(datos, ["mes", "ventas"])

# Gráfico de líneas directamente sobre el DataFrame de Spark
df.plot.line(x="mes", y="ventas")
```

```python
df.plot.bar(x="mes", y="ventas")
```

### Paso 2: explorar y validar una tabla real

**Evolución de ventas por mes**

```python
from pyspark.sql import functions as F

pedidos = spark.read.table("silver_pedidos")

# Agrupamos en Spark y solo dibujamos el resultado, que son pocas filas
ventas_mes = (
    pedidos.groupBy(F.date_format("fecha_pedido", "yyyy-MM").alias("mes"))
           .agg(F.sum("total").alias("ventas"))
           .orderBy("mes")
)

fig = ventas_mes.plot.line(x="mes", y="ventas")
fig.update_layout(title="Ventas por mes")
fig
```

**Validar que las cargas llegan bien**

```python
# Cuántas filas entraron en bronze en cada carga
cargas = (
    spark.read.table("bronze_pedidos")
         .groupBy(F.to_date("fecha_ingesta").alias("dia"))
         .count()
         .orderBy("dia")
)

cargas.plot.bar(x="dia", y="count")
```

**Distribución de importes**

```python
# El histograma se calcula en Spark sobre todas las filas, no sobre una muestra
pedidos.select("total").plot.hist(column="total", bins=30)
```

**Valores atípicos**

```python
pedidos.select("total").plot.box(column="total")
```

```python
# Revisamos los pedidos con importes fuera de lo normal
limite = pedidos.approxQuantile("total", [0.99], 0.01)[0]
pedidos.filter(F.col("total") > limite).orderBy(F.desc("total")).show(20)
```

**Comparar categorías**

```python
top_provincias = (
    spark.read.table("silver_pedidos").alias("p")
         .join(spark.read.table("silver_clientes").alias("c"), "id_cliente")
         .groupBy("c.provincia")
         .agg(F.sum("p.total").alias("ventas"))
         .orderBy(F.desc("ventas"))
         .limit(10)
)

top_provincias.plot.barh(x="ventas", y="provincia")
```

**Resultado:** exploración y validación visual de tablas grandes sin riesgo de saturar el driver.

## Punto 9: Liquid Clustering

Liquid Clustering agrupa los datos por las columnas elegidas para que Spark, el SQL endpoint y Power BI lean solo los ficheros necesarios. Sustituye al particionado y al Z-order (no se combina con ellos), y a diferencia de VARIANT o collations está soportado fuera de Spark, así que se puede usar en gold.

|  | Particionado | Z-order | Liquid Clustering |
| --- | --- | --- | --- |
| Cómo organiza | Una carpeta por valor | Reordena dentro de los ficheros | Agrupa por columnas de forma incremental |
| Cuándo se aplica | Al escribir | `OPTIMIZE ... ZORDER BY` | `OPTIMIZE` |
| Coste de mantenimiento | Ninguno, pero rígido | Reescribe toda la tabla | Solo lo no agrupado |
| Cambiar columnas | Recrear la tabla | Otro `OPTIMIZE` completo | `ALTER TABLE ... CLUSTER BY` |
| Problema típico | Miles de ficheros pequeños | Caro en tablas grandes | Necesita `OPTIMIZE` periódico |

| Experiencia de Fabric | Liquid Clustering |
| --- | --- |
| Spark Runtime 2.0 y 1.3 | Lectura y escritura |
| SQL analytics endpoint | Sí |
| Power BI Direct Lake | Sí |
| Dataflows Gen2 y pipelines | Solo lectura |
| Spark Runtime 1.2 y 1.1 | Solo lectura |
| Notebooks de Python (no PySpark) | No |

Aviso relacionado con Runtime 2.0: las tablas que crea usan deletion vectors por defecto (protocolo 3/7). Power BI y el SQL endpoint las leen, pero los notebooks de Python puro (`deltalake`, Polars) no.

### Paso 1: probar cómo funciona

```sql
%%sql
-- Tabla de prueba agrupada por fecha y provincia
CREATE OR REPLACE TABLE prueba_clustering (
    id_pedido     INT,
    fecha_pedido  DATE,
    provincia     STRING,
    total         DECIMAL(12,2)
)
CLUSTER BY (fecha_pedido, provincia);

INSERT INTO prueba_clustering VALUES
    (1, DATE'2026-09-01', 'Salamanca', 120.50),
    (2, DATE'2026-09-01', 'Madrid',     89.90),
    (3, DATE'2026-09-02', 'Salamanca', 45.00);
```

```sql
%%sql
-- En clusteringColumns deben aparecer las dos columnas elegidas
DESCRIBE DETAIL prueba_clustering
```

### Paso 2: elegir las columnas y migrar una tabla existente

- Las columnas por las que más se filtra (en notebooks y en filtros de Power BI), normalmente una fecha y una o dos dimensiones.
- Máximo 4 columnas; con 1 o 2 bien elegidas suele bastar.
- La cardinalidad no es problema, al contrario que con el particionado.
- Deben estar entre las primeras 32 columnas, que son las que tienen estadísticas por defecto.

```sql
%%sql
-- partitionColumns y clusteringColumns indican cómo está organizada
DESCRIBE DETAIL gold_ventas
```

**Caso A: tabla sin particionar (con o sin Z-order)**

```sql
%%sql
-- Activamos el clustering en la tabla actual
ALTER TABLE gold_ventas CLUSTER BY (fecha, id_tienda);
```

```sql
%%sql
-- Reorganizamos todos los datos existentes según las nuevas columnas
OPTIMIZE gold_ventas FULL;
```

El `OPTIMIZE FULL` reescribe toda la tabla una sola vez; después basta con `OPTIMIZE` normal.

**Caso B: tabla particionada (hay que recrearla)**

```sql
%%sql
-- Creamos una copia de la tabla ya organizada con clustering
CREATE OR REPLACE TABLE gold_ventas_nueva
CLUSTER BY (fecha, id_tienda)
AS SELECT * FROM gold_ventas;
```

```sql
%%sql
SELECT
    (SELECT count(*) FROM gold_ventas)       AS filas_original,
    (SELECT count(*) FROM gold_ventas_nueva) AS filas_nueva
```

```sql
%%sql
-- Guardamos la antigua por si hay que volver atrás y ponemos la nueva en su lugar
ALTER TABLE gold_ventas RENAME TO gold_ventas_old;
ALTER TABLE gold_ventas_nueva RENAME TO gold_ventas;
```

Cuando todo esté comprobado: `DROP TABLE gold_ventas_old`.

**Adaptar el notebook que carga la tabla**

```python
# Antes
df.write.mode("overwrite").partitionBy("anio", "mes").saveAsTable("gold_ventas")

# Después: sustituimos los datos sin tocar la definición de la tabla.
# insertInto inserta por posición, así que ordenamos las columnas como la tabla
columnas = spark.table("gold_ventas").columns
df.select(columnas).write.mode("overwrite").insertInto("gold_ventas")
```

### Paso 3: mantenimiento y comprobación

| Volumen de carga | Frecuencia de OPTIMIZE |
| --- | --- |
| Cargas diarias moderadas | Una vez al día, tras la carga |
| Varias cargas al día | Una o dos veces al día |
| Tablas que apenas cambian | Semanal |

```python
# Tablas con clustering que mantenemos después de cada carga
tablas = ["gold_ventas", "gold_ventas_mensuales_cliente"]

for tabla in tablas:
    print(f"Optimizando {tabla}...")
    spark.sql(f"OPTIMIZE {tabla}")
```

Sin código: en el lakehouse, clic derecho sobre la tabla > Mantenimiento.

**Qué ha hecho cada OPTIMIZE**

```sql
%%sql
-- Historial de operaciones: cuántos ficheros se quitaron y cuántos se crearon
SELECT
    timestamp,
    operation,
    operationMetrics.numRemovedFiles AS ficheros_quitados,
    operationMetrics.numAddedFiles   AS ficheros_nuevos
FROM (DESCRIBE HISTORY gold_ventas)
WHERE operation = 'OPTIMIZE'
ORDER BY timestamp DESC
```

**Comprobar que las consultas leen menos ficheros**

```sql
%%sql
SELECT numFiles FROM (DESCRIBE DETAIL gold_ventas)
```

```sql
%%sql
-- Cuántos ficheros contienen datos de ese filtro
SELECT count(DISTINCT _metadata.file_path) AS ficheros_con_datos
FROM gold_ventas
WHERE fecha = DATE'2026-09-15' AND id_tienda = 12
```

Si la tabla tiene cientos de ficheros y los datos del filtro están en unos pocos, el clustering funciona. La cifra exacta de ficheros leídos está en la Spark UI, pestaña SQL / DataFrame, nodo de lectura de la tabla.

**Resultado:** tablas organizadas para leer menos datos en Spark, el SQL endpoint y Power BI, con un mantenimiento barato e incremental.

## Punto 10: Python Data Source para ingestas desde APIs

La Python Data Source API permite escribir un conector propio en Python y usarlo como un formato nativo (`spark.read.format("mi_api")`). Si el conector divide el trabajo en particiones, Spark las ejecuta en paralelo en los ejecutores en lugar de hacerlo todo en el driver. Compensa para APIs que se usan en varios notebooks o con mucho volumen; para una llamada puntual con pocos datos, `requests` en el driver sigue siendo lo más sencillo.

| Pieza | Qué hace |
| --- | --- |
| Clase `DataSource` | Define el nombre del formato, el esquema y el lector |
| Clase `DataSourceReader` | Contiene la lógica de lectura |
| `partitions()` | Divide el trabajo en partes que Spark reparte entre ejecutores |
| `read(partition)` | Devuelve las filas de una parte con `yield` |
| `spark.dataSource.register(...)` | Registra el conector en la sesión |

### Paso 1: probar la estructura con datos fijos

```python
from pyspark.sql.datasource import DataSource, DataSourceReader


class FuentePrueba(DataSource):
    # Nombre con el que se usará en spark.read.format(...)
    @classmethod
    def name(cls):
        return "fuente_prueba"

    def schema(self):
        return "id INT, producto STRING, cantidad INT"

    def reader(self, schema):
        return LectorPrueba(self.options)


class LectorPrueba(DataSourceReader):
    def __init__(self, options):
        # Las opciones que se pasan con .option(...) llegan aquí como diccionario
        self.filas = int(options.get("filas", 3))

    def read(self, partition):
        for i in range(1, self.filas + 1):
            yield (i, f"Producto {i}", i * 10)


spark.dataSource.register(FuentePrueba)

df = spark.read.format("fuente_prueba").option("filas", 5).load()
df.show()
```

### Paso 2: conector real con paginación y reintentos

Supuesto: la API devuelve los pedidos de un día paginados, con la forma `{ "datos": [...], "hay_mas": true }`. El conector crea una partición por día (descargados en paralelo), recorre las páginas de cada día y devuelve cada registro como JSON en texto, para encajar con el patrón bronze/silver del punto 5. La sesión HTTP reintenta sola hasta 5 veces ante errores 429 y 5xx, con esperas crecientes y respetando la cabecera `Retry-After`.

Guardar este código en un notebook propio, por ejemplo `nb_conector_api_pedidos`:

```python
from datetime import date, timedelta
from pyspark.sql.datasource import DataSource, DataSourceReader, InputPartition


def crear_sesion(token):
    # Sesión HTTP que reintenta sola ante errores temporales de la API
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    reintentos = Retry(
        total=5,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        respect_retry_after_header=True,
    )

    sesion = requests.Session()
    sesion.mount("https://", HTTPAdapter(max_retries=reintentos))
    sesion.headers.update({"Authorization": f"Bearer {token}"})
    return sesion


class ParticionDia(InputPartition):
    # Cada partición representa un día que se descarga por separado
    def __init__(self, dia):
        self.dia = dia


class ApiPedidos(DataSource):
    @classmethod
    def name(cls):
        return "api_pedidos"

    def schema(self):
        return "fecha STRING, json_original STRING"

    def reader(self, schema):
        return LectorApiPedidos(self.options)


class LectorApiPedidos(DataSourceReader):
    def __init__(self, options):
        self.url = options["url"]
        self.token = options["token"]
        self.desde = date.fromisoformat(options["desde"])
        self.hasta = date.fromisoformat(options.get("hasta", str(date.today())))

    def partitions(self):
        # Un día por partición, para que Spark los descargue en paralelo
        dias = (self.hasta - self.desde).days + 1
        return [ParticionDia(str(self.desde + timedelta(days=i))) for i in range(dias)]

    def read(self, partition):
        import json

        sesion = crear_sesion(self.token)
        pagina = 1

        while True:
            respuesta = sesion.get(
                self.url,
                params={"fecha": partition.dia, "pagina": pagina},
                timeout=60,
            )
            respuesta.raise_for_status()
            contenido = respuesta.json()

            for registro in contenido["datos"]:
                yield (partition.dia, json.dumps(registro))

            if not contenido.get("hay_mas"):
                break
            pagina += 1


spark.dataSource.register(ApiPedidos)
```

### Paso 3: usarlo desde cualquier notebook

```python
%run nb_conector_api_pedidos
```

```python
from pyspark.sql import functions as F

# El token se guarda en Key Vault, nunca escrito en el notebook
token = notebookutils.credentials.getSecret(
    "https://mi-keyvault.vault.azure.net/", "token-api-pedidos"
)

pedidos = (
    spark.read.format("api_pedidos")
         .option("url", "https://api.ejemplo.com/pedidos")
         .option("token", token)
         .option("desde", "2026-09-01")
         .option("hasta", "2026-09-30")
         .load()
)

(
    pedidos.withColumn("fecha_ingesta", F.current_timestamp())
           .write.mode("append")
           .saveAsTable("bronze_pedidos_api")
)
```

A partir de aquí, el notebook de silver del punto 5 funciona igual sobre `json_original`.

- **Límites de la API:** muchas particiones en paralelo pueden provocar errores 429; reducir el rango por carga o agrupar varios días por partición.
- **Registro por sesión:** `spark.dataSource.register` solo vale para la sesión actual; el `%run` lo resuelve en cada notebook.
- **Uso por todo el equipo:** empaquetar el conector como librería `.whl` y subirla al environment en Bibliotecas > Personalizado.
- **Token como opción:** puede aparecer en planes o logs de la Spark UI; si la API lo permite, mejor que el lector obtenga el token por sí mismo.

**Resultado:** ingestas desde APIs en paralelo, resistentes a fallos puntuales y reutilizables con un simple `spark.read.format(...)`.

## Fuentes

- [Runtime 2.0 en Fabric](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime-2-0)
- [Native execution engine for Fabric Data Engineering](https://learn.microsoft.com/en-us/fabric/data-engineering/native-execution-engine-overview)
- [Configure resource profile configurations](https://learn.microsoft.com/en-us/fabric/data-engineering/configure-resource-profile-configurations)
- [Delta Lake table format interoperability](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-interoperability)
