// ── Bot "Capital Jurídico": datos del contrato de PandaDoc a partir del #ALTA (docs/BOT-ALTA-CJ.md) ─────
// Puro y sin red. Plantillas, domicilio del Proveedor y correos de los socios firmantes se configuran por entorno privado.
// Proveedor del contrato: Capital Jurídico (antes Skyward Consultoría Jurídica LLC; pedido de Tomás, 11/11/2026), con
// dos socios al 50 %: Gerónimo Actis y Tomás Napolitano.
import type { AltaParseada } from './parsear'
import { faltantesDireccion, separarDireccion } from './direccion'
import { PARTICULAS, nombreCliente } from './nombreCliente'

export const PLANTILLAS_CONTRATO = {
  normal: process.env.PANDADOC_PLANTILLA_NORMAL?.trim() ?? '',
  garantia: process.env.PANDADOC_PLANTILLA_GARANTIA?.trim() ?? '',
} as const

/** Domicilio del Proveedor (la oficina de Capital Jurídico) confirmado; nunca se deduce ni se publica en el repositorio. */
export const DIRECCION_ARGENTINA = process.env.CONTRATO_DIRECCION_ARGENTINA?.trim() ?? ''

/** El Proveedor del contrato. `correo` es el de notificaciones del Proveedor (no es una cuenta de login). */
export const PROVEEDOR = {
  nombre: 'Capital Jurídico',
  nombreMayusculas: 'CAPITAL JURÍDICO',
  correo: 'info@capitaljuridico.com.ar',
} as const

/** Rol de un firmante en la plantilla de PandaDoc. "Proveedor" solo existe en las plantillas nuevas de Capital
 *  Jurídico: por eso el firmante del Proveedor va SOLO si su correo está cargado en el entorno. */
export type RolFirmante = 'Client' | 'Proveedor'

export interface Firmante { email: string; first_name: string; last_name: string; role: RolFirmante }

/** Los dos socios del Proveedor, al 50 % cada uno. Van en el texto de las partes («representada por sus socios
 *  Gerónimo Actis y Tomás Napolitano, titulares del 50 % cada uno»); firma solo FIRMANTE_PROVEEDOR. */
export const SOCIOS_PROVEEDOR = [
  { rol: 'Socio1', nombre: 'Gerónimo', apellido: 'Actis', porcentaje: '50 %' },
  { rol: 'Socio2', nombre: 'Tomás', apellido: 'Napolitano', porcentaje: '50 %' },
] as const

/** Quien firma por Capital Jurídico (Tomás, 11/11/2026): solo Gerónimo Actis, «en representación de Capital Jurídico»,
 *  con el rol "Proveedor" de la plantilla. El correo sale de CONTRATO_FIRMANTE_PROVEEDOR_EMAIL. */
export const FIRMANTE_PROVEEDOR = {
  nombre: 'Gerónimo', apellido: 'Actis', variable: 'CONTRATO_FIRMANTE_PROVEEDOR_EMAIL',
  representacion: 'Gerónimo Actis, en representación de Capital Jurídico',
} as const

/** Texto de las partes con los dos socios. */
export const PARTES_PROVEEDOR = `representada por sus socios ${SOCIOS_PROVEEDOR.map((s) => `${s.nombre} ${s.apellido}`).join(' y ')}, titulares del 50 % cada uno`

/** Firmante del Proveedor si su correo está cargado (se lee en cada llamada). Sin el correo, [] y el contrato sale
 *  como hoy, con el cliente como único firmante (sirve con las plantillas viejas, que solo tienen el rol "Client"). */
export function firmantesProveedor(entorno: Record<string, string | undefined> = process.env): Firmante[] {
  const email = entorno[FIRMANTE_PROVEEDOR.variable]?.trim() ?? ''
  return email ? [{ email, first_name: FIRMANTE_PROVEEDOR.nombre, last_name: FIRMANTE_PROVEEDOR.apellido, role: 'Proveedor' }] : []
}

export interface DatosContrato {
  tokens: { name: string; value: string }[]
  destinatario: Firmante & { role: 'Client' }
  /** Quien firma por el Proveedor (ver firmantesProveedor); [] si no está cargado el correo. */
  firmantesProveedor: Firmante[]
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
  if (!DIRECCION_ARGENTINA) faltantes.push('Domicilio del Proveedor, Capital Jurídico (CONTRATO_DIRECCION_ARGENTINA)')
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
    // Token de las plantillas actuales (se sigue mandando para no romperlas); las nuevas usan Proveedor.Domicilio
    { name: 'TU DIRECCIÓN EN ARGENTINA', value: DIRECCION_ARGENTINA },
    // Datos del Proveedor para las plantillas nuevas de Capital Jurídico (en las viejas no aparecen en el texto)
    { name: 'Proveedor.Nombre', value: PROVEEDOR.nombreMayusculas },
    { name: 'Proveedor.Domicilio', value: DIRECCION_ARGENTINA },
    { name: 'Proveedor.Email', value: PROVEEDOR.correo },
    { name: 'Proveedor.Firmante', value: FIRMANTE_PROVEEDOR.representacion },
    { name: 'Proveedor.Representacion', value: PARTES_PROVEEDOR },
    ...SOCIOS_PROVEEDOR.flatMap((s) => [
      { name: `${s.rol}.Nombre`, value: `${s.nombre} ${s.apellido}` },
      { name: `${s.rol}.Porcentaje`, value: s.porcentaje },
    ]),
  ]
  return {
    tokens,
    destinatario: { email: a.correo ?? '', first_name: nombre, last_name: apellido, role: 'Client' },
    firmantesProveedor: firmantesProveedor(),
    faltantes,
  }
}
