// ── Bot "Capital Jurídico": datos del contrato de PandaDoc a partir del #ALTA (docs/BOT-ALTA-CJ.md) ─────
// Puro y sin red. Plantillas y domicilio del emisor se configuran por entorno privado.
import type { AltaParseada } from './parsear'
import { faltantesDireccion, separarDireccion } from './direccion'
import { PARTICULAS, nombreCliente } from './nombreCliente'

export const PLANTILLAS_CONTRATO = {
  normal: process.env.PANDADOC_PLANTILLA_NORMAL?.trim() ?? '',
  garantia: process.env.PANDADOC_PLANTILLA_GARANTIA?.trim() ?? '',
} as const

/** Domicilio del emisor confirmado; nunca se deduce ni se publica en el repositorio. */
export const DIRECCION_ARGENTINA = process.env.CONTRATO_DIRECCION_ARGENTINA?.trim() ?? ''

/** Dirección del cliente ya separada (ver direccion.ts). Un campo definido manda, aunque sea '' (= se sabe que no se
 *  sabe); uno sin definir sale de las reglas puras de separarDireccion. `confirmar`: ciudad y provincia son una
 *  conjetura de las reglas que nadie verificó (sin Claude o con Claude caído): el closer tiene que confirmarlas. Si
 *  ciudad o provincia vienen en `extra` sin `confirmar`, se toman como verificadas. */
export interface DireccionContrato { calle?: string; ciudad?: string; provincia?: string; pais?: string; confirmar?: boolean }

export interface DatosContrato {
  tokens: { name: string; value: string }[]
  destinatario: { email: string; first_name: string; last_name: string; role: 'Client' }
  faltantes: string[]
}

/** Nombre del cliente para el contrato: el mismo que usa Drive (nombreCliente.ts), sin "Dr./Dra./Escribana…" adelante,
 *  con mayúscula inicial si vino todo en mayúsculas o en minúsculas y "Ma." → "María". Si la limpieza lo deja vacío
 *  (ej. solo "Dra."), queda vacío y es un faltante. */
export const nombreContrato = (nombre: string | null | undefined): string => nombreCliente(nombre)

/** Partículas que van con el apellido ("de la Vega"). Sin la "y": "Ortega y Gasset" es raro y Drive ya lo pregunta. */
const PARTICULAS_APELLIDO = new Set([...PARTICULAS].filter((p) => p !== 'y'))

/** "Juan Manuel Pérez" → nombre "Juan Manuel", apellido "Pérez" (ya limpio con nombreContrato: "DRA. MARIA LAURA
 *  PEREZ" → "Maria Laura" / "Perez"). Las partículas de antes del apellido van con él: "Juan Pablo de la Vega" →
 *  "Juan Pablo" / "de la Vega". Con un solo nombre, el apellido queda vacío. */
function partirNombre(completo: string): [string, string] {
  const partes = nombreContrato(completo).split(' ').filter(Boolean)
  if (partes.length < 2) return [partes[0] ?? '', '']
  let corte = partes.length - 1
  while (corte > 1 && PARTICULAS_APELLIDO.has(partes[corte - 1].toLowerCase())) corte--
  return [partes.slice(0, corte).join(' '), partes.slice(corte).join(' ')]
}

/** Arma los tokens de la plantilla. StreetAddress lleva solo la calle; ciudad, provincia y país van en sus tokens.
 *  La dirección se separa con las reglas puras de direccion.ts; el servidor (pandadoc.ts) pasa en `extra` lo que
 *  resolvió con Claude cuando las reglas no alcanzan. Si ciudad o provincia quedan vacías, es un faltante; si quedan con
 *  la conjetura de las reglas (confianza 'baja' sin verificar), también: el closer las confirma. */
export function datosContrato(a: AltaParseada, extra: DireccionContrato = {}): DatosContrato {
  const [nombre, apellido] = partirNombre(a.nombre ?? '')
  const inicio = a.inicio ? a.inicio.split('-').reverse().join('/') : ''
  const argentino = a.telefonos[0]?.numero.startsWith('54') ?? false
  const reglas = a.direccion ? separarDireccion(a.direccion, a.telefonos[0]?.numero) : null
  const calle = (extra.calle ?? reglas?.calle ?? '').trim()
  const ciudad = (extra.ciudad ?? reglas?.ciudad ?? '').trim()
  const provincia = (extra.provincia ?? reglas?.provincia ?? '').trim()
  const pais = (extra.pais ?? reglas?.pais ?? '').trim() || (argentino ? 'Argentina' : '')
  // Si ciudad o provincia vinieron resueltas en `extra`, decide `extra.confirmar`; si salen de las reglas, su confianza
  const confirmar = extra.ciudad !== undefined || extra.provincia !== undefined ? !!extra.confirmar : reglas?.confianza === 'baja'
  const faltantes: string[] = []
  if (!DIRECCION_ARGENTINA) faltantes.push('Domicilio del emisor (CONTRATO_DIRECCION_ARGENTINA)')
  if (!nombre) faltantes.push('Nombre completo')
  if (!apellido && nombre) faltantes.push('Apellido')
  if (!a.correo) faltantes.push('Correo')
  if (!a.direccion) faltantes.push('Dirección')
  else {
    if (!calle) faltantes.push('Dirección (calle y número)')
    faltantes.push(...faltantesDireccion({ ciudad, provincia }, confirmar))
  }
  if (!inicio) faltantes.push('Inicio del servicio')
  if (argentino && !a.dni) faltantes.push('DNI')
  const tokens = [
    { name: 'Client.FirstName', value: nombre },
    { name: 'Client.LastName', value: apellido },
    { name: 'Client.Email', value: a.correo ?? '' },
    { name: 'Client.StreetAddress', value: calle },
    { name: 'Client.City', value: ciudad },
    { name: 'Client.State', value: provincia },
    { name: 'Client.Country', value: pais },
    { name: 'DNI', value: a.dni ?? '' },
    { name: 'Fecha de Inicio', value: inicio },
    { name: 'TU DIRECCIÓN EN ARGENTINA', value: DIRECCION_ARGENTINA },
  ]
  return {
    tokens,
    destinatario: { email: a.correo ?? '', first_name: nombre, last_name: apellido, role: 'Client' },
    faltantes,
  }
}
