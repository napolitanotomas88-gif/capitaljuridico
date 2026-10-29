// ── Bot "Capital Jurídico": qué haría el alta con un mensaje ya leído (docs/BOT-ALTA-CJ.md) ─────────────
// Puro y sin red: lo usa la pantalla de simulación (/configuracion/altas) y lo va a usar el webhook real.
// La fecha de hoy la pasa quien llama (así el resultado no depende de la hora en que corre).
// Cada paso dice qué haría, con los datos del mensaje, y si necesita un OK humano.
// Fee (Tomás, 24/10/2026; ajustado el 26/10): con menos de USD 500 el alta NO arranca. Con el OK de Verificaciones C.J se
// registra el Fee en Finanzas y se arma la comunidad; CRM, Drive, bienvenida, Skool, contrato y saludos esperan a que se
// complete la primera cuota.
// Pago en pesos sin el USD todavía (falta el MEP del día anterior, p. ej. en el simulador o si argentinadatos no
// responde): puede ser un Fee, así que el alta tampoco arranca hasta saberlo (estado 'falta_usd').
import { esAvisoFee, esSocioSkool, leerSocios, MINIMO_USD, type AltaParseada } from './parsear'
import { DIRECCION_ARGENTINA, datosContrato } from './contrato'
import { esPagoFee, faltaParaUsd, filaRegistroPagos, usdDelPago, type ExtrasRegistro } from './finanzas'
import { armarBienvenida } from './bienvenida'

/** fee = menos de USD 500 · falta_usd = pago en pesos del que todavía no se sabe cuántos USD son (puede ser un Fee). */
export type EstadoAlta = 'faltan_datos' | 'fee' | 'falta_usd' | 'necesita_ok' | 'lista'

export interface PasoAlta {
  id: string
  titulo: string
  detalle: string[]
  humano: string | null   // quién tiene que aprobar o hacer algo a mano
  enEspera: boolean       // todavía no se hace: faltan datos, falta un OK o el pago es un Fee
}

/** Lo que el bot sabe además del mensaje (lo lee del comprobante o lo busca el servidor). La fecha va aparte. */
export type ExtrasAlta = Omit<ExtrasRegistro, 'fecha'>

/** Link de la comunidad de Skool (va en la bienvenida). Al cliente lo invita Aylu por correo desde Skool, con acceso
 *  instantáneo y sin solicitud (Tomás, 24/10/2026). */
export const LINK_SKOOL = 'skool.com/skyward-consultoria-juridica-2017'

/** Pasos que se hacen igual con un Fee, con el OK de Verificaciones C.J: validar el pago, registrarlo en Finanzas y armar la
 *  comunidad de WhatsApp (Tomás, 26/10/2026: "el grupo sí lo podemos armar sin problema"). */
const PASOS_CON_FEE = new Set(['validar', 'finanzas', 'comunidad'])

// Tomás, 25/10/2026: Gero A va en los 3 grupos con su número de grupos de clientes (no se unifica con el de
// Verificaciones). El closer del #ALTA va SOLO en General: lo suma pasoComunidad con el teléfono del autor del mensaje.
export const GRUPOS_COMUNIDAD = [
  { nombre: 'General', equipo: ['Gero M', 'Aylu', 'Tomás', 'Gero A', 'Capital Jurídico'] },
  { nombre: 'Ventas', equipo: ['Gero M', 'Aylu', 'Tomás', 'Gero A', 'Capital Jurídico', 'Valentino Zalazar', 'Francisco Girándola'] },
  { nombre: 'Contenido', equipo: ['Gero M', 'Aylu', 'Tomás', 'Gero A', 'Capital Jurídico', 'Faustino Gamarra'] },
] as const

const usd = (n: number | null) => (n === null ? '—' : `USD ${n.toLocaleString('es-AR')}`)
const fechaCorta = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '—')

/** Avisos del parser que tiene que mirar Tomi o Gero. El del Fee no va: el Fee lo decide el estado, con el USD
 *  calculado si el pago fue en pesos (así no queda un "es un Fee" viejo cuando el MEP dice que llega a USD 500). */
export const avisosParaRevisar = (a: AltaParseada): string[] => a.avisos.filter((x) => !esAvisoFee(x))

/** Estado del alta. Un Fee va antes que los datos faltantes: el alta no arranca igual, y lo que falte se pide en la
 *  misma respuesta. Un pago en pesos sin USD todavía espera (puede ser un Fee) después de los datos faltantes.
 *  `extras` (opcional) sirve para decidir el Fee con el USD calculado de un pago en pesos. */
export function estadoAlta(a: AltaParseada, extras: ExtrasAlta = {}): EstadoAlta {
  if (esPagoFee(a, extras)) return 'fee'
  if (a.faltantes.length) return 'faltan_datos'
  if (faltaParaUsd(a, extras)) return 'falta_usd'
  if (avisosParaRevisar(a).length) return 'necesita_ok'
  return 'lista'
}

/** Lo que el bot le respondería al closer en "Ventas C.J.". */
export function respuestaAlCloser(a: AltaParseada, extras: ExtrasAlta = {}): string {
  const quien = a.nombre ?? 'este cliente'
  const revisar = avisosParaRevisar(a)
  const ademas = revisar.length ? ` Además, Tomi o Gero tienen que revisar: ${revisar.join('; ')}.` : ''
  const estado = estadoAlta(a, extras)
  if (estado === 'fee') {
    const falta = a.faltantes.length ? ` Para ese momento me falta: ${a.faltantes.join(', ')}.` : ''
    return `Recibí el pago de ${quien}: ${usd(usdDelPago(a, extras))} es un Fee (seña). Con el OK de Verificaciones C.J lo registro en Finanzas y armo la comunidad de WhatsApp. El alta completa (CRM, Drive, bienvenida, Skool y contrato) arranca cuando se complete la primera cuota (como mínimo, USD ${MINIMO_USD}).${falta}${ademas}`
  }
  if (estado === 'faltan_datos') return `Para dar de alta a ${quien} me falta: ${a.faltantes.join(', ')}. Mandalo en este chat respondiendo a tu mensaje.`
  if (estado === 'falta_usd') {
    return `Recibí el alta de ${quien}. El pago es en pesos y falta ${faltaParaUsd(a, extras)} para saber cuántos USD son: si no llega a USD ${MINIMO_USD} es un Fee (seña) y el alta espera. Sigo apenas lo tenga.${ademas}`
  }
  if (estado === 'necesita_ok') return `Recibí el alta de ${quien}. Antes de seguir, Tomi o Gero tienen que revisar: ${revisar.join('; ')}.`
  return `Listo, arranco el alta de ${quien}. Te aviso cuando estén la comunidad, el Drive y el acceso a Skool.`
}

/** Primera línea de un paso en espera: por qué todavía no se hace. */
function motivoEspera(estado: EstadoAlta, falta: string | null): string {
  switch (estado) {
    case 'fee': return `En espera: arranca cuando se complete la primera cuota (como mínimo, USD ${MINIMO_USD}).`
    case 'falta_usd': return `En espera: falta ${falta ?? 'el USD del pago'} para saber si el pago llega a USD ${MINIMO_USD}.`
    case 'faltan_datos': return 'En espera: faltan datos que tiene que mandar el closer.'
    default: return 'En espera: falta el OK de Tomi o Gero.'
  }
}

/** `extras` (opcional): lo que se sabe del comprobante y del servidor (pesos, MEP del día anterior, destinatario…). */
export function planDeAlta(a: AltaParseada, hoy: string | Date, extras: ExtrasAlta = {}): PasoAlta[] {
  const estado = estadoAlta(a, extras)
  const fee = estado === 'fee'
  const falta = faltaParaUsd(a, extras)
  const revisar = avisosParaRevisar(a)
  const nombre = a.nombre ?? '(nombre)'
  const cliente = a.telefonos.map((t) => `+${t.numero}${t.etiqueta ? ` (${t.etiqueta})` : ''}`).join(', ') || '(teléfono)'
  const cuotas = a.cuotas.filter((c) => !c.pagada)
  const f = filaRegistroPagos(a, { ...extras, fecha: hoy })
  const bienvenida = armarBienvenida(a)
  // Socios que entran a Skool (Tomás, 24/10/2026): los que traen nombre o correo (un teléfono suelto no)
  const conSocios = leerSocios(a.socios).some(esSocioSkool)
  const pasos: Omit<PasoAlta, 'enEspera'>[] = [
    {
      id: 'validar',
      titulo: 'Validar el pago',
      detalle: [
        `Este pago: ${a.pagoEnPesos?.ars != null && a.estePagoUsd === null ? `$${a.pagoEnPesos.ars.toLocaleString('es-AR')} en pesos` : usd(a.estePagoUsd)}${a.medioPago ? ` · ${a.medioPago}` : ''}`,
        `Total: ${a.modalidad ?? '—'} ${usd(a.totalUsd)}`,
        'Se compara con el comprobante (monto, moneda, fecha y n.º de operación).',
        ...(fee ? [`Es un Fee (seña) de ${usd(usdDelPago(a, extras))}: con el OK de Verificaciones C.J se registra en Finanzas y se arma la comunidad. El alta completa arranca cuando se complete la primera cuota (como mínimo, USD ${MINIMO_USD}).`] : []),
        ...(falta && !fee ? [`Pago en pesos: falta ${falta} para saber cuántos USD son y si es un Fee (menos de USD ${MINIMO_USD}).`] : []),
      ],
      humano: fee
        ? 'OK en Verificaciones C.J (Fee: Finanzas y comunidad)'
        : revisar.length ? 'Tomi o Gero, en Verificaciones C.J' : null,
    },
    (() => {
      // Vista previa: setter, fuente y cuenta, si no vienen en `extras`, quedan como pendientes
      const v = (col: keyof typeof f.celdas) => (f.celdas[col] === '' ? '—' : String(f.celdas[col]))
      const usdFila = typeof f.celdas.E === 'number' ? f.celdas.E : a.estePagoUsd
      return {
        id: 'finanzas',
        titulo: fee ? 'Registrar el Fee en Finanzas' : 'Cargar en Finanzas',
        detalle: [
          `Fila nueva arriba de todo en "Registro de Pagos" con ${usd(usdFila)} de ${nombre}, closer ${a.closer ?? '—'}.`,
          ...(f.fechaLegible ? [`Fecha: ${f.fechaLegible} (va como serial de Sheets: ${f.celdas.A})`] : []),
          ...(typeof f.celdas.F === 'number' ? [`Pesos: $${f.celdas.F.toLocaleString('es-AR')} (col F)`] : []),
          `Programa: ${v('B')} · Concepto: ${v('J')} · Tipo de pago: ${v('O')}`,
          `Comprobante: ${v('I')} (el PDF se sube a Drive, DFY - SKWD/Subidos, con ese nombre).`,
          // Sin cuenta, lo explica el pendiente "Cuenta: se deduce del comprobante…" (no se repite acá)
          ...(f.celdas.R ? [`Cuenta que recibió: ${f.celdas.R}`] : []),
          cuotas.length ? `Cuotas pendientes: ${cuotas.map((c) => `${fechaCorta(c.fecha)} ${usd(c.montoUsd)}`).join(' · ')}` : 'Sin cuotas pendientes.',
          ...f.pendientes.map((p) => `Pendiente: ${p}`),
          ...f.avisos.map((p) => `Revisar: ${p}`),
        ],
        humano: 'Aylu revisa la carga',
      }
    })(),
    {
      id: 'crm',
      titulo: 'Alta en el CRM de Clientes',
      detalle: [
        `Fila nueva en Agencia: ${nombre}, inicio ${fechaCorta(a.inicio)}, programa ${a.programa ?? 'Agencia'}.`,
        'Período 0 en Renovaciones y fórmulas copiadas, para que no quede sin fin de período ni LTV.',
      ],
      humano: null,
    },
    {
      id: 'drive',
      titulo: 'Carpeta de Drive',
      detalle: [`"${nombre} - C.J" con Guiones, Crudos y Editados, y un doc de bienvenida personalizado.`],
      humano: null,
    },
    {
      id: 'comunidad',
      titulo: 'Comunidad de WhatsApp',
      detalle: [
        `Comunidad "${nombre} - C.J" con foto y descripción.`,
        ...GRUPOS_COMUNIDAD.map((g) => `${g.nombre}: ${g.equipo.join(', ')} + cliente ${cliente}`),
      ],
      humano: 'Aylu confirma que quedó bien',
    },
    (() => {
      // Texto fijo (el mensaje oficial de Tomás, bienvenida.ts): no se aprueba. Solo si armarBienvenida deja avisos
      // (socios sin nombre, nombre sin género claro, falta el nombre o el correo) alguien lo mira antes de mandarlo.
      const avisos = bienvenida.avisos
      return {
        id: 'bienvenida',
        titulo: 'Mensaje de bienvenida',
        detalle: [
          `Mensaje oficial de Aylén en el grupo General con el video de Skool adjunto; bienvenido/a/os según el nombre; avisa que la invitación a Skool llega ${conSocios ? 'a los correos del cliente y de los socios' : 'al correo del #ALTA'}.`,
          ...avisos.map((x) => `Revisar: ${x}`),
        ],
        humano: avisos.length ? 'Revisar en Verificaciones C.J' : null,
      }
    })(),
    {
      // Invitación por correo (Tomás, 24/10/2026): el bot avisa en Verificaciones C.J (el mismo aviso de bienvenida.ts) y
      // Aylu pega el correo en Skool → Configuración → Invitar y toca "Enviar invitación". El cliente no pide nada.
      // Los socios también entran (Tomás, 24/10/2026): el aviso trae los correos de todos
      id: 'skool',
      titulo: 'Acceso a Skool',
      detalle: [
        `Aylu invita al cliente${conSocios ? ' y a sus socios' : ''} por correo desde Skool (Configuración → Invitar); acceso instantáneo, sin solicitud.`,
        `Aviso en Verificaciones C.J: "${bienvenida.avisoVerificaciones}"`,
      ],
      humano: 'Aylu envía la invitación',
    },
    (() => {
      const c = datosContrato(a)
      const nombre = c.destinatario.first_name || c.destinatario.last_name ? `${c.destinatario.first_name} ${c.destinatario.last_name}`.trim() : '(nombre)'
      return {
        id: 'contrato',
        titulo: 'Contrato en PandaDoc',
        detalle: [
          `Plantilla ${a.contrato === 'garantia' ? '"con GARANTÍA"' : 'normal'} para ${nombre}, a firmar por ${c.destinatario.email || '(correo)'}.`,
          `DNI ${a.dni ?? '—'} · inicio ${fechaCorta(a.inicio)} · dirección del cliente: ${a.direccion ?? '—'}.`,
          `Domicilio de Skyward: ${DIRECCION_ARGENTINA}.`,
          // El bot nunca lo envía solo (pandadoc.ts): deja el borrador y el closer lo revisa y confirma el envío
          ...(c.faltantes.length ? [`Le falta: ${c.faltantes.join(', ')} (el bot arroba al closer).`] : []),
          'Queda el borrador en PandaDoc; el closer lo revisa y confirma antes de mandarlo a firmar.',
        ],
        humano: c.faltantes.length ? 'El closer completa lo que falta y confirma el envío' : 'El closer revisa el borrador y confirma el envío',
      }
    })(),
    {
      id: 'saludos',
      titulo: 'Checklist de saludos',
      detalle: ['Gero M, Aylu, Gero A, Tomi y el closer saludan en el grupo y lo tildan en la ficha.'],
      humano: 'Cada uno tilda el suyo',
    },
  ]
  // Con un Fee esperan todos menos validar y Finanzas; sin el USD de un pago en pesos, con datos faltantes o con un OK
  // pendiente, todos menos validar (Finanzas tampoco: sin el USD no se sabe E ni si el concepto es "Fee" o "1ra Cuota").
  // Cada paso en espera dice por qué en su primera línea (no solo con el color).
  return pasos.map((p) => {
    const enEspera = fee ? !PASOS_CON_FEE.has(p.id) : estado !== 'lista' && p.id !== 'validar'
    const espera = enEspera ? [motivoEspera(estado, falta)] : []
    return { ...p, detalle: [...espera, ...p.detalle], enEspera }
  })
}
