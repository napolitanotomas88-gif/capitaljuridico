# Datos, durabilidad y migraciones

## Separar fuentes

Sheets conserva identidad, servicio y movimientos del CRM; el ledger financiero conserva cobros. PostgreSQL guarda reservas, estados de procesos, versiones, historial, revisiones y outbox. Drive conserva materiales y Docs. No copiar datos entre fuentes inventando campos faltantes.

Las referencias de cliente usan un ID estable y único (`Z001` en ejemplos ficticios). Para Agencia/Consultora, buscar en ambas hojas y rechazar duplicados. Un nombre de cliente, alias o carpeta sólo es un vínculo cuando su procedencia está autorizada y es inequívoca.

## Migraciones incluidas

- `lib/clientes/migraciones/001_referidos_alta.sql`: soporte durable de referidos del alta.
- `lib/clientes/migraciones/002_canjes_reservas.sql`: reservas de canje y sus restricciones de unicidad/concurrencia.
- `lib/edicion/db/migracion.ts`: esquema versionado de grabación, materiales, marca, videos, notas, eventos y avisos.
- `lib/edicion/tarjetasDb.ts`: `SQL_TARJETAS` para jerarquía, historial, operación idempotente y outbox.
- Los almacenes de cada bot y dominio contienen DDL aditivo `IF NOT EXISTS` y actualizaciones compatibles. Consultar el código antes de operar; una función que parece una lectura puede preparar su esquema dentro de una transacción.

No ejecutar migraciones automáticamente por copiar este repositorio. Revisar permisos, versión, respaldo y destino. No introducir DDL destructivo ni crear tablas dentro de una consulta que deba ser estrictamente de sólo lectura. Evitar un `ALTER` innecesario en cada arranque cuando el módulo ya comprueba columnas existentes.

## Transacciones y reservas

Acciones de cliente usan una clave estable y una huella del contenido; la clave con contenido diferente se rechaza. Las filas reservadas y operaciones pendientes bloquean otra escritura incompatible hasta reconciliar. La renovación con meses reserva también el canje dentro de la misma transacción.

En Edición, la versión de tarjeta y del video vinculado deben coincidir. La misma transacción guarda cambios, notas, eventos, respuesta idempotente y outbox. Un conflicto revierte el conjunto; no dejar un estado nuevo con el motor viejo.

No existe transacción distribuida entre PG, Sheets, Drive y mensajería. Guardar pasos/parciales antes de efectos que puedan quedar inciertos, releer después y conservar evidencia de reconciliación. Un timeout no implica que el proveedor no haya escrito.

## Sheets y encabezados

El parser resuelve las columnas que lo permiten por encabezados; duplicados, fórmulas o un desplazamiento incompatible bloquean una escritura. Para agregar columnas, preparar un plan append-only, verificar que entren dentro del rango de todos los lectores y releer antes/después. Sheets no ofrece CAS de los valores: coordinar una ventana sin otro escritor de encabezados. La revisión de UI por sí sola no vuelve atómica una edición externa concurrente.

## Importaciones de Edición

Importar sólo identidades exactas, jerarquía acíclica, padres existentes y versiones comprobadas. Conservar el ID externo como procedencia. Una repetición no pisa tarjetas ya trabajadas ni vuelve a alinear un video cambiado.

El histórico Publicado sin cita verificable de OK conserva su estado literal y queda protegido mediante `finalizado_en_clickup`; no se fabrica un OK ni una entrega. Las filas sin identidad exacta permanecen sólo de lectura hasta conciliación explícita.

## QA aislada

Crear un schema de prueba nuevo y verificar antes de importar mutadores:

```sql
SELECT current_schema(), array_to_json(current_schemas(false));
```

La ruta efectiva debe contener sólo el schema QA previsto; `public` no es aceptable. Comprobar **cada transporte utilizado**, PG y Neon HTTP: que `options=search_path` funcione en PG no prueba que el SDK HTTP lo respete. No relajar el assert por un resultado inesperado. El wrapper de aislamiento, si se utiliza, pertenece exclusivamente al harness de QA.

Sheets/Drive de QA deben tener título y recursos ficticios autorizados, sólo el cliente sintético y ningún dato real. Conservar la baseline y verificar hash/formato después de deshacer. Guardar recibos privados fuera del árbol publicable; no limpiar evidencia para forzar una pasada verde.

## Lecturas estrictas

Para auditoría de datos reales utilizar conexión con `default_transaction_read_only=on`, `BEGIN READ ONLY` y comprobar `transaction_read_only`. No llamar helpers que ejecuten DDL o resuelvan/copien Docs. Leer únicamente las columnas y clientes necesarios; no publicar el resultado.

El inventario de tablas y sus módulos aparece en [ESQUEMA-MODULOS.md](ESQUEMA-MODULOS.md). No incluye filas, IDs de entorno ni contenidos privados.
