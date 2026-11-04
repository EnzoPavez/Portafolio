---
titulo: Propiedades de tabla Delta
bajada: Los ajustes que se guardan con la propia tabla, en qué se diferencian de la configuración de Spark y cuáles conviene conocer.
tema: Delta Lake
fecha: 2026-10-03
---

## Qué son

Las propiedades de tabla Delta son ajustes que se guardan con la propia tabla y controlan su comportamiento: retención del historial, forma de aplicar cambios, compactación o archivado. Se definen con TBLPROPERTIES y empiezan por delta.

No hay que confundirlas con las configuraciones de Spark:

|  | Propiedad de tabla | Configuración de Spark |
| --- | --- | --- |
| Dónde vive | En la tabla | En la sesión o el clúster |
| Duración | Permanente, la lea quien la lea | Hasta que se cierra la sesión |
| Cómo se define | TBLPROPERTIES | SET o spark.conf.set |
| Ejemplo | delta.deletedFileRetentionDuration | spark.databricks.delta.retentionDurationCheck.enabled |

Caso mixto: las configuraciones spark.databricks.delta.properties.defaults.\* son de sesión, pero hacen que las tablas nuevas nazcan con esa propiedad ya puesta.

## Cómo se usan

Cuatro comandos cubren todo el manejo de propiedades.

```sql
-- Ver las propiedades de una tabla
SHOW TBLPROPERTIES mi_tabla;

-- Definirlas al crear la tabla
CREATE TABLE mi_tabla (id INT, nombre STRING)
TBLPROPERTIES ('delta.enableDeletionVectors' = true);

-- Cambiarlas en una tabla existente
ALTER TABLE mi_tabla SET TBLPROPERTIES ('delta.logRetentionDuration' = 'interval 60 days');

-- Quitarlas y volver al valor por defecto
ALTER TABLE mi_tabla UNSET TBLPROPERTIES ('delta.logRetentionDuration');
```

Para que todas las tablas nuevas de una sesión nazcan con una propiedad:

```python
spark.conf.set("spark.databricks.delta.properties.defaults.enableDeletionVectors", "true")
```

## Retención

Dos propiedades deciden cuánto tiempo puedes volver atrás en el tiempo y cuándo se libera espacio.

### delta.logRetentionDuration

- **Para qué sirve:** cuánto tiempo se guarda el historial de versiones (el registro de transacciones).
- **Por defecto:** 30 días.
- **Qué afecta:** hasta dónde llegan el time travel y DESCRIBE HISTORY. Las entradas antiguas se borran solas en cada checkpoint.
- **Ejemplo:** 'interval 60 days'.

### delta.deletedFileRetentionDuration

- **Para qué sirve:** cuánto tiempo se conservan los archivos de datos que la tabla ya no usa antes de que VACUUM pueda borrarlos.
- **Por defecto:** 7 días.
- **Qué afecta:** el time travel real (sin esos archivos no se pueden leer versiones antiguas) y el espacio ocupado.
- **Ejemplo:** 'interval 30 days'.

**Cómo trabajan juntas:** para consultar una versión antigua hacen falta el historial (el registro de qué archivos la formaban) y los propios archivos. Por eso, si necesitas auditar 30 días atrás, ambas deben cubrir al menos 30 días. La regla práctica es que deletedFileRetentionDuration sea igual o menor que logRetentionDuration.

```sql
-- Conservar 30 días de historial y de archivos para auditoría
ALTER TABLE clientes SET TBLPROPERTIES (
    'delta.logRetentionDuration' = 'interval 30 days',
    'delta.deletedFileRetentionDuration' = 'interval 30 days'
);
```

## Rendimiento

Una acelera las escrituras con cambios pequeños y la otra mantiene rápidas las lecturas evitando archivos pequeños.

### delta.enableDeletionVectors

- **Para qué sirve:** que UPDATE, DELETE y MERGE marquen filas como no válidas en lugar de reescribir archivos completos.
- **Valor:** true o false.
- **Cuándo usarla:** tablas con muchos cambios pequeños y frecuentes, como correcciones o bajas por cumplimiento normativo.
- **A tener en cuenta:** las filas marcadas siguen físicamente en el archivo hasta un OPTIMIZE o REORG seguido de VACUUM.

### delta.autoOptimize.autoCompact

- **Para qué sirve:** tras cada escritura, Delta comprueba si se han acumulado muchos archivos pequeños y, si es así, los junta en archivos más grandes.
- **Valor:** true, false o auto.
- **Cuándo usarla:** tablas que reciben muchas escrituras pequeñas, como streaming o cargas cada pocos minutos.
- **A tener en cuenta:** es un OPTIMIZE ligero y automático; no sustituye a liquid clustering ni a Z-order.

## Almacenamiento

### delta.timeUntilArchived

- **Para qué sirve:** avisa a Databricks de que una directiva de ciclo de vida de Azure Storage mueve los archivos antiguos al nivel Archive (muy barato, pero no legible al instante). Así las consultas evitan esos archivos en lugar de fallar.
- **Ejemplo:** '180 days', si la directiva de almacenamiento archiva a los 180 días.
- **A tener en cuenta:** no mueve ni borra nada por sí misma. El archivado lo hace Azure; la propiedad solo informa a Databricks.

## Resumen

| Propiedad | Categoría | Qué controla | Por defecto |
| --- | --- | --- | --- |
| delta.logRetentionDuration | Retención | Cuánto historial de versiones se guarda | 30 días |
| delta.deletedFileRetentionDuration | Retención | Cuánto se guardan los archivos no usados antes del VACUUM | 7 días |
| delta.enableDeletionVectors | Rendimiento de escritura | Marcar filas en vez de reescribir archivos | Según runtime y configuración |
| delta.autoOptimize.autoCompact | Rendimiento de lectura | Compactar automáticamente archivos pequeños | Según runtime y configuración |
| delta.timeUntilArchived | Coste de almacenamiento | Evitar archivos movidos al nivel Archive | Sin valor |

**En Fabric:** las tablas del lakehouse son Delta, así que estas propiedades se definen igual desde un notebook con Spark. La diferencia es que no hay optimización predictiva: el OPTIMIZE y el VACUUM se lanzan desde el lakehouse (Maintenance), un notebook o un pipeline. Fabric añade además V-Order, una optimización de escritura propia para mejorar las lecturas de Direct Lake y del SQL endpoint.
