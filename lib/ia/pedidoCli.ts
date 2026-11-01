// ── Puente de Claude a la Mac: el cuerpo de un pedido de la API → los argumentos de `claude -p` (lo usa scripts/ia-mac.mjs)
// Puro salvo por `escribir` (los adjuntos van a archivos que Claude lee con Read). Ver lib/ia/puenteMac.ts.
import { join } from 'node:path'

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' }

export interface PedidoCliMac { sistema: string; usuario: string; herramientas: string[]; schema: Record<string, unknown> | null; modelo: string; esfuerzo: string; archivos: string[] }

type Bloque = { type?: string; text?: string; source?: { type?: string; media_type?: string; data?: string } } & Record<string, unknown>
const textoDe = (x: unknown): string => typeof x === 'string' ? x : Array.isArray(x) ? (x as Bloque[]).filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n\n') : ''

export function armarPedido(cuerpo: Record<string, unknown>, carpeta: string, escribir: (ruta: string, datos: Buffer) => void): PedidoCliMac {
  const archivos: string[] = []
  const partes: string[] = []
  const mensajes = Array.isArray(cuerpo.messages) ? (cuerpo.messages as { role?: string; content?: unknown }[]) : []
  for (const m of mensajes) {
    const bloques: Bloque[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? (m.content as Bloque[]) : []
    const trozos: string[] = []
    for (const b of bloques) {
      if (b?.type === 'text') trozos.push(String(b.text ?? ''))
      else if ((b?.type === 'image' || b?.type === 'document') && b.source?.type === 'base64' && typeof b.source.data === 'string') {
        const ruta = join(carpeta, `adjunto-${archivos.length + 1}.${EXT[b.source.media_type ?? ''] ?? 'bin'}`)
        escribir(ruta, Buffer.from(b.source.data, 'base64'))
        archivos.push(ruta)
        trozos.push(`[Archivo adjunto: ${ruta} — leelo con la herramienta Read antes de responder]`)
      } else if (b?.type === 'tool_result' || b?.type === 'tool_use') trozos.push(`[${b.type}] ${JSON.stringify(b).slice(0, 4000)}`)
    }
    const texto = trozos.join('\n\n')
    partes.push(mensajes.length > 1 ? `<turno rol="${m.role ?? 'user'}">\n${texto}\n</turno>` : texto)
  }
  const tipos = (Array.isArray(cuerpo.tools) ? (cuerpo.tools as Record<string, unknown>[]) : []).map((t) => String(t?.type ?? t?.name ?? ''))
  const herramientas = [
    ...(archivos.length ? ['Read'] : []),
    ...(tipos.some((t) => /web_search/.test(t)) ? ['WebSearch'] : []),
    ...(tipos.some((t) => /web_fetch/.test(t)) ? ['WebFetch'] : []),
  ]
  const oc = (cuerpo.output_config ?? {}) as { effort?: unknown; format?: { schema?: Record<string, unknown> } }
  const schema = oc.format?.schema ?? (cuerpo.output_format as { schema?: Record<string, unknown> } | undefined)?.schema ?? null
  return {
    sistema: textoDe(cuerpo.system), usuario: partes.join('\n\n'), herramientas, schema, archivos,
    modelo: typeof cuerpo.model === 'string' ? cuerpo.model : 'claude-opus-5-5',
    esfuerzo: typeof oc.effort === 'string' ? oc.effort : 'medium',
  }
}
