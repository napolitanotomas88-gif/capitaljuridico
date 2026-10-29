// ── Bot "Capital Jurídico": etapa BAJA DEL CLIENTE — modo, capacidades y variables (puro, sin red) ───────────────────────
// Mismo criterio que el motor de altas (lib/bot/alta/motor/modo.ts) y que la etapa Éxito, con su PROPIO interruptor:
//   · BOT_BAJAS_MODO: 'seco' (por defecto: no sale nada, ni Claude, ni Whapi, ni Fathom, ni planillas; solo se anota lo que
//     haría), 'ensayo' (lecturas reales: CRM, Whapi GET, Fathom, Claude; como mucho un reporte "SIMULACIÓN" corto en
//     Verificaciones C.J) o 'real' (sale solo lo que dice BOT_BAJAS_CAPACIDADES).
//   · BOT_BAJAS_CAPACIDADES (lista separada por coma):
//       baja_aviso_fin ....... i01: el pedido de OK en Verificaciones 14 días antes del fin ("<Cliente> termina el …")
//       baja_mensaje_cliente . i01/i02: los mensajes al grupo General del cliente (renovación con el Calendly y despedida)
//       baja_fathom .......... i02: leer la llamada de renovación (Fathom + Claude) y pedir la confirmación de la baja
//       baja_quitar_grupos ... i03a: sacar al cliente (y a sus socios) de General, Ventas y Contenido por Whapi
//       baja_aviso_skool ..... i03b: aviso a Aylu en #🤝-exito-y-bajas para sacarlo de Skool a mano
//       baja_crm ............. i04: pasar al cliente a FINALIZADO (Históricos) en el CRM con la fecha y la nota de la baja
//       baja_recontacto ...... i05: la lista mensual de históricos para recontactar en #🤝-exito-y-bajas
//       baja_eliminar_comunidad  ronda 2: eliminar la comunidad del cliente (con su grupo de Avisos), después de la despedida y
//                                de sacarlo de los grupos
//       baja_pausar_meta ..... ronda 2: con la baja confirmada, pedir OK y PAUSAR sus campañas activas en Meta (nunca borra)
//       baja_quitar_drive .... ronda 2: con la baja confirmada, sacarle al cliente y a sus socios el acceso a su carpeta
//                              "<Nombre> - C.J" (Puente Drive quitarAccesoCliente; la carpeta y el contenido quedan intactos)
// Nombres desconocidos se ignoran (el log lo avisa con la cantidad, nunca con valores).
import type { ModoMotor } from '@/lib/bot/alta/motor/modo'

export type CapacidadBaja =
  | 'baja_aviso_fin' | 'baja_mensaje_cliente' | 'baja_fathom' | 'baja_quitar_grupos' | 'baja_aviso_skool' | 'baja_crm' | 'baja_recontacto'
  | 'baja_eliminar_comunidad' | 'baja_pausar_meta' | 'baja_quitar_drive'
export const CAPACIDADES_BAJA: readonly CapacidadBaja[] = [
  'baja_aviso_fin', 'baja_mensaje_cliente', 'baja_fathom', 'baja_quitar_grupos', 'baja_aviso_skool', 'baja_crm', 'baja_recontacto',
  'baja_eliminar_comunidad', 'baja_pausar_meta', 'baja_quitar_drive',
]

/** Las que en ENSAYO pueden dejar un reporte SIMULACIÓN corto en Verificaciones (nunca un mensaje a un cliente). */
export const CAPACIDADES_REPORTE_ENSAYO: readonly CapacidadBaja[] = ['baja_aviso_fin', 'baja_fathom', 'baja_recontacto']

export const modoBajas = (env: NodeJS.ProcessEnv = process.env): ModoMotor => {
  const v = env.BOT_BAJAS_MODO?.trim()
  return v === 'real' || v === 'ensayo' ? v : 'seco'
}

export function capacidadesBajasDesconocidas(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.BOT_BAJAS_CAPACIDADES ?? '').split(',').map((s) => s.trim()).filter((s) => s && !(CAPACIDADES_BAJA as readonly string[]).includes(s))
}

export function capacidadesBajas(modo: ModoMotor, env: NodeJS.ProcessEnv = process.env): ReadonlySet<CapacidadBaja> {
  if (modo === 'seco') return new Set()
  return new Set((env.BOT_BAJAS_CAPACIDADES ?? '').split(',').map((s) => s.trim())
    .filter((s): s is CapacidadBaja => (CAPACIDADES_BAJA as readonly string[]).includes(s)))
}

/** ¿Sale de verdad la acción de esta capacidad? Solo en real. */
export const saleReal = (c: CapacidadBaja, modo: ModoMotor, caps: ReadonlySet<CapacidadBaja>): boolean => modo === 'real' && caps.has(c)
/** ¿Se manda el reporte SIMULACIÓN de esta capacidad? Solo en ensayo, y solo las de CAPACIDADES_REPORTE_ENSAYO. */
export const reporteEnsayo = (c: CapacidadBaja, modo: ModoMotor, caps: ReadonlySet<CapacidadBaja>): boolean =>
  modo === 'ensayo' && caps.has(c) && CAPACIDADES_REPORTE_ENSAYO.includes(c)
/** ¿Está prendida (en ensayo o real)? Para las lecturas caras (Claude, Fathom): sin la capacidad no se gasta nada. */
export const prendida = (c: CapacidadBaja, modo: ModoMotor, caps: ReadonlySet<CapacidadBaja>): boolean => modo !== 'seco' && caps.has(c)
/** ¿Hay lecturas externas (CRM, Whapi GET, Fathom, Claude)? En ensayo y real. */
export const hayLecturas = (modo: ModoMotor): boolean => modo !== 'seco'

// ── Constantes de la etapa (decisiones de Tomás, 25/10/2026, y de esta etapa donde se dice) ──
const DIA = 86_400_000
export const AVISO_FIN_DIAS = 14                        // i01: 14 días antes del fin real del programa
export const VENCE_PEDIDO_MS = 14 * DIA                 // un pedido sin respuesta vence a los 14 días (como Éxito y el motor)
export const MAX_AVISOS_DIA = 5                         // tope de pedidos de aviso de fin por día (el primer día no inunda Verificaciones)
export const VENTANA_LLAMADA_ANTES_DIAS = 60            // i02: la llamada de renovación cuenta si el fin está hasta 60 días después…
export const VENTANA_LLAMADA_DESPUES_DIAS = 45          // …o hasta 45 días antes de la llamada (decisión de esta etapa)
export const MAX_TRANSCRIPCION = 60_000                 // caracteres de la transcripción que van a Claude
// i02 comparte la invocación del webhook de Fathom de /api/bot/kickoff (maxDuration 300 s): tiene su PROPIO tope
export const PLAZO_BAJAS_MS = 275_000                   // desde que llega el webhook: termina antes de los ~280 s del kickoff
export const MARGEN_INICIO_MS = 60_000                  // sin 60 s libres no se empieza (Claude + el pedido en Verificaciones)
export const MARGEN_ENVIO_MS = 35_000                   // sin 35 s libres no se abre el pedido (el envío a Whapi corta a los 30 s)
export const MAX_QUITAR_POR_GRUPO = 6                   // i03a: si en un grupo hay más "clientes" que esto, algo está mal: no se saca a nadie
export const ESPERA_DESPEDIDA_MS = 5_000                // entre la despedida y sacarlo, para que el mensaje llegue antes
export const RECONTACTO_MIN_DIAS = 30                   // i05: se recontacta a quien se fue hace 30 días o más…
export const RECONTACTO_MAX_DIAS = 365                  // …y hace menos de un año
export const MAX_RECONTACTO = 20                        // como mucho 20 por mes en la lista

/** Aylu (la que confirma la despedida): su teléfono de BOT_ALTA_OPERACIONES, por defecto de BAJA_APROBADORES_DESPEDIDA. */
export const TEL_AYLU_POR_DEFECTO = ''

export interface ConfigBajas {
  modo: ModoMotor
  capacidades: ReadonlySet<CapacidadBaja>
  /** Quién confirma la baja y el aviso de fin (BOT_ALTA_APROBADORES: Tomás y Gero A). */
  aprobadores: string[]
  /** Quién confirma la despedida (BAJA_APROBADORES_DESPEDIDA; por defecto Aylu) — los aprobadores también pueden. */
  despedida: string[]
  verificaciones: string | null
  /** Link de Calendly de Tomi para la renovación (BAJA_CALENDLY_URL; por defecto, el que pasó Tomás). */
  calendlyUrl: string
  diaRecontacto: number
}

/** "5491130009999, 123@lid" → lista (mismo criterio que listaPersonas del motor). */
export function listaPersonas(v: string | undefined): string[] {
  return (v ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x.includes('@') ? x : x.replace(/\D/g, ''))).filter((x) => x.length >= 8 || x.includes('@'))
}

/** El Calendly de renovación de Tomi (Tomás, 25/10/2026): valor por defecto de BAJA_CALENDLY_URL. */
export const URL_CALENDLY_POR_DEFECTO = ''

const urlHttps = (v: string | undefined, def: string): string => {
  const t = v?.trim() ?? ''
  try { if (t && new URL(t).protocol === 'https:') return t } catch { /* el de por defecto */ }
  return def
}

export function configBajas(env: NodeJS.ProcessEnv = process.env): ConfigBajas {
  const modo = modoBajas(env)
  const verif = env.WHAPI_GRUPO_VERIFICACIONES?.trim() ?? ''
  const dia = Number(env.BAJA_RECONTACTO_DIA)
  const aprobadores = listaPersonas(env.BOT_ALTA_APROBADORES)
  return {
    modo,
    capacidades: capacidadesBajas(modo, env),
    aprobadores,
    despedida: [...new Set([...(listaPersonas(env.BAJA_APROBADORES_DESPEDIDA).length ? listaPersonas(env.BAJA_APROBADORES_DESPEDIDA) : listaPersonas(env.BOT_ALTA_OPERACIONES)), ...aprobadores])],
    verificaciones: /^\d[\d-]{9,30}@g\.us$/.test(verif) ? verif : null,
    calendlyUrl: urlHttps(env.BAJA_CALENDLY_URL, URL_CALENDLY_POR_DEFECTO),
    diaRecontacto: Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : 1,
  }
}

/** Lo que falta para que algo salga de verdad (NOMBRES de variables, nunca valores). */
export function faltantesBajas(env: NodeJS.ProcessEnv = process.env): string[] {
  const f: string[] = []
  const c = configBajas(env)
  if (!env.DATABASE_URL?.trim()) f.push('DATABASE_URL')
  if (c.modo === 'seco') return f
  const tiene = (k: CapacidadBaja) => c.capacidades.has(k)
  if (!env.SHEET_ID_CLIENTES?.trim()) f.push('SHEET_ID_CLIENTES')
  if (!env.WHAPI_TOKEN?.trim()) f.push('WHAPI_TOKEN')
  if (!c.verificaciones) f.push('WHAPI_GRUPO_VERIFICACIONES')
  if (!c.aprobadores.length) f.push('BOT_ALTA_APROBADORES')
  if ((tiene('baja_mensaje_cliente') || tiene('baja_recontacto')) && !c.calendlyUrl) f.push('BAJA_CALENDLY_URL')
  if (tiene('baja_fathom') && !(env.BOT_ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim())) f.push('BOT_ANTHROPIC_API_KEY')
  if (tiene('baja_fathom') && !env.FATHOM_API_KEY_TOMAS?.trim()) f.push('FATHOM_API_KEY_TOMAS')
  if ((tiene('baja_aviso_skool') || tiene('baja_recontacto')) && !env.DISCORD_WEBHOOK_CLIENTES?.trim()) f.push('DISCORD_WEBHOOK_CLIENTES')
  if (tiene('baja_aviso_skool') && !env.DISCORD_ID_AYLU?.trim()) f.push('DISCORD_ID_AYLU')
  if (tiene('baja_pausar_meta') && !env.META_ANUNCIOS_TOKEN?.trim()) f.push('META_ANUNCIOS_TOKEN')
  if (tiene('baja_quitar_drive') && !env.PUENTE_DRIVE_URL?.trim()) f.push('PUENTE_DRIVE_URL')
  if (tiene('baja_quitar_drive') && !env.PUENTE_DRIVE_SECRETO?.trim()) f.push('PUENTE_DRIVE_SECRETO')
  return f
}

/** BOT_BAJAS=no apaga todo (también el registro): por defecto la etapa escucha en seco. */
export const bajasApagado = (env: NodeJS.ProcessEnv = process.env): boolean => /^(no|0|false|apagado|off)$/i.test((env.BOT_BAJAS ?? '').trim())
