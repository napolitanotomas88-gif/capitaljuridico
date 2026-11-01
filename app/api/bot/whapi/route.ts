import { after } from 'next/server'
import { crearMotorAltas } from '@/lib/bot/alta/motor'
import { clienteWhapiDesdeEntorno } from '@/lib/bot/whapi'
import { reenviarGuionesReal } from '@/lib/bot/whapi/guiones'
import { procesarExitoReal } from '@/lib/bot/exito/servidor'
import { procesarBajasReal } from '@/lib/bot/bajas/servidor'
import { procesarNotasReal } from '@/lib/bot/anuncios/notasServidor'
import { procesarContenidoReal } from '@/lib/edicion/contenidoServidor'
import { FRENO_BARRIDO, atenderEstado, atenderWebhook } from '@/lib/bot/whapi/ruta'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Webhook de Whapi.Cloud del bot "Capital Jurídico" (alta de clientes). Detalle en docs/BOT-WHAPI-CJ.md y la lógica en
// lib/bot/whapi/ruta.ts (probada sin Next en scripts/test-bot-whapi.mjs). Formas de entrar, las dos fallan cerrado:
//   · POST de Whapi con el header x-cj-bot-secreto = WHAPI_WEBHOOK_SECRETO (Whapi no firma: el header se configura con
//     PATCH /settings, scripts/bot-whapi-configurar.mjs). Solo cuentan "Ventas C.J." y "Verificaciones C.J"
//     (WHAPI_GRUPO_VENTAS / WHAPI_GRUPO_VERIFICACIONES). Responde 200 enseguida; el motor trabaja en after() hasta maxDuration.
//     Además, los textos de los grupos «Contenido - <cliente>» se reenvían en after() a /api/bot/guiones/respuesta
//     (lib/bot/whapi/guiones.ts; se apaga con BOT_GUIONES_REENVIO=no).
//     Y la etapa Éxito (lib/bot/exito/*, docs/BOT-EXITO-CJ.md): mensajes y videos de los clientes en sus 3 grupos y los OK / NO a
//     los pedidos de testimonio, en after(). Nace en seco (BOT_EXITO_MODO); BOT_EXITO=no la apaga del todo.
//     Y la etapa Bajas (lib/bot/bajas/*, docs/BOT-BAJAS-CJ.md): los OK / NO citando sus pedidos en Verificaciones, en after().
//     Nace en seco (BOT_BAJAS_MODO); BOT_BAJAS=no la apaga del todo.
//     Y las notas del cliente para Anuncios (lib/bot/anuncios/notas.ts): lo que el cliente dice de sus anuncios en su grupo,
//     SOLO lectura, a Anuncios → «Notas del cliente» y aviso a Valen en #📣-ads. ANUNCIOS_NOTAS=0 lo apaga.
//   · GET con "Authorization: Bearer <CRON_SECRET>": modo, capacidades y los NOMBRES de las variables que faltan.
// Sin la configuración explícita del modo real (BOT_ALTA_MODO y BOT_ALTA_PASOS_REALES), el motor corre en SECO: no escribe en
// Sheets, Drive ni PandaDoc y no manda mensajes (la compuerta de lib/bot/whapi/compuerta.ts frena todo lo que sale).
export async function POST(req: Request) {
  return atenderWebhook(req, { crearMotor: crearMotorAltas, clienteWhapi: clienteWhapiDesdeEntorno, programar: (tarea) => after(tarea), frenoBarrido: FRENO_BARRIDO, reenviarGuiones: reenviarGuionesReal, procesarExito: procesarExitoReal, procesarBajas: procesarBajasReal, procesarNotasAnuncios: procesarNotasReal, procesarContenidoEdicion: procesarContenidoReal })
}

export async function GET(req: Request) {
  return atenderEstado(req)
}
