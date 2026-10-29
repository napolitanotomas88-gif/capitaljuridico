// ── Escritor de "Registrar referido" (SOLO servidor) ──────────────────────────────────────────────
// Agrega UNA fila en la pestaña "Referidos" del CRM de clientes. Contrato:
//   · Modo por defecto = SIMULACIÓN: valida, decide y arma la fila pero NO escribe (el formulario lo avisa).
//   · Escribir de verdad exige CRM_ESCRITURA_REFERIDOS=real (una persona la decide a propósito) Y reservas durables en Postgres
//     (coordinadorPostgres.ts). Sin base provisionada la escritura real queda BLOQUEADA en Vercel/producción: la bandera sola no
//     alcanza. Solo en desarrollo local (un único proceso, fuera de Vercel) la bandera habilita una escritura simple sin base.
//   · Protocolo con reservas: (1) lectura fresca del Sheet (decide y da el piso de fila/ID); (2) RESERVA en Postgres de fila + ID
//     únicos y COMMIT, ANTES de tocar el Sheet; (3) comprobar que esa fila siga vacía y escribir A:L y N:P en ELLA; (4) confirmar.
//     Un reintento conserva la reserva y NUNCA recalcula la fila libre. Un corte entre (2) y (4) deja la reserva 'pendiente'
//     (otra instancia no puede elegir esa fila ni ese ID) y NUNCA se declara guardado: se responde `pendiente_confirmacion`.
//   · Una persona (teléfono canónico) = una sola reserva viva; dos claves o dos actores con el mismo teléfono no reservan dos filas.
//   · Escribe A:L y N:P (M y Q son fórmulas ya cargadas: no se tocan). No sobrescribe filas con ID. No otorga créditos.
//   · Límites: no controla ediciones manuales en el Sheet; Sheets no ofrece compare-and-set, así que entre la comprobación de fila
//     vacía y la escritura hay una ventana mínima que solo una edición manual simultánea podría aprovechar.
//   · Permiso: misma cuenta de servicio con el scope de planillas. Que sea EDITORA del Sheet no se pudo comprobar sin escribir;
//     si no lo es, la escritura da 403, se libera la reserva y el formulario lo dice.
import { createHash } from 'node:crypto'
import { google } from 'googleapis'
import { validarAlta, decidirAlta, filaReferido, claveTelefono, type EntradaAlta, type ErroresAlta, type ReferidoExistente, type ClienteExistente, type Decision } from './altaReferido'
import { fechaDeCelda, hoyArgentina } from './fechas'
import { coordinadorDesdeEntorno, TIMEOUT_RED_SHEETS_MS, type ReservasDurables, type ResultadoGuardado } from './coordinadorPostgres'

export interface Planilla {
  leerReferidos(): Promise<{ existentes: ReferidoExistente[]; primeraFilaLibre: number }>
  leerClientes(): Promise<ClienteExistente[]>
  /** ID (columna A) que hay hoy en esa fila de Referidos, o '' si está vacía. */
  leerIdDeFila(fila: number): Promise<string>
  escribir(fila: number, bloqueAL: (string | number)[], bloqueNP: (string | number)[]): Promise<void>
}

export type Coordinador = ReservasDurables
export const coordinadorDurable = (): Coordinador | null => coordinadorDesdeEntorno(process.env, entornoActual())

export interface Entorno { vercel: boolean; produccion: boolean }
export function entornoActual(): Entorno { return { vercel: !!process.env.VERCEL || !!process.env.VERCEL_ENV, produccion: process.env.NODE_ENV === 'production' } }

/** ¿Se puede escribir de verdad? La bandera sola no alcanza: hacen falta reservas durables, o ser un único proceso local. */
export function escrituraRealPermitida(bandera: boolean, coordinador: Coordinador | null, entorno: Entorno): boolean {
  if (!bandera) return false
  if (coordinador) return true
  return !entorno.vercel && !entorno.produccion
}

export type ResultadoAlta =
  | { ok: true; estado: 'guardado' | 'simulado' | 'ya_existia'; id: string; fila?: number; avisos: string[]; mensaje: string }
  | { ok: false; codigo: 'validacion'; errores: ErroresAlta }
  | { ok: false; codigo: 'rechazado'; motivo: string; mensaje: string }
  | { ok: false; codigo: 'pendiente_confirmacion'; id: string; fila: number; mensaje: string }   // reservado, NO confirmado
  | { ok: false; codigo: 'clave_reutilizada' | 'sin_actor'; mensaje: string }
  | { ok: false; codigo: 'escritura_bloqueada'; mensaje: string }
  | { ok: false; codigo: 'sin_permiso_planilla' | 'planilla_no_disponible'; mensaje: string }

const digitosDe = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const ymd = (v: unknown): string | null => fechaDeCelda(v)
const numeroDeId = (id: string): number => Number(/^R(\d+)$/i.exec(id.trim())?.[1] ?? 0)

// ── Planilla real ────────────────────────────────────────────────────────────────────────────────
export function planillaReal(): Planilla {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.SHEET_ID_CLIENTES
  if (!email || !key || !spreadsheetId) throw new Error('config')
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
  return {
    async leerReferidos() {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Referidos'!A2:Q", valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS })
      const filas = r.data.values ?? []
      const existentes: ReferidoExistente[] = []
      let ultima = 0 // última fila (índice de datos) con ID
      filas.forEach((f, i) => {
        const id = String(f[0] ?? '').trim()
        if (id) {
          ultima = i + 1
          existentes.push({ id, idReferidor: String(f[3] ?? '').trim().toUpperCase(), digitos: digitosDe(f[5]), fechaPedido: ymd(f[1]) as ReferidoExistente['fechaPedido'], momento: String(f[2] ?? '').trim(), idClienteNuevo: String(f[10] ?? '').trim().toUpperCase() })
        }
      })
      return { existentes, primeraFilaLibre: ultima + 2 } // +1 por A2 (la fila 1 es el encabezado) y +1 por la siguiente
    },
    async leerClientes() {
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Agencia'!A2:E", "'Consultora'!A2:E"], valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS })
      const out: ClienteExistente[] = []
      for (const v of r.data.valueRanges ?? []) for (const f of v.values ?? []) {
        const id = String(f[0] ?? '').trim().toUpperCase()
        if (id) out.push({ id, estado: String(f[2] ?? '').trim().toUpperCase(), digitos: digitosDe(f[3]), mail: String(f[4] ?? '').trim().toLowerCase() })
      }
      return out
    },
    async leerIdDeFila(fila) {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'Referidos'!A${fila}:A${fila}`, valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS })
      return String(r.data.values?.[0]?.[0] ?? '').trim()
    },
    async escribir(fila, bloqueAL, bloqueNP) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW', // RAW: un "+54…" queda como texto y no se toma por fórmula
          data: [
            { range: `'Referidos'!A${fila}:L${fila}`, values: [bloqueAL] },
            { range: `'Referidos'!N${fila}:P${fila}`, values: [bloqueNP] },
          ],
        },
      }, { timeout: TIMEOUT_RED_SHEETS_MS })
    },
  }
}

// ── Candado y memoria de envíos (solo para un proceso, sin reservas durables) ─────────────────────
let cola: Promise<unknown> = Promise.resolve()
// (actor + claveEnvio) → { huella del contenido canónico, resultado }. Dos actores con la misma clave no se mezclan, y reusar
// la clave con otro contenido se rechaza en vez de devolver el resultado de otra alta.
const envios = new Map<string, { huella: string; resultado: ResultadoAlta }>()
const MAX_ENVIOS = 200

const banderaReal = (): boolean => process.env.CRM_ESCRITURA_REFERIDOS === 'real'

/** Contenido canónico del alta (sin la clave): mismos datos limpios → misma huella, sin importar mayúsculas, espacios ni formato del teléfono. */
export function huellaAlta(a: { idReferidor: string; digitos: string; nombre: string; mail: string; estudio: string; momento: string; fechaPedido: string; notas: string; idClienteNuevo?: string }): string {
  const c = [a.idReferidor, a.digitos, a.nombre.toLowerCase(), a.mail, a.estudio.toLowerCase(), a.momento, a.fechaPedido, a.notas.toLowerCase(), ...(a.idClienteNuevo ? [a.idClienteNuevo] : [])]
  return createHash('sha256').update(JSON.stringify(c)).digest('hex')
}

type Alta = Extract<ReturnType<typeof validarAlta>, { ok: true }>['alta']

// ── Camino con reservas durables ──────────────────────────────────────────────────────────────────
async function altaConReservas(alta: Alta, actor: string, huella: string, planilla: Planilla, reservas: Coordinador): Promise<ResultadoAlta> {
  let existentes: ReferidoExistente[], primeraFilaLibre: number, clientes: ClienteExistente[], decision: Decision
  try {
    ;[{ existentes, primeraFilaLibre }, clientes] = await Promise.all([planilla.leerReferidos(), planilla.leerClientes()])
    decision = decidirAlta(alta, existentes, clientes)
  } catch (e) {
    console.error('Registrar referido: lectura fallida:', String((e as Error).message).slice(0, 160))
    return { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo leer la planilla del CRM. No se guardó nada. Probá de nuevo en un rato.' }
  }
  if (decision.tipo === 'rechazado') return { ok: false, codigo: 'rechazado', motivo: decision.codigo, mensaje: decision.mensaje }
  if (decision.tipo === 'duplicado') return { ok: true, estado: 'ya_existia', id: decision.id, avisos: [], mensaje: `Ese referido ya estaba cargado (${decision.id}). No se creó otra fila.` }

  // RESERVA durable (COMMIT) ANTES de escribir. Sin clave de envío, la clave es el contenido: el mismo alta reintentado reutiliza la reserva.
  let salida
  try {
    salida = await reservas.reservar({
      actor, clave: alta.claveEnvio || `sin-clave:${huella}`, huella, telefonoClave: claveTelefono(alta.digitos), referidor: alta.idReferidor,
      pisoFila: primeraFilaLibre, pisoIdNumero: existentes.reduce((m, r) => Math.max(m, numeroDeId(r.id)), 0),
    })
  } catch (e) {
    console.error('Registrar referido: reserva fallida:', String((e as Error).message).slice(0, 160))
    return { ok: false, codigo: 'escritura_bloqueada', mensaje: 'No se pudo reservar la fila en la base compartida (espera agotada o base no disponible). No se escribió nada en la planilla.' }
  }
  if (salida.tipo === 'conflicto_clave') return { ok: false, codigo: 'clave_reutilizada', mensaje: 'Esa clave de envío ya se usó con otros datos. Recargá el formulario e intentá de nuevo.' }
  if (salida.tipo === 'conflicto_telefono') return { ok: false, codigo: 'rechazado', motivo: 'telefono_reservado_por_otro', mensaje: 'Ese teléfono ya está reservado para otro cliente que refiere. No se carga de nuevo; si corresponde, se resuelve a mano.' }
  const reserva = salida.reserva

  if (reserva.estado === 'confirmada') {
    if (salida.tipo === 'misma_clave' && reserva.resultado) return { ok: true, estado: 'guardado', id: reserva.resultado.id, fila: reserva.resultado.fila ?? undefined, avisos: reserva.resultado.avisos ?? [], mensaje: reserva.resultado.mensaje }
    return { ok: true, estado: 'ya_existia', id: reserva.id, avisos: [], mensaje: `Esa persona ya estaba cargada (${reserva.id}). No se creó otra fila.` }
  }
  if (salida.tipo === 'misma_persona') {
    // Otra alta de la misma persona quedó reservada sin confirmar: su contenido no se guarda acá (no se almacenan contactos), así que solo
    // se puede completar reintentando ese envío original.
    return { ok: false, codigo: 'pendiente_confirmacion', id: reserva.id, fila: reserva.fila, mensaje: `Hay un alta de esta persona reservada y sin confirmar (${reserva.id}). Reintentá el envío original para completarla; no se escribió una fila nueva.` }
  }

  // Reserva pendiente (nueva o reintento): escribir en ESA fila, nunca en otra.
  const pendiente = (mensaje: string): ResultadoAlta => ({ ok: false, codigo: 'pendiente_confirmacion', id: reserva.id, fila: reserva.fila, mensaje })
  let yaEscrita = false
  try {
    const ocupante = await planilla.leerIdDeFila(reserva.fila)
    if (ocupante && ocupante.toUpperCase() !== reserva.id) {
      await reservas.descartar(reserva.idNumero).catch(() => false)
      return { ok: false, codigo: 'rechazado', motivo: 'fila_ocupada', mensaje: `La fila ${reserva.fila} de Referidos ya tiene otro dato (alguien la editó a mano). No se escribió nada; reintentá el envío.` }
    }
    yaEscrita = ocupante.toUpperCase() === reserva.id
  } catch (e) {
    console.error('Registrar referido: no se pudo comprobar la fila reservada:', String((e as Error).message).slice(0, 160))
    return pendiente(`Reservado como ${reserva.id}, pero NO se pudo comprobar la planilla: no está confirmado. Reintentá el mismo envío.`)
  }
  if (!yaEscrita) {
    const { bloqueAL, bloqueNP } = filaReferido(alta, reserva.id, actor)
    try {
      await planilla.escribir(reserva.fila, bloqueAL, bloqueNP)
    } catch (e) {
      const x = e as { code?: number | string; status?: number | string }
      if (x?.code === 403 || x?.status === 403) {
        await reservas.liberar(reserva.idNumero).catch(() => false) // rechazada sin escribir: se libera fila, ID y teléfono
        return { ok: false, codigo: 'sin_permiso_planilla', mensaje: 'La cuenta del dashboard no tiene permiso de edición en la planilla del CRM. No se guardó nada.' }
      }
      console.error('Registrar referido: escritura sin confirmar:', String((e as Error).message).slice(0, 160))
      // Corte o timeout: la escritura PUDO llegar. No se declara guardado; la reserva queda y el reintento la reutiliza.
      return pendiente(`Reservado como ${reserva.id}, pero la escritura en la planilla NO está confirmada (corte o espera agotada). Reintentá el mismo envío: se completa en la misma fila, sin duplicar.`)
    }
  }
  const resultado: ResultadoGuardado = { estado: 'guardado', id: reserva.id, fila: reserva.fila, avisos: decision.avisos, mensaje: `Referido cargado como ${reserva.id}, estado Presentado.` }
  try {
    await reservas.confirmar(reserva.idNumero, resultado)
  } catch (e) {
    console.error('Registrar referido: no se pudo confirmar la reserva:', String((e as Error).message).slice(0, 160))
    return { ok: true, estado: 'guardado', id: reserva.id, fila: reserva.fila, avisos: [...decision.avisos, 'La fila quedó escrita, pero falta confirmarla en la base: si reenviás, se completa sin duplicar.'], mensaje: resultado.mensaje }
  }
  return { ok: true, estado: 'guardado', id: reserva.id, fila: reserva.fila, avisos: decision.avisos, mensaje: resultado.mensaje }
}

export async function registrarReferido(
  entrada: EntradaAlta,
  cargadoPor: string,
  opciones: { planilla?: Planilla; bandera?: boolean; coordinador?: Coordinador | null; entorno?: Entorno; hoy?: string } = {},
): Promise<ResultadoAlta> {
  const actor = (cargadoPor ?? '').trim().toLowerCase()
  if (!actor) return { ok: false, codigo: 'sin_actor', mensaje: 'No se pudo identificar quién registra el referido.' }
  const hoy = opciones.hoy ?? hoyArgentina()
  const v = validarAlta(entrada, hoy)
  if (!v.ok) return { ok: false, codigo: 'validacion', errores: v.errores }
  const alta = v.alta
  const coordinador = opciones.coordinador === undefined ? coordinadorDurable() : opciones.coordinador
  const bandera = opciones.bandera ?? banderaReal()
  const real = escrituraRealPermitida(bandera, coordinador, opciones.entorno ?? entornoActual())
  if (bandera && !real) {
    return { ok: false, codigo: 'escritura_bloqueada', mensaje: 'La escritura real está bloqueada: falta la base de reservas compartida entre instancias (hoy no está provisionada). No se guardó nada.' }
  }
  const huella = huellaAlta(alta)

  let planilla: Planilla
  try {
    planilla = opciones.planilla ?? planillaReal()
  } catch {
    return { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo conectar con la planilla del CRM. Probá de nuevo en un rato.' }
  }

  // Con reservas durables la verdad es la base (sobrevive a reinicios e instancias): no se usa la memoria del proceso.
  if (real && coordinador) return altaConReservas(alta, actor, huella, planilla, coordinador)

  // Simulación o escritura local de un único proceso: candado en memoria + memoria de envíos atada a actor y contenido.
  const claveMemoria = alta.claveEnvio ? `${real ? 'r' : 's'}|${actor}|${alta.claveEnvio}` : ''
  if (claveMemoria) {
    const previo = envios.get(claveMemoria)
    if (previo) {
      if (previo.huella !== huella) return { ok: false, codigo: 'clave_reutilizada', mensaje: 'Esa clave de envío ya se usó con otros datos. Recargá el formulario e intentá de nuevo.' }
      return previo.resultado
    }
  }
  const trabajo = async (): Promise<ResultadoAlta> => {
    let decision: Decision
    let fila: number
    try {
      const [{ existentes, primeraFilaLibre }, clientes] = await Promise.all([planilla.leerReferidos(), planilla.leerClientes()])
      decision = decidirAlta(alta, existentes, clientes)
      fila = primeraFilaLibre
    } catch (e) {
      console.error('Registrar referido: lectura fallida:', String((e as Error).message).slice(0, 160))
      return { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo leer la planilla del CRM. No se guardó nada. Probá de nuevo en un rato.' }
    }
    if (decision.tipo === 'rechazado') return { ok: false, codigo: 'rechazado', motivo: decision.codigo, mensaje: decision.mensaje }
    if (decision.tipo === 'duplicado') return { ok: true, estado: 'ya_existia', id: decision.id, avisos: [], mensaje: `Ese referido ya estaba cargado (${decision.id}). No se creó otra fila.` }
    const { bloqueAL, bloqueNP } = filaReferido(alta, decision.id, actor)
    if (!real) {
      return { ok: true, estado: 'simulado', id: decision.id, fila, avisos: decision.avisos, mensaje: `Modo de revisión: no se guardó nada en la planilla. Se habría cargado como ${decision.id}, estado Presentado.` }
    }
    try {
      await planilla.escribir(fila, bloqueAL, bloqueNP)
    } catch (e) {
      const x = e as { code?: number | string; status?: number | string }
      if (x?.code === 403 || x?.status === 403) {
        return { ok: false, codigo: 'sin_permiso_planilla', mensaje: 'La cuenta del dashboard no tiene permiso de edición en la planilla del CRM. No se guardó nada.' }
      }
      console.error('Registrar referido: escritura fallida:', String((e as Error).message).slice(0, 160))
      return { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo guardar en la planilla. Revisá si quedó cargado antes de reintentar.' }
    }
    return { ok: true, estado: 'guardado', id: decision.id, fila, avisos: decision.avisos, mensaje: `Referido cargado como ${decision.id}, estado Presentado.` }
  }
  const tarea = cola.then(trabajo)
  cola = tarea.catch(() => undefined)
  const res = await tarea
  if (claveMemoria && res.ok) {
    if (envios.size >= MAX_ENVIOS) envios.delete(envios.keys().next().value as string)
    envios.set(claveMemoria, { huella, resultado: res })
  }
  return res
}
