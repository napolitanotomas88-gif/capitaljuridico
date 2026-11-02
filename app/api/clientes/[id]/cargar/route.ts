import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import { alertar } from '@/lib/alertas'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

// POST /api/clientes/[id]/cargar — {tipo: 'exito'|'testimonio'|'anuncios', texto, nombre} (2/11/2026). Lo que antes leía el
// bot de los grupos de WhatsApp del cliente, cargado a mano desde su ficha. Sesión de Google con Clientes, mismo origen, JSON.
const json = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return json(403, { ok: false, mensaje: 'Origen no permitido.' })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json(415, { ok: false, mensaje: 'Se espera JSON.' })
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json(401, { ok: false, mensaje: 'Iniciá sesión.' })
  const id = (await ctx.params).id
  if (!ID_CLIENTE_VALIDO.test(id)) return json(400, { ok: false, mensaje: 'Cliente inválido.' })
  const idCrm = id.toUpperCase()
  const raw = await req.text()
  if (raw.length > 4000) return json(413, { ok: false, mensaje: 'Demasiado largo.' })
  let b: Record<string, unknown>
  try { b = JSON.parse(raw) } catch { return json(400, { ok: false, mensaje: 'JSON inválido.' }) }
  const tipo = b?.tipo
  const texto = typeof b?.texto === 'string' ? b.texto.replace(/\s+/g, ' ').trim().slice(0, 1500) : ''
  const nombre = typeof b?.nombre === 'string' && b.nombre.trim() ? b.nombre.trim().slice(0, 120) : idCrm
  const por = sesion.nombre || sesion.email
  const uid = randomUUID().replace(/-/g, '').slice(0, 20)
  try {
    if (tipo === 'exito' || tipo === 'testimonio') {
      if (tipo === 'exito' && texto.length < 3) return json(422, { ok: false, mensaje: 'Escribí lo que dijo el cliente.' })
      const s = await import('@/lib/bot/exito/servidor')
      const r = tipo === 'exito'
        ? await s.senalExitoManualReal({ idCrm, cliente: nombre, texto, por, id: uid })
        : await s.testimonioManualReal({ idCrm, cliente: nombre, por, id: uid })
      const lineas = [...r.registro, ...r.errores.map((e) => `Ojo: ${e}`)].slice(0, 4).join(' · ')
      if (r.errores.length && !r.detectados && !r.testimonios) return json(422, { ok: false, mensaje: lineas })
      return json(200, { ok: true, mensaje: tipo === 'exito' ? `Señal cargada.${lineas ? ` ${lineas}` : ''}` : `Testimonio cargado: el agradecimiento queda para enviar (📤).${lineas ? ` ${lineas}` : ''}` })
    }
    if (tipo === 'anuncios') {
      if (texto.length < 3) return json(422, { ok: false, mensaje: 'Escribí lo que dijo el cliente.' })
      const { reclamarNota, guardarLectura, marcarAvisoNota } = await import('@/lib/bot/anuncios/notasNeon')
      const nota = await reclamarNota({ mensajeId: `manual:${uid}`, chatId: `manual:${idCrm}`, texto, autor: { telefono: null, lid: null, nombre: por }, enviadoEn: new Date().toISOString() }, { idCrm, cliente: nombre, grupo: 'general' })
      if (nota) await guardarLectura(nota.id, { esDeAnuncios: true, dijo: texto, pide: '', avisar: true, tipo: 'otro' })
      const a = await alertar({ canal: 'ads', tipo: 'anuncios_nota', clave: `nota:${uid}`, idCrm, emoji: '🗒️', titulo: 'Nota del cliente sobre los anuncios', cliente: nombre, lineas: [`«${texto.slice(0, 280)}»`, `Cargada por ${por}.`], link: '/anuncios', menciones: ['valentino'] })
      if (nota) await marcarAvisoNota(nota.id, a.mensajeId ?? null, a.estado === 'enviado' ? 'avisada' : 'aviso_fallido').catch(() => {})
      return json(200, { ok: true, mensaje: a.estado === 'enviado' ? 'Nota cargada y avisada a Valentino en #📣-ads.' : 'Nota cargada (el aviso de Discord quedó pendiente).' })
    }
    return json(400, { ok: false, mensaje: 'Tipo desconocido.' })
  } catch (e) {
    console.error('[cargar del cliente] falló:', (e as Error)?.name ?? 'error')
    return json(503, { ok: false, mensaje: 'No se pudo cargar. Probá de nuevo.' })
  }
}
