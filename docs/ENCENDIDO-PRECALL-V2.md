# Pre-call v2 · encendido

Pedido de Tomás (5/11/2026): el pre-call se separa en dos partes.

- **Pre-caller.** Confirma lo que el lead puso en el calendario: día y hora, facturación, situación del estudio, decisores y urgencia. Trabaja desde un WhatsApp propio que va a funcionar como el de Tomás.
- **Closer.** Recibe al lead recién cuando el pre-caller lo pasa. En ese momento sale solo, desde el WhatsApp del closer, el video de traspaso con la cita y el video de pre-llamada (palabra LISTO).

**Estado: todo construido y APAGADO.** Falta el número de WhatsApp nuevo del pre-caller. Con `PRECALL_V2` sin cargar, el Despacho, la planilla y la confirmación al agendar funcionan igual que hoy.

## Qué hay construido

| Pieza | Dónde | Apagado = |
|---|---|---|
| Bandera general | `PRECALL_V2=1` + `PRECALL_V2_DESDE` (`lib/crm/config/precallV2.ts`) | El CRM de siempre |
| Envío del pase | `PRECALL_V2_ENVIO=1` + `MAKE_WEBHOOK_PASE_<CLOSER>` (`lib/crm/pasePrecall.ts`) | El pase escribe en la planilla, pero el WhatsApp no sale y el aviso dice «mandalo a mano» |
| Tarjeta del pre-caller | `accionPrecaller` en `lib/crm/motor/proxima-accion.ts` | No existe |
| Vista «Pre-caller · todos los closers» | `/ventas/closer/pre-caller` (`datosPrecaller` en `lib/crm/mi-dia.ts`) | Da 404 |
| Fases del closer v2 | `FASES_CLOSER_V2`: video LISTO → link | Las 4 fases de siempre |
| Columnas AM–AV | Pestañas Closer 1–5 (`scripts/precall-v2-planilla.mjs`) | No se leen ni se escriben (se lee hasta AK, como hoy) |
| Pestaña «Pre-caller» | Solo lectura, con fórmula QUERY (mismo script) | No existe |
| Confirmación al agendar desde el número del pre-caller | `variableWebhookAgenda` en `lib/confirmacionAgenda.ts` | Sale del WhatsApp de cada closer, como hoy |
| Escenarios de Make | Ver la tabla de abajo | Inactivos |

### Flujo del pre-caller (tarjeta en el Despacho)

1. **1ª llamada.** Botones: Atendió / No atendió / Confirmó por chat (si respondió la confirmación automática).
2. **2ª llamada**, 1 h después como mínimo. Botones: los mismos.
3. **Escalera por chat** (textos del punto 3, abajo): «¿Pudiste leerme?» → decisores (2 h después) → seguimiento de decisores → ultimátum. Cada paso se marca con «Enviado (n de 4)».
   - Sin respuesta al ultimátum: 🔴 y «Cancelar reunión».
4. **Confirmación.** En cualquier paso: «Confirmó · decide solo», «Confirmó · vienen decisores», «Confirmó (falta decisores)» o «Reprogramó (ya en Calendly)». Si confirmó por chat sin decisores, la tarjeta pide la pregunta de decisores. Después, por chat, se mandan las 3 recomendaciones con el nombre del closer.
5. **Pase.** El botón «Pre-call hecho → pasar al closer» abre un formulario:
   - facturación, situación del estudio y urgencia, precargadas con lo que el lead puso en el calendario;
   - notas para el closer.

   Al confirmar escribe:

   | Columna | Valor |
   |---|---|
   | AT | Pasado al closer |
   | F | CONF + DECISORES |
   | AI | Efectiva / No efectiva (la métrica sigue funcionando) |
   | AU | Fecha y hora del pase |

   Después dispara el WhatsApp del closer.
6. **Regla dura.** Sin pase, el closer no ve al lead: ni el pre-call ni «¿Se presentó?».
   - Si la reunión pasa sin pase, la tarjeta pide reagendar en Calendly o «Liberar».
   - «Liberar» escribe: Se presentó = No, Pre-call = Olvidar, sin seguimiento de no-show.
7. **Dos seguimientos de show-up.**
   - El del pre-caller, para que el lead confirme (este flujo).
   - El del closer, cuando el lead ya pasó y no se presentó (la tarjeta de No-show de siempre).

Solo entran al flujo nuevo las reuniones desde `PRECALL_V2_DESDE` que nadie empezó por el flujo viejo (F y AI vacías). Las reuniones anteriores, con o sin «¿Se presentó?», siguen con el closer como siempre. Si alguien carga «¿Se presentó?» a mano sin pase, lo que sigue es del closer y «Liberar» no aparece: nunca se pisa una asistencia ya cargada.

### Escenarios de Make (todos inactivos)

| Escenario | Variable de Vercel |
|---|---|
| BORRADOR (NO ACTIVAR) - Pase al closer (Marcos) · pre-call v2 | `MAKE_WEBHOOK_PASE_MARCOS` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Carlos) · pre-call v2 | `MAKE_WEBHOOK_PASE_CARLOS` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Yamila) · pre-call v2 | `MAKE_WEBHOOK_PASE_YAMILA` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Nahuel) · pre-call v2 | `MAKE_WEBHOOK_PASE_NAHUEL` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Brenda) · pre-call v2 | `MAKE_WEBHOOK_PASE_BRENDA` |
| BORRADOR (NO ACTIVAR) - Confirmación al agendar desde WhatsApp del pre-caller · pre-call v2 | `MAKE_WEBHOOK_CONFIRMACION_PRECALLER` |

- **Pase al closer.** Cada escenario sale del número del closer, con su video de traspaso actual y la misma conexión de 2Chat que los escenarios de confirmación. Ruta con nombre / sin nombre.
- **Confirmación al agendar.** Su número y su video dicen `PENDIENTE`.
- **Plantillas.** Todos los escenarios usan `template_uuid = PENDIENTE-…` hasta que Meta apruebe las plantillas.
- **Ids y webhooks.** Las URLs de los webhooks y los ids de Make no van en este repo, que es público: están en la nota privada de Tomás.
- **Datos que manda el Despacho al pase:** `telefono`, `nombre` (primer nombre; vacío → plantilla sin nombre), `closer_completo`, `fecha_texto`, `hora_texto`, `pais_texto`, `inicio_iso`, `hoja` y `fila`. Hora y país salen de la reunión en Calendly; si Calendly no responde, se usa la hora de Argentina.

## Textos para el OK de Tomás

Las variables `{{n}}` las llena Make. Meta no deja que el texto **empiece** con una variable: por eso el «Hola» va antes del nombre.

### 1. Pase al closer: una plantilla por closer, con el video de traspaso actual en el encabezado (OK de Tomás 5/11)

Con nombre ({{1}} = nombre, {{2}} = «jueves 12 de noviembre a las 15:00», {{3}} = «Argentina»):

> Hola {{1}}, cómo estás? Soy Marcos Carlomagno, consultor de estudios jurídicos del equipo de Gerónimo Actis.
>
> Nos vemos en la reunión el {{2}} (hora {{3}}) para analizar cómo podemos mejorar la captación de clientes en tu estudio.
>
> Para aprovecharla al máximo, mirá este video antes y mandame la palabra clave que pedimos al final del mismo: https://capitaljuridico.com.ar/confirmarreunion

Sin nombre: igual, con «Hola, cómo estás?» al principio ({{1}} = fecha y hora, {{2}} = país).

Nombre y cargo de cada closer:

| Closer | Cómo se presenta |
|---|---|
| Marcos | Marcos Carlomagno, consultor |
| Carlos | Carlos Roletto, consultor |
| Yamila | Yamila Coutoune, consultora |
| Nahuel | Nahuel Milena, consultor |
| Brenda | Brenda Amado, consultora |

### 2. Confirmación al agendar, desde el WhatsApp del pre-caller (el de Tomás) (OK de Tomás 5/11)

En el encabezado va un video de Tomás saludando, que falta grabar. {{1}} = nombre, {{2}} = fecha y hora, {{3}} = «argentino».

> Hola {{1}}, cómo estás?
>
> Confirmamos tu asistencia para la reunión de consultoría sobre tu estudio jurídico del {{2}} (horario {{3}})?

Sin nombre: «Hola, cómo estás?» y el mismo resto.

### 3. Pre-caller por chat: los manda a mano desde el WhatsApp del pre-caller (orden de Tomás, 5/11)

**Si atiende la 1ª o la 2ª llamada:** se hace todo en la llamada, con el guion del PASO 2, y el lead pasa directo al closer.

**Si no atiende la 1ª llamada y tampoco responde la confirmación automática (mensaje 2):** 2ª llamada, como mínimo 1 h después. Si tampoco la atiende, arranca esta escalera:

**a) Apenas no atiende la 2ª llamada:**
> Hola NOMBRE, cómo estás? Pudiste leerme?

**b) 2 h después, responda o no** (PASO 2 BIS del doc PROCESOS VENTAS):
> NOMBRE, hay alguien más que tenga que estar presente en la reunión de consultoría que te pueda ayudar en decisiones de este aspecto?
>
> Socios, pareja, familiar?

**c) Seguimiento de decisores, si no responde** (regla general del SOP):
> Esto es importante NOMBRE, así todos estamos alineados, podemos conocernos… y en el caso de que no decidas solo, todos puedan aprovechar para sacarse las dudas.
>
> Entonces, invitamos a alguien más a la reunión?

**d) Ultimátum, si sigue sin responder:**
> NOMBRE, confirmamos o liberamos el horario de la reunión?

**e) Si no responde el ultimátum:** se cancela la reunión con el botón «Cancelar reunión» (Calendly le avisa al lead por mail).

**Cuando confirma por chat** (respondiendo la confirmación automática o en cualquier paso de la escalera): si todavía no dijo nada de los decisores, se le manda la pregunta b). Cuando responde, va este mensaje y se pasa al closer, sin esperar respuesta:
> Perfecto NOMBRE. Para que la reunión te sea realmente útil, te recomiendo:
> 1) Conectate desde la compu, en un lugar tranquilo.
> 2) Reservate los 60 minutos completos.
> 3) No solemos reprogramar: si te surge algo, avisanos con 3 horas de anticipación.
>
> Te va a estar contactando NOMBRE Y APELLIDO DEL CLOSER, consultor del equipo, para mandarte el link de la reunión y seguir con el proceso. Muchos éxitos!

En la tarjeta: cada mensaje de la escalera se marca con «Enviado (n de 4)». En cualquier paso el lead puede confirmar («Confirmó · decide solo», «Confirmó · vienen decisores», «Confirmó (falta decisores)») o reprogramar.

## Checklist de encendido (todo de una)

El orden importa: ninguna variable apunta a un escenario apagado, porque Make guardaría en cola confirmaciones de leads reales y el Despacho las anotaría como «enviado a Make», lo que bloquea ese teléfono 30 días.

1. **Número del pre-caller.** Conectarlo en 2Chat por coexistencia y anotar su número.
2. **Video de Tomás.** Grabarlo, pasarlo a 576x1024 H.264 y publicarlo en `/v/` (capitaljuridico-medios).
3. **OK de Tomás.** Los textos de arriba ya están aprobados (5/11). Si cambian, actualizar este doc antes de crear las plantillas.
4. **Plantillas de Meta.**
   - Crear 10 del pase: 2 por closer, con y sin nombre, con encabezado de video.
   - Crear 2 de confirmación en la WABA del número nuevo.
   - Esperar que Meta las apruebe.
   - Cargar cada `TMP…` en su escenario, en lugar de `PENDIENTE-…`. En el de confirmación, cargar también el número y el video.
5. **Planilla.**
   - Correr `node scripts/precall-v2-planilla.mjs` (en seco) y revisar lo que va a hacer.
   - Después correrlo con `--aplicar`. Agrega AM–AV con sus desplegables en Closer 1–5 y crea la pestaña «Pre-caller».
6. **Activar los 6 escenarios de Make.** Antes de cargar ninguna variable, y con la cola vacía. Mientras las variables no estén en Vercel, no les llega nada.
7. **Vercel (Production), primera tanda.**
   - Cargar los 5 `MAKE_WEBHOOK_PASE_*`.
   - Cargar `PRECALL_V2=1` y `PRECALL_V2_DESDE`, con la fecha y hora del encendido en ISO (por ejemplo `2026-11-20T00:00:00-03:00`). Solo las reuniones desde ese momento pasan por el pre-caller; las anteriores siguen con el closer como hoy.
   - Todavía **sin** `PRECALL_V2_ENVIO` y **sin** `MAKE_WEBHOOK_CONFIRMACION_PRECALLER`.
   - Redeploy.
8. **Prueba con un número propio.**
   - Mandar al escenario de confirmación del pre-caller, ya activo, un dato de prueba con el número propio → tiene que llegar la confirmación desde el número nuevo.
   - Cargar `PRECALL_V2_ENVIO=1` y redeploy.
   - En el Despacho, llevar la tarjeta de un lead de prueba de punta a punta → tiene que llegar el pase desde el WhatsApp del closer.
9. **Encender la confirmación al agendar.**
   - Cargar `MAKE_WEBHOOK_CONFIRMACION_PRECALLER` y redeploy.
   - Desde ahí, la confirmación al agendar sale del número del pre-caller y deja de salir de los escenarios de cada closer. No hace falta apagarlos: quedan como respaldo.
   - Agendar una Reunión Consultiva de prueba y verificar que llegue.
10. **Equipo y documentación.**
    - Avisar al pre-caller y a los closers.
    - Actualizar el SOP (el borrador está en `docs/SOP-PRECALL-V2-BORRADOR.md`; el doc PROCESOS VENTAS se edita con OK de Tomás).

**Para apagar:** sacar `PRECALL_V2` y hacer redeploy. Los datos de AM–AV quedan en la planilla. Los leads que ya pasaron al closer siguen con F, que el flujo de siempre entiende.
