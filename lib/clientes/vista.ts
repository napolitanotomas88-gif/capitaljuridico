// ── Vista del CRM para las pantallas y la API (solo servidor) ──────────────────────────────
// Un punto de entrada: lee el CRM (leer.ts: snapshot de 10 min, un solo batchGet por carga en frío y,
// ante un 429 o un error, el snapshot viejo) y le suma los créditos del programa de referidos ya calculados.
// Con { demo: true } (solo desarrollo) devuelve datos ficticios y NO toca Sheets.
// Dentro de un mismo render, pedirla dos veces no lee dos veces: la memoriza React (cache).
import { cache } from 'react'
import type { DatosClientes, ResumenCredito } from './tipos'
import { hoyArgentina } from './fechas'
import { leerClientes } from './leer'
import { crearDatosDemo, demoPermitido } from './demo'
import { calcularCreditosDeDatos } from './programa'
import { diaAR, horaAR } from './formato'
import { aplicarCobrosFinanzas } from './cobrosFinanzas'

export interface VistaCRM {
  datos: DatosClientes
  creditos: Map<string, ResumenCredito>
  esDemo: boolean
}

export interface EstadoLectura {
  /** 'ok' = datos al día · 'guardados' = Sheets no respondió y se usan los datos guardados */
  tipo: 'ok' | 'guardados'
  /** "15:05" (hora argentina) del último dato leído de la planilla */
  hora: string
  /** "6/10/2026" */
  dia: string
  /** Minutos desde esa lectura */
  haceMin: number
  /** Motivo en palabras simples (nunca el texto crudo del error) */
  motivo: string | null
}

export const cargarVista = cache(async (demo: boolean, cobros: 'cache' | 'fresco' | 'omitir' = 'cache'): Promise<VistaCRM> => {
  if (demo && demoPermitido()) {
    const datos = crearDatosDemo(hoyArgentina())
    return { datos, creditos: calcularCreditosDeDatos(datos), esDemo: true }
  }
  const crm = await leerClientes()
  const datos = cobros === 'omitir' ? crm : await aplicarCobrosFinanzas(crm, { forzar: cobros === 'fresco' })
  return { datos, creditos: calcularCreditosDeDatos(datos), esDemo: false }
})

/** Cómo se leyeron los datos, para avisar en pantalla ("datos del 15:05") sin exponer detalles internos */
export function estadoDeLectura(datos: DatosClientes, ahora = Date.now()): EstadoLectura {
  const guardados = datos.fuente === 'snapshot_viejo'
  // El aviso crudo puede traer el mensaje del error de Google: acá solo se distingue la cuota del resto
  const porCuota = datos.avisos.some(a => /429|limit/i.test(a))
  return {
    tipo: guardados ? 'guardados' : 'ok',
    hora: horaAR(datos.snapshotEn),
    dia: diaAR(datos.snapshotEn),
    haceMin: Math.max(0, Math.round((ahora - datos.snapshotEn) / 60_000)),
    motivo: guardados ? (porCuota ? 'Google limitó las lecturas por un rato' : 'Google no respondió') : null,
  }
}
