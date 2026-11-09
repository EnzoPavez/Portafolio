---
titulo: ABAC, el control de acceso basado en atributos
bajada: Cómo dar acceso a los datos según sus etiquetas en vez de tabla por tabla, y en qué se diferencia de RBAC.
tema: Gobierno y seguridad
fecha: 2026-10-06
imagen: imagenes/abac-control-de-acceso.jpg
---

## Qué es ABAC

ABAC (Attribute-Based Access Control) decide quién accede a qué según atributos de los datos, en lugar de dar permisos objeto por objeto. Etiquetas los datos (por ejemplo, sensibilidad = alta o contiene = PII) y defines reglas que se aplican a todo lo que tenga esa etiqueta.

## ABAC frente a RBAC

|  | RBAC (basado en roles) | ABAC (basado en atributos) |
| --- | --- | --- |
| La regla dice | "El grupo Ventas puede leer la tabla clientes" | "Nadie fuera del grupo RRHH ve datos etiquetados como PII" |
| Se aplica a | Un objeto concreto | Cualquier objeto con la etiqueta, ahora o en el futuro |
| Tabla nueva | Hay que dar permisos de nuevo | Basta con etiquetarla |
| Escala | Mal con cientos de tablas | Bien, pocas reglas cubren todo |

**Analogía.** RBAC es entregar una llave por cada puerta. ABAC es pintar de rojo las puertas restringidas y poner una norma general que dice "solo el personal autorizado entra en las puertas rojas". Si construyes una puerta nueva, la pintas de rojo y la norma ya la protege.

No son excluyentes. Lo normal es usar RBAC para el acceso básico (quién puede usar un catálogo o un esquema) y ABAC para proteger datos sensibles de forma transversal.

## Cómo funciona en Unity Catalog

El ABAC de Unity Catalog tiene dos piezas que trabajan juntas.

**1. Etiquetas gobernadas (governed tags), el atributo**

- Se definen a nivel de cuenta, con una lista de valores permitidos (por ejemplo, la etiqueta sensibilidad con los valores baja, media y alta).
- Se controla quién puede asignarlas, para que nadie invente o quite etiquetas a su antojo.
- Se asignan a catálogos, esquemas, tablas o columnas.

**2. Directivas de acceso (policies), la regla**

- Se adjuntan a un nivel de la jerarquía, que puede ser un catálogo, un esquema o una tabla.
- Se aplican a todos los objetos por debajo de ese nivel que tengan la etiqueta indicada.
- Pueden filtrar filas, enmascarar columnas o conceder privilegios, según el tipo.
- Se evalúan en el momento de la consulta. Si mañana etiquetas otra tabla, queda protegida al instante.

El flujo completo tiene cuatro pasos.

1. Un administrador crea la etiqueta gobernada.
2. Los responsables de datos etiquetan tablas o columnas sensibles.
3. Se crea una directiva en el catálogo o esquema que actúa sobre esa etiqueta.
4. Cada consulta aplica la directiva automáticamente, desde notebooks, SQL o herramientas de BI.

## Ejemplo práctico

El objetivo es que solo el grupo rrhh vea los emails de clientes, en esta tabla y en cualquier otra que se etiquete igual.

```sql
-- Función que decide qué ve cada usuario
CREATE FUNCTION catalog1.schema1.mask_email(email STRING)
RETURN CASE
    WHEN is_account_group_member('rrhh') THEN email
    ELSE '***'
END;

-- Etiquetamos la columna sensible con la etiqueta gobernada
ALTER TABLE catalog1.schema1.table1
ALTER COLUMN email SET TAGS ('pii' = 'email');

-- Directiva en el esquema: enmascara toda columna etiquetada como email
CREATE POLICY ocultar_emails
ON SCHEMA catalog1.schema1
COLUMN MASK catalog1.schema1.mask_email
TO `account users` EXCEPT `rrhh`
FOR TABLES
MATCH COLUMNS has_tag_value('pii', 'email') AS col
ON COLUMN col;
```

Con esto, un usuario fuera de rrhh que consulte table1 ve \*\*\* en la columna email. Si mañana se crea table2 con otra columna etiquetada pii = email, queda protegida sin tocar la directiva.

La sintaxis exacta de CREATE POLICY ha ido evolucionando, así que antes de usarla revisa la documentación vigente. Lo que no cambia es la idea, que se apoya en tres piezas (la función, la etiqueta y la directiva).

## ABAC frente a otros controles de Unity Catalog

Antes de ABAC, la seguridad fina se hacía tabla a tabla. Esos mecanismos siguen existiendo y conviene distinguirlos.

| Mecanismo | Cómo funciona | Alcance | Mantenimiento |
| --- | --- | --- | --- |
| GRANT / REVOKE | Permiso sobre un objeto para un usuario o grupo | Un objeto | Uno por objeto |
| Vista dinámica | Vista con lógica que filtra o enmascara según el usuario | Una vista | Una vista por tabla; los usuarios deben consultar la vista, no la tabla |
| Filtro de fila / máscara de columna | Función asignada directamente a una tabla o columna | Una tabla | Hay que asignarla tabla por tabla |
| ABAC (etiqueta + directiva) | Directiva que actúa sobre todo lo etiquetado | Catálogo o esquema entero | Una directiva cubre muchas tablas |

La diferencia clave es que los tres primeros se basan en el objeto y ABAC se basa en la etiqueta. Por eso escala mejor cuando hay muchas tablas con datos sensibles.

## Cuándo conviene usar ABAC

ABAC encaja cuando la regla de acceso depende de qué tipo de dato es y no de en qué tabla está. Hay algunas señales claras.

- Tienes muchas tablas con datos sensibles y no quieres mantener permisos uno por uno.
- Las tablas que se creen en el futuro deben quedar protegidas sin que nadie tenga que acordarse de configurarlas.
- Quieres gestionar la seguridad de forma centralizada, con pocas reglas para todo un catálogo o esquema.
- La regla se expresa según la clasificación de los datos (PII, confidencial, sensibilidad alta).

Para el acceso básico, como quién puede usar un catálogo o un esquema, sigue bastando con RBAC. Y si solo hay una o dos tablas sensibles, un filtro de fila o una máscara de columna asignados directamente también resuelven el caso. La ventaja de ABAC crece con el número de tablas.

## ABAC en Fabric

Fabric no tiene un ABAC nativo equivalente al de Unity Catalog. En la práctica se consigue algo parecido combinando identidad, roles y directivas de Purview.

**OneLake security (RBAC fino).** Es la pieza principal de seguridad de datos en Fabric. Alcanzó disponibilidad general en mayo de 2026 y permite controlar el acceso a nivel de elemento, carpeta, tabla, fila y columna, aplicándose igual desde Spark, SQL y Power BI. Pero es basado en roles. Defines roles con usuarios y las tablas o filas que pueden ver, no reglas sobre etiquetas.

Hay algunos detalles de OneLake security que conviene tener presentes.

- Los roles de área de trabajo Admin, Member y Contributor se saltan los roles de OneLake security. Para restringir datos, los usuarios deben ser Viewer.
- Si un usuario está en varios roles, gana el más permisivo.
- Los accesos directos (shortcuts) heredan la seguridad de su origen.
- Para que el SQL analytics endpoint la respete, debe funcionar en modo de identidad del usuario.

**Lo más parecido a ABAC son las etiquetas de sensibilidad de Purview.** Las etiquetas de sensibilidad de Microsoft Purview (Confidencial, Altamente confidencial...) se asignan a elementos de Fabric, y las directivas de protección de Purview restringen el acceso a los elementos con una etiqueta concreta. La idea es la misma (etiqueta + regla), pero actúa a nivel de elemento (un lakehouse, un modelo semántico), no de columna.

La tabla resume las equivalencias entre las dos plataformas.

| Unity Catalog | Fabric |
| --- | --- |
| GRANT sobre tablas | Roles de OneLake security |
| Filtros de fila y máscaras de columna | RLS y CLS en OneLake security o en el SQL endpoint; enmascaramiento dinámico en Warehouse |
| Etiqueta gobernada + directiva (ABAC) | Etiqueta de sensibilidad + directiva de protección de Purview (a nivel de elemento) |

## Errores comunes

- **Tomar los privilegios de tabla por ABAC.** GRANT SELECT y los demás privilegios de tabla son RBAC, porque dan permiso sobre un objeto concreto.
- **Confundir las vistas dinámicas con ABAC.** Filtran y enmascaran según el usuario, pero se definen vista por vista y no se basan en atributos de los datos.
- **Proteger datos con los permisos del área de trabajo de Databricks.** Esos permisos controlan las acciones que se pueden hacer en el área de trabajo, no el acceso a los datos.
- **Esperar que OneLake security limite a un Admin, Member o Contributor.** Esos roles de área de trabajo se saltan los roles de OneLake security, así que los usuarios a los que quieres restringir deben ser Viewer.

## Fuentes

- [Microsoft Fabric Security and Governance - Cloud Direct](https://clouddirect.net/learning-hub/microsoft-fabric-security-governance-guide/)
- [Microsoft Fabric's Advanced Data Security Features - AlphaBOLD](https://www.alphabold.com/microsoft-fabrics-advanced-data-security-features/)
- [Understanding Microsoft Fabric - RLS, CLS, OneLake Security](https://mbvyn.substack.com/p/understanding-microsoft-fabric-how)
