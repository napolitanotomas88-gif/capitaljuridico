// ── Bot "Capital Jurídico": lo que muestra /clientes/altas de cada alta (26/10/2026) ─────────────────────────────────────
// Puro: de la fila del alta y sus pasos (almacén del motor) a lo que dibuja la pantalla. Para cada espera abierta, el mismo
// texto que hoy sale en Verificaciones C.J (o el pedido al closer) y las respuestas posibles, como botones:
//   · OK / NO con motivo, siempre;
//   · cuenta → "OK Tomi", "OK Gero", "OK Empresa"; MEP → "OK <número>"; fuente → "OK <fuente de la lista de Finanzas>";
//     nombre dudoso o carpeta → "OK" o "OK Nombre Apellido";
//   · un pedido al closer → formulario "una línea por dato" (y comprobante, si lo pide).
// Y lo que queda a mano con el número caído (comunidad, bienvenida, Skool), con lo que hace falta para hacerlo.
import { parsearAlta, leerSocios } from '../parsear'
import { armarBienvenida } from '../bienvenida'
import { OPCIONES_FUENTE } from '../finanzas'
import { NOMBRES_GRUPOS, nombreComunidad, nombreGrupo } from '../motor/comunidad'
import type { Espera, FilaAlta, FilaPaso } from '../motor/almacen'
import { esFinal } from '../motor/almacen'
import { PASOS, type PasoId } from '../motor/tipos'
import { PASOS_A_MANO, type PasoAMano } from './canal'
import { closerDeFila } from './aprobadores'
import { esAltaDelDespacho } from './evento'

export const TITULO_PASO: Record<PasoId, string> = {
  validar: 'Validar', finanzas: 'Finanzas', crm: 'CRM', drive: 'Drive', comunidad: 'Comunidad', bienvenida: 'Bienvenida', skool: 'Skool', contrato: 'Contrato',
}
export const TEXTO_ESTADO_ALTA: Record<FilaAlta['estado'], string> = {
  recibida: 'Recibida', en_curso: 'En curso', esperando_comprobante: 'Falta el comprobante', esperando_humano: 'Esperando una respuesta',
  esperando_reintento: 'Reintenta sola', fee: 'Fee: espera el pago siguiente', revisar: 'A revisar', lista: 'Lista', rechazada: 'Rechazada',
  reemplazada: 'Reemplazada', duplicada: 'Duplicada', simulada: 'Simulada (sin escribir nada)', vencida: 'Vencida',
}
export const TEXTO_ESTADO_PASO: Record<FilaPaso['estado'], string> = {
  pendiente: 'Pendiente', corriendo: 'Corriendo', hecho: 'Hecho', simulado: 'Simulado', espera: 'Espera respuesta', reintento: 'Reintenta', revisar: 'A revisar', omitido: 'Omitido',
}
export const QUIEN_TEXTO: Record<Espera['quien'], string> = {
  closer: 'Dato del closer', aprobadores: 'OK de Verificaciones', operaciones: 'OK de Aylu', equipo: 'OK del equipo',
}

export type Opcion =
  | { tipo: 'boton'; etiqueta: string; texto: string }
  | { tipo: 'numero'; etiqueta: string; prefijo: string; ayuda: string }
  | { tipo: 'lista'; etiqueta: string; prefijo: string; opciones: string[] }
  | { tipo: 'nombre'; etiqueta: string; prefijo: string; ayuda: string }
  | { tipo: 'no'; etiqueta: string }
  | { tipo: 'datos'; plantilla: string; conArchivos: boolean }

/** Las respuestas posibles de una espera (lo mismo que se escribe en WhatsApp citando el pedido). */
export function opcionesDe(e: Pick<Espera, 'quien' | 'motivo' | 'requiere' | 'tipos' | 'pedido'>): Opcion[] {
  if (e.quien === 'closer') {
    const lineas = e.pedido.filter((x) => !/comprobante/i.test(x)).map((x) => `${x.replace(/\s*\(.*\)\s*$/, '').trim()}: `)
    return [{ tipo: 'datos', plantilla: lineas.join('\n'), conArchivos: e.tipos.includes('comprobante') || e.pedido.some((x) => /comprobante/i.test(x)) }]
  }
  const out: Opcion[] = []
  if (e.requiere.includes('cuenta')) for (const c of ['Tomi', 'Gero', 'Empresa']) out.push({ tipo: 'boton', etiqueta: `OK ${c}`, texto: `OK ${c}` })
  if (e.requiere.includes('mep')) out.push({ tipo: 'numero', etiqueta: 'OK con el dólar MEP', prefijo: 'OK', ayuda: 'MEP de venta del día anterior al pago, por ejemplo 1450' })
  if (e.requiere.includes('fuente')) out.push({ tipo: 'lista', etiqueta: 'OK con la fuente', prefijo: 'OK', opciones: [...OPCIONES_FUENTE] })
  const conNombre = ['nombre', 'carpeta', 'nombre_drive'].includes(e.motivo)
  if (!out.length) out.push({ tipo: 'boton', etiqueta: 'OK', texto: 'OK' })
  if (conNombre) out.push({ tipo: 'nombre', etiqueta: 'OK con otro nombre', prefijo: 'OK', ayuda: 'Nombre Apellido, con mayúsculas' })
  out.push({ tipo: 'no', etiqueta: e.motivo === 'fee_suma' ? 'NO (sigue como Fee)' : 'NO' })
  return out
}

export interface EsperaVista {
  id: string; paso: PasoId; quien: Espera['quien']; quienTexto: string; texto: string; pedido: string[]; desde: string
  estado: Espera['estado']; opciones: Opcion[]; avisada: boolean
}
export interface AManoVista { paso: PasoAMano; titulo: string; estado: string; motivo: string | null; detalle: string[]; copiar: string | null }
export interface AltaVista {
  id: string; cliente: string; closer: string | null; estado: FilaAlta['estado']; estadoTexto: string; abierta: boolean; origen: 'despacho' | 'whatsapp'
  modo: FilaAlta['modo']; creado: string; actualizado: string; error: string | null; proximoIntento: string | null; notas: string[]
  pasos: { id: PasoId; titulo: string; estado: FilaPaso['estado']; estadoTexto: string; error: string | null }[]
  esperas: EsperaVista[]; aMano: AManoVista[]; comprobantes: number
}

const textoDe = (e: Espera) => String(e.datos?.texto ?? e.pedido.join('\n'))

/** Lo que queda a mano: comunidad, bienvenida y Skool que el motor dejó en reintento o a revisar (el número caído, el canal
 *  Despacho), y los que vienen después en ese orden. Un Fee solo arma la comunidad. Solo en altas reales que no terminaron. */
export function pasosAMano(alta: FilaAlta, pasos: Record<PasoId, FilaPaso>): PasoAMano[] {
  if (alta.modo !== 'real' || (esFinal(alta.estado) && alta.estado !== 'lista')) return []
  if (!['hecho', 'omitido'].includes(pasos.validar.estado)) return []
  const fee = alta.validacion?.estadoPlan === 'fee' || alta.estado === 'fee'
  const candidatos = (fee ? ['comunidad'] : [...PASOS_A_MANO]) as PasoAMano[]
  const out: PasoAMano[] = []
  let trabado = false
  for (const p of candidatos) {
    const est = pasos[p].estado
    if (['hecho', 'omitido', 'simulado'].includes(est)) continue
    if (['reintento', 'revisar'].includes(est)) trabado = true
    if (trabado) out.push(p)
  }
  return out
}

function detalleAMano(p: PasoAMano, alta: FilaAlta, pasos: Record<PasoId, FilaPaso>): Pick<AManoVista, 'titulo' | 'detalle' | 'copiar'> {
  let a: ReturnType<typeof parsearAlta>
  try { a = parsearAlta(alta.textoVigente) } catch { a = parsearAlta('') }
  const nombre = alta.validacion?.nombreConfirmado ?? a.nombre ?? alta.nombreCliente ?? 'el cliente'
  if (p === 'comunidad') {
    const res = (pasos.comunidad.resultado ?? pasos.comunidad.parcial) as { grupos?: Record<string, { invitacion?: string | null } | undefined> } | null
    const links = Object.entries(res?.grupos ?? {}).filter(([, g]) => g?.invitacion).map(([k, g]) => `${k}: ${g!.invitacion!.startsWith('http') ? g!.invitacion : `https://chat.whatsapp.com/${g!.invitacion}`}`)
    return {
      titulo: 'A mano: crear grupos',
      detalle: [`Comunidad "${nombreComunidad(nombre)}" con ${NOMBRES_GRUPOS.map((g) => `"${nombreGrupo(g, nombre)}"`).join(', ')}.`, 'Solo con el equipo (y el closer en General); al cliente se le pasa el link del General.', ...links],
      copiar: null,
    }
  }
  const b = armarBienvenida(a)
  if (p === 'bienvenida') return { titulo: 'A mano: bienvenida', detalle: ['Mensaje oficial con el video de Skool en el grupo General.', ...b.avisos], copiar: b.mensajeGrupo }
  const correos = [a.correo, ...leerSocios(a.socios).map((s) => s.correo)].filter(Boolean)
  return { titulo: 'A mano: Skool', detalle: [correos.length ? `Invitar por correo desde Skool: ${correos.join(', ')}` : 'Falta el correo del cliente para invitarlo a Skool.'], copiar: correos.join(', ') || null }
}

export function vistaDeAlta(alta: FilaAlta, pasos: Record<PasoId, FilaPaso>): AltaVista {
  const esperas = alta.esperas.filter((e) => e.estado === 'abierta' || (e.estado === 'simulada' && !esFinal(alta.estado)))
  return {
    id: alta.id, cliente: alta.validacion?.nombreConfirmado ?? alta.nombreCliente ?? '(sin nombre)', closer: closerDeFila(alta),
    estado: alta.estado, estadoTexto: TEXTO_ESTADO_ALTA[alta.estado] ?? alta.estado, abierta: !esFinal(alta.estado), origen: esAltaDelDespacho(alta) ? 'despacho' : 'whatsapp',
    modo: alta.modo, creado: alta.creado, actualizado: alta.actualizado, error: alta.error, proximoIntento: alta.proximoIntento, notas: alta.notas,
    pasos: PASOS.map((p) => ({ id: p, titulo: TITULO_PASO[p], estado: pasos[p].estado, estadoTexto: TEXTO_ESTADO_PASO[pasos[p].estado], error: pasos[p].error })),
    esperas: esperas.map((e) => ({
      id: e.id, paso: e.paso, quien: e.quien, quienTexto: QUIEN_TEXTO[e.quien], texto: textoDe(e), pedido: e.pedido, desde: e.desde, estado: e.estado,
      opciones: e.estado === 'abierta' ? opcionesDe(e) : [], avisada: !!e.avisoDespacho,
    })),
    aMano: pasosAMano(alta, pasos).map((p) => ({ paso: p, estado: TEXTO_ESTADO_PASO[pasos[p].estado], motivo: pasos[p].error, ...detalleAMano(p, alta, pasos) })),
    comprobantes: alta.medios.length,
  }
}
