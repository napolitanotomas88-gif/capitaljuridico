> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# EOD de Maite — métricas vigentes, cobertura mínima y atribución por historia

Actualizado el 7/10/2026 (sesión EOD). Describe **lo que el código en producción hace hoy** (`lib/eodSetter.ts`, `<ID_PRIVADO_CONFIGURADO>`)
y qué parte de la configuración de ManyChat/Sheets está verificada. Fuente de cada afirmación: **[código]** leído en `lib/eodSetter.ts`,
**[hoja]** leído en Sheets en solo lectura, **[ManyChat]** verificado por UI en la sesión del 5/10, **[otra sesión]** informado por otra sesión y no reverificado acá.
Evidencia de envíos: `ESTADO-EOD.md` y `<ID_PRIVADO_CONFIGURADO>.json`.

## 1. Qué mide cada línea del EOD
| Línea del mensaje | Definición exacta | Fuente | Lo que NO es |
|---|---|---|---|
| **Agendas del día (botonera)** | Contactos únicos por (día del campo `AGENDA POR DÍA`, ID de contacto). Un contacto en otro día cuenta en ese día. | Pestaña `EOD Agendas` (regla 2963847) [código][ManyChat] | No es "agendas de Calendly" ni de closers. |
| **Calendarios enviados** | Contactos únicos por (día del campo `CALENDARIOS POR DÍA`, ID). | `EOD Calendarios` (regla 2963851) [código] | **No es conversión**: no existe "% calendario → agenda" (se eliminó; no es una cohorte). |
| **% agenda setter** | Agendas de Mai ÷ chats asignados por ManyChat, con la **fecha real de asignación**: `Setter IG` col A. Día y mes por separado. | `Setter IG` + `EOD Config` [código][hoja] | No usa la col C (es *Suscrito*, fecha de suscripción). Sin cobertura verificada → "sin dato", nunca 0 ni parcial. Ver §3. |
| **Recursos enviados por outbound de historias** | Contactos únicos por (día del campo `Recurso OUTBOUND Historias x día`, ID). Cuenta **recursos entregados** ese día. | Pestaña `EOD Outbound campo` (regla 2967250, 6/10) [código][otra sesión] | **No es "apertura" ni "primer outbound"**: no mide el primer mensaje de la conversación ni cuántos respondieron. La fuente del *primer mensaje* **no está definida**: queda a la propuesta de Mai (ver §6, B8); no se infiere de ningún campo existente. |
| **Contactos con etiqueta de historias (mensual)** | Contactos con agenda ese día que además tienen fila en `EOD Agendas historias` (regla 2963859, condiciones: etiquetas `Historias - Septiembre 26`, `Historias - Octubre 26` u `outbound_historias`). Se marca "📲 etiqueta historias" junto a cada agenda. | `EOD Agendas historias` [código][ManyChat] | **Referencial**: el mensaje dice "NO es origen verificado ni mide atribución por historia ni D+1". La etiqueta mensual la agregan los flujos de historias (comprobado en los de 3/10 y 1/10), así que no dice cuál historia ni cuándo. Un mes nuevo exige agregar su etiqueta a la regla. |
| **Historia X → agendas D+1** | Solo para historias de `Historias publicadas`, el día P+1. Ver §4. | `Historias publicadas` + col F de `EOD Agendas historias` [código] | Sin cobertura o sin la col F → **"sin medir (motivo)"**, nunca 0. |
| **Acumulado del mes / últimos 7 días** | Suma de los conteos diarios (únicos por día) del 1 del mes al día reportado; serie de 7 días terminando en el día. Formato agendas/calendarios/recursos. | Derivado de lo anterior [código] | Los días anteriores al 1/10 salen `s/d`, no `0/0/0`. |

Modo legado: si **no existe** la pestaña `EOD Outbound campo`, el outbound se cuenta por la etiqueta `outbound_historias` (pestaña `EOD Outbound historias`, regla 2963854): por posición de fila entre cierres. Hoy **no se usa** (la pestaña nueva existe); la pestaña legada sigue recibiendo filas (34 al 7/10) [hoja]. Estado de la regla 2963854: no reverificado en esta etapa.

## 2. Cobertura mínima (cuándo un número es medible)
| Qué | Desde | Qué dice el EOD antes / dentro de la ventana |
|---|---|---|
| Cualquier métrica EOD (agendas, calendarios, recursos, mes, serie) | **01/10/2026** (`EOD_REGISTRO_DESDE`; las reglas se crearon el 30/9 ~18:15 y la 1.ª fila es del 1/10) | Fecha anterior: `Sin dato (sin registros: las reglas EOD de ManyChat empiezan el 01/10/2026)`; en la serie, `s/d`. |
| Recursos outbound **por evento** (regla 2967250) | **06/10/2026** (`OUTBOUND_EVENTOS_DESDE`) | Del 1 al 5/10 son una **carga inicial manual** de los valores finales del campo (col B `(carga inicial 6/10)`); el campo guarda UNA fecha por contacto, así que un día anterior queda subcontado si el contacto volvió a recibir recurso después. La línea lleva "carga inicial manual… cifra mínima" y el mensaje agrega el aviso mientras la serie de 7 días incluya esos días (hasta el EOD del 11/10 inclusive). |
| % agenda setter, día | `asignacion_cobertura_desde = 2026-10-06` (`EOD Config`) | Antes: `sin dato (cobertura de fecha de asignación desde 06/10/2026)`. |
| % agenda setter, mes | Solo si la cobertura empieza el día 1 del mes | Octubre 2026: `sin dato`. Si asignados = 0 o menores que las agendas: `sin dato` con el motivo. |
| D+1 de una historia | La fecha de la col F de `Historias publicadas` ("Cobertura desde") **≤** la publicación | Vacía o posterior: `sin medir`. |
Regla general: un 0 solo se muestra cuando el día **era medible**; si no, "sin dato"/"s/d".

## 3. % agenda setter — cómo se llegó a la regla actual
- `Setter IG` col A estaba mapeada a *Última interacción* y quedó vacía en la mayoría de las filas (88 de 783 con A al 5/10); la col C es *Suscrito*. El fallback A‖C daba 41/56 y 96/152: **inválido, eliminado** [hoja].
- Regla 2948160 "ASIGNADO → Setter IG" (reescrita el 5/10): primero "Establecer campo `Fecha asignación EOD` = fecha/hora de la acción", después "Insertar fila" con la col A ← ese campo; "una vez por contacto"; no reconstruye fechas viejas [ManyChat].
- Primera fila con fecha real: 5/10 00:20 AR. Auditado el 6/10: 103 filas desde ahí, todas con A, 0 IDs repetidos; el día 6/10 tuvo 63 asignados (todos antes de las 23:59:04) [hoja]. De ahí `asignacion_cobertura_desde = 2026-10-06`.

## 4. Atribución por historia (último toque, D+1)
Qué hace falta para que una historia salga medida, **todo junto**:
1. Fila en `Historias publicadas`: `ID historia | Fecha publicación | Etiqueta ManyChat | Link/descripción | Notas | Cobertura desde`.
2. El flujo de esa historia escribe el campo `Historia origen EOD` (texto) = su etiqueta propia o su ID, y está publicado. Es **último toque**: cada historia nueva sobrescribe el valor del contacto; no hay historial.
3. La regla 2963859 escribe ese campo en la col F de `EOD Agendas historias` (mapeo hecho el 5/10 [ManyChat]).
4. Una **agenda real** (cambia `AGENDA POR DÍA`) de un contacto con ese valor, el día P+1: es lo que inserta la fila. Sin esa fila no se puede demostrar que la cadena completa funciona.
5. Una persona verifica la cadena y carga la fecha de **cobertura** en la col F de `Historias publicadas`, que debe ser ≤ la fecha de publicación.

Cálculo [código]: para una historia publicada el día P, en el EOD de P+1 se cuentan los contactos únicos con fila en `EOD Agendas historias` fechada P+1 cuya col F (sin distinguir mayúsculas) es la etiqueta o el ID. Con cobertura y sin filas → **0 real**. Sin cobertura → `sin medir (sin fecha de cobertura verificada)`. Cobertura posterior a la publicación → `sin medir (cobertura desde …, posterior a la publicación)`. IDs repetidos: manda la primera fila y se avisa. No se retroatribuye: el campo existe desde el 5/10 ~00:03 AR.

Estado al 7/10 [hoja]: 3 historias registradas, **ninguna con cobertura cargada**; `EOD Agendas historias` tiene 1 sola fila y **0 con col F** → **D+1 no es medible todavía para ninguna**.
| ID (flow) | Publicación | Etiqueta propia | Estado |
|---|---|---|---|
| `<ID_PRIVADO_CONFIGURADO>` | 2026-10-01 | `CTA Historia - Mega Biblioteca de Recursos 1/10` | Publicada antes del campo → siempre `sin medir`. |
| `<ID_PRIVADO_CONFIGURADO>` | 2026-10-03 | `HR Historia - Kit IA jurídicas - 3/10/26` | Ídem. |
| `<ID_PRIVADO_CONFIGURADO>` | 2026-10-06 | `HR Historia - Café - 6/10/26` | Su D+1 es el 7/10: sale `sin medir` hasta que la sesión CAFÉ verifique la col F con una agenda real y cargue la cobertura. Link de Instagram en la fila (cargado por otra sesión). |
Las dos primeras no tienen link de Instagram cargado (no se inventó).

## 5. Estado de la configuración (fuente indicada)
| Elemento | Estado |
|---|---|
| Campos `Historia origen EOD` (texto) y `Fecha asignación EOD` (fecha/hora) | Creados el 5/10 [ManyChat]. |
| Regla 2963859 (AGENDA POR DÍA historias → EOD Agendas historias) | Col F ← `Historia origen EOD`, activa; condiciones por etiquetas sin tocar [ManyChat]. Verificación de punta a punta pendiente (CAFÉ). |
| Flujos de historias del 3/10 y 1/10 | Acción "Establecer campo `Historia origen EOD`" publicada [ManyChat]. Café: la fila de `Historias publicadas` dice que su flujo ya la lleva [otra sesión]. Las otras 22 historias LIVE no se tocaron (ya vencieron). **Las historias nuevas deben incluir esa acción al crearse.** |
| Regla 2967250 → `EOD Outbound campo` | Fuente actual de recursos outbound; creada el 6/10 [código][otra sesión], no reverificada acá. |
| Campo `Recurso OUTBOUND Historias x día` | Existía (tipo fecha); es el que dispara 2967250. Los flujos de "RECURSOS OUTBOUND A HISTORIAS" y "Aperturas" están detenidos [ManyChat 5/10]: la carga del campo es manual o por otra vía no auditada. |
| Descartado | El campo nuevo `Fecha evento outbound` y la regla "a" de la guía anterior **nunca se crearon**; se reemplazaron por 2967250. La col F "Fecha evento outbound" de `EOD Outbound historias` queda solo como lectura del modo legado. |
| Limitaciones de ManyChat | Una regla por **etiqueta** no se re-dispara si el contacto ya la tiene; ManyChat no mapea una etiqueta a una columna de Sheets (solo campos). Si un campo se vuelve a fijar con el mismo valor no hay cambio → no dispara. ManyChat cachea las pestañas: quitar y volver a elegir la hoja para ver columnas nuevas; elegir la de **2026**, no la de 2025. |

## 6. Envío y snapshots (resumen operativo)
- Make 6463821, diario 23:59 AR, llama a `/api/reporte-eod` (Bearer `EOD_KEY`); manda HOY, válido desde las 23:30 AR. Una fila de `EOD Locks` por fecha garantiza un solo envío; `enviando` sin cierre = estado incierto (revisar el canal, `?forzar=1`). Confirmado en 4/10, 5/10 y 6/10 (`1`, 23:59:05 AR).
- Cada día cerrado queda **congelado** en `Resumen EOD Maite` (col J, JSON) y un `?preview=1` lo devuelve tal cual. Fechas inválidas/futuras → 400.
- Cosmética conocida: en `Resumen EOD Maite` la col E conserva el encabezado "Aperturas historias (outbound)" y la col G "Filas outbound al cierre" aunque en modo campo la col E trae **recursos** y la G solo sirve al modo legado.

## 7. Pendientes explícitos (nada de esto se hizo en esta etapa)
| # | Pendiente | Detalle | Responsable |
|---|---|---|---|
| **B2** | **Mensajes históricos 3/10 y 4/10** | El del 3/10 (`1`) dice outbound "sin dato del día" y el del 4/10 (`1`) dice "0", mientras la fuente por campo da 10 y 7 (cifras mínimas, carga manual). Solo el del 5/10 se corrigió el 6/10 con nota. **No se editan**: ni los mensajes ni sus snapshots (`Resumen EOD Maite` cols E y J) hasta que RESPONSABLE_HUB decida con la evidencia (B5). Opciones: dejar como están; o editar con una nota "Corregido el dd/mm", como el precedente del 5/10. | RESPONSABLE_HUB / sesión de conteos |
| B5 | Fidelidad de la carga manual outbound (45 filas al 7/10, 1→7/10) | Verificadas: 0 duplicados día|ID, 0 sin ID, 0 fechas ilegibles. No contrastadas contra ManyChat. | Sesión de conteos |
| B4 | Atribución D+1 | Esperar una agenda real con col F en `EOD Agendas historias` y cargar cobertura. | Sesión CAFÉ |
| B7 | Encabezados de `Resumen EOD Maite` (cols E y G) | Renombrarlos exige escribir en Sheets (no autorizado) y un cambio de texto en `HEADER_RESUMEN` + deploy. | RESPONSABLE_HUB decide |
| **B8** | **Fuente del primer mensaje outbound** | No existe hoy; **no se inventa**. Se espera la propuesta de Mai. Hasta entonces el EOD dice "recursos enviados", no "aperturas". | Mai |
| B9 | Regla 2963854 (outbound por etiqueta) | La pestaña legada sigue sumando filas. Decidir si se apaga para no mantener dos fuentes. Estado no verificado. | RESPONSABLE_HUB |
