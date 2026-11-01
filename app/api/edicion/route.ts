import { after } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { iniciarTanda } from '@/lib/bot/grabacion/seguimiento'
import { atenderPost, type DepsEdicion } from '@/lib/edicion/acciones'
import { avisarEventos } from '@/lib/edicion/avisos'
import { modoEdicion } from '@/lib/edicion/config'
import { vincularArchivo } from '@/lib/edicion/operativo'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { resolverLectura } from '@/lib/edicion/db/lecturas'
import { confirmarVinculo } from '@/lib/edicion/operativo'
import { guardarMarca } from '@/lib/edicion/operativo'
import { decidirPaso, marcarPaso } from '@/lib/edicion/operativo'
import * as Videos from '@/lib/edicion/operativo'
import { validarFicha } from '@/lib/edicion/marca'
import { ErrorPedido, autorizarRonda, confirmarPedido, descartarPedido, type DepsPedidos } from '@/lib/edicion/pedidos'
import type { ResultadoEscritura } from '@/lib/edicion/tipos'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'

// POST /api/edicion — lo que se toca en la pantalla /edicion (mover videos, notas, tildes, constancias de envío, prioridad,
// bloqueos, "guiones enviados", pasos del seguimiento, pedidos del cliente, ficha de marca y vínculos de carpetas).
// La cubre la regla "/api/edicion/*" de lib/auth/rutas.ts (sesión de Google con la sección Edición), sin acceso por
// máquina. La barrera entera (esa regla repetida por si el proxy no corre, mismo origen, JSON, tamaño) y la decisión están
// en lib/edicion/acciones.ts (probadas en scripts/test-edicion-acciones.mjs); acá solo van las dependencias reales.
// Modo: EDICION_MODO=real escribe; si no (o con ?dry=1), responde lo que haría sin escribir. Los avisos de Discord
// (bloque C) salen en after(), sin demorar la respuesta; si fallan, la acción ya quedó guardada igual.
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const depsPedidos: DepsPedidos = {
  repo: {
    aplicarPedidoCliente: Videos.aplicarPedidoCliente,
    autorizarPedidoCliente: Videos.autorizarPedidoCliente,
    descartarPedidoCliente: Videos.descartarPedidoCliente,
  },
}

/** Los pedidos de C lanzan ErrorPedido: acá vuelven a ser un ResultadoEscritura para la API. */
async function comoResultado<T>(f: () => Promise<T>): Promise<ResultadoEscritura<T>> {
  try {
    return { ok: true, actual: await f() }
  } catch (e) {
    if (e instanceof ErrorPedido) return { ok: false, motivo: e.motivo, actual: null, detalle: e.detalle || undefined }
    throw e
  }
}

function deps(): DepsEdicion {
  return {
    repo: {
      videos: {
        leerVideo: Videos.leerVideo, moverVideo: Videos.moverVideo, actualizarVideo: Videos.actualizarVideo, registrarEnvio: Videos.registrarEnvio,
        crearNota: Videos.crearNota, editarNota: Videos.editarNota, borrarNota: Videos.borrarNota, tildarNota: Videos.tildarNota,
      },
      archivos: { vincularArchivo },
      seguimientos: {
        marcarPaso,
        decidirPaso: async p => {
          const r = await decidirPaso(p)
          return r.ok ? { ok: true, actual: r.actual.paso, eventos: r.actual.eventos } : r
        },
      },
      carpetas: { confirmarVinculo: p => confirmarVinculo({ drive_id: p.drive_id, id_crm: p.id_crm, actor: { tipo: 'persona', ...p.actor } }) },
    },
    motor: { iniciarTanda: async p => { await exigirClienteNoArchivado(p.id_crm); return iniciarTanda(p) } },
    marca: { validarFicha, guardarMarca },
    pedidos: {
      confirmar: p => comoResultado(() => confirmarPedido(depsPedidos, p)),
      autorizar: p => comoResultado(() => autorizarRonda(depsPedidos, p)),
      descartar: p => comoResultado(async () => { await descartarPedido(depsPedidos, p); return {} }),
    },
    lecturas: { resolver: resolverLectura },
    modo: modoEdicion(),
  }
}

export async function POST(req: Request) {
  await asegurarUsuarios()
  return atenderPost(req, {
    exigirAcceso: r => exigirAccesoApi(r, 'edicion'), // 401 sin sesión, 403 sin la sección (segunda barrera, además del proxy)
    sesion: r => sesionDePeticion(r.headers),
    baseLista: baseConfigurada,
    accion: deps(),
    avisar: (eventos, extra) => after(() => avisarEventos(eventos, extra).then(() => undefined)),
  })
}
