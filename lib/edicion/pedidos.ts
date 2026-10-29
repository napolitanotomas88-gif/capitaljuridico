// ── f05 y P6: el pedido del cliente → notas para René, con el tope de rondas INTERNO ────────────────────────────────────
// Flujo (lo dispara la pantalla, /api/edicion/pedido y /api/edicion):
//   1. Aylu pega el mensaje del cliente → proponerNotas: Claude (el cliente del kickoff, esfuerzo low, max_tokens fijo)
//      separa el pedido en notas; cada cita tiene que aparecer TAL CUAL en el pedido o la nota se descarta (y queda
//      anotado en `ajustes`). Sin Claude (modo dry o sin key) → propuesta vacía: "cargá las notas a mano".
//   2. El pedido se guarda como `propuesto` (db/pedidos.ts, crearPedido).
//   3. Aylu tilda las que van → confirmarPedido → aplicarPedidoCliente de A, en UNA sentencia: crea las notas (origen
//      cliente), decide el pedido y mueve el video a corrección o, si la ronda pasaría el tope (TOPE_RONDAS_CLIENTE) y
//      quien confirma no es Tomás, lo deja en `con_cliente` con el bloqueo tope_rondas_cliente, el pedido en espera_tomas
//      y el AvisoMotor tope_rondas para Tomás. Elegir ninguna nota = "nada que corregir": no cuenta como ronda.
//   4. Tomás autoriza (autorizarRonda → correccion con esas notas) o descarta (descartarPedido: saca el bloqueo).
// P6 es PUERTAS ADENTRO: al cliente nunca se le dice que no en automático, y ningún texto para el cliente habla de rondas.
// decidirRonda usa la regla de A (decidirRondaCliente: puede() + TOPE_RONDAS_CLIENTE), sin reescribirla.
// Errores de escritura (conflicto de versión, no existe, no permitido) salen como ErrorPedido con su motivo: la API los
// pasa a 409 / 404 / 403.
import type { llamarClaude } from '@/lib/bot/kickoff/claude'
import type { AvisoMotor, EventoVideo, GuionDoc, NotaPropuesta, PedidoCliente, Persona, ResultadoEscritura, Video } from './tipos'
import { TIPOS_NOTA } from './tipos'
import { decidirRondaCliente } from './db/videos'
import type { aplicarPedidoCliente, autorizarPedidoCliente, descartarPedidoCliente } from './db/videos'
import type { crearPedido } from './db/pedidos'
import { SCHEMA_PEDIDO, SISTEMA_PEDIDO, VERSION_PROMPT_PEDIDO, usuarioPedido } from './pedidos-prompt'

export const LARGO_PEDIDO = 4_000
export const MAX_NOTAS_PROPUESTA = 30
export const MAX_TOKENS_PEDIDO = 16_000          // explícito: con el thinking adaptativo, 8.000 puede cortar por max_tokens
export const TOPE_CLAUDE_PEDIDO_MS = 90_000       // la ruta tiene maxDuration 120
export const SIN_CLAUDE = 'cargá las notas a mano'

export class ErrorPedido extends Error {
  readonly motivo: 'conflicto' | 'no_existe' | 'no_permitido'
  readonly detalle: string
  constructor(motivo: ErrorPedido['motivo'], detalle = '') {
    super(detalle || motivo)
    this.name = 'ErrorPedido'
    this.motivo = motivo
    this.detalle = detalle
  }
}

export interface PropuestaNotas {
  propuesta: NotaPropuesta[]; modelo: string | null; version: string; tokens: { in: number; out: number } | null
  /** Lo que el código corrigió o descartó de lo que devolvió Claude (citas que no son textuales, campos fuera de rango). */
  ajustes: string[]
  /** Por qué no hay propuesta (sin Claude, Claude falló): la pantalla lo muestra y Aylu carga las notas a mano. */
  aviso: string | null
}

/** Normaliza para comparar la cita con el pedido: espacios, comillas y mayúsculas (nada más: tiene que ser textual). */
export const paraComparar = (t: string): string =>
  t.replace(/[“”«»„"]/g, '"').replace(/[‘’`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()

/** Valida lo que devolvió Claude contra el pedido (pura). */
export function validarPropuesta(json: unknown, pedido: string): { propuesta: NotaPropuesta[]; ajustes: string[] } {
  const ajustes: string[] = []
  const notas = (json as { notas?: unknown })?.notas
  if (!Array.isArray(notas)) return { propuesta: [], ajustes: ['la respuesta no trae la lista de notas'] }
  const base = paraComparar(pedido)
  const propuesta: NotaPropuesta[] = []
  for (const [i, n] of notas.entries()) {
    if (propuesta.length >= MAX_NOTAS_PROPUESTA) { ajustes.push(`más de ${MAX_NOTAS_PROPUESTA} notas: el resto se descartó`); break }
    const o = (n ?? {}) as Record<string, unknown>
    const texto = typeof o.texto === 'string' ? o.texto.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
    const cita = typeof o.cita === 'string' ? o.cita.replace(/\s+/g, ' ').trim() : ''
    if (!texto) { ajustes.push(`nota ${i + 1} sin texto: descartada`); continue }
    if (!cita || !base.includes(paraComparar(cita))) { ajustes.push(`nota ${i + 1} descartada: la cita no aparece tal cual en el pedido («${cita.slice(0, 80)}»)`); continue }
    const tipo = (TIPOS_NOTA as readonly unknown[]).includes(o.tipo) ? (o.tipo as NotaPropuesta['tipo']) : 'otro'
    if (tipo !== o.tipo) ajustes.push(`nota ${i + 1}: tipo desconocido, va como "otro"`)
    const seg = Number.isInteger(o.segundo) && (o.segundo as number) >= 0 && (o.segundo as number) <= 3_600 ? (o.segundo as number) : null
    let hasta = Number.isInteger(o.hasta) && (o.hasta as number) >= 0 && (o.hasta as number) <= 3_600 ? (o.hasta as number) : null
    if (hasta !== null && (seg === null || hasta < seg)) { ajustes.push(`nota ${i + 1}: "hasta" sin un "segundo" anterior, se saca`); hasta = null }
    propuesta.push({
      texto, tipo, segundo: seg, hasta, afecta_rendimiento: o.afecta_rendimiento === true,
      motivo: typeof o.motivo === 'string' ? o.motivo.replace(/\s+/g, ' ').trim().slice(0, 300) : '', cita: cita.slice(0, 500),
    })
  }
  return { propuesta, ajustes }
}

/** f05: Claude separa el pedido en notas. Nunca lanza: si no hay Claude o falla, propuesta vacía con el aviso. */
export async function proponerNotas(p: { texto: string; video: Video; guion: GuionDoc | null }, deps: { claude: typeof llamarClaude | null; topeMs?: number }): Promise<PropuestaNotas> {
  const vacia = (aviso: string, ajustes: string[] = []): PropuestaNotas => ({ propuesta: [], modelo: null, version: VERSION_PROMPT_PEDIDO, tokens: null, ajustes, aviso })
  const texto = (p.texto ?? '').trim().slice(0, LARGO_PEDIDO)
  if (!texto) return vacia('el pedido está vacío')
  if (!deps.claude) return vacia(SIN_CLAUDE)
  try {
    const r = await deps.claude({
      que: 'el pedido del cliente', sistema: SISTEMA_PEDIDO, schema: SCHEMA_PEDIDO, esfuerzo: 'low', maxTokens: MAX_TOKENS_PEDIDO,
      topeMs: deps.topeMs ?? TOPE_CLAUDE_PEDIDO_MS,
      usuario: usuarioPedido({ clave: p.video.clave, gancho: p.video.gancho, guion: p.guion?.secciones ?? null, texto }),
    })
    const { propuesta, ajustes } = validarPropuesta(r.json, texto)
    return { propuesta, modelo: r.modelo, version: VERSION_PROMPT_PEDIDO, tokens: { in: r.usage.input_tokens, out: r.usage.output_tokens }, ajustes, aviso: null }
  } catch (e) {
    const m = ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
    return vacia(`Claude no pudo separar el pedido (${m}): ${SIN_CLAUDE}`)
  }
}

/** P6 con la regla de A: la ronda que sigue y si necesita a Tomás (sin reescribir el tope). */
export function decidirRonda(video: Pick<Video, 'ronda_cliente'> & Partial<Pick<Video, 'estado' | 'estado_previo' | 'bloqueo'>>, actor: Persona): { ronda: number; requiereTomas: boolean } {
  return decidirRondaCliente({ estado: video.estado ?? 'con_cliente', estado_previo: video.estado_previo ?? null, bloqueo: video.bloqueo ?? null, ronda_cliente: video.ronda_cliente }, actor)
}

export interface DepsPedidos {
  repo: {
    aplicarPedidoCliente: typeof aplicarPedidoCliente
    autorizarPedidoCliente: typeof autorizarPedidoCliente
    descartarPedidoCliente: typeof descartarPedidoCliente
    crearPedido?: typeof crearPedido
  }
  claude?: typeof llamarClaude | null
}

const fallo = (r: Extract<ResultadoEscritura<unknown>, { ok: false }>): never => { throw new ErrorPedido(r.motivo, r.detalle ?? '') }

/** Aylu (o Tomás) pegó el pedido: propuesta de Claude + pedido guardado como `propuesto`. */
export async function nuevoPedido(deps: DepsPedidos, p: { video: Video; guion: GuionDoc | null; texto: string; actor: Persona }): Promise<{ pedido: PedidoCliente; propuesta: PropuestaNotas }> {
  if (p.actor.rol !== 'aylu' && p.actor.rol !== 'tomas') throw new ErrorPedido('no_permitido', 'los pedidos del cliente los cargan Aylu o Tomás')
  if (!deps.repo.crearPedido) throw new Error('falta crearPedido')
  const propuesta = await proponerNotas({ texto: p.texto, video: p.video, guion: p.guion }, { claude: deps.claude ?? null })
  const pedido = await deps.repo.crearPedido({
    video_id: p.video.id, ronda: decidirRonda(p.video, p.actor).ronda, texto: p.texto.trim().slice(0, LARGO_PEDIDO), propuesta: propuesta.propuesta,
    modelo: propuesta.modelo, version_prompt: propuesta.version, actor: p.actor,
  })
  return { pedido, propuesta }
}

/** Confirmar las notas elegidas (una sola transacción en A). Devuelve los eventos y los avisos del motor para avisarEventos. */
export async function confirmarPedido(deps: DepsPedidos, p: { pedido_id: number; version: number; elegidas: number[]; actor: Persona }): Promise<{ resultado: 'correccion' | 'espera_tomas' | 'nada'; eventos: EventoVideo[]; extra: AvisoMotor[] }> {
  const r = await deps.repo.aplicarPedidoCliente({ pedido_id: p.pedido_id, version: p.version, elegidas: p.elegidas, actor: p.actor })
  if (!r.ok) return fallo(r)
  return { resultado: r.actual.resultado, eventos: r.actual.eventos, extra: r.actual.extra }
}

/** Tomás autoriza la ronda que pasó el tope: el video va a corrección con esas notas (aviso a René por el evento). */
export async function autorizarRonda(deps: DepsPedidos, p: { pedido_id: number; version: number; actor: Persona }): Promise<{ eventos: EventoVideo[] }> {
  if (p.actor.rol !== 'tomas') throw new ErrorPedido('no_permitido', 'la ronda extra la autoriza Tomás')
  const r = await deps.repo.autorizarPedidoCliente(p)
  if (!r.ok) return fallo(r)
  return { eventos: [r.actual.evento] }
}

/** Descartar un pedido (propuesto o esperando a Tomás): si esperaba a Tomás, se saca el bloqueo del tope (lo hace A). */
export async function descartarPedido(deps: DepsPedidos, p: { pedido_id: number; version: number; nota: string; actor: Persona }): Promise<void> {
  const r = await deps.repo.descartarPedidoCliente(p)
  if (!r.ok) fallo(r)
}
