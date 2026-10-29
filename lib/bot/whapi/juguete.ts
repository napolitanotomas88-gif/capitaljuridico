// ── Bot "Capital Jurídico": cliente de Whapi DE JUGUETE (BLOQUE W) ───────────────────────────────────────────────────────
// Para los tests del orquestador (BLOQUE O) y del webhook: implementa ClienteWhapi SIN RED. Guarda en memoria lo que
// "hizo" (mensajes, comunidades, grupos, contactos), registra cada llamada y da ids "jg-…" (el cliente real los rechaza,
// así un id de juguete nunca llega a WhatsApp).
//   · Fallas programables por método: { status: 401 | 402 | 403 | 404 | 409 | 429 | 500 | 524 | … } o { red: 'red' | 'corte' }.
//     Se traducen igual que en el cliente real (errores.ts): en una escritura un 5xx, un 524 o un corte es 'dudoso'
//     (aplicado: null); en una lectura, 'pasajero'. Con `aplicar: true` la operación SE HACE igual antes de fallar (el caso
//     real del dudoso: WhatsApp lo hizo y la respuesta se perdió), así se puede probar buscarComunidades o el eco.
//   · El juguete NO reintenta (el cliente real reintenta una vez las lecturas): cada falla programada sale tal cual.
//   · `generalAutomatico`: crearComunidad también crea el grupo "General" (general_chat: true), como WhatsApp (revisión 4).
//   · `sinIdEnEnvios`: enviarTexto / enviarVideo devuelven id: null (SentMessage sin `message`, revisión 6). El eco (ecos())
//     sí trae el id, como el webhook real.
//   · Las menciones exigen "@<número>" en el texto, igual que el cliente real (si falta, error 'config').
//   · Un id "seco-…" (de la compuerta en modo seco) se rechaza con 'config': no debería llegar a un cliente que "hace" cosas.
import { createHash } from 'node:crypto'
import type {
  ClienteWhapi, ConfigGrupos, EnvioWhapi, EventoEco, FotoGrupo, GrupoWhapi, LlamadaWhapi, MedioDescargado, RefMedio,
  ResultadoParticipantes,
} from '@/lib/bot/alta/motor/tipos'
import { ErrorWhapi, errorDeRed, errorPorStatus } from './errores'
import { ESCRITURAS, PATRON_MENCION, URL_INVITACION, describir, faltanMenciones, llamada, type MetodoWhapi } from './comun'

export type { MetodoWhapi } from './comun'

export interface FallaJuguete {
  /** HTTP que "devuelve" Whapi: 400, 401, 402, 403, 404, 409, 413, 429, 500, 524… */
  status?: number
  /** Sin respuesta: error de red o corte por tiempo (gana sobre status). */
  red?: 'red' | 'corte'
  /** La operación se hace igual antes de fallar (dudoso de verdad). */
  aplicar?: boolean
  /** Cuántas llamadas seguidas fallan con esta falla. Por defecto 1; Infinity = siempre. */
  veces?: number
}

export interface MedioJuguete { contenido: Uint8Array | string; mime?: string; nombre?: string }

export interface OpcionesJuguete {
  fallas?: Partial<Record<MetodoWhapi, FallaJuguete | FallaJuguete[]>>
  /** Archivos por id de media. Sin esto, descargarMedio devuelve unos bytes sintéticos con el mime del RefMedio. */
  medios?: Record<string, MedioJuguete>
  generalAutomatico?: boolean
  sinIdEnEnvios?: boolean
  /** Números que verificarNumeros da por inválidos. */
  invalidos?: string[]
  /** Participantes que no entran a los grupos (quedan en `fallidos`). */
  noAgregables?: string[]
  /** Teléfono del propio bot (autor de los ecos). */
  telefonoBot?: string
  ahora?: () => number
}

export interface LlamadaJuguete {
  metodo: MetodoWhapi
  args: Record<string, unknown>
  resultado?: unknown
  error?: { tipo: string; status: number | null; aplicado: boolean | null; mensaje: string }
  en: string
}

export interface MensajeJuguete {
  id: string
  chatId: string
  tipo: 'text' | 'video'
  texto: string            // body, o el pie del video ('' si no tiene)
  citar: string | null
  menciones: string[]
  url: string | null       // solo video
  en: string
  devueltoSinId: boolean
}

export interface GrupoJuguete {
  id: string
  nombre: string
  descripcion: string | null
  codigo: string
  tipo: 'comunidad' | 'avisos' | 'grupo'
  comunidadId: string | null
  generalChat: boolean
  participantes: string[]
  foto: string | null
  creadoEn: string
}

export interface ClienteWhapiJuguete extends ClienteWhapi {
  readonly modo: 'juguete'
  buscarComunidades(p: { nombre: string; desde: string }): Promise<GrupoWhapi[]>
  /** Todas las llamadas (con argumentos y resultado o error), o solo las de un método. */
  llamadas(metodo?: MetodoWhapi): readonly LlamadaJuguete[]
  /** Programa una falla más para un método (se suma a las que ya había). */
  fallar(metodo: MetodoWhapi, falla: FallaJuguete): void
  mensajes(): readonly MensajeJuguete[]
  grupos(): readonly GrupoJuguete[]
  contactos(): readonly { telefono: string; nombre: string }[]
  /** Los ecos (from_me, source 'api') de lo que mandó a Ventas o Verificaciones, como los emite el webhook real. */
  ecos(grupos: ConfigGrupos): EventoEco[]
  /** Borra todo lo hecho, el registro y las fallas pendientes. */
  reiniciar(): void
}

const MAX_BYTES_DEFECTO = 20 * 1024 * 1024
const TELEFONO_BOT = '5490000000000'

export function clienteWhapiDeJuguete(op: OpcionesJuguete = {}): ClienteWhapiJuguete {
  const ahora = op.ahora ?? Date.now
  const iso = () => new Date(ahora()).toISOString()
  let n = 0
  const nuevoId = (prefijo: string) => `jg-${prefijo}-${++n}`
  let registro: LlamadaWhapi[] = []
  let llamadas: LlamadaJuguete[] = []
  let mensajes: MensajeJuguete[] = []
  let grupos: GrupoJuguete[] = []
  let contactos: { telefono: string; nombre: string }[] = []
  let fallas = new Map<MetodoWhapi, FallaJuguete[]>()
  const cargarFallas = () => {
    fallas = new Map()
    for (const [m, f] of Object.entries(op.fallas ?? {}) as [MetodoWhapi, FallaJuguete | FallaJuguete[]][]) {
      fallas.set(m, (Array.isArray(f) ? f : [f]).map((x) => ({ ...x })))
    }
  }
  cargarFallas()
  const noAgregables = new Set((op.noAgregables ?? []).map((x) => x.replace(/\D/g, '')))
  const invalidos = new Set((op.invalidos ?? []).map((x) => x.replace(/\D/g, '')))

  const tomarFalla = (metodo: MetodoWhapi): FallaJuguete | null => {
    const cola = fallas.get(metodo)
    if (!cola?.length) return null
    const f = cola[0]
    const veces = f.veces ?? 1
    if (veces !== Infinity) {
      if (veces <= 1) cola.shift()
      else f.veces = veces - 1
    }
    return f
  }

  const config = (mensaje: string) => new ErrorWhapi('config', `Whapi (juguete): ${mensaje}`, null, false)
  const sinSeco = (...ids: (string | null | undefined)[]) => {
    for (const id of ids) if (typeof id === 'string' && /^seco-/i.test(id.trim())) throw config(`el id "${id}" es de la compuerta en modo seco: no se puede usar`)
  }
  const grupoPorId = (id: string): GrupoJuguete => {
    const g = grupos.find((x) => x.id === id)
    if (!g) throw errorPorStatus(404, false, 'grupo', 'no existe en el juguete')
    return g
  }
  const aGrupoWhapi = (g: GrupoJuguete): GrupoWhapi => ({
    id: g.id, nombre: g.nombre, codigoInvitacion: g.tipo === 'comunidad' ? null : g.codigo, generalChat: g.generalChat, creadoEn: g.creadoEn,
  })

  async function ejecutar<T>(metodo: MetodoWhapi, args: Record<string, unknown>, validar: () => void, hacer: () => T): Promise<T> {
    validar()
    const d = describir(metodo, args)
    registro.push(llamada(d.verbo, d.ruta, d.resumen, false, ahora()))
    const falla = tomarFalla(metodo)
    if (falla) {
      if (falla.aplicar) hacer()
      const escritura = ESCRITURAS.has(metodo)
      const e = falla.red ? errorDeRed(escritura, metodo, falla.red) : errorPorStatus(falla.status ?? 500, escritura, metodo, 'falla programada del juguete')
      llamadas.push({ metodo, args: { ...args }, error: { tipo: e.tipo, status: e.status, aplicado: e.aplicado, mensaje: e.message }, en: iso() })
      throw e
    }
    const r = hacer()
    llamadas.push({ metodo, args: { ...args }, resultado: r, en: iso() })
    return r
  }

  const sumarParticipantes = (g: GrupoJuguete, pedidos: string[]): ResultadoParticipantes => {
    const agregados: string[] = [], fallidos: string[] = []
    for (const p of pedidos) {
      const dig = p.replace(/\D/g, '')
      if (noAgregables.has(dig)) fallidos.push(p)
      else {
        agregados.push(p)
        if (!g.participantes.includes(dig)) g.participantes.push(dig)
      }
    }
    return { agregados, fallidos }
  }

  const enviar = (tipo: 'text' | 'video', p: { chatId: string; texto: string; citar?: string | null; menciones?: string[]; url?: string | null }): EnvioWhapi => {
    const id = nuevoId('msg')
    const devueltoSinId = op.sinIdEnEnvios === true
    mensajes.push({
      id, chatId: p.chatId, tipo, texto: p.texto, citar: p.citar ?? null, menciones: [...(p.menciones ?? [])], url: p.url ?? null, en: iso(), devueltoSinId,
    })
    return { id: devueltoSinId ? null : id, simulado: false }
  }

  const cliente: ClienteWhapiJuguete = {
    modo: 'juguete',

    enviarTexto(p) {
      return ejecutar('enviarTexto', p, () => {
        if (typeof p.chatId !== 'string' || !p.chatId.trim()) throw config('falta el chat')
        if (typeof p.texto !== 'string' || !p.texto.trim()) throw config('el texto está vacío')
        sinSeco(p.chatId, p.citar)
        const menciones = p.menciones ?? []
        const malas = menciones.filter((m) => !PATRON_MENCION.test(m))
        if (malas.length) throw config(`${malas.length} mención(es) con un formato que Whapi no acepta`)
        const faltan = faltanMenciones(p.texto, menciones)
        if (faltan.length) throw config(`el texto no trae "@<número>" de ${faltan.length} mención(es): Whapi lo exige`)
      }, () => enviar('text', p))
    },

    enviarVideo(p) {
      return ejecutar('enviarVideo', p, () => {
        if (typeof p.chatId !== 'string' || !p.chatId.trim()) throw config('falta el chat')
        if (typeof p.url !== 'string' || !p.url.trim()) throw config('falta la URL o el MediaID del video')
        sinSeco(p.chatId, p.citar, p.url)
      }, () => enviar('video', { chatId: p.chatId, texto: p.pie ?? '', citar: p.citar, url: p.url }))
    },

    descargarMedio(m: RefMedio, o?: { maxBytes?: number; hasta?: number }): Promise<MedioDescargado> {
      return ejecutar('descargarMedio', { id: m?.id, tipo: m?.tipo, mime: m?.mime }, () => {
        if (!m || typeof m.id !== 'string' || !m.id.trim()) throw config('el medio no tiene id')
        sinSeco(m.id)
      }, () => {
        const cfg = op.medios?.[m.id]
        const bytes = cfg ? Buffer.from(cfg.contenido) : Buffer.from(`contenido de juguete del medio ${m.id}`)
        const max = o?.maxBytes ?? MAX_BYTES_DEFECTO
        if (bytes.length > max) throw new ErrorWhapi('rechazo', `Whapi (juguete): el archivo pesa ${bytes.length} bytes, más que el tope de ${max}`, 413, false)
        return {
          base64: bytes.toString('base64'),
          mime: cfg?.mime ?? m.mime,
          nombre: cfg?.nombre ?? m.nombreArchivo ?? m.id,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }
      })
    },

    crearComunidad(p) {
      return ejecutar('crearComunidad', p, () => {
        if (!p.nombre?.trim() || typeof p.descripcion !== 'string') throw config('crear una comunidad pide nombre y descripción')
      }, () => {
        const creadoEn = iso()
        const comunidad: GrupoJuguete = {
          id: `${nuevoId('com')}@g.us`, nombre: p.nombre, descripcion: p.descripcion, codigo: `JGC${n}codigo`, tipo: 'comunidad',
          comunidadId: null, generalChat: false, participantes: [], foto: null, creadoEn,
        }
        grupos.push(comunidad)
        grupos.push({
          id: `${nuevoId('avisos')}@g.us`, nombre: p.nombre, descripcion: null, codigo: `JGA${n}codigo`, tipo: 'avisos',
          comunidadId: comunidad.id, generalChat: false, participantes: [], foto: null, creadoEn,
        })
        if (op.generalAutomatico) {
          grupos.push({
            id: `${nuevoId('gen')}@g.us`, nombre: 'General', descripcion: null, codigo: `JGG${n}codigo`, tipo: 'grupo',
            comunidadId: comunidad.id, generalChat: true, participantes: [], foto: null, creadoEn,
          })
        }
        return aGrupoWhapi(comunidad)
      })
    },

    subgruposComunidad(comunidadId) {
      return ejecutar('subgruposComunidad', { comunidadId }, () => sinSeco(comunidadId), () => {
        const c = grupoPorId(comunidadId)
        if (c.tipo !== 'comunidad') throw errorPorStatus(404, false, 'subgrupos', 'no es una comunidad')
        const avisos = grupos.find((g) => g.comunidadId === c.id && g.tipo === 'avisos')
        return {
          avisos: avisos ? aGrupoWhapi(avisos) : null,
          otros: grupos.filter((g) => g.comunidadId === c.id && g.tipo === 'grupo').map(aGrupoWhapi),
        }
      })
    },

    crearGrupoEnComunidad(p) {
      return ejecutar('crearGrupoEnComunidad', p, () => {
        if (!p.nombre?.trim()) throw config('el grupo necesita nombre')
        if (!Array.isArray(p.participantes) || !p.participantes.length) throw config('Whapi pide al menos un participante para crear un grupo')
        sinSeco(p.comunidadId)
      }, () => {
        const c = grupoPorId(p.comunidadId)
        if (c.tipo !== 'comunidad') throw errorPorStatus(404, true, 'crear grupo', 'no es una comunidad')
        const g: GrupoJuguete = {
          id: `${nuevoId('grupo')}@g.us`, nombre: p.nombre, descripcion: null, codigo: `JGG${n}codigo`, tipo: 'grupo',
          comunidadId: c.id, generalChat: false, participantes: [], foto: null, creadoEn: iso(),
        }
        grupos.push(g)
        return { ...aGrupoWhapi(g), ...sumarParticipantes(g, p.participantes) }
      })
    },

    agregarParticipantes(p) {
      return ejecutar('agregarParticipantes', p, () => {
        if (!Array.isArray(p.participantes) || !p.participantes.length) throw config('no hay participantes para agregar')
        sinSeco(p.grupoId)
      }, () => {
        const g = grupoPorId(p.grupoId)
        if (p.participantes.every((x) => g.participantes.includes(x.replace(/\D/g, '')))) {
          throw errorPorStatus(409, true, 'agregar participantes', 'ya estaban todos en el grupo')
        }
        return sumarParticipantes(g, p.participantes)
      })
    },

    ponerFoto(p: { grupoId: string; foto: FotoGrupo }) {
      return ejecutar('ponerFoto', p, () => {
        sinSeco(p.grupoId)
        const f = p.foto as { url?: unknown; base64?: unknown }
        if (typeof f?.url === 'string' ? !/^https:\/\//i.test(f.url) : typeof f?.base64 !== 'string') throw config('la foto tiene que ser una URL https o base64')
      }, () => {
        grupoPorId(p.grupoId).foto = 'url' in p.foto ? p.foto.url : `base64:${p.foto.mime}`
      })
    },

    cambiarInfoGrupo(p) {
      return ejecutar('cambiarInfoGrupo', p, () => {
        if (p.nombre === undefined && p.descripcion === undefined) throw config('no hay nada para cambiar')
        sinSeco(p.grupoId)
      }, () => {
        const g = grupoPorId(p.grupoId)
        if (p.nombre !== undefined) g.nombre = p.nombre
        if (p.descripcion !== undefined) g.descripcion = p.descripcion
      })
    },

    linkInvitacion(grupoId) {
      return ejecutar('linkInvitacion', { grupoId }, () => sinSeco(grupoId), () => `${URL_INVITACION}${grupoPorId(grupoId).codigo}`)
    },

    verificarNumeros(numeros) {
      return ejecutar('verificarNumeros', { numeros }, () => {
        if (!Array.isArray(numeros)) throw config('verificarNumeros pide una lista')
      }, () => Object.fromEntries(numeros.map((x) => [x, invalidos.has(x.replace(/\D/g, '')) ? 'invalido' : 'valido'] as const)))
    },

    agendarContacto(p) {
      return ejecutar('agendarContacto', p, () => {
        if (!/^\d{7,15}$/.test(String(p.telefono ?? '').replace(/^\+/, ''))) throw config('el teléfono tiene que ser de 7 a 15 dígitos')
        if (!p.nombre?.trim()) throw config('el contacto necesita nombre')
      }, () => {
        const telefono = p.telefono.replace(/\D/g, '')
        if (!contactos.some((c) => c.telefono === telefono)) contactos.push({ telefono, nombre: p.nombre })
      })
    },

    buscarComunidades(p) {
      return ejecutar('buscarComunidades', p, () => {
        if (!p.nombre?.trim() || !Number.isFinite(Date.parse(p.desde))) throw config('buscarComunidades pide nombre y una fecha ISO')
      }, () => {
        const desde = Date.parse(p.desde)
        return grupos.filter((g) => g.tipo === 'comunidad' && g.nombre.trim() === p.nombre.trim() && Date.parse(g.creadoEn) >= desde).map(aGrupoWhapi)
      })
    },

    registro: () => [...registro],
    llamadas: (metodo) => (metodo ? llamadas.filter((l) => l.metodo === metodo) : [...llamadas]),
    fallar(metodo, falla) {
      const cola = fallas.get(metodo) ?? []
      cola.push({ ...falla })
      fallas.set(metodo, cola)
    },
    mensajes: () => [...mensajes],
    grupos: () => grupos.map((g) => ({ ...g, participantes: [...g.participantes] })),
    contactos: () => [...contactos],
    ecos(cfg) {
      const telefono = op.telefonoBot ?? TELEFONO_BOT
      return mensajes.flatMap((m): EventoEco[] => {
        const grupo = m.chatId === cfg.ventas ? 'ventas' : m.chatId === cfg.verificaciones ? 'verificaciones' : null
        // Igual que el webhook real desde el 24/10: también el eco de otro grupo (el General de un cliente), con grupo null
        if (!grupo && !m.chatId.endsWith('@g.us')) return []
        return [{
          tipo: 'eco', clave: m.id, mensajeId: m.id, chatId: m.chatId, grupo, texto: m.texto, enviadoEn: m.en, recibidoEn: m.en,
          autor: { telefono, lid: null, nombre: 'Capital Jurídico' }, citado: m.citar ? { id: m.citar, autor: null } : null,
        }]
      })
    },
    reiniciar() {
      registro = []
      llamadas = []
      mensajes = []
      grupos = []
      contactos = []
      n = 0
      cargarFallas()
    },
  }
  return cliente
}
