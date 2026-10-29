// ── Números y modos de Grabación y Edición (puro: sin imports de servidor) ────────────────────────────────────────
// Todo lo que se puede ajustar sin tocar la lógica. Los umbrales en horas cuentan horas corridas salvo donde dice "hábiles".
import type { ArchivoGrabacion, EstadoVideo } from './tipos'

// Vigía (Drive)
export const CIERRE_TANDA_MIN = 45                 // una tanda de subida se cierra a los 45 minutos sin archivos nuevos
export const MARGEN_VIGIA_MIN = 120                // solapamiento al pedir "creados desde la última consulta" (dedupe por drive_id)
export const NIVELES_ARBOL = 4                     // hasta qué nivel debajo de "Crudos - X" se baja
export const DIAS_SUBCARPETA_VIGILADA = 45         // una subcarpeta con actividad en estos días se sigue vigilando
export const PARALELO_DRIVE = 8
export const HORARIO_VIGIA = { desde: 8, hasta: 22 } as const   // hora de Argentina, [desde, hasta)
export const HORAS_VIGIA_CALLADO = 2
export const MARGEN_DEADLINE_MS = 60_000           // el vigía corta antes del deadline y deja el resto para la próxima corrida
                                                   // (después del corte todavía corren los avisos: 15 s + despacho 25 s)
export const MARGEN_PASO_LARGO_MS = 35_000         // un paso que puede tardar (export de un doc, envío a AssemblyAI) no arranca
                                                   // si quedan menos de esto para el corte
export const MIN_PARA_CLAUDE_MS = 150_000          // Claude (comparación) arranca solo si quedan al menos 150 s
export const CORRIDA_COLGADA_MIN = 6               // una corrida "corriendo" de más de 6 minutos se da por colgada
export const COMPARANDO_COLGADA_MIN = 10           // una tanda "comparando" de más de 10 minutos se puede volver a reclamar
export const MAX_ALTAS_POR_PASADA = 10             // freno: más altas de videos que esto para un cliente en una pasada → no se crean
export const DIAS_CRUDO_ANTES_DEL_VIDEO = 21       // un archivo creado más de 21 días antes que el video no se le vincula solo
                                                   // (los crudos históricos de la primera pasada no son de los videos de hoy)

// Avisos
export const ESPERA_TRANSCRIPCION_MIN = 20
export const VENTANA_AGRUPAR_MIN = 30
export const VENTANA_CORRECCION_MIN = 10
export const HORA_RESUMEN = '07:45'
export const DIAS_DAILY: readonly number[] = [2, 3, 4, 5]   // la daily es de martes a viernes (0 = domingo)

// e01 (seguimiento si el cliente no graba): días hábiles desde el inicio del ciclo (sin contar ese día)
export const ESCALONES_E01 = { dia0: 0, dia2: 2, dia4: 4, dia9: 9 } as const
export const RECORDATORIO_CADA_HABILES = 4

// Videos trabados: cuánto puede estar un video en cada estado y a cargo de quién
export const UMBRALES_TRABADO: Partial<Record<EstadoVideo, { horas?: number; habiles?: number; quien: 'aylu' | 'rene' | 'cliente' }>> = {
  crudo_a_revisar: { horas: 24, quien: 'aylu' },
  editado: { horas: 24, quien: 'aylu' },
  corregido: { horas: 24, quien: 'aylu' },
  para_editar: { horas: 24, quien: 'rene' },
  correccion: { horas: 24, quien: 'rene' },
  regrabar: { habiles: 1, quien: 'aylu' },
  con_cliente: { habiles: 3, quien: 'cliente' },
}

// Transcripción (AssemblyAI)
export const TOPE_BYTES_TRANSCRIPCION = 4_900_000_000
export const TRANSCRIBIR_ULTIMAS_HORAS = 48
export const TOPE_MINUTOS_TRANSCRIPCION_DIA = 180
// Sin duración todavía (videoMediaMetadata tarda y los audio/* no la traen) la duración se estima por el peso, a la BAJA del
// peso por minuto para que el tope diario frene de más y no de menos: video ~1080p HEVC del celular (60 MB/min; un 4K se
// sobreestima) y audio comprimido (m4a/mp3 a ~64 kbps: 0,5 MB/min). Al guardar la transcripción se anota la duración real.
export const BYTES_POR_MINUTO_VIDEO = 60_000_000
export const BYTES_POR_MINUTO_AUDIO = 500_000
export const ENVIANDO_COLGADA_MIN = 10
export const ENVIADA_CONSULTAR_MIN = 30
export const MAX_PALABRAS_CLAVE = 100

// Comparación con los guiones
export const UMBRAL_FRASE = { presente: 0.85, dudosa: 0.6 } as const
export const MAX_TOKENS_COMPARACION = 16_000
export const TOPE_CLAUDE_COMPARACION_MS = 120_000

// Secretos de las rutas propias: mínimo de largo (solo los de esta etapa; CRON_SECRET lo usan otros 11 crons y no se exige)
export const MIN_SECRETO = 32

/** EDICION_MODO: `real` o, por defecto, `dry` (el bot no escribe en Neon ni llama a AssemblyAI, Claude ni Discord). */
export function modoEdicion(env: Record<string, string | undefined> = process.env): 'dry' | 'real' {
  return env.EDICION_MODO?.trim().toLowerCase() === 'real' ? 'real' : 'dry'
}
/** ¿Los avisos de Discord salen de verdad? Solo en modo real y sin EDICION_AVISOS=dry. */
export function avisosReales(env: Record<string, string | undefined> = process.env): boolean {
  return modoEdicion(env) === 'real' && env.EDICION_AVISOS?.trim().toLowerCase() !== 'dry'
}
/** Tope de bytes para mandar a transcribir (ASSEMBLYAI_MAX_BYTES lo pisa si es un número positivo). */
export function topeBytesTranscripcion(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ASSEMBLYAI_MAX_BYTES)
  return Number.isFinite(n) && n > 0 ? n : TOPE_BYTES_TRANSCRIPCION
}

/** Motivo con el que la transcripción marca la copia de un crudo que ya se transcribe ("duplicado de #N"). */
export const MOTIVO_DUPLICADO = 'duplicado de #'
/** ¿Es la copia de otro crudo? No se transcribe ni se ubica (lo hace su gemelo): no cuenta como crudo sin ubicar ni sin
 *  transcribir (revisión de la integración, ronda 3). */
export const esCopiaDuplicada = (a: Pick<ArchivoGrabacion, 'transcripcion'>): boolean =>
  a.transcripcion.estado === 'no_aplica' && a.transcripcion.motivo.startsWith(MOTIVO_DUPLICADO)
