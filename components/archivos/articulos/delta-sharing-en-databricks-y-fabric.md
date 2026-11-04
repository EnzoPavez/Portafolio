---
titulo: Delta Sharing en Databricks y Fabric
bajada: El protocolo abierto para compartir datos en vivo con otras organizaciones, sin copiarlos ni mandar archivos.
tema: Gobierno y seguridad
fecha: 2026-10-07
---

## Qué es y qué resuelve

Delta Sharing es un protocolo abierto, creado por Databricks, para compartir datos en vivo con otras organizaciones sin copiarlos. El destinatario lee los datos directamente desde el almacenamiento del proveedor, siempre en su versión actual y en solo lectura.

**El problema que resuelve:** la forma tradicional de compartir datos con un cliente o socio era exportar archivos (CSV, Excel) y enviarlos por SFTP o correo. Eso genera copias que se quedan desactualizadas, duplica el almacenamiento, es difícil de auditar y no se puede revocar una vez enviado.

**Con Delta Sharing:**

- **Sin copias:** el destinatario lee los datos donde están.
- **Siempre actualizado:** ve los cambios en cuanto se confirman.
- **Gobernado:** el proveedor decide qué tablas, particiones o filas se comparten, y puede revocar el acceso en cualquier momento.
- **Auditado:** queda registrado quién accede a qué.
- **Abierto:** el destinatario no necesita Databricks; puede leer desde pandas, Spark, Power BI u otras herramientas compatibles.

**Analogía:** en lugar de fotocopiar un libro y enviárselo a alguien, le das un carné de lector para tu biblioteca, limitado a ciertas estanterías. Siempre lee la edición actual, no puede escribir en los libros y puedes retirarle el carné cuando quieras.

## Los objetos

En Unity Catalog, Delta Sharing se basa en tres objetos:

| Objeto | Qué es | Quién lo crea |
| --- | --- | --- |
| Recurso compartido (share) | El paquete con lo que se comparte: tablas, vistas, volúmenes, modelos, notebooks | El proveedor |
| Destinatario (recipient) | La organización o persona que recibe el acceso | El proveedor |
| Proveedor (provider) | Representa, en el lado del destinatario, a quien comparte | Se crea automáticamente en el destinatario |

**Cómo se relacionan:**

- Un share puede contener muchas tablas, y una tabla puede estar en varios shares.
- Un share se concede a uno o varios destinatarios, y un destinatario puede recibir varios shares.
- Los permisos se dan sobre el share completo: el destinatario ve todo lo que contiene.

En el lado del destinatario (si usa Databricks), el share se monta como un **catálogo** de solo lectura, y a partir de ahí se consulta como cualquier otra tabla y se gobierna con sus propios permisos de Unity Catalog.

**Con la analogía:** el share es la selección de estanterías, el destinatario es la persona con carné, y el proveedor es cómo esa persona ve tu biblioteca desde su lado.

## Modalidades

Hay dos formas de compartir, según qué use el destinatario:

|  | Databricks a Databricks | Uso compartido abierto (open sharing) |
| --- | --- | --- |
| Destinatario | Tiene un área de trabajo de Databricks con Unity Catalog | Cualquiera: pandas, Spark, Power BI, Excel, otras plataformas |
| Autenticación | Por el identificador del metastore del destinatario; sin tokens que gestionar | Archivo de credenciales con un token, o federación OIDC con su proveedor de identidad |
| Qué se puede compartir | Tablas, vistas, volúmenes, modelos de ML, notebooks | Principalmente tablas (y vistas, según el caso) |
| Experiencia del destinatario | El share aparece como un catálogo; se consulta con SQL | Lee con el conector de su herramienta usando las credenciales |
| Cuándo usarla | Socios o filiales que también usan Databricks | Clientes o socios con otras tecnologías |

**Sobre el token del uso abierto:** el proveedor genera un enlace de activación de un solo uso; el destinatario descarga con él un archivo de credenciales. Ese archivo da acceso a todo el share, así que debe guardarse como un secreto, y el token tiene una caducidad que conviene configurar. La federación OIDC evita manejar tokens: el destinatario se autentica con su propio Entra ID u otro proveedor.

## Paso a paso en Databricks

**Lado del proveedor** (hace falta el permiso para crear shares y destinatarios en el metastore):

```sql
-- 1. Crear el recurso compartido
CREATE SHARE ventas_socios COMMENT 'Datos de ventas para socios';

-- 2. Añadir tablas (con alias opcional para no exponer nombres internos)
ALTER SHARE ventas_socios ADD TABLE main.ventas.pedidos AS ventas.pedidos;

-- Compartir solo una parte de la tabla, por partición
ALTER SHARE ventas_socios ADD TABLE main.ventas.clientes
    PARTITION (region = 'norte') AS ventas.clientes_norte;

-- Permitir time travel y lectura de cambios (CDF) al destinatario
ALTER SHARE ventas_socios ADD TABLE main.ventas.stock WITH HISTORY;

-- 3a. Destinatario que usa Databricks: se identifica por su metastore
CREATE RECIPIENT socio_norte USING ID 'azure:westeurope:<id-del-metastore>';

-- 3b. Destinatario sin Databricks: genera un enlace de activación
CREATE RECIPIENT cliente_externo;
DESCRIBE RECIPIENT cliente_externo;

-- 4. Conceder el share al destinatario
GRANT SELECT ON SHARE ventas_socios TO RECIPIENT socio_norte;

-- Revisar quién tiene acceso
SHOW GRANTS ON SHARE ventas_socios;
```

Para compartir filas o columnas concretas, lo habitual es crear una vista con el filtro y compartir la vista en lugar de la tabla.

**Lado del destinatario con Databricks:**

```sql
-- Ver quién comparte y qué
SHOW PROVIDERS;
SHOW SHARES IN PROVIDER proveedor_contoso;

-- Montar el share como un catálogo y consultarlo
CREATE CATALOG datos_contoso USING SHARE proveedor_contoso.ventas_socios;
SELECT * FROM datos_contoso.ventas.pedidos;
```

**Lado del destinatario sin Databricks** (con el archivo de credenciales):

```python
import delta_sharing

# Ruta al archivo de credenciales descargado con el enlace de activación
perfil = "/ruta/config.share"
pedidos = delta_sharing.load_as_pandas(f"{perfil}#ventas_socios.ventas.pedidos")
```

## Seguridad y buenas prácticas

**Lo que garantiza el protocolo:**

- **Solo lectura:** el destinatario nunca puede modificar los datos del proveedor.
- **Acceso temporal:** el destinatario recibe enlaces de corta duración a los archivos, no credenciales del almacenamiento.
- **Revocable:** con REVOKE o borrando el destinatario, el acceso se corta al momento.
- **Auditable:** los accesos quedan en los registros de auditoría de Unity Catalog (tablas del sistema).

```sql
-- Retirar el acceso
REVOKE SELECT ON SHARE ventas_socios FROM RECIPIENT cliente_externo;

-- Renovar el token de un destinatario abierto (el anterior deja de valer tras el plazo indicado)
ALTER RECIPIENT cliente_externo ROTATE TOKEN EXPIRE IN 3600 SECONDS;
```

**Buenas prácticas:**

- **Compartir lo mínimo:** vistas o particiones con solo las filas y columnas necesarias, nunca tablas con datos que el destinatario no debe ver.
- **Alias en los nombres:** no expongas nombres internos de catálogos y esquemas.
- **Un share por propósito o destinatario:** facilita revocar sin afectar a otros.
- **Caducidad de tokens** en el uso abierto, o mejor federación OIDC.
- **Restricción por IP** del destinatario cuando sea posible.
- **WITH HISTORY solo si hace falta:** da acceso también a versiones anteriores, que pueden contener datos ya corregidos o borrados.
- **Coste de salida de datos (egress):** si el destinatario está en otra región o nube, las lecturas generan coste de transferencia para el proveedor. Para volúmenes grandes, valorar réplicas cercanas al destinatario.

## Fabric

Fabric no usa Delta Sharing para compartir sus propios datos, pero tiene equivalentes y se integra con Databricks en ambas direcciones.

**Compartir datos desde Fabric:**

| Necesidad | Opción en Fabric |
| --- | --- |
| Compartir con otra organización que usa Fabric | Uso compartido de datos externo (external data sharing): el destinatario recibe un acceso directo de solo lectura en su lakehouse, sin copia |
| Compartir dentro de la misma organización | Accesos directos (shortcuts) de OneLake entre áreas de trabajo, o compartir el elemento con permisos de lectura |
| Compartir con alguien sin Fabric | Acceso a OneLake mediante su API compatible con ADLS, con los permisos y la seguridad de OneLake |

**Integración con Databricks:**

- **Leer en Fabric datos de Unity Catalog:** el catálogo reflejado de Azure Databricks (mirrored catalog) expone en Fabric las tablas de Unity Catalog sin copiarlas, para usarlas desde el SQL analytics endpoint o Power BI.
- **Recibir un share de Delta Sharing:** Power BI y Dataflow Gen2 tienen conector de Delta Sharing, así que Fabric puede actuar como destinatario de un uso compartido abierto.
- **Leer datos de Fabric desde Databricks:** Databricks puede leer OneLake por su API compatible con ADLS, o mediante accesos directos en el sentido contrario.

**Equivalencias rápidas:**

| Delta Sharing (Databricks) | Fabric |
| --- | --- |
| Share + recipient a otra organización | Uso compartido de datos externo |
| Catálogo montado desde un share | Acceso directo en el lakehouse del destinatario |
| Uso compartido abierto con token | Conector de Delta Sharing como destinatario; acceso por API de OneLake como origen |
| Revocar el acceso | Revocar el uso compartido externo o los permisos del elemento |

Como con Delta Sharing, en el uso compartido externo de Fabric el destinatario lee siempre los datos actuales, en solo lectura, y el proveedor puede revocar el acceso cuando quiera.
