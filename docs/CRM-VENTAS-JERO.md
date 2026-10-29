# Ventas: máquina de estados del seguimiento

Contrato técnico histórico saneado. No incluye las filas, personas o resultados de una operación. La integración vigente está en [CRM-VENTAS-INTEGRADO.md](CRM-VENTAS-INTEGRADO.md).

| Situación | Próxima acción |
|---|---|
| Llamada futura y pre-call incompleto | Siguiente fase de confirmación, decisores, videos, dolores o enlace a llamada |
| Llamada pasada y asistencia vacía | Registrar si se presentó |
| No show con seguimientos pendientes | Próximo seguimiento permitido; al agotar la secuencia aplicar el estado previsto |
| Se presentó/reagendó y falta resultado | Registrar resultado de la llamada |
| Seguimiento posterior habilitado | Siguiente seguimiento de la secuencia |
| Cerrado, no hacer u olvidado | Sale de la cola correspondiente |
| Ya hubo acción hoy | No volver a ofrecer la misma acción diaria |

La asignación de pestañas de venta es explícita y privada. Un rol de acceso no permite leer todas las pestañas ni cambiar el closer; conservar los permisos por sección y actor. La configuración del ID de la hoja original protege las escrituras; si falta, no autorizar por omisión.

No cambiar encabezados o validaciones para resolver un problema de parseo sin revisar las automatizaciones consumidoras. Respetar la máquina de estados, reglas de antigüedad y la versión de columna del adaptador actual. Los ejemplos públicos no acreditan una limpieza de filas real ni una migración de Sheets.
