// Formatos SOLO de presentación para las pantallas de Finanzas (auditoría de UX, 1/11/2026). No se usan en cálculos ni en
// lo que se guarda en la base: los valores siguen siendo los mismos, cambia solo cómo se leen.
// - Montos en dólares con «US$» (en Argentina «$» se lee como pesos).
// - Fechas DD/MM/AAAA y meses con nombre («Noviembre 2026»), como en el Resumen.
// - Cantidades con el plural correcto («1 pago», «3 pagos»), sin «pago(s)».

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// 'AAAA-MM-DD' (o con hora) → 'DD/MM/AAAA'. Si no tiene esa forma, se muestra tal cual.
export function fechaCorta(f) {
  if (typeof f !== 'string') return f ?? ''
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f
}

// 'AAAA-MM' (o 'AAAA-MM-DD') → 'Noviembre 2026'. Si no tiene esa forma, se muestra tal cual.
export function mesLargo(m) {
  if (typeof m !== 'string') return m ?? ''
  const r = m.match(/^(\d{4})-(\d{2})/)
  const i = r ? Number(r[2]) - 1 : -1
  return i >= 0 && i < 12 ? `${MESES[i]} ${r[1]}` : m
}

// Monto en dólares (con espacio duro: «US$» no queda solo al final del renglón): 'US$ 1.300' / '−US$ 1.300,50'. decimales: 'auto' (hasta 2) o 2 fijos.
export function dolares(n, decimales = 'auto') {
  const v = Number(n || 0)
  const opciones = decimales === 2 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }
  return (v < 0 ? '−US$\u00a0' : 'US$\u00a0') + Math.abs(v).toLocaleString('es-AR', opciones)
}

// Cantidad con su palabra: cant(1, 'pago') → '1 pago'; cant(3, 'pago') → '3 pagos'; cant(2, 'campo pendiente', 'campos pendientes').
export function cant(n, singular, plural = singular + 's') {
  return `${n} ${Number(n) === 1 ? singular : plural}`
}
