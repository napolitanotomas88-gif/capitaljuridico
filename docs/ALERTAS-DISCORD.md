# Alertas 100 % Discord y nada por WhatsApp (2/11/2026)

El número de WhatsApp del bot (Whapi) no se recuperó. Decisión de RESPONSABLE_HUB: el sistema deja de usar WhatsApp.

- Todas las alertas del equipo van a **Discord**, solo por **webhooks** (sin bots con token).
- Lo que el bot le mandaba al **cliente** queda **«para enviar»**: una persona lo pega a mano y marca «Enviado» en el Despacho.
- Lo que el bot **leía** de los grupos se **carga a mano** en el Despacho.
- Los OK que se respondían citando en «Verificaciones C.J.» se dan con **botones** en el Despacho.

Los IDs de Discord, las URLs de los webhooks y los teléfonos van solo en variables de entorno, nunca en el repo.

## 1. Corte global del WhatsApp del bot

`lib/bot/whapi/corte.ts`: ninguna escritura sale a Whapi salvo `WHATSAPP_BOT=encendido`. Eso incluye mensajes, grupos, participantes, medios y comunidades.

- Sin la variable, apagado. Así una variable vieja en `real` (`GUIONES_WHATSAPP`, `NOTIF_WHATSAPP`, `BOT_EXITO_MODO`…) no puede volver a escribirle a nadie aunque el número se reconecte.
- El webhook entrante `POST /api/bot/whapi` responde **410**.
- El alta va siempre por el Despacho: `canalDesdeEntorno` devuelve `despacho`.
- Los tests del cliente de Whapi abren la puerta solo en su proceso, con `permitirWhatsappEnPruebas()`.

## 2. Módulo único de alertas: `lib/alertas/`

| Archivo | Qué hace |
|---|---|
| `canales.ts` | Catálogo de canales y sus variables. Sin la variable de un canal, la alerta cae a `DISCORD_WEBHOOK_SISTEMA` y después a `DISCORD_WEBHOOK_URL`, con la línea «iba a #…». Nunca se pierde |
| `personas.ts` | Menciones por rol (`DISCORD_ID_*`). `aprobadores` = Tomás, Gero A, Gero M y Aylu (o `BOT_ALTA_APROBADORES_DISCORD`). También el responsable de cada pieza «para enviar», que `ALERTAS_RESPONSABLES_JSON` puede pisar |
| `formato.ts` | Formato fijo (ver abajo), recorte a 1.900 caracteres y teléfonos o documentos tapados. De 20 a 9 h sale silenciosa (flag 4096), salvo `urgente` |
| `alerta.ts` | `alertarCon()`, sin red propia. Detalle en la lista de abajo |
| `index.ts` | `alertar()` real: Neon + webhook |

Formato fijo de cada alerta:
- Primera línea: `<@…> emoji **título — cliente**`.
- Hasta 6 viñetas.
- El texto para pegarle al cliente, en un bloque de código.
- Al final: `➡️ <link al Despacho>`.

Qué hace `alertarCon()`:
- **Interruptor** `ALERTAS_DISCORD`:
  - `real` (por defecto).
  - `ensayo`: todo va a 🧰-sistema-bot con «🧪 PRUEBA» y sin menciones.
  - `apagado`: no sale nada; queda registrada.
- **Deduplicación** por `clave` en `cj_alertas_discord`. Una que falló seguro, o que no tenía webhook, se reintenta hasta 5 veces. Una dudosa no se repite sola.
- **Tope** de 60 alertas por hora y canal. El exceso se avisa una vez en 🧰-sistema-bot.

Tests: `scripts/test-alertas-discord.mjs`.

### Variables que espera el código (nombre → canal)

| Variable | Canal | Para qué |
|---|---|---|
| `DISCORD_WEBHOOK_VERIFICACIONES` | ✅-verificaciones | Esperas del alta (OK y datos que faltan, también lo que antes iba al closer en Ventas C.J.), alta recibida, avisos, «Alta completa», pedidos de Éxito y Bajas |
| `DISCORD_WEBHOOK_FINANZAS` | 💰-finanzas | «Alta / Fee / Pago cargado en Finanzas» |
| `DISCORD_WEBHOOK_KICKOFF` | 📝-kickoff | Sin cambios (c01–c06) |
| `DISCORD_WEBHOOK_GUIONES` | ✍️-guiones | d01/d02 para revisar, correcciones aplicadas, `guiones_error` |
| `DISCORD_WEBHOOK_EDICION` | ✂️-edicion | Sin cambios (f01–f03, resumen de la daily con e01 días 2, 4 y 9) |
| `DISCORD_WEBHOOK_ANUNCIOS` (alias `DISCORD_WEBHOOK_KICKOFF_ADS`) | 📣-ads | g01–g07 (el texto para el cliente va en el aviso), notas cargadas a mano, `anuncios_dudoso` |
| `DISCORD_WEBHOOK_CLIENTES` | 🤝-exito-y-bajas | h02 (testimonio recibido), i05, `cliente_sin_respuesta`, `beneficio_referido` |
| `DISCORD_WEBHOOK_OPERACIONES` | 🛠️-operaciones | Tareas a mano (crear los 3 grupos, Skool, sacar de grupos), `kickoff_error`, «para enviar» con más de 48 h |
| `DISCORD_WEBHOOK_PARA_ENVIAR` | 📤-para-enviar-al-cliente | Cada texto para pegar en un grupo del cliente |
| `DISCORD_WEBHOOK_SISTEMA` | 🧰-sistema-bot | Respaldo de cualquier canal sin webhook, ensayo y topes |
| `DISCORD_WEBHOOK_URL` | 🚨-alertas-dashboard | Último respaldo |

Otras variables:
- `DISCORD_ID_TOMAS`, `DISCORD_ID_GERO_A`, `DISCORD_ID_GERO_M`, `DISCORD_ID_AYLU`, `DISCORD_ID_FAUS`, `DISCORD_ID_RENE`, `DISCORD_ID_VALENTINO`.
- `BOT_ALTA_APROBADORES_DISCORD` (opcional).
- `ALERTAS_DISCORD`, `NOTIF_DISCORD` (`real` por defecto, `apagado`), `ALERTAS_RESPONSABLES_JSON` (opcional).
- `WHATSAPP_BOT`: dejar sin cargar.
- `EDICION_PARA_ENVIAR_DESDE` y `E01_PARA_ENVIAR_DESDE`: cortes, con un valor por defecto del 2/11/2026.

**No hay canal de Ventas ni de closers** (decisión de RESPONSABLE_HUB): los datos que faltan y la confirmación del pago van a ✅-verificaciones. Ahí se menciona a Tomás, Gero A, Gero M y Aylu, que son quienes confirman. Al closer no se lo menciona.

## 3. «Para enviar» (salida al cliente) — `lib/bot/canal/`

- **Registro.** `salidaCliente.ts:paraEnviar()` registra el mensaje en `cj_canal_mensajes` (clave única) y avisa en 📤 al responsable, con el texto para copiar y el link a `/clientes/para-enviar`.
- **«Enviado».** Desde `POST /api/clientes/para-enviar/[id]`, `ganchos.ts` hace lo mismo que hacía el envío automático:
  - **d02**: la tanda queda «enviada».
  - **f04**: los videos quedan «enviados al cliente».
  - **e01**: el paso queda hecho.
  - **b07**: la bienvenida del alta queda hecha a mano y el alta sigue.
- **«No corresponde»** lleva un motivo.
- **Recordatorios.** Los corre el vigía: a las 24 h, otra mención en 📤; a las 48 h, aviso a Tomás en 🛠️.
- **Punto de enganche del canal oficial futuro.** La interfaz `CanalSalidaCliente` en `tipos.ts`. Hoy hay un solo proveedor, `manual`. Un proveedor `meta` o `2chat` implementaría la misma interfaz; **no está construido**.

| Pieza | Cómo queda |
|---|---|
| b07 bienvenida | Al hacer a mano la comunidad, sale en 📤 con el link del video (Aylu) |
| d02 guiones | Al publicar la tanda, sale en 📤. También se cierra con «Confirmar entrega» en `/clientes/entregas` (Aylu y Gero M) |
| e01 día 0 y recordatorios | En cada vuelta del diario o del vigía, de 9 a 20 h los días hábiles (Gero M) |
| f04 videos listos | Al pasar a «revisión», el lote del cliente (Aylu) |
| g04–g06 | El texto ya va en el aviso de 📣-ads para Valentino, que entra a /anuncios con su clave. No se registra en 📤 |
| h01, h02, h03 | Al aprobar en `/clientes/aprobaciones`, o al cargar el testimonio (Gero M) |
| i01, i03 | Al aprobar en `/clientes/aprobaciones` (Gero M y Tomás, o Aylu) |

## 4. Aprobaciones — `/clientes/aprobaciones`

- **Botones.** OK, NO y «Hecho a mano», con un campo opcional para lo que antes iba después del OK: «sin Ana», «FINALIZADO», «sin mensaje» o «A123».
- **Quién aprueba.** Solo los aprobadores, por mail.
- **Qué hace el OK.** `POST /api/clientes/aprobaciones` llama al mismo núcleo de Éxito o Bajas: `resolverManual`.
- **Éxito.** Pedidos de testimonio, la lista de la encuesta y las respuestas dudosas.
- **Bajas.** Aviso de fin, confirmar la baja, despedida y pausar en Meta. En Meta nunca se activa nada.
- **Sin WhatsApp:**
  - El grupo General desconocido pasa a ser un General virtual por ID del CRM.
  - No hay horario de WhatsApp.
  - Las respuestas cortas («Listo con…») no salen; se ven en la pantalla.
  - Sacar al cliente de los grupos y de Skool, y borrar la comunidad, es una tarea en 🛠️.
- **Altas.** Siguen en `/clientes/altas`.

## 5. Cargas manuales (lo que antes se leía de los grupos)

| Dónde | Qué |
|---|---|
| `/guiones/<ID>` | «Nota» del cliente (ya existía): el bot corrige la tanda |
| Tarjeta de Edición | «Pedido del cliente» / pasar a publicado (ya existía): f05/f06 |
| Ficha `/clientes/<ID>` → «Cargar lo que dijo el cliente» | Señal de éxito (medidor y pedido de OK), «Llegó el testimonio» (agradecimiento para enviar y aviso a Gero M) y nota sobre los anuncios (`cj_anuncios_notas` y 📣-ads) |

## 6. Alta desde el Despacho

**Entrada.** «Cargar alta» es la **primera** pestaña de Clientes. Cartera también tiene el botón «＋ Cargar alta». La ven los socios y el rol CSM (Aylu, Gero M); los closers no.

**Pasos, con el motor de siempre:**
1. Validar.
2. Finanzas: planilla y app. La columna B es el plan del closer. Aviso en 💰.
3. CRM.
4. Drive: «Nombre - C.J» con Guiones, Crudos, Editados y el doc de bienvenida.
5. Contrato en borrador.
6. **Comunidad**: tarea «Crear los 3 grupos» en 🛠️ para Aylu.
7. **Skool**: tarea en 🛠️.
8. **Bienvenida**: en 📤 después de la comunidad.
9. «Alta completa» en ✅.

**Cómo se cierran los pasos a mano.** Comunidad, bienvenida y Skool quedan en reintento hasta «Hecho a mano», o hasta «Enviado» en el caso de la bienvenida. Ya no necesitan las capacidades `comunidad`, `bienvenida` ni `mensajes_equipo`.

**Mensajes del motor.** Lo que el motor decía en Verificaciones C.J. o al closer en Ventas C.J. va a ✅-verificaciones, con los teléfonos tapados.

## 7. Bandeja central → Discord

`lib/notificaciones/discord/`: el vigía, cada 15 minutos, manda a Discord los avisos de `cj_notificaciones`.

- **Qué tipos salen.** Solo los que su propio bot no avisa ya por Discord.
- **Antes de mandar** revalida que la etapa siga siendo real y descarta lo de más de 48 h.
- **Deduplicación** por la clave `notif:<id>`.
- **Estado** (canales con webhook sí/no, últimas alertas): `GET /api/notificaciones/whatsapp` con Bearer `CRON_SECRET`.

## Pendiente (no en este cambio)

- Borrar el código viejo de WhatsApp (`lib/notificaciones/whatsapp`, lectores de Whapi): hoy está inerte por el corte.
- Borrar las variables `WHAPI_*` y `*_WHATSAPP*` de Vercel.
- Canal oficial de WhatsApp (proveedor `meta` / `2chat`).
- Agrupar más de 5 alertas iguales en 10 minutos en un solo mensaje (hoy solo está el tope por hora).
