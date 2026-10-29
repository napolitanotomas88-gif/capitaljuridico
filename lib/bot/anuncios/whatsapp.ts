// ── Avisos al cliente por WhatsApp (Whapi), etapa Anuncios ──────────────────────────────────────────
// Decisión de Tomás (25/10/2026): los textos para el cliente (campaña al aire, optimización hecha, ganadores elegidos) van
// al grupo «Ventas - <cliente>» de su comunidad («<Nombre> - C.J», lib/bot/alta/motor/comunidad.ts), donde también está
// Valentino. Probar primero con UN cliente.
//   · APAGADO por defecto: solo sale con ANUNCIOS_WHATSAPP=real. Con ANUNCIOS_WHATSAPP_SOLO=<act_…,act_…> sale solo para
//     esas cuentas (la prueba controlada). Sin eso, el texto sigue yendo a Valentino para que lo pegue.
//   · El grupo se busca entre los del número del bot (GET /groups): nombre que empieza con «Ventas» y contiene una palabra
//     del nombre del cliente (de 3 letras o más). Tiene que haber uno solo; si hay cero o varios, no se manda (y a Valentino
//     le llega el texto para pegar, con el motivo). El bot solo está en las comunidades que armó él (clientes nuevos):
//     para los de antes hay que sumar su número al grupo Ventas. Los grupos de antes suelen tener un nombre corto
//     («Ventas - FlorT»): para esos, ANUNCIOS_WHATSAPP_GRUPOS = {"act_…":"…@g.us"} fija el grupo de cada cuenta.
// Nunca imprime el token. Solo servidor.
import { crearClienteWhapi } from '../whapi/cliente'
import { tokenWhapi } from '../whapi/config'

export const whatsappEncendido = (env: NodeJS.ProcessEnv = process.env): boolean => env.ANUNCIOS_WHATSAPP?.trim() === 'real'
/** Cuentas de la prueba controlada (vacío = todas). */
export const cuentasPermitidas = (env: NodeJS.ProcessEnv = process.env): Set<string> =>
  new Set((env.ANUNCIOS_WHATSAPP_SOLO ?? '').split(',').map(s => s.trim()).filter(s => /^act_\d+$/.test(s)))
export const permitidaWhatsApp = (cuenta: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  const solo = cuentasPermitidas(env)
  return whatsappEncendido(env) && (!solo.size || solo.has(cuenta))
}

/** El grupo fijado a mano para la cuenta (ANUNCIOS_WHATSAPP_GRUPOS), o null. */
export function grupoFijado(cuenta: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const m = JSON.parse(env.ANUNCIOS_WHATSAPP_GRUPOS || '{}') as Record<string, unknown>
    const g = m[cuenta]
    return typeof g === 'string' && /^[\d-]+@g\.us$/.test(g) ? g : null
  } catch { return null }
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const IGNORAR = new Set(['estudio', 'juridico', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'dra', 'dr'])

/** El grupo «Ventas - <cliente>» entre los grupos dados. null si no hay uno solo claro. */
export function elegirGrupoVentas(cliente: string, grupos: { id?: string; name?: string }[]): { id: string; nombre: string } | null {
  const palabras = normal(cliente).split(/[^a-zñ]+/).filter(w => w.length >= 3 && !IGNORAR.has(w))
  if (!palabras.length) return null
  const candidatos = grupos.filter(g => g.id && /@g\.us$/.test(g.id) && g.name && /^\s*ventas\b/i.test(g.name)
    && !/^\s*ventas\s*c\.?\s*j\.?\s*$/i.test(g.name)   // «Ventas C.J.» es el grupo interno del equipo
    && palabras.some(w => normal(g.name!).includes(w)))
  return candidatos.length === 1 ? { id: candidatos[0].id!, nombre: candidatos[0].name! } : null
}

export async function gruposDelBot(op: { fetch?: typeof fetch } = {}): Promise<{ id?: string; name?: string }[]> {
  const token = tokenWhapi()
  if (!token) throw new Error('falta WHAPI_TOKEN')
  const r = await (op.fetch ?? fetch)('https://gate.whapi.cloud/groups?count=500', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`Whapi respondió ${r.status} al listar los grupos`)
  const j = (await r.json().catch(() => null)) as { groups?: { id?: string; name?: string }[] } | null
  return j?.groups ?? []
}

export async function enviarAlGrupo(grupoId: string, texto: string): Promise<string | null> {
  const token = tokenWhapi()
  if (!token) throw new Error('falta WHAPI_TOKEN')
  const env = await crearClienteWhapi({ token }).enviarTexto({ chatId: grupoId, texto })
  return env.id ?? null
}
