// ── Textos de los avisos de Discord de Edición (puro: sin red ni base; lo prueba scripts/test-edicion-avisos.mjs) ──────
// El texto se arma AL DESPACHAR, con lo que hay en ese momento en la base (la "foto" que junta cola.ts): así un aviso
// agrupado ("René terminó 6 de 8") refleja lo último y no lo que había cuando se encoló.
// Reglas (relevamiento 2.8 y la crítica del diseño):
//   · menciones SOLO con id declarado (<@id>, y el id va en la lista `menciones` que se le pasa a allowed_mentions.users);
//     sin id, va el nombre en texto ("@Aylu"), que no notifica a nadie;
//   · todo dato variable (nombres, ganchos, notas, archivos, motivos) pasa por `limpio`: primero sinDatosPersonales (mails
//     y teléfonos afuera) y después escaparDiscord (sin markdown ni menciones). Se aplica a los DATOS antes de armar el
//     mensaje, nunca al texto final (rompería las menciones <@id> de 18 dígitos y los ids de los links);
//   · el link va siempre a la pantalla (/clientes/edicion…), nunca a una API; a Valen (que no entra a /clientes/edicion) le van los links a
//     los ARCHIVOS editados de Drive, nunca a la carpeta (deja editar a cualquiera con el enlace);
//   · máximo 2.000 caracteres: los renglones son ítems enteros y lo que no entra se cuenta como "+N"; el pie con el link
//     no se pierde nunca;
//   · nada de rondas, topes ni negativas en lo que ve el cliente (esto es interno: el tope solo se le cuenta a Tomás).
import { escaparDiscord } from '@/lib/fathomAnuncios/mensaje'
import type { CoberturaGuion, EstadoVideo, NotaVideo, Prioridad, ResumenDaily, TandaSubida, Video } from '../tipos'
import { NOMBRE_DESTINATARIO, type Destinatario, type Menciones } from './entorno'

export const MAX_DISCORD = 2000

export const TIPOS_AVISO = ['tanda_crudos', 'para_editar', 'editados', 'correccion', 'corregidos', 'aprobado', 'tope_rondas', 'marca_falta',
  'marca_propuesta', 'resumen_daily', 'error', 'vigia_callado', 'crudo_borrado', 'vinculo_pendiente', 'transcripcion_fallida', 'bloqueo'] as const
export type TipoAviso = (typeof TIPOS_AVISO)[number]

/** A quién va cada tipo (el resumen suma a Gero M y a Tomás según lo que traiga). */
export const DESTINO: Record<TipoAviso, Destinatario> = {
  tanda_crudos: 'aylu', para_editar: 'rene', editados: 'aylu', correccion: 'rene', corregidos: 'aylu', aprobado: 'valen',
  tope_rondas: 'tomas', marca_falta: 'aylu', marca_propuesta: 'aylu', resumen_daily: 'aylu', error: 'tomas', vigia_callado: 'tomas', crudo_borrado: 'aylu',
  vinculo_pendiente: 'aylu', transcripcion_fallida: 'tomas', bloqueo: 'aylu',
}

/** Lo que mira un aviso de un video (FilaTablero de db/videos.ts la cumple). */
export interface FilaAviso {
  id: number; id_crm: string; cliente: string; clave: string; estado: EstadoVideo; prioridad: Prioridad; gancho: string
  bloqueo: Video['bloqueo']; editado: { url: string } | null; paleta?: boolean; motivo_bloqueo?: string
  /** El número del video (un importado de ClickUp sin tanda se nombra por él, no por su clave CU-…). */
  numero?: number | null
}
export type NotaAviso = Pick<NotaVideo, 'ronda' | 'origen' | 'enviada' | 'segundo' | 'hasta' | 'tipo' | 'texto' | 'tilde'>

/** La foto de la base al despachar (la arma cola.ts según el tipo). */
export interface FotoAviso {
  filas: FilaAviso[]                       // los videos del cliente (o los del aviso), como están AHORA
  notas: Map<number, NotaAviso[]>          // correcciones: las notas de cada video
  tanda: TandaSubida | null                // tanda_crudos: la tanda como está ahora
  sugerenciaMeta: string | null            // aprobado: campaña nueva u optimización (metaReciente.ts)
  canalAds: boolean                        // aprobado: false = no hay webhook de #ads y va a #✂️-edicion para Aylu
}
export const fotoVacia = (): FotoAviso => ({ filas: [], notas: new Map(), tanda: null, sugerenciaMeta: null, canalAds: true })

export interface MensajeAviso { texto: string; menciones: string[] }

// ── Datos personales y escape ─────────────────────────────────────────────────────────────────────────────────────
const RE_MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const RE_TEL = /\+?\d[\d\s().-]{6,}\d/g
/** Saca mails y teléfonos de un dato variable (última barrera: los datos del CRM y de Drive ya llegan sin ellos). */
export function sinDatosPersonales(t: string): string {
  return t.replace(RE_MAIL, '(mail)').replace(RE_TEL, m => {
    const digitos = m.replace(/\D/g, '').length
    if (digitos < 8) return m
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.trim()) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m.trim())) return m   // fechas
    return '(teléfono)'
  })
}
/** Recorta en un límite de palabra (con "…") ANTES de escapar, así el corte nunca cae en medio de un escape. */
export function corto(t: string, max: number): string {
  const s = t.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const c = s.slice(0, Math.max(1, max - 1))
  const i = c.lastIndexOf(' ')
  return `${(i > max * 0.5 ? c.slice(0, i) : c).replace(/[\s,;:.·-]+$/, '')}…`
}
/** Un dato variable listo para Discord: sin mails ni teléfonos, recortado y escapado (sin markdown ni menciones). */
export const limpio = (t: unknown, max = 200): string => escaparDiscord(corto(sinDatosPersonales(String(t ?? '')), max))
/** Un motivo de error: además sin URLs ni cosas que parezcan claves. */
export const motivoLimpio = (t: unknown, max = 300): string =>
  limpio(String(t ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '(url)').replace(/\b(Bearer|Bot)\s+\S+/gi, '$1 (oculto)').replace(/\b[A-Za-z0-9_-]{32,}\b/g, '(oculto)'), max)

// ── Menciones y links ─────────────────────────────────────────────────────────────────────────────────────────────
export function para(d: Destinatario, m: Menciones, usados: string[]): string {
  const id = m[d]
  if (id) { if (!usados.includes(id)) usados.push(id); return `<@${id}>` }
  return `@${NOMBRE_DESTINATARIO[d]}`
}
const link = (texto: string, url: string) => `[${texto}](<${url}>)`
const enc = (s: string) => encodeURIComponent(s)
export const urlCliente = (base: string, id_crm: string) => `${base}/clientes/edicion/cliente/${enc(id_crm)}`
export const urlVideo = (base: string, id: number) => `${base}/clientes/edicion/video/${id}`
const esDrive = (u: string) => { try { const h = new URL(u); return h.protocol === 'https:' && /^(drive|docs)\.google\.com$/.test(h.hostname) && !/\/folders\//.test(h.pathname) } catch { return false } }

/** Cabecera + ítems enteros que entran + "+N" + pie (que no se pierde nunca). `sepPie` separa el pie (por defecto, `sep`). */
export function armar(cabecera: string, items: string[], pie: string, op: { sep?: string; sepPie?: string; max?: number; resto?: (n: number) => string } = {}): string {
  const sep = op.sep ?? '\n', sepPie = op.sepPie ?? sep, max = op.max ?? MAX_DISCORD
  const resto = op.resto ?? (n => `+${n} más en la pantalla`)
  const unir = (xs: string[], fuera: number) => {
    const cuerpo = [cabecera, ...xs, ...(fuera ? [resto(fuera)] : [])].filter(Boolean).join(sep)
    return pie ? `${cuerpo}${sepPie}${pie}` : cuerpo
  }
  const dentro: string[] = []
  for (const it of items) {
    if (unir([...dentro, it], items.length - dentro.length - 1).length > max) break
    dentro.push(it)
  }
  let t = unir(dentro, items.length - dentro.length)
  if (t.length > max) t = `${corto(cabecera, Math.max(50, max - pie.length - 30))}${sepPie}${pie}`
  return t.length > max ? t.slice(0, max) : t
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const mmss = (s: number | null) => {
  if (s === null || !Number.isFinite(s)) return ''
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
/** "T2-V4" → "video 4"; con la tanda del guion si se pide. Un importado de ClickUp (CU-…) → "video N (ClickUp)" con el
 *  número que se leyó de su nombre, nunca la clave opaca. */
export function nombreVideo(clave: string, conTanda = false, numero?: number | null): string {
  const m = /^T(\d+)-V(\d+)$/.exec(clave)
  if (m) return conTanda ? `T${m[1]} video ${Number(m[2])}` : `video ${Number(m[2])}`
  if (/^CU-/i.test(clave)) return typeof numero === 'number' && numero > 0 ? `video ${numero} (ClickUp)` : 'video de ClickUp'
  return limpio(clave, 40)
}

// ── Cada tipo ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DatosTanda { tanda_id: number; id_crm: string; cliente: string; demorada: boolean }

const SUBIO: Record<string, string> = { cliente: 'los subió el cliente', equipo: 'los subió el equipo', mixto: 'los subieron el cliente y el equipo' }

/** "Tanda 1" si todos los guiones de la cobertura son de la misma tanda del guion. */
function tandaDelGuion(gs: CoberturaGuion[]): string {
  const ts = [...new Set(gs.map(g => /^T(\d+)-V\d+$/.exec(g.guion_ref)?.[1]).filter(Boolean))]
  return ts.length === 1 ? `Tanda ${ts[0]}` : ts.length > 1 ? `Tandas ${ts.join(' y ')}` : ''
}

export function textoTandaCrudos(d: DatosTanda, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const t = foto.tanda
  if (!t || t.tipo !== 'crudos') return null
  const usados: string[] = []
  const r = t.resultado
  const tg = r ? tandaDelGuion(r.guiones) : ''
  const partes = [
    `${para('aylu', m, usados)} 📥 **Crudos nuevos · ${limpio(d.cliente, 80)}**`,
    `${tg ? `${tg}: ` : ''}${plural(t.archivos, 'archivo', 'archivos')}${SUBIO[t.subio] ? ` (${SUBIO[t.subio]})` : ''}`,
  ]
  const items: string[] = []
  if (r) {
    const completos = r.guiones.filter(g => g.estado === 'completo').length
    if (r.guiones.length) partes.push(`${completos} de ${r.guiones.length} ${r.guiones.length === 1 ? 'guion completo' : 'guiones completos'}`)
    for (const g of r.guiones) {
      const quien = nombreVideo(g.guion_ref)
      if (g.estado === 'sin_transcripcion') items.push(`${quien}: sin transcribir`)
      else if (g.estado === 'incompleto') {
        const falta = g.faltan[0] ? ` («${limpio(g.faltan[0], 70)}»${g.faltan.length > 1 ? ` y ${g.faltan.length - 1} más` : ''})` : ''
        items.push(`${quien}: ${g.faltan.length ? `${plural(g.faltan.length, 'frase falta', 'frases faltan')}${falta}` : 'incompleto'}${g.dudosas.length ? ` · ${plural(g.dudosas.length, 'dudosa', 'dudosas')}` : ''}`)
      } else if (g.dudosas.length) items.push(`${quien}: ${plural(g.dudosas.length, 'frase dudosa', 'frases dudosas')}`)
    }
    if (r.sin_ubicar.length) items.push(`${plural(r.sin_ubicar.length, 'crudo sin ubicar', 'crudos sin ubicar')} (asignalos en la pantalla)`)
    if (r.sin_transcribir.length) items.push(`${plural(r.sin_transcribir.length, 'crudo sin transcribir', 'crudos sin transcribir')}`)
  } else {
    items.push(d.demorada ? 'la transcripción viene demorada: el resultado de la comparación va a quedar en la pantalla' : 'todavía sin comparar con los guiones')
  }
  const pie = link('Revisar', urlCliente(base, d.id_crm))
  const texto = armar(partes.join(' · '), items, pie, { sep: ' · ', resto: n => `+${n}` })
  return { texto, menciones: usados }
}

export interface DatosCliente { id_crm: string; cliente: string; videos?: number[] }

export function textoParaEditar(d: DatosCliente, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const cola = foto.filas.filter(f => f.estado === 'para_editar' && f.bloqueo !== 'tope_rondas_cliente')
  if (!cola.length) return null
  const usados: string[] = []
  const urgentes = cola.filter(f => f.prioridad === 'urgente').length
  const paleta = cola.some(f => f.paleta === false) ? '⚠️ sin paleta (pedila a Aylu)' : 'paleta cargada'
  const cuantos = `${plural(cola.length, 'video', 'videos')}${urgentes ? ` (${urgentes === cola.length ? 'urgente' : `${urgentes} urgente${urgentes > 1 ? 's' : ''}`})` : ''}`
  const texto = [`${para('rene', m, usados)} ✂️ **Para editar · ${limpio(d.cliente, 80)}**`, cuantos, paleta, link('Edición', `${base}/clientes/edicion?cola=rene`)].join(' · ')
  return { texto, menciones: usados }
}

export function textoEditados(d: DatosCliente, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const hechos = foto.filas.filter(f => f.estado === 'editado').length
  const faltan = foto.filas.filter(f => f.estado === 'para_editar').length
  if (!hechos) return null
  const usados: string[] = []
  const cuanto = faltan ? `${hechos} de ${hechos + faltan}` : (hechos === 1 ? 'el video' : `los ${hechos} videos`)
  const texto = `${para('aylu', m, usados)} 👀 René terminó ${cuanto} de ${limpio(d.cliente, 80)} · ${link('revisar', urlCliente(base, d.id_crm))}`
  return { texto, menciones: usados }
}

export function textoCorregidos(d: DatosCliente, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const hechos = foto.filas.filter(f => f.estado === 'corregido').length
  const faltan = foto.filas.filter(f => f.estado === 'correccion').length
  if (!hechos) return null
  const usados: string[] = []
  const cuanto = faltan ? `${hechos} de ${hechos + faltan}` : (hechos === 1 ? 'el video' : `los ${hechos} videos`)
  const texto = `${para('aylu', m, usados)} ✅ René corrigió ${cuanto} de ${limpio(d.cliente, 80)} · ${link('revisar', urlCliente(base, d.id_crm))}`
  return { texto, menciones: usados }
}

const ETIQUETA_TIPO: Record<string, string> = { texto: 'texto', corte: 'corte', velocidad: 'velocidad', broll: 'b-roll', titulo: 'título', guion: 'guion', audio: 'audio', otro: 'otro' }

export function textoCorreccion(d: DatosCliente, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const ids = new Set(d.videos ?? [])
  const enCorreccion = foto.filas.filter(f => f.estado === 'correccion' && (!ids.size || ids.has(f.id)))
  const bloques: string[] = []
  let totalNotas = 0
  for (const f of enCorreccion) {
    // Solo las de la corrección EN CURSO: las de una corrección anterior que Aylu dio por corregida sin tildar no se repiten
    const enviadas = (foto.notas.get(f.id) ?? []).filter(n => n.enviada)
    const ronda = enviadas.length ? Math.max(...enviadas.map(n => n.ronda)) : 0
    const notas = enviadas.filter(n => n.ronda === ronda && !n.tilde)
    if (!notas.length) continue
    totalNotas += notas.length
    const origenes = [...new Set(notas.map(n => n.origen))]
    const de = origenes.length > 1 ? 'de Aylu y del cliente' : origenes[0] === 'cliente' ? 'del cliente' : 'de Aylu'
    const renglones = notas.slice(0, 8).map(n => {
      const cuando = n.segundo !== null ? `${mmss(n.segundo)}${n.hasta !== null ? `–${mmss(n.hasta)}` : ''} · ` : ''
      return `  · ${cuando}${ETIQUETA_TIPO[n.tipo] ?? 'otro'}: ${limpio(n.texto, 160)}`
    })
    if (notas.length > 8) renglones.push(`  · +${notas.length - 8} notas más en la pantalla`)
    // "corrección N" (la cuenta total, como en la ficha); "ronda" queda para el contador del cliente (P6) y el aviso a Tomás
    bloques.push(`• ${nombreVideo(f.clave, false, f.numero)}${f.gancho ? ` («${limpio(f.gancho, 60)}»)` : ''} (corrección ${ronda}, ${de}): ${plural(notas.length, 'nota', 'notas')}\n${renglones.join('\n')}`)
  }
  if (!bloques.length || !totalNotas) return null
  const usados: string[] = []
  const cab = `${para('rene', m, usados)} 🛠️ **Corrección · ${limpio(d.cliente, 80)}**`
  const texto = armar(cab, bloques, link('Ver en Edición', `${base}/clientes/edicion?cola=rene`), { resto: n => `+${n} videos más en la pantalla` })
  return { texto, menciones: usados }
}

export function textoAprobado(d: DatosCliente, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const ids = new Set(d.videos ?? [])
  const ok = foto.filas.filter(f => f.estado === 'aprobado' && (!ids.size || ids.has(f.id)))
  if (!ok.length) return null
  const usados: string[] = []
  const links = ok.map(f => (f.editado && esDrive(f.editado.url) ? link(nombreVideo(f.clave, true, f.numero), f.editado.url) : `${nombreVideo(f.clave, true, f.numero)} (sin link)`))
  const sugerencia = foto.sugerenciaMeta ? limpio(foto.sugerenciaMeta, 160) : 'sin dato de Meta: decidir con Tomás'
  const quien = foto.canalAds ? para('valen', m, usados) : `${para('aylu', m, usados)} para reenviarle a Valen (falta el webhook de #ads):`
  const cab = `${quien} 🎬 **${limpio(d.cliente, 80)} aprobó ${plural(ok.length, 'video', 'videos')}**`
  const pie = foto.canalAds ? `💡 ${sugerencia}` : `💡 ${sugerencia} · ${link('Edición', urlCliente(base, d.id_crm))}`
  return { texto: armar(cab, links, pie, { sep: ' · ', sepPie: '\n', resto: n => `+${n}` }), menciones: usados }
}

export interface DatosTope { video_id: number; id_crm: string; cliente: string; clave: string; ronda: number; pedido_id: number; numero?: number | null }
export function textoTope(d: DatosTope, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  const texto = `${para('tomas', m, usados)} 🚦 **Tope de rondas · ${limpio(d.cliente, 80)} · ${nombreVideo(d.clave, true, d.numero)}**: el cliente pidió la ronda ${d.ronda} de correcciones. ` +
    `Espera tu OK para pasarle las notas a René (al cliente no se le dijo nada) · ${link('Ver el pedido', urlVideo(base, d.video_id))}`
  return { texto, menciones: usados }
}

export interface DatosMarca { id_crm: string; cliente: string; videos: number }
export function textoMarcaFalta(d: DatosMarca, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  const texto = `${para('aylu', m, usados)} 🎨 Falta la paleta de ${limpio(d.cliente, 80)}: ${d.videos > 0 ? `${plural(d.videos, 'video pasó', 'videos pasaron')} a Para editar` : 'hay videos en Para editar'} sin colores cargados (no frena nada) · ${link('Cargar la ficha', urlCliente(base, d.id_crm))}`
  return { texto, menciones: usados }
}

// e05: el cliente subió algo a "Marca - X" y Claude leyó colores. Es una propuesta: la ficha la confirma Aylu
export interface DatosMarcaPropuesta { id_crm: string; cliente: string; archivos: number; archivo: string }
export function textoMarcaPropuesta(d: DatosMarcaPropuesta, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  const que = d.archivos > 1 ? `${d.archivos} archivos` : `«${limpio(d.archivo, 60)}»`
  const texto = `${para('aylu', m, usados)} 🎨 ${limpio(d.cliente, 80)} subió su marca (${que}): el bot leyó la paleta y la dejó como propuesta. Revisala y guardala en la ficha · ${link('Ver la propuesta', urlCliente(base, d.id_crm))}`
  return { texto, menciones: usados }
}

const ETIQUETA_ESCALON = (e: string): string => ({ dia0: 'día 0 (mensaje)', dia2: 'día 2 (audio de Gero M)', dia4: 'día 4 (llamada)', dia9: 'día 9 (decide Tomás)' } as Record<string, string>)[e] ?? 'recordatorio'
const COLAS: [EstadoVideo, string][] = [['esperando_crudos', 'esperando crudos'], ['crudo_a_revisar', 'crudos a revisar'], ['regrabar', 'regrabar'], ['para_editar', 'para editar'],
  ['editado', 'editados'], ['correccion', 'en corrección'], ['corregido', 'corregidos'], ['con_cliente', 'con el cliente']]
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const fechaCorta = (ymd: string) => { const [y, mo, d] = ymd.split('-').map(Number); const w = new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay(); return `${DIAS[w]} ${d}/${mo}` }

export function textoResumen(r: ResumenDaily, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  const hay = (e: string) => r.escalones.some(x => x.escalon === e && x.clientes.length)
  const quienes = [para('aylu', m, usados), ...(hay('dia2') || hay('dia4') ? [para('gero_m', m, usados)] : []), ...(hay('dia9') ? [para('tomas', m, usados)] : [])]
  const lineas: string[] = []
  const porEscalon: string[] = []
  // Los recordatorios r1, r2… se juntan en uno
  const grupos = new Map<string, string[]>()
  for (const e of r.escalones) {
    if (!e.clientes.length) continue
    const k = ETIQUETA_ESCALON(e.escalon)
    grupos.set(k, [...(grupos.get(k) ?? []), ...e.clientes.map(c => limpio(c.cliente, 40))])
  }
  for (const [k, cs] of grupos) porEscalon.push(`${k}: ${listaCorta(cs, 6)}`)
  lineas.push(`🎬 **Grabaciones pendientes:** ${porEscalon.length ? porEscalon.join(' · ') : 'nadie atrasado'}`)
  const colas = COLAS.filter(([e]) => (r.colas[e] ?? 0) > 0).map(([e, n]) => `${n} ${r.colas[e]}`)
  lineas.push(`🗂️ **Colas:** ${colas.length ? colas.join(' · ') : 'todo al día'}`)
  if (r.cola_rene.length) lineas.push(`✂️ **Cola de René:** ${listaCorta(r.cola_rene.map(c => `${limpio(c.cliente, 40)} ${c.videos}${c.urgente ? ' (urgente)' : ''}`), 6)}`)
  if (r.trabados.length) {
    const quien: Record<string, string> = { aylu: 'Aylu', rene: 'René', cliente: 'cliente' }
    lineas.push(`⏱️ **Trabados:** ${listaCorta([...r.trabados].sort((a, b) => b.horas - a.horas).map(t => `${limpio(t.cliente, 30)} ${nombreVideo(t.clave, true)} (${t.estado === 'con_cliente' ? `${t.habiles} días hábiles` : `${Math.round(t.horas)} h`}, ${quien[t.quien]})`), 5)}`)
  }
  if (r.grabado_sin_crudos.length) lineas.push(`📭 **Marcado grabado y sin crudos:** ${listaCorta(r.grabado_sin_crudos.map(g => `${limpio(g.cliente, 40)} (${g.refs.length})`), 5)}`)
  const extras = [
    r.editados_por_vincular ? `editados por vincular: ${r.editados_por_vincular}` : '',
    r.vinculos_por_confirmar ? `carpetas por confirmar: ${r.vinculos_por_confirmar}` : '',
    r.sin_transcribir?.length ? `sin transcribir: ${r.sin_transcribir.reduce((s, x) => s + x.archivos, 0)} crudos (plan B)` : '',
    r.avisos_guiones?.length ? `docs de guiones para mirar: ${r.avisos_guiones.length}` : '',
  ].filter(Boolean)
  if (extras.length) lineas.push(`🔗 ${extras.join(' · ')}`)
  const cab = `${quienes.join(' ')} 📋 **Resumen para la daily · ${fechaCorta(r.fecha)}**`
  const pie = `👉 ${link('Grabaciones pendientes', `${base}/clientes/edicion/pendientes`)} · ${link('Tablero', `${base}/clientes/edicion`)}`
  return { texto: armar(cab, lineas, pie, { resto: n => `(+${n} renglones en la pantalla)` }), menciones: usados }
}
/** Los primeros `n` ítems y "+N". */
const listaCorta = (xs: string[], n: number) => (xs.length > n ? `${xs.slice(0, n).join(', ')} y ${xs.length - n} más` : xs.join(', '))

export function textoError(d: { proceso: string; motivo: string }, m: Menciones): MensajeAviso {
  const usados: string[] = []
  return { texto: `${para('tomas', m, usados)} ⚠️ **Edición · error en ${limpio(d.proceso, 40)}:** ${motivoLimpio(d.motivo)}`, menciones: usados }
}

const horaAR = (iso: string) => { const t = new Date(iso); return Number.isFinite(t.getTime()) ? t.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }) : '?' }
export function textoVigiaCallado(d: { desde: string; horas: number }, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  return {
    texto: `${para('tomas', m, usados)} ⏰ El vigía de Crudos no corre hace ${Math.max(1, Math.round(d.horas))} h (la última corrida fue a las ${horaAR(d.desde)}). ` +
      `Revisá el disparador del Puente Drive (función dispararVigia) · ${link('Edición', `${base}/clientes/edicion`)}`,
    menciones: usados,
  }
}

export function textoCrudoBorrado(d: { video_id: number; cliente: string; clave: string; archivo: string; numero?: number | null }, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  return {
    texto: `${para('aylu', m, usados)} 🗑️ Se borró un crudo de ${limpio(d.cliente, 80)} · ${nombreVideo(d.clave, true, d.numero)}: «${limpio(d.archivo, 100)}». ` +
      `El video queda bloqueado hasta que lo resuelvas · ${link('Ver', urlVideo(base, d.video_id))}`,
    menciones: usados,
  }
}

export function textoVinculo(d: { carpeta_id: string; nombre: string; candidatos: { id_crm: string; nombre: string; puntaje: number }[] }, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  const cands = d.candidatos.slice(0, 3).map(c => `${limpio(c.nombre, 40)} (${limpio(c.id_crm, 8)})`)
  return {
    texto: `${para('aylu', m, usados)} 🔗 Carpeta sin confirmar: «${limpio(d.nombre, 80)}»${cands.length ? ` · ¿es ${cands.join(' o ')}?` : ' · sin candidatos en el CRM'} ` +
      `Hasta que la confirmes no se procesa nada de esa carpeta · ${link('Vínculos', `${base}/clientes/edicion/vinculos`)}`,
    menciones: usados,
  }
}

export interface DatosTranscripcion { id_crm: string; cliente: string; archivos: { archivo_id: number; nombre: string; motivo: 'link_privado' | 'grande' }[] }
export function textoTranscripcion(d: DatosTranscripcion, m: Menciones, base: string): MensajeAviso | null {
  if (!d.archivos?.length) return null
  const usados: string[] = []
  const porque = { link_privado: 'AssemblyAI no pudo bajarlo (el link no es público)', grande: 'pesa más que el tope (plan B)' }
  const items = d.archivos.map(a => `«${limpio(a.nombre, 60)}»: ${porque[a.motivo] ?? 'no se pudo transcribir'}`)
  const cab = `${para('tomas', m, usados)} 🎙️ Crudos sin transcribir · ${limpio(d.cliente, 80)} (Aylu los revisa a mano)`
  return { texto: armar(cab, items, link('Ver crudos', urlCliente(base, d.id_crm)), { sep: ' · ', resto: n => `+${n}` }), menciones: usados }
}

export function textoBloqueo(d: { video_id: number; cliente: string; clave: string; motivo: string; quien: string; numero?: number | null }, m: Menciones, base: string): MensajeAviso {
  const usados: string[] = []
  return {
    texto: `${para('aylu', m, usados)} ⛔ ${limpio(d.quien, 30)} marcó un bloqueo en ${limpio(d.cliente, 80)} · ${nombreVideo(d.clave, true, d.numero)}: «${limpio(d.motivo, 200)}» · ${link('Ver', urlVideo(base, d.video_id))}`,
    menciones: usados,
  }
}

/** El texto de un aviso según su tipo (null = ya no hay nada que decir: el aviso queda "descartado"). */
export function armarMensaje(a: { tipo: string; datos: Record<string, unknown> }, foto: FotoAviso, m: Menciones, base: string): MensajeAviso | null {
  const d = a.datos as never
  switch (a.tipo as TipoAviso) {
    case 'tanda_crudos': return textoTandaCrudos(d, foto, m, base)
    case 'para_editar': return textoParaEditar(d, foto, m, base)
    case 'editados': return textoEditados(d, foto, m, base)
    case 'correccion': return textoCorreccion(d, foto, m, base)
    case 'corregidos': return textoCorregidos(d, foto, m, base)
    case 'aprobado': return textoAprobado(d, foto, m, base)
    case 'tope_rondas': return textoTope(d, m, base)
    case 'marca_falta': return textoMarcaFalta(d, m, base)
    case 'marca_propuesta': return textoMarcaPropuesta(d, m, base)
    case 'resumen_daily': return textoResumen((a.datos as { resumen: ResumenDaily }).resumen, m, base)
    case 'error': return textoError(d, m)
    case 'vigia_callado': return textoVigiaCallado(d, m, base)
    case 'crudo_borrado': return textoCrudoBorrado(d, m, base)
    case 'vinculo_pendiente': return textoVinculo(d, m, base)
    case 'transcripcion_fallida': return textoTranscripcion(d, m, base)
    case 'bloqueo': return textoBloqueo(d, m, base)
    default: return null
  }
}
