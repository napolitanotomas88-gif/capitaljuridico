# Pre-call v2 · encendido

Pedidos de Tomás (5 y 6/11/2026): el pre-call se separa en dos partes.

- **Pre-caller.** Llama al lead y confirma lo que puso en el calendario: día y hora, facturación, situación del estudio, decisores y urgencia. Trabaja desde un WhatsApp propio que va a funcionar como el de Tomás.
- **Closer.** Recibe al lead recién cuando el pre-caller lo pasa. En ese momento sale solo, desde el WhatsApp del closer, el video de traspaso con la cita y el video de pre-llamada (palabra LISTO).

**Al agendar no sale ningún mensaje.** Lo primero que pasa es la llamada del pre-caller. Con el pre-call nuevo encendido, tampoco salen las confirmaciones automáticas de cada closer.

**Estado: todo construido y APAGADO.** Falta el número de WhatsApp nuevo del pre-caller. Con `PRECALL_V2` sin cargar, el Despacho, la planilla y la confirmación al agendar funcionan igual que hoy.

## Los 2 mensajes automáticos

| Botón de la tarjeta | Sale desde | Mensaje | Cuándo |
|---|---|---|---|
| «Llamada no efectiva» (no atendió las 2 llamadas) | WhatsApp del pre-caller | Texto 2, sin video | Enseguida |
| «Llamada efectiva» (atendió y se hizo el guion) | WhatsApp del closer | Texto 1, con el video de traspaso | A los 3 minutos |
| «Pre-call hecho» (terminó por chat) | WhatsApp del closer | Texto 1, con el video de traspaso | Enseguida |

## Qué hay construido

| Pieza | Dónde | Apagado = |
|---|---|---|
| Bandera general | `PRECALL_V2=1` + `PRECALL_V2_DESDE` (`lib/crm/config/precallV2.ts`) | El CRM de siempre |
| Envío de los 2 mensajes | `PRECALL_V2_ENVIO=1` + los webhooks (`lib/crm/pasePrecall.ts`) | El botón escribe en la planilla, pero el WhatsApp no sale y el aviso dice «mandalo a mano» |
| Sin confirmación al agendar | `confirmacionAgendaApagadaPorV2` (`lib/confirmacionAgenda.ts`) | Sale la confirmación de cada closer, como hoy |
| Tarjeta del pre-caller | `accionPrecaller` en `lib/crm/motor/proxima-accion.ts` | No existe |
| Vista «Pre-caller · todos los closers» | `/ventas/closer/pre-caller` | Da 404 |
| Fases del closer v2 | `FASES_CLOSER_V2`: video LISTO → link | Las 4 fases de siempre |
| Columnas AM–AV | Todas las pestañas de ventas (`scripts/precall-v2-planilla.mjs`) | No se leen ni se escriben (se lee hasta AK, como hoy) |
| Pestaña «Pre-caller» | Solo lectura, con fórmula QUERY (mismo script) | No existe |
| Escenarios de Make | Ver la tabla de abajo | Inactivos |

### Flujo del pre-caller (tarjeta en el Despacho)

1. **Llamar (hasta 2 veces seguidas).** Las 2 llamadas van en el momento, sin esperar entre una y otra. Botones: «Llamada efectiva» / «Llamada no efectiva».
2. **Si atiende alguna de las 2:**
   - Hace el guion del PASO 2 y le avisa que le va a escribir el consultor (Carlos, Marcos o el que corresponda). Corta.
   - Toca «Llamada efectiva». Se abre el formulario del pase: decisores, facturación, situación y urgencia (precargadas con lo del calendario) y notas para el closer.
   - El lead pasa al closer y a los 3 minutos sale el mensaje del closer.
3. **Si no atiende ninguna:** toca «Llamada no efectiva» y sale solo el mensaje del pre-caller (texto 2). Sigue la escalera por chat, a mano: «¿Pudiste leerme?» → decisores (2 h después) → seguimiento de decisores → ultimátum. Cada paso se marca con «Enviado (n de 4)». Sin respuesta al ultimátum: 🔴 y «Cancelar reunión».
4. **Si confirma por chat**, en cualquier paso: «Confirmó · decide solo», «Confirmó · vienen decisores», «Confirmó (falta decisores)» o «Reprogramó (ya en Calendly)».
   - Si faltan los decisores, la tarjeta pide la pregunta.
   - Después se manda el mensaje con las 3 recomendaciones (texto 3) y se toca «Pre-call hecho»: el mensaje del closer sale enseguida.
5. **Lo que escribe el pase:**

   | Columna | Valor |
   |---|---|
   | AT | Pasado al closer |
   | F | CONF + DECISORES (el closer arranca en el video LISTO) |
   | AI | Efectiva / No efectiva (la métrica sigue funcionando) |
   | AO | Decisores |
   | AU | Fecha y hora del pase |

6. **Regla dura.** Sin pase, el closer no ve al lead: ni el pre-call ni «¿Se presentó?».
   - Si la reunión pasa sin pase, la tarjeta pide reagendar en Calendly o «Liberar».
   - «Liberar» nunca pisa un «¿Se presentó?» ya cargado.
7. **Dos seguimientos de show-up.**
   - El del pre-caller, para que el lead confirme (este flujo).
   - El del closer, cuando el lead ya pasó y no se presentó (la tarjeta de No-show de siempre).

Solo entran al flujo nuevo las reuniones desde `PRECALL_V2_DESDE` que nadie empezó por el flujo viejo (F y AI vacías). Las reuniones anteriores siguen con el closer como siempre.

### Escenarios de Make (todos inactivos)

Yamila y Brenda ya no están en la empresa (6/11): sus borradores quedaron renombrados como OBSOLETO, apagados, y no se usan. Quedan los pases de Marcos, Carlos y Nahuel.

| Escenario | Variable de Vercel |
|---|---|
| BORRADOR (NO ACTIVAR) - Pase al closer (Marcos) · pre-call v2 | `MAKE_WEBHOOK_PASE_MARCOS` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Carlos) · pre-call v2 | `MAKE_WEBHOOK_PASE_CARLOS` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Nahuel) · pre-call v2 | `MAKE_WEBHOOK_PASE_NAHUEL` |
| BORRADOR (NO ACTIVAR) - Llamada no efectiva desde WhatsApp del pre-caller · pre-call v2 | `MAKE_WEBHOOK_NO_EFECTIVA` |

- **Pase al closer.** Cada escenario sale del número del closer, con su video de traspaso actual. Primero espera `espera_segundos`: 180 desde la llamada, 1 desde el chat. Ruta con nombre / sin nombre.
- **Llamada no efectiva.** Sin video. Su número dice `PENDIENTE`.
- **Plantillas.** Todos los escenarios usan `template_uuid = PENDIENTE-…` hasta que Meta apruebe las plantillas.
- **Ids y webhooks.** Las URLs de los webhooks y los ids de Make no van en este repo, que es público: están en la nota privada de Tomás.
- **Datos que manda el Despacho:** `telefono`, `nombre` (primer nombre; vacío → plantilla sin nombre), `closer_completo`, `fecha_texto`, `hora_texto`, `pais_texto`, `inicio_iso`, `hoja`, `fila` y `espera_segundos`. Hora y país salen de la reunión en Calendly; si Calendly no responde, se usa la hora de Argentina.

## Textos (todos con el OK de Tomás, 6/11)

Las variables `{{n}}` las llena Make. Meta no deja que el texto **empiece** con una variable: por eso el «Hola» va antes del nombre.

### 1. Pase al closer: una plantilla por closer, con el video de traspaso actual en el encabezado (OK de Tomás 5 y 6/11)

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
| Nahuel | Nahuel Milena, consultor |

### 2. Llamada no efectiva: desde el WhatsApp del pre-caller, sin video (OK de Tomás 6/11)

Con nombre ({{1}} = nombre, {{2}} = fecha y hora, {{3}} = país):

> Hola {{1}}, cómo estás? Soy Gerónimo Actis.
>
> Hace unos minutos te llamé por la reunión de consultoría sobre tu estudio jurídico del {{2}} (hora {{3}}), para analizar cómo podemos hacerlo crecer comercialmente.
>
> Confirmamos tu asistencia?

Sin nombre: «Hola, cómo estás? Soy Gerónimo Actis.» y el mismo resto ({{1}} = fecha y hora, {{2}} = país).

### 3. Pre-caller por chat: los manda a mano desde el WhatsApp del pre-caller, después del texto 2 (OK de Tomás 5 y 6/11)

**a) Si no responde el texto 2:**
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

**Cuando confirma por chat:** si todavía no dijo nada de los decisores, se le manda la pregunta b). Cuando responde, va este mensaje y se toca «Pre-call hecho», sin esperar respuesta:
> Perfecto NOMBRE. Para que la reunión te sea realmente útil, te recomiendo:
> 1) Conectate desde la compu, en un lugar tranquilo.
> 2) Reservate los 60 minutos completos.
> 3) No solemos reprogramar: si te surge algo, avisanos con 3 horas de anticipación.
>
> Te va a estar contactando NOMBRE Y APELLIDO DEL CLOSER, consultor del equipo, para mandarte el link de la reunión y seguir con el proceso. Muchos éxitos!

## Checklist de encendido (todo de una)

El orden importa: ninguna variable apunta a un escenario apagado, porque Make guardaría en cola mensajes para leads reales.

1. **Número del pre-caller.** Conectarlo en 2Chat por coexistencia y anotar su número.
2. **Textos.** Ya tienen el OK de Tomás (6/11). Si cambia alguno, actualizar este doc antes de crear las plantillas.
3. **Plantillas de Meta.**
   - Crear 6 del pase: 2 por closer (Marcos, Carlos y Nahuel), con y sin nombre, con encabezado de video.
   - Crear 2 de «Llamada no efectiva» (con y sin nombre, sin video) en la WABA del número nuevo.
   - Esperar que Meta las apruebe.
   - Cargar cada `TMP…` en su escenario, en lugar de `PENDIENTE-…`. En el de «Llamada no efectiva», cargar también el número.
4. **Planilla.**
   - Correr `node scripts/precall-v2-planilla.mjs` (en seco) y revisar lo que va a hacer.
   - Después correrlo con `--aplicar`. Agrega AM–AV con sus desplegables en todas las pestañas de ventas (el CRM las lee todas) y crea la pestaña «Pre-caller» con Closer 1, 2 y 4.
5. **Activar los 4 escenarios de Make** (los 3 pases y «Llamada no efectiva»; los OBSOLETO no se tocan). Antes de cargar ninguna variable, y con la cola vacía. Mientras las variables no estén en Vercel, no les llega nada.
6. **Vercel (Production).**
   - Cargar `MAKE_WEBHOOK_PASE_MARCOS`, `MAKE_WEBHOOK_PASE_CARLOS`, `MAKE_WEBHOOK_PASE_NAHUEL` y `MAKE_WEBHOOK_NO_EFECTIVA`.
   - Cargar `PRECALL_V2=1` y `PRECALL_V2_DESDE`, con la fecha y hora del encendido en ISO (por ejemplo `2026-11-20T00:00:00-03:00`). Solo las reuniones desde ese momento pasan por el pre-caller.
   - Desde este redeploy, al agendar no sale ningún WhatsApp.
   - Todavía **sin** `PRECALL_V2_ENVIO`.
   - Redeploy.
7. **Prueba con un número propio.**
   - Cargar `PRECALL_V2_ENVIO=1` y redeploy.
   - En el Despacho, con un lead de prueba con el número propio:
     - «Llamada no efectiva» → tiene que llegar el texto 2 desde el número del pre-caller.
     - Otro lead de prueba: «Llamada efectiva» → a los 3 minutos tiene que llegar el pase desde el WhatsApp del closer.
8. **Equipo y documentación.**
   - Avisar al pre-caller y a los closers.
   - Actualizar el SOP (el borrador está en `docs/SOP-PRECALL-V2-BORRADOR.md`; el doc PROCESOS VENTAS se edita con OK de Tomás).

**Para apagar:** sacar `PRECALL_V2` y hacer redeploy. Vuelve la confirmación al agendar de cada closer. Los datos de AM–AV quedan en la planilla. Los leads que ya pasaron al closer siguen con F, que el flujo de siempre entiende.
