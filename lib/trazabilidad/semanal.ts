// ── Reporte semanal de setting (domingo a sábado, se presenta el lunes) ──────────────────────────
// Dos fuentes: los EOD de la setter (pestañas EOD del CRM de Ventas, recalculados SIEMPRE con la lógica actual de
// eodSetter: los snapshots congelados antes del 20/10 contaban como outbound los recursos enviados) y los envíos de la
// botonera de la semana (de dónde vinieron, ciclo, gatillo). "congelado" solo informa que ese día ya se mandó a Discord.
// La clase lo usa para el día a día: "¿qué se hizo el miércoles que no se hizo el jueves?". No para cambiar ángulos.
import 'server-only'
import { calcularDesdeFilas, hoyYMD, leerDatos, snapshotCongelado, sumarDias } from '@/lib/eodSetter'
import type { FilaSetting, Origen } from './modelo'

export interface DiaSemana {
  fecha: string
  agendas: number | null
  calendarios: number | null
  outbound: number | null
  recursos: number | null
  agendasHistorias: number | null
  congelado: boolean
}

/** Domingo (YYYY-MM-DD) de la semana de `ymd` */
export function domingoDe(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay()
  return sumarDias(ymd, -d)
}

export async function diasEOD(domingo: string): Promise<{ dias: DiaSemana[]; aviso: string | null }> {
  const hoy = hoyYMD()
  const fechas = Array.from({ length: 7 }, (_, i) => sumarDias(domingo, i))
  try {
    const datos = await leerDatos()
    const dias = fechas.map((fecha): DiaSemana => {
      if (fecha > hoy) return { fecha, agendas: null, calendarios: null, outbound: null, recursos: null, agendasHistorias: null, congelado: false }
      const c = snapshotCongelado(datos.resumen, fecha)
      const e = calcularDesdeFilas(datos, fecha, hoy)
      const sin = !!e.sinRegistros
      return {
        fecha, congelado: !!c,
        agendas: sin ? null : e.agendas.length, calendarios: sin ? null : e.calendarios,
        outbound: e.aperturasHistorias, recursos: e.recursosEnviados ?? null,
        agendasHistorias: sin ? null : e.etiquetaHistorias.length,
      }
    })
    return { dias, aviso: null }
  } catch (err) {
    return { dias: fechas.map((fecha) => ({ fecha, agendas: null, calendarios: null, outbound: null, recursos: null, agendasHistorias: null, congelado: false })), aviso: `No se pudieron leer los EOD: ${(err as Error).message}` }
  }
}

/** Envíos de la botonera cuya agenda (o, si no se sabe, el envío) cae entre `desde` y `hasta` inclusive */
export function enviosDelRango(envios: FilaSetting[], desde: string, hasta: string): FilaSetting[] {
  return envios.filter((e) => {
    const f = e.analisis?.fecha_agenda ?? e.creado.slice(0, 10)
    return f >= desde && f <= hasta
  })
}

export function resumenEnvios(envios: FilaSetting[]) {
  const analizados = envios.filter((e) => e.analisis)
  const origen = new Map<Origen, number>()
  for (const e of analizados) origen.set(e.analisis!.origen, (origen.get(e.analisis!.origen) ?? 0) + 1)
  return { total: envios.length, analizados: analizados.length, origenes: [...origen].sort((a, b) => b[1] - a[1]) }
}
