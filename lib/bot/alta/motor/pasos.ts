import { encolarBeneficio, procesarBeneficio } from '@/lib/clientes/beneficiosPendientes'
// ── Bot "Capital Jurídico": un adaptador por paso del alta (diseño del motor, secciones 3.3 y 3.4) ─────────────────────
// Cada adaptador llama a las funciones que ya existen (parsearAlta, estadoAlta, filaRegistroPagos, cargarPagoFinanzas,
// escribirAltaCrm, prepararDriveCliente, crearBorradorContrato, armarBienvenida…) y traduce el resultado a una SalidaPaso:
// estado del paso, lo que se guarda, las esperas que abre, los avisos y lo que haría (seco/ensayo).
// Reglas de la revisión que se aplican acá:
//   · Finanzas congela la fila ENTERA (celdas A–R y nombre del archivo) antes del primer intento real y la reusa siempre:
//     buscarRepetido compara nombre, fecha y monto, y un cambio entre intentos cargaría otra fila (punto 2).
//   · CRM: el id se guarda solo si escribio === true (punto 1); duplicadoVigente en vez de comparar el texto.
//   · Contrato: un corte sin id se busca en PandaDoc por el nombre exacto antes de preguntar (punto 7).
//   · DFY+R con OK: Finanzas no la puede cargar (falta decidir "Back-end"): aviso a Aylu para que la cargue a mano (punto 23).
//   · MEP: no se guarda una cotización vieja si el día anterior es hábil y reciente (argentinadatos puede no haberlo
//     publicado todavía): se reintenta a las 2 h, hasta 3 veces (punto 28).
// Ningún adaptador tira: un error inesperado vuelve como reintento o revisar.
import { createHash } from 'node:crypto'
import { FALTANTE_CORREO_SOCIOS, esAvisoFee, esRenovacion, leerSocios, parsearAlta, type AltaParseada } from '../parsear'
import { avisosParaRevisar, estadoAlta, respuestaAlCloser, type ExtrasAlta } from '../plan'
import { conceptoPagoCliente, faltaMep, fechaDiaAnterior, filaRegistroPagos, usdDelPago, type FilaRegistroPagos } from '../finanzas'
import { motivoNombreDudoso } from '../nombreCliente'
import { telefonoDelCliente, CONTRATO_SIN_ENVIAR, entradaCrmDesdeAlta } from '../crm'
import { CARPETA_CLIENTES_DRIVE, aprobarCarpetaExistente, nombresDriveCliente, plantillaGuionesDesdeEntorno, type GuardadoDrive, type IntentoCarpeta, type ResultadoDriveCliente } from '../driveCliente'
import { ErrorBorrador, cuerpoBorrador, linkEdicion, nombreDocumento, textoAvisoBorrador } from '../pandadoc'
import { armarBienvenida, VIDEO_BIENVENIDA } from '../bienvenida'
import { VERSION_COMPROBANTE, compararComprobante, formatoComprobante, MAXIMO_ARCHIVO_BYTES, mismaPersona, type ComparacionComprobante } from '../comprobante'
import { esTransitorio } from '../../../fathomAnuncios/errores'
import { diasEntre, esYmdValido, hoyArgentina } from '../../../clientes/fechas'
import type { ResultadoCargaFinanzas } from '../finanzasEscribir'
import type { ResultadoEscrituraCrm } from '../crmEscribir'
import type { MepDiaAnterior } from '../mep'
import type { CambiosAlta, FilaAlta, Validacion } from './almacen'
import { validacionVacia } from './almacen'
import { extrasDeRespuesta } from './fusion'
import { esOpcionFuente, fuenteAOpcion, setterAOpcion } from '../setterFuente'
import { OPCIONES_FUENTE } from '../finanzas'
import type { CtxPaso } from './contexto'
import { restante } from './contexto'
import { esperaReintento, type EsperaNueva, type SalidaPaso } from './estado'
import { recortar, textoPedidoCloser, textoPedidoEquipo, textoRondaVerificaciones } from './mensajes'
import type { RefMedio } from './tipos'
import {
  esAltaLibreFila, esFeeLibre, primeraCuotaDe, resumenPago, textoCompletoPrimeraCuota, textoConfirmarAltaLibre, textoConfirmarFeeLibre,
  textoConfirmarPagoCliente, umbralAltaCompleta,
} from '../altaLibre'

const clon = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const iso = (ms: number) => new Date(ms).toISOString()
const r2 = (n: number) => Math.round(n * 100) / 100
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const mensaje = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
const tipoError = (e: unknown) => ((e as { name?: string })?.name === 'ErrorWhapi' ? (e as { tipo?: string }).tipo ?? null : null)

/** Parseo del texto vigente con el nombre confirmado (si lo hay). */
export function altaParseada(alta: FilaAlta): AltaParseada {
  const a = parsearAlta(alta.textoVigente)
  const n = alta.validacion?.nombreConfirmado
  return n ? { ...a, nombre: n } : a
}

/** Lo que Finanzas, el plan y el CRM necesitan además del #ALTA (sin la fecha). */
export function extrasDeAlta(alta: FilaAlta): ExtrasAlta {
  const v = alta.validacion
  const out: ExtrasAlta = {}
  if (!v) return out
  if (v.setter) out.setter = v.setter
  if (v.fuente) out.fuente = v.fuente
  if (v.cuenta) out.cuenta = v.cuenta
  if (v.comparacion?.extras.destinatario) out.destinatario = v.comparacion.extras.destinatario
  if (typeof v.comparacion?.extras.pesosArs === 'number') out.pesosArs = v.comparacion.extras.pesosArs
  if (v.mep) { out.mepDiaAnterior = v.mep.venta; if (esYmdValido(v.mep.fechaCotizacion)) out.fechaMep = v.mep.fechaCotizacion }
  return out
}

/** USD de un alta ya validada (para sumar un Fee). */
export function usdDeAlta(alta: FilaAlta): number | null {
  return usdDelPago(parsearAlta(alta.textoVigente), { ...extrasDeAlta(alta), ...(alta.fechaPago ? { fecha: alta.fechaPago } : {}) })
}

/** Lo que ya se pagó hasta esa alta: su `usdAcumulado` (si completaba otro Fee) o su propio pago. Revisión del 24/10: con
 *  solo "este pago" del alta anterior, un Fee en tres partes (150 + 160 + 250) nunca llegaba a 500. */
export function usdAcumuladoDe(alta: FilaAlta): number | null {
  return alta.validacion?.usdAcumulado ?? usdDeAlta(alta)
}

// ── Validar ──────────────────────────────────────────────────────────────────────────────────────────────────────

// El de los socios va antes que el de "Correo": con "Correo: …" el closer pisaría el correo del cliente. Con "Socios:" y
// "Nombre · correo" alcanza: la fusión lo suma al socio que ya estaba (por nombre, teléfono o correo) sin perder su teléfono.
const EJEMPLOS: [RegExp, string][] = [
  [/^Nombre/i, 'Nombre completo: Ana Pérez'], [/^Teléfono con código/i, 'Teléfono: +54 9 11 3000-1111'], [/^Teléfono/i, 'Teléfono: +54 9 11 3000-1111'],
  [new RegExp(`^${FALTANTE_CORREO_SOCIOS}`, 'i'), 'Socios:\nLaura Gómez · laura@ejemplo.com'],
  [/^Correo/i, 'Correo: ana@ejemplo.com'], [/^Tipo de pago/i, 'Tipo de pago: PP 3300 USD'], [/^Este pago/i, 'Este pago: 1100 USD · Transferencia'],
  [/^Inicio/i, 'Inicio del servicio: dd/mm/aaaa'], [/^Cuotas/i, 'Cuotas:\ndd/mm/aaaa 1100'], [/^DNI/i, 'DNI: 30111222'], [/^CUIT/i, 'CUIT: 20-30111222-3'],
  [/^Dirección/i, 'Dirección: calle 123, ciudad, provincia'], [/^Closer/i, 'Closer: Marcos'], [/^Setter/i, 'Setter: Tomi / Gero, Mai o ENRU / Mai'],
  [/^Comprobante/i, '(la imagen o el PDF del pago, citando este mensaje)'],
]
const ejemploDe = (f: string) => EJEMPLOS.find(([re]) => re.test(f))?.[1] ?? `${f.split(/[:(]/)[0].trim()}: …`

type CuentaRestoOk = 'Tomi' | 'Gero' | 'Empresa'

/** Un número escrito a mano, con el separador de miles argentino ("1.450", "1.450,50", "$1.450"), el inglés ("1,450.50")
 *  o sin separador ("1450", "1450,5"). null si no tiene ninguna de esas formas. */
export function numeroEscrito(s: string): number | null {
  const t = s.replace(/[$\s]/g, '').replace(/[.,]+$/, '')
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return Number(t.replace(/,/g, ''))
  if (/^\d+([.,]\d{1,2})?$/.test(t)) return Number(t.replace(',', '.'))
  return null
}

/** "OK Tomi 1450" → cuenta y MEP; el resto, tal cual. Revisión del 24/10: "OK 1.450" daba un MEP de 450 (tomaba lo que
 *  venía después del punto de miles) y pasaba el filtro de rango. */
export function leerRestoOk(resto: string): { cuenta: CuentaRestoOk | null; mep: number | null; texto: string } {
  const t = resto.trim()
  const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const cuenta = /\bempresa\b/.test(n) ? 'Empresa' : /\bgero\b|\bactis\b/.test(n) ? 'Gero' : /\btomi\b|\bnapolitano\b/.test(n) ? 'Tomi' : null
  let mep: number | null = null
  for (const c of t.match(/\$?\s?\d[\d.,]*/g) ?? []) {
    const x = numeroEscrito(c)
    if (x !== null && x > 100 && x < 100_000) { mep = x; break }
  }
  return { cuenta, mep, texto: t }
}

// Lo que se escribe después de un "OK" y no es un nombre ("OK, gracias", "OK listo", "OK 👍")
const RELLENO = new Set([
  'gracias', 'gracia', 'muchas', 'mil', 'listo', 'lista', 'dale', 'perfecto', 'perfecta', 'genial', 'joya', 'barbaro', 'buenisimo', 'buenisima',
  'correcto', 'correcta', 'confirmado', 'confirmada', 'confirmo', 'si', 'ok', 'okey', 'okay', 'oki', 'va', 'bien', 'todo', 'de', 'nada', 'ya',
  'esta', 'es', 'eso', 'asi', 'exacto', 'exacta', 'claro', 'super', 'sigue', 'segui', 'adelante', 'vamos', 'grande', 'capo', 'crack',
])
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der', 'y', 'e'])
const sinAcentos = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')

export type RestoNombre = { tipo: 'vacio' } | { tipo: 'nombre'; nombre: string } | { tipo: 'no_entendido' }
/** Qué hay después del "OK" en un pedido de nombre (nombre dudoso, carpeta que ya existía). Revisión del 24/10: antes TODO
 *  el resto era el nombre nuevo ("OK, gracias" → el cliente se llamaba "gracias" en Finanzas, el CRM, Drive y la comunidad).
 *  · vacío, solo signos o emojis, o palabras de relleno ("gracias", "listo", "es correcto") → un OK solo;
 *  · de 2 a 6 palabras, cada una con mayúscula inicial (las partículas "de", "la", "y"… van en minúscula en el medio) → nombre;
 *  · cualquier otra cosa ("OK, es una sola persona", "ok ana pérez") → no se entiende: se pide de nuevo, sin tocar nada. */
export function nombreDeResto(resto: string): RestoNombre {
  const t = resto.replace(/^[\s.,;:!¡¿?\-–—]+/, '').replace(/[\s.,;:!?]+$/, '').trim()
  if (!t || !/\p{L}/u.test(t)) return { tipo: 'vacio' }
  const palabras = t.split(/\s+/)
  if (palabras.every((w) => RELLENO.has(sinAcentos(w)) || !/\p{L}/u.test(w))) return { tipo: 'vacio' }
  const deNombre = (w: string, i: number) => {
    if (!/^\p{L}[\p{L}\p{M}'’.-]*$/u.test(w)) return false
    if (PARTICULAS.has(w.toLowerCase()) && i > 0 && i < palabras.length - 1) return true
    return /^\p{Lu}/u.test(w)
  }
  if (palabras.length >= 2 && palabras.length <= 6 && palabras.every(deNombre)) return { tipo: 'nombre', nombre: t }
  return { tipo: 'no_entendido' }
}

/** ¿Hábil? (lunes a viernes; los feriados no se conocen). */
const esHabil = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d >= 1 && d <= 5 }
export function mepFresco(m: MepDiaAnterior, hoy: string): boolean {
  return m.fechaCotizacion >= m.diaAnterior || !esHabil(m.diaAnterior) || diasEntre(m.diaAnterior, hoy) > 3
}

async function leerComprobante(ctx: CtxPaso, v: Validacion, a: AltaParseada, principal: RefMedio, hoy: string): Promise<{ comparacion: ComparacionComprobante } | { reintento: number; motivo: string }> {
  const fmt0 = formatoComprobante(principal.mime, principal.tamano, principal.paginas)
  if (!fmt0.ok) return { comparacion: { resultado: 'formato_no_soportado', diferencias: [`Comprobante en ${fmt0.motivo}: no se puede leer`], avisos: [], extras: {} } }
  const modelo = ctx.deps.modeloVision
  const clave = (sha: string) => `${sha}:${VERSION_COMPROBANTE}:${modelo}`
  let d = v.descargas[principal.id]
  let salida = d ? v.lecturas[clave(d.sha256)] : undefined
  if (!salida) {
    let medio
    try {
      medio = await ctx.whapi.descargarMedio(principal, { maxBytes: MAXIMO_ARCHIVO_BYTES, hasta: ctx.hasta })
    } catch (e) {
      if (tipoError(e) === 'no_encontrado') return { comparacion: { resultado: 'sin_lectura', diferencias: ['Whapi ya no tiene el archivo del comprobante: hay que mandarlo de nuevo'], avisos: [], extras: {} } }
      return { reintento: ctx.ahora() + 300_000, motivo: `no se pudo bajar el comprobante (${mensaje(e)})` }
    }
    d = { sha256: medio.sha256, bytes: medio.bytes, mime: medio.mime }
    v.descargas[principal.id] = d
    salida = v.lecturas[clave(d.sha256)]
    if (!salida) {
      const fmt = formatoComprobante(medio.mime, medio.bytes, principal.paginas)
      if (!fmt.ok) return { comparacion: { resultado: 'formato_no_soportado', diferencias: [`Comprobante en ${fmt.motivo}: no se puede leer`], avisos: [], extras: {} } }
      if (!ctx.deps.vision) return { comparacion: { resultado: 'sin_lectura', diferencias: [], avisos: ['Lectura del comprobante no disponible (sin Claude)'], extras: {} } }
      for (let intento = 0; ; intento++) {
        try {
          const l = await ctx.deps.vision(medio)
          salida = { modelo: l.modelo, version: VERSION_COMPROBANTE, sha256: d.sha256, salida: l.salida, motivo: null, en: iso(ctx.ahora()) }
          break
        } catch (e) {
          if (esTransitorio(e)) {
            if (intento === 0 && restante(ctx) > 60_000) continue
            return { reintento: ctx.ahora() + 300_000, motivo: `Claude no respondió (${mensaje(e)})` }
          }
          // Definitivo (rechazo, JSON roto…): se guarda para no volver a pagar la misma lectura
          salida = { modelo, version: VERSION_COMPROBANTE, sha256: d.sha256, salida: null, motivo: mensaje(e), en: iso(ctx.ahora()) }
          break
        }
      }
      v.lecturas[clave(d.sha256)] = salida
    }
  }
  v.sha256 = d.sha256
  // ¿El mismo archivo o el mismo n.º de operación ya se usó en otra alta? Su Fee también cuenta (revisión del 24/10: el
  // mismo comprobante del Fee mandado otra vez con un #ALTA nuevo se sumaba como un segundo pago). No cuentan las que nunca
  // escribieron nada: un reenvío ('duplicada'), una rechazada (el closer la vuelve a mandar corregida con la misma imagen)
  // ni una simulada.
  const ajenas = (xs: FilaAlta[]) => xs.filter((x) => x.id !== ctx.alta.id && !['duplicada', 'rechazada', 'simulada'].includes(x.estado))
  const mismoArchivo = ajenas(await ctx.almacen.buscarAltas({ sha256: d.sha256 }))[0]?.id ?? null
  const op = salida.salida?.numero_operacion?.trim() || null
  const mismaOperacion = op ? ajenas(await ctx.almacen.buscarAltas({ numeroOperacion: op }))[0]?.id ?? null : null
  if (!salida.salida) {
    const dif = [`No se pudo leer el comprobante: ${salida.motivo ?? 'sin detalle'}`]
    if (mismoArchivo) dif.push('El mismo archivo ya se usó en otra alta')
    return { comparacion: { resultado: 'ilegible', diferencias: dif, avisos: [], extras: {} } }
  }
  // Un comprobante que llegó sin citar se compara además con el nombre del cliente y de sus socios (revisión del 24/10, ronda 2)
  const nombres = [a.nombre, ...leerSocios(a.socios).map((x) => x.nombre)]
  // En otra moneda (guaraníes, etc.): la cotización del día del pago para compararlo con el USD del #ALTA (1/11/2026).
  // Si falla, compararComprobante lo marca como diferencia y lo mira un humano
  const sal = salida.salida
  let cotizacion = null
  if (sal.moneda === 'otra' && sal.moneda_iso && ctx.deps.cotizacion && ctx.modo !== 'seco') {
    const fecha = esYmdValido(sal.fecha) && sal.fecha <= hoy ? sal.fecha : hoy
    try { cotizacion = await ctx.deps.cotizacion(sal.moneda_iso, fecha) } catch { cotizacion = null }
  }
  return { comparacion: compararComprobante(sal, a, { hoy, operacionUsadaEn: mismaOperacion, archivoUsadoEn: mismoArchivo, sinCitar: !!principal.sinCitar, nombres, cotizacion }) }
}

export async function pasoValidar(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta
  const ahora = ctx.ahora()
  const hoy = hoyArgentina(new Date(ahora))
  const simulada = ctx.modo !== 'real'
  const v: Validacion = clon(alta.validacion ?? validacionVacia())
  const aCruda = parsearAlta(alta.textoVigente)
  // Un alta en formato libre no trae #ALTA (26/10/2026); a un #ALTA que lo perdió en una edición sí se le pide
  const libre = esAltaLibreFila(alta)
  if (!aCruda.etiquetaAlta && !libre) return { estado: 'omitido', terminarAlta: 'duplicada', resultado: { motivo: 'sin #ALTA' } }
  v.textoParseado = alta.textoVigente
  const a: AltaParseada = v.nombreConfirmado ? { ...aCruda, nombre: v.nombreConfirmado } : aCruda
  const avisos: string[] = [], registro: string[] = [], esperas: EsperaNueva[] = []
  const cambiosAlta: CambiosAlta = {}
  let reintento: number | null = null
  const motivosReintento: string[] = []
  const pedirReintento = (t: number, motivo: string) => { reintento = reintento === null ? t : Math.min(reintento, t); motivosReintento.push(motivo) }

  // 0. Confirmación (Tomás, 26/10/2026, lib/bot/alta/altaLibre.ts; las mismas reglas para el #ALTA y el formato libre).
  //    Antes de seguir se busca a la persona en el CRM de Clientes (regla A): si ya está, Verificaciones C.J confirma que se
  //    carga como pago de un cliente existente. Un alta en formato libre, además, no hace NADA hasta que confirmen que es un
  //    alta (o, si el pago ya es un Fee, la pregunta es la del Fee: regla B). Un #ALTA sin cliente en el CRM no pregunta nada
  //    acá. Una renovación (DFY+R) no se busca: el cliente ya está y tiene su propio camino. En seco o ensayo la pregunta queda
  //    anotada y el resto corre como vista previa.
  {
    const l = { ok: false, ...(v.confirmacion ?? {}) }
    v.confirmacion = l
    if (esRenovacion(a.programa)) { l.crmBuscado = true; l.cliente = null }
    if (!l.crmBuscado) {
      if (ctx.modo === 'seco' || !ctx.deps.clienteCrm) registro.push('buscaría a la persona en el CRM de Clientes (por nombre, teléfono y correo)')
      else {
        try { l.cliente = await ctx.deps.clienteCrm({ nombre: a.nombre, telefono: telefonoDelCliente(a)?.numero ?? null, correo: a.correo }); l.errorCrm = null }
        catch (e) { l.cliente = null; l.errorCrm = mensaje(e) }
        l.crmBuscado = true
        if (l.errorCrm && !libre) avisos.push(`No pude revisar si ${a.nombre ?? 'el cliente'} ya está en el CRM de Clientes (${l.errorCrm}): sigue como alta nueva`)
      }
    }
    if (!l.ok && !libre && !l.cliente) l.ok = true
    // El pago siguiente de un Fee ya confirmado (reglas C y D): ya se sabe quién es, no se pregunta de nuevo si es un alta
    const anterior = alta.altaAnterior ? ctx.anterior ?? null : null
    if (!l.ok && anterior && (anterior.validacion?.confirmacion?.ok || !esAltaLibreFila(anterior))) {
      l.ok = true
      registro.push(`pago siguiente del Fee ${anterior.id} (ya confirmado): no se vuelve a preguntar si es un alta`)
    }
    if (!l.ok) {
      const closer = a.closer ?? alta.autor?.nombre ?? null
      const fee = !l.cliente && esFeeLibre(a.estePagoUsd, primeraCuotaDe(a))
      const texto = (l.cliente ? textoConfirmarPagoCliente({ nombre: a.nombre, closer, usd: a.estePagoUsd, cliente: l.cliente })
        : fee ? textoConfirmarFeeLibre({ nombre: a.nombre, closer, usd: a.estePagoUsd })
          : textoConfirmarAltaLibre({ nombre: a.nombre, closer, pago: resumenPago(a) }))
        + (l.errorCrm ? `\n(No pude revisar si ya está en el CRM de Clientes: ${l.errorCrm}.)` : '')
      const pregunta: EsperaNueva = {
        paso: 'validar', motivo: 'confirmacion', tipos: ['ok_confirmacion'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [],
        pedido: [texto.split('\n')[0]], datos: { fee, cliente: !!l.cliente }, texto,
      }
      if (!simulada) return { estado: 'espera', esperas: [pregunta], cambiosAlta: { validacion: v }, registro, resultado: { estadoPlan: null, confirmacion: 'espera el OK' } }
      esperas.push(pregunta)
    }
  }

  // 1. Comprobante
  const principal = alta.medios[0] ?? null
  let comparacion: ComparacionComprobante | null = v.comparacion
  const preguntasComprobante: string[] = []
  let faltaComprobante = false
  if (!principal) {
    comparacion = null
    const fin3 = Date.parse(alta.creado) + 180_000
    if (!simulada && ahora < fin3) pedirReintento(fin3, 'espera 3 minutos por si el comprobante llega solo')
    else faltaComprobante = true
  } else if (ctx.modo === 'seco') {
    comparacion = { resultado: 'sin_lectura', diferencias: [], avisos: ['Lectura del comprobante no disponible (modo seco)'], extras: {} }
    registro.push('leería el comprobante con Claude y lo compararía con "Este pago"')
  } else {
    const r = await leerComprobante(ctx, v, a, principal, hoy)
    if ('reintento' in r) {
      pedirReintento(r.reintento, r.motivo)
      // Mientras no se lee, Verificaciones no recibe preguntas (abajo): a la tercera falla seguida se avisa una vez, así una
      // caída larga de Claude no queda en silencio
      v.fallasLectura = (v.fallasLectura ?? 0) + 1
      if (v.fallasLectura === 3) avisos.push(`No pude leer el comprobante de ${a.nombre ?? 'este cliente'} (${r.motivo}): lo sigo intentando solo. Si sigue así, revisarlo a mano.`)
    } else { comparacion = r.comparacion; v.fallasLectura = 0 }
  }
  v.comparacion = comparacion
  v.numeroOperacion = comparacion?.extras.numeroOperacion ?? v.numeroOperacion
  if (comparacion && !v.okComprobante) {
    if (comparacion.resultado !== 'coincide' && comparacion.resultado !== 'sin_lectura') preguntasComprobante.push(...(comparacion.diferencias.length ? comparacion.diferencias : [`Comprobante: ${comparacion.resultado}`]))
    if (comparacion.resultado === 'sin_lectura' && comparacion.diferencias.length) preguntasComprobante.push(...comparacion.diferencias)
    if (alta.medios.length > 1) preguntasComprobante.push(`Llegaron ${alta.medios.length} archivos: se usa el primero como comprobante (los otros no se cargan)`)
  }
  if (comparacion) avisos.push(...comparacion.avisos.filter((x) => !/modo seco/.test(x) || simulada))

  // 2. Fecha del pago: se congela una sola vez (buscarRepetido compara la fecha)
  const llegada = hoyArgentina(new Date(Date.parse(alta.creado)))
  let fechaPago = alta.fechaPago
  if (!fechaPago && (comparacion || ctx.modo === 'seco' || faltaComprobante)) {
    fechaPago = comparacion?.extras.fechaPago ?? llegada
    // Sin comprobante todavía no se congela. En seco o ensayo tampoco (revisión del 24/10): una lectura simulada congelaba la
    // fecha de llegada del #ALTA y, al rehacer el alta en real, Finanzas cargaba esa en vez de la del comprobante.
    if (comparacion && !simulada) cambiosAlta.fechaPago = fechaPago
  }
  const fechaUsada = fechaPago ?? llegada
  if (comparacion?.extras.fechaPago && Math.abs(diasEntre(llegada, comparacion.extras.fechaPago)) > 1) {
    avisos.push(`La fecha del comprobante (${comparacion.extras.fechaPago.split('-').reverse().join('/')}) y la del #ALTA (${llegada.split('-').reverse().join('/')}) difieren en más de un día: Finanzas usa la del comprobante (revisar si cae en un mes cerrado)`)
  }

  // 3. Lo que se sabe además del #ALTA
  const extras = (): ExtrasAlta => extrasDeAlta({ ...alta, validacion: v })

  // 4. MEP: todo pago en pesos lo necesita, aunque el closer haya escrito los USD al lado (Finanzas calcula E con él y el Fee
  //    se decide con ese USD: revisión del 24/10, ronda 2). Se busca recién con la fecha del pago (comprobante leído o fecha
  //    congelada: antes se pedía con la de llegada y no se corregía) y se vuelve a buscar si esa fecha cambió.
  const fechaSegura = !!alta.fechaPago || !!comparacion || ctx.modo === 'seco'
  if (v.mep && v.mep.fechaCotizacion !== 'manual' && fechaSegura && v.mep.diaAnterior !== fechaDiaAnterior(fechaUsada)) {
    registro.push(`el MEP guardado era del día anterior al ${v.mep.diaAnterior}: se busca el del día anterior al pago`)
    v.mep = null; v.mepIntentos = 0
  }
  let preguntaMep = false
  if (faltaMep(a, extras()) && !v.mep && fechaSegura) {
    if (ctx.modo === 'seco' || !ctx.deps.mep) {
      registro.push(`buscaría el dólar MEP del día anterior al ${fechaUsada.split('-').reverse().join('/')}`)
    } else {
      let m: MepDiaAnterior | null = null
      try { m = await ctx.deps.mep(fechaUsada) } catch { m = null }
      if (m && (mepFresco(m, hoy) || v.mepIntentos >= 2)) {
        v.mep = { venta: m.venta, fechaCotizacion: m.fechaCotizacion, diaAnterior: m.diaAnterior }
        if (!mepFresco(m, hoy)) avisos.push(`El MEP del ${m.diaAnterior.split('-').reverse().join('/')} no estaba publicado: se usó el del ${m.fechaCotizacion.split('-').reverse().join('/')}`)
      } else {
        v.mepIntentos++
        if (v.mepIntentos >= 3) preguntaMep = true
        else pedirReintento(ahora + (m ? 2 * 3600_000 : 1_800_000), m ? 'el MEP del día anterior todavía no está publicado' : 'no se pudo leer el MEP')
      }
    }
  }

  // 5. Setter y fuente (Tomás, 25/10/2026)
  //   · Setter: el "Setter:" del #ALTA si setterAOpcion lo traduce ("Maite" → "Mai"); si no, el del CRM de ventas; si no, al
  //     closer (lo que no se traduce se le sigue preguntando).
  //   · Fuente: la identifica el bot con los UTM del lead (CRM de ventas, regla en fuenteDeUtm). Lo que dijo el closer en
  //     "Fuente:" es respaldo: solo si los UTM no alcanzan. Si tampoco, se pregunta en Verificaciones C.J (nunca al closer).
  const tel = telefonoDelCliente(a)?.numero ?? null
  const exAlta = extrasDeRespuesta(alta.textoVigente)
  const avisarUnaVez = (x: string) => { v.avisos = v.avisos ?? []; if (!v.avisos.includes(x)) { v.avisos.push(x); avisos.push(x) } }
  if (!v.setter && exAlta.setter) {
    const op = setterAOpcion(exAlta.setter)
    if (op) { v.setter = op; v.origenSetterFuente = 'closer' }
    else avisarUnaVez(`El setter del #ALTA ("${recortar(exAlta.setter, 40)}") no está en la lista de Finanzas (Tomi / Gero, Mai o ENRU / Mai): se le pregunta al closer`)
  }
  if (exAlta.fuente && v.fuenteCloser == null) v.fuenteCloser = recortar(exAlta.fuente, 60)
  // El teléfono cambió desde la búsqueda (una corrección): lo que vino del CRM de ventas era de OTRO lead y se vuelve a buscar.
  // Lo que dijo el closer queda (revisión de la integración, ronda 3: Finanzas cargaba H y K del lead equivocado).
  const busq = v.busquedaSetter ?? null
  if (busq && busq.telefono !== tel) {
    if (busq.setter && v.setter === busq.setter) v.setter = null
    if (busq.fuente && v.fuente === busq.fuente && v.origenFuente !== 'aprobadores') { v.fuente = null; v.origenFuente = null }
    if (!v.setter && !v.fuente) v.origenSetterFuente = null
    v.utm = null; v.reglaFuente = null
    v.setterBuscado = false
    v.busquedaSetter = null
    registro.push('el teléfono del cliente cambió: setter y UTM se vuelven a buscar en el CRM de ventas')
  }
  // Una fuente "firme" (de los UTM o de un OK) no se vuelve a buscar; la del closer es respaldo y no frena la búsqueda.
  // Altas viejas sin `origenFuente`: la fuente que tengan se toma como firme.
  const fuenteFirme = () => !!v.fuente && v.origenFuente !== 'closer'
  if ((!v.setter || !fuenteFirme()) && !v.setterBuscado && tel && ctx.modo !== 'seco' && ctx.deps.setterFuente) {
    v.setterBuscado = true
    v.busquedaSetter = { telefono: tel, setter: null, fuente: null }
    try {
      const sf = await ctx.deps.setterFuente(tel, a.correo)
      if (sf?.setter && !v.setter) { v.setter = sf.setter; v.origenSetterFuente = 'crm_ventas'; v.busquedaSetter.setter = sf.setter }
      if (sf) { v.utm = sf.utm ?? null; v.reglaFuente = sf.reglaFuente ?? null }
      if (sf?.fuente && esOpcionFuente(sf.fuente) && !fuenteFirme()) {
        v.fuente = sf.fuente; v.origenFuente = 'utm'; v.origenSetterFuente = 'crm_ventas'; v.busquedaSetter.fuente = sf.fuente
        registro.push(`fuente por UTM: ${sf.reglaFuente ?? sf.fuente}`)
      } else if (sf && !fuenteFirme()) registro.push(`los UTM no alcanzan para la fuente: ${sf.reglaFuente ?? 'sin regla'}`)
      if (!sf) registro.push('el lead no está en el CRM de ventas (ni por teléfono ni por correo): sin UTM')
      if (sf && !sf.setter && sf.setterTexto && !v.setter) avisos.push(`El setter del CRM de ventas ("${sf.setterTexto}") no está en la lista de Finanzas: se le pregunta al closer`)
    } catch (e) {
      avisos.push(`No se pudo leer el CRM de ventas (${mensaje(e)}): el setter se le pregunta al closer y la fuente sale de lo que dijo el closer o se pregunta en Verificaciones`)
    }
  } else if ((!v.setter || !fuenteFirme()) && ctx.modo === 'seco' && tel) {
    registro.push('buscaría el setter y los UTM del lead (fuente) en el CRM de ventas por el teléfono del cliente')
  }
  // Respaldo: la fuente que dijo el closer (solo si los UTM no la dieron)
  if (!v.fuente && v.fuenteCloser) {
    const op = fuenteAOpcion(v.fuenteCloser)
    if (op) { v.fuente = op; v.origenFuente = 'closer'; registro.push(`fuente del closer (respaldo, sin UTM que alcancen): "${v.fuenteCloser}" → ${op}`) }
    else avisarUnaVez(`La fuente que dijo el closer ("${v.fuenteCloser}") no está en la lista de Finanzas: se pregunta en Verificaciones`)
  }
  const faltaSF = !v.setter ? ['Setter'] : []
  const faltaFuente = !v.fuente

  // 6. Cuenta que recibió (columna R)
  const fila = filaRegistroPagos(a, { ...extras(), fecha: fechaUsada })
  const faltaCuenta = !fila.celdas.R
  if (!faltaCuenta && !v.cuenta && typeof fila.celdas.R === 'string') v.origenCuenta = extras().destinatario ? 'comprobante' : 'medio'

  // 7. Estado del plan (los avisos que ya aprobaron Tomi o Gero no vuelven a frenar)
  const aprobado = (x: string) => v.okRevision.includes(x)
  const aPlan: AltaParseada = { ...a, avisos: a.avisos.filter((x) => !aprobado(x)) }
  let estado: Validacion['estadoPlan'] = estadoAlta(aPlan, extras())
  // Reglas del 26/10/2026 (#ALTA y formato libre): la primera cuota sale del mensaje o del alta del Fee anterior; un pago
  // menor que ella también es un Fee (regla B), y el de alguien que ya está en el CRM es un pago de un cliente existente (A)
  const primera = primeraCuotaDe(a) ?? ctx.anterior?.validacion?.primeraCuotaUsd ?? null
  v.primeraCuotaUsd = primera
  if (estado !== 'fee' && estado !== 'falta_usd' && !esRenovacion(a.programa) && esFeeLibre(usdDelPago(a, extras()), primera)) estado = 'fee'
  const preguntasRevision: string[] = []
  const datosRonda: Record<string, unknown> = {}
  // Fee + segundo pago (propuesta a confirmar con Tomás, decisión 1). `anteriorUsd` es lo ACUMULADO hasta el Fee anterior
  // (una cadena de 3 o más señas suma todo). La pregunta va en una ronda aparte (revisión del 24/10): su NO no rechaza el
  // alta, deja este pago como Fee (se carga igual en Finanzas) y el alta espera otro pago.
  let preguntaFeeSuma: string | null = null
  v.usdAcumulado = null   // se recalcula en cada validación (una corrección puede cambiar el pago)
  v.pagosFee = estado === 'fee' ? [usdDelPago(a, extras()) ?? 0] : null
  if (estado === 'fee' && ctx.anteriorUsd !== null && alta.altaAnterior) {
    const este = usdDelPago(a, extras()) ?? 0
    v.usdAcumulado = r2(este + ctx.anteriorUsd)
    // Regla C: se da el alta completa cuando los pagos llegan a la primera cuota (si no se sabe, al mínimo de USD 500)
    v.pagosFee = [...(ctx.anterior?.validacion?.pagosFee ?? [ctx.anteriorUsd]), este]
    if (v.usdAcumulado >= umbralAltaCompleta(primera) && !v.noFeeSuma) {
      if (!v.okFeeSuma) preguntaFeeSuma = `El Fee anterior (USD ${ctx.anteriorUsd}) más este pago (USD ${este}) suman USD ${v.usdAcumulado}`
      const sinFee: AltaParseada = { ...aPlan, estePagoUsd: v.usdAcumulado, pagoEnPesos: null, avisos: aPlan.avisos.filter((x) => !esAvisoFee(x)) }
      estado = estadoAlta(sinFee, {})
    }
  }
  if (v.confirmacion?.cliente && estado !== 'falta_usd') estado = 'pago_cliente'
  const renovacion = esRenovacion(a.programa) && estado !== 'pago_cliente'
  const revisar = estado === 'pago_cliente' ? [] : avisosParaRevisar(aPlan)
  if (revisar.length && estado !== 'fee') { preguntasRevision.push(...revisar); datosRonda.revision = revisar; if (renovacion) datosRonda.renovacion = true }
  if (renovacion && !v.okRenovacion && !revisar.length && estado !== 'fee') { preguntasRevision.push('Es una renovación (DFY+R): OK = solo se avisa a Aylu para cargarla a mano en Finanzas'); datosRonda.renovacion = true }

  // Closer: lo que falta del #ALTA (en un Fee, solo lo que Finanzas necesita) + el setter + el comprobante (la fuente no: va a Verificaciones)
  const delAlta = estado === 'faltan_datos' ? [...a.faltantes]
    : estado === 'fee' || estado === 'pago_cliente' ? fila.pendientes.filter((p) => /^(Nombre|Teléfono|Closer)/.test(p)).map((p) => p.split(':')[0])
      : []
  // Alta libre sin "Closer:" y con un autor que no está en BOT_ALTA_CLOSERS: el closer se pregunta (Finanzas lo necesita)
  if (libre && !a.closer && !delAlta.some((x) => /^Closer/.test(x))) delAlta.push('Closer')
  const faltanCloser = [...(faltaComprobante ? ['Comprobante del pago (imagen o PDF)'] : []), ...delAlta, ...faltaSF]
  if (faltanCloser.length) {
    esperas.push({
      paso: 'validar', motivo: 'datos', tipos: faltaComprobante ? ['comprobante', 'datos_closer'] : ['datos_closer'], grupo: 'ventas', quien: 'closer',
      pedido: faltanCloser, requiere: [], texto: textoPedidoCloser(a.nombre, faltanCloser, faltanCloser.map(ejemploDe)),
    })
  }
  // Sin el comprobante todavía (o sin poder leerlo: Claude no respondió y se reintenta), Verificaciones no se entera de nada:
  // el comprobante puede resolver la cuenta y las dudas (revisión del 24/10, ronda 2: con la lectura caída se preguntaba la
  // cuenta, y el OK quedaba por encima del destinatario que el comprobante decía después)
  const lecturaPendiente = !!principal && ctx.modo !== 'seco' && comparacion === null
  const sinComprobante = !principal || lecturaPendiente
  // Nombre dudoso: el equipo lo confirma (ronda aparte: la respuesta es texto libre)
  const dudoso = !v.nombreConfirmado && !sinComprobante ? motivoNombreDudoso(aCruda.nombre) : null
  if (dudoso) {
    esperas.push({
      paso: 'validar', motivo: 'nombre', tipos: ['ok_nombre'], grupo: 'verificaciones', quien: 'equipo', requiere: ['nombre'],
      pedido: [`El nombre "${(aCruda.nombre ?? '').trim()}" ${dudoso}: ¿es una sola persona?`],
      texto: textoRondaVerificaciones({ nombre: aCruda.nombre, closer: a.closer, preguntas: [`El nombre del #ALTA ${dudoso}: puede traer a más de una persona (los socios van en "Socios:"). Ese nombre va a Finanzas, el CRM, Drive, la comunidad y el contrato.`], requiere: ['nombre'] }),
    })
  }
  // Aprobadores: una sola ronda con todo lo que hace falta
  const requiere: ('cuenta' | 'mep' | 'fuente')[] = []
  const preguntas = [...preguntasComprobante]
  // "Cuenta: X" mandada en Ventas: nunca decide sola (revisión del 24/10: cualquiera que citara el pedido fijaba la columna
  // R, que define el reparto). Si no se sabe la cuenta va como dato en la pregunta; si contradice al comprobante, se pregunta.
  const sugerida = v.cuentaSugerida ?? null
  const cuentaSugerida = sugerida ? leerRestoOk(sugerida).cuenta : null
  if (faltaCuenta && !faltanCloser.length && estado !== 'faltan_datos') {
    preguntas.push(`No se sabe qué cuenta recibió el pago (Tomi, Gero o Empresa)${sugerida ? `. En Ventas dijeron: "${recortar(sugerida, 40)}"` : ''}`); requiere.push('cuenta')
  } else if (!faltaCuenta && !v.cuenta && cuentaSugerida && cuentaSugerida !== fila.celdas.R) {
    preguntas.push(`En Ventas dijeron que la cuenta que recibió es ${cuentaSugerida}, pero el comprobante indica ${String(fila.celdas.R)}`); requiere.push('cuenta')
  }
  // Fuente sin identificar (ni UTM ni closer): la deciden Tomi o Gero, en la misma ronda que la cuenta
  if (faltaFuente && !faltanCloser.length && estado !== 'faltan_datos') {
    const motivo = v.utm ? `con los UTM del lead no alcanza (${v.reglaFuente ?? `utm_medium "${v.utm.medium}", utm_campaign "${v.utm.campaign}", utm_source "${v.utm.source}"`})`
      : ctx.modo === 'seco' ? 'en seco no se buscan los UTM en el CRM de ventas'
        : v.setterBuscado ? 'el lead no tiene UTM en el CRM de ventas' : 'no se pudieron leer los UTM del CRM de ventas'
    preguntas.push(`No pude identificar la fuente del lead: ${motivo}${v.fuenteCloser ? `. El closer dijo: "${recortar(v.fuenteCloser, 40)}"` : ''}. Opciones: ${OPCIONES_FUENTE.join(', ')}`)
    requiere.push('fuente')
  }
  if (preguntaMep) { preguntas.push(`No pude leer el dólar MEP del día anterior al pago (${fechaUsada.split('-').reverse().join('/')}) después de 3 intentos`); requiere.push('mep') }
  preguntas.push(...preguntasRevision)
  // Teléfono de otra alta abierta con otro nombre: un #ALTA copiado de otro sin cambiar el teléfono (revisión del 24/10, ronda 2;
  // ronda 3: con `mismaPersona`, compartir el nombre de pila ya no alcanza para callar el aviso)
  if (tel && !sinComprobante) {
    const otra = (await ctx.almacen.buscarAltas({ telefonoCliente: tel, abiertas: true, entorno: alta.entorno }))
      .find((x) => x.id !== alta.id && !['duplicada', 'simulada'].includes(x.estado) && !mismaPersona(x.validacion?.nombreConfirmado ?? x.nombreCliente, a.nombre))
    const aviso = otra ? `El teléfono del cliente es el mismo del alta abierta de ${otra.validacion?.nombreConfirmado ?? otra.nombreCliente ?? 'otro cliente'}: revisar que no esté copiado de otro #ALTA (la comunidad se arma con ese teléfono)` : null
    if (aviso && !aprobado(aviso)) {
      preguntas.push(aviso)
      preguntasRevision.push(aviso)
      datosRonda.revision = [...((datosRonda.revision as string[] | undefined) ?? []), aviso]
    }
  }
  if (preguntas.length && !sinComprobante) {
    const tipos = [
      ...(preguntasComprobante.length ? ['ok_comprobante' as const] : []), ...(requiere.includes('cuenta') ? ['ok_cuenta' as const] : []),
      ...(requiere.includes('mep') ? ['ok_mep' as const] : []), ...(requiere.includes('fuente') ? ['ok_fuente' as const] : []), ...(preguntasRevision.length ? ['ok_revision' as const] : []),
    ]
    esperas.push({
      paso: 'validar', motivo: 'validar', tipos, grupo: 'verificaciones', quien: 'aprobadores', requiere,
      pedido: preguntas, datos: { ...datosRonda, comprobante: preguntasComprobante.length > 0 },
      texto: textoRondaVerificaciones({ nombre: a.nombre, closer: a.closer, preguntas, requiere }),
    })
  }
  if (preguntaFeeSuma && !sinComprobante) {
    // Regla C (Tomás, 26/10/2026): "Nadia Blanco completó la primera cuota (300 + 1000 = 1300 USD). ¿Sigo con el alta completa?"
    const texto = textoCompletoPrimeraCuota({ nombre: a.nombre, pagos: v.pagosFee ?? [ctx.anteriorUsd ?? 0], total: v.usdAcumulado ?? 0, primeraCuota: primera })
    esperas.push({
      paso: 'validar', motivo: 'fee_suma', tipos: ['ok_revision'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [],
      pedido: [texto.split('\n')[0]], datos: { feeSuma: true }, texto,
    })
  }

  // Fee (regla B, ajuste de Tomás del 26/10, #ALTA y formato libre): "¿Lo cargo en Finanzas y creo la comunidad?". Si la
  // primera pregunta de un alta libre ya fue la del Fee, su OK alcanza; si no, se pregunta con el comprobante leído.
  if (estado === 'fee' && !v.confirmacion?.okFee && !sinComprobante) {
    const texto = textoConfirmarFeeLibre({ nombre: a.nombre, closer: a.closer ?? alta.autor?.nombre ?? null, usd: usdDelPago(a, extras()) })
    esperas.push({ paso: 'validar', motivo: 'confirmacion', tipos: ['ok_confirmacion'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [], pedido: [texto.split('\n')[0]], datos: { fee: true }, texto })
  }

  // 8. Resultado
  const cuota = primera !== null ? ` (USD ${primera})` : ''
  v.estadoPlan = renovacion && estado !== 'fee' ? (v.okRenovacion ? 'renovacion' : 'necesita_ok') : estado
  const base: SalidaPaso = { estado: 'hecho', avisos, registro, cambiosAlta: { ...cambiosAlta, validacion: v }, resultado: { estadoPlan: v.estadoPlan, comparacion: comparacion?.resultado ?? null } }
  // Los primeros 3 minutos sin comprobante: no se pide nada (la imagen suele llegar sola enseguida)
  if (!simulada && !principal && !faltaComprobante && reintento !== null) return { ...base, estado: 'reintento', noAntesDe: iso(reintento), error: motivosReintento.join('; '), esperas: [] }
  if (simulada) {
    // Seco o ensayo: una sola pasada; lo que pediría queda anotado y el resto corre como vista previa
    for (const e of esperas) registro.push(`pediría ${e.grupo === 'ventas' ? 'al closer' : 'en Verificaciones'}: ${e.pedido.join('; ')}`)
    if (reintento !== null) registro.push(`reintentaría: ${motivosReintento.join('; ')}`)
    return { ...base, estado: 'simulado', esperas }
  }
  // La lectura del comprobante se reintenta aunque el closer tenga algo pendiente (si no, 'espera' la frenaba hasta su respuesta)
  if (esperas.length && lecturaPendiente && reintento !== null) return { ...base, estado: 'reintento', noAntesDe: iso(reintento), error: motivosReintento.join('; '), esperas }
  if (esperas.length) return { ...base, estado: 'espera', esperas }
  if (reintento !== null) return { ...base, estado: 'reintento', noAntesDe: iso(reintento), error: motivosReintento.join('; ') }
  if (v.estadoPlan === 'falta_usd') return { ...base, estado: 'reintento', noAntesDe: iso(ahora + 1_800_000), error: 'falta el USD del pago en pesos' }
  if (v.estadoPlan === 'faltan_datos' || v.estadoPlan === 'necesita_ok') return { ...base, estado: 'reintento', noAntesDe: iso(ahora + 60_000), error: `plan ${v.estadoPlan} sin pedido` }
  // Lista, Fee o renovación aprobada
  const mensajes = []
  if (!v.arranqueAvisado) {
    v.arranqueAvisado = true
    const texto = v.estadoPlan === 'renovacion'
      ? `Recibí la renovación de ${a.nombre ?? 'este cliente'}: Aylu la carga en Finanzas a mano. No se crean CRM, Drive ni comunidad nuevos.`
      : v.estadoPlan === 'pago_cliente'
        ? `Registro el pago de ${a.nombre ?? 'este cliente'} en Finanzas: ya es cliente (${v.confirmacion?.cliente?.id ?? 'CRM de Clientes'}). No se crea nada nuevo.`
        : estado === 'fee'
          ? `Recibí el pago de ${a.nombre ?? 'este cliente'}: USD ${usdDelPago(a, extras()) ?? '?'} es un Fee (seña). Lo cargo en Finanzas y armo la comunidad de WhatsApp; el alta completa (CRM, Drive, Skool, bienvenida y contrato) sigue cuando se complete la primera cuota${cuota}.`
          : respuestaAlCloser({ ...a, avisos: a.avisos.filter((x) => !v.okRevision.includes(x) || esAvisoFee(x)) }, extras())
    mensajes.push({ proposito: `closer:${v.estadoPlan}`, destino: 'ventas' as const, texto, citarAlta: true })
  }
  if (estado === 'fee') base.avisos!.push(`Fee de ${a.nombre ?? 'este cliente'}: USD ${usdDelPago(a, extras()) ?? '?'}${v.usdAcumulado !== null ? ` (con los pagos anteriores, USD ${v.usdAcumulado})` : ''}. Se carga en Finanzas y se arma la comunidad; el alta completa sigue cuando se complete la primera cuota${cuota}.`)
  return { ...base, mensajes }
}

// ── Finanzas ─────────────────────────────────────────────────────────────────────────────────────────────────────

const comparable = (f: FilaRegistroPagos) => JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'N', 'O', 'R'].map((c) => f.celdas[c as keyof typeof f.celdas]))

export async function pasoFinanzas(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta, a = altaParseada(alta)
  const nombre = a.nombre ?? 'el cliente'
  if (alta.validacion?.estadoPlan === 'renovacion') {
    return { estado: 'omitido', resultado: { motivo: 'renovacion' }, avisos: [`${nombre}: es una renovación (DFY+R). El bot no la carga en Finanzas hasta que Tomás decida si va "Back-end": Aylu, cargala a mano.`] }
  }
  const fila = filaRegistroPagos(a, { ...extrasDeAlta(alta), fecha: alta.fechaPago ?? hoyArgentina(new Date(ctx.ahora())) })
  // Reglas del 26/10/2026: un Fee es "Fee" aunque pase los USD 500 (pago parcial de la primera cuota, regla B), y el pago de
  // un cliente que ya está en el CRM va como la cuota que sigue a las suyas del Registro ("2da Cuota", "3ra Cuota"…: regla A).
  // Ese número se calcula una sola vez y queda en `parcial` (si no, la fila congelada no coincidiría después de cargarla).
  const plan = alta.validacion?.estadoPlan
  let concepto: string | null = plan === 'fee' ? 'Fee' : null
  if (plan === 'pago_cliente') {
    const guardado = ctx.paso.parcial?.conceptoCuota
    if (typeof guardado === 'string') concepto = guardado
    else if (ctx.modo === 'seco' || !ctx.deps.cuotasAnteriores) concepto = conceptoPagoCliente(1)
    else {
      try {
        concepto = conceptoPagoCliente(await ctx.deps.cuotasAnteriores({ nombre: a.nombre, telefono: telefonoDelCliente(a)?.numero ?? null }))
        if (ctx.real) await ctx.guardarParcial({ ...(ctx.paso.parcial ?? {}), conceptoCuota: concepto })
      } catch (e) {
        return reintentoLectura(ctx, 'lectura', `no se pudieron contar las cuotas anteriores en Finanzas (${mensaje(e)})`)
      }
    }
  }
  if (concepto && fila.celdas.J !== concepto) {
    fila.celdas.J = concepto; fila.fila[9] = concepto
    if (concepto === 'Fee' && a.nombre) { fila.celdas.I = `${a.nombre} - Fee`; fila.fila[8] = fila.celdas.I }
  }
  // Una seña que sigue a otra (cadena de Fee): "<Nombre> - Fee 2", "- Fee 3"… Con el mismo nombre, el puente devolvía el
  // archivo de la primera seña y el chip de la col I quedaba en ese comprobante (revisión del 24/10, ronda 2)
  if (fila.celdas.J === 'Fee' && typeof fila.celdas.I === 'string' && fila.celdas.I && alta.altaAnterior) {
    const n = await posicionEnCadena(ctx)
    if (n > 1) { fila.celdas.I = `${fila.celdas.I} ${n}`; fila.fila[8] = fila.celdas.I }
  }
  const resumen = `Finanzas: ${fila.celdas.C || nombre} · USD ${fila.celdas.E === '' ? '?' : fila.celdas.E} · ${fila.celdas.B || 'programa ?'} · ${fila.celdas.J || 'concepto ?'} · cuenta ${fila.celdas.R || '?'}`
  if (!ctx.real) {
    if (ctx.modo === 'seco' || !ctx.deps.finanzas) {
      return { estado: 'simulado', resultado: { vista: fila.celdas, pendientes: fila.pendientes, avisos: fila.avisos }, registro: [`haría: ${resumen}${fila.pendientes.length ? ` (faltan: ${fila.pendientes.join('; ')})` : ''}`] }
    }
    const r = await ctx.deps.finanzas(fila, null, { modo: 'simulacion' }).catch((e) => ({ ok: false, motivo: mensaje(e) }) as Partial<ResultadoCargaFinanzas>)
    return { estado: 'simulado', resultado: { ok: r.ok ?? false, motivo: r.motivo ?? null, avisos: r.avisos ?? [] }, registro: [`haría: ${resumen}${r.ok ? '' : ` (frenaría: ${r.motivo})`}`] }
  }

  // Real: la fila congelada manda
  const parcial = ctx.paso.parcial ?? {}
  const congelada = parcial.fila as FilaRegistroPagos | undefined
  if (congelada && comparable(congelada) !== comparable(fila) && !parcial.aceptarCongelada) {
    return {
      estado: 'espera', resultado: ctx.paso.resultado,
      esperas: [{
        paso: 'finanzas', motivo: 'finanzas_cambio', tipos: ['ok_revision'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [],
        pedido: ['Cambiaron datos después del primer intento de cargar el pago: el bot sigue con los de ese intento (si no, podría cargarlo dos veces)'],
        texto: textoPedidoEquipo({ nombre: a.nombre, titulo: 'cambiaron datos que van a Finanzas después del primer intento de carga.', detalle: [`Se carga con: ${congelada.celdas.C} · USD ${congelada.celdas.E} · ${congelada.celdas.J} · cuenta ${congelada.celdas.R}`], ok: 'seguir con esos datos (lo demás se corrige a mano)', no: 'frenar Finanzas' }),
      }],
    }
  }
  const usar = congelada ?? fila
  // Comprobante: se vuelve a bajar (Whapi lo guarda 30 días)
  let comprobante = null
  const principal = alta.medios[0]
  if (principal) {
    try {
      const m = await ctx.whapi.descargarMedio(principal, { maxBytes: MAXIMO_ARCHIVO_BYTES, hasta: ctx.hasta })
      comprobante = { nombre: m.nombre || principal.nombreArchivo || 'comprobante', mimeType: m.mime, base64: m.base64 }
    } catch (e) {
      return reintentoLectura(ctx, 'comprobante', `no se pudo bajar el comprobante (${mensaje(e)})`)
    }
  }
  // La fila se congela recién antes del primer pedido que puede escribir (revisión del 24/10): congelada antes de bajar el
  // comprobante, una corrección que llegaba después de una bajada fallida se tomaba "antes de escribir nada" pero Finanzas
  // seguía cargando los datos viejos.
  if (!congelada) await ctx.guardarParcial({ fila: usar })
  // Primer intento: un archivo con el mismo nombre en Subidos es de otro pago (se sube con " (2)"). En los siguientes, el
  // nombre que eligió el primero (si no, el reintento encontraría el de otro pago con el nombre sin sufijo)
  const nombreArchivo = typeof parcial.nombreArchivo === 'string' ? parcial.nombreArchivo : null
  let r: ResultadoCargaFinanzas
  try {
    r = await ctx.deps.finanzas!(usar, comprobante, { modo: 'real', hasta: ctx.hasta, archivoNuevo: !congelada, ...(nombreArchivo ? { nombreArchivo } : {}) })
  } catch (e) {
    return reintentoLectura(ctx, 'lectura', mensaje(e))
  }
  const s = interpretarFinanzas(r, { huboCorriendo: ctx.huboCorriendo, intentos: Number(parcial.intentosLectura ?? 0), nombre: a.nombre, ahora: ctx.ahora() })
  // Falló antes de tocar nada afuera (lectura o controles, sin repetido ni subida): se descongela, y el próximo intento
  // usa los datos que haya entonces
  if (!congelada && !r.ok && !r.escribio && !r.repetido && !r.noReintentarAntesDe && !r.comprobanteId && (r.etapa === 'lectura' || r.etapa === 'control')) {
    return { ...s, parcial: { ...(s.parcial ?? {}), fila: null, nombreArchivo: null } }
  }
  if (!congelada && r.nombreArchivo) return { ...s, parcial: { ...(s.parcial ?? {}), nombreArchivo: r.nombreArchivo } }
  return s
}

/** Qué seña de la cadena es esta alta: 1 + las altas anteriores que completa (altaAnterior → altaAnterior…, hasta 10). */
async function posicionEnCadena(ctx: CtxPaso): Promise<number> {
  let n = 1
  let id = ctx.alta.altaAnterior
  const vistos = new Set<string>([ctx.alta.id])
  while (id && !vistos.has(id) && n < 11) {
    vistos.add(id)
    const x = await ctx.almacen.leerAlta(id).catch(() => null)
    if (!x) break
    n++
    id = x.altaAnterior
  }
  return n
}

function reintentoLectura(ctx: CtxPaso, etapa: string, motivo: string): SalidaPaso {
  const n = Number(ctx.paso.parcial?.intentosLectura ?? 0)
  const espera = esperaReintento(n)
  if (espera === null) return revisarCon(ctx.paso.paso, ctx.alta, `falló ${n + 1} veces (${etapa}): ${motivo}`, { intentosLectura: n + 1 })
  return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + espera), error: `${etapa}: ${motivo}`, parcial: { intentosLectura: n + 1 } }
}

/** Paso a revisar + la espera "ok_revisar" (OK = ya lo arreglé, seguí). */
export function revisarCon(paso: CtxPaso['paso']['paso'], alta: FilaAlta, motivo: string, parcial?: Record<string, unknown>, resultado?: unknown): SalidaPaso {
  const nombre = alta.validacion?.nombreConfirmado ?? alta.nombreCliente
  return {
    estado: 'revisar', error: motivo, ...(parcial ? { parcial } : {}), ...(resultado !== undefined ? { resultado } : {}),
    esperas: [{
      paso, motivo: 'revisar', tipos: ['ok_revisar'], grupo: 'verificaciones', quien: 'equipo', requiere: [], pedido: [`${paso}: ${motivo}`],
      texto: textoPedidoEquipo({ nombre, titulo: `el paso "${paso}" quedó a medias y no se reintenta solo.`, detalle: [motivo], ok: 'ya lo revisé/arreglé a mano, seguí', no: 'dejarlo sin hacer' }),
    }],
  }
}

export function interpretarFinanzas(r: ResultadoCargaFinanzas, c: { huboCorriendo: boolean; intentos: number; nombre: string | null; ahora: number }): SalidaPaso {
  const guardado = {
    ok: r.ok, etapa: r.etapa, motivo: r.motivo, escribio: r.escribio, fila: r.fila, comprobanteId: r.comprobanteId, comprobanteUrl: r.comprobanteUrl,
    comprobanteYaExistia: r.comprobanteYaExistia, noReintentarAntesDe: r.noReintentarAntesDe, nombreArchivo: r.nombreArchivo, chip: r.chip, avisos: r.avisos, repetido: r.repetido,
  }
  const nombre = c.nombre ?? 'el cliente'
  if (r.ok) return { estado: 'hecho', resultado: guardado, avisos: [`Finanzas: pago de ${nombre} cargado en la fila 2 de "Registro de Pagos"${r.comprobanteUrl ? ` (comprobante: ${r.comprobanteUrl})` : ''}. Aylu, revisalo.${r.avisos.length ? ` Avisos: ${r.avisos.join(' · ')}` : ''}`] }
  if (r.repetido) {
    if (c.huboCorriendo) return { estado: 'hecho', resultado: guardado, avisos: [`Finanzas: el pago de ${nombre} ya estaba en la fila ${r.repetido.fila}: es la carga de una corrida anterior que se cortó. Aylu, revisalo.`] }
    return {
      estado: 'espera', resultado: guardado,
      esperas: [{
        paso: 'finanzas', motivo: 'finanzas_repetido', tipos: ['ok_revision'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [],
        pedido: [`Ya había un pago igual en la fila ${r.repetido.fila} de "Registro de Pagos"`],
        texto: textoPedidoEquipo({ nombre: c.nombre, titulo: `ya había un pago igual (mismo cliente, fecha y monto) en la fila ${r.repetido.fila} de "Registro de Pagos".`, detalle: ['¿Lo cargó alguien a mano?'], ok: 'seguir sin cargarlo de nuevo', no: 'frenar Finanzas para revisarlo' }),
      }],
    }
  }
  if (r.escribio) return revisarCon('finanzas', { validacion: null, nombreCliente: c.nombre } as unknown as FilaAlta, r.motivo ?? 'la carga quedó a medias', undefined, guardado)
  if (r.noReintentarAntesDe) return { estado: 'reintento', resultado: guardado, noAntesDe: r.noReintentarAntesDe, dudoso: true, error: r.motivo }
  if (r.etapa === 'lectura' || r.etapa === 'comprobante') {
    const espera = esperaReintento(c.intentos)
    if (espera === null) return revisarCon('finanzas', { validacion: null, nombreCliente: c.nombre } as unknown as FilaAlta, r.motivo ?? 'no se pudo cargar', { intentosLectura: c.intentos + 1 }, guardado)
    return { estado: 'reintento', resultado: guardado, noAntesDe: iso(c.ahora + espera), error: r.motivo, parcial: { intentosLectura: c.intentos + 1 } }
  }
  return revisarCon('finanzas', { validacion: null, nombreCliente: c.nombre } as unknown as FilaAlta, r.motivo ?? 'Finanzas frenó la carga', undefined, guardado)
}

// ── CRM de Clientes ──────────────────────────────────────────────────────────────────────────────────────────────

export async function pasoCrm(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta, v = alta.validacion
  const a0 = altaParseada(alta)
  const ex = { ...extrasDeAlta(alta), ...(alta.fechaPago ? { fecha: alta.fechaPago } : {}) }
  // Pago en pesos (lo diga el #ALTA o el comprobante): el CRM recibe el USD del MEP, no el que escribió el closer
  const enPesos = !!a0.pagoEnPesos || ex.pesosArs !== undefined
  const usdMep = v?.usdAcumulado ?? (enPesos ? usdDelPago(a0, ex) : null)
  const a: AltaParseada = v?.usdAcumulado ? { ...a0, estePagoUsd: v.usdAcumulado } : a0
  const extras = {
    fuente: v?.fuente ?? undefined, contrato: CONTRATO_SIN_ENVIAR, mensaje: alta.textoVigente, hoy: hoyArgentina(new Date(ctx.ahora())),
    ...(usdMep !== null && (enPesos || v?.usdAcumulado) ? { estePagoUsdMep: usdMep } : {}),
  }
  if (!ctx.real) {
    if (ctx.modo === 'seco' || !ctx.deps.crm) {
      const m = entradaCrmDesdeAlta(a, extras)
      return { estado: 'simulado', resultado: { entrada: m.entrada, faltantes: m.faltantes, bloqueos: m.bloqueos }, registro: [`haría: alta en el CRM de Clientes (${m.entrada.nombre || 'sin nombre'}, Día 1 ${m.entrada.dia1 || '?'})${m.bloqueos.length ? ` — frenaría: ${m.bloqueos.map((b) => b.motivo).join(', ')}` : ''}`] }
    }
    const r = await ctx.deps.crm(a, extras, { modo: 'simulacion' }).catch((e) => ({ ok: false, motivo: mensaje(e), id: null }) as Partial<ResultadoEscrituraCrm>)
    return { estado: 'simulado', resultado: { ok: r.ok, motivo: r.motivo ?? null, id: r.id ?? null }, registro: [`haría: alta en el CRM de Clientes con el ID ${r.id ?? '?'}${r.ok ? '' : ` (frenaría: ${r.motivo})`}`] }
  }
  const parcial = ctx.paso.parcial ?? {}
  const beneficioDeAlta = async (id: string) => {
    if (v?.fuente !== 'Referido' || esRenovacion(a.programa)) return
    const pedido = { idCrm: id, origen: 'alta' as const, quien: 'Bot de altas' }
    await encolarBeneficio(pedido)
    await procesarBeneficio(pedido)
  }
  if (typeof parcial.id === 'string' && parcial.id) {
    try { await beneficioDeAlta(parcial.id) } catch { return reintentoLectura(ctx, 'lectura', 'El cliente está creado; falta confirmar el mes adicional del referido.') }
    return { estado: 'hecho', resultado: ctx.paso.resultado ?? { id: parcial.id } }
  }
  let r: ResultadoEscrituraCrm
  try {
    r = await ctx.deps.crm!(a, extras, { modo: 'real' })
  } catch (e) {
    return reintentoLectura(ctx, 'lectura', mensaje(e))
  }
  if (r.escribio && r.id && v?.fuente === 'Referido' && !esRenovacion(a.programa)) {
    await ctx.guardarParcial({ ...parcial, id: r.id })
    try { await beneficioDeAlta(r.id) } catch { return reintentoLectura(ctx, 'lectura', 'El cliente está creado; falta confirmar el mes adicional del referido.') }
  }
  return interpretarCrm(r, { huboCorriendo: ctx.huboCorriendo, nombre: a.nombre, alta, ahora: ctx.ahora(), intentos: Number(parcial.intentosLectura ?? 0) })
}

export function interpretarCrm(r: ResultadoEscrituraCrm, c: { huboCorriendo: boolean; nombre: string | null; alta: FilaAlta; ahora: number; intentos: number }): SalidaPaso {
  const guardado = {
    ok: r.ok, etapa: r.etapa, motivo: r.motivo, escribio: r.escribio, id: r.escribio ? r.id : null, filaAgencia: r.filaAgencia, filaRenovaciones: r.filaRenovaciones,
    avisos: r.avisos, bloqueos: r.previa?.bloqueos ?? [], faltantes: r.previa?.faltantes ?? [], duplicadoVigente: r.duplicadoVigente,
  }
  // El id se guarda SOLO si se escribió (punto 1: crmEscribir lo devuelve aunque no haya escrito)
  const parcial = r.escribio && r.id ? { id: r.id } : undefined
  if (r.ok) return { estado: 'hecho', resultado: guardado, parcial, avisos: [`CRM de Clientes: ${c.nombre ?? 'el cliente'} cargado con el ID ${r.id} (Agencia fila ${r.filaAgencia}).`] }
  if (r.escribio) return revisarCon('crm', c.alta, r.motivo ?? 'la escritura quedó a medias', parcial, guardado)
  if (r.duplicadoVigente) {
    if (c.huboCorriendo) return revisarCon('crm', c.alta, `ya hay un cliente vigente con ese ${r.duplicadoVigente.motivo} (${r.duplicadoVigente.id}): puede ser la fila de una corrida anterior que se cortó`, undefined, guardado)
    return {
      estado: 'espera', resultado: guardado,
      esperas: [{
        paso: 'crm', motivo: 'crm_duplicado', tipos: ['ok_revision'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [],
        pedido: [`Ya hay un cliente vigente con ese ${r.duplicadoVigente.motivo} en el CRM (${r.duplicadoVigente.id})`],
        texto: textoPedidoEquipo({ nombre: c.nombre, titulo: `ya hay un cliente vigente con ese ${r.duplicadoVigente.motivo} en el CRM de Clientes (${r.duplicadoVigente.id}).`, detalle: [], ok: 'no crear otro y seguir con el alta', no: 'frenar el CRM' }),
      }],
    }
  }
  const confirmar = (r.previa?.bloqueos ?? []).filter((b) => b.motivo === 'confirmar')
  if (confirmar.length) {
    return {
      estado: 'espera', resultado: guardado,
      esperas: [{
        paso: 'crm', motivo: 'crm_confirmar', tipos: ['ok_revision'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [], pedido: confirmar.map((b) => b.detalle),
        texto: textoPedidoEquipo({ nombre: c.nombre, titulo: 'el CRM de Clientes pide confirmar algo antes de cargarlo.', detalle: confirmar.map((b) => b.detalle), ok: 'seguir sin cargar el CRM (se carga a mano)', no: 'frenar el CRM' }),
      }],
    }
  }
  // Otra carga se metió entre la lectura y la escritura ("La fila N ya tiene datos", "El ID C-x ya está"), sin escribir nada:
  // se reintenta con una lectura nueva (la de recién se reusa 30 s y vale 60 s), no se manda a revisar (revisión del 24/10,
  // ronda 2: el OK de esa espera marcaba el CRM hecho y el cliente nunca se cargaba)
  const choque = !r.escribio && /en el medio/i.test(r.motivo ?? '')
  if (choque) {
    const espera = esperaReintento(c.intentos)
    if (espera === null) return revisarCon('crm', c.alta, r.motivo ?? 'otra carga se metió en el medio', { intentosLectura: c.intentos + 1 }, guardado)
    return { estado: 'reintento', resultado: guardado, noAntesDe: iso(c.ahora + Math.max(90_000, espera)), error: r.motivo, parcial: { intentosLectura: c.intentos + 1 } }
  }
  if (/fresca|leer|lectura/i.test(r.motivo ?? '') || r.etapa === 'previa' || r.etapa === 'control' && /releer/i.test(r.motivo ?? '')) {
    const espera = esperaReintento(c.intentos) === null ? null : 60_000
    if (espera === null) return revisarCon('crm', c.alta, r.motivo ?? 'no se pudo leer el CRM', { intentosLectura: c.intentos + 1 }, guardado)
    return { estado: 'reintento', resultado: guardado, noAntesDe: iso(c.ahora + espera), error: r.motivo, parcial: { intentosLectura: c.intentos + 1 } }
  }
  return revisarCon('crm', c.alta, r.motivo ?? 'el CRM frenó el alta', undefined, guardado)
}

// ── Drive ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function pasoDrive(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta
  const a = parsearAlta(alta.textoVigente)
  const parcial = ctx.paso.parcial ?? {}
  const guardado = (parcial.guardado as GuardadoDrive | undefined) ?? null
  let intentoCarpeta = (parcial.intentoCarpeta as IntentoCarpeta | null | undefined) ?? null
  const nombreConfirmado = (parcial.nombreDrive as string | undefined) ?? alta.validacion?.nombreConfirmado ?? null
  // Una corrida que quedó 'corriendo' sin la carpeta guardada: su ventana (la de ESA corrida) se suma a la marca, para que
  // carpetaDeIntentoDudoso reconozca la carpeta que pudo haber creado
  if (ctx.iniciadoAnterior && !guardado?.carpeta) {
    const ventana = { desde: ctx.iniciadoAnterior, hasta: iso(Date.parse(ctx.iniciadoAnterior) + 300_000), puedeSeguir: true }
    const nombre = (parcial.nombreCarpeta as string | undefined) ?? nombresDriveCliente(nombreConfirmado ?? a.nombre)?.carpeta ?? null
    if (nombre) intentoCarpeta = { nombre, padreId: intentoCarpeta?.padreId ?? CARPETA_CLIENTES_DRIVE, ventanas: [...(intentoCarpeta?.ventanas ?? []), ventana] }
  }
  const modo = ctx.real ? 'real' : 'simulacion'
  const plantilla = (ctx.deps.plantillaGuionesId ?? plantillaGuionesDesdeEntorno)()
  const opciones = { modo, plantillaGuionesId: plantilla, guardado, nombreConfirmado, intentoCarpeta, hasta: ctx.hasta } as const
  let r: ResultadoDriveCliente
  try {
    if (!ctx.deps.drive) throw new Error('sin la dependencia de Drive')
    r = await ctx.deps.drive(a, opciones)
  } catch (e) {
    return reintentoLectura(ctx, 'drive', mensaje(e))
  }
  // El alta deja el documento conectado al ID CRM apenas existe, antes del kickoff y del check final.
  if (ctx.real && r.guardar.guiones?.id && process.env.DATABASE_URL) {
    const crm = ctx.pasos.crm
    const idCrm = (crm.parcial?.id ?? (crm.resultado as { id?: string } | null)?.id) as string | undefined
    if (idCrm) {
      try {
        const { vincularDocumentoAlta } = await import('../../guiones/documento')
        await vincularDocumentoAlta({ idCrm, docId: r.guardar.guiones.id, carpetaId: r.guardar.carpeta?.id ?? null }, ctx.hasta)
      } catch (e) {
        await ctx.guardarParcial({ guardado: r.guardar, intentoCarpeta: r.intentoCarpeta })
        return reintentoLectura(ctx, 'drive', `Vínculo del Doc pendiente: ${mensaje(e)}`)
      }
    } else r.pendientes.push('El documento existe, pero falta el ID CRM para conectarlo a Guiones.')
  }
  const res = {
    ok: r.ok, completo: r.completo, esperaOk: r.esperaOk, carpeta: r.carpeta, guardar: r.guardar, intentoCarpeta: r.intentoCarpeta,
    noReintentarAntesDe: r.noReintentarAntesDe, pendientes: r.pendientes, errores: r.errores, nombres: r.nombres ? { carpeta: r.nombres.carpeta } : null,
  }
  return interpretarDrive(res, { real: ctx.real, nombre: r.nombres?.cliente ?? a.nombre, alta, ahora: ctx.ahora(), intentos: Number(parcial.intentosLectura ?? 0) })
}

export type ResumenDrive = Pick<ResultadoDriveCliente, 'ok' | 'completo' | 'esperaOk' | 'carpeta' | 'guardar' | 'intentoCarpeta' | 'noReintentarAntesDe' | 'pendientes' | 'errores'> & { nombres: { carpeta: string } | null }

export function interpretarDrive(r: ResumenDrive, c: { real: boolean; nombre: string | null; alta: FilaAlta; ahora: number; intentos: number }): SalidaPaso {
  const parcial = { guardado: r.guardar, intentoCarpeta: r.intentoCarpeta, ...(r.nombres ? { nombreCarpeta: r.nombres.carpeta } : {}) }
  if (!c.real) return { estado: 'simulado', resultado: r, registro: [`haría: carpeta de Drive "${r.nombres?.carpeta ?? '?'}" con Guiones, Crudos, Editados y la bienvenida${r.pendientes.length ? ` (pendientes: ${r.pendientes.length})` : ''}`] }
  if (r.esperaOk === 'carpeta_existente') {
    return {
      estado: 'espera', resultado: r, parcial,
      esperas: [{
        paso: 'drive', motivo: 'carpeta', tipos: ['ok_carpeta'], grupo: 'verificaciones', quien: 'equipo', requiere: ['nombre'], pedido: r.pendientes.slice(0, 1),
        texto: textoPedidoEquipo({ nombre: c.nombre, titulo: `ya había una carpeta "${r.nombres?.carpeta ?? ''}" en Clientes (${r.carpeta.url ?? ''}).`, detalle: r.pendientes.slice(0, 1), ok: 'es la de este cliente, seguí en esa ("OK Nombre Apellido" si es de otro: se crea una nueva con ese nombre)', no: 'frenar Drive' }),
      }],
    }
  }
  if (r.esperaOk === 'nombre_dudoso') {
    return {
      estado: 'espera', resultado: r, parcial,
      esperas: [{
        paso: 'drive', motivo: 'nombre_drive', tipos: ['ok_nombre'], grupo: 'verificaciones', quien: 'equipo', requiere: ['nombre'], pedido: r.pendientes.slice(0, 1),
        texto: textoPedidoEquipo({ nombre: c.nombre, titulo: 'el nombre puede traer a más de una persona: ¿con qué nombre va la carpeta de Drive?', detalle: r.pendientes.slice(0, 1), ok: 'dejar el nombre del #ALTA ("OK Nombre Apellido" lo cambia)', no: 'frenar Drive' }),
      }],
    }
  }
  if (r.noReintentarAntesDe && !r.ok) return { estado: 'reintento', resultado: r, parcial, noAntesDe: r.noReintentarAntesDe, dudoso: true, error: r.errores.join('; ') || 'intento dudoso' }
  if (r.errores.length) {
    const espera = esperaReintento(c.intentos)
    if (espera === null) return revisarCon('drive', c.alta, r.errores.join('; '), { ...parcial, intentosLectura: c.intentos + 1 }, r)
    return { estado: 'reintento', resultado: r, parcial: { ...parcial, intentosLectura: c.intentos + 1 }, noAntesDe: iso(Math.max(c.ahora + espera, r.noReintentarAntesDe ? Date.parse(r.noReintentarAntesDe) : 0)), error: r.errores.join('; ') }
  }
  return { estado: 'hecho', resultado: r, parcial, avisos: [`Drive: carpeta "${r.nombres?.carpeta ?? ''}" lista${r.carpeta.url ? ` (${r.carpeta.url})` : ''}.${r.pendientes.length ? ` Pendiente: ${r.pendientes.join(' · ')}` : ''}`] }
}

/** El OK a una carpeta que ya existía: lo que se guarda para que el reintento siga en esa (aprobarCarpetaExistente). */
export function guardadoAprobado(resultado: unknown): GuardadoDrive | null {
  const r = resultado as ResumenDrive | null
  if (!r) return null
  return aprobarCarpetaExistente({ ...r, modo: 'real', nombres: null, crudos: r.carpeta, editados: r.carpeta, marca: r.carpeta, guiones: r.carpeta, bienvenida: r.carpeta, llamadas: [] } as unknown as ResultadoDriveCliente)
}

// ── Contrato (borrador en PandaDoc; nunca se envía solo) ─────────────────────────────────────────────────────────────

export async function pasoContrato(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta, a = altaParseada(alta)
  const parcial = ctx.paso.parcial ?? {}
  if (!ctx.real || !ctx.deps.contrato) {
    try {
      const { cuerpo, faltantes } = cuerpoBorrador(a, { metadata: { alta_id: alta.id } })
      return { estado: 'simulado', resultado: { nombre: cuerpo.name, plantilla: cuerpo.template_uuid, faltantes }, registro: [`haría: borrador "${cuerpo.name}" en PandaDoc (no se envía solo)${faltantes.length ? `; falta: ${faltantes.join(', ')}` : ''}`] }
    } catch (e) {
      return { estado: 'simulado', resultado: { error: mensaje(e) }, registro: [`no podría crear el borrador: ${mensaje(e)}`] }
    }
  }
  const dep = ctx.deps.contrato
  const nombreDoc = nombreDocumento(a.nombre ?? '')
  const conId = async (id: string, extra: string): Promise<SalidaPaso> => {
    let estado = ''
    try { estado = await dep.estado(id) } catch { estado = '' }
    return { estado: 'hecho', resultado: { id, estado, link: linkEdicion(id) }, parcial: { documentoId: id }, avisos: [`${nombreDoc}: borrador en PandaDoc (${linkEdicion(id)})${extra}. El closer lo revisa y confirma antes de mandarlo a firmar.`] }
  }
  if (typeof parcial.documentoId === 'string' && parcial.documentoId) return conId(parcial.documentoId, '')
  if (!dep.hayClave()) return { estado: 'omitido', resultado: { motivo: 'sin clave de PandaDoc' }, avisos: [`${nombreDoc}: no hay clave de PandaDoc de producción (PANDADOC_API_KEY): el contrato se arma a mano.`] }
  const desde = (ctx.iniciadoAnterior ? Date.parse(ctx.iniciadoAnterior) : ctx.paso.iniciado ? Date.parse(ctx.paso.iniciado) : ctx.ahora()) - 60_000
  // Una corrida anterior se cortó: primero se busca lo que pudo haber creado
  if (ctx.huboCorriendo) {
    const ya = await dep.buscar(nombreDoc, desde).catch(() => null)
    if (ya?.length) return conId(ya[0].id, ' (lo había creado una corrida anterior que se cortó)')
  }
  try {
    const b = await dep.crear(a, { alCrear: (id) => ctx.guardarParcial({ documentoId: id }), metadata: { alta_id: alta.id } })
    return { estado: 'hecho', resultado: { id: b.id, estado: b.estado, link: b.link, clave: b.clave, faltantes: b.faltantes }, parcial: { documentoId: b.id }, avisos: [textoAvisoBorrador(b)] }
  } catch (e) {
    if (e instanceof ErrorBorrador) return conId(e.idDocumento, ` (después de crearlo falló: ${mensaje(e.causa)})`)
    const status = (e as { status?: number })?.status
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return revisarCon('contrato', alta, mensaje(e))
    // Corte, red o 5xx: pudo haberse creado. Se busca por el nombre exacto antes de preguntar
    const ya = await dep.buscar(nombreDoc, desde).catch(() => null)
    if (ya?.length) return conId(ya[0].id, ' (el pedido no respondió, pero el borrador quedó creado)')
    if (ya === null) return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + 300_000), dudoso: true, error: `no se pudo confirmar si quedó creado: ${mensaje(e)}` }
    return {
      estado: 'espera', dudoso: true, error: mensaje(e),
      esperas: [{
        paso: 'contrato', motivo: 'dudoso', tipos: ['ok_dudoso'], grupo: 'verificaciones', quien: 'equipo', requiere: [], pedido: [`Buscar "${nombreDoc}" en PandaDoc`],
        texto: textoPedidoEquipo({ nombre: a.nombre, titulo: `no sé si quedó creado el borrador del contrato: buscá "${nombreDoc}" en PandaDoc.`, detalle: [], ok: 'ya está (no crear otro)', no: 'crearlo de nuevo' }),
      }],
    }
  }
}

// ── Bienvenida (grupo General del cliente) ──────────────────────────────────────────────────────────────────────

interface GruposComunidad { general?: { id: string } | null }
export async function pasoBienvenida(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta, a = altaParseada(alta)
  const com = ctx.pasos.comunidad
  if (com.estado === 'omitido') return { estado: 'omitido', resultado: { motivo: 'sin comunidad' } }
  const b = armarBienvenida(a)
  if (com.estado === 'simulado' || !ctx.real) return { estado: 'simulado', resultado: { entraComoPie: b.entraComoPie, avisos: b.avisos }, registro: [`mandaría la bienvenida oficial con el video de Skool en el grupo General${b.avisos.length ? ` (avisos: ${b.avisos.join('; ')})` : ''}`] }
  const parcial = ctx.paso.parcial ?? {}
  if (b.avisos.length && !parcial.okAvisos) {
    return {
      estado: 'espera',
      esperas: [{
        paso: 'bienvenida', motivo: 'bienvenida', tipos: ['ok_bienvenida'], grupo: 'verificaciones', quien: 'operaciones', requiere: [], pedido: b.avisos,
        texto: textoPedidoEquipo({ nombre: a.nombre, titulo: 'la bienvenida tiene algo para mirar antes de mandarla.', detalle: [...b.avisos, '', b.mensajeGrupo], ok: 'mandarla así', no: 'no mandarla (la manda Aylu a mano)' }),
      }],
    }
  }
  // Del resultado del paso o, si quedó 'hecho' a mano (OK a un "revisar"), de lo que el paso fue guardando
  const general = ((com.resultado as { grupos?: GruposComunidad } | null)?.grupos?.general?.id)
    ?? ((com.parcial as { grupos?: GruposComunidad } | null)?.grupos?.general?.id) ?? null
  if (!general) return revisarCon('bienvenida', alta, 'no está el id del grupo General de la comunidad')
  const enviados: { proposito: string; id: string | null }[] = []
  const video = await ctx.enviar({ proposito: 'bienvenida:video', destino: { chatId: general, cliente: true }, tipo: 'video', url: VIDEO_BIENVENIDA.url, texto: b.entraComoPie ? b.mensajeGrupo : '', dudosoSiCortado: true, hasta: ctx.hasta })
  const problema = (r: typeof video, que: string, proposito: string): SalidaPaso | null => {
    // WhatsApp seguro: con el número caído (motivo) se vuelve a probar en 10 min; con la pausa del 429, en 1 h
    if (r.estado === 'pausado') return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + (r.motivo ? 600_000 : 3600_000)), error: r.motivo ?? 'Whapi en pausa (429)' }
    // `proposito`: el NO ("reenviarla") reenvía SOLO lo dudoso (revisión del 24/10: si el video ya había salido y el dudoso
    // era el texto, el cliente recibía el video dos veces)
    if (r.estado === 'dudoso') return {
      estado: 'espera', dudoso: true, error: `${que}: ${r.motivo}`,
      esperas: [{
        paso: 'bienvenida', motivo: 'dudoso', tipos: ['ok_dudoso'], grupo: 'verificaciones', quien: 'equipo', requiere: [], pedido: [`¿Llegó la bienvenida (${que}) al grupo General de ${a.nombre ?? 'el cliente'}?`],
        datos: { proposito },
        texto: textoPedidoEquipo({ nombre: a.nombre, titulo: `no sé si llegó la bienvenida (${que}) al grupo General.`, detalle: [], ok: 'sí, llegó', no: `reenviar ${que === 'mensaje' ? 'el mensaje' : 'el video'}` }),
      }],
    }
    if (r.estado === 'error') return r.tipo === 'soft_ban' || r.tipo === 'auth'
      ? { estado: 'reintento', noAntesDe: iso(ctx.ahora() + 3600_000), error: `${que}: ${r.motivo}` }
      : revisarCon('bienvenida', alta, `${que}: ${r.motivo}`)
    return null
  }
  const p1 = problema(video, b.entraComoPie ? 'video con el mensaje' : 'video', 'bienvenida:video')
  if (p1) return p1
  enviados.push({ proposito: 'bienvenida:video', id: video.id })
  if (!b.entraComoPie) {
    const texto = await ctx.enviar({ proposito: 'bienvenida:texto', destino: { chatId: general, cliente: true }, tipo: 'texto', texto: b.mensajeGrupo, dudosoSiCortado: true })
    const p2 = problema(texto, 'mensaje', 'bienvenida:texto')
    if (p2) return p2
    enviados.push({ proposito: 'bienvenida:texto', id: texto.id })
  }
  return { estado: 'hecho', resultado: { mensajes: enviados, modo: b.entraComoPie ? 'pie' : 'aparte' } }
}

// ── Skool (aviso a Aylu en Verificaciones: depende del pago, no de la bienvenida) ───────────────────────────────────

export async function pasoSkool(ctx: CtxPaso): Promise<SalidaPaso> {
  const a = altaParseada(ctx.alta)
  const b = armarBienvenida(a)
  const simulado: SalidaPaso = { estado: 'simulado', resultado: { aviso: b.avisoVerificaciones }, registro: [`avisaría a Aylu en Verificaciones: ${b.avisoVerificaciones}`] }
  // Solo con la capacidad 'mensajes_equipo' (revisión del 24/10: con solo 'reporte_verificaciones' el aviso salía de verdad y
  // Aylu invitaba a Skool a un cliente sin comunidad ni bienvenida)
  if (!ctx.real) return simulado
  const aylu = ctx.deps.operaciones.find((x) => /^\d{8,}$/.test(x)) ?? null
  const texto = aylu ? `@${aylu} ${b.avisoVerificaciones}` : b.avisoVerificaciones
  const r = await ctx.enviar({ proposito: 'skool:aviso', destino: { grupo: 'verificaciones' }, tipo: 'texto', texto, menciones: aylu ? [aylu] : [] })
  if (r.estado === 'simulado') return simulado
  if (r.estado === 'pausado') return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + (r.motivo ? 600_000 : 3600_000)), error: r.motivo ?? 'Whapi en pausa' }
  if (r.estado === 'error' || r.estado === 'dudoso') {
    // Un dudoso se reenvía (con "(repetido)") en el próximo intento; con 1, 5 y 30 min de espera y, al cuarto fallo, a revisar
    // (revisión del 24/10: antes reintentaba cada 5 min para siempre, cada vez con un despertador)
    const n = Number(ctx.paso.parcial?.intentosEnvio ?? 0) + 1
    const espera = esperaReintento(n - 1)
    if (espera === null) return revisarCon('skool', ctx.alta, `no salió el aviso de Skool para Aylu después de ${n} intentos (${r.motivo}): avisale a mano`, { intentosEnvio: n })
    return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + espera), error: r.motivo, parcial: { intentosEnvio: n } }
  }
  return { estado: 'hecho', resultado: { avisoId: r.id } }
}

