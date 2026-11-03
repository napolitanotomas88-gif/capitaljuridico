// ── Clientes por lanzar TRABADOS: en qué etapa está cada uno, quién lo destraba y a quién avisar ─────────────────────
// Pedido de Tomás (3/11/2026, «que ya quede para todos los clientes a lanzar campañas»): un cliente sin editados no aparecía
// en ningún lado (el bot de borradores, g01 de lib/bot/anuncios/videos.ts, arranca recién con videos en «Editados - X», y el
// bloque «Por lanzar» del tablero los escondía). Acá, PURO (sin red ni base; lo prueba scripts/test-anuncios-trabados.mjs):
//   · diagnosticar: la etapa donde está trabado un cliente de «Por lanzar» (sin fila en el tablero), en el orden del
//     recorrido: sin ficha de kickoff (Tomás / Gero M) → guiones sin aprobar (Faus) → guiones aprobados y 0 crudos
//     (grabación) → N crudos y 0 editados (René) → con editados: cuenta de Meta que falta en la ficha o que el token no ve
//     (Tomás / Valen) → listo, falta armar (Valen). Lo de la cuenta también va como «además» en las etapas de antes: así se
//     resuelve mientras graban, no el día que llegan los editados.
//   · clientesTrabados: los de «Por lanzar» con la kickoff (o, sin ficha, el Día 1 del CRM) de hace más de DIAS_TRABADO días,
//     sin los sin fecha de fin (BOT_CLIENTES_SIN_FIN). Pausados, finalizados y los que ya gastan no están en «Por lanzar».
//     Desde el 3/11 (pedido de Tomás: «la mayoría ya están lanzados»): tampoco los que tienen su bloque del Doc de ADS en la
//     línea de base (histórico, docAdsBase.ts) ni, en el servidor, los que tienen campaña en su cuenta de Meta en los
//     últimos 120 días (activa o pausada); y «sin ficha» solo si es de los últimos DIAS_SIN_FICHA días.
//   · textoTrabados: UN mensaje para #📣-ads con los nuevos (una vez por cliente por etapa: la clave la reclama el servidor)
//     y una línea con los que siguen igual.
export const DIAS_TRABADO = 7
/** Sin kickoff registrada y con el alta de hace más que esto: van todos juntos en una línea (no uno por uno). */
export const DIAS_VIEJO = 45
/** «Sin ficha de kickoff» solo se avisa si la kickoff (o el alta, sin ficha) es de los últimos DIAS_SIN_FICHA días (3/11). */
export const DIAS_SIN_FICHA = 30

export type EtapaTraba = 'kickoff' | 'guiones' | 'grabacion' | 'edicion' | 'cuenta' | 'armado'
export const NOMBRE_ETAPA_TRABA: Record<EtapaTraba, string> = {
  kickoff: 'Kickoff', guiones: 'Guiones', grabacion: 'Grabación', edicion: 'Edición', cuenta: 'Cuenta de Meta', armado: 'Armado de la campaña',
}
export const EMOJI_ETAPA: Record<EtapaTraba, string> = { kickoff: '📝', guiones: '✍️', grabacion: '🎥', edicion: '🎬', cuenta: '🏦', armado: '🚀' }
export const RESPONSABLE: Record<EtapaTraba, string> = {
  kickoff: 'Tomás / Gero M', guiones: 'Faus', grabacion: 'grabación (cliente)', edicion: 'René', cuenta: 'Tomás / Valen', armado: 'Valen',
}

export interface TandaTraba { tanda: number; estado: string; aprobada: string | null }
export interface EntradaTraba {
  cliente: string
  idCrm: string | null
  kickoff: { fechaIso: string | null; cuenta: boolean } | null
  /** Se leyó la base y no tiene ficha «lista». Con la base caída (false sin kickoff) no se dice nada de la ficha. */
  sinFicha: boolean
  /** El token ve su cuenta (la de la ficha si la trae). */
  acceso: 'si' | 'no'
  /** null = no se pudo leer cj_guiones (no se dice nada de los guiones). undefined/«sin tanda» = { tanda: 0 }. */
  tanda: TandaTraba | null | undefined
  /** null = no se encontró la carpeta en Drive o Drive no respondió. */
  crudos: number | null
  editados: number | null
  /** Su bloque más nuevo en el Doc de ADS (docAds.ts): LISTO (con cruce firme) y cuántos videos con link, o la nota. */
  doc?: { listo: boolean; videos: number; texto: string; historico?: boolean } | null
}
export interface Diagnostico { etapa: EtapaTraba; motivo: string; responsable: string; ademas: string[] }

const TANDA_APROBADA = new Set(['aprobada', 'enviada', 'cerrada', 'con_notas', 'corrigiendo'])
const TEXTO_TANDA: Record<string, string> = {
  pendiente: 'por arrancar', mercado: 'leyendo el mercado', plan: 'armando el plan', escribiendo: 'escribiendo', a_revisar: 'a revisar', error: 'con error',
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Lo de la cuenta de Meta, si falta algo (solo con ficha: sin ficha no se sabe cuál es la cuenta). */
function problemaCuenta(e: EntradaTraba): string | null {
  if (!e.kickoff) return null
  if (!e.kickoff.cuenta) return 'sin cuenta de Meta en la ficha'
  return e.acceso === 'no' ? 'sin acceso del token a su cuenta de Meta' : null
}

export function diagnosticar(e: EntradaTraba): Diagnostico {
  const cuenta = problemaCuenta(e)
  const notaDoc = e.doc && !e.doc.listo ? `Doc de ADS: ${e.doc.texto}` : null
  const con = (etapa: EtapaTraba, motivo: string): Diagnostico => ({
    etapa, motivo, responsable: RESPONSABLE[etapa],
    ademas: [...(cuenta && etapa !== 'cuenta' ? [`${cuenta} (${RESPONSABLE.cuenta})`] : []), ...(notaDoc ? [notaDoc] : [])],
  })
  // LISTO en el Doc de ADS (3/11): los videos están (aunque sea en el Drive de René), falta la cuenta o armar
  if (e.doc?.listo && !e.doc.historico && e.doc.videos > 0) {
    const vids = `${plural(e.doc.videos, 'video LISTO', 'videos LISTOS')} en el Doc de ADS`
    if (cuenta) return con('cuenta', `${cuenta} (${vids})`)
    if (!e.kickoff && e.sinFicha) return con('kickoff', `sin ficha de kickoff (${vids})`)
    return con('armado', `${vids}, falta armar la campaña (el bot la arma en pausa a las 9:05)`)
  }
  if ((e.editados ?? 0) > 0) {
    if (cuenta) return con('cuenta', cuenta)
    if (!e.kickoff && e.sinFicha) return con('kickoff', `sin ficha de kickoff (${plural(e.editados!, 'video editado', 'videos editados')} esperando)`)
    return con('armado', `${plural(e.editados!, 'video editado', 'videos editados')}, falta armar la campaña`)
  }
  if (!e.kickoff && e.sinFicha) return con('kickoff', 'sin ficha de kickoff')
  if ((e.crudos ?? 0) > 0) return con('edicion', `${plural(e.crudos!, 'crudo', 'crudos')}, 0 editados`)
  if (e.tanda !== null) {
    const t = e.tanda
    if (!t || !t.tanda) return con('guiones', 'sin tanda de guiones')
    if (!t.aprobada && !TANDA_APROBADA.has(t.estado)) return con('guiones', `guiones sin aprobar (tanda ${t.tanda}: ${TEXTO_TANDA[t.estado] ?? t.estado})`)
  }
  if (e.crudos === null) return con('grabacion', 'sin carpeta de crudos en Drive (no se pudo ver si grabó)')
  return con('grabacion', e.tanda === null ? '0 crudos' : 'guiones aprobados, 0 crudos')
}

// ── Los trabados ──
export interface ClienteTrabado extends Diagnostico {
  cliente: string
  idCrm: string | null
  desde: string            // YYYY-MM-DD: la kickoff (o el Día 1 del CRM sin ficha)
  por: 'kickoff' | 'dia1'
  dias: number
  clave: string            // trabado:<id o nombre>:<etapa>: una vez por cliente por etapa
}

const diaAR = (iso: string): string | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const claveCliente = (x: { idCrm: string | null; cliente: string }) =>
  x.idCrm?.trim().toUpperCase() || x.cliente.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function clientesTrabados(xs: (EntradaTraba & { dia1?: string | null })[], op: { hoy: string; sinFin?: readonly string[]; dias?: number }): ClienteTrabado[] {
  const tope = op.dias ?? DIAS_TRABADO
  const sinFin = new Set((op.sinFin ?? []).map(x => x.trim().toUpperCase()))
  const out: ClienteTrabado[] = []
  for (const x of xs) {
    if (x.idCrm && sinFin.has(x.idCrm.toUpperCase())) continue
    const k = x.kickoff?.fechaIso ? diaAR(x.kickoff.fechaIso) : null
    const desde = k ?? (x.dia1 && /^\d{4}-\d{2}-\d{2}$/.test(x.dia1) ? x.dia1 : null)
    if (!desde) continue
    const dias = diasEntre(desde, op.hoy)
    if (dias <= tope) continue
    if (x.doc?.historico) continue   // su bloque del Doc es de la línea de base: ya lanzado
    const d = diagnosticar(x)
    if (d.etapa === 'kickoff' && dias > DIAS_SIN_FICHA) continue
    out.push({ ...d, cliente: x.cliente, idCrm: x.idCrm, desde, por: k ? 'kickoff' : 'dia1', dias, clave: `trabado:${claveCliente(x)}:${d.etapa}` })
  }
  return out.sort((a, b) => b.dias - a.dias || a.cliente.localeCompare(b.cliente, 'es'))
}

// ── El mensaje ──
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const esc = (s: string) => s.replace(/([*_~`|>\\])/g, '\\$1')

export function lineaTrabado(t: ClienteTrabado): string {
  const cuando = t.por === 'kickoff' ? `kickoff ${ddmm(t.desde)}, hace ${t.dias} días` : `sin kickoff registrada · alta ${ddmm(t.desde)}, hace ${t.dias} días`
  const ademas = t.ademas.length ? ` · ⚠️ además: ${t.ademas.map(esc).join('; ')}` : ''
  return `${EMOJI_ETAPA[t.etapa]} **${esc(t.cliente)}**${t.idCrm ? ` (${t.idCrm})` : ''} · ${cuando} · ${NOMBRE_ETAPA_TRABA[t.etapa]}: ${esc(t.motivo)} → **${t.responsable}**${ademas}`
}

/** El mensaje de #📣-ads: los nuevos (o que cambiaron de etapa) con detalle, y los que siguen igual en una línea. '' = nada nuevo. */
/** ¿Va en la línea de los viejos? (sin kickoff registrada y con el alta de hace más de DIAS_VIEJO días) */
export const esViejo = (t: Pick<ClienteTrabado, 'por' | 'dias'>) => t.por === 'dia1' && t.dias > DIAS_VIEJO

export function textoTrabados(nuevos: ClienteTrabado[], siguen: ClienteTrabado[], menciones: string[] = []): string {
  if (!nuevos.length) return ''
  const detalle = nuevos.filter(t => !esViejo(t)), viejos = nuevos.filter(esViejo)
  const cab = `${menciones.map(m => `<@${m}>`).join(' ')}${menciones.length ? ' ' : ''}🧱 **Clientes trabados antes de lanzar** · kickoff hace más de ${DIAS_TRABADO} días y sin campaña (${plural(nuevos.length, 'nuevo', 'nuevos')})`
  const lineas = [cab, ...detalle.map(lineaTrabado)]
  if (viejos.length) lineas.push(`🕰️ Con el alta de hace más de ${DIAS_VIEJO} días y sin campaña visible (¿gastan en una cuenta que el token no ve, o con otro nombre en «Cuentas Meta»?): ${viejos.map(t => `${esc(t.cliente)}${t.idCrm ? ` (${t.idCrm})` : ''}`).join(' · ')}`)
  if (siguen.length) lineas.push(`Siguen trabados (ya avisados, ${siguen.length}): ${siguen.slice(0, 12).map(t => `${esc(t.cliente)} (${NOMBRE_ETAPA_TRABA[t.etapa].toLowerCase()}, ${t.dias} d)`).join(' · ')}${siguen.length > 12 ? ' …' : ''}`)
  lineas.push('El detalle de cada uno, en /anuncios → «Por lanzar». Nada se activa en Meta: todo queda en pausa hasta que Valen confirme.')
  return lineas.join('\n')
}

/** Un texto largo en mensajes de Discord de hasta `max` caracteres, cortando entre renglones (nunca se pierde un cliente). */
export function partirMensaje(txt: string, max = 1900): string[] {
  const out: string[] = []
  let actual = ''
  for (const l of txt.split('\n')) {
    const linea = l.length > max ? `${l.slice(0, max - 1)}…` : l
    if (actual && actual.length + 1 + linea.length > max) { out.push(actual); actual = linea } else actual = actual ? `${actual}\n${linea}` : linea
  }
  if (actual) out.push(actual)
  return out
}
