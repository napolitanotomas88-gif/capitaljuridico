# Encendido general · 2/11/2026

Tomás pidió prender todo el 2/11/2026. Este documento dice qué se prendió, con qué variable y cómo apagar cada cosa.
Los valores privados (grupos, cuentas, teléfonos) están solo en Vercel, nunca en el repo.

WhatsApp seguro sigue vigente en todo: chequeo de `/health` del número antes de escribir, topes por día y por pasada, horario,
nada de crear grupos sumando clientes (`BOT_COMUNIDAD_AGREGAR_DIRECTO` no se toca) y nada de tandas de atrasados (cortes `*_DESDE`).

## Qué se prendió (Vercel · Production)

| Pieza | Variable(s) | Valor | Freno |
|---|---|---|---|
| NOTIF: avisos del Despacho a los grupos del equipo | `NOTIF_WHATSAPP`, `WHAPI_GRUPO_EDICION`, `WHAPI_GRUPO_OPERACIONES`, `WHAPI_GRUPO_CSM` | `real` + ids de grupos del equipo | solo grupos `WHAPI_GRUPO_*`, 8 por día, 5 min entre mensajes, 9 a 20 h, nada de más de 48 h |
| f05/f06: lectura del grupo Contenido | `EDICION_LECTURA` | `real` | solo lee y deja propuestas |
| d03: respuesta del cliente → nota en la tanda | `BOT_GUIONES_REENVIO` | sin cargar (= prendido) | interno |
| g03: campañas en borrador en Meta | `ANUNCIOS_BORRADOR` = `real`; se borró `ANUNCIOS_BORRADOR_SOLO` | todas las cuentas con ficha de kickoff | todo en PAUSA en Meta, aviso a #ads |
| b04/b07: comunidad y bienvenida | `BOT_ALTA_PASOS_REALES` (+`comunidad`,`bienvenida`), `BOT_ALTA_MAX_COMUNIDADES_DIA` | `1` | solo el equipo en los grupos; el cliente entra por link; 1 por día |
| e01: seguimiento de grabación | `E01_WHATSAPP`, `E01_WHATSAPP_DESDE` | `real`, `2026-11-02` | días hábiles 10 a 19 h, 10 por vuelta, 1 por cliente |
| f04: video final al cliente | `EDICION_WHATSAPP`, `EDICION_WHATSAPP_DESDE` | `real`, ISO UTC del encendido | 1 cliente por pasada, eventos de menos de 24 h posteriores al corte |
| g04: aviso al grupo Ventas del cliente | `ANUNCIOS_WHATSAPP`, `ANUNCIOS_WHATSAPP_SOLO`, `ANUNCIOS_WHATSAPP_GRUPOS` | `real` + solo las cuentas con grupo fijado | grupo fijo por cuenta (sin adivinar por nombre), 15 por corrida, solo lo nuevo |
| h01–h03 Éxito | `BOT_EXITO_MODO` | `real` | todo pide OK en Verificaciones antes de escribir al cliente |
| i01–i05 Bajas | `BOT_BAJAS_MODO` | `real` | aviso, despedida y quitar de grupos piden OK en Verificaciones |
| d02: link de guiones al cliente | `GUIONES_WHATSAPP`, `GUIONES_WHATSAPP_DESDE` | `real`, ISO UTC del encendido | solo aprobaciones posteriores al corte y de menos de 24 h, 9 a 20 h, una vez por aprobación |

## Cambios de código de este encendido

- **Éxito y Bajas** (`lib/bot/exito/almacenNeon.ts`, `lib/bot/bajas/almacenNeon.ts`): el cliente de Neon ya no se guarda en caché.
  La señal `AbortSignal.timeout(10 s)` corría desde que se creaba el cliente, así que a los 10 s todas las consultas abortaban
  («Error connecting to database») y las tablas `cj_exito_*` / `cj_bajas_*` nunca se creaban. Ahora es un cliente por consulta, como Altas.
- **Grupo Contenido fijo por cliente** (`lib/bot/whapi/gruposFijos.ts`): `WHAPI_GRUPOS_CONTENIDO = {"<ID del CRM o nombre>":"…@g.us"}`.
  Los grupos tienen nombres cortos («Contenido - XX») que la búsqueda por todas las palabras del nombre del CRM no encuentra.
  Lo usan d02, e01 y f04. El grupo fijado solo vale si el bot está en él. Sin la variable, todo sigue como antes.
- **d02 conectado** (`lib/bot/guiones/whatsappCliente.ts`, `publicacion.ts`): al aprobar, si sale el WhatsApp la tanda pasa a
  «enviada» y no se crea el aviso de entrega manual; si no sale (apagado, fuera de horario, sin grupo, error), queda el aviso
  a Aylu/Gero como siempre. Un «reenviar» de una tanda aprobada antes del corte nunca le escribe al cliente.

## Cómo apagar

Cada pieza por separado (después hace falta un redeploy de producción, o el próximo merge a main):

```
printf 'apagado' | vercel env add NOTIF_WHATSAPP production --force
printf 'apagado' | vercel env add EDICION_LECTURA production --force
printf 'apagado' | vercel env add ANUNCIOS_BORRADOR production --force
printf 'reporte_verificaciones,mensajes_equipo,finanzas,crm,drive,contrato' | vercel env add BOT_ALTA_PASOS_REALES production --force
printf 'apagado' | vercel env add E01_WHATSAPP production --force
printf 'apagado' | vercel env add EDICION_WHATSAPP production --force
printf 'apagado' | vercel env add ANUNCIOS_WHATSAPP production --force
printf 'ensayo' | vercel env add BOT_EXITO_MODO production --force
printf 'ensayo' | vercel env add BOT_BAJAS_MODO production --force
printf 'apagado' | vercel env add GUIONES_WHATSAPP production --force
printf 'no' | vercel env add BOT_GUIONES_REENVIO production --force
```

Todo de golpe: correr el bloque entero y después `vercel redeploy <url del último deployment de producción> --target production`
(desde una carpeta enlazada al proyecto `dashboard-metricas`). Si el número del bot se cae, la guardia de `/health` ya frena
todos los envíos por Whapi sin tocar nada.
