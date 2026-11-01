# Edición (f01–f06): estado y checklist de encendido

Actualizado el 1/11/2026. Sin datos de clientes ni valores de variables: solo nombres y conteos. La sesión «Bot C.J. · Grabación (e01–e05)» suma sus ítems al final (e01 por WhatsApp solo corre con Edición en real).

## Estado por tarea

| Tarea | Qué hace | Código | Encendido |
|---|---|---|---|
| f01 Tablero y aviso al editor | Tablero de tarjetas en `/clientes/edicion` (8 columnas de ClickUp) y aviso a René al pasar a «Para editar» o al devolver con nota | Hecho | En uso: `EDICION_MODO=real`, tarjetas importadas, vigía cada 15 min, avisos a #✂️-edicion |
| f02 René mueve a listos | René pasa a Editado/Corregido; el aviso a Aylu sale solo, agrupado por cliente | Hecho | Encendido con f01 |
| f03 Check de Aylu | Aylu revisa errores y ortografía: si está bien, pasa a «Revisión» (con link del editado); si no, devuelve con nota (le avisa a René) | Hecho | Encendido con f01 |
| f04 Link final al cliente | Al pasar a «Revisión», la entrega queda en cola y el bot la manda al grupo «Contenido - …» | Hecho | **Apagado**: falta `EDICION_WHATSAPP=real` + `EDICION_WHATSAPP_DESDE` y el bot dentro de los grupos |
| f05 Correcciones del cliente | El bot lee el grupo Contenido, separa los cambios en notas (pedido `propuesto`), marca si conviene mirarlo y espera el check de Aylu | **Nuevo (este PR)** | **Apagado**: `EDICION_LECTURA=real` |
| f06 OK del cliente | El bot detecta el OK en el grupo Contenido y lo deja para confirmar con un botón (con la cita); al confirmar, aviso a Ads | **Nuevo (este PR)** | **Apagado**: `EDICION_LECTURA=real` |

## Cómo funciona la lectura del grupo Contenido (f05 / f06)

1. El webhook de Whapi (`lib/bot/whapi/ruta.ts`) pasa a Edición los textos de **clientes** en grupos de clientes (nunca del equipo ni del bot), con menos de 48 h y alguna señal de OK o de cambio (`lib/edicion/contenido.ts`).
2. Solo se guarda si el grupo es el **Contenido** de un cliente con videos **«Con el cliente»**. Si no, es de Guiones u otra cosa y no se toca.
3. Claude (por el puente a la Mac, `CLAUDE_VIA=mac`) clasifica: OK, cambios, OK con cambios u otra cosa; qué videos nombra; y si conviene mirarlo antes de pasarlo a René. Sin Mac: lectura por palabras, marcada «mirarlo».
4. A qué video va: al citado (la entrega del bot), al «video N» que nombra o al único que está con el cliente. Si no queda claro, queda «falta elegir el video».
5. Resultado, siempre como propuesta:
   - **Cambios para un video** → pedido `propuesto` con las notas separadas (el mismo que arma Aylu al pegar el mensaje). Aylu tilda y confirma; la 3.ª ronda sigue esperando a Tomás (P6).
   - **OK** → «Confirmar el OK» en la ficha del cliente, con la cita del mensaje. Recién ahí pasa a Aprobado y avisa a Ads.
   - **No queda claro** → Aylu abre el video y lo carga a mano.
6. Un aviso a Aylu en #✂️-edicion por mensaje (con `EDICION_AVISOS=dry` no sale: queda solo en el Despacho). Arriba del tablero aparece «Grupo Contenido: N mensajes para revisar».
7. El bot **solo lee**: nunca escribe en un grupo ni le contesta al cliente.

Tabla nueva: `cj_edicion_lecturas` (migración v3, se crea sola en la primera escritura). Guarda el texto del mensaje y la lectura; ni teléfonos ni nombres del autor.

## Checklist de encendido (Tomás)

Ya está: `EDICION_MODO`, `EDICION_FECHA_CORTE`, `EDICION_REVISOR_AYLU`, `EDICION_EDITOR_RENE`, `EDICION_EQUIPO_DRIVE`, `VIGIA_SECRETO`, `ASSEMBLYAI_*`, `DISCORD_WEBHOOK_EDICION`, `DISCORD_ID_AYLU`, `DISCORD_ID_RENE`, `CLICKUP_*`, `CLAUDE_VIA`, `WHAPI_TOKEN`.

1. **Mergear este PR** (publica la lectura apagada y la migración v3).
2. **Que Aylu y René usen el tablero** del Despacho en vez de ClickUp (ClickUp queda de consulta). Al 1/11 la cola de entregas del tablero estaba vacía (ninguna tarjeta pasó a «Revisión» desde el Despacho).
3. **Aylu confirma los vínculos de carpetas** en `/clientes/edicion/vinculos` (46 por confirmar al 1/11; las 16 dudosas que se le avisaron deberían estar entre ellas).
4. **Webhook de #ads** → `DISCORD_WEBHOOK_KICKOFF_ADS` (sin él, el aviso de «OK del cliente» para Valen va a #✂️-edicion).
5. **Lectura del grupo Contenido (f05/f06), en sombra 1–2 días:** `EDICION_LECTURA=real` + `EDICION_AVISOS=dry` (ojo: esto también silencia los demás avisos de Edición; si no se quiere, saltear la sombra y encender directo). Requiere el bot dentro de los grupos Contenido.
6. **Entrega del link al cliente (f04):** `EDICION_WHATSAPP=real` + `EDICION_WHATSAPP_DESDE=<fecha y hora de encendido>`. Recién con el número calentado y el bot en los grupos. Primero una prueba en un grupo interno.
7. **Opcional:** `EDICION_REVISOR_TOMAS` (si no, usa `KICKOFF_REVISOR_TOMI`).

### Ítems de Grabación (los pasa la sesión Grabación)

- `E01_WHATSAPP=real` y `E01_WHATSAPP_DESDE=<fecha de encendido>`.
- El bot dentro de cada grupo «Contenido - <cliente>», con el número en AUTH y calentado.
- Una prueba controlada en un grupo interno antes.
- Va después del encendido de Edición.

## Apagar

- f05/f06: sacar `EDICION_LECTURA` (o ponerla en otra cosa que `real`). Lo ya leído queda en la base.
- f04: sacar `EDICION_WHATSAPP`. Las entregas pendientes quedan en espera y no se mandan solas al volver (corte por `EDICION_WHATSAPP_DESDE`).
