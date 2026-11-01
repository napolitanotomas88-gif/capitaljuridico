// ── Bot "Capital Jurídico": separar la dirección con Claude cuando las reglas no alcanzan (contrato de PandaDoc) ─────
// SOLO SERVIDOR: usa la API de Anthropic. Está aparte de direccion.ts porque esa la importa contrato.ts, que llega a un
// componente de cliente (plan.ts → SimuladorAlta). No lleva `import 'server-only'` para poder probarlo con node.
//
// · Clave: BOT_ANTHROPIC_API_KEY (así se llama en Vercel) o ANTHROPIC_API_KEY (local).
// · Modelo claude-haiku-5-5 con esfuerzo bajo: es una extracción corta. Salida JSON estricta (output_config.format con
//   JSON Schema) y además se valida a la vuelta. Haiku 5.5 no tiene fallback del servidor ante un rechazo: un rechazo
//   es un error y el contrato sigue con lo que separaron las reglas.
// · Sin inventar: lo que Claude no sabe vuelve vacío y queda como faltante para el closer.
// · resolverDireccion nunca tira error: si Claude falla o no hay clave, devuelve lo de las reglas con un aviso y, si
//   ciudad y provincia quedaron con la conjetura de las reglas (confianza 'baja'), con el faltante
//   FALTANTE_CONFIRMAR_CIUDAD para que el closer las confirme (un aviso solo no alcanza: va al domicilio del contrato).
// · Tope: TOPE_DIRECCION_MS (8 s) y sin reintentos. Junto con los 30 s de PandaDoc (TOPE_ESTADO_MS) entra en una
//   función de Vercel de 60 s; con 20 s y un reintento podía llegar a ~40 s solo acá.
import Anthropic from '@anthropic-ai/sdk'
import { claveOMac, crearClienteClaude, viaMac } from '@/lib/ia/cliente'
import {
  combinarConClaude, faltantesDireccion, paisPorTelefono, reglasAlcanzan, separarDireccion, type DireccionSeparada,
} from './direccion'

export const MODELO_DIRECCION = 'claude-haiku-5-5'
export const TOPE_DIRECCION_MS = 8_000

// Con CLAUDE_VIA=mac (1/11/2026) no hace falta clave: las llamadas van a la Mac de Tomás (lib/ia/puenteMac.ts)
export const claveClaudeDireccion = (): string =>
  claveOMac(process.env.BOT_ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || '')

export interface OpcionesDireccionClaude {
  apiKey?: string                          // por defecto claveClaudeDireccion()
  cliente?: Pick<Anthropic, 'messages'>    // para tests (no sale a la red)
  paisTelefono?: string                    // pista para desempatar ciudades con el mismo nombre
  topeMs?: number                          // por defecto TOPE_DIRECCION_MS
}

const SISTEMA = `Separás direcciones postales de clientes de una consultora para abogados (la mayoría de Argentina y del resto de Latinoamérica) para completar un contrato.
Devolvé:
- calle: calle, número, piso/departamento y barrio si lo hay, tal como están escritos. Sin código postal, ciudad, provincia ni país.
- ciudad: la ciudad o localidad.
- provincia: la provincia, estado, departamento o región de esa ciudad.
- pais: el país.
Escribí los nombres de ciudad, provincia y país con mayúsculas y acentos correctos. Para la Ciudad Autónoma de Buenos Aires (CABA, Capital Federal o un barrio porteño con la ciudad clara): ciudad "CABA" y provincia "Ciudad Autónoma de Buenos Aires".
No inventes. Si un dato no está en la dirección y no se deduce sin ninguna duda (por ejemplo, la provincia de una ciudad que existe en un solo lugar), devolvelo como cadena vacía. "Buenos Aires" solo, sin otra ciudad, es ambiguo: puede ser la ciudad o la provincia.
El país del teléfono del cliente es solo una pista para elegir entre ciudades con el mismo nombre: el cliente puede vivir en otro país.`

const SCHEMA = {
  type: 'object',
  properties: {
    calle: { type: 'string' },
    ciudad: { type: 'string' },
    provincia: { type: 'string' },
    pais: { type: 'string' },
  },
  required: ['calle', 'ciudad', 'provincia', 'pais'],
  additionalProperties: false,
} as const

/** Mensaje corto de un error (va al aviso del alta): nunca la clave ni la respuesta entera. */
function motivo(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude no respondió a tiempo'
  if (e instanceof Anthropic.APIConnectionError) return 'no se pudo conectar con Claude'
  if (e instanceof Anthropic.APIError) return `Claude respondió ${e.status ?? 'con error'}${e.type ? ` (${e.type})` : ''}`
  return String((e as Error)?.message ?? e).slice(0, 200)
}

const limpiar = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '')

/** Le pide a Claude (Haiku 5.5) que separe la dirección. Tira error si no hay clave, si Claude rechaza o corta la
 *  respuesta, o si la salida no es el JSON pedido. El resultado vuelve con confianza 'baja' (nadie lo verificó). */
export async function separarDireccionConClaude(texto: string, op: OpcionesDireccionClaude = {}): Promise<DireccionSeparada> {
  const entrada = texto.replace(/\s+/g, ' ').trim()
  if (!entrada) throw new Error('dirección vacía')
  // En la Mac, `claude -p` tarda más en arrancar que la API: 60 s (si no llega, quedan las reglas)
  const tope = op.topeMs ?? (viaMac() ? 60_000 : TOPE_DIRECCION_MS)
  let cliente = op.cliente
  if (!cliente) {
    const apiKey = op.apiKey ?? claveClaudeDireccion()
    if (!apiKey) throw new Error('falta BOT_ANTHROPIC_API_KEY (o ANTHROPIC_API_KEY)')
    cliente = crearClienteClaude({ apiKey, maxRetries: 0, timeout: tope, origen: 'alta-direccion' })
  }
  const pista = op.paisTelefono ? `\nPaís del teléfono del cliente (solo pista): ${op.paisTelefono}` : ''
  const msg = await cliente.messages.create(
    {
      model: MODELO_DIRECCION,
      max_tokens: 2048,   // deja lugar al razonamiento (Haiku 5.5 piensa por defecto) además del JSON corto
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SISTEMA,
      messages: [{ role: 'user', content: `Dirección: ${entrada}${pista}` }],
    },
    { timeout: tope, maxRetries: 0 },   // el tiempo total sería timeout × (reintentos + 1)
  )
  if (msg.stop_reason === 'refusal') throw new Error(`Claude rechazó separar la dirección (${msg.stop_details?.category ?? 'sin categoría'})`)
  if (msg.stop_reason === 'max_tokens') throw new Error('la respuesta de Claude se cortó por max_tokens')
  if (msg.stop_reason !== 'end_turn') throw new Error(`Claude terminó de forma inesperada (${msg.stop_reason ?? 'sin stop_reason'})`)
  const salida = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(salida)
  } catch {
    throw new Error('la salida de Claude no es JSON válido')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('la salida de Claude no es un objeto')
  return { calle: limpiar(json.calle), ciudad: limpiar(json.ciudad), provincia: limpiar(json.provincia), pais: limpiar(json.pais), confianza: 'baja' }
}

export interface DireccionResuelta extends DireccionSeparada {
  fuente: 'reglas' | 'claude'
  avisos: string[]      // para revisar en Verificaciones C.J / avisarle al closer
  /** [FALTANTE_CIUDAD_PROVINCIA] si quedaron vacías; [FALTANTE_CONFIRMAR_CIUDAD] si quedaron con la conjetura de las
   *  reglas (fuente 'reglas' y confianza 'baja'). Lo que dedujo Claude va como aviso, no como faltante. */
  faltantes: string[]
}

/** ¿Ciudad y provincia son una conjetura de las reglas que nadie verificó? (fuente 'reglas' con confianza 'baja'). */
export const hayQueConfirmarCiudad = (d: Pick<DireccionResuelta, 'fuente' | 'confianza'>): boolean =>
  d.fuente === 'reglas' && d.confianza === 'baja'

const conFaltantes = (d: DireccionSeparada, fuente: DireccionResuelta['fuente'], avisos: string[]): DireccionResuelta =>
  ({ ...d, fuente, avisos, faltantes: faltantesDireccion(d, hayQueConfirmarCiudad({ fuente, confianza: d.confianza })) })

/** Reglas primero; si no alcanzan (confianza baja o falta ciudad/provincia), Claude. Nunca tira error. */
export async function resolverDireccion(texto: string, telefono?: string | null, op: OpcionesDireccionClaude = {}): Promise<DireccionResuelta> {
  const reglas = separarDireccion(texto, telefono)
  if (reglasAlcanzan(reglas)) return conFaltantes(reglas, 'reglas', [])
  if (!op.cliente && !(op.apiKey ?? claveClaudeDireccion())) {
    return conFaltantes(reglas, 'reglas', ['Sin clave de Claude (BOT_ANTHROPIC_API_KEY): la dirección se separó solo con reglas'])
  }
  try {
    const claude = await separarDireccionConClaude(texto, { ...op, paisTelefono: op.paisTelefono ?? paisPorTelefono(telefono) })
    const d = combinarConClaude(reglas, claude)
    const deducido = [d.ciudad, d.provincia].filter(Boolean).join(', ')
    return conFaltantes(d, 'claude', deducido ? [`Ciudad y provincia deducidas por Claude (${deducido}): revisarlas en el borrador`] : [])
  } catch (e) {
    return conFaltantes(reglas, 'reglas', [`No se pudo separar la dirección con Claude: ${motivo(e)}`])
  }
}
