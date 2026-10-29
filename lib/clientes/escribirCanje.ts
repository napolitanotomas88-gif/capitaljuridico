// ── Escritor del libro "Créditos" para el CANJE (SOLO servidor) — CONECTADO a POST /api/referidos/canje (OK de Tomás, 27/10/2026) ──────────
// Estado: la ruta lo llama solo con CRM_ESCRITURA_CANJE=real (todavía NO cargada) + DATABASE_URL + REFERIDOS_HMAC_SECRET, y solo para Tomás,
// Gero A, Gero M y Aylu (acciones/permisos.ts). Probado con una base falsa y una planilla falsa (scripts/test-escribir-canje.mjs); la validación
// contra Postgres real es scripts/validar-canjes-postgres.mjs (base de PRUEBA). La migración 002 TODAVÍA NO corrió en producción: sin ella la
// reserva falla y el canje queda en "escritura_bloqueada" sin tocar el libro. Nunca se escribió en la planilla real.
//
// Protocolo (misma idea que escribirReferido.ts, endurecida para dinero):
//   0. Sin bandera real → SIMULACIÓN (nada de base ni de escritura). Con bandera y sin reservas durables → BLOQUEADA. No hay camino local sin base.
//   1. REINTENTO por clave primero, SIN recalcular: si ya existe una reserva con esa (actor, clave) y el mismo pedido, se completa ESA reserva con
//      su saldo CONGELADO (aunque el libro ya cambió y hoy el saldo sea cero). Mismo actor+clave con otro pedido = conflicto 409.
//   2. Si no hay reserva: lectura fresca del libro → decidirCanje (puro). Rechazo = 409, nada se reserva.
//   3. RESERVA durable (COMMIT) de fila + ID + saldo congelado ANTES de tocar el libro. Un canje vivo por (cliente, ciclo): otra instancia con el mismo
//      saldo leído no puede reservar otro (índice único); mismo canje exacto = misma reserva; otro contenido = conflicto de ciclo 409.
//   4. Comprobar que la fila reservada siga libre (o ya tenga NUESTRO ID: la escritura anterior llegó) y escribir ahí. Corte o espera agotada =
//      `pendiente_confirmacion` (NUNCA guardado); el reintento completa la misma fila. 403 = se libera sin escribir.
//   5. Confirmar la reserva. Si falla, la fila ya está escrita: se informa y el reintento confirma sin reescribir.
// Columnas del libro: A ID, B Fecha, C ID cliente, D Tipo, E Referido, F Meses (+/-), G Extra, H Vence (FÓRMULA, no se escribe), I Renovación
// aplicada, J Nota, K Cargado por. Se escribe A:G e I:K. MONEDAS: los meses van solos en F (negativos); los USD NO tienen columna: van como
// texto en Extra ("USD 600"), compatible con usdDeTexto. No se agrega ninguna columna a la planilla.
import { google } from 'googleapis'
import { filasCanje } from './filasCanje'
export { filasCanje } from './filasCanje'
import { REGLAS_REFERIDOS, type ReglasReferidos } from './reglasReferidos'
import { TIMEOUT_RED_SHEETS_MS } from './coordinadorPostgres'
import { decidirCanje, huellaPedidoCanje, rolPuedeCanjear, validarCanje, type CanjeLimpio, type EntradaCanje, type ErroresCanje, type MotivoRechazoCanje, type SaldoPorMoneda, type ReferenciaMeses } from './canje'
import type { ReservaCanje, ReservasCanjeDurables, ResultadoCanjeGuardado } from './reservasCanje'
import type { ResumenCredito } from './tipos'

/** Lo que el escritor necesita del libro, inyectable (en las pruebas es falso; el real es planillaLibroReal) */
export interface EstadoLibro {
  clienteExiste: boolean
  resumen: ResumenCredito | undefined   // calculado con una lectura FRESCA del CRM (no del snapshot de 10 min)
  primeraFilaLibre: number
  mayorIdNumero: number                 // mayor número de ID M### que ya tiene el libro
}
export interface PlanillaLibro {
  leerEstado(idCliente: string): Promise<EstadoLibro>
  /** ID (columna A) que hay hoy en esa fila del libro, o '' si está vacía */
  leerIdDeFila(fila: number): Promise<string>
  escribir(fila: number, bloqueAG: (string | number)[], bloqueIK: (string | number)[]): Promise<void>
}

export type ResultadoCanje =
  | { ok: true; estado: 'simulado'; saldo: SaldoPorMoneda; referenciaMeses: ReferenciaMeses; avisos: string[]; mensaje: string }
  | { ok: true; estado: 'guardado'; id: string; fila: number; meses: number; usd: number; avisos: string[]; mensaje: string }
  | { ok: false; codigo: 'validacion'; errores: ErroresCanje }
  | { ok: false; codigo: 'sin_actor' | 'sin_permiso'; mensaje: string }
  | { ok: false; codigo: 'rechazado'; motivo: MotivoRechazoCanje | 'fila_ocupada'; mensaje: string }
  | { ok: false; codigo: 'clave_reutilizada' | 'conflicto_ciclo'; mensaje: string }
  | { ok: false; codigo: 'pendiente_confirmacion'; id: string; fila: number; mensaje: string }   // reservado, NO confirmado
  | { ok: false; codigo: 'escritura_bloqueada' | 'sin_permiso_planilla' | 'planilla_no_disponible'; mensaje: string }

const pendienteDe = (r: ReservaCanje, mensaje: string): ResultadoCanje => ({ ok: false, codigo: 'pendiente_confirmacion', id: r.id, fila: r.fila, mensaje })

/** Filas que se escriben, a partir de la RESERVA (saldo congelado) y del pedido. Meses solos en F; USD solo como texto en Extra. */

/** Completa una reserva pendiente: escribe en ESA fila (o reconoce que ya está) y confirma. */
async function completar(r: ReservaCanje, c: CanjeLimpio, actor: string, planilla: PlanillaLibro, reservas: ReservasCanjeDurables, avisos: string[], reglas: ReglasReferidos): Promise<ResultadoCanje> {
  let yaEscrita = false
  try {
    const ocupante = await planilla.leerIdDeFila(r.fila)
    if (ocupante && ocupante.toUpperCase() !== r.id) {
      await reservas.descartar(r.idNumero).catch(() => false)
      return { ok: false, codigo: 'rechazado', motivo: 'fila_ocupada', mensaje: `La fila ${r.fila} del libro Créditos ya tiene otro dato (alguien la editó a mano). No se escribió nada; reintentá el canje.` }
    }
    yaEscrita = ocupante.toUpperCase() === r.id
  } catch (e) {
    console.error('Canje: no se pudo comprobar la fila reservada:', String((e as Error).message).slice(0, 160))
    return pendienteDe(r, `Reservado como ${r.id}, pero NO se pudo comprobar el libro: no está confirmado. Reintentá el mismo canje.`)
  }
  if (!yaEscrita) {
    const { bloqueAG, bloqueIK } = filasCanje(r, c, actor, reglas)
    try {
      await planilla.escribir(r.fila, bloqueAG, bloqueIK)
    } catch (e) {
      const x = e as { code?: number | string; status?: number | string }
      if (x?.code === 403 || x?.status === 403) {
        await reservas.liberar(r.idNumero).catch(() => false) // rechazada sin escribir: se libera fila, ID y ciclo
        return { ok: false, codigo: 'sin_permiso_planilla', mensaje: 'La cuenta del dashboard no tiene permiso de edición en la planilla del CRM. No se guardó nada.' }
      }
      console.error('Canje: escritura sin confirmar:', String((e as Error).message).slice(0, 160))
      // Corte o timeout: la escritura PUDO llegar. No se declara guardado; la reserva queda y el reintento la reutiliza.
      return pendienteDe(r, `Reservado como ${r.id}, pero la escritura en el libro NO está confirmada (corte o espera agotada). Reintentá el mismo canje: se completa en la misma fila, sin duplicar.`)
    }
  }
  const resultado: ResultadoCanjeGuardado = { estado: 'guardado', id: r.id, fila: r.fila, meses: r.meses, usd: r.usd, avisos, mensaje: `Canje asentado como ${r.id}: ${r.meses} ${r.meses === 1 ? 'mes' : 'meses'} y USD ${r.usd}, cada uno en su unidad.` }
  try {
    await reservas.confirmar(r.idNumero, resultado)
  } catch (e) {
    console.error('Canje: no se pudo confirmar la reserva:', String((e as Error).message).slice(0, 160))
    return { ok: true, estado: 'guardado', id: r.id, fila: r.fila, meses: r.meses, usd: r.usd, avisos: [...avisos, 'La fila quedó escrita, pero falta confirmarla en la base: si reenviás, se completa sin duplicar.'], mensaje: resultado.mensaje }
  }
  return { ok: true, estado: 'guardado', id: r.id, fila: r.fila, meses: r.meses, usd: r.usd, avisos, mensaje: resultado.mensaje }
}

const deConfirmada = (r: ReservaCanje): ResultadoCanje | null =>
  r.estado === 'confirmada' && r.resultado ? { ok: true, estado: 'guardado', id: r.resultado.id, fila: r.resultado.fila, meses: r.resultado.meses, usd: r.resultado.usd, avisos: r.resultado.avisos ?? [], mensaje: r.resultado.mensaje } : null

export interface OpcionesCanje { planilla: PlanillaLibro; bandera: boolean; reservas: ReservasCanjeDurables | null; rol: string | null | undefined; hoy: string; reglas?: ReglasReferidos }

export async function registrarCanje(entrada: EntradaCanje, cargadoPor: string, op: OpcionesCanje): Promise<ResultadoCanje> {
  const reglas = op.reglas ?? REGLAS_REFERIDOS
  const actor = (cargadoPor ?? '').trim().toLowerCase()
  if (!actor) return { ok: false, codigo: 'sin_actor', mensaje: 'No se pudo identificar quién canjea.' }
  if (!rolPuedeCanjear(op.rol)) return { ok: false, codigo: 'sin_permiso', mensaje: 'Tu rol no puede canjear créditos.' }
  const v = validarCanje(entrada, op.hoy, reglas)
  if (!v.ok) return { ok: false, codigo: 'validacion', errores: v.errores }
  const canje = v.canje
  const hp = huellaPedidoCanje(canje, actor)

  const leer = async (): Promise<EstadoLibro | null> => {
    try { return await op.planilla.leerEstado(canje.idCliente) } catch (e) { console.error('Canje: lectura fallida:', String((e as Error).message).slice(0, 160)); return null }
  }
  const sinLectura: ResultadoCanje = { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo leer la planilla del CRM. No se guardó nada. Probá de nuevo en un rato.' }
  const decidir = (est: EstadoLibro) => (est.clienteExiste
    ? decidirCanje(canje, est.resumen, actor, reglas)
    : ({ tipo: 'rechazado', codigo: 'cliente_inexistente', mensaje: 'Ese cliente no existe en el CRM.' } as const))

  // 0. Sin bandera: simulación pura (no toca la base ni escribe)
  if (!op.bandera) {
    const est = await leer(); if (!est) return sinLectura
    const d = decidir(est)
    if (d.tipo === 'rechazado') return { ok: false, codigo: 'rechazado', motivo: d.codigo, mensaje: d.mensaje }
    return { ok: true, estado: 'simulado', saldo: d.saldo, referenciaMeses: d.referenciaMeses, avisos: d.avisos, mensaje: 'Modo de revisión: no se guardó nada en el libro.' }
  }
  if (!op.reservas) return { ok: false, codigo: 'escritura_bloqueada', mensaje: 'La escritura real está bloqueada: falta la base de reservas compartida entre instancias. No se guardó nada.' }
  const reservas = op.reservas

  // 1. Reintento por clave, sin recalcular el saldo
  try {
    const previa = await reservas.buscarPorClave(actor, canje.claveEnvio, hp)
    if (previa?.tipo === 'conflicto_clave') return { ok: false, codigo: 'clave_reutilizada', mensaje: 'Esa clave de envío ya se usó con otro canje. Recargá el formulario e intentá de nuevo.' }
    if (previa?.tipo === 'misma_clave') {
      const hecho = deConfirmada(previa.reserva); if (hecho) return hecho
      return completar(previa.reserva, canje, actor, op.planilla, reservas, [], reglas)
    }
  } catch (e) {
    console.error('Canje: búsqueda de reserva fallida:', String((e as Error).message).slice(0, 160))
    return { ok: false, codigo: 'escritura_bloqueada', mensaje: 'No se pudo consultar la base compartida (espera agotada o base no disponible). No se escribió nada en el libro.' }
  }

  // 2. Lectura fresca y decisión
  const est = await leer(); if (!est) return sinLectura
  const d = decidir(est)
  if (d.tipo === 'rechazado') return { ok: false, codigo: 'rechazado', motivo: d.codigo, mensaje: d.mensaje }

  // 3. Reserva durable (COMMIT) antes de escribir; el saldo se congela en la reserva
  let salida
  try {
    salida = await reservas.reservar({
      actor, clave: canje.claveEnvio, huellaPedido: hp, huella: d.huella, cliente: canje.idCliente, cicloClave: est.resumen?.cicloDesde ?? '',
      meses: d.saldo.meses, usd: d.saldo.usd, extra: d.movimiento.extra, pisoFila: est.primeraFilaLibre, pisoIdNumero: est.mayorIdNumero,
    })
  } catch (e) {
    console.error('Canje: reserva fallida:', String((e as Error).message).slice(0, 160))
    return { ok: false, codigo: 'escritura_bloqueada', mensaje: 'No se pudo reservar la fila en la base compartida (espera agotada o base no disponible). No se escribió nada en el libro.' }
  }
  if (salida.tipo === 'conflicto_clave') return { ok: false, codigo: 'clave_reutilizada', mensaje: 'Esa clave de envío ya se usó con otro canje. Recargá el formulario e intentá de nuevo.' }
  if (salida.tipo === 'conflicto_ciclo') return { ok: false, codigo: 'conflicto_ciclo', mensaje: 'Ya hay un canje de este cliente en curso o asentado en este ciclo con otro contenido. No se reserva otro: revisá el libro antes de reintentar.' }
  const reserva = salida.reserva
  const hecho = deConfirmada(reserva); if (hecho) return hecho
  if (salida.tipo === 'mismo_canje_en_ciclo') {
    // Otra clave u otro actor ya reservó EL MISMO canje: no se escribe de nuevo desde acá; se completa solo con el envío original.
    return pendienteDe(reserva, `Ya hay un canje idéntico de este cliente reservado y sin confirmar (${reserva.id}). Reintentá el envío original para completarlo; no se escribió una fila nueva.`)
  }
  // 4–5. Escribir en ESA fila y confirmar
  return completar(reserva, canje, actor, op.planilla, reservas, d.avisos, reglas)
}

// ── Adaptador real del libro (lo usa la ruta del canje; todavía sin probar contra la planilla real) ─────────────────────────────────────
// `leerEstadoFresco` lo aporta la ruta (lectura fresca del CRM + calcularCreditosDeDatos); este adaptador solo sabe leer y escribir filas del libro.
export function planillaLibroReal(leerEstadoFresco: (idCliente: string) => Promise<Pick<EstadoLibro, 'clienteExiste' | 'resumen'>>): PlanillaLibro {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.SHEET_ID_CLIENTES
  if (!email || !key || !spreadsheetId) throw new Error('config')
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
  return {
    async leerEstado(idCliente) {
      const [base, r] = await Promise.all([
        leerEstadoFresco(idCliente),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'Créditos'!A2:A", valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS }),
      ])
      let ultima = 0, mayor = 0
      ;(r.data.values ?? []).forEach((f, i) => {
        const id = String(f[0] ?? '').trim()
        if (id) { ultima = i + 1; mayor = Math.max(mayor, Number(/^M(\d+)$/i.exec(id)?.[1] ?? 0)) }
      })
      return { ...base, primeraFilaLibre: ultima + 2, mayorIdNumero: mayor }
    },
    async leerIdDeFila(fila) {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'Créditos'!A${fila}:A${fila}`, valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS })
      return String(r.data.values?.[0]?.[0] ?? '').trim()
    },
    async escribir(fila, bloqueAG, bloqueIK) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW', // RAW: un texto que empiece con "=" no se toma por fórmula
          data: [
            { range: `'Créditos'!A${fila}:G${fila}`, values: [bloqueAG] },
            { range: `'Créditos'!I${fila}:K${fila}`, values: [bloqueIK] },
          ],
        },
      }, { timeout: TIMEOUT_RED_SHEETS_MS })
    },
  }
}
