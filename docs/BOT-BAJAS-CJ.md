> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot "Capital Jurídico": etapa BAJA DEL CLIENTE

Pedido y decisiones de RESPONSABLE_HUB del 25/10/2026. Los textos al cliente (aviso de fin y despedida) y el Calendly de renovación los aprobó RESPONSABLE_HUB ese mismo día. También aclaró: el "no renueva" **siempre** se consulta en Verificaciones C.J y se espera el OK, aunque en el Fathom sea obvio. Sin ese OK no avanza nada: ni la despedida, ni sacarlo de los grupos, ni el CRM.

Se escribió en una copia aislada y está **apagada por defecto** (modo seco): no manda nada hasta que se configuren las variables del checklist.

**Qué hace.**
- 14 días antes del fin real del programa, pide permiso para mandarle al cliente el link de Calendly de RESPONSABLE_HUB para charlar la renovación.
- Lee la llamada de renovación en Fathom. Si el cliente no renueva, o si queda en duda, pide la confirmación de la baja.
- Con el OK, pasa al cliente a Históricos en el CRM (FINALIZADO o INACTIVO, según la regla de abajo), le avisa a COORDINACION para que lo saque de Skool, le saca el acceso a su carpeta de Drive y pide otro OK para pausar sus campañas en Meta.
- Con un segundo OK (el de COORDINACION), primero manda la despedida al General, después saca al cliente y a sus socios de sus 3 grupos y, al final, elimina su comunidad con el grupo de Avisos.
- Una vez por mes, arma la lista de históricos para recontactar.
- De Drive no se borra nada: la carpeta y su contenido quedan intactos, solo se sacan los permisos de las personas del cliente.

## Flujo

### i01 · Aviso de fin (cron diario, 10:30 de Argentina)

1. **Fin real del programa** (`lib/bot/bajas/fin.ts`, relevado en el CRM real el 25/10):
   - El programa dura Día 1 + 120 días corridos (`finDelPeriodo`), o los meses que diga la columna Meses.
   - **Las pausas y los días extra hoy se cargan como filas "Extensión …" en Renovaciones**, con precio 0 y su Finalización explícita. Por ejemplo: "Extensión +3 semanas — compensa pausa" o "Extensión +2 meses — PAUSADO por problemas familiares…".
   - "Fin período actual" de Agencia es una fórmula (MAXIFS de Renovaciones o Día 1 + 120) que ya las incluye.
   - El bot toma la **mayor** fecha entre esa columna y las Finalizaciones de Renovaciones. Si la fórmula falta en una fila, igual calcula bien.
2. Toma a los clientes **ACTIVOS** de Agencia con ID cuyo fin real cae entre hoy y dentro de 14 días. Quedan afuera los pausados, los finalizados y Consultora.
3. Pide el OK en Verificaciones C.J con el texto de RESPONSABLE_HUB:
   ```
   ⏳ Ana CUENTA_QA termina el 11/11/2026. ¿Le mando el mensaje de renovación? Respondé citando: OK / NO
   ```
   - Un mismo período se pide **una sola vez**: el id es `aviso:<ID>:<fin>`.
   - Se abren como mucho 5 pedidos por día.
   - Si alguien tuvo una baja en los últimos 180 días, no se le pide.
   - Si no se conoce el grupo General del cliente, el pedido lo aclara.
4. **El OK** tiene que venir de alguien de `BOT_ALTA_APROBADORES` (RESPONSABLE_HUB o CSM). Con el OK, el bot manda al grupo General el aviso de fin aprobado, con el Calendly de renovación de RESPONSABLE_HUB, y responde "Listo…" citando el OK.
   - Si no conoce el grupo General, no manda nada y avisa.
   - Con un **NO**, no manda nada.
   - Un pedido sin respuesta vence a los 14 días.

### i02 · No renueva: lectura de la llamada de renovación con RESPONSABLE_HUB

1. **Sin un webhook nuevo.** El webhook de Fathom que ya existe (`/api/bot/kickoff`, con el secreto de RESPONSABLE_HUB) suma `procesarLlamadaBajasReal` en **su propio `after()`**, separado del kickoff. Esa tarea decide sola si la grabación es una llamada de renovación y no toca la ficha del kickoff.
   - **Tope propio:** la ruta le pasa `deadline: t0 + 275 s` (`PLAZO_BAJAS_MS`), contado desde que llega el webhook, antes de los ~280 s del kickoff.
     - Sin 60 s libres, no empieza ni reclama nada: la llamada queda para reintentar.
     - Claude recibe solo el tiempo que queda.
     - Sin 35 s libres para abrir el pedido, la llamada queda **`cortada`**, sin la decisión guardada a medias, y se puede reintentar.
     - Además, una carrera contra el deadline garantiza que la tarea termine aunque algo se cuelgue.
   - **Idempotente por `recording_id`:** Fathom puede reenviar la grabación y Kickoff puede reprocesarla a mano con `?recording_id=`.
     - Cada grabación se reclama una sola vez. Solo se puede volver a reclamar si quedó `cortada` o en `error`.
     - El pedido de baja tiene un id fijo por grabación (`baja:<ID>:f<recording_id>`): un reintento nunca abre otro pedido ni manda dos veces.
   - **Descarte barato**, sin Claude, sin escrituras y sin Meta (esta etapa nunca llama a Meta):
     - una reunión interna (`only_internal`) o sin transcripción se descarta antes de leer nada;
     - lo que no calza con un cliente cerca del fin (por ejemplo, la kickoff de un cliente nuevo, con el fin a ~120 días) solo cuesta la lectura del CRM, que sale del snapshot.
2. **Filtro sin Claude:** la llamada tiene que calzar con **un solo** cliente ACTIVO o PAUSADO de Agencia cuyo fin esté cerca (de 45 días antes a 60 días después de la llamada), o con uno al que ya se le mandó el mensaje de renovación.
   - Calza por el mail de un invitado, si es igual al del CRM, o por 2 o más palabras del nombre en el título.
   - Si calza con dos clientes, no elige ninguno.
   - Si no calza, no se gasta Claude ni se guarda nada.
3. **Claude** (Haiku 5.5, esfuerzo bajo, JSON estricto, el mismo patrón que kickoff y Éxito) devuelve:
   - si es la llamada de renovación;
   - la decisión: `renueva`, `no_renueva`, `dudoso` o `no_se_hablo`;
   - una cita literal y el motivo de la baja.

   Un `no_renueva` con confianza baja se trata como `dudoso`.
4. Todo queda en Neon (`cj_bajas_llamadas`), y la misma grabación no se mira dos veces.
   - Si el cliente **renueva**, solo queda la nota.
   - Si **no renueva** o queda **dudoso**, se abre el pedido de confirmación en Verificaciones (aprobadores):
     ```
     🚪 Ana CUENTA_QA dijo que NO renueva (llamada con RESPONSABLE_HUB del 30/10/2026)
     "no voy a renovar por ahora"
     Motivo: el precio
     <URL_CONFIGURADA_PRIVADAMENTE>

     Nada avanza sin el OK (ni la despedida, ni los grupos, ni el CRM). ¿Confirmás la baja? Respondé citando: OK / NO
     ```
5. **A mano:** `GET /api/bot/bajas?baja=Z001&motivo=…` abre el mismo pedido, para cuando el cliente avisó por otro lado. **No da de baja**: espera el OK.
6. **Nota en el Despacho:** las "notas del cliente" del Despacho son la columna **Notas renovación** del CRM. La nota se escribe recién **con el OK**, en el paso del CRM (i04). Antes de eso solo queda en Neon.

### Con el OK a la baja

La baja queda **confirmada** en `cj_bajas_bajas`, y cada paso guarda su resultado:

1. **i04 · CRM → Históricos** (`baja_crm`): Estado = FINALIZADO o INACTIVO (el que quedó en el OK), Fecha de baja (si estaba vacía) y la nota "[dd/mm/aaaa] No renueva: <motivo>. Baja confirmada por <quien> (bot): <estado>." agregada al final de Notas renovación. Detalle en "CRM" más abajo.
2. **i03b · Skool** (`baja_aviso_skool`; Skool no tiene API): aviso en **#🤝-exito-y-bajas** (`DISCORD_WEBHOOK_CLIENTES`) mencionando a COORDINACION (`DISCORD_ID_AYLU`), con el correo del CRM, para que lo saque a mano.
3. **Drive** (`baja_quitar_drive`, ronda 2): el Puente Drive (`quitarAccesoCliente`, Codigo.gs **2026-10-26a**) le saca el acceso, como editor o lector, a la carpeta "<Nombre> - C.J" a los correos del cliente y de sus socios.
   - Los correos salen del CRM y del #ALTA, el texto que guardó el motor; se excluyen los del equipo.
   - La carpeta sale del paso `drive` del motor. Si no se la conoce (un cliente de antes del bot), queda "a mano".
   - Nunca saca al dueño, a CUENTA_GOOGLE_OPERADORA_CONFIGURADA ni a una cuenta de servicio, y no borra nada.
   - Si la carpeta tiene acceso general ("cualquiera con el enlace" o del dominio), **no lo cambia**: lo dice en el resumen para que lo decida una persona.
   - Si el puente publicado es el viejo, avisa: "falta publicar el Puente Drive 2026-10-26a".
4. **Meta** (`baja_pausar_meta`, ronda 2): lee sus campañas con estado ACTIVE y pide **otro OK** en Verificaciones (aprobadores):
   ```
   📣 ¿Pauso las campañas activas de Ana CUENTA_QA en Meta? Lista:
   • CJ Laboral (Ana CUENTA_QA Abogada)
   • CJ ART (Ana CUENTA_QA Abogada)

   Solo se pausan (no se borra nada). Respondé citando: OK / NO
   ```
   - Con el OK, **pausa** esas campañas (`status=PAUSED`), **nunca borra**, y relee cada una para verificar que quedó PAUSED.
   - Las cuentas del cliente salen del **mismo cruce del tablero**, con funciones de lectura de `lib/anuncios` (`descubrirCuentas`, `leerSheets`, `crearCruce`) que no se modifican, como se acordó con la sesión "Bot C.J. · Anuncios". El código nuevo está en `lib/bot/bajas/meta.ts`.
   - **Token:** `META_ANUNCIOS_TOKEN` (usuario de CSM en la app dashboard-skwd: ve las 124 cuentas, tiene ads_management y vence el 24/12/2026). El usuario del sistema de `META_ADS_WRITE_TOKEN` no ve cuentas de clientes y no se usa.
   - Sin token, o si Meta dice que venció o que no hay permiso, **falla cerrado** con un aviso claro en Verificaciones.
   - Según la sesión Anuncios, el seguimiento no se confunde con campañas pausadas.
5. **Pedido de la despedida**, que confirma **COORDINACION**. Muestra el texto y a quién se va a sacar de los grupos (últimos 4 dígitos):
   ```
   👋 Despedida para Ana CUENTA_QA (grupo General):

   <texto de la despedida>

   Después lo saco de General, Ventas y Contenido: …0099, …0088.
   COORDINACION: ¿la mando? Respondé citando: OK / NO ("OK sin mensaje" lo saca de los grupos sin despedida)
   ```
6. Responde en Verificaciones con el resumen: lo hecho y lo que queda "a mano" porque su capacidad está apagada.

Con un **NO** a la confirmación no pasa nada.

### FINALIZADO o INACTIVO (ronda 2): la regla de "dudas"

Lo calcula `estadoParaBaja` (`lib/bot/bajas/fin.ts`) al abrir el pedido de la baja:

| Situación del cliente | Estado | ¿Dudas? |
|---|---|---|
| ACTIVO y su fin real ya pasó o cae en los próximos 14 días (terminó su período) | **FINALIZADO** | No |
| PAUSADO (estaba en pausa) | — | Sí |
| Se va **antes** del fin: faltan más de 14 días | — | Sí |
| Sin fecha de fin, u otro estado | — | Sí |

- **Sin dudas**, el estado va propuesto dentro del mismo OK de la baja: "CRM: pasa a FINALIZADO (terminó su período el …). ¿Confirmás la baja? Respondé citando: OK / NO". Igual se puede responder "OK INACTIVO".
- **Con dudas**, se pregunta: "¿Pasa a FINALIZADO o a INACTIVO? Respondé citando: OK FINALIZADO / OK INACTIVO". Un "OK" solo **no avanza**: el bot pide el estado y el pedido sigue abierto.

### i03a · Despedida y grupos (con el OK de COORDINACION)

Pueden dar el OK las personas de `BAJA_APROBADORES_DESPEDIDA` (por defecto, COORDINACION) y los aprobadores.

1. **Primero la despedida** al General (`baja_mensaje_cliente`).
   - Si WhatsApp no confirma el envío, cuenta como enviada.
   - Si **no salió**, el bot **no saca a nadie** y avisa.
2. Espera 5 s y **después** saca al cliente de General, Ventas y Contenido (`baja_quitar_grupos`), con `DELETE /groups/{id}/participants`. Es un método nuevo del cliente de Whapi, `quitarParticipantes`, y nunca se reintenta.
   - **A quién saca:** los participantes con rango de **miembro** que no son del equipo. Eso incluye al cliente y a sus socios.
   - **A quién no saca nunca:** a un admin, al creador (el bot) ni a alguien de `BOT_ALTA_EQUIPO_TELEFONOS`, `BOT_ALTA_APROBADORES`, `BOT_ALTA_OPERACIONES` o `BAJA_EXCLUIR_TELEFONOS`.
   - Si en un grupo aparecen más de 6 personas para sacar, algo está mal: de ese grupo no saca a nadie y avisa.
   - La lista de participantes la da `participantesGrupo` (`GET /groups/{id}`), otro método nuevo.
3. **"OK sin mensaje"** lo saca sin despedida, por ejemplo si la despedida ya se mandó a mano.
4. Sin `baja_mensaje_cliente`, un OK no saca a nadie, porque la despedida va primero. Para sacarlo igual hay que responder "OK sin mensaje".
5. Con un **NO**, no se manda la despedida ni se lo saca de los grupos.
6. **Al final, la comunidad** (`baja_eliminar_comunidad`, ronda 2): **siempre después** de la despedida y de sacarlo de los grupos, el bot elimina la comunidad del cliente y, con ella, su grupo de Avisos.
   - En la documentación de Whapi es "Deactivate community": `DELETE /communities/{CommunityID}`. Responde `{ success }`; 403 es "Not permission" y 404, que no existe. Es un método nuevo del cliente de Whapi, `eliminarComunidad`, y nunca se reintenta.
   - La documentación no dice qué rol hace falta. En WhatsApp, desactivar una comunidad lo puede hacer quien la administra: lo normal es que el bot sea el dueño, porque las creó el motor. Si no es admin (403), queda "a mano".
   - Al desactivarla, los grupos quedan sueltos, sin borrarse, y el grupo de Avisos desaparece.
   - El id sale del paso `comunidad` del motor (`comunidadId`). Si no está, se busca por nombre ("<Nombre> - C.J") y se usa solo si hay una sola.
   - Si no se lo pudo sacar de los 3 grupos sin errores, la comunidad **no** se elimina.
7. **Drive:** la carpeta y su contenido quedan intactos (el acceso se saca en el paso de la confirmación).

### i05 · Recontacto (una vez por mes)

El día `BAJA_RECONTACTO_DIA` (por defecto el 1), el bot publica en #🤝-exito-y-bajas la lista de **históricos** para recontactar. Son los clientes de Agencia en FINALIZADO o INACTIVO que se fueron hace entre 30 y 365 días. La fecha de salida es la Fecha de baja o, si falta, el fin real. Quedan afuera los "no clientes" de las métricas.

- **Datos de cada uno:** quién es, hace cuánto se fue, el último puntaje del Typeform (el mismo cruce que la cartera; si no hay, la columna Satisfacción del CRM) y el motivo de la baja si se conoce (de la baja confirmada o de la llamada).
- **Orden:** el mejor puntaje primero. Como mucho 20 por mes.
- Al final va el texto sugerido de recontacto. **El bot no les escribe.**
- Sale una vez por mes. `GET /api/bot/bajas?recontacto=1` la publica otro día, si todavía no salió.

## Modo y capacidades

Sigue el mismo criterio que el motor y que Éxito, con un interruptor propio.

| Modo (`BOT_BAJAS_MODO`) | Qué pasa |
|---|---|
| `seco` (por defecto) | No sale nada ni se escribe nada: ni Claude, ni Whapi, ni Fathom, ni planillas. El webhook ni siquiera arma la etapa. |
| `ensayo` | Lecturas reales: CRM, Whapi GET, Fathom y Claude. Lo único que sale son reportes **"SIMULACIÓN"** cortos en Verificaciones: el pedido del aviso, el pedido de baja, un resumen de lo que haría con el OK (con el CRM simulado y la lista de a quién sacaría) y la lista de recontacto. Un OK en ensayo queda como `aprobado_simulado`. Un pedido abierto en ensayo nunca dispara nada real, aunque después se pase a real. |
| `real` | Sale solo lo que diga `BOT_BAJAS_CAPACIDADES`. |

| Capacidad | Qué deja salir |
|---|---|
| `baja_aviso_fin` | El pedido del aviso de fin y su "Listo" en Verificaciones. En ensayo, como reporte SIMULACIÓN. |
| `baja_mensaje_cliente` | Los mensajes al General: el aviso de fin con el Calendly y la despedida. Solo en real. |
| `baja_fathom` | Leer la llamada (Claude + Fathom) y el pedido de confirmación de la baja, también el manual. En ensayo, como reporte SIMULACIÓN. |
| `baja_quitar_grupos` | Sacar al cliente de General, Ventas y Contenido. Solo en real. |
| `baja_aviso_skool` | El aviso a COORDINACION en Discord por Skool. Solo en real. |
| `baja_crm` | Pasar al cliente a FINALIZADO o INACTIVO en el CRM. Solo en real; en ensayo se simula. |
| `baja_recontacto` | La lista mensual en Discord. En ensayo, un SIMULACIÓN en Verificaciones. |
| `baja_eliminar_comunidad` | Ronda 2: eliminar su comunidad (con Avisos) al final, después de la despedida y de los grupos. Solo en real. |
| `baja_pausar_meta` | Ronda 2: el pedido de OK y la pausa de sus campañas en Meta (solo pausa, con verificación). En ensayo, solo se leen las campañas para el reporte. |
| `baja_quitar_drive` | Ronda 2: sacarle el acceso a su carpeta de Drive (Puente `quitarAccesoCliente`). Solo en real. |

`BOT_BAJAS=no` apaga la etapa entera.

## CRM: Históricos (i04)

El código está en `lib/bot/bajas/crm.ts` y sigue el criterio de `crmEscribir.ts`.

- **No existe una pestaña "Históricos"** (se revisaron las pestañas el 25/10). Un histórico es una fila de Agencia en **FINALIZADO** (o INACTIVO). La cartera ya la muestra en la etapa **Baja** (`lib/clientes/recorrido.ts`).
- **Pasos:**
  1. Una lectura directa con fórmulas.
  2. Las columnas se resuelven por encabezado. Se exige:
     - **una sola** fila con ese ID;
     - el nombre que calza;
     - Estado ACTIVO o PAUSADO;
     - que Estado, Fecha de baja y Notas renovación **no** sean fórmulas.
  3. En `simulacion`, devuelve lo que escribiría.
  4. En `real`, escribe (USER_ENTERED; la fecha va como serial, porque la columna tiene formato dd/mm/yyyy) y **relee para verificar**.
- Si el cliente ya figuraba FINALIZADO o INACTIVO, no se toca. Una Fecha de baja que ya estaba cargada se respeta.
- **Filas de prueba:** con `BAJA_CRM_SOLO_PRUEBA=si`, solo escribe en filas cuyo nombre empieza con "PRUEBA BOT". Para probarlo:
  ```
  node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-baja-crm-prueba.mjs Z001          # solo lee
  node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-baja-crm-prueba.mjs Z001 --real   # solo filas PRUEBA BOT
  ```
  El 25/10 se corrió la simulación sobre una fila real. Resolvió Estado = C, Fecha de baja = V y Notas renovación = R, y no escribió nada.
- **Anuncios:** el tablero de `/anuncios` y el seguimiento del bot de anuncios ya sacan solos a un cliente FINALIZADO: `lib/anuncios/cruce.ts` lo marca "ex-cliente" y `tablero.ts` lo excluye. Así que el CRM alcanza para sacarlo del tablero. Las campañas en Meta se **pausan** con su propio OK (`baja_pausar_meta`, ver "Con el OK a la baja").

## Variables (solo nombres)

| Variable | Para qué |
|---|---|
| `BOT_BAJAS_MODO` | `seco` (por defecto), `ensayo` o `real`. |
| `BOT_BAJAS_CAPACIDADES` | Lista separada por coma con las capacidades de arriba. |
| `BOT_BAJAS` | `no` apaga todo. |
| `BAJA_CALENDLY_URL` | Opcional. Por defecto, el Calendly de renovación que pasó RESPONSABLE_HUB el 25/10: `<URL_CONFIGURADA_PRIVADAMENTE>`. Está en el código; la variable sirve solo para cambiarlo. Ese evento no figura en la organización de `CALENDLY_VENTAS_TOKEN` (que tiene 4 eventos y ninguno de RESPONSABLE_HUB): es de su cuenta personal. |
| `BAJA_APROBADORES_DESPEDIDA` | Opcional. Por defecto, el teléfono de COORDINACION que ya está en `BOT_ALTA_OPERACIONES` (1): no hay que cargar otra variable. Los aprobadores también pueden dar el OK. |
| `BAJA_RECONTACTO_DIA` | Día del mes de la lista de recontacto (de 1 a 28; por defecto 1). |
| `BAJA_EXCLUIR_TELEFONOS` | Opcional: números que nunca se sacan de un grupo, además del equipo. |
| `BAJA_CRM_SOLO_PRUEBA` | `si`: el CRM solo escribe en filas "PRUEBA BOT". |
| `BOT_BAJAS_MODELO` | Modelo de Claude. Por defecto, el del bot de altas (Haiku 5.5). |
| `BOT_ANTHROPIC_API_KEY` o `ANTHROPIC_API_KEY` | Claude. |
| `FATHOM_API_KEY_TOMAS` | La misma del kickoff, para `?recording_id=` (traer una llamada que no llegó por el webhook). |
| `FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS` | El webhook que ya existe: no hay que crear otro. |
| `WHAPI_TOKEN`, `WHAPI_GRUPO_VERIFICACIONES`, `WHAPI_GRUPO_VENTAS` | Los mismos del bot de altas. |
| `BOT_ALTA_APROBADORES` | Quién confirma el aviso y la baja (RESPONSABLE_HUB y CSM). |
| `BOT_ALTA_EQUIPO_TELEFONOS`, `BOT_ALTA_OPERACIONES` | El equipo: nunca se lo saca de un grupo. |
| `DISCORD_WEBHOOK_CLIENTES` | Canal #🤝-exito-y-bajas (Skool y recontacto). |
| `DISCORD_ID_AYLU` | Mención de COORDINACION. |
| `META_ANUNCIOS_TOKEN` | Ronda 2: el token de CSM (dashboard-skwd), para leer y pausar campañas. Sin él, la pausa falla cerrada. |
| `PUENTE_DRIVE_URL`, `PUENTE_DRIVE_SECRETO` | Ronda 2: el Puente Drive, el mismo del alta (`quitarAccesoCliente` desde la versión 2026-10-26a). |
| `SHEET_ID_CLIENTES` | CRM. Para escribir, la cuenta de servicio tiene que ser editora, como en el alta. |
| `SHEET_ID_TYPEFORM` | Puntajes para el recontacto (solo lectura). |
| `DATABASE_URL` | Neon (tablas `cj_bajas_*`). |
| `CRON_SECRET` | El cron y la ruta `/api/bot/bajas`. |

## APROBADO POR RESPONSABLE_HUB (25/10/2026): textos al cliente, tal cual

Están en `lib/bot/bajas/textos.ts`. `[CLIENTE]` es el primer nombre y `[FECHA]` la fecha de fin en dd/mm. Si falta el nombre, el saludo queda "Buenas, cómo estás?" y la despedida empieza con "Muchas gracias…".

**Aviso de fin** (al General, después del OK en Verificaciones):
```
Buenas [CLIENTE], cómo estás? El dia [FECHA] terminamos el período que teníamos acordado. Quiero que hagamos un balance con vos de lo que trabajamos y ver qué tiene sentido de acá en adelante junto a RESPONSABLE_HUB, por eso preparamos una llamada de proyección con tus números.

Te dejo el link con el calendario de RESPONSABLE_HUB, ahí vas a ver todos los horarios disponibles y elegir el mejor para vos: 

<URL_CONFIGURADA_PRIVADAMENTE>
```

**Despedida** (al General, después del OK de "no renueva" y del OK de COORDINACION, antes de sacarlo de los grupos):
```
[CLIENTE], muchas gracias por confiar en Capital Jurídico. Fue un gusto. Las puertas siempre estarán abiertas por si en algún momento querés retomar. Escribinos cuando quieras. Muchos éxitos en todo lo que venga!
```

**Texto sugerido de recontacto** (ronda 2; va en la lista de Discord y el bot no lo manda):
```
Hola [CLIENTE], ¿cómo estás? Hace un tiempo trabajamos juntos en Capital Jurídico y nos acordamos de vos. Tenemos novedades en la forma en que captamos clientes para estudios jurídicos y nos gustaría saber cómo viene tu estudio. ¿Te parece si coordinamos una charla corta esta semana?
```

## A APROBAR POR RESPONSABLE_HUB

Estos textos no van al cliente: son para el equipo.

**Aviso a COORDINACION por Skool** (Discord):
```
@COORDINACION 🚪 **Ana CUENTA_QA** se dio de baja (confirmado el 01/11/2026 por RESPONSABLE_HUB).
Sacalo de Skool a mano: <EMAIL_PRIVADO_CONFIGURADO>
Su carpeta de Drive queda intacta (no se borra nada).
```

**Pedido para pausar Meta** y **pregunta FINALIZADO / INACTIVO** (Verificaciones): están más arriba, en el flujo.

## Preguntas para RESPONSABLE_HUB

Respondidas en la ronda 2: la comunidad se elimina, las campañas se pausan con OK y el estado sigue la regla de dudas. Queda:

1. **Ventana de la llamada:** se mira la llamada si el fin está de 45 días antes a 60 días después. ¿Está bien?

## Archivos

| Archivo | Qué hace |
|---|---|
| `lib/bot/bajas/config.ts` | Modo, capacidades, constantes y variables (puro). |
| `lib/bot/bajas/textos.ts` | Textos (puro). |
| `lib/bot/bajas/fin.ts` | Fin real, candidatos al aviso, históricos y cruce de la llamada (puro). |
| `lib/bot/bajas/grupos.ts` | Los 3 grupos del cliente, por el motor o por Whapi. Es una versión reducida de `lib/bot/exito/directorio.ts`, así no depende de Éxito (se pueden unificar más adelante). |
| `lib/bot/bajas/filtro.ts` | Qué mensajes del webhook le importan a la etapa: OK / NO citados y ecos (puro). |
| `lib/bot/bajas/claude.ts` | Clasificación de la llamada. |
| `lib/bot/bajas/crm.ts` | Paso del CRM: simulación o real, con verificación. |
| `lib/bot/bajas/almacen.ts` / `almacenNeon.ts` | Estado en memoria / en Neon. Tablas: `cj_bajas_pedidos`, `cj_bajas_bajas`, `cj_bajas_llamadas` y `cj_bajas_recontactos`. |
| `lib/bot/bajas/nucleo.ts` | La lógica. |
| `lib/bot/bajas/servidor.ts` | Las dependencias reales. |
| `lib/bot/bajas/ruta.ts` / `app/api/bot/bajas/route.ts` | `/api/bot/bajas`. |
| `lib/bot/bajas/lectura.ts` | `leerEstadoBajas()` para la cartera. No toca la cartera. |
| `lib/bot/bajas/meta.ts` | Ronda 2: lee las campañas activas del cliente y las pausa con verificación (fetch inyectable). |
| `lib/bot/alta/puenteDrive.ts` | **Compartido**, ronda 2: `quitarAccesoCliente` en el cliente del Puente. |
| `integrations/apps-script/Codigo.gs` | **Fuera del repo**, ronda 2: acción `quitarAccesoCliente`, VERSION 2026-10-26a (respaldo en `Codigo.gs.antes-2026-10-26`). Hay que publicarla. |
| `lib/bot/whapi/cliente.ts`, `lib/bot/whapi/comun.ts`, `lib/bot/alta/motor/tipos.ts` | **Compartidos:** `participantesGrupo` y `quitarParticipantes`. En la interfaz son métodos opcionales, así que la compuerta, el juguete y el motor no cambian. |
| `lib/bot/whapi/ruta.ts`, `app/api/bot/whapi/route.ts` | **Compartidos:** el webhook programa la etapa en `after()` (`procesarBajas`). |
| `app/api/bot/kickoff/route.ts` | **Compartido:** el webhook de Fathom suma `procesarLlamadaBajasReal` en `after()`. |
| `lib/auth/rutas.ts`, `proxy.ts`, `vercel.json`, `scripts/test-rutas.mjs` | **Compartidos:** la ruta y su cron. |
| `scripts/bot-bajas-migrar.mjs` | Crea las tablas (`--simular`, `--real`, `--real --confirmar`). |
| `scripts/bot-baja-crm-prueba.mjs` | Prueba el paso del CRM contra la planilla real (simulación, o real solo en filas "PRUEBA BOT"). |
| `scripts/test-bot-bajas.mjs` | Tests (sin red ni base). |

## Ruta `/api/bot/bajas` y cron

- Regla `propio` en `lib/auth/rutas.ts`, excluida del matcher de `proxy.ts`. Solo acepta `Authorization: Bearer <CRON_SECRET>`, nunca `?key=`. Sin el secreto responde 503; con otro, 401.
- **Cron** en `vercel.json`: `30 13 * * *`, que son las 10:30 de Argentina. Así no coincide con el de Éxito (13:00 UTC).
- Parámetros:
  - `?dry=1`: devuelve lo que haría, sin mandar ni escribir.
  - `?recontacto=1`: publica la lista del mes.
  - `?estado=1`: modo, capacidades, variables que faltan y el estado de cada cliente.
  - `?baja=Z001[&motivo=…]`: abre el pedido de confirmación.
  - `?recording_id=123[&quien=tomas|gero_m][&dry=1]`: mira una llamada traída de la API de Fathom.

## Checklist para encenderlo

1. Crear las tablas:
   ```
   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-bajas-migrar.mjs
   ```
   Por defecto corre `--simular`. Después, `--real` (solo mira) y `--real --confirmar` (crea). También se crean solas con la primera escritura.
2. Que RESPONSABLE_HUB apruebe los textos para el equipo ("A APROBAR POR RESPONSABLE_HUB") y conteste las preguntas. Los textos al cliente ya están aprobados.
3. No hay variables nuevas obligatorias: `BAJA_CALENDLY_URL` y `BAJA_APROBADORES_DESPEDIDA` tienen valor por defecto. Controlar que estén `DISCORD_ID_AYLU`, `DISCORD_WEBHOOK_CLIENTES`, `BOT_ALTA_APROBADORES`, `WHAPI_TOKEN`, `WHAPI_GRUPO_VERIFICACIONES`, `SHEET_ID_CLIENTES` y `FATHOM_API_KEY_TOMAS`. `GET /api/bot/bajas?estado=1` lista lo que falta.
4. **Ensayo:** `BOT_BAJAS_MODO=ensayo` y `BOT_BAJAS_CAPACIDADES=baja_aviso_fin,baja_fathom,baja_crm,baja_quitar_grupos,baja_recontacto`. Redeploy. En Verificaciones solo salen mensajes "SIMULACIÓN". Probar:
   - un OK citado;
   - `?baja=Z001` con un cliente de prueba;
   - `?recording_id=` de una llamada de renovación real.
5. **CRM:** con una fila "PRUEBA BOT", correr `scripts/bot-baja-crm-prueba.mjs <ID> --real` y volverla atrás.
6. **Real por partes**, siempre con `BOT_BAJAS_MODO=real`:
   1. `baja_aviso_fin`;
   2. sumar `baja_mensaje_cliente`;
   3. sumar `baja_fathom`;
   4. sumar `baja_aviso_skool`;
   5. sumar `baja_crm` (primero con `BAJA_CRM_SOLO_PRUEBA=si`);
   6. sumar `baja_quitar_grupos`;
   7. sumar `baja_quitar_drive`, después de publicar el Puente Drive 2026-10-26a (`ping` tiene que devolver esa versión);
   8. sumar `baja_pausar_meta`, con `META_ANUNCIOS_TOKEN` vigente;
   9. sumar `baja_eliminar_comunidad`;
   10. por último, `baja_recontacto`.
7. Probar el cron a mano con `GET /api/bot/bajas?dry=1` (con el Bearer).

## Tests

```
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-bajas.mjs
```

Corren sin red ni base: Whapi, Claude, Discord y el CRM son falsos, y el almacén está en memoria (o es un SQL falso para Neon). Cubren:
- la configuración y los modos;
- los textos;
- el fin real con extensiones, la ventana de 14 días y los históricos;
- el cruce de la llamada;
- los grupos;
- el filtro;
- Claude;
- el CRM (simulación, real con verificación, ya FINALIZADO, ID repetido, otro nombre, fórmulas, filas de prueba);
- los métodos nuevos del cliente de Whapi (DELETE sin reintento, rangos);
- el flujo completo:
  - aviso con el texto aprobado, OK, NO, sin grupo General, eco y tope;
  - Fathom: no renueva, dudoso, renueva y sin cliente;
  - el tope propio (sin margen no empieza, la llamada `cortada` se reintenta, la tarea termina aunque algo se cuelgue), la idempotencia por `recording_id` (reenvío y reproceso a mano: un solo pedido y un solo mensaje) y el descarte barato (reunión interna, kickoff de un cliente nuevo);
  - confirmación con CRM, Skool y despedida;
  - el orden despedida → grupos, "OK sin mensaje", la despedida que falla, más de 6 personas, quién aprueba;
  - ensayo, y un pedido de ensayo aprobado en real;
- el recontacto y los vencimientos;
- la integración con los webhooks de Whapi y de Fathom;
- ronda 2: la regla FINALIZADO / INACTIVO (sin dudas, con dudas, "OK" solo que no avanza), el CRM con INACTIVO, Drive (correos del CRM y del #ALTA, carpeta pública, puente viejo), Meta (OK, NO, token caído, sin campañas, solo POST status=PAUSED con verificación, token en la cabecera), la comunidad (siempre al final, no si fallaron los grupos, 403, búsqueda por nombre) y el DELETE de Whapi;
- la acción `quitarAccesoCliente` de Codigo.gs (en `scripts/test-puente-drive.mjs`);
- la ruta, la lectura, Neon, la migración y esta documentación.
