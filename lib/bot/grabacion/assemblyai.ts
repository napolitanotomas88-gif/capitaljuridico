// ── Cliente de AssemblyAI (transcripción de los crudos) ─────────────────────────────────────────────────────────────
// P5 (Tomás, 24/10): Universal, idioma es, palabras clave de la ficha del kickoff, NUNCA el guion como contexto (lo induce a
// "oír" frases que no se dijeron), por link de descarga de Drive y con webhook. La transcripción se borra del lado de
// AssemblyAI apenas se guarda en Neon (transcripcion.ts).
//   · POST {ASSEMBLYAI_BASE}/v2/transcript con audio_url (drive.usercontent…&confirm=t), language_code 'es',
//     `speech_models` (lista, en orden de preferencia: ASSEMBLYAI_MODELO separado por comas; por defecto universal-3-5-pro y
//     universal-2 de respaldo; `speech_model` en singular está deprecado), keyterms_prompt y el webhook con su cabecera
//     secreta (X-Edicion-Secreto). Nunca `prompt` ni el guion. El modelo que corrió se lee de `speech_model_used`.
//   · Si AssemblyAI rechaza el modelo (400 que nombra speech_model), se reenvía UNA vez sin modelos (corre su modelo por
//     defecto) en lugar de marcar error todos los crudos; queda anotado en el motivo.
//   · La key va SOLO en la cabecera Authorization; ningún mensaje la incluye (ni la URL del audio).
//   · Cada pedido corta a los 15 s; un 429 o un 5xx es transitorio y se reintenta una vez.
// PENDIENTE AL TENER LA KEY: confirmar con un pedido real los identificadores (universal-3-5-pro / universal-2), el campo de
// las palabras clave (keyterms_prompt) para español y si AssemblyAI reintenta el webhook.
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'

export const BASE_POR_DEFECTO = 'https://api.assemblyai.com'
export const MODELOS_POR_DEFECTO = ['universal-3-5-pro', 'universal-2'] as const
/** ASSEMBLYAI_MODELO: uno o varios identificadores separados por comas (en orden de preferencia). */
export function modelosConfigurados(env: Record<string, string | undefined>): string[] {
  const xs = (env.ASSEMBLYAI_MODELO ?? '').split(',').map(x => x.trim()).filter(x => /^[a-z0-9][a-z0-9._-]{1,60}$/i.test(x))
  return xs.length ? [...new Set(xs)] : [...MODELOS_POR_DEFECTO]
}
export const CABECERA_WEBHOOK = 'X-Edicion-Secreto'
const TOPE_PEDIDO_MS = 15_000

export type EstadoProveedor = 'queued' | 'processing' | 'completed' | 'error'
export interface TranscripcionProveedor {
  id: string; estado: EstadoProveedor; error: string | null
  texto: string; palabras: [number, number, string][]; duracion_ms: number | null; idioma: string | null; modelo: string
}
export interface Transcriptor {
  enviar(p: { audioUrl: string; palabrasClave: string[]; webhookUrl: string; secreto: string }): Promise<{ id: string; aviso?: string }>
  traer(id: string): Promise<TranscripcionProveedor>
  borrar(id: string): Promise<void>
  /** Las transcripciones de la cuenta creadas desde `desde` (barrido diario de las que quedaron del lado de AssemblyAI). */
  listar?(desde: string): Promise<{ id: string; estado: EstadoProveedor; creado: string }[]>
}

/** Error de AssemblyAI. `palabras_clave`: rechazó las palabras clave (se reenvía una vez sin ellas). */
export class ErrorAssembly extends Error {
  readonly status: number
  readonly codigo: 'palabras_clave' | 'modelo' | 'descarga' | 'otro'
  constructor(mensaje: string, status: number, codigo: ErrorAssembly['codigo'] = 'otro') {
    super(mensaje)
    this.name = 'ErrorAssembly'
    this.status = status
    this.codigo = codigo
  }
}

/** El link de descarga directa de un archivo de Drive (las carpetas de los clientes están "cualquiera con el enlace"). */
export const urlDescargaDrive = (driveId: string): string =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`

const limpiar = (s: string): string => s.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 160)

/** ¿El error del proveedor es porque no pudo bajar el archivo? (link privado, borrado o sin permiso: plan B). */
export const esFallaDescarga = (error: string | null | undefined): boolean =>
  !!error && /download|descarg|could not (?:retrieve|fetch|access)|unable to (?:access|download|fetch)|forbidden|not found|404|403|html|access denied/i.test(error)

const ID_VALIDO = /^[A-Za-z0-9_-]{6,80}$/

export function transcriptorReal(env: Record<string, string | undefined> = process.env, f: typeof fetch = (...a) => fetch(...a)): Transcriptor | null {
  const key = env.ASSEMBLYAI_API_KEY?.trim()
  if (!key) return null
  let base = BASE_POR_DEFECTO
  try { const u = new URL(env.ASSEMBLYAI_BASE?.trim() || BASE_POR_DEFECTO); if (u.protocol === 'https:') base = u.origin } catch { /* el de siempre */ }
  const modelos = modelosConfigurados(env)

  async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    for (let intento = 0; ; intento++) {
      let r: Response
      try {
        r = await f(`${base}${ruta}`, {
          method: metodo, headers: { Authorization: key!, 'Content-Type': 'application/json' },
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(TOPE_PEDIDO_MS), cache: 'no-store',
        })
      } catch (e) {
        if (intento === 0) continue
        throw new ErrorTransitorio(`AssemblyAI no respondió (${limpiar((e as Error)?.name ?? 'error de red')})`)
      }
      if (r.status === 429 || r.status >= 500) {
        if (intento === 0) continue
        throw new ErrorTransitorio(`AssemblyAI respondió ${r.status}`)
      }
      const texto = await r.text()
      let j: Record<string, unknown> = {}
      try { j = texto ? JSON.parse(texto) as Record<string, unknown> : {} } catch { /* cuerpo no JSON */ }
      if (!r.ok) {
        const detalle = typeof j.error === 'string' ? limpiar(j.error) : ''
        const codigo = /keyterm|key term|word.?boost|keyterms_prompt/i.test(detalle) ? 'palabras_clave' : /speech.?model/i.test(detalle) ? 'modelo' : 'otro'
        throw new ErrorAssembly(`AssemblyAI respondió ${r.status}${detalle ? `: ${detalle}` : ''}`, r.status, codigo)
      }
      return j as T
    }
  }

  const aPalabras = (ws: unknown): [number, number, string][] => (Array.isArray(ws) ? ws : [])
    .map(w => w as { start?: unknown; end?: unknown; text?: unknown })
    .filter(w => typeof w.text === 'string' && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
    .map(w => [Number(w.start), Number(w.end), String(w.text)] as [number, number, string])

  return {
    async enviar(p) {
      const cuerpo: Record<string, unknown> = {
        audio_url: p.audioUrl, language_code: 'es', speech_models: modelos,
        webhook_url: p.webhookUrl, webhook_auth_header_name: CABECERA_WEBHOOK, webhook_auth_header_value: p.secreto,
      }
      if (p.palabrasClave.length) cuerpo.keyterms_prompt = p.palabrasClave
      let r: { id?: unknown }
      let sinModelo = false
      try {
        r = await pedir<{ id?: unknown }>('POST', '/v2/transcript', cuerpo)
      } catch (e) {
        // El identificador del modelo no lo acepta (cambió de nombre): una vez sin modelos, con el de AssemblyAI por defecto
        if (!(e instanceof ErrorAssembly && e.status === 400 && e.codigo === 'modelo')) throw e
        const resto: Record<string, unknown> = { ...cuerpo }
        delete resto.speech_models
        r = await pedir<{ id?: unknown }>('POST', '/v2/transcript', resto)
        sinModelo = true
      }
      if (typeof r.id !== 'string' || !ID_VALIDO.test(r.id)) throw new ErrorAssembly('AssemblyAI no devolvió un id', 502)
      return { id: r.id, ...(sinModelo ? { aviso: `AssemblyAI rechazó el modelo (${modelos.join(', ')}): corrió con el suyo por defecto` } : {}) }
    },
    async traer(id) {
      if (!ID_VALIDO.test(id)) throw new ErrorAssembly('id de transcripción inválido', 400)
      const r = await pedir<Record<string, unknown>>('GET', `/v2/transcript/${id}`)
      const estado = (['queued', 'processing', 'completed', 'error'].includes(String(r.status)) ? r.status : 'processing') as EstadoProveedor
      const seg = Number(r.audio_duration)
      return {
        id, estado, error: typeof r.error === 'string' ? limpiar(r.error) : null,
        texto: typeof r.text === 'string' ? r.text : '', palabras: aPalabras(r.words),
        duracion_ms: Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1000) : null,
        idioma: typeof r.language_code === 'string' ? r.language_code : null,
        modelo: typeof r.speech_model_used === 'string' ? r.speech_model_used : typeof r.speech_model === 'string' ? r.speech_model : modelos[0],
      }
    },
    async borrar(id) {
      if (!ID_VALIDO.test(id)) throw new ErrorAssembly('id de transcripción inválido', 400)
      try {
        await pedir('DELETE', `/v2/transcript/${id}`)
      } catch (e) {
        if (e instanceof ErrorAssembly && e.status === 404) return      // ya no está
        throw e
      }
    },
    async listar(desde) {
      const out: { id: string; estado: EstadoProveedor; creado: string }[] = []
      const t = Date.parse(desde)
      for (let d = new Date(Number.isFinite(t) ? t : Date.now()); d.getTime() <= Date.now() + 86_400_000; d = new Date(d.getTime() + 86_400_000)) {
        const dia = d.toISOString().slice(0, 10)
        const r = await pedir<{ transcripts?: { id?: unknown; status?: unknown; created?: unknown }[] }>('GET', `/v2/transcript?limit=200&created_on=${dia}`)
        for (const x of r.transcripts ?? []) {
          if (typeof x.id === 'string' && ID_VALIDO.test(x.id)) out.push({ id: x.id, estado: String(x.status) as EstadoProveedor, creado: String(x.created ?? '') })
        }
      }
      return out
    },
  }
}
