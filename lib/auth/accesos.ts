// ── Planilla de Accesos: lista de personas que se administra desde Configuración ─────────────────────────────
// Variable: SHEET_ID_ACCESOS (id de una planilla de Google compartida como EDITOR con la cuenta de servicio). La lista fija
// AUTH_USUARIOS de Vercel manda siempre y sigue siendo el "seguro": aunque la planilla falle o se rompa, esos
// administradores entran. Las personas de la planilla se leen con caché de 60 s; si Google falla se sigue con lo último
// que se leyó (y sin eso, solo entran los de la lista fija: falla cerrado para los de la planilla).
import { ENCABEZADOS, ENCABEZADOS_HISTORIAL, aCeldas, leerFilasNumeradas, ultimaFilaDe, validarEntrada, type EntradaAcceso, type FilaAcceso, type FilaNumerada } from './accesosModelo'
import { googleConfigurado, googleJson, sheetsBase } from './googleRest'
import { fijarAccesosDePlanilla, accesoDePlanilla, buscarUsuario } from './usuarios'

const FRESCO_MS = 60_000
let cache: { en: number; filas: FilaAcceso[] } | null = null
let enVuelo: Promise<void> | null = null

export const planillaConfigurada = (): boolean => !!process.env.SHEET_ID_ACCESOS?.trim() && googleConfigurado()
const idPlanilla = () => encodeURIComponent(process.env.SHEET_ID_ACCESOS!.trim())
const rango = (r: string) => encodeURIComponent(r)

// Cada fila válida con su número real en la planilla: las vacías o inválidas no corren la cuenta
async function leerFilas(): Promise<FilaNumerada[]> {
  const r = await googleJson<{ values?: unknown[][] }>(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango('Accesos!A2:H')}?valueRenderOption=FORMATTED_VALUE`)
  return leerFilasNumeradas(r.values ?? [])
}

function aplicar(filas: FilaAcceso[]) {
  cache = { en: Date.now(), filas }
  // Solo las activas dan acceso. Si un mail está repetido, vale la última fila.
  const porMail = new Map<string, FilaAcceso>()
  for (const f of filas) if (f.activo) porMail.set(f.email, f); else porMail.delete(f.email)
  fijarAccesosDePlanilla([...porMail.values()].map(accesoDePlanilla))
}

/** Renueva la lista de la planilla si pasó más de un minuto. Nunca lanza: ante un error deja lo último que se leyó. */
export async function asegurarUsuarios(): Promise<void> {
  if (!planillaConfigurada()) return
  if (cache && Date.now() - cache.en < FRESCO_MS) return
  if (!enVuelo) {
    enVuelo = leerFilas()
      .then(aplicar)
      .catch(() => { console.warn('[accesos] no se pudo leer la planilla de Accesos: se usa lo último leído') })
      .finally(() => { enVuelo = null })
  }
  await enVuelo
}

export function invalidarAccesos() { cache = null }

/** Todas las filas de la planilla (también las dadas de baja), para la pantalla de Configuración. */
export async function filasDeLaPlanilla(): Promise<FilaAcceso[]> {
  if (!planillaConfigurada()) return []
  const filas = await leerFilas()
  aplicar(filas)
  return filas
}

const ahoraAR = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16).replace('T', ' ')

async function anotar(quien: string, accion: string, mail: string, detalle: string) {
  try {
    await googleJson(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango('Historial!A:E')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { cuerpo: { values: [[ahoraAR(), quien, accion, mail, detalle]] } })
  } catch { /* el historial es un rastro: si falla no se deshace el cambio */ }
}

async function asegurarEncabezados() {
  const r = await googleJson<{ values?: unknown[][] }>(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango('Accesos!A1:H1')}`)
  if (!r.values?.[0]?.length) {
    await googleJson(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango('Accesos!A1:H1')}?valueInputOption=RAW`, { metodo: 'PUT', cuerpo: { values: [[...ENCABEZADOS]] } })
    await googleJson(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango('Historial!A1:E1')}?valueInputOption=RAW`, { metodo: 'PUT', cuerpo: { values: [[...ENCABEZADOS_HISTORIAL]] } })
  }
}

export type Resultado = { ok: true; mensaje: string } | { ok: false; error: string }

/**
 * Alta o cambio de una persona (por mail). `quien` = el administrador que lo hace. Nadie puede tocar a quien está en la
 * lista fija de Vercel desde acá (esos son los administradores "de respaldo").
 */
export async function guardarAcceso(entrada: EntradaAcceso, quien: string): Promise<Resultado> {
  if (!planillaConfigurada()) return { ok: false, error: 'La planilla de Accesos todavía no está conectada.' }
  const v = validarEntrada(entrada)
  if (!v.ok) return v
  if (buscarUsuario(v.datos.email)?.origen === 'vercel') return { ok: false, error: 'Esa cuenta está en la lista fija de Vercel: se cambia desde Vercel, no desde acá.' }
  try {
    await asegurarEncabezados()
    const previa = ultimaFilaDe(await leerFilas(), v.datos.email)
    const nueva: FilaAcceso = { ...v.datos, activo: true, agrego: quien, fecha: ahoraAR() }
    if (previa) {
      // Se reescribe la fila real de la persona (no la posición en la lista filtrada: puede haber filas vacías arriba)
      await googleJson(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango(`Accesos!A${previa.fila}:H${previa.fila}`)}?valueInputOption=RAW`, { metodo: 'PUT', cuerpo: { values: [aCeldas({ ...nueva, agrego: previa.agrego || quien, fecha: previa.fecha || nueva.fecha })] } })
    } else {
      await googleJson(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango('Accesos!A:H')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { cuerpo: { values: [aCeldas(nueva)] } })
    }
    await anotar(quien, previa ? 'cambio' : 'alta', v.datos.email, `${v.datos.tipo}${v.datos.secciones.length ? ': ' + v.datos.secciones.join(', ') : ''}${v.datos.pestanas.length ? ' · CRM: ' + v.datos.pestanas.join(', ') : ''}`)
    invalidarAccesos()
    await filasDeLaPlanilla()
    return { ok: true, mensaje: previa ? 'Cambios guardados.' : 'Persona agregada. Ya puede entrar con su cuenta de Google.' }
  } catch {
    return { ok: false, error: 'No se pudo guardar en la planilla de Accesos. Revisá que esté compartida como editora con la cuenta de servicio.' }
  }
}

/** Baja: se marca Activo = no (queda el rastro). No se puede quitar a uno mismo ni a la lista fija de Vercel. */
export async function quitarAcceso(emailCrudo: unknown, quien: string): Promise<Resultado> {
  if (!planillaConfigurada()) return { ok: false, error: 'La planilla de Accesos todavía no está conectada.' }
  const v = validarEntrada({ email: emailCrudo, nombre: 'x', tipo: 'admin' })
  if (!v.ok) return v
  const email = v.datos.email
  if (email === quien) return { ok: false, error: 'No podés quitarte el acceso a vos mismo.' }
  if (buscarUsuario(email)?.origen === 'vercel') return { ok: false, error: 'Esa cuenta está en la lista fija de Vercel: se saca desde Vercel.' }
  try {
    // La última fila válida del mail es la que manda (aplicar): con Activo = no ahí, pierde el acceso
    const previa = ultimaFilaDe(await leerFilas(), email)
    if (!previa) return { ok: false, error: 'Esa persona no está en la planilla.' }
    await googleJson(`${sheetsBase()}/v4/spreadsheets/${idPlanilla()}/values/${rango(`Accesos!F${previa.fila}`)}?valueInputOption=RAW`, { metodo: 'PUT', cuerpo: { values: [['no']] } })
    await anotar(quien, 'baja', email, '')
    invalidarAccesos()
    await filasDeLaPlanilla()
    return { ok: true, mensaje: 'Acceso quitado.' }
  } catch {
    return { ok: false, error: 'No se pudo guardar en la planilla de Accesos.' }
  }
}
