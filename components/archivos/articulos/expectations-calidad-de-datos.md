---
titulo: Expectations y calidad de datos en canalizaciones declarativas
bajada: Reglas de calidad sobre las tablas de una canalización declarativa, y qué pasa con las filas que no las cumplen.
tema: Ingesta y streaming
fecha: 2026-10-06
imagen: imagenes/expectations-calidad-de-datos.jpg
---

## Qué son las expectations

**Canalizaciones declarativas (Lakeflow Spark Declarative Pipelines, antes Delta Live Tables).** En lugar de programar paso a paso cómo cargar cada tabla, declaras qué tablas quieres y de dónde salen. Databricks se encarga del orden, los checkpoints, los reintentos y la infraestructura.

**Expectations.** Son reglas de calidad de datos que se colocan sobre esas tablas. Cada regla tiene tres partes.

| Parte | Ejemplo | Qué es |
| --- | --- | --- |
| Nombre | rule1 o importe\_positivo | Identifica la regla en las métricas |
| Condición | amount > 0 | Lo que debe cumplir cada fila |
| Acción | registrar, descartar o fallar | Qué hacer con las filas que no cumplen |

**Analogía.** Es el control de calidad de una fábrica. Cada pieza pasa por un inspector con una regla ("el peso debe ser mayor que 0"). Según lo estricta que sea la fábrica, el inspector puede anotar el defecto y dejarla pasar, apartar la pieza defectuosa, o parar toda la cadena de producción.

## Las tres acciones

Supongamos que llegan estas filas y la regla es amount > 0.

| id | amount |
| --- | --- |
| 1 | 100 |
| 2 | -5 |
| 3 | 40 |

**1. Registrar (expect).** La fila mala se escribe igualmente. Solo queda anotado en las métricas que 1 fila no cumplió la regla.

- En la tabla quedan las filas 1, 2 y 3.
- Sirve para vigilar la calidad sin bloquear nada, por ejemplo en bronze o al estrenar una regla.

**2. Descartar (expect\_or\_drop).** La fila mala no se escribe y el resto sí.

- En la tabla quedan las filas 1 y 3.
- Sirve cuando una fila incorrecta es inservible y el resto de datos sigue siendo válido, algo típico en silver.

**3. Fallar (expect\_or\_fail).** En cuanto aparece una fila mala, se detiene la actualización y no se confirma nada.

- La tabla queda sin cambios respecto a antes de la ejecución.
- Sirve cuando un dato incorrecto invalida todo el proceso, por ejemplo con cifras financieras o claves obligatorias. Hay que corregir el origen y relanzar.

La tabla siguiente pone las tres acciones lado a lado, con su sintaxis en Python y en SQL.

| Acción | Python | SQL | Fila mala | Actualización |
| --- | --- | --- | --- | --- |
| Registrar | expect | EXPECT (sin ON VIOLATION) | Se escribe | Continúa |
| Descartar | expect\_or\_drop | ON VIOLATION DROP ROW | Se descarta | Continúa |
| Fallar | expect\_or\_fail | ON VIOLATION FAIL UPDATE | Detiene todo | Falla y no se confirma |

## Sintaxis en Python y SQL

**En Python**, las reglas son decoradores encima de la función que define la tabla.

```python
import dlt

# Una regla que detiene la carga si hay importes no positivos
@dlt.table(name="ventas_silver")
@dlt.expect_or_fail("importe_positivo", "amount > 0")
def ventas_silver():
    return spark.readStream.table("ventas_bronze")
```

**Varias reglas a la vez.** Las variantes expect\_all reciben un diccionario con el nombre de cada regla como clave y su condición como valor.

```python
reglas = {
    "importe_positivo": "amount > 0",
    "cliente_informado": "customer_id IS NOT NULL",
    "fecha_valida": "order_date <= current_date()"
}

@dlt.table(name="ventas_silver")
@dlt.expect_all_or_drop(reglas)
def ventas_silver():
    return spark.readStream.table("ventas_bronze")
```

También se pueden apilar decoradores con acciones distintas. Por ejemplo, descartar filas sin cliente y fallar si hay importes negativos.

**En SQL**, las reglas son restricciones (CONSTRAINT) en la definición de la tabla.

```sql
CREATE OR REFRESH STREAMING TABLE ventas_silver (
    CONSTRAINT importe_positivo EXPECT (amount > 0) ON VIOLATION FAIL UPDATE,
    CONSTRAINT cliente_informado EXPECT (customer_id IS NOT NULL) ON VIOLATION DROP ROW,
    CONSTRAINT fecha_valida EXPECT (order_date <= current_date())
)
AS SELECT * FROM STREAM(ventas_bronze);
```

La última regla, sin ON VIOLATION, solo registra.

En versiones recientes, el módulo de Python puede importarse como from pyspark import pipelines as dp, con decoradores equivalentes (@dp.expect...). El módulo dlt sigue funcionando y es el que se usa en los ejemplos de este artículo.

## Dónde ver los resultados

**En la interfaz de la canalización.** Al seleccionar una tabla en el gráfico de la canalización, la pestaña de calidad de datos muestra cada regla con cuántas filas la cumplieron y cuántas no.

**En el registro de eventos (event log).** Cada canalización guarda un registro con todo lo que ocurre, incluidas las métricas de cada expectation. Se puede consultar con SQL para construir paneles o alertas de calidad.

```sql
-- Métricas de calidad de las últimas actualizaciones
SELECT
    timestamp,
    details:flow_progress.data_quality.expectations AS expectations
FROM event_log(TABLE(main.ventas.ventas_silver))
WHERE event_type = 'flow_progress'
  AND details:flow_progress.data_quality IS NOT NULL
ORDER BY timestamp DESC;
```

Cada entrada indica el nombre de la regla, la tabla y el número de filas que la pasaron y que fallaron.

**Cuando la acción es fallar.** La actualización aparece como fallida y el mensaje de error indica qué regla se infringió y un ejemplo de la fila que la provocó.

## Qué acción usar en cada capa

La acción que conviene depende de la capa de la arquitectura medallón en la que esté la tabla.

| Capa | Acción habitual | Motivo |
| --- | --- | --- |
| Bronze | Registrar | Guardar todo lo que llega tal cual y medir su calidad |
| Silver | Descartar (y poner en cuarentena) | Limpiar los datos sin parar la carga |
| Gold | Fallar en reglas críticas | Un dato incorrecto en un informe financiero es peor que no actualizar |

## Tabla de cuarentena

Descartar tiene un problema. Las filas descartadas desaparecen y no queda rastro de cuáles eran, solo cuántas. Para no perderlas se usa una **tabla de cuarentena**, de modo que las filas buenas van a una tabla y las malas a otra para revisarlas. La cuarentena se define con la condición invertida, es decir, se queda con las filas que no cumplen alguna de las reglas.

```python
reglas = {
    "importe_positivo": "amount > 0",
    "cliente_informado": "customer_id IS NOT NULL"
}
# Condición que cumple una fila válida: todas las reglas a la vez
fila_valida = " AND ".join(f"({c})" for c in reglas.values())

@dlt.table(name="ventas_silver")
@dlt.expect_all_or_drop(reglas)
def ventas_silver():
    return spark.readStream.table("ventas_bronze")

# Las filas que no cumplen alguna regla se guardan aparte para revisarlas
@dlt.table(name="ventas_cuarentena")
def ventas_cuarentena():
    return spark.readStream.table("ventas_bronze").where(f"NOT ({fila_valida})")
```

## Buenas prácticas

- Usa nombres de regla descriptivos (importe\_positivo mejor que rule1), porque aparecen en las métricas y en los errores.
- Estrena cada regla nueva en modo registrar unos días antes de endurecerla, para ver cuántas filas afectaría.
- Reserva fallar para reglas realmente críticas. Una regla demasiado estricta puede parar la canalización a menudo.
- Guarda las reglas en un diccionario o tabla central para reutilizarlas en varias canalizaciones.

## Cómo hacerlo en Fabric

En Fabric no existen las canalizaciones declarativas ni las expectations como tal. Hay tres alternativas.

- **Restricciones en materialized lake views.** Al definir una vista materializada del lakehouse en Spark SQL se pueden añadir reglas con CONSTRAINT ... CHECK (...) ON MISMATCH DROP o FAIL, que equivalen a descartar o fallar.
- **Restricciones CHECK de Delta.** Funcionan en cualquier tabla Delta (también en Databricks). Cualquier escritura que las incumpla falla por completo, como expect\_or\_fail.
- **Validaciones propias en notebooks.** Consisten en separar filas válidas y no válidas con filtros, escribir las malas en una tabla de cuarentena y registrar los recuentos en una tabla de control.

```sql
-- Restricción Delta: rechaza cualquier escritura con importes no positivos
ALTER TABLE ventas ADD CONSTRAINT importe_positivo CHECK (amount > 0);
```

```sql
-- Materialized lake view en Fabric que descarta filas no válidas
CREATE MATERIALIZED LAKE VIEW silver.ventas_limpias (
    CONSTRAINT importe_positivo CHECK (amount > 0) ON MISMATCH DROP
)
AS SELECT * FROM bronze.ventas;
```

## Expectations frente a otras validaciones

Los cuatro mecanismos aplican reglas de calidad a los datos que se escriben en una tabla, pero cambian en dónde funcionan y en lo que hacen con las filas que no las cumplen.

| Mecanismo | Dónde funciona | Filas que no cumplen |
| --- | --- | --- |
| Expectations | Canalizaciones declarativas de Databricks | Se registran, se descartan o detienen la actualización |
| Restricciones de materialized lake views | Vistas materializadas del lakehouse en Fabric | Se descartan (ON MISMATCH DROP) o detienen la actualización (ON MISMATCH FAIL) |
| Restricciones CHECK de Delta | Cualquier tabla Delta, en Databricks y en Fabric | La escritura entera falla |
| Validaciones en notebooks | Cualquier notebook de Spark | Lo que programes, por ejemplo llevarlas a una tabla de cuarentena |

De los tres mecanismos declarativos, solo las expectations permiten registrar la fila mala y dejarla pasar. Las restricciones descartan o fallan.

La diferencia entre expect\_or\_fail y una restricción CHECK de Delta está en el alcance. La expectation forma parte de la definición de la tabla dentro de la canalización, mientras que la restricción CHECK pertenece a la tabla y se aplica a cualquier escritura que reciba. Además, la expectation deja sus métricas en la interfaz de la canalización y en el event log.

## Resumen

| Si necesitas | Usa |
| --- | --- |
| Impedir que se confirme la actualización | expect\_or\_fail (en SQL, ON VIOLATION FAIL UPDATE) |
| Eliminar las filas malas y seguir | expect\_or\_drop (en SQL, ON VIOLATION DROP ROW) |
| Solo medir o supervisar la calidad sin afectar a los datos | expect |
| Aplicar varias reglas a la vez | Las variantes expect\_all, que reciben un diccionario de reglas |
| Conservar las filas malas para revisarlas | Una tabla de cuarentena con la condición invertida |
| Ver las métricas de calidad | La interfaz de la canalización y el event log |
| Validar fuera de una canalización declarativa | Restricciones CHECK de Delta, restricciones de materialized lake views o validaciones propias en notebooks |
