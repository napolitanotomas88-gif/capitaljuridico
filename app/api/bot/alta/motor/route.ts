import { after } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { almacenEnMemoria } from '@/lib/bot/alta/motor/almacen'
import { almacenNeon, baseConfigurada } from '@/lib/bot/alta/motor/almacenNeon'
import { capacidadesReales, modoDesdeEntorno } from '@/lib/bot/alta/motor/modo'
import { crearOrquestador } from '@/lib/bot/alta/motor/orquestador'
import { atenderMotor, estadoMotor } from '@/lib/bot/alta/motor/rutaMotor'
import { depsPasosServidor, depsServidor, dispararMotor } from '@/lib/bot/alta/motor/servidor'
import type { ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { clienteWhapiDesdeEntorno } from '@/lib/bot/whapi'
import { configWebhook } from '@/lib/bot/whapi/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Motor del bot de altas "Capital Jurídico": continuaciones, despertador, barrido, reintento manual, respuestas manuales y
// simulación. Detalle en lib/bot/alta/motor/rutaMotor.ts (probada sin Next en scripts/test-bot-orquestador.mjs). Solo con
// "Authorization: Bearer <CRON_SECRET>" (tiempo constante, lib/auth/acceso.ts; nunca ?key=). Falla cerrado.
// Sin la configuración explícita del modo real (BOT_ALTA_MODO y BOT_ALTA_PASOS_REALES) todo corre en SECO.
const SIN_GRUPOS: ConfigGrupos = { ventas: 'sin-configurar@g.us', verificaciones: 'sin-configurar-2@g.us' }

function motorReal() {
  const modo = modoDesdeEntorno()
  const capacidades = capacidadesReales(modo)
  const cfg = configWebhook()
  // Sin los grupos válidos, el motor corre igual pero en seco (no puede mandar nada a ningún lado)
  const grupos = cfg.ok ? cfg.config.grupos : SIN_GRUPOS
  const efectivo = cfg.ok ? modo : 'seco'
  const caps = cfg.ok ? capacidades : new Set<never>()
  const whapi = clienteWhapiDesdeEntorno({ modo: efectivo, capacidades: caps, grupos })
  return crearOrquestador(depsServidor({ whapi, modo: efectivo, capacidades: caps, grupos }))
}

function motorSimulacion() {
  const almacen = almacenEnMemoria()
  const grupos = SIN_GRUPOS
  const whapi = clienteWhapiDesdeEntorno({ modo: 'seco', capacidades: new Set(), grupos })
  const motor = crearOrquestador({
    whapi, modo: 'seco', capacidades: new Set(), grupos, almacen, pasos: depsPasosServidor({ modo: 'seco' }), entorno: 'simulacion', produccion: false,
  })
  return { motor, almacen }
}

const deps = () => ({
  autorizado: (r: Request) => accesoMaquina(r.headers),
  baseConfigurada,
  motor: motorReal,
  almacen: almacenNeon,
  motorSimulacion,
  modoEntorno: modoDesdeEntorno(),
  enSegundoPlano: (fn: () => Promise<void>) => after(fn),
  dispararMotor: (cuerpo: Record<string, unknown>) => dispararMotor(cuerpo),
  despertador: process.env.BOT_ALTA_DESPERTADOR?.trim() !== '0',
  dormir: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ahora: () => Date.now(),
})

export async function POST(req: Request) {
  return atenderMotor(req, deps())
}

export async function GET(req: Request) {
  return estadoMotor(req, deps())
}
