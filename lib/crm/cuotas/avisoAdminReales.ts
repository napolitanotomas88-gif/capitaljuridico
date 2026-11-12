// Dependencias reales del aviso de cuotas de Administración (Neon + Discord). Solo servidor.
import { alertar, depsAlertasReales } from '@/lib/alertas'
import { insertarMensaje } from '@/lib/bot/canal/registro'
import { listarPlanes } from './db'
import type { DepsAvisoCuotas } from './avisoAdmin'

export function depsAvisoCuotasReales(): DepsAvisoCuotas {
  return {
    ahora: () => new Date(),
    // Solo los de Administración: los de cada closer ni se leen
    planes: async () => (await listarPlanes('admin')).map((r) => r.plan),
    registrar: (m) => insertarMensaje(m),
    alertar: (a) => alertar(a),
    base: depsAlertasReales().base,
  }
}
