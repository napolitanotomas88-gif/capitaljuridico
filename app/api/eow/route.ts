import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { atenderGetEow, atenderPostEow, type DepsApiEow } from '@/lib/eow/api'
import { baseEowConfigurada, guardarReporte, historialSemana, leerReporte, listarSemanas, nuevaSemana } from '@/lib/eow/db'

// /api/eow — reporte End of Week (13/11/2026). Regla en lib/auth/rutas.ts ('/api/eow/*': solo los mails de EOW_CORREOS).
//   · GET  ?semana=AAAA-MM-DD → { semanas, reporte, historial } (sin semana: la más nueva)
//   · POST { accion: 'guardar', semana, version, datos } → guarda con control de versión (409 si otro guardó antes)
//   · POST { accion: 'nueva' } → crea la semana nueva copiando la anterior
// La barrera y la decisión están en lib/eow/api.ts (probadas en scripts/test-eow.mjs).
export const dynamic = 'force-dynamic'

const deps: DepsApiEow = {
  exigirAcceso: (r) => exigirAccesoApi(r, null, { correos: 'eow' }),
  sesion: (r) => sesionDePeticion(r.headers),
  mismoOrigen,
  baseConfigurada: baseEowConfigurada,
  hoy: () => hoyArgentina(),
  listarSemanas,
  leerReporte,
  historial: (s) => historialSemana(s),
  guardar: guardarReporte,
  nuevaSemana,
}

export const GET = (req: Request) => atenderGetEow(req, deps)
export const POST = (req: Request) => atenderPostEow(req, deps)
