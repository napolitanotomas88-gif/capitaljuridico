// ── Chequeo temprano de la cuenta de Meta (cuentaTemprana.ts): las dependencias reales y los dos disparos ────────────
//   · chequearCuentaFicha(id): apenas la ficha queda lista (trasWebhook, procesar.ts).
//   · barrerCuentasTempranas(t): en la corrida de las 9:05, las fichas listas de los últimos DIAS_BARRIDO días de clientes
//     que siguen POR LANZAR (así no avisa de los que ya gastan con otra cuenta).
// Solo lectura en Meta. Una vez por ficha por motivo (cuenta-temprana:<id>:<motivo> en cj_anuncios_avisos). Nunca tira.
// KICKOFF_CUENTA_TEMPRANA=0 lo apaga. Solo servidor.
import type { Tablero } from '@/lib/anuncios/tablero'
import { DIAS_BARRIDO, puntuarCuentas, textoCuentaTemprana, type CuentaCandidata, type ProblemaCuenta, type Puntaje } from './cuentaTemprana'

export const cuentaTempranaEncendida = (): boolean => process.env.KICKOFF_CUENTA_TEMPRANA?.trim() !== '0'

export interface ResultadoCuentaTemprana { recording_id: number; cliente: string | null; problema: ProblemaCuenta | null; candidatas: Puntaje[]; texto: string | null; enviado: boolean; motivo?: string }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 200)

/** Las cuentas que ve el token, con a quién las asigna el tablero y (las libres) sus páginas. */
async function candidatas(): Promise<CuentaCandidata[]> {
  const { fuentesCuentaTablero } = await import('./portfolio')
  const { paginasDeCuentas } = await import('@/lib/anuncios/meta')
  const f = await fuentesCuentaTablero()
  const fuera = new Set(f.excluidas)
  const base = f.descubiertas.filter(d => !fuera.has(d.id) && !f.esPropia(d.id)).map(d => {
    const r = f.resolver({ id: d.id, nombre: d.nombre, negocio: d.negocio?.nombre ?? null })
    return { id: d.id, nombre: d.nombre, negocio: d.negocio?.nombre ?? null, paginas: [] as string[], asignada: r.cliente?.nombre ?? (r.nombreColC || null), estado: d.estado }
  })
  const libres = base.filter(c => !c.asignada && (c.estado === 1 || c.estado === 201)).map(c => c.id)
  const paginas = await paginasDeCuentas(libres).catch(() => new Map<string, string[]>())
  return base.map(c => ({ ...c, paginas: paginas.get(c.id) ?? [] }))
}

async function revisar(fila: { recording_id: number; cliente_crm: string | null; id_crm: string | null; cuenta: string | null; leido: boolean }, op: { dry?: boolean; cache?: { c: Promise<CuentaCandidata[]> | null } }): Promise<ResultadoCuentaTemprana> {
  const r: ResultadoCuentaTemprana = { recording_id: fila.recording_id, cliente: fila.cliente_crm, problema: null, candidatas: [], texto: null, enviado: false }
  if (fila.cuenta && fila.leido) return r
  r.problema = fila.cuenta ? 'sin_acceso' : 'sin_cuenta'
  if (r.problema === 'sin_cuenta' && fila.cliente_crm) {
    try {
      const cache = op.cache ?? { c: null }
      cache.c ??= candidatas()
      r.candidatas = puntuarCuentas({ nombre: fila.cliente_crm }, await cache.c)
    } catch (e) { r.motivo = `no pude buscar candidatas (${motivo(e)})` }
  }
  const [{ mencionesKickoff, urlDespacho }, { idDiscord }] = await Promise.all([import('./entorno'), import('@/lib/fathomAnuncios/discord')])
  const menciones = [idDiscord(process.env.DISCORD_ID_VALENTINO), mencionesKickoff().tomi].filter((x): x is string => !!x)
  const ficha = fila.id_crm ? `${urlDespacho()}/clientes?cliente=${encodeURIComponent(fila.id_crm)}` : null
  r.texto = textoCuentaTemprana({ cliente: fila.cliente_crm ?? `grabación ${fila.recording_id}`, idCrm: fila.id_crm, recordingId: fila.recording_id, problema: r.problema, cuenta: fila.cuenta, candidatas: r.candidatas, menciones, ficha })
  if (op.dry) return r
  const reg = await import('@/lib/bot/anuncios/registro')
  const clave = `cuenta-temprana:${fila.recording_id}:${r.problema}`
  try {
    if (!await reg.reclamarAviso(clave, { tipo: 'cuenta-temprana', cuenta: fila.cuenta ?? '', campana_id: String(fila.recording_id), cliente: fila.cliente_crm ?? '', texto_cliente: null })) return r
  } catch (e) { r.motivo = `reclamar: ${motivo(e)}`; return r }
  const webhook = process.env.DISCORD_WEBHOOK_ANUNCIOS?.trim() || ''
  try {
    if (!webhook) throw new Error('falta DISCORD_WEBHOOK_ANUNCIOS')
    const { enviarDiscord } = await import('@/lib/fathomAnuncios/discord')
    const id = (await enviarDiscord(webhook, [r.texto], menciones))[0] ?? ''
    await reg.marcarAvisoEnviado(clave, id).catch(() => {})
    r.enviado = true
  } catch (e) {
    r.motivo = `discord: ${motivo(e)}`
    await reg.soltarAviso(clave).catch(() => {})
  }
  return r
}

/** Apenas la ficha queda lista. Nunca tira. */
export async function chequearCuentaFicha(id: number, op: { dry?: boolean } = {}): Promise<ResultadoCuentaTemprana | null> {
  if (!cuentaTempranaEncendida()) return null
  try {
    const { leerKickoff } = await import('./registro')
    const fila = await leerKickoff(id)
    const ficha = fila?.ficha as { tipo_reunion?: string; portfolio_meta?: { cuenta?: string | null; leido?: boolean } } | null
    if (!fila || fila.estado !== 'lista' || ficha?.tipo_reunion !== 'kickoff') return null
    return await revisar({ recording_id: id, cliente_crm: fila.cliente_crm, id_crm: fila.id_crm, cuenta: ficha.portfolio_meta?.cuenta ?? null, leido: !!ficha.portfolio_meta?.leido }, op)
  } catch (e) {
    return { recording_id: id, cliente: null, problema: null, candidatas: [], texto: null, enviado: false, motivo: motivo(e) }
  }
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** En la corrida de las 9:05: las fichas listas recientes de clientes que siguen por lanzar. Nunca tira. */
export async function barrerCuentasTempranas(t: Pick<Tablero, 'porLanzar' | 'porLanzarEsperando'>, op: { dry?: boolean } = {}): Promise<ResultadoCuentaTemprana[] | { apagado: true } | { error: string }> {
  if (!cuentaTempranaEncendida()) return { apagado: true }
  try {
    const { fichasListasRecientes } = await import('./registro')
    const pls = [...t.porLanzar, ...(t.porLanzarEsperando ?? [])]
    const ids = new Set(pls.map(p => (p.idCrm ?? p.kickoff?.idCrm ?? '').toUpperCase()).filter(Boolean))
    const nombres = new Set(pls.map(p => normal(p.cliente)))
    const filas = (await fichasListasRecientes(DIAS_BARRIDO)).filter(f => !(f.cuenta && f.leido))
      .filter(f => (f.id_crm && ids.has(f.id_crm.toUpperCase())) || (f.cliente_crm && nombres.has(normal(f.cliente_crm))))
    // Una por cliente (la ficha más nueva)
    const vistos = new Set<string>()
    const unicas = filas.filter(f => { const k = (f.id_crm ?? f.cliente_crm ?? String(f.recording_id)).toUpperCase(); if (vistos.has(k)) return false; vistos.add(k); return true })
    const cache = { c: null as Promise<CuentaCandidata[]> | null }
    const out: ResultadoCuentaTemprana[] = []
    for (const f of unicas.slice(0, 10)) out.push(await revisar(f, { ...op, cache }))
    return out
  } catch (e) {
    return { error: motivo(e) }
  }
}
