// ── Quién puede llamar a las rutas propias del bot de grabación (puro: lo prueban los tests) ───────────────────────
// Fallan cerrado y van SIEMPRE por cabecera (nunca ?key=, queda en los logs):
//   · vigía: `Authorization: Bearer <VIGIA_SECRETO>` (el Puente Drive, cada 15 minutos) o `Bearer <CRON_SECRET>` (a mano).
//     VIGIA_SECRETO de menos de MIN_SECRETO caracteres cuenta como mal configurado (no autentica). Sin ninguno usable → 503.
//     El puente NO usa CRON_SECRET a propósito: ese secreto abre /api/raw (que tiene teléfonos).
//   · diario: el cron de Vercel manda `Bearer <CRON_SECRET>`. A CRON_SECRET no se le exige largo (lo usan otros 11 crons y
//     accesoMaquina solo pide que no esté vacío).
//   · webhook de transcripción: cabecera X-Edicion-Secreto (ASSEMBLYAI_WEBHOOK_SECRETO, 32+), en transcripcion.ts.
// Las comparaciones van en tiempo constante (igualesSeguro compara hashes: el largo no filtra nada).
import { igualesSeguro } from '@/lib/auth/cookie'
import { MIN_SECRETO } from '@/lib/edicion/config'

type Cabeceras = { get(nombre: string): string | null }
type Entorno = Record<string, string | undefined>

export function bearer(h: Cabeceras): string | null {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(h.get('authorization') ?? '')
  return m ? m[1] : null
}

export const vigiaConfigurado = (env: Entorno): boolean => (env.VIGIA_SECRETO?.trim().length ?? 0) >= MIN_SECRETO
export const cronConfigurado = (env: Entorno): boolean => (env.CRON_SECRET?.trim().length ?? 0) > 0

export type Autorizacion = { ok: true; origen: 'puente' | 'manual' } | { ok: false; status: 401 | 503 }

export function autorizarVigia(h: Cabeceras, env: Entorno): Autorizacion {
  const vigia = vigiaConfigurado(env) ? env.VIGIA_SECRETO!.trim() : null
  const cron = cronConfigurado(env) ? env.CRON_SECRET!.trim() : null
  if (!vigia && !cron) return { ok: false, status: 503 }
  const t = bearer(h)
  if (!t) return { ok: false, status: 401 }
  const esVigia = vigia ? igualesSeguro(t, vigia) : false
  const esCron = cron ? igualesSeguro(t, cron) : false
  if (esVigia) return { ok: true, origen: 'puente' }
  if (esCron) return { ok: true, origen: 'manual' }
  return { ok: false, status: 401 }
}

export function autorizarCron(h: Cabeceras, env: Entorno): Autorizacion {
  if (!cronConfigurado(env)) return { ok: false, status: 503 }
  const t = bearer(h)
  if (!t || !igualesSeguro(t, env.CRON_SECRET!.trim())) return { ok: false, status: 401 }
  return { ok: true, origen: 'manual' }
}

/** Qué variables están (nunca el valor): para el GET de estado. */
export function estadoVariables(env: Entorno): Record<string, boolean | string> {
  const hay = (k: string) => !!env[k]?.trim()
  return {
    EDICION_MODO: env.EDICION_MODO?.trim().toLowerCase() === 'real' ? 'real' : 'dry',
    EDICION_AVISOS: env.EDICION_AVISOS?.trim().toLowerCase() === 'dry' ? 'dry' : 'normal',
    EDICION_WHATSAPP: env.EDICION_WHATSAPP?.trim() === 'real' ? 'real' : 'apagado',
    EDICION_WHATSAPP_DESDE: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(env.EDICION_WHATSAPP_DESDE?.trim() ?? '') ? env.EDICION_WHATSAPP_DESDE!.trim() : false,
    E01_WHATSAPP: env.E01_WHATSAPP?.trim() === 'real' ? 'real' : 'apagado',
    E01_WHATSAPP_DESDE: /^\d{4}-\d{2}-\d{2}$/.test(env.E01_WHATSAPP_DESDE?.trim() ?? '') ? env.E01_WHATSAPP_DESDE!.trim() : false,
    DATABASE_URL: hay('DATABASE_URL'),
    VIGIA_SECRETO: vigiaConfigurado(env),
    CRON_SECRET: cronConfigurado(env),
    ASSEMBLYAI_API_KEY: hay('ASSEMBLYAI_API_KEY'),
    ASSEMBLYAI_WEBHOOK_SECRETO: (env.ASSEMBLYAI_WEBHOOK_SECRETO?.trim().length ?? 0) >= MIN_SECRETO,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: hay('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    GOOGLE_PRIVATE_KEY: hay('GOOGLE_PRIVATE_KEY'),
    EDICION_EQUIPO_DRIVE: hay('EDICION_EQUIPO_DRIVE'),
    EDICION_FECHA_CORTE: /^\d{4}-\d{2}-\d{2}$/.test(env.EDICION_FECHA_CORTE?.trim() ?? '') ? env.EDICION_FECHA_CORTE!.trim() : false,
    DISCORD_WEBHOOK_EDICION: hay('DISCORD_WEBHOOK_EDICION'),
    CLAUDE: hay('BOT_ANTHROPIC_API_KEY') || hay('ANTHROPIC_API_KEY'),
  }
}
