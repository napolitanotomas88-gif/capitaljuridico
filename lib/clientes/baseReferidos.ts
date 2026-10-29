// ── Base de referidos: una ficha por persona que viene recomendada (puro, sin red ni reloj) ────────────────────────
// Junta, para tenerlo a mano: quién la presentó, en qué paso del programa está, si su llamada cuenta como INTENTO (y qué premio le da a quien
// refiere), qué beneficios tiene ELLA y el cliente nuevo que quedó si cerró. Todo sale de las filas de la pestaña Referidos del CRM Clientes y de
// los créditos ya calculados: no inventa nada ni escribe nada. Los beneficios del referido valen SOLO si se suma en la llamada; ese dato no
// existe en la planilla (duda cerro_en_llamada), así que se muestran como condición que confirma el closer, nunca como verificados.
import type { Cliente, Referido, ResumenCredito, Ymd } from './tipos'
import { REGLAS_REFERIDOS, type ReglasReferidos } from './reglasReferidos'
import { esAnteriorAlPrograma, premioDelIntento } from './creditos'
import { pasoDelPrograma, type PasoReferido } from './programa'

export type CategoriaBase = 'en_curso' | 'intento' | 'cerro' | 'sin_llamada'
export const CATEGORIAS_BASE: { clave: CategoriaBase; titulo: string }[] = [
  { clave: 'en_curso', titulo: 'En curso' },
  { clave: 'intento', titulo: 'Intentos' },
  { clave: 'cerro', titulo: 'Cerraron' },
  { clave: 'sin_llamada', titulo: 'No asistieron o descartados' },
]

export type TonoBeneficio = 'espera' | 'aplica' | 'perdido' | 'ninguno' | 'previo'

export interface FilaBase {
  id: string
  nombre: string
  estudio: string
  momento: string
  fechaPedido: Ymd | null
  fechaLlamada: Ymd | null
  estado: Referido['estado']
  categoria: CategoriaBase
  paso: PasoReferido
  idReferidor: string
  nombreReferidor: string
  referidorEnCrm: boolean
  /** Solo si el referido entró a la llamada y no cerró: el N.º de intento de quien refiere y lo que ese intento le da */
  intento: { numero: number; premio: string; cuenta: boolean } | null
  beneficio: { tono: TonoBeneficio; texto: string }
  idClienteNuevo: string
  nombreClienteNuevo: string
  fechaPrimerPago: Ymd | null   // para "Actualizar referido" (27/10/2026)
  reembolso: boolean
}

const categoriaDe = (r: Referido, reglas: ReglasReferidos): CategoriaBase => {
  if (r.estado === 'Cerró') return 'cerro'
  if (r.estado === reglas.intentos.estado) return 'intento'
  if (r.estado === 'Presentado' || r.estado === 'Asistió') return 'en_curso'
  return 'sin_llamada'
}

/** Fecha con la que el intento entra en el contador (la de la llamada; si falta, la del pedido), igual que el cálculo de créditos */
const fechaDeIntento = (r: Referido): string => r.fechaLlamada ?? r.fechaPedido ?? ''

export function textoBeneficiosReferido(reglas: ReglasReferidos = REGLAS_REFERIDOS): string {
  const { descuentoUSD, mesesServicioExtra } = reglas.referido
  return `USD ${descuentoUSD} de descuento + ${mesesServicioExtra} ${mesesServicioExtra === 1 ? 'mes' : 'meses'} más de servicio`
}

function beneficioDe(cat: CategoriaBase, previo: boolean, reglas: ReglasReferidos): FilaBase['beneficio'] {
  if (previo) return { tono: 'previo', texto: 'Anterior al programa: no genera beneficios.' }
  const b = textoBeneficiosReferido(reglas)
  switch (cat) {
    case 'en_curso': return { tono: 'espera', texto: `${b}, solo si se suma en la llamada.` }
    case 'cerro': return { tono: 'aplica', texto: `${b}: le corresponden (el closer confirma que se sumó en la llamada).` }
    case 'intento': return { tono: 'perdido', texto: 'Perdió los beneficios: no se sumó en la llamada.' }
    default: return { tono: 'ninguno', texto: 'Sin beneficios: no hubo llamada o quedó descartado.' }
  }
}

export function armarBaseReferidos(
  e: { referidos: Referido[]; clientes: Pick<Cliente, 'id' | 'nombre'>[]; creditos: Map<string, ResumenCredito>; hoy: Ymd },
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
): FilaBase[] {
  const nombres = new Map<string, string>()
  for (const c of e.clientes) if (c.id && !nombres.has(c.id)) nombres.set(c.id, c.nombre)

  // N.º de intento de cada referido: orden de sus intentos por fecha dentro de quien lo presentó (los de antes del programa no cuentan)
  const numero = new Map<Referido, number>()
  const porReferidor = new Map<string, Referido[]>()
  for (const r of e.referidos) {
    if (!r.idReferidor || r.estado !== reglas.intentos.estado || esAnteriorAlPrograma(r, reglas)) continue
    porReferidor.set(r.idReferidor, [...(porReferidor.get(r.idReferidor) ?? []), r])
  }
  for (const lista of porReferidor.values()) {
    lista.sort((a, b) => fechaDeIntento(a).localeCompare(fechaDeIntento(b)) || a.fila - b.fila).forEach((r, i) => numero.set(r, i + 1))
  }

  const filas = e.referidos.map<FilaBase>(r => {
    const categoria = categoriaDe(r, reglas)
    const previo = esAnteriorAlPrograma(r, reglas)
    const n = numero.get(r)
    const total = e.creditos.get(r.idReferidor)?.intentos ?? 0
    return {
      id: r.id, nombre: r.nombre, estudio: r.estudio, momento: r.momento, fechaPedido: r.fechaPedido, fechaLlamada: r.fechaLlamada,
      estado: r.estado, categoria,
      paso: pasoDelPrograma(r, e.hoy, reglas, e.creditos.get(r.idReferidor)?.cicloDesde ?? null),
      idReferidor: r.idReferidor, nombreReferidor: nombres.get(r.idReferidor) ?? r.idReferidor, referidorEnCrm: nombres.has(r.idReferidor),
      // Si el cálculo de créditos no llegó a contarlo (por ejemplo, ya era un contacto del CRM) se avisa en vez de prometer un premio
      intento: n === undefined ? null : { numero: n, premio: premioDelIntento(n, reglas).etiqueta, cuenta: n <= total },
      beneficio: beneficioDe(categoria, previo, reglas),
      idClienteNuevo: r.idClienteNuevo, nombreClienteNuevo: nombres.get(r.idClienteNuevo) ?? '',
      fechaPrimerPago: r.fechaPrimerPago, reembolso: r.reembolso,
    }
  })
  // Lo más reciente primero (llamada, o el pedido si todavía no hubo llamada)
  return filas.sort((a, b) => (b.fechaLlamada ?? b.fechaPedido ?? '').localeCompare(a.fechaLlamada ?? a.fechaPedido ?? '') || b.id.localeCompare(a.id))
}

export function contarPorCategoria(filas: FilaBase[]): Record<CategoriaBase, number> {
  const c: Record<CategoriaBase, number> = { en_curso: 0, intento: 0, cerro: 0, sin_llamada: 0 }
  for (const f of filas) c[f.categoria]++
  return c
}

export const esCategoriaBase = (v: unknown): v is CategoriaBase => typeof v === 'string' && CATEGORIAS_BASE.some(c => c.clave === v)
