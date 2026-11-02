// ── Alertas del sistema por Discord: catálogo de canales (2/11/2026). Puro, sin red ──────────────────────────────────────
// Tomás (2/11/2026): el número de WhatsApp del bot no se recuperó y el sistema de alertas pasa a ser 100 % Discord. Cada
// alerta va a UN canal del servidor «Capital Jurídico», por su webhook (nada de bots con token: solo webhooks). La URL de
// cada webhook es un secreto y vive SOLO en variables de entorno (Vercel): nunca en el código, un log, un error o la base.
// Sin la variable de un canal la alerta no se pierde: cae a DISCORD_WEBHOOK_SISTEMA (#🧰-sistema-bot) y, si tampoco está, a
// DISCORD_WEBHOOK_URL (#🚨-alertas-dashboard), con una línea que dice a qué canal iba.
// Tomás (2/11/2026, después del diseño): NO hay canal de Ventas para los closers en Discord. Lo que antes iba a Ventas C.J.
// (datos que faltan del closer, confirmación del pago o de un dato del cliente) va a ✅-verificaciones.
type Entorno = Record<string, string | undefined>

export const CANALES = ['verificaciones', 'finanzas', 'kickoff', 'guiones', 'edicion', 'ads', 'csm', 'operaciones', 'para_enviar', 'sistema'] as const
export type Canal = (typeof CANALES)[number]
export const esCanal = (x: unknown): x is Canal => typeof x === 'string' && (CANALES as readonly string[]).includes(x)

/** Variable (o variables, en orden) de cada canal. Ads acepta el alias viejo DISCORD_WEBHOOK_KICKOFF_ADS. */
export const VARIABLES_CANAL: Record<Canal, readonly string[]> = {
  verificaciones: ['DISCORD_WEBHOOK_VERIFICACIONES'],
  finanzas: ['DISCORD_WEBHOOK_FINANZAS'],
  kickoff: ['DISCORD_WEBHOOK_KICKOFF'],
  guiones: ['DISCORD_WEBHOOK_GUIONES'],
  edicion: ['DISCORD_WEBHOOK_EDICION'],
  ads: ['DISCORD_WEBHOOK_ANUNCIOS', 'DISCORD_WEBHOOK_KICKOFF_ADS'],
  csm: ['DISCORD_WEBHOOK_CLIENTES'],
  operaciones: ['DISCORD_WEBHOOK_OPERACIONES'],
  para_enviar: ['DISCORD_WEBHOOK_PARA_ENVIAR'],
  sistema: ['DISCORD_WEBHOOK_SISTEMA'],
}

/** Nombre visible del canal en Discord (para la línea «iba a …» del respaldo y la documentación). */
export const NOMBRE_CANAL: Record<Canal, string> = {
  verificaciones: '✅-verificaciones', finanzas: '💰-finanzas', kickoff: '📝-kickoff', guiones: '✍️-guiones', edicion: '✂️-edicion',
  ads: '📣-ads', csm: '🤝-exito-y-bajas', operaciones: '🛠️-operaciones', para_enviar: '📤-para-enviar-al-cliente', sistema: '🧰-sistema-bot',
}

const RE_WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,25}\/[\w-]{20,200}$/

/** ¿Tiene forma de webhook de Discord? (no se loguea nunca: solo sí/no). */
export const esWebhook = (x: string | undefined | null): boolean => RE_WEBHOOK.test((x ?? '').trim())

const leer = (env: Entorno, k: string): string | null => { const v = env[k]?.trim(); return v && esWebhook(v) ? v : null }

export interface DestinoWebhook {
  /** La URL (secreta). null = no hay ningún webhook: la alerta queda registrada en la base como «sin_webhook». */
  url: string | null
  /** El canal pedido. */
  canal: Canal
  /** El canal al que efectivamente sale ('sistema' o 'respaldo' si cayó). */
  sale: Canal | 'respaldo'
  /** true si cayó a otro canal por falta de la variable. */
  respaldo: boolean
}

/** El webhook de un canal, con el respaldo: canal → DISCORD_WEBHOOK_SISTEMA → DISCORD_WEBHOOK_URL. */
export function webhookDe(canal: Canal, env: Entorno = process.env): DestinoWebhook {
  for (const k of VARIABLES_CANAL[canal]) { const u = leer(env, k); if (u) return { url: u, canal, sale: canal, respaldo: false } }
  const sistema = leer(env, 'DISCORD_WEBHOOK_SISTEMA')
  if (sistema) return { url: sistema, canal, sale: 'sistema', respaldo: canal !== 'sistema' }
  const general = leer(env, 'DISCORD_WEBHOOK_URL')
  return { url: general, canal, sale: 'respaldo', respaldo: true }
}

/** Para el GET de estado y los docs: qué canal tiene su variable (sí/no; nunca el valor). */
export function estadoCanales(env: Entorno = process.env): Record<Canal, { variable: string; cargada: boolean; respaldo: boolean }> {
  return Object.fromEntries(CANALES.map((c) => {
    const d = webhookDe(c, env)
    return [c, { variable: VARIABLES_CANAL[c][0], cargada: !d.respaldo && !!d.url, respaldo: d.respaldo }]
  })) as Record<Canal, { variable: string; cargada: boolean; respaldo: boolean }>
}
