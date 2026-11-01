// ── Cálculos puros del tablero (sin React ni imports) ──────────────────
// Los usan page.tsx y los componentes. Al no depender de nada se pueden probar con
// node directamente sobre un JSON de /api/raw (node --experimental-strip-types).

// Moneda: 0 → "$0" (nunca "$0.00"); centavos solo para montos chicos (0 < |v| < 10,
// ej. CPL $2.09); el resto redondeado con separador de miles.
export function fmtMoneda(v: number): string {
  if (v === 0 || Object.is(v, -0)) return '$0'
  const signo = v < 0 ? '-' : ''
  const a = Math.abs(v)
  return a < 10 ? `${signo}$${a.toFixed(2)}` : `${signo}$${Math.round(a).toLocaleString('en-US')}`
}

// Gastos del Estado de Resultados completos en el mes m (campo monthlyGastosCompletos).
// false = el mes tiene cash pero le faltan gastos (staff en 0 o anuncios del ER en 0 con
// gasto Meta): NFCF, margen, CAC blended, FECCU:CAC blended y LTGP:CAC no son confiables.
// Si el campo todavía no viene en el JSON se asume completo (no rompe).
export function gastosCompletos(raw: { monthlyGastosCompletos?: (boolean | null)[] } | null | undefined, m: number): boolean {
  return raw?.monthlyGastosCompletos?.[m] !== false
}

// Tasas sobre agendas ocurridas: el denominador descuenta las ocurridas SIN REGISTRO
// (col "¿Se presentó?" vacía): no se sabe si se presentaron, no cuentan ni a favor ni en contra.
export interface CallTasa { occurred: boolean; sinRegistro?: boolean }
export function baseOcurridas(calls: CallTasa[]): { ocurridas: number; sinRegistro: number; base: number } {
  let ocurridas = 0, sinRegistro = 0
  for (const c of calls) {
    if (!c.occurred) continue
    ocurridas++
    if (c.sinRegistro) sinRegistro++
  }
  return { ocurridas, sinRegistro, base: ocurridas - sinRegistro }
}
// Porcentaje con denominador: null (se muestra "—") si no hay denominador
export const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null)

// Llamada del pre-call (col AI "Llamada pre-call", pedido de Tomás del 1/11/2026): de las agendas del período, cuántas
// tuvieron llamada efectiva, no efectiva o nada cargado. Los tres porcentajes son sobre el total y suman 100;
// "efectividad" es efectivas ÷ (efectivas + no efectivas), sin las que no tienen resultado.
export interface CallPrecall { precall?: string }
export function resumenPrecall(calls: CallPrecall[]) {
  let efectivas = 0, noEfectivas = 0
  for (const c of calls) {
    if (c.precall === 'efectiva') efectivas++
    else if (c.precall === 'no efectiva') noEfectivas++
  }
  const total = calls.length
  const sinResultado = total - efectivas - noEfectivas
  return {
    total, efectivas, noEfectivas, sinResultado,
    pctEfectiva: pct(efectivas, total), pctNoEfectiva: pct(noEfectivas, total), pctSinResultado: pct(sinResultado, total),
    efectividad: pct(efectivas, efectivas + noEfectivas),
  }
}

// ── WhatsApp ──
// Normaliza el teléfono del CRM al formato de wa.me (código de país + número, sin '+'):
// - 10 dígitos (AR sin código de país, ej. "11-2387-7976") → 549 + número
// - 54 + 10 dígitos sin el 9 de celular → se inserta el 9
// - otro país con código (598…, 57…, 51…): 11 a 15 dígitos, tal cual
// - cualquier otra cosa → null (teléfono inválido: sin link)
export function telefonoWhatsApp(tel: string | null | undefined): string | null {
  let d = (tel ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)                       // prefijo internacional 00
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)     // "011 …" → sin el 0 de larga distancia
  if (d.length === 10) return '549' + d
  if (d.startsWith('54')) {
    if (d.length === 13 && d[2] === '9') return d
    if (d.length === 12) return '549' + d.slice(2)
    return null
  }
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

// Nombre de pila para el saludo: salta títulos (Dr/Dra/Lic) y no saluda a "Estudio", "Clínica", etc.
// Nombre compuesto: si arranca con María/Maria/Juan/José/Jose y hay al menos 3 palabras
// ("Juan Pablo Galvan", "María Eugenia Morales") se usan las dos primeras; con 2 palabras
// ("Juan Pérez") la segunda es el apellido. Conectores ("María de los Ángeles") → solo la primera.
const NO_ES_NOMBRE = /^(estudio|cl[ií]nica|consultorio|centro|instituto|grupo|abogad|inmobiliaria|odontolog|dental)/i
const COMPUESTO = /^(mar[ií]a|juan|jos[eé])$/i
const CONECTOR = /^(de|del|la|las|los|y|e)$/i
const capitalizar = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
export function nombreDePila(nombre: string | null | undefined): string | null {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean).map(p => p.replace(/[.,;:()]+$/g, ''))
  while (palabras.length && /^(dr|dra|lic|ing|arq)\.?$/i.test(palabras[0])) palabras.shift()
  const p = palabras[0]
  if (!p || p.length < 2 || NO_ES_NOMBRE.test(p)) return null
  const seg = palabras[1]
  if (COMPUESTO.test(p) && palabras.length >= 3 && seg && seg.length >= 2 && !CONECTOR.test(seg) && /^[a-záéíóúüñ]+$/i.test(seg)) {
    return `${capitalizar(p)} ${capitalizar(seg)}`
  }
  return capitalizar(p)
}

// ── Origen de cierres FECCU ──
// Un "cierre" es el PRIMER pago FECCU del cliente en el año: el 2do pago de un PIF partido
// o el PIF que sigue a un fee del mes anterior no vuelven a contar. Mismo cliente = mismo
// teléfono (últimos 7 dígitos) o mismo nombre normalizado (minúsculas, sin acentos ni puntuación).
export interface TxFeccu { category: string; date: string; client: string; phone: string }
const normNombre = (s: string) => (s ?? '').toString().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tel7 = (s: string) => {
  const part = (s ?? '').toString().split('/').map(x => x.replace(/\D/g, '')).find(x => x.length >= 7)
  return part ? part.slice(-7) : ''
}
export function primerosPagosFeccu<T extends TxFeccu>(txs: T[]): Set<T> {
  const primeros = new Set<T>()
  const idPorNombre = new Map<string, number>()
  const idPorTel = new Map<string, number>()
  let seq = 0
  // Orden cronológico estable (a igual fecha, el orden del Registro)
  const feccu = txs.map((t, i) => ({ t, i })).filter(x => x.t.category === 'FECCU')
    .sort((a, b) => a.t.date.slice(0, 10).localeCompare(b.t.date.slice(0, 10)) || a.i - b.i)
  for (const { t } of feccu) {
    const nom = normNombre(t.client)
    const tel = tel7(t.phone)
    const conNombre = nom.length >= 5
    let id = (conNombre ? idPorNombre.get(nom) : undefined) ?? (tel ? idPorTel.get(tel) : undefined)
    if (id == null) {
      id = seq++
      primeros.add(t)
    }
    if (conNombre && !idPorNombre.has(nom)) idPorNombre.set(nom, id)
    if (tel && !idPorTel.has(tel)) idPorTel.set(tel, id)
  }
  return primeros
}

// ── Grabaciones ──
// Fila inactiva (nota tipo "no mandar", "no grabar", "pausa", "baja"): fuera del ranking de
// urgencia. La marca viene del server (campo inactiva); si todavía no llega, se deduce de la nota.
const NOTA_INACTIVA = /no\s+mandar|no\s+grabar|pausa|\bbaja\b/i
export function esGrabacionInactiva(g: { inactiva?: boolean; nota: string | null }): boolean {
  if (typeof g.inactiva === 'boolean') return g.inactiva
  return NOTA_INACTIVA.test(g.nota ?? '')
}
