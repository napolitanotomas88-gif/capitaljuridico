// ── EOW: dependencias reales del cron de recién lanzados (Neon, tablero de Meta y Discord). SOLO servidor ────────────────
import { enviarWebhook } from '@/lib/alertas/alerta'
import { esWebhook } from '@/lib/alertas/canales'
import { resolverMenciones } from '@/lib/alertas/personas'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { urlDespacho } from '@/lib/edicion/avisos/entorno'
import { agregarRecienLanzados, cerrarAviso, leerReporte, reporteAnterior, reservarAviso } from './db'
import { agregarFilas, type ClienteLanzado, type DepsAvisoEow } from './lanzados'
import { sumarDias } from './modelo'

type Entorno = Record<string, string | undefined>

/** Webhook del aviso: #📊-reporte-eow (DISCORD_WEBHOOK_EOW) y, si falta, 🛠️-operaciones. null = ninguno. */
export function webhookEow(env: Entorno = process.env): string | null {
  for (const k of ['DISCORD_WEBHOOK_EOW', 'DISCORD_WEBHOOK_OPERACIONES']) {
    const v = env[k]?.trim()
    if (v && esWebhook(v)) return v
  }
  return null
}

export const avisoEowEncendido = (env: Entorno = process.env): boolean => (env.EOW_AVISO ?? '').trim().toLowerCase() === 'encendido'

/**
 * Clientes con su PRIMER lanzamiento conocido en Meta (misma regla que campanasMeta en lib/clientes/produccion.ts, que alimenta
 * el hito «Campaña lanzada» y la etapa «Lanzado» de la cartera), con el ID del CRM cuando el tablero lo cruzó.
 */
async function lanzadosDeMeta(esperaMs = 45_000): Promise<ClienteLanzado[] | null> {
  try {
    const { obtenerTablero } = await import('@/lib/anuncios/tablero')
    const tablero = await Promise.race([obtenerTablero(), new Promise<null>((r) => setTimeout(() => r(null), esperaMs))])
    if (!tablero || tablero.filas.length === 0) return null
    const hoy = hoyArgentina()
    const porCliente = new Map<string, ClienteLanzado>()
    for (const f of tablero.filas) {
      const nombre = (f.clienteCRM || f.cliente || '').trim()
      if (!nombre) continue
      const activa = !f.pausado && f.gasto.d7 > 0 && !f.corriendo.sinAnunciosActivos
      const corriendoDesde = activa && f.corriendo.dias > 0 ? sumarDias(hoy, -f.corriendo.dias) : null
      const fechas = [...f.lanzamientos.map((l) => l.fecha).filter(Boolean), corriendoDesde].filter((x): x is string => !!x)
      if (!fechas.length) continue
      const primero = fechas.sort()[0]
      const k = f.idCrm?.toUpperCase() || nombre.toLowerCase()
      const previo = porCliente.get(k)
      if (!previo || primero < previo.lanzado) porCliente.set(k, { nombre, idCrm: f.idCrm?.toUpperCase() ?? null, lanzado: primero })
    }
    return [...porCliente.values()]
  } catch (e) {
    console.error(`[eow] Meta: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)}`)
    return null
  }
}

export function depsAvisoEowReales(env: Entorno = process.env): DepsAvisoEow {
  return {
    hoy: () => hoyArgentina(),
    encendido: avisoEowEncendido(env),
    base: urlDespacho(env),
    lanzados: () => lanzadosDeMeta(),
    semanaAnterior: async (semana) => (await reporteAnterior(semana))?.semana ?? null,
    leer: async (semana) => leerReporte(semana),
    agregar: (semana, nuevos) => agregarRecienLanzados(semana, (datos) => agregarFilas(datos, nuevos), 'Sistema (recién lanzados)'),
    reservarAviso,
    cerrarAviso,
    async enviar(texto) {
      const url = webhookEow(env)
      if (!url) return 'sin_webhook'
      // Solo Gero M (pedido de Tomás, 13/11/2026). Sin su ID, va el nombre en texto (sin notificar).
      const m = resolverMenciones(['gero_m'], env)
      try {
        await enviarWebhook(url, m.texto ? `${m.texto} ${texto}` : texto, m.ids, 4)
        return 'enviado'
      } catch (e) {
        console.error(`[eow] Discord: ${String((e as Error)?.name ?? 'error').slice(0, 40)}`)
        return 'error'
      }
    },
  }
}
