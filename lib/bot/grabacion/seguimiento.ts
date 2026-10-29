// ── e01: seguimiento cuando el cliente no graba (P2 por defecto) e iniciarTanda ("guiones enviados") ──────────────────
// calcularE01 (puro): la escalera de la daily en días hábiles y, si Tomás decide seguir el día 9, un recordatorio cada
// RECORDATORIO_CADA_HABILES días hábiles desde la decisión.
//   · Un ciclo por cliente. Arranca el día en que el primer video entró a esperando_crudos (el guion pasó a "Para grabar",
//     Aylu marcó "guiones enviados" o se mandó un pedido de regrabación). Los importados de ClickUp en espera arrancan en la
//     fecha de corte. Un regrabar con un ciclo abierto suma sus videos SIN reiniciar el escalón.
//   · dia0 = el día del inicio (si no es hábil, el primer día hábil); dia2, dia4 y dia9 = 2, 4 y 9 días hábiles DESPUÉS del
//     dia0 (no del inicio: un ciclo que arranca un sábado no se comprime). Responsables: Aylu (dia0 y recordatorios), Gero M
//     (dia2 y dia4), Tomás (dia9). Si el ciclo lo abrió un envío con constancia (pedido de regrabación o "guiones
//     enviados"), el dia0 nace hecho.
//   · Freno: si después del inicio llegaron crudos del cliente que siguen sin ubicar (sin transcripción no se sabe a qué
//     guion van), el escalón no avanza: el paso queda "ubicar crudos" para Aylu (si no, Gero M llamaría citando el contrato a
//     alguien que ya grabó).
//   · El ciclo se cierra (resuelto) cuando ningún video del ciclo queda esperando crudos; si quedaron pausados, cancelado.
//   · Quedan afuera los clientes que graba el equipo (cj_edicion_clientes / EDICION_GRABA_EQUIPO).
//   · El texto NO se arma acá (dependería de textos.ts, del bloque C): queda vacío y la vista lo arma con textoE01 al
//     mostrarlo; se guarda recién cuando Aylu marca "hecho".
import type { EventoVideo, IdCrm, Iso, PasoSeguimiento, Persona, QuienSubio, Video, Ymd } from '@/lib/edicion/tipos'
import { ESCALONES_E01, RECORDATORIO_CADA_HABILES } from '@/lib/edicion/config'
import { sumarDias } from '@/lib/clientes/fechas'
import * as Videos from '@/lib/edicion/db/videos'
import * as Guiones from '@/lib/edicion/db/guiones'
import * as Carpetas from '@/lib/edicion/db/carpetas'
import * as Seguimientos from '@/lib/edicion/db/seguimientos'
import { ErrorEntradaEdicion } from '@/lib/edicion/db/base'
import { ganchoGuion, textoGuion } from './guiones'

export type PasoNuevoE01 = Omit<PasoSeguimiento, 'id' | 'version' | 'hecho' | 'decision' | 'estado'> & { hecho?: PasoSeguimiento['hecho'] }
export interface EntradaE01 {
  videos: readonly Video[]; pasos: readonly PasoSeguimiento[]; hoy: Ymd; esHabil: (d: Ymd) => boolean
  sinUbicar?: readonly { id_crm: IdCrm; creado: Iso; subio?: QuienSubio }[]
  excluidos?: ReadonlySet<IdCrm>
  corte?: Ymd | null
}
export interface SalidaE01 {
  nuevos: PasoNuevoE01[]
  cerrar: { id_crm: IdCrm; ciclo: Ymd; estado: 'resuelto' | 'cancelado' }[]
  actualizar: { id: number; videos: number[]; frenado: PasoSeguimiento['frenado'] | null }[]
}

export const ymdAR = (iso: Iso): Ymd => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10)

/** Días hábiles d con desde < d ≤ hasta. */
export function habilesEntre(desde: Ymd, hasta: Ymd, esHabil: (d: Ymd) => boolean): number {
  let n = 0
  for (let d = sumarDias(desde, 1); d <= hasta; d = sumarDias(d, 1)) if (esHabil(d)) n++
  return n
}
/** El n-ésimo día hábil después de `desde` (n = 0: desde si es hábil, si no el próximo hábil). */
export function sumarHabiles(desde: Ymd, n: number, esHabil: (d: Ymd) => boolean): Ymd {
  if (n <= 0) { let d = desde; while (!esHabil(d)) d = sumarDias(d, 1); return d }
  let d = desde, k = 0
  while (k < n) { d = sumarDias(d, 1); if (esHabil(d)) k++ }
  return d
}

export const RESPONSABLE: Record<'dia0' | 'dia2' | 'dia4' | 'dia9', PasoSeguimiento['responsable']> = { dia0: 'aylu', dia2: 'gero_m', dia4: 'gero_m', dia9: 'tomas' }

/** Por qué entró a esperar crudos (para el motivo del ciclo). Un pedido de regrabación manda sobre cómo nació el video. */
export function motivoDe(v: Video): PasoSeguimiento['motivo'] {
  if (v.motivo_regrabar) return 'regrabar'
  if (v.origen === 'aylu') return 'guiones_enviados'
  return 'para_grabar'
}

/** El día 0 ya lo hizo Aylu cuando el ciclo lo abrió un envío con constancia (pedido de regrabación o "guiones enviados"). */
const NOTA_DIA0_HECHO: Partial<Record<PasoSeguimiento['motivo'], string>> = {
  regrabar: 'Hecho al registrar el envío del pedido de regrabación.',
  guiones_enviados: 'Hecho al marcar «guiones enviados».',
}

function inicioDe(v: Video, corte: Ymd | null): Ymd {
  const d = ymdAR(v.estado_desde || v.creado)
  return v.origen === 'clickup' && corte && corte > d ? corte : d
}

export function calcularE01(e: EntradaE01): SalidaE01 {
  const out: SalidaE01 = { nuevos: [], cerrar: [], actualizar: [] }
  const corte = e.corte ?? null
  const clientes = new Set([...e.videos.map(v => v.id_crm), ...e.pasos.map(p => p.id_crm)])
  for (const id of clientes) {
    const excluido = e.excluidos?.has(id) ?? false
    const deCliente = e.videos.filter(v => v.id_crm === id)
    const esperan = excluido ? [] : deCliente.filter(v => v.estado === 'esperando_crudos')
    const abiertos = e.pasos.filter(p => p.id_crm === id && p.estado === 'abierto')
    const ciclos = [...new Set(abiertos.map(p => p.ciclo))].sort()
    // Más de un ciclo abierto (no debería pasar): queda el más viejo y el resto se da por resuelto
    for (const c of ciclos.slice(1)) out.cerrar.push({ id_crm: id, ciclo: c, estado: 'resuelto' })
    let ciclo = ciclos[0] ?? null
    const pasosCiclo = abiertos.filter(p => p.ciclo === ciclo)
    if (ciclo && !esperan.length) {
      const delCiclo = new Set(pasosCiclo.flatMap(p => p.videos))
      const estados = deCliente.filter(v => delCiclo.has(v.id)).map(v => v.estado)
      const pausados = estados.length > 0 && estados.every(s => s === 'pausado' || s === 'descartado')
      out.cerrar.push({ id_crm: id, ciclo, estado: excluido || pausados ? 'cancelado' : 'resuelto' })
      continue
    }
    if (!esperan.length) continue
    const ordenados = [...esperan].sort((a, b) => inicioDe(a, corte).localeCompare(inicioDe(b, corte)) || a.id - b.id)
    let motivo: PasoSeguimiento['motivo'] = pasosCiclo[0]?.motivo ?? motivoDe(ordenados[0])
    if (!ciclo) { ciclo = inicioDe(ordenados[0], corte); motivo = motivoDe(ordenados[0]) }
    const cliente = ordenados[0].cliente
    const videos = [...new Set([...pasosCiclo.flatMap(p => p.videos).filter(x => esperan.some(v => v.id === x)), ...esperan.map(v => v.id)])].sort((a, b) => a - b)
    const existentes = new Set(pasosCiclo.map(p => p.escalon))
    const desdeCiclo = ciclo
    const frenado = (e.sinUbicar ?? []).some(s => s.id_crm === id && s.subio !== 'equipo' && ymdAR(s.creado) >= desdeCiclo)
    // Candidatos: la escalera y, con la decisión "seguir" del día 9, los recordatorios
    // La escalera cuenta desde el día 0 (el primer día hábil desde el inicio): un ciclo que arranca un sábado o un feriado no
    // se comprime (si no, el audio del día 2 caería un día hábil después del mensaje)
    const dia0 = sumarHabiles(ciclo, 0, e.esHabil)
    const candidatos: { escalon: PasoSeguimiento['escalon']; debido: Ymd; dias: number; responsable: PasoSeguimiento['responsable'] }[] = []
    for (const [esc, n] of Object.entries(ESCALONES_E01) as [keyof typeof ESCALONES_E01, number][]) {
      candidatos.push({ escalon: esc, debido: sumarHabiles(dia0, n, e.esHabil), dias: n, responsable: RESPONSABLE[esc] })
    }
    const dia9 = pasosCiclo.find(p => p.escalon === 'dia9')
    if (dia9?.decision === 'seguir') {
      const desde = dia9.decidido?.cuando ? ymdAR(dia9.decidido.cuando) : dia9.debido
      for (let k = 1; k <= 60; k++) {
        const debido = sumarHabiles(desde, RECORDATORIO_CADA_HABILES * k, e.esHabil)
        if (debido > e.hoy) break
        candidatos.push({ escalon: `r${k}`, debido, dias: habilesEntre(dia0, debido, e.esHabil), responsable: 'aylu' })
      }
    }
    const vencidos = candidatos.filter(c => c.debido <= e.hoy && !existentes.has(c.escalon))
    const base = { id_crm: id, cliente, ciclo, motivo, videos, texto: '' }
    if (frenado) {
      // Sin ningún paso pendiente (ciclo nuevo, o todos hechos: el día 0 nace hecho con «guiones enviados» o una regrabación),
      // el escalón vencido queda como «ubicar crudos» para Aylu (revisión de la integración, ronda 3: con el día 0 hecho no
      // se creaba nada y la daily decía "nadie atrasado")
      if (!pasosCiclo.some(p => !p.hecho) && vencidos.length) {
        const c = vencidos[0]
        out.nuevos.push({ ...base, escalon: c.escalon, debido: c.debido, dias_habiles: c.dias, responsable: 'aylu', frenado: 'crudos_sin_ubicar' })
      }
      const ultimo = [...pasosCiclo].filter(p => !p.hecho).sort((a, b) => b.debido.localeCompare(a.debido))[0]
      if (ultimo && (ultimo.frenado !== 'crudos_sin_ubicar' || ultimo.videos.join() !== videos.join())) out.actualizar.push({ id: ultimo.id, videos, frenado: 'crudos_sin_ubicar' })
      continue
    }
    // El día 0 de un ciclo que abrió un envío con constancia nace hecho (si no, al día siguiente aparecería "vencido" y
    // pediría repetir el mensaje que Aylu acaba de mandar)
    const notaDia0 = !pasosCiclo.length ? NOTA_DIA0_HECHO[motivo] : undefined
    const desdeEnvio = ordenados.filter(v => motivoDe(v) === motivo).map(v => v.estado_desde || v.creado).sort()[0] ?? ordenados[0].estado_desde
    for (const c of vencidos) {
      const hecho = c.escalon === 'dia0' && notaDia0 ? { quien: 'Constancia del envío', cuando: desdeEnvio, nota: notaDia0 } : undefined
      out.nuevos.push({ ...base, escalon: c.escalon, debido: c.debido, dias_habiles: c.dias, responsable: c.responsable, ...(hecho ? { hecho } : {}) })
    }
    for (const p of pasosCiclo) {
      if (p.hecho) continue
      if (p.frenado || p.videos.join() !== videos.join()) out.actualizar.push({ id: p.id, videos, frenado: null })
    }
  }
  return out
}

// ── iniciarTanda: Aylu marca "guiones enviados" para una tanda del guion ───────────────────────────────────────────
// Crea los videos de esa tanda (los guiones del doc ya leído) en esperando_crudos, con origen `aylu` (abre el ciclo de e01
// con motivo guiones_enviados); a los que ya existían esperando crudos les deja la constancia. Prende la vigilancia de todo
// Crudos del cliente. La API de la pantalla resuelve el modo dry antes de llamar acá.

export interface RepoTanda {
  leerDoc: typeof Guiones.leerDoc; listarVideos: typeof Videos.listarVideos; crearVideoSiFalta: typeof Videos.crearVideoSiFalta
  actualizarVideo: typeof Videos.actualizarVideo; vigilarCrudosDe: typeof Carpetas.vigilarCrudosDe; carpetasDeCliente: typeof Carpetas.carpetasDeCliente
  pasosAbiertos: typeof Seguimientos.pasosAbiertos; marcarPaso: typeof Seguimientos.marcarPaso
}
const REPO_REAL: RepoTanda = {
  leerDoc: Guiones.leerDoc, listarVideos: Videos.listarVideos, crearVideoSiFalta: Videos.crearVideoSiFalta,
  actualizarVideo: Videos.actualizarVideo, vigilarCrudosDe: Carpetas.vigilarCrudosDe, carpetasDeCliente: Carpetas.carpetasDeCliente,
  pasosAbiertos: Seguimientos.pasosAbiertos, marcarPaso: Seguimientos.marcarPaso,
}

export async function iniciarTandaCon(repo: RepoTanda, p: { id_crm: IdCrm; tanda_guion: number; actor: Persona }): Promise<{ videos: Video[]; eventos: EventoVideo[] }> {
  if (!Number.isInteger(p.tanda_guion) || p.tanda_guion < 1 || p.tanda_guion > 99) throw new ErrorEntradaEdicion('tanda_guion', 'tanda inválida')
  if (p.actor.rol !== 'aylu' && p.actor.rol !== 'tomas') throw new ErrorEntradaEdicion('actor', '"guiones enviados" lo marcan Aylu o Tomás')
  const doc = await repo.leerDoc(p.id_crm)
  const guiones = (doc?.guiones ?? []).filter(g => g.tanda === p.tanda_guion)
  if (!doc || !guiones.length) throw new ErrorEntradaEdicion('tanda_guion', `no hay guiones de la tanda ${p.tanda_guion} en el doc leído (esperá la pasada diaria o revisá el doc)`)
  const existentes = await repo.listarVideos({ id_crm: p.id_crm, incluirFinales: true })
  const actor = { tipo: 'persona' as const, ...p.actor }
  const videos: Video[] = [], eventos: EventoVideo[] = []
  const cliente = existentes[0]?.cliente || (await repo.carpetasDeCliente(p.id_crm)).find(c => c.tipo === 'cliente')?.nombre || p.id_crm.toUpperCase()
  for (const g of guiones) {
    const v = existentes.find(x => x.guion?.huella === g.huella) ?? existentes.find(x => x.clave === g.ref)
    if (v) {
      if (v.estado !== 'esperando_crudos') continue
      // Un video que ya creó la pasada desde el doc pasa a origen `aylu`: el envío tiene constancia y el ciclo de e01 que abra
      // es de «guiones enviados» (su día 0 nace hecho). Revisión de la integración, ronda 3: quedaba `doc` y el día 0
      // aparecía pendiente al día siguiente, aunque Aylu ya había mandado los guiones.
      const r = await repo.actualizarVideo({ id: v.id, version: v.version, actor, cambios: v.origen === 'doc' ? { origen: 'aylu' } : {}, tipo: 'envio_cliente',
        nota: `guiones de la tanda ${p.tanda_guion} enviados`, datos: { envio: 'guiones', tanda_guion: p.tanda_guion } })
      if (r.ok) { videos.push(r.actual.video); eventos.push(r.actual.evento) }
      continue
    }
    const r = await repo.crearVideoSiFalta({
      id_crm: p.id_crm, cliente, clave: g.ref, tanda_guion: g.tanda, numero: g.numero, guion: { doc_id: doc.doc_id, ref: g.ref, huella: g.huella },
      guion_texto: textoGuion(g), gancho: ganchoGuion(g), estado: 'esperando_crudos', prioridad: 'normal', origen: 'aylu', clickup_id: null,
    }, actor)
    videos.push(r.video)
    if (r.evento) eventos.push({ ...r.evento, datos: { ...r.evento.datos, motivo: 'guiones_enviados' } })
  }
  await repo.vigilarCrudosDe(p.id_crm)
  // Si el ciclo del cliente ya tenía el día 0 pendiente, el envío lo cumple (lo marca Aylu o Tomás, con la constancia)
  const id = p.id_crm.toUpperCase()
  const dia0 = videos.length ? (await repo.pasosAbiertos()).find(x => x.id_crm.toUpperCase() === id && x.escalon === 'dia0' && !x.hecho) : undefined
  if (dia0) await repo.marcarPaso({ id: dia0.id, version: dia0.version, actor: p.actor, nota: `${NOTA_DIA0_HECHO.guiones_enviados} (tanda ${p.tanda_guion})`, texto: '' })
  return { videos, eventos }
}

/** La firma que usa la API de la pantalla (DepsEdicion.motor.iniciarTanda). */
export function iniciarTanda(p: { id_crm: IdCrm; tanda_guion: number; actor: Persona }): Promise<{ videos: Video[]; eventos: EventoVideo[] }> {
  return iniciarTandaCon(REPO_REAL, p)
}
