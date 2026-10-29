// ── Bot "Capital Jurídico": compuerta del modo sobre cualquier ClienteWhapi (BLOQUE W) ─────────────────────────────────
// Última barrera del modo seco (diseño, sección 6): aunque el orquestador se equivoque, lo que el modo no permite NO SALE.
// Envuelve el cliente real (o el juguete) y decide por operación con `puede()` de lib/bot/alta/motor/modo.ts:
//   · texto a Verificaciones C.J ........ 'reporte_verificaciones' o 'mensajes_equipo'
//   · texto a Ventas C.J. ............... 'mensajes_equipo'
//   · texto a cualquier otro chat ....... 'bienvenida' (lo único que escribe en los grupos del cliente es la bienvenida,
//                                          cuando el texto no entra como pie del video)
//   · video ............................. 'bienvenida'
//   · comunidad, grupos, fotos, participantes, invitaciones, contactos y verificar números ... 'comunidad'
//   · bajar el comprobante .............. modo ensayo o real (es una lectura)
// Lo que no pasa no toca la red: queda en el registro como simulado y vuelve un resultado de mentira con ids "seco-<n>"
// (EnvioWhapi.simulado = true). El cliente real rechaza esos ids, así un id simulado nunca termina en WhatsApp. Bajar el
// comprobante en seco tira ErrorWhapi 'bloqueado' (no hay un archivo de mentira que sirva).
// En ENSAYO cada texto que sale lleva adelante PREFIJO_ENSAYO (revisión 36), para que el equipo no crea que el bot ya cargó
// el alta. Si el texto ya lo trae, no se repite. El eco de ese mensaje (EventoEco.texto) llega CON el prefijo.
// En modo seco igual se controla la forma de un texto (vacío, menciones sin "@<número>"): así un error del orquestador
// aparece en los tests y en el registro, no recién en real.
import { puede, type Capacidad, type ModoMotor } from '@/lib/bot/alta/motor/modo'
import type { ClienteWhapi, ConfigGrupos, EnvioWhapi, GrupoWhapi, LlamadaWhapi } from '@/lib/bot/alta/motor/tipos'
import { URL_INVITACION, describir, faltanMenciones, llamada, type MetodoWhapi } from './comun'
import { ErrorWhapi } from './errores'

export const PREFIJO_ENSAYO = 'SIMULACIÓN — no se cargó nada'

export interface OpcionesCompuerta {
  modo: ModoMotor
  capacidades: ReadonlySet<Capacidad>
  grupos: ConfigGrupos
  ahora?: () => number
}

/** Pone el prefijo de ensayo adelante (una sola vez). */
export const conPrefijoEnsayo = (texto: string): string =>
  texto.trimStart().startsWith(PREFIJO_ENSAYO) ? texto : `${PREFIJO_ENSAYO}\n\n${texto}`

export type ClienteConCompuerta = ClienteWhapi & {
  buscarComunidades(p: { nombre: string; desde: string }): Promise<GrupoWhapi[]>
  /** ¿Esta operación saldría con el modo y las capacidades actuales? (para la pantalla y los tests) */
  permite(metodo: MetodoWhapi, args?: { chatId?: string }): boolean
}

export function aplicarCompuerta(interno: ClienteWhapi, op: OpcionesCompuerta): ClienteConCompuerta {
  const ahora = op.ahora ?? Date.now
  const { modo, capacidades, grupos } = op
  const p = (c: Capacidad) => puede(c, modo, capacidades)
  const propias: LlamadaWhapi[] = []
  let n = 0
  const idSeco = () => `seco-${++n}`

  function permite(metodo: MetodoWhapi, args: { chatId?: string } = {}): boolean {
    switch (metodo) {
      case 'enviarTexto':
        if (args.chatId === grupos.verificaciones) return p('reporte_verificaciones') || p('mensajes_equipo')
        if (args.chatId === grupos.ventas) return p('mensajes_equipo')
        return p('bienvenida')
      case 'enviarVideo':
      case 'subirMedio':
        return p('bienvenida')
      case 'descargarMedio':
        return modo === 'ensayo' || modo === 'real'
      default:
        return p('comunidad')
    }
  }

  /** Registra la operación como simulada (no salió) y devuelve el valor de mentira. */
  const simular = <T>(metodo: MetodoWhapi, args: Record<string, unknown>, valor: () => T): Promise<T> => {
    const d = describir(metodo, args)
    propias.push(llamada(d.verbo, d.ruta, `${d.resumen} [no sale: modo ${modo}]`, true, ahora()))
    return Promise.resolve(valor())
  }
  const envioSeco = (): EnvioWhapi => ({ id: idSeco(), simulado: true })
  const formaDeTexto = (texto: unknown, menciones: readonly string[] = []) => {
    if (typeof texto !== 'string' || !texto.trim()) throw new ErrorWhapi('config', 'Whapi: el texto está vacío', null, false)
    const faltan = faltanMenciones(texto, menciones)
    if (faltan.length) throw new ErrorWhapi('config', `Whapi: el texto no trae "@<número>" de ${faltan.length} mención(es): Whapi lo exige`, null, false)
  }

  return {
    modo: modo === 'seco' ? 'seco' : interno.modo,

    async enviarTexto(a) {
      formaDeTexto(a.texto, a.menciones)
      if (!permite('enviarTexto', a)) return simular('enviarTexto', a, envioSeco)
      return interno.enviarTexto(modo === 'ensayo' ? { ...a, texto: conPrefijoEnsayo(a.texto) } : a)
    },
    async enviarVideo(a) {
      if (!permite('enviarVideo', a)) return simular('enviarVideo', a, envioSeco)
      return interno.enviarVideo(a)
    },
    async descargarMedio(m, o) {
      if (!permite('descargarMedio')) {
        const d = describir('descargarMedio', { id: m?.id, tipo: m?.tipo, mime: m?.mime })
        propias.push(llamada(d.verbo, d.ruta, `${d.resumen} [no sale: modo ${modo}]`, true, ahora()))
        throw new ErrorWhapi('bloqueado', `Whapi: en modo ${modo} no se baja el comprobante`, null, false)
      }
      return interno.descargarMedio(m, o)
    },
    async crearComunidad(a) {
      if (!permite('crearComunidad')) return simular('crearComunidad', a, () => ({ id: idSeco(), nombre: a.nombre, codigoInvitacion: null, creadoEn: new Date(ahora()).toISOString() }))
      return interno.crearComunidad(a)
    },
    async subgruposComunidad(comunidadId) {
      if (!permite('subgruposComunidad')) return simular('subgruposComunidad', { comunidadId }, () => ({ avisos: null, otros: [] }))
      return interno.subgruposComunidad(comunidadId)
    },
    async crearGrupoEnComunidad(a) {
      if (!permite('crearGrupoEnComunidad')) {
        return simular('crearGrupoEnComunidad', a, () => ({ id: idSeco(), nombre: a.nombre, codigoInvitacion: null, agregados: [...a.participantes], fallidos: [] }))
      }
      return interno.crearGrupoEnComunidad(a)
    },
    async agregarParticipantes(a) {
      if (!permite('agregarParticipantes')) return simular('agregarParticipantes', a, () => ({ agregados: [...a.participantes], fallidos: [] }))
      return interno.agregarParticipantes(a)
    },
    async ponerFoto(a) {
      if (!permite('ponerFoto')) return simular('ponerFoto', a, () => undefined)
      return interno.ponerFoto(a)
    },
    async cambiarInfoGrupo(a) {
      if (!permite('cambiarInfoGrupo')) return simular('cambiarInfoGrupo', a, () => undefined)
      return interno.cambiarInfoGrupo(a)
    },
    async linkInvitacion(grupoId) {
      if (!permite('linkInvitacion')) return simular('linkInvitacion', { grupoId }, () => `${URL_INVITACION}simulado-${++n}`)
      return interno.linkInvitacion(grupoId)
    },
    async verificarNumeros(numeros) {
      if (!permite('verificarNumeros')) return simular('verificarNumeros', { numeros }, () => Object.fromEntries(numeros.map((x) => [x, 'valido'] as const)))
      return interno.verificarNumeros(numeros)
    },
    async agendarContacto(a) {
      if (!permite('agendarContacto')) return simular('agendarContacto', a, () => undefined)
      return interno.agendarContacto(a)
    },
    async buscarComunidades(a) {
      if (!permite('buscarComunidades')) return simular('buscarComunidades', a, (): GrupoWhapi[] => [])
      if (!interno.buscarComunidades) throw new ErrorWhapi('config', 'Whapi: este cliente no sabe buscar comunidades', null, false)
      return interno.buscarComunidades(a)
    },
    registro: () => [...interno.registro(), ...propias].sort((x, y) => (x.en < y.en ? -1 : x.en > y.en ? 1 : 0)),
    permite,
  }
}
