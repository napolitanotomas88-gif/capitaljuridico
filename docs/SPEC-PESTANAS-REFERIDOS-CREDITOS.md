> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Especificación exacta: pestañas "Referidos" y "Créditos" del CRM de clientes

Para crearlas con el connector en el Sheet actual "2026 - CRM - CLIENTES" (el mismo que lee el dashboard con `SHEET_ID_CLIENTES`). Sin secretos y sin datos inventados. Fuente de verdad: `lib/clientes/pestanasNuevas.ts` (estas tablas se generaron de ahí); el cuerpo `batchUpdate` equivalente se imprime sin enviarlo con `node scripts/crm-referidos-tabs.mjs`.

## Reglas para quien las cree

1. Crear SOLO dos pestañas nuevas, "Referidos" y "Créditos", con los nombres exactos. No tocar Agencia, Consultora, Renovaciones ni ninguna otra pestaña.
2. Cargar únicamente la fila 1 con los encabezados exactos de abajo (el dashboard los busca por nombre), más validaciones de datos, formato y las fórmulas indicadas. NO cargar filas de datos, ni de ejemplo ni de prueba: las pestañas quedan vacías hasta que el equipo cargue referidos reales.
3. Fórmulas con coma y en inglés (la API usa siempre ese formato). Las columnas de fórmula son informativas: el dashboard recalcula todo y no las lee.
4. Fila 1 congelada y en negrita. Filas iniciales: 500 en Referidos y 1.000 en Créditos.
5. Los 14 días (columna M de Referidos) y los 12 meses (columna H de Créditos) salen de `lib/clientes/reglasReferidos.ts`; si cambian esas reglas, cambian también acá.
6. No se escriben créditos reales ni se carga ningún movimiento. Verificar al final que ambas pestañas tengan solo encabezados.
7. Reparar las filas de Agencia Z003 a Z004 (sin fórmulas L:N) es un trabajo APARTE y requiere OK explícito: no forma parte de esto.

## Mapeo de estados y momentos

- Estado del referido: Presentado, Asistió, No asistió, Cerró, No cerró, Descartado.
- Momento: Post-kickoff, Primer win, Reporte de fin de mes, Llamada de proyección.
- Tipo de movimiento: ganado_cierre, ganado_llamada, canje, vencimiento, ajuste.
- ID de referido R001…, de movimiento M001…, de cliente A0xx / A1xx (los de la pestaña Agencia).

### Pestaña "Referidos"

Una fila por referido presentado por un cliente. Hasta 3 nombres por pedido (una fila cada uno).

Filas iniciales: 500. Fila 1 = encabezados (negrita, congelada). Datos desde la fila 2.

| Col | Encabezado exacto | Tipo | Obligatoria | Valores permitidos / regla | Fórmula (fila 2) | Descripción |
|---|---|---|---|---|---|---|
| A | ID | texto | sí | validación de datos (ver `pestanasNuevas.ts`) |  | R001, R002… correlativo. Lo asigna el dashboard; a mano, el siguiente libre. |
| B | Fecha del pedido | fecha | sí |  |  | Cuándo se le pidió el referido al cliente. |
| C | Momento | lista | sí | Post-kickoff, Primer win, Reporte de fin de mes, Llamada de proyección |  | En cuál de los 4 momentos se pidió. |
| D | ID referidor | texto | sí | validación de datos (ver `pestanasNuevas.ts`) |  | ID del cliente activo que refiere (A0xx / A1xx). |
| E | Nombre | texto | no |  |  | Nombre del referido (lead). |
| F | Teléfono | texto | sí |  |  | Con código de país. Sirve para verificar que sea un lead nuevo. |
| G | Mail | texto | no | validación de datos (ver `pestanasNuevas.ts`) |  | Opcional. |
| H | Estudio | texto | sí |  |  | Estudio del referido: tiene que ser distinto al del cliente que refiere. |
| I | Estado | lista | sí | Presentado, Asistió, No asistió, Cerró, No cerró, Descartado |  | Presentado → Asistió / No asistió → Cerró / No cerró. Descartado si no es válido. |
| J | Fecha de llamada | fecha | no |  |  | Obligatoria si el estado es Asistió, Cerró o No cerró (queda marcada en rojo si falta). |
| K | ID cliente nuevo | texto | no | validación de datos (ver `pestanasNuevas.ts`) |  | ID que recibió al cerrar (A1xx). Solo si Cerró. |
| L | Fecha del primer pago | fecha | no |  |  | Cuándo entró el primer pago del referido. Obligatoria si Cerró. |
| M | Fecha de liberación | fecha | no |  | `=IF(OR($L2="",$N2="SI"),"",$L2+14)` | FÓRMULA: primer pago + 14 días, vacía si hay reembolso. Informativa: el dashboard la recalcula. |
| N | Reembolso | lista | no | SI, NO |  | SI si el referido pidió reembolso: el crédito de ese cierre no se libera. |
| O | Notas | texto | no |  |  | Libre. |
| P | Cargado por | texto | no |  |  | Quién cargó la fila (el dashboard lo completa solo). |
| Q | Referidor (nombre) | texto | no |  | `=IF($D2="","",IFERROR(INDEX(Agencia!$B:$B,MATCH($D2,Agencia!$A:$A,0)),"no existe en Agencia"))` | FÓRMULA de ayuda: nombre del cliente según su ID. No la lee el dashboard. |

### Pestaña "Créditos"

Libro de movimientos de créditos: se agrega una fila por cada ganado, canje, vencimiento o ajuste. No se edita ni se borra lo anterior.

Filas iniciales: 1000. Fila 1 = encabezados (negrita, congelada). Datos desde la fila 2.

| Col | Encabezado exacto | Tipo | Obligatoria | Valores permitidos / regla | Fórmula (fila 2) | Descripción |
|---|---|---|---|---|---|---|
| A | ID | texto | sí | validación de datos (ver `pestanasNuevas.ts`) |  | M001, M002… correlativo. |
| B | Fecha | fecha | sí |  |  | Del ganado_cierre: la fecha de LIBERACIÓN. Del canje: el día que se aplicó a la renovación (corta el ciclo). |
| C | ID cliente | texto | sí | validación de datos (ver `pestanasNuevas.ts`) |  | Cliente dueño del crédito (el que refiere). |
| D | Tipo | lista | sí | ganado_cierre, ganado_llamada, canje, vencimiento, ajuste |  | ganado_cierre · ganado_llamada · canje · vencimiento · ajuste. |
| E | Referido | texto | no | validación de datos (ver `pestanasNuevas.ts`) |  | ID del referido que originó el movimiento (R001). |
| F | Meses (+/-) | numero | sí | validación de datos (ver `pestanasNuevas.ts`) |  | Positivo al ganar, negativo al canjear o vencer (ganado_llamada = premio de un intento: 1 con el intento 5 y 0 con los demás premios). |
| G | Extra | texto | no |  |  | Beneficio que no es meses: "identidad de marca completa", "página web", "branding"… En un canje, los USD canjeados ("USD 300"): el libro no tiene columna de USD. El canje de una grabación, de la página web o del branding va con ese Extra y 0 meses (no corta el ciclo). |
| H | Vence | fecha | no |  | `=IF(OR($D2="ganado_cierre",$D2="ganado_llamada"),IF($B2="","",EDATE($B2,12)),"")` | FÓRMULA en ganado_cierre / ganado_llamada: fecha + 12 meses. En un ajuste con vencimiento se escribe a mano encima. |
| I | Renovación aplicada | texto | no |  |  | En un canje: a qué renovación se aplicó (R2, R3…). Obligatoria si Tipo = canje. |
| J | Nota | texto | no |  |  | Libre. |
| K | Cargado por | texto | no |  |  | Quién cargó la fila. |


## Verificación después de crearlas

- Las dos pestañas existen, con exactamente esos encabezados en la fila 1 y sin filas de datos.
- Abrir `/referidos` y `/clientes` en el dashboard: dejan de decir que falta la pestaña y muestran el estado vacío honesto (sin ceros inventados).
- Cuota de Sheets: una sola lectura de verificación.
