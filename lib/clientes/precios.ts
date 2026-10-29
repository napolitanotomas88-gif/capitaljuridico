// ── Tabla de precios del programa inicial (para precargar el período 0 en las altas) ──────
// BORRADOR SIN VERIFICAR (6/10/2026). No existe una pestaña de precios en el CRM: estos valores salen de
//  · Renovaciones (períodos 0 de los clientes cargados hasta hoy): 2.600 es el precio más usado y el que el
//    equipo anota como "precio ASUMIDO $2.600" cuando no sabe cuál era; 3.300 aparece en las altas de septiembre;
//  · negocio/Oferta y precios.md de la bóveda (fuente secundaria): desde el 17/6/2026 la tarifa estándar es
//    USD 3.800 y la de pago completo USD 3.300.
// Para cambiar un precio se edita acá; el alta siempre deja avisado de dónde salió el precio usado.
import { sumarDias, sumarMeses } from './fechas'
import type { Ymd } from './fechas'

export interface ProductoPrecio {
  etiqueta: string
  precioUSD: number
  meses: number            // duración del programa; 4 = el programa estándar, que dura DIAS_PROGRAMA (120 días corridos de contrato)
  asumido: boolean         // true = el equipo lo carga como "precio ASUMIDO" y hay que confirmarlo con el cliente
  nota: string
}

export interface TablaPrecios {
  version: string
  verificada: boolean
  fuente: string
  porDefecto: string
  productos: Record<string, ProductoPrecio>
}

export const TABLA_PRECIOS: TablaPrecios = {
  version: 'borrador-2026-10-06',
  verificada: false,
  fuente: 'Renovaciones (períodos 0 cargados) y negocio/Oferta y precios.md; sin verificar con el equipo',
  porDefecto: 'inicial_2600',
  productos: {
    inicial_2600: { etiqueta: 'Programa inicial USD 2.600 (el más usado en las altas)', precioUSD: 2600, meses: 4, asumido: true, nota: 'precio ASUMIDO $2.600' },
    inicial_3300: { etiqueta: 'Programa inicial USD 3.300 (pago completo desde el 17/6)', precioUSD: 3300, meses: 4, asumido: false, nota: '' },
    inicial_3800: { etiqueta: 'Programa inicial USD 3.800 (tarifa estándar desde el 17/6; todavía sin usos en el CRM)', precioUSD: 3800, meses: 4, asumido: false, nota: '' },
  },
}

// Duración por defecto del programa: la del CONTRATO, 120 días corridos desde el Día 1 (decisión de Tomás, 24/10/2026),
// no 4 meses de calendario. MESES_POR_DEFECTO sigue en 4 porque así se nombra el producto y es el valor que NUNCA se
// escribe en la columna Meses. Igual que la planilla (Renovaciones E, "Meses (vacío = 120 días)"):
//   =IF(ISNUMBER($D),IF(OR($H="",$H=4),$D+120,EDATE($D,$H)),"")  → Meses vacío o 4 = Día 1 + 120; otro número = meses.
export const MESES_POR_DEFECTO = 4
export const DIAS_PROGRAMA = 120

/** Fin del período con la misma regla que la planilla: el programa estándar (4) dura 120 días corridos; otra cantidad de
 *  meses (explícita en la columna Meses) se suma como meses de calendario. */
export const finDelPeriodo = (dia1: Ymd, meses: number = MESES_POR_DEFECTO): Ymd =>
  meses === MESES_POR_DEFECTO ? sumarDias(dia1, DIAS_PROGRAMA) : sumarMeses(dia1, meses)
