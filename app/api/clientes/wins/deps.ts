import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { cargarVista } from '@/lib/clientes/vista'
import type { DepsApiWins } from '@/lib/clientes/wins/api'
import { baseWinsConfigurada, borrarWin, crearWin, leerCaptura, listarWins } from '@/lib/clientes/wins/db'

// Dependencias reales de /api/clientes/wins (la lógica y sus pruebas están en lib/clientes/wins/api.ts).
export const depsWins: DepsApiWins = {
  exigirAcceso: (req) => exigirAccesoApi(req, 'clientes'),
  sesion: (req) => sesionDePeticion(req.headers),
  puedeEscribir: (email) => puedeHacerAcciones(email),
  mismoOrigen,
  baseConfigurada: baseWinsConfigurada,
  hoy: () => hoyArgentina(),
  clienteExiste: async (idCrm) => {
    try {
      const { datos } = await cargarVista(false, 'omitir', true)
      return datos.clientes.some((c) => c.linea === 'agencia' && c.id.toUpperCase() === idCrm.toUpperCase())
    } catch {
      return null
    }
  },
  listar: listarWins,
  crear: crearWin,
  borrar: borrarWin,
  captura: leerCaptura,
}
