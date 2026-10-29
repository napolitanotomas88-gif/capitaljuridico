// ── Bot "Capital Jurídico": prueba real del paso Drive (scripts/bot-drive-prueba-real.mjs) ──────────────────────────
// Sondeo del puente, verificación y limpieza, con el puente y la lectura de Drive inyectables para probarlos con un
// puente de juguete (scripts/test-bot-drive.mjs). Solo lo usa la prueba: el webhook no.
// La limpieza solo toca la carpeta de prueba ("PRUEBA BOT…", el puente también lo exige) y los docs que la cuenta de
// servicio ve ADENTRO de esa carpeta.
import { prepararDriveCliente, CLAVES_DRIVE, type LeerCarpetaDrive, type NombresDrive, type ResultadoDriveCliente } from './driveCliente'
import { ErrorPuente, esAccionDesconocida, PREFIJO_CARPETA_PRUEBA, type PuenteDriveCliente } from './puenteDrive'
import type { AltaParseada } from './parsear'

export interface HijoDrive { id: string; name: string; mimeType: string }
/** Hijos (fuera de la papelera) de una carpeta, leídos con la cuenta de servicio (Drive de solo lectura); con `nombre`,
 *  solo los que se llaman así. null = la cuenta de servicio no está configurada. Puede tirar excepción. */
export type LeerHijos = (carpetaId: string, nombre?: string) => Promise<HijoDrive[] | null>

export interface DepsPruebaDrive {
  puente: PuenteDriveCliente
  leerHijos: LeerHijos
  /** Fecha de creación de una carpeta (solo ante un intento dudoso del puente). Por defecto, la cuenta de servicio. */
  leerCarpeta?: LeerCarpetaDrive
  log?: (linea: string) => void
}

const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160)

// ── Sondeo: ¿el puente publicado tiene la versión nueva? (antes de crear nada) ──────────────────────────────────────
/** Id con forma válida (esIdDrive) que no existe en Drive: el sondeo lo usa para llamadas que no cambian nada. */
export const ID_INEXISTENTE = 'IdInexistentePruebaBotNoExiste00000'

export interface SondeoPuente { ok: boolean; motivo: string | null; cuenta: string | null; version: string | null }

/** Confirma, sin cambiar nada en Drive, que el puente responde con el secreto y que tiene copiarArchivo y
 *  aPapeleraCarpeta (la versión del 24/10/2026). Sin eso, la limpieza de la prueba no terminaría y la carpeta "PRUEBA
 *  BOT…" quedaría en Clientes, a la vista de Aylu, /clientes y /guiones.
 *  · copiarArchivo sin nombre: la versión nueva lo rechaza ANTES de tocar Drive ("faltan …"); la vieja, "acción desconocida".
 *  · aPapeleraCarpeta con un id que no existe: la nueva responde un error de Drive; la vieja, "acción desconocida".
 *  Un 500 pasajero se reintenta (puenteDrive.ts): si el reintento trae el rechazo, la acción queda confirmada igual. */
export async function sondearPuente(puente: PuenteDriveCliente): Promise<SondeoPuente> {
  let cuenta: string | null = null
  let version: string | null = null
  try {
    ;({ cuenta, version } = await puente.ping())
  } catch (e) {
    const sinSecreto = /no autorizado/i.test(msg(e))
    return { ok: false, cuenta, version, motivo: `El puente no respondió al ping: ${msg(e)}${sinSecreto ? ' (¿falta la propiedad SECRETO en el proyecto de Apps Script? docs/BOT-ALTA-CJ.md, "Actualizar la implementación del puente")' : ''}` }
  }
  const faltan: string[] = []
  const pruebas: [string, () => Promise<unknown>][] = [
    ['copiarArchivo', () => puente.copiarArchivo({ archivoId: ID_INEXISTENTE, carpetaId: ID_INEXISTENTE, nombre: '' })],
    ['aPapeleraCarpeta', () => puente.aPapeleraCarpeta(ID_INEXISTENTE)],
  ]
  for (const [accion, probar] of pruebas) {
    try {
      await probar()
      return { ok: false, cuenta, version, motivo: `${accion} respondió ok con un id que no existe: revisar el puente antes de seguir.` }
    } catch (e) {
      if (esAccionDesconocida(e)) faltan.push(accion)
      // Rechazo explícito del puente (respondió con ok: false, aunque antes un intento haya dado 500 y por eso `aplicado`
      // quede en null): la acción existe
      else if (!(e instanceof ErrorPuente) || !(e.aplicado === false || e.rechazo)) return { ok: false, cuenta, version, motivo: `No se pudo confirmar ${accion}: ${msg(e)}` }
    }
  }
  if (faltan.length) {
    return { ok: false, cuenta, version, motivo: `El puente publicado no tiene ${faltan.join(' ni ')}: Tomás tiene que publicar la versión nueva del Apps Script (docs/BOT-ALTA-CJ.md, "Actualizar la implementación del puente"). No se creó nada.` }
  }
  return { ok: true, cuenta, version, motivo: null }
}

// ── Verificación ────────────────────────────────────────────────────────────────────────────────────────────────
export interface ControlPrueba { ok: boolean; info?: boolean; que: string; detalle: string }

export interface ContextoPrueba {
  alta: AltaParseada
  nombres: NombresDrive
  plantillaGuionesId: string | null
  carpetaClientesId: string
}

/** Verifica la primera corrida (`res`):
 *  (1) reintento con los ids guardados: mismos ids, todo "existia" y sin buscar la carpeta por nombre en Clientes;
 *  (2) primera corrida otra vez, sin ids (como un homónimo): la carpeta queda esperando el OK y no se crea nada adentro;
 *  (3) con la cuenta de servicio: una sola carpeta con ese nombre en Clientes y cada elemento adentro, sin duplicados.
 *  Devuelve también las corridas extra, para que la limpieza mande a la papelera lo que hayan creado. */
export async function verificarPruebaDrive(ctx: ContextoPrueba, res: ResultadoDriveCliente, deps: DepsPruebaDrive): Promise<{ controles: ControlPrueba[]; corridas: ResultadoDriveCliente[] }> {
  const { alta, nombres, plantillaGuionesId, carpetaClientesId } = ctx
  const opciones = { modo: 'real' as const, plantillaGuionesId, carpetaClientesId, deps: { puente: () => deps.puente, leerCarpeta: deps.leerCarpeta } }
  const controles: ControlPrueba[] = []
  const corridas: ResultadoDriveCliente[] = []

  // (1) Reintento con lo guardado
  const r2 = await prepararDriveCliente(alta, { ...opciones, guardado: res.guardar })
  corridas.push(r2)
  for (const k of CLAVES_DRIVE) {
    const a = res[k], b = r2[k]
    if (a.estado === 'pendiente') { controles.push({ ok: true, info: true, que: `${k} (reintento)`, detalle: `pendiente: ${a.motivo}` }); continue }
    const ok = (a.estado === 'creado' || a.estado === 'existia') && b.estado === 'existia' && a.id === b.id
    controles.push({ ok, que: `${k} (reintento con los ids guardados)`, detalle: ok ? 'mismo id' : `1.ª ${a.estado} ${a.id ?? '—'} · 2.ª ${b.estado} ${b.id ?? '—'}` })
  }
  const buscoEnClientes = r2.llamadas.some((l) => l.accion === 'crearCarpeta' && l.datos.padreId === carpetaClientesId)
  controles.push({ ok: !buscoEnClientes, que: 'el reintento no busca la carpeta por nombre en Clientes', detalle: buscoEnClientes ? 'llamó a crearCarpeta en Clientes' : `${r2.llamadas.length} llamada(s) al puente` })

  // (2) Primera corrida sin ids guardados: la carpeta ya existe → espera el OK y no toca nada adentro. Aunque el puente dé
  //     un 500 y el reintento la encuentre, la fecha de creación (anterior a este intento) la delata como homónimo
  const r3 = await prepararDriveCliente(alta, opciones)
  corridas.push(r3)
  const okHomonimo = r3.esperaOk === 'carpeta_existente' && r3.carpeta.id === res.carpeta.id && r3.llamadas.length === 1
  controles.push({ ok: okHomonimo, que: 'sin ids guardados, una carpeta que ya existe espera el OK', detalle: `esperaOk ${r3.esperaOk ?? '—'} · ${r3.llamadas.length} llamada(s) · carpeta ${r3.carpeta.id === res.carpeta.id ? 'la misma' : r3.carpeta.id ?? '—'}` })

  // (3) Con la cuenta de servicio
  try {
    const enClientes = await deps.leerHijos(carpetaClientesId, nombres.carpeta)
    if (enClientes === null) {
      controles.push({ ok: true, info: true, que: 'Lectura con la cuenta de servicio', detalle: 'no está configurada: solo se verificó por el puente' })
    } else {
      const okC = enClientes.length === 1 && enClientes[0].id === res.carpeta.id
      controles.push({ ok: okC, que: `"${nombres.carpeta}" en Clientes (cuenta de servicio)`, detalle: `${enClientes.length} carpeta(s) con ese nombre${okC ? ', la creada' : ''}` })
      const hijos = (res.carpeta.id ? await deps.leerHijos(res.carpeta.id) : null) ?? []
      for (const k of CLAVES_DRIVE.slice(1)) {
        const e = res[k]
        if (!e.id) continue
        const h = hijos.find((x) => x.id === e.id)
        const iguales = hijos.filter((x) => x.name === e.nombre).length
        controles.push({ ok: !!h && h.name === e.nombre && iguales === 1, que: `${k} dentro de la carpeta (cuenta de servicio)`, detalle: h ? `"${h.name}" · ${h.mimeType.replace('application/vnd.google-apps.', '')}${iguales > 1 ? ` · ${iguales} con ese nombre` : ''}` : 'no aparece' })
      }
    }
  } catch (e) {
    controles.push({ ok: true, info: true, que: 'Lectura con la cuenta de servicio', detalle: `no se pudo (${msg(e)}): solo se verificó por el puente` })
  }
  return { controles, corridas }
}

// ── Limpieza ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Manda a la papelera lo que creó la prueba. Siempre termina (un paso que falla no frena los otros) y dice si quedó
 *  todo limpio.
 *  1) Carpetas: los ids de las corridas más las que la cuenta de servicio ve en Clientes con el nombre de prueba (si una
 *     corrida falló a mitad, o si quedaron dos).
 *  2) Docs (guiones y bienvenida): solo los ids que la cuenta de servicio ve ADENTRO de esas carpetas. Sin cuenta de
 *     servicio no se mandan uno por uno: se van con la carpeta.
 *  3) Cada carpeta con aPapeleraCarpeta (el puente solo acepta "PRUEBA BOT…"; acá también se controla el nombre).
 *  4) Control final con la cuenta de servicio: que no quede ninguna en Clientes. */
export async function limpiarPruebaDrive(
  ctx: { nombres: NombresDrive; carpetaClientesId: string; resultados: (ResultadoDriveCliente | null | undefined)[] },
  deps: DepsPruebaDrive,
): Promise<{ ok: boolean }> {
  const log = deps.log ?? (() => {})
  const { nombres, carpetaClientesId } = ctx
  const resultados = ctx.resultados.filter((r): r is ResultadoDriveCliente => !!r)
  let ok = true
  if (!nombres.carpeta.startsWith(PREFIJO_CARPETA_PRUEBA)) {
    log(`  [MAL] "${nombres.carpeta}" no es una carpeta de prueba (no empieza con "${PREFIJO_CARPETA_PRUEBA}"): no se toca nada.`)
    return { ok: false }
  }

  // 1) Carpetas de prueba
  const carpetas = new Set<string>()
  for (const r of resultados) if (r.carpeta.id) carpetas.add(r.carpeta.id)
  let puedeLeer = true
  try {
    const enClientes = await deps.leerHijos(carpetaClientesId, nombres.carpeta)
    if (enClientes === null) puedeLeer = false
    else for (const c of enClientes) carpetas.add(c.id)
  } catch (e) {
    puedeLeer = false
    log(`  [info] No se pudo buscar "${nombres.carpeta}" en Clientes con la cuenta de servicio (${msg(e)}).`)
  }
  if (!carpetas.size) {
    log(puedeLeer ? '  [ok] No quedó ninguna carpeta de prueba en Clientes.' : `  [AVISO] Sin el id de la carpeta y sin cuenta de servicio: revisar a mano si quedó "${nombres.carpeta}" en Clientes.`)
    return { ok: puedeLeer }
  }
  if (carpetas.size > 1) log(`  [info] Hay ${carpetas.size} carpetas "${nombres.carpeta}": van todas a la papelera.`)

  // 2) Docs de las corridas, solo si están adentro de una carpeta de prueba
  const docs = new Map<string, string>()
  for (const r of resultados) for (const k of ['guiones', 'bienvenida'] as const) if (r[k].id) docs.set(r[k].id as string, r[k].nombre)
  if (docs.size && puedeLeer) {
    const adentro = new Set<string>()
    for (const id of carpetas) {
      try {
        for (const h of (await deps.leerHijos(id)) ?? []) adentro.add(h.id)
      } catch (e) {
        log(`  [info] No se pudo listar la carpeta ${id} (${msg(e)}): sus docs se van con la carpeta.`)
      }
    }
    for (const [id, nombre] of docs) {
      if (!adentro.has(id)) { log(`  [info] "${nombre}" no aparece adentro de la carpeta de prueba: no se manda a la papelera por su id.`); continue }
      try {
        await deps.puente.aPapelera(id)
        log(`  [ok] "${nombre}" a la papelera`)
      } catch (e) {
        log(`  [MAL] "${nombre}" no se pudo mandar a la papelera: ${msg(e)}`)
        ok = false
      }
    }
  } else if (docs.size) {
    log('  [info] Sin cuenta de servicio: los docs se van a la papelera con la carpeta.')
  }

  // 3) Carpetas (con lo que tengan adentro)
  for (const id of carpetas) {
    try {
      await deps.puente.aPapeleraCarpeta(id)
      log(`  [ok] "${nombres.carpeta}" (con "${nombres.crudos}", "${nombres.editados}" y los docs) a la papelera · ${id}`)
    } catch (e) {
      ok = false
      if (esAccionDesconocida(e)) log(`  [MAL] El puente publicado no tiene aPapeleraCarpeta: "${nombres.carpeta}" quedó en Clientes CON lo de adentro ("${nombres.crudos}", "${nombres.editados}" y los docs que no se pudieron borrar). Mandarla a la papelera a mano. Id: ${id}`)
      else log(`  [MAL] La carpeta "${nombres.carpeta}" no se pudo mandar a la papelera: ${msg(e)}. Mandarla a mano (id ${id}).`)
    }
  }

  // 4) Control final
  try {
    const quedan = await deps.leerHijos(carpetaClientesId, nombres.carpeta)
    if (quedan === null) log('  [info] Sin cuenta de servicio: no se pudo confirmar desde afuera que la carpeta salió de Clientes.')
    else if (quedan.length) { log(`  [MAL] Todavía hay ${quedan.length} carpeta(s) "${nombres.carpeta}" en Clientes: revisar a mano.`); ok = false }
    else log(`  [ok] Clientes ya no tiene "${nombres.carpeta}" (cuenta de servicio)`)
  } catch (e) {
    log(`  [info] No se pudo releer Clientes (${msg(e)}).`)
  }
  return { ok }
}
