// Historial operativo acumulativo. No modifica los hitos del recorrido ni infiere fechas que no estén registradas.
import type { Accion } from './acciones/tipos'
import type { Periodo } from './tipos'
import { diasEntre, esYmdValido, type Ymd } from './fechas'
import { CAMPOS } from './acciones/campos'
import { normTxt } from './texto'

export interface EventoOperativo {
  id: string
  fecha: Ymd | null
  titulo: string
  detalle: string
  fuente: 'Despacho' | 'Renovaciones'
  quien: string | null
  anulada: boolean
  prueba: boolean
  monto: number | null
}
const fecha = (x: unknown): Ymd | null => typeof x === 'string' && esYmdValido(x) ? x : null
const diaRegistro = (x: string | null): Ymd | null => {
  if (!x || !esYmdValido(x.slice(0, 10))) return null
  if (esYmdValido(x)) return x
  const d = new Date(x)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) : null
}
const diaTexto = (x: string) => x.split('-').reverse().join('/')
const momento = (x: string | null) => x && Number.isFinite(Date.parse(x)) ? Date.parse(x) : Number.MAX_SAFE_INTEGER
const dias = (desde: Ymd | null, hasta: Ymd | null) => desde && hasta && diasEntre(desde, hasta) >= 0 ? diasEntre(desde, hasta) : null
const reales = (acciones: readonly Accion[]) => acciones.filter(a => a.modo !== 'sombra' && ['aplicada', 'anulada'].includes(a.estado))
const nombreActor = (a: Accion) => a.quien && !a.quien.includes('@') ? a.quien : null
function extension(a: Accion): { desde: Ymd | null; hasta: Ymd | null } {
  const celdas = a.plan.filter(p => /^renovaciones\b/i.test(p.hoja))
  return { desde: fecha(celdas.find(p => normTxt(p.celda) === 'dia 1')?.despues), hasta: fecha(celdas.find(p => normTxt(p.celda) === 'finalizacion')?.despues) }
}
function motivoConocido(texto: string): string {
  if (/beneficio.*referid|bonific.*referid|referid.*(?:beneficio|bonific|mes\s+(?:extra|adicional|gratis))/i.test(texto)) return 'Beneficio por referido.'
  if (/compensa.*pausa|pausa.*compensa/i.test(texto)) return 'Compensación de pausa.'
  if (/renov/i.test(texto) && /bonific|gratis|sin cargo/i.test(texto)) return 'Bonificación por renovación.'
  return ''
}

/** La pausa que existía al aplicar cada reanudación, teniendo en cuenta también las reversas posteriores. */
function pausasAlRetomar(acciones: readonly Accion[]): Map<string, Ymd | null> {
  const pasos = reales(acciones).flatMap((a, indice) => [
    { a, indice, reversa: false, cuando: momento(a.aplicada ?? a.creada) },
    ...(a.estado === 'anulada' && a.anulada ? [{ a, indice, reversa: true, cuando: momento(a.anulada) }] : []),
  ]).sort((a, b) => a.cuando - b.cuando || Number(a.reversa) - Number(b.reversa) || a.indice - b.indice)
  let abierta: Ymd | null = null
  const anteriores = new Map<string, Ymd | null>(), alRetomar = new Map<string, Ymd | null>()
  for (const p of pasos) {
    if (p.reversa) {
      if (anteriores.has(p.a.id)) abierta = anteriores.get(p.a.id) ?? null
      continue
    }
    anteriores.set(p.a.id, abierta)
    if (p.a.datos.tipo === 'pausa') abierta = fecha(p.a.datos.desde)
    if (p.a.datos.tipo === 'reanudar') {
      alRetomar.set(p.a.id, fecha(p.a.datos.desdePausa) ?? abierta)
      abierta = null
    }
  }
  return alRetomar
}

export function historialOperativo(acciones: readonly Accion[], periodos: readonly Periodo[], conFinanzas: boolean): EventoOperativo[] {
  const aplicadas = reales(acciones), pausas = pausasAlRetomar(aplicadas)
  const eventos: (EventoOperativo & { orden: number })[] = []
  const ids = new Set(aplicadas.map(a => a.id))
  for (const a of aplicadas) {
    const b = a.datos
    if (!conFinanzas && b.tipo === 'pago') continue
    let titulo = '', detalle = '', cuando = diaRegistro(a.aplicada), monto: number | null = null
    const ext = extension(a)
    switch (b.tipo) {
      case 'pausa':
        titulo = 'Servicio pausado'; cuando = fecha(b.desde) ?? cuando
        detalle = fecha(b.desde) ? `En pausa desde el ${diaTexto(b.desde!)}. El tiempo se compensa al retomar.` : 'No hay fecha de inicio de pausa registrada.'
        break
      case 'reanudar': {
        titulo = 'Servicio retomado'; cuando = fecha(b.fecha) ?? cuando
        const inicio = pausas.get(a.id) ?? null, duracion = dias(inicio, fecha(b.fecha)), compensados = dias(ext.desde, ext.hasta)
        detalle = [inicio ? `Pausa desde el ${diaTexto(inicio)}.` : 'Inicio de pausa sin fecha registrada.', duracion !== null ? `Pausa de ${duracion} días.` : '', compensados !== null ? `${compensados} días compensados.` : duracion === 0 ? 'Sin días para compensar.' : 'Sin detalle de compensación registrado.', ext.hasta ? `Fin del servicio: ${diaTexto(ext.hasta)}.` : ''].filter(Boolean).join(' ')
        break
      }
      case 'servicio':
        titulo = 'Servicio ampliado'
        detalle = [b.duracion === '1m' ? 'Se agregó 1 mes de servicio.' : b.duracion === '2s' ? 'Se agregaron 2 semanas de servicio.' : 'Se agregó una extensión personalizada.', motivoConocido(b.motivo ?? ''), ext.hasta ? `Fin del servicio: ${diaTexto(ext.hasta)}.` : ''].filter(Boolean).join(' ')
        break
      case 'renovacion': {
        titulo = 'Renovación registrada'
        detalle = `${b.meses} meses de servicio${fecha(b.inicio) ? ` desde el ${diaTexto(b.inicio)}` : ''}.`
        const r = a.renovacionReferidos
        if (r && r.mesesContratados === b.meses && Number.isInteger(r.mesesReferidos) && r.mesesReferidos >= 0 && r.mesesTotales === r.mesesContratados + r.mesesReferidos && fecha(r.finServicio)) {
          detalle = `${b.meses} meses contratados${fecha(b.inicio) ? ` desde el ${diaTexto(b.inicio)}` : ''}.`
          if (r.mesesReferidos > 0) detalle += ` ${r.mesesReferidos === 1 ? 'Se aplicó automáticamente 1 mes liberado' : `Se aplicaron automáticamente ${r.mesesReferidos} meses liberados`} por referidos. Total: ${r.mesesTotales} meses de servicio.`
          detalle += ` Fin del servicio: ${diaTexto(r.finServicio)}.`
        }
        monto = conFinanzas && Number.isFinite(b.precio) ? b.precio : null
        break
      }
      case 'pago':
        titulo = 'Pago registrado'; cuando = fecha(b.fecha) ?? cuando
        detalle = `${b.concepto} · ${b.cuenta}.`
        monto = conFinanzas && Number.isFinite(b.usd) ? b.usd : null
        break
      case 'proyeccion':
        titulo = b.estado === 'hecha' ? 'Llamada de proyección realizada' : b.estado === 'agendada' ? 'Llamada de proyección agendada' : 'Link de proyección enviado'
        if (b.estado === 'hecha') cuando = fecha(b.fecha) ?? cuando
        detalle = fecha(b.fecha) ? `Fecha de la llamada: ${diaTexto(b.fecha!)}.` : ''
        break
      case 'archivar': titulo = 'Cliente archivado'; detalle = 'Se conservan sus documentos, pagos e historial.'; break
      case 'restaurar': titulo = 'Cliente restaurado'; detalle = 'El cliente volvió al despacho operativo.'; break
      case 'datos': {
        const campos = b.cambios.filter(c => conFinanzas || !CAMPOS[c.campo]?.soloFinanzas).map(c => CAMPOS[c.campo]?.etiqueta).filter(Boolean)
        if (!campos.length) continue
        titulo = 'Datos del cliente actualizados'; detalle = campos.join(', ')
        break
      }
    }
    if (!titulo) continue
    eventos.push({ id: a.id, fecha: cuando, titulo, detalle, fuente: 'Despacho', quien: nombreActor(a), anulada: a.estado === 'anulada', prueba: a.modo === 'prueba', monto, orden: momento(a.aplicada) })
    if (a.estado === 'anulada') eventos.push({ id: `${a.id}:reversa`, fecha: diaRegistro(a.anulada), titulo: `Se deshizo: ${titulo.toLowerCase()}`, detalle: 'La acción original permanece en el historial y ya no está vigente.', fuente: 'Despacho', quien: null, anulada: false, prueba: a.modo === 'prueba', monto: null, orden: momento(a.anulada) })
  }
  for (const p of periodos) {
    // La acción ya contiene la fecha y su posible reversa: no repetir la misma extensión como si fueran dos movimientos.
    const accion = p.notas.match(/acci[oó]n\s+(ac_[a-z0-9]+)/i)?.[1]
    if (accion && ids.has(accion)) continue
    const inicio = fecha(p.dia1), fin = fecha(p.fin), esExtension = p.esExtension || p.precio === 0 && p.periodo > 0
    eventos.push({ id: `periodo:${p.fila}:${p.periodo}`, fecha: inicio, titulo: p.periodo === 0 ? 'Inicio del servicio' : esExtension ? 'Extensión de servicio' : 'Renovación de servicio', detalle: [inicio && fin ? `Servicio del ${diaTexto(inicio)} al ${diaTexto(fin)}.` : fin ? `Fin del período: ${diaTexto(fin)}.` : 'No hay fechas del período registradas.', p.periodo > 0 ? motivoConocido(p.notas) : ''].filter(Boolean).join(' '), fuente: 'Renovaciones', quien: null, anulada: false, prueba: false, monto: conFinanzas && Number.isFinite(p.precio) ? p.precio : null, orden: inicio ? Date.parse(`${inicio}T12:00:00Z`) : Number.MAX_SAFE_INTEGER })
  }
  return eventos.sort((a, b) => (a.fecha ?? '9999-99-99').localeCompare(b.fecha ?? '9999-99-99') || a.orden - b.orden || a.id.localeCompare(b.id)).map(({ orden: _orden, ...evento }) => { void _orden; return evento })
}

export function inicioPausaVigente(acciones: readonly Accion[]): Ymd | null {
  const ultima = reales(acciones).filter(a => a.estado === 'aplicada' && ['pausa', 'reanudar'].includes(a.tipo)).sort((a, b) => momento(b.aplicada ?? b.creada) - momento(a.aplicada ?? a.creada))[0]
  return ultima?.datos.tipo === 'pausa' ? fecha(ultima.datos.desde) : null
}
