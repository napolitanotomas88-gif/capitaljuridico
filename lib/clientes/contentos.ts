// ── Clientes contentos: a quién conviene pedirle referidos (puro, sin red ni reloj) ─────────────────────────────────
// La presentación pide partir de clientes CONTENTOS, medidos con datos. Acá se mide con lo que el CRM Clientes ya tiene por cliente:
// semáforo, promesa cumplida, testimonio y SATISFACCIÓN (1 a 10, columna del Sheet que hoy está sin cargar: se va completando y entra sola).
// Los umbrales son una PROPUESTA de implementación (no están en las reglas fuente): se muestran rotulados así y se cambian acá.
import type { Cliente, Referido } from './tipos'

export const UMBRAL_SATISFACCION_ALTA = 8    // 8 o más suma como "contento"
export const UMBRAL_SATISFACCION_BAJA = 6    // 6 o menos = no pedir todavía

export type SenalContento = 'alta' | 'media' | 'por_medir' | 'no_pedir'
export const ETIQUETA_SENAL: Record<SenalContento, string> = {
  alta: 'Contento: pedir ya',
  media: 'Buena señal',
  por_medir: 'Falta medir',
  no_pedir: 'No pedir todavía',
}
const ORDEN: Record<SenalContento, number> = { alta: 0, media: 1, por_medir: 2, no_pedir: 3 }

export interface FilaContento {
  id: string
  nombre: string
  senal: SenalContento
  semaforo: string                // 'verde' | 'amarillo' | 'rojo' | ''
  promesa: string                 // 'Sí' | 'Parcial' | 'No' | ''
  testimonio: boolean
  satisfaccion: number | null     // 1-10; null = sin cargar
  diasParaVencer: number | null
  referidosPresentados: number
  motivos: string[]
}

export interface MedicionContentos {
  activos: number
  conSatisfaccion: number
  promedioSatisfaccion: number | null
  verdes: number
  promesaSi: number
  conTestimonio: number
  porSenal: Record<SenalContento, number>
}

type ClienteMin = Pick<Cliente, 'id' | 'nombre' | 'estado' | 'cuentaEnMetricas' | 'semaforo' | 'promesa' | 'testimonio' | 'satisfaccion' | 'diasParaVencer'>

export function senalDe(c: Pick<ClienteMin, 'semaforo' | 'promesa' | 'testimonio' | 'satisfaccion'>): { senal: SenalContento; motivos: string[] } {
  const motivos: string[] = []
  const sat = c.satisfaccion
  const tieneTestimonio = !!c.testimonio?.trim()
  if (c.semaforo === 'rojo') return { senal: 'no_pedir', motivos: ['Semáforo rojo'] }
  if (sat !== null && sat <= UMBRAL_SATISFACCION_BAJA) return { senal: 'no_pedir', motivos: [`Satisfacción ${sat} de 10`] }
  if (c.semaforo === 'verde') motivos.push('Semáforo verde')
  if (c.promesa === 'Sí') motivos.push('Promesa cumplida')
  if (tieneTestimonio) motivos.push('Dio testimonio')
  if (sat !== null && sat >= UMBRAL_SATISFACCION_ALTA) motivos.push(`Satisfacción ${sat} de 10`)
  const satAlta = sat !== null && sat >= UMBRAL_SATISFACCION_ALTA
  if (c.semaforo === 'verde' && (satAlta || (c.promesa === 'Sí' && tieneTestimonio))) return { senal: 'alta', motivos }
  if (c.semaforo === 'verde' && (c.promesa === 'Sí' || tieneTestimonio)) return { senal: 'media', motivos }
  return { senal: 'por_medir', motivos: motivos.length ? motivos : ['Sin señales cargadas'] }
}

export function armarContentos(e: { clientes: ClienteMin[]; referidos: Pick<Referido, 'idReferidor'>[] }): { filas: FilaContento[]; medicion: MedicionContentos } {
  const presentados = new Map<string, number>()
  for (const r of e.referidos) if (r.idReferidor) presentados.set(r.idReferidor, (presentados.get(r.idReferidor) ?? 0) + 1)
  const activos = e.clientes.filter(c => c.estado === 'ACTIVO' && c.cuentaEnMetricas && c.id)
  const filas = activos.map<FilaContento>(c => {
    const { senal, motivos } = senalDe(c)
    return {
      id: c.id, nombre: c.nombre, senal, semaforo: c.semaforo ?? '', promesa: c.promesa, testimonio: !!c.testimonio?.trim(),
      satisfaccion: c.satisfaccion, diasParaVencer: c.diasParaVencer, referidosPresentados: presentados.get(c.id) ?? 0, motivos,
    }
  }).sort((a, b) => ORDEN[a.senal] - ORDEN[b.senal] || (b.satisfaccion ?? 0) - (a.satisfaccion ?? 0) || a.nombre.localeCompare(b.nombre, 'es'))
  const conSat = filas.filter(f => f.satisfaccion !== null)
  const porSenal: Record<SenalContento, number> = { alta: 0, media: 0, por_medir: 0, no_pedir: 0 }
  for (const f of filas) porSenal[f.senal]++
  return {
    filas,
    medicion: {
      activos: filas.length,
      conSatisfaccion: conSat.length,
      promedioSatisfaccion: conSat.length ? Math.round((conSat.reduce((s, f) => s + (f.satisfaccion ?? 0), 0) / conSat.length) * 10) / 10 : null,
      verdes: filas.filter(f => f.semaforo === 'verde').length,
      promesaSi: filas.filter(f => f.promesa === 'Sí').length,
      conTestimonio: filas.filter(f => f.testimonio).length,
      porSenal,
    },
  }
}
