import { NextResponse } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { agregarNota, baseConfigurada, tandaPorCliente, tandaPorGrupo } from '@/lib/bot/guiones/registro'
import { tokenWhapi } from '@/lib/bot/whapi/config'
import { registrarActividadInactivos } from '@/lib/clientes/inactivos'
import { dispararPaso, motorGuiones } from '@/lib/bot/guiones/servidor'
import { ClienteArchivadoError, exigirClienteNoArchivado } from '@/lib/clientes/archivados'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Respuesta del cliente a sus guiones (d03): el webhook de Whapi (sesión CONSULTOR) reenvía acá los mensajes de los grupos
// «Contenido - <cliente>» con Bearer CRON_SECRET: { grupo: "…@g.us", texto, mensaje_id?, autor?, citado?, fecha? }. Si en ese
// grupo se avisó una tanda, el texto queda como nota (origen whatsapp) y, si la tanda estaba enviada o para revisar, el bot
// la corrige solo (paso «notas» de /api/bot/guiones) y avisa al equipo para el check de Tomi o Faus (pedido del 25/10).
// Si la tanda no tiene ese grupo guardado (el aviso lo mandó una persona porque el WhatsApp del bot está apagado), se busca
// por el nombre del grupo («Contenido - <cliente>», GET /groups/{id} de Whapi) la última tanda de ese cliente.
// Sin tanda → 200 con ignorado. Los mensajes del bot o del equipo los filtra quien llama. Falla cerrado.
const r = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status })

export async function POST(req: Request) {
  if (!process.env.CRON_SECRET?.trim()) return r(503, { ok: false, motivo: 'falta CRON_SECRET' })
  if (!accesoMaquina(req.headers)) return r(401, { ok: false })
  if (!baseConfigurada()) return r(503, { ok: false, motivo: 'falta DATABASE_URL' })
  let b: Record<string, unknown>
  try { b = (await req.json()) as Record<string, unknown> } catch { return r(400, { ok: false, motivo: 'JSON inválido' }) }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return r(400, { ok: false, motivo: 'JSON inválido' })
  const grupo = typeof b.grupo === 'string' ? b.grupo.trim() : ''
  const texto = typeof b.texto === 'string' ? b.texto.replace(/\s+/g, ' ').trim().slice(0, 2000) : ''
  if (!/^[0-9-]{5,40}@g\.us$/.test(grupo) || !texto) return r(400, { ok: false, motivo: 'grupo o texto inválido' })
  try {
    let fila = await tandaPorGrupo(grupo)
    if (!fila) {
      const nombre = await nombreGrupo(grupo)
      const cliente = nombre?.match(/^\s*contenido\s*-\s*(.+)$/i)?.[1]
      if (cliente) fila = await tandaPorCliente(cliente)
    }
    if (!fila) return r(200, { ok: true, ignorado: 'no hay una tanda avisada en ese grupo' })
    await exigirClienteNoArchivado(fila.id_crm)
    const fecha = typeof b.fecha === 'string' && Number.isFinite(Date.parse(b.fecha)) && Date.parse(b.fecha) <= Date.now() + 60_000 ? new Date(b.fecha).toISOString() : new Date().toISOString()
    if (fila.id_crm) await registrarActividadInactivos({ idCrm: fila.id_crm, tipo: 'cliente', cuando: fecha, chatId: grupo, origen: 'guiones-whapi' })
    const corregir = await agregarNota(fila.id, { texto, guion: null, cuando: fecha, origen: 'whatsapp' })
    // Con el motor local, la Mac toma la tanda con_notas (tandasParaLocal); con la API, se corrige acá
    if (corregir && motorGuiones() === 'api') await dispararPaso('notas', { id: fila.id }).catch(e => console.error('bot-guiones: no arrancó la corrección —', (e as Error)?.message))
    return r(200, { ok: true, tanda: fila.id, corrigiendo: corregir })
  } catch (e) {
    if (e instanceof ClienteArchivadoError) return r(200, { ok: true, ignorado: 'cliente archivado' })
    console.error('bot-guiones respuesta: falla —', ((e as Error)?.message ?? '').slice(0, 200))
    return r(500, { ok: false })
  }
}

/** El nombre del grupo por Whapi (GET /groups/{id}); null si no hay token o falla. */
async function nombreGrupo(grupo: string): Promise<string | null> {
  const token = tokenWhapi()
  if (!token) return null
  try {
    const r = await fetch(`https://gate.whapi.cloud/groups/${encodeURIComponent(grupo)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json().catch(() => null)) as { name?: unknown } | null
    return typeof j?.name === 'string' ? j.name : null
  } catch { return null }
}
