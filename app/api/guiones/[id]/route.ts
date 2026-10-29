import { NextResponse, after } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import * as reg from '@/lib/bot/guiones/registro'
import { reanudar } from '@/lib/bot/guiones/proceso'
import { depsReales, dispararPaso, motorGuiones } from '@/lib/bot/guiones/servidor'
import { publicarParaEntrega } from '@/lib/bot/guiones/publicacion'
import { esAprobador, faltanVerificar } from '@/lib/bot/guiones/aprobadores'
import { SECCIONES, type Seccion } from '@/lib/bot/guiones/tipos'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'

// POST /api/guiones/<id> — lo que se toca en /guiones/<id> (etapa Guiones, docs/BOT-GUIONES-CJ.md):
//   { accion: 'editar', tanda, numero, secciones: [{seccion, indicacion, texto}], previo }
//   { accion: 'verificar', tanda, numero, previo, si }    → «✓ Verificado» de un guion (si: false lo saca). Tomi o Faus (27/10)
//   { accion: 'aprobar', tanda, previo }                 → el check final de UNA persona (Tomi o Faus), solo con todos los guiones
//                                                           verificados; resuelve el Doc automáticamente y avisa a Aylu/Gero.
//   { accion: 'reenviar', tanda }                       → reintenta la publicación del Doc y su aviso interno
//   { accion: 'reanudar', tanda }                        → retoma una tanda en error o colgada (con el motor local, la toma la Mac)
//   { accion: 'armar_api', tanda }                       → respaldo: la arma el Despacho con la API (si la Mac no la tomó)
//   { accion: 'nota', tanda, texto, guion? }             → la respuesta del cliente cargada a mano (la de WhatsApp entra sola):
//                                                           el bot corrige solo y la tanda vuelve a revisión
// Regla "/api/guiones/*" de lib/auth/rutas.ts (sección Guiones). Aprobar: los mails de KICKOFF_REVISOR_TOMI o
// GUIONES_REVISOR_FAUS. El trabajo largo (Doc, WhatsApp, corrección) corre en after() o en /api/bot/guiones.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const r = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status })
const texto = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '')
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const t0 = Date.now()
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(req, 'guiones')
  if (denegado) return denegado
  if (!mismoOrigen(req.headers)) return r(403, { ok: false, mensaje: 'Origen no permitido.' })
  const { id } = await ctx.params
  if (!ID_CLIENTE_VALIDO.test(id)) return r(404, { ok: false, mensaje: 'Cliente inválido.' })
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return r(401, { ok: false, mensaje: 'Se cerró la sesión.' })
  if (!reg.baseConfigurada()) return r(503, { ok: false, mensaje: 'La base del Despacho no está configurada.' })
  let b: Record<string, unknown>
  try { b = (await req.json()) as Record<string, unknown> } catch { return r(400, { ok: false, mensaje: 'Pedido inválido.' }) }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return r(400, { ok: false, mensaje: 'Pedido inválido.' })
  const tandaId = Number(b.tanda)
  if (!Number.isSafeInteger(tandaId) || tandaId <= 0) return r(400, { ok: false, mensaje: 'Falta la tanda.' })
  try {
    const fila = await reg.leerTanda(tandaId)
    if (!fila || (fila.id_crm ?? '').toUpperCase() !== id.toUpperCase()) return r(404, { ok: false, mensaje: 'No existe esa tanda para este cliente.' })
    await exigirClienteNoArchivado(fila.id_crm)
    const quien = sesion.nombre || sesion.email
    const previo = typeof b.previo === 'string' ? b.previo : ''

    switch (b.accion) {
      case 'editar': {
        const n = Number(b.numero), g = fila.guiones[String(n)]
        if (!g || !Array.isArray(b.secciones)) return r(400, { ok: false, mensaje: 'Guion inválido.' })
        const nuevas = g.guion.secciones.map(s => {
          const x = (b.secciones as Record<string, unknown>[]).find(y => y?.seccion === s.seccion)
          return x ? { ...s, indicacion: texto(x.indicacion, 700) || s.indicacion, texto: texto(x.texto, 900) || s.texto } : s
        })
        if (!nuevas.every(s => (SECCIONES as readonly Seccion[]).includes(s.seccion))) return r(400, { ok: false, mensaje: 'Sección inválida.' })
        return (await reg.editarGuion(fila.id, n, { ...g.guion, secciones: nuevas }, quien, previo))
          ? r(200, { ok: true, mensaje: 'Guardado.' }) : r(409, { ok: false, mensaje: 'Alguien lo cambió mientras tanto o la tanda ya no se puede editar: recargá.' })
      }
      case 'verificar': {
        if (!esAprobador(sesion.email)) return r(403, { ok: false, mensaje: 'Los guiones los verifican Tomi o Faus.' })
        const n = Number(b.numero)
        if (!fila.guiones[String(n)]) return r(400, { ok: false, mensaje: 'Guion inválido.' })
        const si = b.si !== false
        return (await reg.verificarGuion(fila.id, n, si ? { quien, email: sesion.email } : null, previo))
          ? r(200, { ok: true, mensaje: si ? `Guion ${n} verificado.` : `Guion ${n}: verificación sacada.` })
          : r(409, { ok: false, mensaje: 'Alguien lo cambió mientras tanto o la tanda ya no está para revisar: recargá.' })
      }
      case 'aprobar': {
        if (!esAprobador(sesion.email)) return r(403, { ok: false, mensaje: 'Los guiones los aprueban Tomi o Faus.' })
        const faltan = faltanVerificar(fila.guiones)
        if (faltan.length) return r(409, { ok: false, mensaje: `Falta verificar ${faltan.length === 1 ? 'el guion' : 'los guiones'} ${faltan.join(', ')}.` })
        if (!(await reg.aprobarTanda(fila.id, { quien, email: sesion.email }, previo))) return r(409, { ok: false, mensaje: 'La tanda cambió, falta verificar algún guion o ya estaba aprobada: recargá.' })
        after(() => publicarParaEntrega(fila.id, t0 + 250_000))
        return r(200, { ok: true, mensaje: 'Aprobada: preparando el Doc y el aviso para que Aylu o Gero entreguen el link.' })
      }
      case 'reenviar': {
        if (!esAprobador(sesion.email)) return r(403, { ok: false, mensaje: 'Solo Tomi o Faus.' })
        if (fila.estado !== 'aprobada') return r(409, { ok: false, mensaje: fila.estado === 'enviada' ? 'Ya se le avisó al cliente.' : 'La tanda no está aprobada.' })
        after(() => publicarParaEntrega(fila.id, t0 + 250_000))
        return r(200, { ok: true, mensaje: 'Revisando la publicación del documento y el aviso de entrega.' })
      }
      case 'reanudar':
        return r(200, { ok: true, mensaje: await reanudar(fila.id, depsReales()) })
      case 'armar_api': {
        // Respaldo: si la Mac no la tomó, Tomi o Faus la arman con la API (cuesta ~USD 2 con la caché)
        if (!esAprobador(sesion.email)) return r(403, { ok: false, mensaje: 'Solo Tomi o Faus.' })
        return r(200, { ok: true, mensaje: await reanudar(fila.id, depsReales('api')) })
      }
      case 'nota': {
        const t = texto(b.texto, 2000)
        if (!t) return r(400, { ok: false, mensaje: 'La nota está vacía.' })
        const n = b.guion === null || b.guion === undefined || b.guion === '' ? null : Number(b.guion)
        const corregir = await reg.agregarNota(fila.id, { texto: t, guion: n && fila.guiones[String(n)] ? n : null, cuando: new Date().toISOString(), origen: 'manual' })
        if (corregir && motorGuiones() === 'api') await dispararPaso('notas', { id: fila.id }).catch(e => console.error('bot-guiones: no arrancó la corrección —', (e as Error)?.message))
        return r(200, { ok: true, mensaje: corregir ? 'Nota agregada: el bot está corrigiendo, en unos minutos vuelve a revisión.' : 'Nota agregada.' })
      }
    }
    return r(400, { ok: false, mensaje: 'Acción desconocida.' })
  } catch (e) {
    if ([409, 503].includes((e as { status?: number })?.status ?? 0)) return r((e as { status: number }).status, { ok: false, mensaje: (e as Error).message })
    console.error('API guiones: falla —', ((e as Error)?.message ?? '').slice(0, 200))
    return r(500, { ok: false, mensaje: 'No se pudo hacer. Probá de nuevo en un minuto.' })
  }
}
