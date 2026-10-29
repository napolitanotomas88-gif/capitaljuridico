// ── Bot "Capital Jurídico": dependencias reales de «Cargar alta» (26/10/2026). Solo servidor ────────────────────────────
// El motor se arma igual que en /api/bot/alta/motor (motorReal): modo y capacidades del entorno, grupos del webhook (sin los
// dos grupos válidos, en seco) y depsServidor (Neon, Sheets, Drive, PandaDoc, Claude, MEP + el Despacho: comprobantes de
// cj_altas_archivos, canal y avisos a Discord). La vista previa usa el motor en seco con un almacén en memoria.
import { after } from 'next/server'
import { sesionDePeticion } from '@/lib/auth/acceso'
import { almacenEnMemoria, esFinal } from '../motor/almacen'
import { almacenNeon, baseConfigurada } from '../motor/almacenNeon'
import { capacidadesReales, modoDesdeEntorno } from '../motor/modo'
import { crearOrquestador } from '../motor/orquestador'
import { depsPasosServidor, depsServidor, equipoDesdeEntorno } from '../motor/servidor'
import type { ConfigGrupos, PasoId } from '../motor/tipos'
import type { FilaPaso } from '../motor/almacen'
import { clienteWhapiDesdeEntorno } from '../../whapi'
import { configWebhook } from '../../whapi/config'
import type { DepsAcciones } from './acciones'
import { archivosNeon } from './archivos'
import { veAlta, type QuienPide } from './aprobadores'
import { vistaDeAlta, type AltaVista } from './vista'

const SIN_GRUPOS: ConfigGrupos = { ventas: 'sin-configurar@g.us', verificaciones: 'sin-configurar-2@g.us' }

export function motorDelEntorno() {
  const modo = modoDesdeEntorno()
  const capacidades = capacidadesReales(modo)
  const cfg = configWebhook()
  const grupos = cfg.ok ? cfg.config.grupos : SIN_GRUPOS
  const efectivo = cfg.ok ? modo : 'seco'
  const caps = cfg.ok ? capacidades : new Set<never>()
  const whapi = clienteWhapiDesdeEntorno({ modo: efectivo, capacidades: caps, grupos })
  return crearOrquestador(depsServidor({ whapi, modo: efectivo, capacidades: caps, grupos }))
}

export function motorSimulacion() {
  const almacen = almacenEnMemoria()
  const whapi = clienteWhapiDesdeEntorno({ modo: 'seco', capacidades: new Set(), grupos: SIN_GRUPOS })
  const motor = crearOrquestador({ whapi, modo: 'seco', capacidades: new Set(), grupos: SIN_GRUPOS, almacen, pasos: depsPasosServidor({ modo: 'seco' }), entorno: 'simulacion', produccion: false })
  return { motor, almacen }
}

export const depsAccionesReales = (): DepsAcciones => ({
  sesion: (req) => sesionDePeticion(req.headers),
  baseLista: baseConfigurada,
  almacen: almacenNeon,
  archivos: () => archivosNeon(),
  motor: motorDelEntorno,
  simulacion: motorSimulacion,
  enSegundoPlano: (fn) => after(fn),
  closers: equipoDesdeEntorno(process.env.BOT_ALTA_CLOSERS),
  ahora: () => Date.now(),
})

/** Las altas que ve esta persona: las abiertas (todas) y las últimas terminadas. */
export async function altasParaPantalla(s: QuienPide, op: { soloId?: string | null } = {}): Promise<{ abiertas: AltaVista[]; terminadas: AltaVista[]; error: string | null }> {
  if (!baseConfigurada()) return { abiertas: [], terminadas: [], error: 'Falta DATABASE_URL: no hay altas para mostrar.' }
  try {
    const almacen = almacenNeon()
    const entorno = process.env.VERCEL_ENV?.trim() || 'local'
    const filas = (await almacen.ultimas(80)).filter((a) => a.entorno === entorno && veAlta(s, a))
    const extra = op.soloId && !filas.some((a) => a.id === op.soloId) ? await almacen.leerAlta(op.soloId) : null
    if (extra && veAlta(s, extra)) filas.unshift(extra)
    const abiertas = filas.filter((a) => !esFinal(a.estado) || a.id === op.soloId)
    const terminadas = filas.filter((a) => esFinal(a.estado) && a.id !== op.soloId).slice(0, 10)
    const conPasos = async (xs: typeof filas) => Promise.all(xs.map(async (a) => vistaDeAlta(a, await almacen.leerPasos(a.id) as Record<PasoId, FilaPaso>)))
    return { abiertas: await conPasos(abiertas), terminadas: await conPasos(terminadas), error: null }
  } catch (e) {
    console.error('Altas: no se pudo leer la base:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    return { abiertas: [], terminadas: [], error: 'No se pudo leer la base de altas. Probá de nuevo en un rato.' }
  }
}
