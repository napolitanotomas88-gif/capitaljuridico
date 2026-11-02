# Avisos del equipo por WhatsApp desde la bandeja central

Pedido de Tomás (1/11/2026): «Tenés mi ok ya para avisar todas las notificaciones del equipo por WhatsApp». La salida se
arma **una sola vez**, en la bandeja central (`cj_notificaciones`), y no en cada bot. Sale **apagada**.

Código: `lib/notificaciones/whatsapp/` (`modelo.ts` reglas puras, `despacho.ts` el despachador, `servidor.ts` Neon, Whapi
y CRM). Ruta: `app/api/notificaciones/whatsapp`. Tests: `scripts/test-notif-whatsapp.mjs` (sin red ni base).

## Cómo funciona

1. Cada 15 min (de 8 a 22) el **vigía** de Grabación (`/api/bot/grabacion/vigia`) corre el despachador en `after()`.
   También se puede correr a mano: `POST /api/notificaciones/whatsapp` con `Authorization: Bearer <CRON_SECRET>`.
2. Con `NOTIF_WHATSAPP` apagado **no hace nada** (ni reconcilia ni encola).
3. Reconcilia la bandeja (así los avisos no dependen de que alguien abra la campanita).
4. Encola cada notificación nueva (de menos de 48 h, sin hacer) en `cj_notif_whatsapp`, una fila por notificación con
   clave única (`wa:<clave de la notificación>:<grupo>`): **pendiente** si tiene grupo, **omitido** con el motivo si es
   un tipo excluido o sin grupo.
5. Lo que quedó «enviando» más de 10 min pasa a **dudoso** y no se reintenta solo (puede haber salido).
6. Fuera de 9 a 20 h (Argentina) no manda: queda pendiente.
7. **Regla de Tomás**: antes de mandar se vuelve a verificar cada pendiente. Si no da, pasa a **omitido** con el motivo:
   - la notificación ya está hecha en el Despacho;
   - tiene más de 48 h;
   - el estado de origen cambió (se relee la fila: `cj_guiones`, `cj_kickoffs`, `cj_videos`, `cj_exito_pedidos`,
     `cj_bajas_pedidos`, `cj_anuncios_avisos`; en Edición, la tarjeta tiene que seguir en la etapa del aviso);
   - guiones para entregar: la tanda ya no está «aprobada» o **el cliente ya grabó** después de la aprobación;
   - el cliente está archivado o no figura en el CRM actual.
   Si el CRM no se puede leer, la corrida se corta sin mandar ni omitir nada.
8. **Un solo mensaje por corrida**: el grupo con el aviso más viejo, todo lo suyo junto, cuando lo más viejo ya esperó
   10 min (ventana para juntar). Con más de 5 avisos, solo la cuenta y el link al Despacho.
9. `/health` del número: si no está en AUTH no sale nada y queda pendiente (además el cliente de Whapi lo vuelve a mirar
   al escribir). Después, **turno**: 5 min entre mensajes y `NOTIF_WHATSAPP_MAX_DIA` por día (candado en Neon,
   `cj_altas_recursos` fila `notif_wa_turno`). Sin turno, queda pendiente.
10. Se manda y la fila queda **enviado** (con el id del mensaje). Número caído → vuelve a pendiente. Error que seguro no
    salió (configuración) → **error**, sin reintento. Si no se sabe → **dudoso**.

WhatsApp seguro: solo `enviarTexto` a grupos del **equipo** que ya existen (lista blanca de `WHAPI_GRUPO_*`) o, en prueba,
al chat de Tomás. Nunca a un cliente, nunca crea grupos, nada de lotes. El texto lleva el título del aviso (a lo sumo el
nombre del cliente) y el link a la pantalla; nunca el cuerpo del aviso ni teléfonos.

## Qué va a dónde

| Tipo de aviso | Grupo | Menciona a |
|---|---|---|
| `edicion_tarjetas` a René o a Aylu | EDICION | a quien va el aviso |
| `edicion_tarjetas` a Ads (OK del cliente) | ADS | Valen |
| `edicion_entrega_revisar` | EDICION | a quien va (Tomás, Aylu) |
| `edicion_crudo_a_revisar`, `edicion_editado`, `edicion_corregido` | EDICION | Aylu |
| `edicion_correccion` | EDICION | René |
| `edicion_bloqueado` | EDICION | Tomás y Aylu |
| `guiones_entrega` | OPERACIONES | a quien va (Aylu, Gero M…) |
| `guiones_error` | COPYWRITING | Tomás y Faus |
| `kickoff_error` | OPERACIONES | Tomás |
| `cliente_sin_respuesta`, `beneficio_referido` | CSM | — |
| `anuncios_dudoso` | ADS | Valen |
| `exito_error`, `exito_dudoso`, `bajas_error`, `bajas_dudoso` | CSM | Tomás |

**Excluidos (ya salen por WhatsApp desde su bot, no se duplican):** `guiones_a_revisar` y `guiones_con_notas` (grupo
COPYWRITING), todo `altas_*` (Verificaciones C.J), `exito_abierto` y `bajas_abierto` (pedidos en Verificaciones) y lo de
Anuncios que ya entra en el resumen del grupo ADS. Un tipo nuevo sin fila en la tabla queda **omitido** («tipo sin grupo»)
hasta que se agregue a `mapear()` en `modelo.ts`.

Chat directo con cada persona: **no** está implementado (por seguridad del número). Todo va al grupo del área.

## Variables (Vercel)

| Variable | Qué es |
|---|---|
| `NOTIF_WHATSAPP` | `apagado` (o sin variable) · `prueba` · `real` |
| `NOTIF_WHATSAPP_PRUEBA_CHAT` | Teléfono de Tomás (solo dígitos) o chat id de Whapi: en `prueba` todo va SOLO ahí, con «🧪 PRUEBA → iría a <grupo> mencionando <nombres>» y sin menciones |
| `NOTIF_WHATSAPP_MAX_DIA` | Tope de mensajes por día (1 a 50; 8 por defecto) |
| `NOTIF_PERSONAS_JSON` | `{"<mail o rol>": {"nombre": "Aylu", "tel": "549…", "rol": "aylu"}}`. Roles: `tomas`, `aylu`, `rene`, `gero_m`, `valen`, `faus` |
| `WHAPI_GRUPO_EDICION`, `_ADS`, `_OPERACIONES`, `_COPYWRITING`, `_CSM` | Los grupos del equipo (`…@g.us`); el bot ya tiene que estar adentro |
| Ya existentes | `WHAPI_TOKEN`, `DATABASE_URL`, `CRON_SECRET`, `DESPACHO_URL`, mails de rol (`EDICION_REVISOR_AYLU`, `EDICION_REVISOR_TOMAS`, `EDICION_EDITOR_RENE`, `KICKOFF_REVISOR_TOMI`, `KICKOFF_REVISOR_GERO_M`, `GUIONES_REVISOR_FAUS`) |

Teléfono de cada persona, en este orden: `NOTIF_PERSONAS_JSON` (por mail o por rol) → por nombre en
`BOT_ALTA_EQUIPO_TELEFONOS` → para Valen, `ANUNCIOS_WHATSAPP_TEL_VALENTINO`. Sin teléfono, se la nombra en texto, sin
mención. Nada de esto va en el repo (es público).

## Cómo encender

1. Cargar `NOTIF_WHATSAPP_PRUEBA_CHAT` (y opcional `NOTIF_PERSONAS_JSON`, `NOTIF_WHATSAPP_MAX_DIA`).
2. `NOTIF_WHATSAPP=prueba` y redeploy. Mirar el estado: `GET /api/notificaciones/whatsapp` con Bearer `CRON_SECRET`
   (variables sí/no, cuentas por estado, últimos 30 registros). Lo que salga en prueba queda **enviado** y no se repite
   al pasar a real.
3. Verificar que `WHAPI_GRUPO_EDICION`, `_ADS`, `_OPERACIONES`, `_COPYWRITING` y `_CSM` estén cargadas y que el bot siga
   en esos grupos.
4. `NOTIF_WHATSAPP=real` y redeploy.

Para apagar: borrar `NOTIF_WHATSAPP` (o ponerla en `apagado`) y redeploy. La bandeja y Discord siguen igual.
