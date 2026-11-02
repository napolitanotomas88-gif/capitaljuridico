# Prueba punta a punta con un cliente ficticio (Alta → Baja) y limpieza

Pedido de RESPONSABLE_HUB (1/11/2026): probar el caminito completo con un cliente inventado, paso a paso, y después borrar todo
para que no quede rastro. **Este documento es el plan: no se corrió todavía.** RESPONSABLE_HUB lo revisa antes de empezar.

Reglas de la prueba:
- **Nadie de afuera recibe nada.** Los grupos del cliente de prueba tienen solo al equipo y al número del bot. El papel
  de «cliente» lo hace alguien del equipo desde su teléfono.
- **WhatsApp seguro** (`docs/BOT-ALTA-CJ.md`): `/health` en AUTH antes de cada etapa, nada de lotes, el bot nunca suma
  gente a los grupos.
- **El mismo nombre en todos lados:** `PRUEBA BOT Ensayo`. Bajas y Anuncios reconocen la prueba por el prefijo
  «PRUEBA BOT»; Éxito, Guiones y Kickoff buscan los grupos y el Doc por el nombre exacto del CRM.
- **El ID** lo asigna el alta en el CRM (no se elige). Se anota y se carga en `BOT_CLIENTES_PRUEBA`. Tiene que tener de
  1 a 5 dígitos (Éxito guarda con otra clave los de 6 y su limpieza no los encontraría).
- Todo el mismo día: mientras exista, el cliente de prueba aparece en la cartera, el tablero, la Daily y los totales de
  Finanzas (un pago de USD 1.100 inventado). Avisar a COORDINACION y a ADS antes de arrancar.

## 0. Antes de empezar

| Qué | Cómo se verifica | Quién |
|---|---|---|
| Número del bot sano | `GET /api/bot/whapi` o el panel de Whapi: `/health` en AUTH | Claude |
| La Mac prendida con el servicio `com.skyward.ia-mac` (`CLAUDE_VIA=mac`) | `/api/bot/exito?estado=1` y la cola `cj_ia_pedidos` sin atrasos | RESPONSABLE_HUB |
| `DISCORD_WEBHOOK_CLIENTES` (#🤝-exito-y-bajas) en Vercel | `env ls` | RESPONSABLE_HUB pasa el webhook, Claude lo carga |
| Puente Drive 2026-10-26a publicado (`quitarAccesoCliente`, `aPapeleraCarpeta`) | `ping` del puente | RESPONSABLE_HUB |
| Webhook del Typeform `bnvnMvVn` → `/api/typeform` | panel de Typeform | RESPONSABLE_HUB |
| Modo del Alta en real con `finanzas,crm,drive,comunidad,bienvenida,contrato,mensajes_equipo,reporte_verificaciones` | Vercel: `BOT_ALTA_MODO`, `BOT_ALTA_PASOS_REALES` | Claude lo revisa |
| Cupo de comunidades del día libre (`BOT_ALTA_MAX_COMUNIDADES_DIA`) | que no haya habido 2 altas hoy | Claude |
| Un «cliente» del equipo con teléfono que **no** esté en `BOT_ALTA_EQUIPO_TELEFONOS` ni en los aprobadores (si no, Éxito y Bajas ignoran sus mensajes) | Vercel | RESPONSABLE_HUB elige quién |
| Un correo controlado por el equipo para el cliente (por ejemplo un alias `+prueba`) | — | RESPONSABLE_HUB |

**Lo que el alta NO tiene:** modo prueba por cliente. Corre con el modo general del alta (hoy en real para las altas
de verdad). Por eso el cliente ficticio pasa por los mismos pasos que uno real, y todo lo que crea se limpia al final.

## 1. Alta (RESPONSABLE_HUB como closer)

1. **RESPONSABLE_HUB** entra a Despacho → Clientes → «Cargar alta» (no hace falta escribir en Ventas C.J.) y pega:
   ```
   #ALTA
   Nombre completo: PRUEBA BOT Ensayo
   Teléfono: <el del «cliente» del equipo>
   Correo: <el alias del equipo>
   Programa: Agencia · PP 3300 USD · Este pago: 1100 USD (Transferencia USD)
   Inicio: hoy · Setter / Fuente: los de siempre
   ```
   Sube un **comprobante inventado** (una imagen hecha a mano con «PRUEBA», 1100 USD y la fecha de hoy).
   Primero **Vista previa** (no escribe nada); si está bien, **Cargar alta**.
2. **Bot:** valida con Claude (lee el comprobante), carga Finanzas (fila en el Registro de Pagos + comprobante en
   Subidos + copia en la app `/finanzas`), escribe el CRM (Agencia + período 0 en Renovaciones: **acá nace el ID**),
   crea la carpeta `PRUEBA BOT Ensayo - C.J` (Guiones, Crudos, Editados, bienvenida), arma la comunidad
   `PRUEBA BOT Ensayo - C.J` con General / Ventas / Contenido **solo con el equipo**, manda el link del General al closer
   y deja el borrador del contrato en PandaDoc.
3. **Aprobadores** responden los pedidos en la pantalla (OK cuenta, OK MEP, etc.).
4. **«Cliente»** entra al General por el link → sale la bienvenida. **COORDINACION NO invita a Skool** (o invita al alias, y se
   anota para sacarlo después). **El contrato no se envía.**
5. **Verificar:** el alta queda `lista` en `/clientes/altas`; la fila del CRM con el ID; la carpeta en Drive; la fila de
   Finanzas; la comunidad con 3 grupos y el bot adentro.
6. **Claude** carga en Vercel `BOT_CLIENTES_PRUEBA=<ID>`, `EXITO_DIAS_CONTENTO_PRUEBA=0` y
   `EXITO_RECORDATORIO_HORAS_PRUEBA=1`, y hace Redeploy. Desde acá Éxito y Bajas corren en real **solo** para ese ID.

## 2. Kickoff (RESPONSABLE_HUB + el «cliente»)

1. **RESPONSABLE_HUB** graba con Fathom una llamada de 4 o 5 minutos titulada «Kickoff PRUEBA BOT Ensayo» con el «cliente»
   (rama laboral, una ciudad, un presupuesto mensual inventado). Menos de 3 minutos o 6 renglones queda `omitida`.
2. **Bot:** el webhook de Fathom → `/api/bot/kickoff` arma la ficha, las ideas, el aviso en #📝-kickoff y el
   «🚀 Para lanzar» en #📣-ads (menciona a ADS: **avisarle antes que es una prueba**). El portfolio de Meta solo lee y va a
   decir que no hay cuenta.
   - Si el webhook no llega: `POST /api/bot/kickoff?recording_id=<id>&quien=tomas&dry=1` (Bearer `CRON_SECRET`) y después
     sin `dry` (ver «Recuperar una kickoff por recording_id» en `docs/BOT-KICKOFF-CJ.md`).
3. **Verificar:** `/clientes/<ID>/kickoff` muestra la ficha y las ideas.

## 3. Guiones (RESPONSABLE_HUB y COORDINACION)

1. **RESPONSABLE_HUB y COORDINACION** aprueban las ideas en `/clientes/<ID>/kickoff` → el bot dispara `/api/bot/guiones`.
2. **Bot:** arma la tanda de 6 guiones con la Mac y avisa en el grupo de guiones (equipo).
3. **RESPONSABLE_HUB o REVISOR_GUIONES** revisan en `/guiones/<id>` y dan el check final → el bot escribe la tanda en los chips del Doc
   «Guiones - PRUEBA BOT Ensayo» (dentro de la carpeta del alta) y, si `GUIONES_WHATSAPP=real`, avisa en
   «Contenido - PRUEBA BOT Ensayo» (solo equipo).
4. **«Cliente»** responde en Contenido con un cambio («el 3 más corto») → el bot lo aplica y vuelve a revisión; se
   aprueba otra vez.
5. **Verificar:** el Doc con la tanda en «Para grabar»; con d05 publicado (lo está haciendo otra corrida), los 6 videos
   aparecen en Edición en «Esperando crudos».

## 4. Grabación (el «cliente» y COORDINACION)

1. Sin d05: correr el diario (`GET /api/bot/grabacion/diario` con `Bearer CRON_SECRET`) o que COORDINACION marque los videos.
   La primera lectura de un Doc nuevo es la línea de base y no crea videos.
2. **«Cliente»** sube 1 o 2 videos cortos (30 s, leyendo un guion) a «Crudos - PRUEBA BOT Ensayo».
3. **Bot:** el vigía (cada 15 min, de 8 a 22) los toma, cierra la tanda a los 45 min sin archivos nuevos, transcribe con
   AssemblyAI, compara con el guion y avisa en #✂️-edicion.
4. **COORDINACION** marca «Sirve» → *Para editar*. **Verificar** en `/edicion`.

## 5. Edición (EDITOR y COORDINACION)

1. **EDITOR** sube un editado a «Editados - PRUEBA BOT Ensayo» y marca «Listo».
2. **COORDINACION** «Está bien: al cliente» → link final → lo pega en Contenido y marca «Enviado».
3. **«Cliente»** responde «OK, me encantó» → el bot lo detecta (`EDICION_LECTURA`) → COORDINACION confirma «El cliente dio el OK»
   → *Aprobado* y aviso a ADS en #ads (avisarle a ADS).
4. **Verificar:** el video en *Aprobado* y el aviso en #ads.

## 6. Anuncios (ADS solo mira)

1. **Bot (8:45):** g01 ve el video nuevo en Editados y avisa a ADS. El borrador en Meta (g03) **no se arma**: el cliente
   de prueba no tiene cuenta publicitaria y `ANUNCIOS_BORRADOR_SOLO` no la incluye.
2. **«Cliente»** escribe en «Ventas - PRUEBA BOT Ensayo» algo de campaña («¿podemos subir el presupuesto?») → nota
   «🧪 PRUEBA» a ADS en `/anuncios?nota=…`, Discord y el grupo ADS.
3. **Verificar:** la nota en `/anuncios` y que **nada** se creó en Meta.

## 7. Éxito (con `BOT_CLIENTES_PRUEBA` cargada)

1. **«Cliente»** escribe en Contenido «Cerré 3 casos esta semana, no paran de escribirme» → en Verificaciones aparece
   «🧪 PRUEBA … 🏆 Éxito de cliente: PRUEBA BOT Ensayo».
2. **Un aprobador** responde OK citando → sale el pedido de testimonio al General de prueba.
3. **«Cliente»** manda un video → el bot responde con el Calendly de CSM y avisa en #🤝-exito-y-bajas (🧪).
4. **Encuesta:** `GET /api/bot/exito?lista=prueba` (Bearer) → OK citado → sale la encuesta al General de prueba; una
   hora después, `GET /api/bot/exito` manda el recordatorio. Antes de cada paso se puede mirar con `?dry=1`.
5. **Verificar:** `GET /api/bot/exito?estado=1` muestra pedidos, medidor y prueba.

## 8. Baja (con `BOT_CLIENTES_PRUEBA` cargada)

1. **COORDINACION** pone en el CRM la fecha de fin del cliente de prueba dentro de los próximos 14 días.
2. `GET /api/bot/bajas?estado=1` → `prueba.clientes=["<ID>"]` y nada faltante.
3. **i01:** `GET /api/bot/bajas` → pedido «⏳ PRUEBA BOT … termina el …» en Verificaciones → RESPONSABLE_HUB o CSM responden OK
   citando → aviso con el Calendly al General de prueba.
4. **i02:** `GET /api/bot/bajas?baja=<ID>&motivo=prueba` → pedido de confirmación → «OK FINALIZADO» citando → el CRM pasa a
   FINALIZADO, aviso de Skool en Discord (🧪), se quita el acceso a Drive, **Meta se omite**.
5. **i03:** COORDINACION responde OK → despedida al General de prueba, el bot saca a todos de los 3 grupos y elimina la comunidad.
6. **i05:** `GET /api/bot/bajas?recontacto=1` → lista en Discord con el cliente de prueba.

## 9. Limpieza (en orden inverso)

Primero el script, que encadena las limpiezas por etapa (Bajas → Éxito → Anuncios/Edición/Grabación/Guiones/Kickoff →
Alta) y al final lista lo que queda a mano:

```sh
# Desde un clon con .env.local (DATABASE_URL, WHAPI_TOKEN, DISCORD_WEBHOOK_CLIENTES, PUENTE_DRIVE_*, Sheets)
node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings \
  scripts/limpiar-cliente-prueba.mjs --id <ID> --nombre "PRUEBA BOT Ensayo"          # simula: solo dice qué borraría
node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings \
  scripts/limpiar-cliente-prueba.mjs --id <ID> --nombre "PRUEBA BOT Ensayo" --real   # borra
```

Qué hace con `--real` (código `scripts/limpiar-cliente-prueba.mjs`):
1. **Seguro:** si en el CRM hay una fila con ese ID que no se llama exactamente «PRUEBA BOT Ensayo», no toca nada.
2. **Bajas** (`limpiar-cliente-prueba-bajas.mjs`): borra los mensajes del bot anotados (con `/health` en AUTH), los avisos
   de Discord, vuelve el CRM a como estaba y borra `cj_bajas_*`.
3. **Éxito** (`limpiar-cliente-prueba-exito.mjs`): mensajes anotados en `cj_prueba_rastros`, Discord y `cj_exito_*`.
4. **Neon de las etapas del medio**, en una sola transacción: `cj_anuncios_notas`, `cj_anuncios_avisos`, `cj_video_*`,
   `cj_videos`, `cj_edicion_tarjetas*`, `cj_edicion_lecturas`, `cj_edicion_clientes`, `cj_marca*`, `cj_grab_*`,
   `cj_guiones`, `cj_guiones_documentos`, `cj_kickoffs`, `cj_hitos*` y `cj_etapas_manual`.
5. **Alta:** la carpeta «PRUEBA BOT Ensayo - C.J» a la papelera por el Puente Drive (se recupera 30 días; el puente
   solo acepta carpetas «PRUEBA BOT…») y después `cj_altas_pasos`, `cj_altas_mensajes` y `cj_altas`. Si la carpeta no
   se pudo mandar, las filas del alta se conservan (tienen su id) para reintentar.
6. Sale con código 2 si algo quedó pendiente: se corrige y se vuelve a correr (es idempotente).

**A mano, en este orden** (el script los lista):
1. **Meta:** confirmar que no se creó nada para el cliente de prueba.
2. **Typeform:** borrar la respuesta de la encuesta (si se contestó) y su fila en la planilla de respuestas.
3. **Fathom:** borrar las grabaciones de la kickoff y de la llamada de baja de prueba.
4. **Skool:** revocar la invitación o sacar al alias.
5. **PandaDoc:** borrar el borrador «Contrato - PRUEBA BOT Ensayo - C.J».
6. **WhatsApp:** si la comunidad sigue, eliminarla. Borrar los mensajes del bot que no tienen rastro (Alta en Ventas C.J. y
   Verificaciones, Guiones en el grupo de guiones, Edición) y los «OK» de los aprobadores, si se quiere.
7. **Discord:** borrar los avisos de Kickoff (#📝-kickoff, #📣-ads), Edición (#✂️-edicion, #ads) y Anuncios.
8. **Finanzas:** borrar el pago en la app `/finanzas`, la fila del Registro de Pagos y mandar el comprobante de
   «Subidos» a la papelera.
9. **CRM:** borrar la fila de Agencia y su período 0 en Renovaciones.
10. **Neon:** `cj_altas_archivos` (comprobantes cargados desde el Despacho) y `cj_edicion_avisos` (son por lote: revisar a
    mano).
11. **Vercel:** borrar `BOT_CLIENTES_PRUEBA`, `EXITO_DIAS_CONTENTO_PRUEBA` y `EXITO_RECORDATORIO_HORAS_PRUEBA` y hacer
    Redeploy.
12. **Control final:** el script en simulación da todo en 0; `/clientes`, `/edicion`, `/anuncios` y `/finanzas` sin el
    cliente; `?estado=1` de Éxito y Bajas sin prueba.

## Lo que no se puede borrar del todo

- Un mensaje de WhatsApp «borrado para todos» deja la marca «Se eliminó este mensaje», y Whapi solo lo borra para todos
  si no pasó demasiado tiempo desde el envío.
- La carpeta de Drive y el comprobante quedan 30 días en la papelera (Google los vacía solo).
- Los registros de costo (Claude, AssemblyAI) y los logs de Vercel quedan.
