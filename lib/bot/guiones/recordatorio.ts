// Recordatorio de guiones editados sin verificar (pedido de RESPONSABLE_HUB, 2/11/2026). Quien corrige un guion y guarda,
// pero no tilda «✓ Verificado» ni da el check final, deja la tanda trabada en a_revisar: el Doc nunca se carga. Una vez por
// día hábil (cron de Vercel) se le avisa a quien editó: mención en el canal de guiones de Discord y la campanita del Despacho.
// Solo tandas en a_revisar con al menos un guion editado hace más de HORAS_GRACIA y sin verificar. Una alerta por tanda y día.
// Ampliado (CONSULTOR, 3/11/2026): también la revisión empezada y no terminada, sin ediciones sueltas: «faltan X por
// verificar» (A169, 5/6) o «falta el check final» (A170 y A167, 6/6). Esas mencionan a Faus y Gero M; el check lo da Faus.
import type { Alerta } from '@/lib/alertas/alerta'
import type { Rol } from '@/lib/alertas/personas'
import type { NuevaNotificacion } from '@/lib/notificaciones/modelo'
import type { FilaTanda } from './registro'

export const HORAS_GRACIA = 2

export interface Pendiente { fila: FilaTanda; numeros: number[]; editores: string[]; desde: string }
/** Revisión empezada (algún «✓ Verificado») y sin terminar: faltan = los guiones sin verificar ([] = falta el check final). */
export interface RevisionPendiente { fila: FilaTanda; faltan: number[]; total: number; desde: string }

const mails = (v?: string) => (v ?? '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes('@'))
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** El rol de quien editó (lo que guarda la pantalla: el nombre de la sesión). null si no es Tomi ni Faus. */
export function rolDeEditor(quien: string): Rol | null {
  const n = normal(quien)
  return n.startsWith('faus') ? 'faus' : n.startsWith('tomas') || n.startsWith('tomi') ? 'tomas' : null
}

/** Las tandas a recordar: a_revisar, con guiones editados hace más de HORAS_GRACIA y sin «✓ Verificado». Puro. */
export function pendientesSinVerificar(filas: readonly FilaTanda[], ahora: Date = new Date()): Pendiente[] {
  const limite = ahora.getTime() - HORAS_GRACIA * 3_600_000
  return filas.flatMap((fila): Pendiente[] => {
    if (fila.estado !== 'a_revisar') return []
    const sueltos = Object.entries(fila.guiones)
      .filter(([, g]) => g.editado?.cuando && !(g.verificado && typeof g.verificado === 'object'))
      .map(([n, g]) => ({ n: Number(n), quien: g.editado!.quien, cuando: g.editado!.cuando }))
    if (!sueltos.length || !sueltos.every(s => Date.parse(s.cuando) <= limite)) return []
    return [{
      fila, numeros: sueltos.map(s => s.n).sort((a, b) => a - b),
      editores: [...new Set(sueltos.map(s => s.quien))], desde: sueltos.map(s => s.cuando).sort()[0],
    }]
  })
}

const verificado = (g: { verificado?: unknown }) => !!(g.verificado && typeof g.verificado === 'object')
const cuandoDe = (x: unknown) => (x && typeof x === 'object' && typeof (x as { cuando?: unknown }).cuando === 'string' ? (x as { cuando: string }).cuando : null)

/** Las tandas con la revisión a medias: a_revisar, sin ediciones sin verificar (eso es pendientesSinVerificar), con algún
 *  guion verificado y el último movimiento hace más de HORAS_GRACIA. Puro. */
export function revisionesPendientes(filas: readonly FilaTanda[], ahora: Date = new Date()): RevisionPendiente[] {
  const limite = ahora.getTime() - HORAS_GRACIA * 3_600_000
  return filas.flatMap((fila): RevisionPendiente[] => {
    if (fila.estado !== 'a_revisar') return []
    const gs = Object.entries(fila.guiones)
    if (!gs.length || gs.some(([, g]) => g.editado?.cuando && !verificado(g)) || !gs.some(([, g]) => verificado(g))) return []
    const marcas = gs.flatMap(([, g]) => [cuandoDe(g.editado), cuandoDe(g.verificado)]).filter((c): c is string => !!c).sort()
    if (!marcas.length || Date.parse(marcas[marcas.length - 1]) > limite) return []
    return [{ fila, faltan: gs.filter(([, g]) => !verificado(g)).map(([n]) => Number(n)).sort((a, b) => a - b), total: gs.length, desde: marcas[marcas.length - 1] }]
  })
}

const lista = (ns: number[]) => ns.length === 1 ? `el guion ${ns[0]}` : `los guiones ${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`

/** La alerta de Discord (canal guiones) de una tanda, una por día. Puro. */
export function alertaSinVerificar(p: Pendiente, dia: string): Alerta {
  const id = p.fila.id_crm!
  // Tomás (3/11/2026): no se lo menciona en la revisión de guiones; lo que él deja editado sin verificar lo cierra Faus.
  const roles = [...new Set(p.editores.map((e): Rol | null => { const r = rolDeEditor(e); return r === 'tomas' ? 'faus' : r }).filter((r): r is Rol => !!r))]
  return {
    canal: 'guiones', tipo: 'guiones_sin_verificar', clave: `guiones_sin_verificar:${p.fila.id}:${dia}`,
    idCrm: id, cliente: p.fila.cliente?.trim() || id, emoji: '⏰',
    titulo: 'Guiones editados sin verificar: la tanda no se publica',
    lineas: [
      `Hay cambios en ${lista(p.numeros)} sin «✓ Verificado».`,
      'Guardar solo no publica: tildá «✓ Verificado» en cada guion y después dá el check final para que se cargue en el Doc.',
    ],
    link: `/guiones/${encodeURIComponent(id)}`, menciones: roles.length ? roles : ['faus', 'gero_m'],
  }
}

/** La campanita del Despacho: a Faus por su mail (también cuando editó Tomás); si no, la sección guiones. Puro. */
export function notificacionesSinVerificar(p: Pendiente, dia: string, env: Record<string, string | undefined> = process.env): NuevaNotificacion[] {
  const id = p.fila.id_crm!
  const base: NuevaNotificacion = {
    tipo: 'guiones_sin_verificar', titulo: `Guiones sin verificar · ${p.fila.cliente ?? id}`,
    cuerpo: `Hay cambios en ${lista(p.numeros)}: tildá «✓ Verificado» en cada uno y dá el check final. Guardar solo no publica.`,
    url: `/guiones/${encodeURIComponent(id)}`, origen: 'bot-guiones', urgente: true,
  }
  const emails = [...new Set(p.editores.flatMap(e => {
    const r = rolDeEditor(e)
    return r === 'faus' || r === 'tomas' ? mails(env.GUIONES_REVISOR_FAUS) : []
  }))]
  return emails.length
    ? emails.map(email => ({ ...base, paraEmail: email, clave: `guiones-sin-verificar:${p.fila.id}:${dia}:${email}` }))
    : [{ ...base, paraSeccion: 'guiones', clave: `guiones-sin-verificar:${p.fila.id}:${dia}` }]
}

const queFalta = (r: RevisionPendiente) => r.faltan.length
  ? `${r.faltan.length === 1 ? 'Falta 1 por verificar' : `Faltan ${r.faltan.length} por verificar`} (${lista(r.faltan)}) y después el check final`
  : 'Falta el check final'

/** La alerta de la revisión a medias (canal guiones), una por tanda y día. Menciona a Faus y Gero M. Puro. */
export function alertaRevision(r: RevisionPendiente, dia: string): Alerta {
  const id = r.fila.id_crm!
  return {
    canal: 'guiones', tipo: 'guiones_revision_pendiente', clave: `guiones_revision_pendiente:${r.fila.id}:${dia}`,
    idCrm: id, cliente: r.fila.cliente?.trim() || id, emoji: '⏰',
    titulo: r.faltan.length ? 'Guiones a medio verificar: la tanda no se publica' : 'Falta el check final: la tanda no se publica',
    lineas: [
      `${queFalta(r)}: van ${r.total - r.faltan.length} de ${r.total} verificados.`,
      'Hasta el check final de Faus no se carga en el Doc ni se avisa para grabar.',
    ],
    link: `/guiones/${encodeURIComponent(id)}`, menciones: ['faus', 'gero_m'],
  }
}

/** La campanita de la revisión a medias: a Faus por su mail; si no, la sección guiones. Puro. */
export function notificacionesRevision(r: RevisionPendiente, dia: string, env: Record<string, string | undefined> = process.env): NuevaNotificacion[] {
  const id = r.fila.id_crm!
  const base: NuevaNotificacion = {
    tipo: 'guiones_revision_pendiente', titulo: `${r.faltan.length ? 'Guiones sin verificar' : 'Falta el check final'} · ${r.fila.cliente ?? id}`,
    cuerpo: `${queFalta(r)}. Hasta el check final no se carga en el Doc.`,
    url: `/guiones/${encodeURIComponent(id)}`, origen: 'bot-guiones', urgente: true,
  }
  const emails = mails(env.GUIONES_REVISOR_FAUS)
  return emails.length
    ? emails.map(email => ({ ...base, paraEmail: email, clave: `guiones-revision-pendiente:${r.fila.id}:${dia}:${email}` }))
    : [{ ...base, paraSeccion: 'guiones', clave: `guiones-revision-pendiente:${r.fila.id}:${dia}` }]
}

export interface DepsRecordatorio {
  leer(): Promise<FilaTanda[]>
  alertar(a: Alerta): Promise<{ estado: string }>
  notificar(n: NuevaNotificacion): Promise<unknown>
}

/** Corre el recordatorio. dry: solo devuelve qué avisaría. */
export async function correrRecordatorio(deps: DepsRecordatorio, op: { ahora?: Date; dry?: boolean } = {}) {
  const ahora = op.ahora ?? new Date()
  const dia = new Date(ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)   // día de Argentina
  const filas = await deps.leer()
  const pendientes = pendientesSinVerificar(filas, ahora), revisiones = revisionesPendientes(filas, ahora)
  const resumen = pendientes.map(p => ({ id: p.fila.id, idCrm: p.fila.id_crm, guiones: p.numeros, editores: p.editores }))
  const aMedias = revisiones.map(r => ({ id: r.fila.id, idCrm: r.fila.id_crm, faltan: r.faltan, total: r.total }))
  if (op.dry) return { dry: true, dia, pendientes: resumen, revisiones: aMedias }
  const resultados: string[] = []
  for (const p of pendientes) {
    const a = await deps.alertar(alertaSinVerificar(p, dia)).catch(e => ({ estado: `error: ${(e as Error)?.name ?? 'error'}` }))
    await Promise.all(notificacionesSinVerificar(p, dia).map(n => deps.notificar(n).catch(() => null)))
    resultados.push(`${p.fila.id_crm}: ${a.estado}`)
  }
  for (const r of revisiones) {
    const a = await deps.alertar(alertaRevision(r, dia)).catch(e => ({ estado: `error: ${(e as Error)?.name ?? 'error'}` }))
    await Promise.all(notificacionesRevision(r, dia).map(n => deps.notificar(n).catch(() => null)))
    resultados.push(`${r.fila.id_crm} (${r.faltan.length ? `faltan ${r.faltan.length}` : 'check final'}): ${a.estado}`)
  }
  return { dry: false, dia, pendientes: resumen, revisiones: aMedias, resultados }
}
