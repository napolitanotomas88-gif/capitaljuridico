> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

> **7/10/2026: reemplazado.** `/ventas` ya no es la vista de solo lectura descrita abajo: ahora es el CRM de ventas completo (Mi día, ficha, tablero y guía). Ver `docs/CRM-VENTAS-INTEGRADO.md`. Lo de abajo se conserva como historia de la lectura verificada; `lib/ventas/*` sigue en el repo (lo usa `scripts/test-ventas.mjs` y la asignación `AUTH_VENTAS_PESTANAS`).

# Ventas: integración verificada el 6/10/2026

La página /ventas consulta las cuatro pestañas reales de SHEET_ID_VENTAS, con scope de Google solo lectura. Encabezados D/V/W comprobados antes de interpretar filas. Cache por conjunto de pestañas durante dos minutos y lectura concurrente compartida.

Los socios ven todas las pestañas. Closer/setter requieren AUTH_VENTAS_PESTANAS, JSON que asigna el email autorizado a una lista exacta de pestañas. Ejemplo ficticio: {"<EMAIL_PRIVADO_CONFIGURADO>":["Closer 1"]}. Sin asignación válida no se leen ni entregan leads. CSM no tiene acceso a Ventas.

Se muestran precall pendiente, asistencia por confirmar, resultado por registrar, seguimiento de ausencia/postcall y columnas heredadas. Cerrados, Olvidar, ausencia S5/No hacer y llamadas con más de 60 días quedan excluidos. Una reagenda futura reemplaza la fecha anterior para evitar pedir un seguimiento de ausencia antes de la nueva cita.

La hoja actual no provee fecha estructurada del último seguimiento. Por eso la vista indica revisar, y no afirma que se deba enviar hoy ni escribe S1/S2 automáticamente. No hay botones de escritura ni envíos automáticos. Faltan el BRIEF completo de OPERADOR_AUTORIZADO y la especificación de escritura/último contacto para integrar el flujo Mi día completo.

Comprobación: 13 casos del motor/permisos pasan; TypeScript sin errores. Lectura real: 222 pendientes, Closer 1:118, Closer 2:99, OPERADOR_AUTORIZADO-OPERADOR_AUTORIZADO:5, Closer 3:0. Navegador local renderiza datos reales. Acceso Google en producción requiere configuración real de OAuth y lista de usuarios; no está confirmado.
