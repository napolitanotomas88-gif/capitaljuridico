import { NextResponse, after } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { SECRETO_MAL_CONFIGURADO, verificarFirma } from '@/lib/fathomAnuncios/firma'
import { validarReunion } from '@/lib/fathomAnuncios/tipos'
import { motivoDe, procesarReunion } from '@/lib/fathomAnuncios/procesar'
import { baseConfigurada, leerPayload, ultimas } from '@/lib/fathomAnuncios/registro'
import { idDiscord } from '@/lib/fathomAnuncios/discord'
import { cronReintentos, depsReales, webhookDiscord } from '@/lib/fathomAnuncios/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Fathom → cambios de anuncios → Discord (@Valentino). Detalle en docs/FATHOM-ANUNCIOS.md.
// Formas de entrar, todas fallan cerrado:
//   · POST con cabeceras webhook-id / webhook-timestamp / webhook-signature → webhook de Fathom ("new meeting content
//     ready"). Se verifica la firma Standard Webhooks con FATHOM_WEBHOOK_SECRET (sin el secreto: 503, nunca se acepta
//     sin firma), se valida el payload y se responde 200 ENSEGUIDA; el trabajo (CRM, Claude, Discord) corre en after()
//     con hasta maxDuration. Fathom reintenta si tardamos, por eso no se lo hace esperar.
//   · POST con "Authorization: Bearer <CRON_SECRET>" y sin cabeceras de webhook → modo manual, sincrónico:
//       - ?recording_id=123 (sin cuerpo): reprocesa con el payload GUARDADO en el registro y retoma (reusa la
//         extracción y no repite los clientes ya mandados);
//       - sin recording_id: el cuerpo es el payload de Fathom;
//       - &forzar=1 re-extrae y manda TODO de nuevo aunque ya esté (duplica lo que ya había salido);
//       - &ignorar_kickoff=1 no mira el bot de kickoff (si clasificó mal un seguimiento como kickoff y hay que mandarlo);
//       - &dry=1 devuelve los mensajes y el resultado sin escribir en la base ni en Discord (con recording_id, la base
//         solo se LEE para traer el payload).
//     Solo por cabecera, nunca ?key= (queda en los logs).
//   · GET con Bearer CRON_SECRET → qué variables están configuradas y las últimas 10 grabaciones del registro.
//     Con ?reintentar=1 corre el cron de reintentos (lo mismo que /api/fathom-anuncios/reintentar, que es la ruta que
//     usa vercel.json: no está documentado que Vercel respete una query en el path de un cron).
// Otro método: 405 (Next). Los secretos se comparan en tiempo constante (firma.ts y lib/auth/acceso.ts).
const MAX_CUERPO = 5_000_000   // una llamada de 2 h con transcripción ronda los 300 KB
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

async function leerCuerpo(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CUERPO) return null
  const texto = await req.text()
  return texto.length > MAX_CUERPO ? null : texto
}

function parsear(texto: string): { ok: true; datos: unknown } | { ok: false } {
  try {
    return { ok: true, datos: JSON.parse(texto) }
  } catch {
    return { ok: false }
  }
}

async function webhookFathom(req: Request): Promise<NextResponse> {
  const secreto = process.env.FATHOM_WEBHOOK_SECRET?.trim()
  if (!secreto) {
    console.error('fathom-anuncios: falta FATHOM_WEBHOOK_SECRET — se rechazan todos los envíos de Fathom')
    return json({ error: 'no configurado' }, 503)
  }
  // El cuerpo CRUDO: la firma se calcula sobre el texto tal cual llegó (se parsea después)
  const cuerpo = await leerCuerpo(req)
  if (cuerpo === null) return json({ error: 'cuerpo demasiado grande' }, 413)
  const h = req.headers
  const firma = verificarFirma(secreto, { id: h.get('webhook-id'), timestamp: h.get('webhook-timestamp'), firma: h.get('webhook-signature') }, cuerpo)
  if (!firma.ok && firma.motivo === SECRETO_MAL_CONFIGURADO) {
    console.error('fathom-anuncios: FATHOM_WEBHOOK_SECRET no es un secreto whsec_<base64> válido — se rechazan todos los envíos de Fathom')
    return json({ error: 'no configurado' }, 503)
  }
  if (!firma.ok) return json({ error: 'firma inválida' }, 401)
  const p = parsear(cuerpo)
  if (!p.ok) return json({ error: 'JSON inválido' }, 400)
  const v = validarReunion(p.datos)
  if (!v.ok) return json({ error: v.error }, 400)
  const id = v.reunion.recording_id
  after(async () => {
    try {
      const r = await procesarReunion(p.datos, depsReales())
      console.log(`fathom-anuncios: grabación ${id} → ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}`)
    } catch (e) {
      console.error(`fathom-anuncios: grabación ${id} — falla inesperada:`, motivoDe(e))
    }
  })
  return json({ recibido: true })
}

/** recording_id de la query: entero positivo, o null si no vino; undefined si vino mal. */
function idDeQuery(u: URL): number | null | undefined {
  const crudo = u.searchParams.get('recording_id')
  if (crudo === null) return null
  const n = Number(crudo.trim())
  return /^\d{1,16}$/.test(crudo.trim()) && Number.isSafeInteger(n) && n > 0 ? n : undefined
}

async function manual(req: Request): Promise<NextResponse> {
  const u = new URL(req.url)
  const dry = u.searchParams.get('dry') === '1', forzar = u.searchParams.get('forzar') === '1', ignorarKickoff = u.searchParams.get('ignorar_kickoff') === '1'
  const id = idDeQuery(u)
  if (id === undefined) return json({ error: 'recording_id inválido (tiene que ser un entero positivo)' }, 400)
  let payload: unknown
  if (id !== null) {
    // Reintento por id: el payload que se guardó al reclamar (se borra cuando la grabación llega a un estado final)
    if (!baseConfigurada()) return json({ error: 'falta DATABASE_URL' }, 503)
    let fila: Awaited<ReturnType<typeof leerPayload>>
    try {
      fila = await leerPayload(id)
    } catch (e) {
      return json({ error: `no se pudo leer el registro: ${motivoDe(e)}` }, 503)
    }
    if (!fila) return json({ error: `la grabación ${id} no está en el registro` }, 404)
    if (fila.payload === null) {
      return json({ error: `la grabación ${id} no tiene el payload guardado (estado ${fila.estado}): si hay que reprocesarla, mandá el payload de Fathom en el cuerpo, sin recording_id` }, 409)
    }
    payload = fila.payload
  } else {
    const cuerpo = await leerCuerpo(req)
    if (cuerpo === null) return json({ error: 'cuerpo demasiado grande' }, 413)
    const p = parsear(cuerpo)
    if (!p.ok) return json({ error: 'JSON inválido' }, 400)
    payload = p.datos
  }
  const r = await procesarReunion(payload, depsReales(), { dry, forzar, ignorarKickoff })
  if (r.estado === 'invalida') return json({ error: r.motivo }, 400)
  if (dry) return json({ estado: r.estado, motivo: r.motivo ?? null, mensajes: r.mensajes ?? [], resultado: r.resultado ?? null, modelo: r.modelo ?? null, usage: r.usage ?? null, kickoff: r.kickoff ?? null })
  return json(r, r.estado === 'error' ? 500 : 200)
}

export async function POST(req: Request) {
  const h = req.headers
  if (h.has('webhook-id') || h.has('webhook-timestamp') || h.has('webhook-signature')) return webhookFathom(req)
  if (accesoMaquina(h)) return manual(req)
  return json({ error: 'no autorizado' }, 401)
}

export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return json({ error: 'no autorizado' }, 401)
  if (new URL(req.url).searchParams.get('reintentar') === '1') return cronReintentos()
  const configurado = {
    anthropic: !!process.env.ANTHROPIC_API_KEY?.trim(),
    firma_fathom: !!process.env.FATHOM_WEBHOOK_SECRET?.trim(),
    discord: !!webhookDiscord(),
    valentino: !!idDiscord(process.env.DISCORD_ID_VALENTINO),
    base: baseConfigurada(),
  }
  let filas: Awaited<ReturnType<typeof ultimas>> = []
  let errorBase: string | null = null
  if (configurado.base) {
    try {
      filas = await ultimas(10)
    } catch (e) {
      errorBase = motivoDe(e)
    }
  }
  return json({ configurado, ultimas: filas, ...(errorBase ? { error_base: errorBase } : {}) })
}
