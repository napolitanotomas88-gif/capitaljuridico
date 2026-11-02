// Recordatorio de guiones editados sin verificar (pedido de RESPONSABLE_HUB, 2/11/2026). Quien corrige un guion y guarda,
// pero no tilda «✓ Verificado» ni da el check final, deja la tanda trabada en a_revisar: el Doc nunca se carga. Una vez por
// día hábil (cron de Vercel) se le avisa a quien editó: mención en el canal de guiones de Discord y la campanita del Despacho.
// Solo tandas en a_revisar con al menos un guion editado hace más de HORAS_GRACIA y sin verificar. Una alerta por tanda y día.
import type { Alerta } from '@/lib/alertas/alerta'
import type { Rol } from '@/lib/alertas/personas'
import type { NuevaNotificacion } from '@/lib/notificaciones/modelo'
import type { FilaTanda } from './registro'

export const HORAS_GRACIA = 2

export interface Pendiente { fila: FilaTanda; numeros: number[]; editores: string[]; desde: string }

const mails = (v?: string) => (v ?? '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes('@'))
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** El rol de Discord de quien editó (lo que guarda la pantalla: el nombre de la sesión). null si no es Tomi ni Faus. */
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

const lista = (ns: number[]) => ns.length === 1 ? `el guion ${ns[0]}` : `los guiones ${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`

/** La alerta de Discord (canal guiones) de una tanda, una por día. Puro. */
export function alertaSinVerificar(p: Pendiente, dia: string): Alerta {
  const id = p.fila.id_crm!
  const roles = [...new Set(p.editores.map(rolDeEditor).filter((r): r is Rol => !!r))]
  return {
    canal: 'guiones', tipo: 'guiones_sin_verificar', clave: `guiones_sin_verificar:${p.fila.id}:${dia}`,
    idCrm: id, cliente: p.fila.cliente?.trim() || id, emoji: '⏰',
    titulo: 'Guiones editados sin verificar: la tanda no se publica',
    lineas: [
      `Editaste ${lista(p.numeros)} y quedó sin «✓ Verificado».`,
      'Guardar solo no publica: tildá «✓ Verificado» en cada guion y después dá el check final para que se cargue en el Doc.',
    ],
    link: `/guiones/${encodeURIComponent(id)}`, menciones: roles.length ? roles : ['aprobadores'],
  }
}

/** La campanita del Despacho para quien editó (Tomi o Faus por su mail; si no, la sección guiones). Puro. */
export function notificacionesSinVerificar(p: Pendiente, dia: string, env: Record<string, string | undefined> = process.env): NuevaNotificacion[] {
  const id = p.fila.id_crm!
  const base: NuevaNotificacion = {
    tipo: 'guiones_sin_verificar', titulo: `Guiones sin verificar · ${p.fila.cliente ?? id}`,
    cuerpo: `Editaste ${lista(p.numeros)}: tildá «✓ Verificado» en cada uno y dá el check final. Guardar solo no publica.`,
    url: `/guiones/${encodeURIComponent(id)}`, origen: 'bot-guiones', urgente: true,
  }
  const emails = [...new Set(p.editores.flatMap(e => {
    const r = rolDeEditor(e)
    return r === 'faus' ? mails(env.GUIONES_REVISOR_FAUS) : r === 'tomas' ? mails(env.KICKOFF_REVISOR_TOMI) : []
  }))]
  return emails.length
    ? emails.map(email => ({ ...base, paraEmail: email, clave: `guiones-sin-verificar:${p.fila.id}:${dia}:${email}` }))
    : [{ ...base, paraSeccion: 'guiones', clave: `guiones-sin-verificar:${p.fila.id}:${dia}` }]
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
  const pendientes = pendientesSinVerificar(await deps.leer(), ahora)
  const resumen = pendientes.map(p => ({ id: p.fila.id, idCrm: p.fila.id_crm, guiones: p.numeros, editores: p.editores }))
  if (op.dry) return { dry: true, dia, pendientes: resumen }
  const resultados: string[] = []
  for (const p of pendientes) {
    const a = await deps.alertar(alertaSinVerificar(p, dia)).catch(e => ({ estado: `error: ${(e as Error)?.name ?? 'error'}` }))
    await Promise.all(notificacionesSinVerificar(p, dia).map(n => deps.notificar(n).catch(() => null)))
    resultados.push(`${p.fila.id_crm}: ${a.estado}`)
  }
  return { dry: false, dia, pendientes: resumen, resultados }
}
