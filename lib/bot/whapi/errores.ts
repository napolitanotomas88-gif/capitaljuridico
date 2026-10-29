// ── Bot "Capital Jurídico": errores del cliente de Whapi (BLOQUE W) ─────────────────────────────────────────────────────
// Un solo tipo de error para el cliente real, la compuerta y el juguete: así el orquestador decide igual en los tres casos.
// `aplicado` sigue la misma regla que ErrorPuente (lib/bot/alta/puenteDrive.ts):
//   · false → seguro que no se hizo (Whapi lo rechazó, o nunca salió el pedido);
//   · null  → no se sabe: un 5xx, un corte por tiempo, un 524 o un error de red en una ESCRITURA (WhatsApp pudo haberlo hecho
//     igual: por ejemplo, el video salió pero la respuesta no llegó). Nunca se reintenta solo.
// Los mensajes nunca llevan el token ni el cuerpo del pedido.
import type { ErrorWhapiForma, TipoErrorWhapi } from '@/lib/bot/alta/motor/tipos'

/** Lo que vale `aplicado` cuando quien arma el error no lo dice: solo 'dudoso' queda en null. */
const aplicadoPorTipo = (tipo: TipoErrorWhapi): boolean | null => (tipo === 'dudoso' ? null : false)

export class ErrorWhapi extends Error implements ErrorWhapiForma {
  readonly name = 'ErrorWhapi' as const
  readonly tipo: TipoErrorWhapi
  readonly status: number | null
  readonly aplicado: boolean | null
  constructor(tipo: TipoErrorWhapi, mensaje: string, status: number | null = null, aplicado?: boolean | null) {
    super(mensaje)
    this.tipo = tipo
    this.status = status
    this.aplicado = aplicado === undefined ? aplicadoPorTipo(tipo) : aplicado
  }
}

/** Sirve también para errores que cruzaron un límite de módulo (se mira la forma, no la clase). */
export function esErrorWhapi(e: unknown): e is ErrorWhapiForma {
  if (typeof e !== 'object' || e === null) return false
  const x = e as { name?: unknown; tipo?: unknown; aplicado?: unknown }
  return x.name === 'ErrorWhapi' && typeof x.tipo === 'string' && (x.aplicado === null || typeof x.aplicado === 'boolean')
}

const EXPLICACION: Record<number, string> = {
  400: 'pedido mal armado',
  401: 'la sesión del número se cayó: hay que volver a escanear el QR en whapi.cloud',
  402: 'se pasó el límite del plan de prueba',
  403: 'Whapi no deja hacer eso en ese chat (¿el bot no es admin o no está en el grupo?)',
  404: 'no existe (id equivocado o el archivo ya venció)',
  409: 'ya existe (por ejemplo, el participante ya estaba en el grupo)',
  413: 'el pedido o el archivo es demasiado grande',
  415: 'formato de archivo no soportado',
  429: 'demasiados pedidos: WhatsApp puede estar frenando el número (soft ban); dejarlo descansar',
  524: 'Whapi cortó a los 110 s esperando a WhatsApp (pudo haber salido igual)',
}

/** Tipo de error de Whapi según el status HTTP. En una escritura, un 5xx (y el 408) es dudoso: pudo haberse hecho. */
export function tipoPorStatus(status: number, escritura: boolean): TipoErrorWhapi {
  switch (status) {
    case 401: return 'auth'
    case 402: return 'limite'
    case 403: return 'prohibido'
    case 404: return 'no_encontrado'
    case 409: return 'ya_existe'
    case 429: return 'soft_ban'
  }
  if (status === 408 || status >= 500) return escritura ? 'dudoso' : 'pasajero'
  return 'rechazo'
}

/** Recorta y limpia un texto que vino de Whapi (puede repetir datos del pedido): una línea, sin el token. */
export function limpiarDetalle(detalle: unknown, token?: string | null, max = 160): string {
  if (typeof detalle !== 'string') return ''
  let t = detalle.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (token && token.length >= 8) t = t.split(token).join('•••')
  t = t.replace(/Bearer\s+\S+/gi, 'Bearer •••')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Error a partir de una respuesta HTTP de Whapi que no fue 2xx. */
export function errorPorStatus(status: number, escritura: boolean, accion: string, detalle?: string): ErrorWhapi {
  const tipo = tipoPorStatus(status, escritura)
  const porque = EXPLICACION[status] ?? (status >= 500 ? 'error del servidor de Whapi' : 'Whapi lo rechazó')
  const extra = detalle ? ` — ${detalle}` : ''
  const duda = tipo === 'dudoso' ? ' No se sabe si se hizo: no se reintenta solo.' : ''
  return new ErrorWhapi(tipo, `Whapi ${accion}: HTTP ${status} (${porque})${extra}.${duda}`, status)
}

/** Error de red o corte por tiempo (sin respuesta). En una escritura es dudoso; en una lectura, pasajero. */
export function errorDeRed(escritura: boolean, accion: string, causa: 'red' | 'corte'): ErrorWhapi {
  const que = causa === 'corte' ? 'se cortó por tiempo esperando la respuesta' : 'no se pudo conectar con Whapi'
  if (escritura) return new ErrorWhapi('dudoso', `Whapi ${accion}: ${que}. No se sabe si se hizo: no se reintenta solo.`, null, null)
  return new ErrorWhapi('pasajero', `Whapi ${accion}: ${que}.`, null, false)
}
