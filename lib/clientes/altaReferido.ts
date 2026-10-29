// ── Alta de un referido: validación y decisión, PURAS (sin red, sin reloj, sin Sheets) ───────────────
// "Registrar referido" agrega UNA fila en la pestaña "Referidos" con estado inicial "Presentado". No otorga créditos,
// no canjea nada y no aplica reglas comerciales nuevas: los créditos los calcula creditos.ts desde las filas.
// Las columnas y listas salen de pestanasNuevas.ts (SPEC); acá solo se arma la fila y se decide si se puede cargar.
import { REGLAS_REFERIDOS } from './reglasReferidos'
import { MOMENTOS_PEDIDO } from './pestanasNuevas'
import { esYmdValido, ymdASerial, type Ymd } from './fechas'

export type MomentoAlta = (typeof MOMENTOS_PEDIDO)[number]

export interface EntradaAlta {
  idReferidor: unknown
  nombre: unknown
  telefono: unknown
  mail?: unknown
  estudio: unknown
  momento: unknown
  fechaPedido?: unknown          // 'AAAA-MM-DD'; por defecto, hoy (Argentina)
  notas?: unknown
  claveEnvio?: unknown           // UUID del formulario: evita el doble envío por doble clic
  idClienteNuevo?: unknown       // carga de un referido que YA es cliente (27/10/2026): su ID del CRM, para vincularlo
}

export interface AltaLimpia {
  idReferidor: string
  nombre: string
  telefono: string               // solo dígitos y un "+" inicial
  digitos: string
  mail: string
  estudio: string
  momento: MomentoAlta
  fechaPedido: Ymd
  notas: string
  claveEnvio: string
  idClienteNuevo: string         // '' = lead nuevo (lo normal)
}

export type ErroresAlta = Partial<Record<'idReferidor' | 'nombre' | 'telefono' | 'mail' | 'estudio' | 'momento' | 'fechaPedido' | 'notas', string>>

const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Quita todo menos dígitos (conserva un "+" inicial). "+54 9 351 555-1234" → "+5493515551234" */
export function normalizarTelefono(v: unknown): { telefono: string; digitos: string } {
  const crudo = typeof v === 'string' ? v.trim() : ''
  const digitos = crudo.replace(/\D/g, '')
  return { telefono: (crudo.startsWith('+') ? '+' : '') + digitos, digitos }
}

/** Los últimos 8 dígitos: sirven para reconocer el mismo número con o sin código de país (+54 9…). */
export const claveTelefono = (digitos: string): string => (digitos.length >= 8 ? digitos.slice(-8) : '')

const MAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// Una celda de texto que empiece con estos caracteres se interpretaría como fórmula si alguien la copia a otra planilla
const sinFormula = (s: string): string => (/^[=+\-@]/.test(s) && !/^\+\d/.test(s) ? `'${s}` : s)

export function validarAlta(e: EntradaAlta, hoy: Ymd): { ok: true; alta: AltaLimpia } | { ok: false; errores: ErroresAlta } {
  const errores: ErroresAlta = {}
  const idReferidor = txt(e.idReferidor, 12).toUpperCase()
  if (!/^[AC]\d{3,}$/.test(idReferidor)) errores.idReferidor = 'Elegí el cliente que refiere.'

  const nombre = txt(e.nombre, 120)
  if (nombre.length < 3) errores.nombre = 'Escribí el nombre del referido (al menos 3 letras).'

  const { telefono, digitos } = normalizarTelefono(e.telefono)
  if (digitos.length < 8 || digitos.length > 15) errores.telefono = 'El teléfono tiene que tener entre 8 y 15 dígitos, con código de país si lo sabés.'

  const mail = txt(e.mail, 120).toLowerCase()
  if (mail && !MAIL.test(mail)) errores.mail = 'El mail no parece válido. Dejalo vacío si no lo tenés.'

  const estudio = txt(e.estudio, 120)
  if (estudio.length < 2) errores.estudio = 'Escribí el estudio del referido: tiene que ser distinto al del cliente que refiere.'

  const momento = txt(e.momento, 40) as MomentoAlta
  if (!(MOMENTOS_PEDIDO as readonly string[]).includes(momento)) errores.momento = 'Elegí en qué momento se pidió.'

  const fechaPedido = (typeof e.fechaPedido === 'string' && e.fechaPedido.trim() ? e.fechaPedido.trim() : hoy) as Ymd
  if (!esYmdValido(fechaPedido)) errores.fechaPedido = 'La fecha del pedido no es válida.'
  else if (fechaPedido > hoy) errores.fechaPedido = 'La fecha del pedido no puede ser futura.'
  // Tomás (27/10/2026): solo se cargan referidos desde el inicio del programa; lo anterior no suma y no se carga
  else if (fechaPedido < REGLAS_REFERIDOS.vigenteDesde) errores.fechaPedido = 'El programa de referidos arranca el 1/10/2026: los anteriores no suman y no se cargan.'

  const notas = txt(e.notas, 300)
  const claveEnvio = txt(e.claveEnvio, 64)
  const idClienteNuevo = txt(e.idClienteNuevo, 12).toUpperCase()
  if (idClienteNuevo && !/^[AC]\d{3,}$/.test(idClienteNuevo)) errores.idReferidor = 'El ID del cliente nuevo no es válido (ej. A170).'
  else if (idClienteNuevo && idClienteNuevo === idReferidor) errores.idReferidor = 'El cliente nuevo no puede ser el mismo que refiere.'

  if (Object.keys(errores).length) return { ok: false, errores }
  return { ok: true, alta: { idReferidor, nombre, telefono, digitos, mail, estudio, momento, fechaPedido, notas, claveEnvio, idClienteNuevo } }
}

// ── Lo que ya hay en la planilla (lo trae el escritor con una lectura fresca) ───────────────────────
export interface ReferidoExistente { id: string; idReferidor: string; digitos: string; fechaPedido: Ymd | null; momento: string; idClienteNuevo?: string }
export interface ClienteExistente { id: string; estado: string; digitos: string; mail: string }

export type Decision =
  | { tipo: 'nuevo'; id: string; avisos: string[] }
  | { tipo: 'duplicado'; id: string }                                  // el mismo referidor ya cargó ese número: no se vuelve a cargar (idempotente)
  | { tipo: 'rechazado'; codigo: 'otro_referidor' | 'ya_es_cliente' | 'referidor_inexistente' | 'referidor_inactivo' | 'cliente_nuevo_inexistente' | 'cliente_nuevo_no_coincide' | 'cliente_nuevo_ya_vinculado'; mensaje: string }

export function siguienteId(existentes: { id: string }[]): string {
  const max = existentes.reduce((m, r) => {
    const n = /^R(\d+)$/i.exec(r.id.trim())
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `R${String(max + 1).padStart(3, '0')}`
}

export function decidirAlta(alta: AltaLimpia, referidos: ReferidoExistente[], clientes: ClienteExistente[]): Decision {
  const referidor = clientes.find(c => c.id === alta.idReferidor)
  if (!referidor) return { tipo: 'rechazado', codigo: 'referidor_inexistente', mensaje: 'Ese cliente no existe en el CRM.' }

  const k = claveTelefono(alta.digitos)
  const mismoNumero = referidos.filter(r => k !== '' && claveTelefono(r.digitos) === k)
  const propio = mismoNumero.find(r => r.idReferidor === alta.idReferidor)
  if (propio) return { tipo: 'duplicado', id: propio.id }
  if (mismoNumero.length) {
    return { tipo: 'rechazado', codigo: 'otro_referidor', mensaje: `Ese teléfono ya fue presentado por otro cliente (${mismoNumero[0].id}). No se carga de nuevo; si corresponde, se resuelve a mano.` }
  }
  const yaCliente = clientes.find(c => (k !== '' && claveTelefono(c.digitos) === k) || (alta.mail !== '' && c.mail === alta.mail))
  const avisos: string[] = []
  // Referido que ya es cliente (carga de referidos que cerraron antes de que existiera el Despacho): se acepta SOLO vinculándolo
  // con su ID, y ese ID tiene que ser el cliente que coincide por teléfono o mail (si coincide alguno) y no estar vinculado a otro.
  if (alta.idClienteNuevo) {
    if (!clientes.some(c => c.id === alta.idClienteNuevo)) return { tipo: 'rechazado', codigo: 'cliente_nuevo_inexistente', mensaje: `El cliente ${alta.idClienteNuevo} no está en el CRM.` }
    if (yaCliente && yaCliente.id !== alta.idClienteNuevo) return { tipo: 'rechazado', codigo: 'cliente_nuevo_no_coincide', mensaje: `Ese teléfono o mail es del cliente ${yaCliente.id}, no de ${alta.idClienteNuevo}. Revisá el ID.` }
    const otro = referidos.find(r => (r.idClienteNuevo ?? '').toUpperCase() === alta.idClienteNuevo)
    if (otro) return { tipo: 'rechazado', codigo: 'cliente_nuevo_ya_vinculado', mensaje: `${alta.idClienteNuevo} ya está vinculado al referido ${otro.id}.` }
    avisos.push(`Cargado como referido que ya es cliente (${alta.idClienteNuevo}): marcá "Cerró" con la fecha de la llamada y del primer pago para que sume en la escalera.`)
  } else if (yaCliente) return { tipo: 'rechazado', codigo: 'ya_es_cliente', mensaje: `Esa persona ya figura como cliente (${yaCliente.id}). Si ya cerró y querés cargarlo igual, indicá su ID de cliente nuevo.` }

  const max = REGLAS_REFERIDOS.pedido.maxNombresPorPedido
  const delPedido = referidos.filter(r => r.idReferidor === alta.idReferidor && r.fechaPedido === alta.fechaPedido && r.momento === alta.momento).length
  if (delPedido >= max) avisos.push(`Con este ya son ${delPedido + 1} nombres en el mismo pedido; el máximo previsto es ${max} (supuesto). Se cargó igual.`)
  // Tomás (27/10/2026): puede referir cualquier cliente del CRM, activo o no ("elijo el cliente y a quién refirió")
  if (referidor.estado !== 'ACTIVO') avisos.push(`El cliente que refiere figura ${referidor.estado || 'sin estado'} en el CRM: se cargó igual.`)
  return { tipo: 'nuevo', id: siguienteId(referidos), avisos }
}

// ── Fila para la planilla ─────────────────────────────────────────────────────────────────────────
/** 'AAAA-MM-DD' → número de serie de Sheets (la celda tiene formato de fecha: se ve dd/mm/aaaa) */
export const serialSheets = (ymd: Ymd): number => ymdASerial(ymd)

// Columnas de "Referidos" (SPEC): A ID, B Fecha del pedido, C Momento, D ID referidor, E Nombre, F Teléfono, G Mail,
// H Estudio, I Estado, J Fecha de llamada, K ID cliente nuevo, L Fecha del primer pago, M Fecha de liberación (FÓRMULA),
// N Reembolso, O Notas, P Cargado por, Q Referidor (nombre) (FÓRMULA). M y Q NO se escriben: ya tienen fórmula.
export function filaReferido(alta: AltaLimpia, id: string, cargadoPor: string): { bloqueAL: (string | number)[]; bloqueNP: (string | number)[] } {
  return {
    bloqueAL: [id, serialSheets(alta.fechaPedido), alta.momento, alta.idReferidor, sinFormula(alta.nombre), alta.telefono, sinFormula(alta.mail), sinFormula(alta.estudio), 'Presentado', '', alta.idClienteNuevo ?? '', ''],
    bloqueNP: ['', sinFormula(alta.notas), sinFormula(cargadoPor)],
  }
}
