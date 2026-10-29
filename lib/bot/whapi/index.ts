// ── Bot "Capital Jurídico": el cliente de Whapi que usa el motor, según el entorno (BLOQUE W) ───────────────────────────
// clienteWhapiDesdeEntorno({ modo, capacidades, grupos }) → SIEMPRE un cliente con la compuerta del modo (compuerta.ts):
//   · seco: la compuerta frena todo; adentro hay un cliente sin red (si algo llegara, tira 'config').
//   · ensayo / real: adentro va el cliente real (cliente.ts) con WHAPI_TOKEN. Sin token, un cliente sin red que tira
//     'config' en cada llamada (nada sale) y lo avisa una vez en el log, por nombre de variable.
// El modo y las capacidades los decide el motor (lib/bot/alta/motor/modo.ts); acá solo se aplican.
import type { Capacidad, ModoMotor } from '@/lib/bot/alta/motor/modo'
import type { ClienteWhapi, ClienteWhapiDesdeEntorno, ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { crearClienteWhapi } from './cliente'
import { aplicarCompuerta, type ClienteConCompuerta } from './compuerta'
import { tokenWhapi } from './config'
import { ErrorWhapi } from './errores'

export { ErrorWhapi, esErrorWhapi } from './errores'
export { PREFIJO_ENSAYO, conPrefijoEnsayo } from './compuerta'

/** Un cliente que nunca sale a la red: cada operación tira ErrorWhapi 'config' con el motivo. */
export function clienteSinRed(motivo: string): ClienteWhapi {
  const falla = async (): Promise<never> => {
    throw new ErrorWhapi('config', `Whapi: ${motivo}`, null, false)
  }
  return {
    modo: 'seco',
    enviarTexto: falla, enviarVideo: falla, descargarMedio: falla, crearComunidad: falla, subgruposComunidad: falla,
    crearGrupoEnComunidad: falla, agregarParticipantes: falla, ponerFoto: falla, cambiarInfoGrupo: falla, linkInvitacion: falla,
    verificarNumeros: falla, agendarContacto: falla, buscarComunidades: falla,
    registro: () => [],
  }
}

let avisoSinToken = false

export function clienteWhapiDesdeEntorno(op: {
  modo: ModoMotor
  capacidades: ReadonlySet<Capacidad>
  grupos: ConfigGrupos
  /** Para los tests. */
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}): ClienteConCompuerta {
  const { modo, capacidades, grupos } = op
  if (modo === 'seco') return aplicarCompuerta(clienteSinRed('modo seco: no sale nada'), { modo, capacidades, grupos })
  const token = tokenWhapi(op.env ?? process.env)
  if (!token) {
    if (!avisoSinToken) {
      avisoSinToken = true
      console.error(`bot-whapi: modo ${modo} sin WHAPI_TOKEN válido — no sale ningún pedido a Whapi`)
    }
    return aplicarCompuerta(clienteSinRed('falta WHAPI_TOKEN o tiene una forma imposible'), { modo, capacidades, grupos })
  }
  return aplicarCompuerta(crearClienteWhapi({ token, fetch: op.fetch }), { modo, capacidades, grupos })
}

// El contrato del día 0 (lib/bot/alta/motor/tipos.ts): esta función tiene que poder usarse donde se pide ClienteWhapiDesdeEntorno.
const _contrato: ClienteWhapiDesdeEntorno = clienteWhapiDesdeEntorno
void _contrato
