// ── Bot "Capital Jurídico": etapa ÉXITO DEL CLIENTE — modo, capacidades y variables (puro, sin red) ──────────────────────
// Mismo criterio que el motor de altas (lib/bot/alta/motor/modo.ts), con su PROPIO interruptor para poder prenderla aparte:
//   · BOT_EXITO_MODO: 'seco' (por defecto: no sale nada, ni Claude, ni Whapi, ni planillas; solo se anota lo que haría),
//     'ensayo' (lecturas reales: Claude, Whapi GET, CRM y planilla del Typeform; como mucho un reporte "SIMULACIÓN" corto en
//     Verificaciones C.J) o 'real' (sale solo lo que dice BOT_EXITO_CAPACIDADES).
//   · BOT_EXITO_CAPACIDADES (lista separada por coma):
//       exito_pedido_ok ........ el pedido de permiso en Verificaciones C.J (en ensayo, como reporte SIMULACIÓN)
//       exito_mensaje_cliente .. el mensaje de testimonio al grupo General del cliente (solo real)
//       exito_testimonio ....... el agradecimiento con el Calendly en el General + el aviso en Discord (solo real; en ensayo,
//                                un reporte SIMULACIÓN en Verificaciones)
//       encuesta_mensual ....... la lista del mes para el OK en Verificaciones, la encuesta y el recordatorio en el General de
//                                cada cliente activo y las consultas por respuestas dudosas (solo real; en ensayo, la lista
//                                sale como SIMULACIÓN y el OK no manda nada)
// Nombres desconocidos se ignoran (el log lo avisa con la cantidad, nunca con valores).
import type { ModoMotor } from '@/lib/bot/alta/motor/modo'

export type CapacidadExito = 'exito_pedido_ok' | 'exito_mensaje_cliente' | 'exito_testimonio' | 'encuesta_mensual'
export const CAPACIDADES_EXITO: readonly CapacidadExito[] = ['exito_pedido_ok', 'exito_mensaje_cliente', 'exito_testimonio', 'encuesta_mensual']

/** Las que en ENSAYO pueden dejar un reporte SIMULACIÓN en Verificaciones (nunca un mensaje a un cliente). */
export const CAPACIDADES_REPORTE_ENSAYO: readonly CapacidadExito[] = ['exito_pedido_ok', 'exito_testimonio', 'encuesta_mensual']

export const modoExito = (env: NodeJS.ProcessEnv = process.env): ModoMotor => {
  const v = env.BOT_EXITO_MODO?.trim()
  return v === 'real' || v === 'ensayo' ? v : 'seco'
}

export function capacidadesExitoDesconocidas(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.BOT_EXITO_CAPACIDADES ?? '').split(',').map((s) => s.trim()).filter((s) => s && !(CAPACIDADES_EXITO as readonly string[]).includes(s))
}

export function capacidadesExito(modo: ModoMotor, env: NodeJS.ProcessEnv = process.env): ReadonlySet<CapacidadExito> {
  if (modo === 'seco') return new Set()
  const pedidas = (env.BOT_EXITO_CAPACIDADES ?? '').split(',').map((s) => s.trim())
    .filter((s): s is CapacidadExito => (CAPACIDADES_EXITO as readonly string[]).includes(s))
  return new Set(pedidas)
}

/** ¿Sale de verdad la acción de esta capacidad? Solo en real. */
export const saleReal = (c: CapacidadExito, modo: ModoMotor, caps: ReadonlySet<CapacidadExito>): boolean => modo === 'real' && caps.has(c)
/** ¿Se manda el reporte SIMULACIÓN de esta capacidad? Solo en ensayo, y solo las de CAPACIDADES_REPORTE_ENSAYO. */
export const reporteEnsayo = (c: CapacidadExito, modo: ModoMotor, caps: ReadonlySet<CapacidadExito>): boolean =>
  modo === 'ensayo' && caps.has(c) && CAPACIDADES_REPORTE_ENSAYO.includes(c)
/** ¿Hay lecturas externas (Claude, Whapi GET, planillas)? En ensayo y real. */
export const hayLecturas = (modo: ModoMotor): boolean => modo !== 'seco'

// ── Constantes de la etapa (decisiones de Tomás, 25/10/2026) ──
export const PUNTAJE_EXITO = 8                       // encuesta: 8 o más de 0 a 10
export const ENFRIAMIENTO_ENVIADO_MS = 60 * 86_400_000   // ya se mandó el testimonio: 60 días sin volver a pedir
export const ENFRIAMIENTO_NO_MS = 30 * 86_400_000        // respondieron NO (o fue un ensayo aprobado): 30 días (decisión de esta etapa)
export const VENCE_PEDIDO_MS = 14 * 86_400_000           // un pedido sin respuesta vence a los 14 días (como las esperas del motor)
export const VENTANA_TESTIMONIO_MS = 30 * 86_400_000     // el video cuenta si llega dentro de los 30 días del mensaje
export const RECORDATORIO_ENCUESTA_MS = 3 * 86_400_000   // recordatorio a los 3 días si no respondió
export const MAX_CLAUDE_CLIENTE_DIA = 5                  // tope de evaluaciones con Claude por cliente y por día
export const MAX_PEDIDOS_ENCUESTA_DIA = 5                // tope de pedidos por la encuesta en un día (el primer día no inunda Verificaciones)
// h01 del tablero (1/11/2026): medidor de éxito. El cliente se cuenta "contento" desde su primera señal buena (un mensaje con
// buenos resultados o un 8+ en la ronda vigente) que no fue seguida por una mala (un mensaje que habla de resultados MALOS).
// Con EXITO_DIAS_CONTENTO días contento (por defecto 5) se pide el OK del testimonio. 0 = como antes (en la primera señal).
export const DIAS_CONTENTO_POR_DEFECTO = 5
export const MAX_ENCUESTAS_CORRIDA_POR_DEFECTO = 10       // WhatsApp seguro: nunca un lote grande de golpe desde un número no oficial
export const VENTANA_MEDIDOR_MS = 30 * 86_400_000         // las señales de más de 30 días no cuentan para el medidor

export const URL_CALENDLY_POR_DEFECTO = 'https://calendly.com/skywardconsultoriajuridica/analisisyproyeccion'   // "Reunion de Análisis y Proyecciones" (afcc9184-…), leída el 25/10/2026
export const URL_TYPEFORM_POR_DEFECTO = 'https://form.typeform.com/to/bnvnMvVn'   // "Encuesta mensual de satisfacción", el único formulario (Tomás, 25/10/2026)

const urlHttps = (v: string | undefined, def: string): string => {
  const t = v?.trim() ?? ''
  try { if (t && new URL(t).protocol === 'https:') return t } catch { /* la de por defecto */ }
  return def
}

export interface ConfigExito {
  modo: ModoMotor
  capacidades: ReadonlySet<CapacidadExito>
  aprobadores: string[]
  verificaciones: string | null
  calendlyUrl: string
  typeformUrl: string
  diaEncuesta: number
  /** Días contento antes de pedir el testimonio (h01). 0 = en la primera señal. */
  diasContento: number
  /** WhatsApp seguro (sin lotes grandes): cuántas encuestas salen como mucho por corrida del cron; el resto sigue al otro día. */
  maxEncuestasCorrida: number
  /** true = la corrida de los clientes de prueba (BOT_CLIENTES_PRUEBA): real con todas las capacidades, solo para ellos. */
  prueba: boolean
}

/** "5491130009999, 123@lid" → lista (mismo criterio que listaPersonas del motor). */
export function listaPersonas(v: string | undefined): string[] {
  return (v ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x.includes('@') ? x : x.replace(/\D/g, ''))).filter((x) => x.length >= 8 || x.includes('@'))
}

export function configExito(env: NodeJS.ProcessEnv = process.env): ConfigExito {
  const modo = modoExito(env)
  const verif = env.WHAPI_GRUPO_VERIFICACIONES?.trim() ?? ''
  const dia = Number(env.EXITO_ENCUESTA_DIA)
  const dc = (env.EXITO_DIAS_CONTENTO ?? '').trim()
  const diasContento = /^\d{1,2}$/.test(dc) && Number(dc) <= 60 ? Number(dc) : DIAS_CONTENTO_POR_DEFECTO
  return {
    modo,
    capacidades: capacidadesExito(modo, env),
    aprobadores: listaPersonas(env.BOT_ALTA_APROBADORES),
    verificaciones: /^\d[\d-]{9,30}@g\.us$/.test(verif) ? verif : null,
    calendlyUrl: urlHttps(env.EXITO_CALENDLY_URL, URL_CALENDLY_POR_DEFECTO),
    typeformUrl: urlHttps(env.EXITO_TYPEFORM_URL, URL_TYPEFORM_POR_DEFECTO),
    diaEncuesta: Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : 1,
    diasContento,
    maxEncuestasCorrida: /^\d{1,3}$/.test((env.EXITO_ENCUESTA_MAX_CORRIDA ?? '').trim()) && Number(env.EXITO_ENCUESTA_MAX_CORRIDA) >= 1 ? Number(env.EXITO_ENCUESTA_MAX_CORRIDA) : MAX_ENCUESTAS_CORRIDA_POR_DEFECTO,
    prueba: false,
  }
}

/** La config de la corrida de PRUEBA: real con TODAS las capacidades. Solo se usa para los clientes de BOT_CLIENTES_PRUEBA
 *  (servidor.ts arma un núcleo aparte que ignora a todos los demás). EXITO_DIAS_CONTENTO_PRUEBA (0 a 60) acorta el medidor
 *  para la prueba; si falta, vale lo mismo que el general. */
export function configPruebaExito(env: NodeJS.ProcessEnv = process.env): ConfigExito {
  const base = configExito(env)
  const dc = (env.EXITO_DIAS_CONTENTO_PRUEBA ?? '').trim()
  return { ...base, modo: 'real', capacidades: new Set(CAPACIDADES_EXITO), prueba: true, diasContento: /^\d{1,2}$/.test(dc) && Number(dc) <= 60 ? Number(dc) : base.diasContento }
}

/** Lo que falta para que algo salga de verdad (NOMBRES de variables, nunca valores). */
export function faltantesExito(env: NodeJS.ProcessEnv = process.env, prueba = false): string[] {
  const f: string[] = []
  const c = prueba ? configPruebaExito(env) : configExito(env)
  if (!env.DATABASE_URL?.trim()) f.push('DATABASE_URL')
  if (c.modo === 'seco') return f
  if (!env.WHAPI_TOKEN?.trim()) f.push('WHAPI_TOKEN')
  if (!c.verificaciones) f.push('WHAPI_GRUPO_VERIFICACIONES')
  if (!c.aprobadores.length) f.push('BOT_ALTA_APROBADORES')
  if (!(env.CLAUDE_VIA?.trim() === 'mac' || env.BOT_ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim())) f.push('BOT_ANTHROPIC_API_KEY')
  if (c.capacidades.has('exito_testimonio') && !env.DISCORD_WEBHOOK_CLIENTES?.trim()) f.push('DISCORD_WEBHOOK_CLIENTES')
  if (c.capacidades.has('encuesta_mensual') && !env.SHEET_ID_CLIENTES?.trim()) f.push('SHEET_ID_CLIENTES')
  if (c.capacidades.has('encuesta_mensual') && !env.SHEET_ID_TYPEFORM?.trim()) f.push('SHEET_ID_TYPEFORM')
  return f
}

/** BOT_EXITO=no apaga todo (también el registro): por defecto la etapa escucha en seco. */
export const exitoApagado = (env: NodeJS.ProcessEnv = process.env): boolean => /^(no|0|false|apagado|off)$/i.test((env.BOT_EXITO ?? '').trim())
