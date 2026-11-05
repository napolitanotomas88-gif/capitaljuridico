# Pre-call v2 · encendido

Pedido de Tomás (5/11/2026): el pre-call se separa en dos partes.

- **Pre-caller.** Confirma lo que el lead puso en el calendario: día y hora, facturación, situación del estudio, decisores y urgencia. Trabaja desde un WhatsApp propio que va a funcionar como el de Tomás.
- **Closer.** Recibe al lead recién cuando el pre-caller lo pasa. En ese momento sale solo, desde el WhatsApp del closer, el video de traspaso con la cita y el video de pre-llamada (palabra LISTO).

**Estado: todo construido y APAGADO.** Falta el número de WhatsApp nuevo del pre-caller. Con `PRECALL_V2` sin cargar, el Despacho, la planilla y la confirmación al agendar funcionan igual que hoy.

## Qué hay construido

| Pieza | Dónde | Apagado = |
|---|---|---|
| Bandera general | `PRECALL_V2=1` (`lib/crm/config/precallV2.ts`) | El CRM de siempre |
| Envío del pase | `PRECALL_V2_ENVIO=1` + `MAKE_WEBHOOK_PASE_<CLOSER>` (`lib/crm/pasePrecall.ts`) | El pase escribe en la planilla, pero el WhatsApp no sale y el aviso dice «mandalo a mano» |
| Tarjeta del pre-caller | `accionPrecaller` en `lib/crm/motor/proxima-accion.ts` | No existe |
| Vista «Pre-caller · todos los closers» | `/ventas/closer/pre-caller` (`datosPrecaller` en `lib/crm/mi-dia.ts`) | Da 404 |
| Fases del closer v2 | `FASES_CLOSER_V2`: video LISTO → link | Las 4 fases de siempre |
| Columnas AM–AV | Pestañas Closer 1–5 (`scripts/precall-v2-planilla.mjs`) | No se leen ni se escriben (se lee hasta AK, como hoy) |
| Pestaña «Pre-caller» | Solo lectura, con fórmula QUERY (mismo script) | No existe |
| Confirmación al agendar desde el número del pre-caller | `variableWebhookAgenda` en `lib/confirmacionAgenda.ts` | Sale del WhatsApp de cada closer, como hoy |
| Escenarios de Make | Ver la tabla de abajo | Inactivos |

### Flujo del pre-caller (tarjeta en el Despacho)

1. **1ª llamada.** Botones: Atendió / No atendió.
2. **2ª llamada.** Botones: Atendió / No atendió.
3. **Pre-call por chat.** El pre-caller manda el texto del punto 3 de abajo y toca «Enviado por chat».
4. **Confirmación.**
   - Opciones: «Confirmó · decide solo», «Confirmó · vienen decisores» o «Reprogramó (ya en Calendly)».
   - Si el pre-call fue por chat, también hay seguimientos (S1 y S2). Sin respuesta después del S2: 🔴, y queda Cancelar reunión o Reagendar.
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

Los leads que al encender ya iban por el flujo viejo (F o AI con algo) lo terminan como estaban.

### Escenarios de Make (todos inactivos, equipo 1018145)

| Escenario | Id | Hook | Variable de Vercel |
|---|---|---|---|
| BORRADOR (NO ACTIVAR) - Pase al closer (Marcos) · pre-call v2 | 6916901 | 3027688 | `MAKE_WEBHOOK_PASE_MARCOS` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Carlos) · pre-call v2 | 6916905 | 3027689 | `MAKE_WEBHOOK_PASE_CARLOS` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Yamila) · pre-call v2 | 6916909 | 3027690 | `MAKE_WEBHOOK_PASE_YAMILA` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Nahuel) · pre-call v2 | 6916912 | 3027691 | `MAKE_WEBHOOK_PASE_NAHUEL` |
| BORRADOR (NO ACTIVAR) - Pase al closer (Brenda) · pre-call v2 | 6916916 | 3027692 | `MAKE_WEBHOOK_PASE_BRENDA` |
| BORRADOR (NO ACTIVAR) - Confirmación al agendar desde WhatsApp del pre-caller · pre-call v2 | 6916920 | 3027693 | `MAKE_WEBHOOK_CONFIRMACION_PRECALLER` |

- **Pase al closer.** Cada escenario sale del número del closer, con su video de traspaso actual y la conexión 2Chat 11150736. Ruta con nombre / sin nombre.
- **Confirmación al agendar.** Su número y su video dicen `PENDIENTE`.
- **Plantillas.** Todos los escenarios usan `template_uuid = PENDIENTE-…` hasta que Meta apruebe las plantillas.
- **Webhooks.** Las URLs no van en este repo, que es público: están en la nota privada de Tomás (`~/dashboard-metricas-backups/precall-v2-webhooks-2026-11-05.txt`).
- **Datos que manda el Despacho al pase:** `telefono`, `nombre` (primer nombre; vacío → plantilla sin nombre), `closer_completo`, `fecha_texto`, `hora_texto`, `pais_texto`, `inicio_iso`, `hoja` y `fila`. Hora y país salen de la reunión en Calendly; si Calendly no responde, se usa la hora de Argentina.

## Textos para el OK de Tomás

Las variables `{{n}}` las llena Make. Meta no deja que el texto **empiece** con una variable: por eso el «Hola» va antes del nombre.

### 1. Pase al closer: una plantilla por closer, con el video de traspaso actual en el encabezado

Con nombre ({{1}} = nombre, {{2}} = «jueves 12 de noviembre a las 15:00», {{3}} = «Argentina»):

> Hola {{1}}, cómo estás? Soy Marcos Carlomagno, consultor de estudios jurídicos del equipo de Gerónimo Actis.
>
> Nos vemos en la reunión el {{2}} (hora {{3}}), donde vamos a analizar tu estudio y ver qué te está frenando para sumar más clientes todos los meses.
>
> Para aprovecharla al máximo, mirá este video antes y mandame la palabra clave que te pido al final: https://capitaljuridico.com.ar/confirmarreunion

Sin nombre: igual, con «Hola, cómo estás?» al principio ({{1}} = fecha y hora, {{2}} = país).

Nombre y cargo de cada closer:

| Closer | Cómo se presenta |
|---|---|
| Marcos | Marcos Carlomagno, consultor |
| Carlos | Carlos Roletto, consultor |
| Yamila | Yamila Coutoune, consultora |
| Nahuel | Nahuel Milena, consultor |
| Brenda | Brenda Amado, consultora |

### 2. Confirmación al agendar, desde el WhatsApp del pre-caller (el de Tomás)

En el encabezado va un video de Tomás saludando, que falta grabar. {{1}} = nombre, {{2}} = fecha y hora, {{3}} = «argentino».

> Hola {{1}}, cómo estás?
>
> Confirmamos tu asistencia para la reunión de consultoría sobre tu estudio jurídico del {{2}} (horario {{3}})?

Sin nombre: «Hola, cómo estás?» y el mismo resto.

### 3. Pre-call por chat: lo manda el pre-caller a mano, si no atendió las 2 llamadas

> NOMBRE, te llamé para dejar lista tu reunión del DÍA a las HORA (hora PAÍS) con CLOSER y no pude dar con vos.
>
> Para que te sea realmente útil:
> 1) Conectate desde la compu, en un lugar tranquilo.
> 2) Reservate los 60 minutos completos.
> 3) No solemos reprogramar: si te surge algo, avisanos con 3 horas de anticipación.
>
> Confirmamos tu asistencia? Y hay alguien más que decida con vos en el estudio (socio, pareja, familiar) que pueda estar en la reunión?

### 4. Seguimientos del pre-caller por chat (los del SOP)

- **S1** (solo si la reunión es en menos de 24 h): «NOMBRE?»
- **S2:** «NOMBRE, confirmamos o liberamos el horario de la reunión?»

## Checklist de encendido (todo de una)

1. **Número del pre-caller.** Conectarlo en 2Chat por coexistencia y anotar su número.
2. **Video de Tomás.** Grabarlo, pasarlo a 576x1024 H.264 y publicarlo en `/v/` (capitaljuridico-medios).
3. **OK de Tomás.** Aprobar los textos 1 a 4 de arriba.
4. **Plantillas de Meta.**
   - Crear 10 del pase: 2 por closer, con y sin nombre, con encabezado de video.
   - Crear 2 de confirmación en la WABA del número nuevo.
   - Esperar que Meta las apruebe.
   - Cargar cada `TMP…` en su escenario, en lugar de `PENDIENTE-…`. En el de confirmación, cargar también el número y el video.
5. **Planilla.**
   - Correr `node scripts/precall-v2-planilla.mjs` (en seco) y revisar lo que va a hacer.
   - Después correrlo con `--aplicar`. Agrega AM–AV con sus desplegables en Closer 1–5 y crea la pestaña «Pre-caller».
6. **Vercel (Production).**
   - Cargar las 6 variables de la nota privada.
   - Cargar `PRECALL_V2=1`. Todavía **sin** `PRECALL_V2_ENVIO`.
   - Redeploy.
7. **Prueba con un número propio.**
   - Agendar una Reunión Consultiva de prueba → tiene que llegar la confirmación desde el número del pre-caller.
   - Activar SOLO el escenario del closer de esa prueba.
   - Cargar `PRECALL_V2_ENVIO=1` y redeploy.
   - En el Despacho, llevar la tarjeta de punta a punta → tiene que llegar el pase desde el WhatsApp del closer.
8. **Encender.**
   - Activar los 6 escenarios con la cola vacía. Revisar antes que no haya ejecuciones viejas en cola.
   - Con `PRECALL_V2=1` y el webhook del pre-caller cargado, la confirmación al agendar deja de salir de los escenarios de cada closer. No hace falta apagarlos: quedan como respaldo.
9. **Equipo y documentación.**
   - Avisar al pre-caller y a los closers.
   - Actualizar el SOP (el borrador está en `docs/SOP-PRECALL-V2-BORRADOR.md`; el doc PROCESOS VENTAS se edita con OK de Tomás).

**Para apagar:** sacar `PRECALL_V2` y hacer redeploy. Los datos de AM–AV quedan en la planilla. Los leads que ya pasaron al closer siguen con F, que el flujo de siempre entiende.
