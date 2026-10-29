// ── Tandas de subida e inferencia de tanda / video (puro) ───────────────────────────────────────────────────────────
//   · inferirUbicacion(ruta, nombre): a qué guion va un crudo según su carpeta ("Tanda 1 / Video 4", así viene el 73 %) o,
//     si la carpeta no lo dice, según el nombre del archivo ("video 4", "V4", "T2V4", "T2-V4"). Los nombres del celular
//     (IMG_0249.MOV) no dicen nada.
//   · agrupar(archivos, abiertas, ahora): arma los grupos por el hueco de CIERRE_TANDA_MIN. El primero se suma a la tanda
//     abierta si el archivo cae dentro de sus 45 minutos; un hueco mayor abre un grupo nuevo (tanda_id null).
import type { ArchivoDrive, QuienSubio, TandaSubida } from '../../edicion/tipos'
import { CIERRE_TANDA_MIN } from '../../edicion/config'

export interface Ubicacion { tanda_guion: number | null; numero: number | null; por: 'carpeta' | 'nombre' | null }

const enRango = (n: number): number | null => (Number.isInteger(n) && n >= 1 && n <= 99 ? n : null)
const sinExtension = (s: string): string => s.replace(/\.[A-Za-z0-9]{2,5}$/, '')

function leerTexto(s: string): { tanda: number | null; numero: number | null } {
  const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const junto = /\bT\s*(\d{1,2})\s*[-_ ]?\s*V\s*(\d{1,2})\b/i.exec(t)
  if (junto) return { tanda: enRango(Number(junto[1])), numero: enRango(Number(junto[2])) }
  const tanda = /\btanda\s*(?:n[°ºo.]?\s*)?(\d{1,2})/i.exec(t)
  const video = /\bvideo\s*(?:n[°ºo.]?\s*)?(\d{1,2})\b/i.exec(t) ?? /(?:^|[\s_.-])v\s*(\d{1,2})(?=$|[\s_.-])/i.exec(t)
  return { tanda: tanda ? enRango(Number(tanda[1])) : null, numero: video ? enRango(Number(video[1])) : null }
}

/** La carpeta manda sobre el nombre; si la carpeta da solo la tanda, el número puede salir del nombre. */
export function inferirUbicacion(ruta: readonly string[], nombre: string): Ubicacion {
  let tanda: number | null = null, numero: number | null = null
  for (const parte of ruta) {
    const r = leerTexto(parte)
    if (r.tanda !== null) tanda = r.tanda
    if (r.numero !== null) numero = r.numero
  }
  if (numero !== null) return { tanda_guion: tanda, numero, por: 'carpeta' }
  const n = leerTexto(sinExtension(nombre))
  if (n.numero !== null) return { tanda_guion: tanda ?? n.tanda, numero: n.numero, por: 'nombre' }
  return { tanda_guion: tanda ?? n.tanda, numero: null, por: null }
}

export interface GrupoTanda { tanda_id: number | null; archivos: number[]; desde: string; hasta: string; subio: QuienSubio | 'mixto' }

const subioDe = (xs: QuienSubio[]): QuienSubio | 'mixto' => (new Set(xs).size === 1 ? xs[0] : 'mixto')

export function agrupar(archivos: readonly (Pick<ArchivoDrive, 'creado' | 'subio'> & { id: number })[], abiertas: readonly TandaSubida[], ahora: Date): GrupoTanda[] {
  const hueco = CIERRE_TANDA_MIN * 60_000
  const t = (iso: string) => { const x = Date.parse(iso); return Number.isFinite(x) ? x : ahora.getTime() }
  const xs = [...archivos].sort((a, b) => t(a.creado) - t(b.creado) || a.id - b.id)
  const abierta = abiertas.find(a => a.estado === 'abierta') ?? null
  const grupos: { tanda_id: number | null; ids: number[]; desde: number; hasta: number; subio: QuienSubio[] }[] = []
  type Grupo = { tanda_id: number | null; ids: number[]; desde: number; hasta: number; subio: QuienSubio[] }
  let actual: Grupo | null = abierta ? { tanda_id: abierta.id, ids: [], desde: t(abierta.desde), hasta: t(abierta.hasta), subio: [] } : null
  if (actual && abierta && abierta.subio !== 'mixto') actual.subio.push(abierta.subio)
  for (const a of xs) {
    const ta = t(a.creado)
    if (actual && ta - actual.hasta <= hueco) {
      actual.ids.push(a.id); actual.hasta = Math.max(actual.hasta, ta); actual.desde = Math.min(actual.desde, ta); actual.subio.push(a.subio)
      continue
    }
    if (actual && actual.ids.length) grupos.push(actual)
    actual = { tanda_id: null, ids: [a.id], desde: ta, hasta: ta, subio: [a.subio] }
  }
  if (actual && actual.ids.length) grupos.push(actual)
  return grupos.map(g => ({ tanda_id: g.tanda_id, archivos: g.ids, desde: new Date(g.desde).toISOString(), hasta: new Date(g.hasta).toISOString(), subio: subioDe(g.subio) }))
}
