// ── Cargar un pago en Finanzas y que lo tome el bot de altas (Tomás, 5/11/2026) ──────────────────────────────────────────
// «Que el equipo cargue los pagos en Finanzas y de ahí el bot sepa que la persona ya está de alta». En Finanzas → Pagos, el
// modo «Con el bot» arma con los campos del formulario el mismo #ALTA que se pega en «Cargar alta» y lo manda a
// /api/clientes/altas. Desde ahí todo es el flujo de siempre: el bot decide si es un alta nueva, una seña (Fee) o la cuota de
// un cliente que ya está, carga el pago en la planilla y en la app (con las reglas de la col O y PIF tras Fee), y en un alta
// nueva crea el cliente, la carpeta de Drive y lo demás. El pago NO se inserta aparte en la app: lo hace el bot (si no,
// quedaría duplicado). Puro: sin red ni base.

export interface PagoParaBot {
  cliente: string
  telefono: string
  /** Programa de la col B, de la lista ("DFY | PIF | $2600"). */
  programa: string
  /** USD de este pago (vacío si se pagó en pesos y todavía no se sabe). */
  montoUsd: string
  /** Pesos de este pago, si se pagó en pesos. */
  pesos: string
  medio: string
  /** Alta nueva: los datos del cliente que pide el #ALTA. */
  altaNueva: boolean
  correo: string
  dni: string
  cuit: string
  direccion: string
  inicio: string               // aaaa-mm-dd
  /** Una cuota por renglón: "dd/mm/aaaa 1100". */
  cuotas: string
  socios: string
}

export const pagoParaBotVacio = (): PagoParaBot => ({
  cliente: '', telefono: '', programa: '', montoUsd: '', pesos: '', medio: '', altaNueva: false,
  correo: '', dni: '', cuit: '', direccion: '', inicio: '', cuotas: '', socios: '',
})

const t = (s: string | null | undefined) => (s ?? '').trim()
const dmy = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.split('-').reverse().join('/') : ymd)

/** "DFY | PIF | $2600" → { programa: "DFY", tipo: "PIF", total: 2600 }. null si no tiene esa forma (p. ej. "Fee"). */
export function partesPrograma(programa: string): { programa: string; tipo: 'PIF' | 'PP'; total: number } | null {
  const m = t(programa).match(/^(.+?)\s*\|\s*(PIF|PP)\s*\|\s*\$?\s*([\d.,]+)$/i)
  if (!m) return null
  const total = Number(m[3].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))
  return Number.isFinite(total) && total > 0 ? { programa: m[1].trim(), tipo: m[2].toUpperCase() as 'PIF' | 'PP', total } : null
}

/** Lo que falta para mandarlo al bot (vacío = se puede). Pura. */
export function faltanParaBot(p: PagoParaBot, closer: string, archivos: number): string[] {
  const f: string[] = []
  if (!t(p.cliente)) f.push('Cliente')
  if (t(p.telefono).replace(/\D/g, '').length < 8) f.push('Teléfono (con código de país: así el bot reconoce si ya es cliente)')
  if (!partesPrograma(p.programa)) f.push('Programa (de la lista)')
  if (!t(p.montoUsd) && !t(p.pesos)) f.push('Monto (USD o pesos)')
  if (!t(closer)) f.push('Closer')
  if (archivos < 1) f.push('Comprobante (imagen o PDF)')
  if (p.altaNueva) {
    if (!t(p.correo)) f.push('Correo')
    if (!t(p.inicio)) f.push('Fecha de inicio del servicio')
    if (partesPrograma(p.programa)?.tipo === 'PP' && !t(p.cuotas)) f.push('Cuotas (fecha y monto, una por renglón)')
  }
  return f
}

/** El #ALTA que entiende el bot (lib/bot/alta/parsear.ts), con los datos del formulario de Finanzas. Pura. */
export function textoAltaDesdePago(p: PagoParaBot, closer: string): string {
  const pr = partesPrograma(p.programa)
  const pago = [t(p.montoUsd) ? `${t(p.montoUsd)} USD` : '', t(p.pesos) ? `${t(p.pesos)} ARS` : ''].filter(Boolean).join(' + ')
  const lineas = [
    '#ALTA',
    `Closer: ${t(closer)}`,
    ...(pr ? [`Programa: ${pr.programa}`, `Tipo de pago: ${pr.tipo} ${pr.total} USD`] : []),
    `Este pago: ${pago}${t(p.medio) ? ` · ${t(p.medio)}` : ''}`,
    `Nombre completo: ${t(p.cliente)}`,
    `Teléfono: ${t(p.telefono)}`,
  ]
  if (p.altaNueva) {
    if (t(p.socios)) lineas.push(`Socios: ${t(p.socios)}`)
    if (t(p.correo)) lineas.push(`Correo: ${t(p.correo)}`)
    if (t(p.direccion)) lineas.push(`Dirección: ${t(p.direccion)}`)
    if (t(p.dni)) lineas.push(`DNI: ${t(p.dni)}`)
    if (t(p.cuit)) lineas.push(`CUIT: ${t(p.cuit)}`)
    if (t(p.inicio)) lineas.push(`Fecha de inicio del servicio: ${dmy(t(p.inicio))}`)
    const cuotas = t(p.cuotas).split('\n').map((x) => x.trim()).filter(Boolean)
    if (cuotas.length) lineas.push('Cuotas:', ...cuotas)
  }
  return lineas.join('\n')
}

/** Los closers que acepta «Cargar alta» (copia de CLOSERS_DESPACHO de lib/bot/alta/despacho/evento.ts, que no se puede
 *  importar del lado del navegador porque usa node:crypto; la prueba verifica que sigan iguales). */
export const CLOSERS_BOT = ['Carlos', 'Marcos', 'Yami', 'Nahuel', 'Brenda'] as const
