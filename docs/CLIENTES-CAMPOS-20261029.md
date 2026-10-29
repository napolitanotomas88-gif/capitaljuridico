# Campos opcionales del cliente: Estudio, CSM y Ciudad

Son campos del cliente CRM en Agencia y Consultora, independientes del estudio informado en un lead referido. Vacío significa sin cargar. Ciudad no se infiere del teléfono y CSM no se copia de Closer.

El parser resuelve por encabezado y admite hojas/snapshots anteriores. Editar utiliza la acción `datos`, revisión previa, clave estable, historial y reversa. Sólo se escriben las celdas permitidas en un batch y se comprueban identidad, valores y encabezados antes/después. Fórmulas, duplicados, cambios humanos posteriores o un desplazamiento incompatible bloquean la operación o su reversa.

El catálogo CSM está fuera de Git: `HUB_CSM_OPCIONES_JSON`, `HUB_CSM_VERSION` y `HUB_CSM_FUENTE`. Una opción contiene nombre operativo, estado activo y alias explícitos de identidad. La ausencia no inventa responsables; configuración inválida es error. Un catálogo operativo no es una lista de permisos y no crea cuentas ni accesos.

Una asignación previa se conserva visible aunque ya no se permita asignarla a otros clientes. Vaciar está permitido. Estudio y Ciudad son texto confirmado por el operador.

La ampliación de encabezados usa un plan append-only y huella fresca. Verifica todas las hojas, expande sólo si hace falta, no mueve columnas y comprueba que ningún lector quede corto. Coordinar una ventana sin otro escritor: Sheets no ofrece CAS de esos valores en `batchUpdate`. Una ejecución repetida verificada no escribe otra vez.

La QA usa recursos de prueba y `Z001`, comprueba versión/rangos, aplicación, replay, deshacer, fórmulas y conservación de movimientos no afectados. Los recibos privados y el estado de encabezados de una operación real se excluyen de esta documentación.
