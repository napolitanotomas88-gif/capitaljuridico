// ── Bot "Capital Jurídico": aviso a Discord de un pedido que se responde en el Despacho (26/10/2026) ───────────────────
// Cuando el motor pide un OK o un dato y WhatsApp no está disponible (la guardia de salud lo frenó) o el canal es 'despacho'
// (BOT_ALTA_CANAL), sale UN aviso por espera con el link directo a /clientes/altas?alta=<alta>#espera-<id>.
//   · Canal: DISCORD_WEBHOOK_VERIFICACIONES si existe; si no, DISCORD_WEBHOOK_URL (#alertas-dashboard).
//   · Canal #✅-verificaciones (DISCORD_WEBHOOK_VERIFICACIONES, creado el 26/10/2026).
//   · Menciona a los cuatro aprobadores (IDS_APROBADORES_DISCORD, o BOT_ALTA_APROBADORES_DISCORD). Dice qué falta y lleva el link.
// El texto es puro (se prueba sin red); el envío usa enviarDiscord de lib/fathomAnuncios/discord.ts (en servidor.ts).
import { idDiscord } from '../../../fathomAnuncios/discord'
import type { Espera, FilaAlta } from '../motor/almacen'
import { closerDeFila } from './aprobadores'

export function webhookAvisos(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DISCORD_WEBHOOK_VERIFICACIONES?.trim() || env.DISCORD_WEBHOOK_URL?.trim() || null
}

/** Los cuatro aprobadores (Tomás, 26/10/2026): Tomás, Gero A, Aylu y Gero M. Fijos por defecto; BOT_ALTA_APROBADORES_DISCORD
 *  (ids separados por coma) los reemplaza. Los closers no van al canal: los "falta un dato" también se avisan acá y el
 *  equipo se lo consulta al closer. */
export const IDS_APROBADORES_DISCORD: readonly string[] = []

export function mencionesDe(_quien: Espera['quien'], env: NodeJS.ProcessEnv = process.env): string[] {
  const propios = (env.BOT_ALTA_APROBADORES_DISCORD ?? '').split(/[,;\s]+/).map((x) => idDiscord(x)).filter((x): x is string => !!x)
  return [...new Set(propios.length ? propios : IDS_APROBADORES_DISCORD)]
}

/** Link directo a la espera en el Despacho. */
export const linkEspera = (base: string, altaId: string, esperaId: string) =>
  `${base.replace(/\/+$/, '')}/clientes/altas?alta=${encodeURIComponent(altaId)}#espera-${encodeURIComponent(esperaId)}`

const recortar = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

export function textoAvisoEspera(p: { alta: Pick<FilaAlta, 'id' | 'nombreCliente' | 'textoVigente' | 'autor' | 'validacion'>; espera: Pick<Espera, 'id' | 'quien' | 'pedido'>; motivo: 'despacho' | 'sin_whatsapp'; base: string; menciones: string[] }): string {
  const nombre = p.alta.validacion?.nombreConfirmado ?? p.alta.nombreCliente ?? 'un cliente'
  const closer = closerDeFila(p.alta)
  const que = p.espera.quien === 'closer' ? 'faltan datos del closer' : 'hace falta un OK de Verificaciones'
  const pedido = p.espera.pedido.slice(0, 6).map((x) => `• ${recortar(String(x).replace(/\s+/g, ' '), 200)}`)
  return [
    `${p.menciones.map((m) => `<@${m}>`).join(' ')} **Alta de ${nombre}**${closer ? ` (closer ${closer})` : ''}: ${que}.`,
    ...pedido,
    `Respondelo en el Despacho: ${linkEspera(p.base, p.alta.id, p.espera.id)}`,
    p.motivo === 'despacho' ? '_(Los pedidos van por el Despacho: BOT_ALTA_CANAL=despacho.)_' : '_(El WhatsApp del bot no está disponible: el pedido no salió por Verificaciones ni por Ventas.)_',
  ].join('\n')
}
