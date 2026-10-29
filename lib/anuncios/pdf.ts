// ── Reporte semanal de anuncios en PDF (lunes 8:00 AR, adjunto en Discord) ────────────────────
// pdf-lib puro (sin navegador ni archivos locales): funciona en Vercel. Tipografías del manual de
// marca (Bodoni Moda para títulos y cifras, Archivo para texto) bajadas de jsDelivr/fontsource y
// guardadas en memoria. Página A4 con fondo TINTA, texto HUESO, filetes finos, sin degradados.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { Tablero, FilaAnuncio } from './tablero'
import type { Recuento } from './recuento'
import { dm, fmtGasto, fmtMonto, fmtPct, sumarDias } from './formato'
import { nombreDia } from './feriados'

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const C = {
  tinta: hex('#0A0C0B'), sala: hex('#14312A'), borgona: hex('#6E2530'), laton: hex('#B08D4F'),
  hueso: hex('#EFE9DC'), humo: hex('#8B918B'), filete: hex('#2A2C2A'), azul: hex('#5B7FA6'),
}
const COLOR_ESTADO = { sin_gasto: C.humo, error: C.hueso, rojo: C.borgona, amarillo: C.laton, verde: C.sala }
const NOMBRE_ESTADO = { sin_gasto: 'SIN GASTO', error: 'ERROR', rojo: 'ROJO', amarillo: 'AMARILLO', verde: 'VERDE' }

const FUENTES = {
  bodoni: 'https://cdn.jsdelivr.net/fontsource/fonts/bodoni-moda@latest/latin-400-normal.ttf',
  archivo: 'https://cdn.jsdelivr.net/fontsource/fonts/archivo@latest/latin-400-normal.ttf',
  archivoB: 'https://cdn.jsdelivr.net/fontsource/fonts/archivo@latest/latin-600-normal.ttf',
}
const cacheFuentes = new Map<string, ArrayBuffer>()
async function bajarFuente(url: string): Promise<ArrayBuffer> {
  const c = cacheFuentes.get(url)
  if (c) return c
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`No se pudo bajar la tipografía (${r.status})`)
  const b = await r.arrayBuffer()
  cacheFuentes.set(url, b)
  return b
}

// Las fuentes (subset latin) no tienen flechas ni símbolos: se reemplazan
const limpiar = (x: string) => x.replace(/ → /g, ' a ').replace(/→/g, ' a ').replace(/≤/g, 'hasta ').replace(/≈/g, '~').replace(/[↗⚠︎️]/g, '').replace(/[^\u0000-ɏ–—‘’“”•…·]/g, '')

const A4 = { w: 595.28, h: 841.89 }
const M = 44   // margen

export async function generarReportePDF(t: Tablero, mes: Recuento | null, ahora: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [bB, bA, bAB] = await Promise.all([bajarFuente(FUENTES.bodoni), bajarFuente(FUENTES.archivo), bajarFuente(FUENTES.archivoB)])
  const F = { titulo: await doc.embedFont(bB, { subset: true }), texto: await doc.embedFont(bA, { subset: true }), fuerte: await doc.embedFont(bAB, { subset: true }) }
  doc.setTitle('Reporte semanal de anuncios — Capital Jurídico')
  doc.setAuthor('Capital Jurídico')

  let page: PDFPage = null as unknown as PDFPage
  let y = 0
  const nuevaPagina = () => {
    page = doc.addPage([A4.w, A4.h])
    page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: C.tinta })
    y = A4.h - M
  }
  const espacio = (alto: number) => { if (y - alto < M + 20) nuevaPagina() }
  const ancho = A4.w - 2 * M

  const texto = (s: string, x: number, size: number, opts: { font?: PDFFont; color?: ReturnType<typeof rgb>; maxW?: number; tracking?: number } = {}) => {
    const font = opts.font ?? F.texto
    let str = limpiar(s)
    if (opts.maxW) while (str.length > 1 && font.widthOfTextAtSize(str, size) > opts.maxW) str = str.slice(0, -2) + '…'
    if (!opts.tracking) { page.drawText(str, { x, y, size, font, color: opts.color ?? C.hueso }); return }
    // pdf-lib no tiene espaciado entre letras: se dibuja letra por letra (etiquetas en mayúscula)
    let cx = x
    for (const ch of str) { page.drawText(ch, { x: cx, y, size, font, color: opts.color ?? C.hueso }); cx += font.widthOfTextAtSize(ch, size) + opts.tracking }
  }
  // Párrafo con corte de línea
  const parrafo = (s: string, size = 9.5, opts: { color?: ReturnType<typeof rgb>; x?: number; w?: number; font?: PDFFont; interlinea?: number } = {}) => {
    const font = opts.font ?? F.texto, x = opts.x ?? M, w = opts.w ?? ancho, lh = size * (opts.interlinea ?? 1.4)
    const palabras = limpiar(s).split(' ')
    let linea = ''
    for (const p of palabras) {
      const prueba = linea ? `${linea} ${p}` : p
      if (font.widthOfTextAtSize(prueba, size) > w && linea) { espacio(lh); page.drawText(linea, { x, y, size, font, color: opts.color ?? C.hueso }); y -= lh; linea = p }
      else linea = prueba
    }
    if (linea) { espacio(lh); page.drawText(linea, { x, y, size, font, color: opts.color ?? C.hueso }); y -= lh }
  }
  const etiqueta = (s: string, color = C.laton) => { espacio(30); y -= 8; texto(s.toUpperCase(), M, 7.5, { font: F.fuerte, color, tracking: 1.4 }); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: M + ancho, y }, thickness: 0.5, color: C.filete }); y -= 14 }
  const viñeta = (s: string, color = C.hueso) => parrafo(`•  ${s}`, 9, { color })

  const usd = (f: FilaAnuncio, v: number | null) => (v == null ? '—' : f.usdPor ? fmtMonto(v / f.usdPor, 'USD') : fmtMonto(v, f.moneda))
  const usdG = (f: FilaAnuncio, v: number) => (f.usdPor ? fmtGasto(v / f.usdPor, 'USD') : fmtGasto(v, f.moneda))
  const desde = sumarDias(t.hoy, -7), hasta = sumarDias(t.hoy, -1)
  const r = t.resumen

  // ── Portada / encabezado ──
  nuevaPagina()
  texto('SKYWARD CONSULTORÍA JURÍDICA · PAUTA DE CLIENTES', M, 7.5, { font: F.fuerte, color: C.laton, tracking: 1.6 })
  y -= 40
  texto('Reporte semanal de anuncios', M, 30, { font: F.titulo })
  y -= 20
  const fecha = ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
  parrafo(`Semana del ${dm(desde)} al ${dm(hasta)} · generado el ${fecha} · ${r.total} cuentas de clientes · montos en USD (pesos al dólar MEP venta)`, 8.5, { color: C.humo })
  y += 4
  page.drawLine({ start: { x: M, y }, end: { x: M + 40, y }, thickness: 0.8, color: C.laton })
  y -= 46

  // Cifras grandes
  const cifras: [string, number, ReturnType<typeof rgb>][] = [['sin gasto', r.sinGasto, C.humo], ['con error', r.errores, C.hueso], ['en rojo', r.rojos, C.borgona], ['en amarillo', r.amarillos, C.laton], ['en verde', r.verdes, C.sala]]
  const colW = ancho / cifras.length
  cifras.forEach(([et, n, col], i) => {
    const x = M + i * colW
    page.drawRectangle({ x, y: y + 4, width: 6, height: 6, color: col })
    texto(String(n), x + 12, 40, { font: F.titulo })
    const yy = y; y -= 16; texto(et.toUpperCase(), x + 12, 7, { font: F.fuerte, color: C.humo, tracking: 1.2 }); y = yy
  })
  y -= 34
  parrafo(`${r.enAumento} con CPL en aumento · ${r.aGrabar} con guiones a grabar · ${r.lanzadas} con campañas nuevas (${r.revisarDia4} para revisar) · ${r.erroresPago} con error de pago · ${r.saldosPorAgotarse} por quedarse sin saldo · ${r.sinGuionesNecesarios} sin guiones que se necesitan`, 9.5, { color: C.humo })
  y -= 6

  // ── Días malos de Meta ──
  etiqueta('Días malos de Meta')
  const malosSemana = t.diasMeta.filter(x => x.malo && x.d >= desde && x.d <= hasta)
  if (malosSemana.length) for (const x of malosSemana) viñeta(`${nombreDia(x.d)} ${dm(x.d)}: subió en el ${Math.round(x.parte * 100)}% de las cuentas (${x.suben} de ${x.cuentas}), suba típica ${fmtPct(x.mediana - 1)}. No cuenta para las alertas.`)
  else viñeta('Ninguno en la semana: las subas fueron de cada cuenta.', C.humo)
  if (mes) viñeta(`En el mes (al ${dm(mes.hasta)}): ${mes.malos} día${mes.malos === 1 ? '' : 's'} malo${mes.malos === 1 ? '' : 's'}${mes.malos ? ` (${mes.dias.filter(x => x.malo).map(x => `${nombreDia(x.d).slice(0, 3)} ${dm(x.d)}`).join(', ')})` : ''}. CPL general del mes ${fmtMonto(mes.totales.cplUSD, 'USD')} · gasto ${fmtGasto(mes.totales.gastoUSD, 'USD')} · ${mes.totales.mensajes.toLocaleString('es-AR')} mensajes.`, C.humo)

  // ── Guiones a grabar ──
  const grabar = t.filas.filter(f => f.aGrabar)
  etiqueta(`Guiones a grabar (${grabar.length})`)
  if (grabar.length) for (const f of grabar) {
    const motivo = f.aGrabar === 'quema' ? f.aumento?.texto ?? '' : f.motivos.find(m => m.tipo === 'no_rinde')?.texto ?? ''
    const g = f.guiones.estado === 'sin_guiones' ? 'NO TIENE guiones' : f.guiones.estado === 'pendiente' ? 'guiones listos, falta grabar' : f.guiones.estado === 'grabado' ? 'guiones ya grabados' : 'guiones en pausa'
    viñeta(`${f.cliente}${f.rama ? ` (${f.rama.nombre})` : ''} — ${motivo} · ${g}`)
  }
  else viñeta('Ninguno esta semana.', C.humo)

  // ── Lanzamientos ──
  const lanz = t.filas.flatMap(f => f.lanzamientos.filter(l => !l.etapa && l.dia <= 7).map(l => ({ f, l })))
  etiqueta(`Lanzamientos de la semana (${lanz.length})`, C.azul)
  if (lanz.length) for (const { f, l } of lanz) {
    const tope = f.rama?.umbral.ok ?? 2.8
    viñeta(`${f.cliente} — ${l.campana} · lanzada el ${dm(l.fecha)} (día ${l.dia})${l.gasto != null ? ` · ${usdG(f, l.gasto)} · ${l.mensajes} msj · CPL ${l.cplUSD != null ? fmtMonto(l.cplUSD, 'USD') : 'sin mensajes'} (normal hasta ${fmtMonto(tope, 'USD')})` : ''}${l.dia >= 4 ? '' : ' · revisión el día 4'}`)
  }
  else viñeta('No hubo campañas ni anuncios nuevos.', C.humo)

  // ── Errores de pago ──
  const pagos = t.filas.filter(f => f.semaforo === 'error')
  etiqueta(`Errores de pago (${pagos.length})`, C.hueso)
  if (pagos.length) for (const f of pagos) viñeta(`${f.cliente} — ${f.pago.texto}${f.pago.medio ? ` (${f.pago.medio})` : ''} · ${f.corriendo.frenadaHace == null ? `gastó ${usdG(f, f.gasto.d7)} en 7 días` : `frenada hace ${f.corriendo.frenadaHace} días`}`)
  else viñeta('Ninguno.', C.humo)

  // ── Aumentos semana vs. anterior ──
  const aumentos = t.filas.filter(f => f.cpl.variacion7 != null && f.cpl.variacion7 >= 0.2 && f.mensajes.d7prev >= 5 && f.mensajes.d7 > 0).sort((a, b) => (b.cpl.variacion7 ?? 0) - (a.cpl.variacion7 ?? 0))
  etiqueta(`CPL: semana vs. la anterior, subas de 20% o más (${aumentos.length})`)
  if (aumentos.length) for (const f of aumentos) viñeta(`${f.cliente} — de ${usd(f, f.cpl.d7prev)} a ${usd(f, f.cpl.d7)} (${fmtPct(f.cpl.variacion7)})${f.rama ? ` · normal hasta ${fmtMonto(f.rama.umbral.ok, 'USD')}` : ''}`)
  else viñeta('Ninguna cuenta subió 20% o más.', C.humo)

  // ── Tabla de todas las cuentas ──
  nuevaPagina()
  etiqueta('Todas las cuentas, por prioridad')
  const cols = [{ t: 'ESTADO', w: 62 }, { t: 'CLIENTE', w: 150 }, { t: 'RAMA', w: 96 }, { t: 'CPL 7D', w: 48, der: true }, { t: '7 ANT.', w: 46, der: true }, { t: 'VAR.', w: 38, der: true }, { t: 'GUIONES', w: ancho - 440 }]
  const encabezado = () => {
    let x = M
    for (const c of cols) { texto(c.t, c.der ? x + c.w - F.fuerte.widthOfTextAtSize(c.t, 6.5) - 6 : x, 6.5, { font: F.fuerte, color: C.humo }); x += c.w }
    y -= 5
    page.drawLine({ start: { x: M, y }, end: { x: M + ancho, y }, thickness: 0.5, color: C.filete })
    y -= 13
  }
  encabezado()
  const G = { grabado: 'Grabados', pendiente: 'Falta grabar', sin_guiones: 'Sin guiones', inactivo: 'En pausa' }
  for (const f of t.filas) {
    if (y - 18 < M + 20) { nuevaPagina(); encabezado() }
    const est = f.semaforo as keyof typeof COLOR_ESTADO
    page.drawRectangle({ x: M, y: y - 4, width: 2, height: 12, color: COLOR_ESTADO[est] })
    const celdas = [
      NOMBRE_ESTADO[est] + (f.aumento ? ' +' : ''),
      f.cliente + (f.lanzamientos.length ? ' (nueva)' : ''),
      f.rama?.nombre ?? 'Sin rama',
      f.cpl.d7 == null ? (f.gasto.d7 > 0 ? 'sin msj' : '—') : usd(f, f.cpl.d7).replace('USD ', ''),
      f.cpl.d7prev == null ? '—' : usd(f, f.cpl.d7prev).replace('USD ', ''),
      f.cpl.variacion7 == null ? '—' : fmtPct(f.cpl.variacion7),
      G[f.guiones.estado],
    ]
    let x = M
    celdas.forEach((c, i) => {
      const col = cols[i], size = 8
      const font = i === 1 ? F.fuerte : F.texto
      const color = i === 0 ? (est === 'verde' ? C.humo : COLOR_ESTADO[est] === C.borgona ? hex('#B4505E') : COLOR_ESTADO[est]) : i === 6 && f.guiones.estado === 'sin_guiones' ? C.laton : i >= 2 && i !== 3 ? C.humo : C.hueso
      const s = limpiar(c)
      if (col.der) texto(s, x + col.w - font.widthOfTextAtSize(s, size) - 6, size, { font, color })
      else texto(s, i === 0 ? x + 6 : x, size, { font, color, maxW: col.w - 6 })
      x += col.w
    })
    y -= 6
    page.drawLine({ start: { x: M, y }, end: { x: M + ancho, y }, thickness: 0.3, color: C.filete })
    y -= 10
  }
  y -= 6
  parrafo('ESTADO: sin gasto = fuera del semáforo · error = problema de pago (resolver primero) · rojo / amarillo / verde según el CPL de ayer contra el rango normal de su rama · "+" = CPL en aumento (3 o más días hábiles seguidos más caro) · "(nueva)" = campaña con anuncios nuevos en los últimos 10 días.', 7.5, { color: C.humo })

  // Pie con número de página
  const paginas = doc.getPages()
  paginas.forEach((p, i) => {
    p.drawText(limpiar(`Capital Jurídico · Reporte semanal de anuncios · ${i + 1} de ${paginas.length}`), { x: M, y: 24, size: 7, font: F.texto, color: C.humo })
  })
  return doc.save()
}
