// ── Bot "Capital Jurídico": vista previa del alta en el CRM de Clientes contra la planilla REAL ─────
// Solo de servidor (usa lib/clientes/leer.ts → googleapis, variables de entorno y el snapshot en disco).
// SOLO LECTURA: lee "2026 - CRM - CLIENTES" con las funciones de siempre (scope readonly, snapshot de 10 min,
// sin reintentos ante un 429, pedidos simultáneos comparten una lectura) y devuelve el PlanAlta de planAlta(),
// que es dry-run. Este módulo no escribe en ninguna planilla: escribir de verdad es un paso aparte.
//
// Costo de cuota: 0 llamadas si el snapshot está fresco; si no, 1 batchGet. Las fórmulas de la fila 2 de Agencia se
// toman del snapshot; si no las tiene, se sondean (1 llamada más) SOLO si esta misma vista previa acaba de leer Sheets
// sin error: nunca con un snapshot guardado (y menos con el viejo que queda después de un 429). Si el sondeo falla, no
// se reintenta por 60 s en esta instancia, y pedidos simultáneos comparten un solo sondeo. Sin fórmulas, planAlta
// deduce las 5 conocidas (J:N).
// Limitación conocida (lib/clientes/leer.ts, compartido con producción, no se toca desde acá): las fórmulas que quedan
// guardadas en el snapshot no se vuelven a leer nunca; si el equipo agrega una columna con fórmula, hay que invalidarlo.
//
// PARA ESCRIBIR, ESTA VISTA PREVIA NO SIRVE TAL CUAL. idNuevo, filaAgencia y filaRenovaciones salen de una lectura que
// puede tener hasta 10 min (o más, si es el snapshot viejo de después de un 429). El paso de escritura (crmEscribir.ts,
// que llama acá con { forzarLectura: true }) tiene que:
//   1. volver a leer forzando (obtenerHojas({ forzar: true })) y rearmar el plan;
//   2. escribir solo si `aptoParaEscribir` (plan ok, sin faltantes ni bloqueos, lectura de hace menos de 60 s);
//   3. justo antes de escribir, comprobar que las filas de destino de Agencia y Renovaciones sigan vacías.
import type { PlanAlta } from '../../clientes/altas'
import { planAlta } from '../../clientes/altas'
import { datosDesdeSnapshot, obtenerHojas, sondearFormulas } from '../../clientes/leer'
import type { FormulasCRM } from '../../clientes/leer'
import { columnasDeClientes } from '../../clientes/parsear'
import { ESPERA_TRAS_FALLO_MS } from '../../clientes/snapshot'
import type { Snapshot } from '../../clientes/snapshot'
import type { FuenteDatos } from '../../clientes/tipos'
import type { AltaParseada } from './parsear'
import { entradaCrmDesdeAlta } from './crm'
import type { Bloqueo, ExtrasCrm, MapeoCrm } from './crm'
import { buscarClienteEnCrm, type ClienteEncontrado } from './altaLibre'

/** Una lectura sirve para escribir si tiene menos de esto (y no es el snapshot viejo de después de un error). */
export const LECTURA_FRESCA_MS = 60_000

export interface PreviaAltaCrm {
  plan: PlanAlta
  entrada: MapeoCrm['entrada']
  faltantes: string[]           // del mapeo: se le piden al closer
  bloqueos: Bloqueo[]           // del mapeo + posibles clientes repetidos que no están FINALIZADO + columnas que no se encontraron
  avisos: string[]              // del mapeo + del sondeo de fórmulas
  parser: { faltantes: string[]; avisos: string[] }   // los de parsearAlta, tal cual
  lectura: {
    fuente: FuenteDatos
    snapshotEn: number          // epoch ms de la lectura real a Sheets
    edadSeg: number             // antigüedad de esa lectura cuando se armó la vista previa
    formulas: 'planilla' | 'deducidas'
    avisos: string[]            // los de la lectura del CRM (snapshot viejo, encabezados que no se reconocen…)
  }
  aptoParaEscribir: boolean     // ver "PARA ESCRIBIR" arriba
  motivosNoApto: string[]
}

// ── Sondeo de fórmulas con las mismas precauciones de cuota que obtenerHojas ──
let sondeoFallidoHasta = 0
let sondeoEnVuelo: Promise<FormulasCRM> | null = null

/** Solo para los tests: olvida el último fallo del sondeo. */
export function reiniciarSondeo(): void { sondeoFallidoHasta = 0; sondeoEnVuelo = null }

function sondearCompartido(): Promise<FormulasCRM> {
  sondeoEnVuelo ??= sondearFormulas().finally(() => { sondeoEnVuelo = null })
  return sondeoEnVuelo
}

/** Fórmulas de Agencia para el plan: las del snapshot; si no están, un sondeo solo cuando la lectura acaba de venir de
 *  Sheets y no hubo un fallo en los últimos 60 s. null = que planAlta las deduzca. (`sondear` se cambia en los tests.) */
export async function formulasParaPlan(
  snap: Pick<Snapshot, 'formulasAgencia'>, fuente: FuenteDatos,
  sondear: () => Promise<FormulasCRM> = sondearCompartido, ahora: number = Date.now(),
): Promise<{ formulas: Record<string, string> | null; aviso?: string }> {
  if (snap.formulasAgencia && Object.keys(snap.formulasAgencia).length) return { formulas: snap.formulasAgencia }
  if (fuente !== 'sheets' || ahora < sondeoFallidoHasta) return { formulas: null }
  try {
    return { formulas: (await sondear()).agencia }
  } catch (e) {
    sondeoFallidoHasta = Date.now() + ESPERA_TRAS_FALLO_MS
    return { formulas: null, aviso: `No se pudieron leer las fórmulas de la fila 2 de Agencia (${String((e as Error).message ?? e).slice(0, 120)}): se toman las 5 conocidas (J:N).` }
  }
}

export interface OpcionesPrevia {
  /** Saltea el TTL del snapshot y vuelve a leer Sheets. Lo usa SOLO el paso de escritura (crmEscribir.ts): la vista
   *  previa de pantalla nunca fuerza. leer.ts igual respeta el mínimo de 30 s entre lecturas y la espera tras un error;
   *  en esos casos devuelve el snapshot y es la edad de la lectura la que decide si es apta para escribir. */
  forzarLectura?: boolean
}

export async function previsualizarAltaCrm(
  a: AltaParseada,
  extras: Omit<ExtrasCrm, 'closersConocidos'> = {},   // por defecto la vista previa no fuerza ni acorta el TTL del snapshot
  opciones: OpcionesPrevia = {},
): Promise<PreviaAltaCrm> {
  const { snap, fuente, aviso } = await obtenerHojas(opciones.forzarLectura ? { forzar: true } : {})
  const datos = datosDesdeSnapshot(snap, fuente, {}, aviso)   // datos.avisos ya trae el aviso de la lectura
  const { formulas: formulasAgencia, aviso: avisoSondeo } = await formulasParaPlan(snap, fuente)

  // Closers tal como figuran en Agencia, para escribir el del #ALTA igual (las métricas agrupan por ese texto)
  const closersConocidos = [...new Set(datos.clientes.filter(c => c.linea === 'agencia').map(c => c.closer.trim()).filter(Boolean))]
  const mapeo = entradaCrmDesdeAlta(a, { ...extras, closersConocidos })

  const plan = planAlta(mapeo.entrada, {
    hojas: { agencia: snap.hojas.agencia, consultora: snap.hojas.consultora, renovaciones: snap.hojas.renovaciones },
    clientes: datos.clientes.map(({ id, linea, nombre, celular, mail, estado }) => ({ id, linea, nombre, celular, mail, estado })),
    formulasAgencia,
  })

  const bloqueos: Bloqueo[] = [...mapeo.bloqueos]
  // Posible cliente repetido: planAlta solo frena los ACTIVO y PAUSADO. Uno INACTIVO o sin estado puede ser el mismo
  // cliente (¿se reactiva o renueva?): un bot no le da un ID nuevo sin que un humano lo confirme. FINALIZADO = vuelve
  // como cliente nuevo y lleva ID nuevo (queda la advertencia de planAlta).
  const dudosos = plan.duplicados.filter(d => !['FINALIZADO', 'ACTIVO', 'PAUSADO'].includes(d.estado))
  if (dudosos.length) {
    bloqueos.push({ motivo: 'confirmar', detalle: `Coincide con ${dudosos.map(d => `${d.id || '(sin ID)'} (${d.estado || 'sin estado'}, por ${d.motivo})`).join(', ')}: un humano confirma si es el mismo cliente antes de darle un ID nuevo.` })
  }
  // planAlta solo exige ID, nombre, estado y Día 1: sin Celular o Mail la búsqueda de repetidos por ese dato se apaga
  const colA = columnasDeClientes('Agencia', snap.hojas.agencia[0])
  const sinColumna = (['celular', 'mail'] as const).filter(k => colA.idx[k] < 0)
  if (sinColumna.length) {
    bloqueos.push({ motivo: 'lectura', detalle: `No se encontró la columna ${sinColumna.map(k => (k === 'celular' ? '"Celular"' : '"Mail"')).join(' ni ')} en Agencia (¿cambió el encabezado?): sin ella no se buscan repetidos por ese dato ni se escribe.` })
  }

  const avisos = [...mapeo.avisos, ...(avisoSondeo ? [avisoSondeo] : [])]
  const parser = { faltantes: [...a.faltantes], avisos: [...a.avisos] }
  const edadMs = Math.max(0, Date.now() - snap.guardadoEn)

  const motivosNoApto: string[] = []
  if (!plan.ok) motivosNoApto.push(`El plan tiene errores: ${plan.errores.join(' ')}`)
  const todosLosFaltantes = [...new Set([...parser.faltantes, ...mapeo.faltantes])]
  if (todosLosFaltantes.length) motivosNoApto.push(`Faltan datos del closer: ${todosLosFaltantes.join(', ')}.`)
  for (const b of bloqueos) motivosNoApto.push(b.detalle)
  if (fuente === 'snapshot_viejo' || edadMs > LECTURA_FRESCA_MS) {
    motivosNoApto.push(`La lectura del CRM tiene ${Math.round(edadMs / 1000)} s (${fuente}): antes de escribir hay que volver a leer forzando (máximo ${LECTURA_FRESCA_MS / 1000} s).`)
  }

  return {
    plan,
    entrada: mapeo.entrada,
    faltantes: mapeo.faltantes,
    bloqueos,
    avisos,
    parser,
    lectura: {
      fuente, snapshotEn: snap.guardadoEn, edadSeg: Math.round(edadMs / 1000),
      formulas: formulasAgencia && Object.keys(formulasAgencia).length ? 'planilla' : 'deducidas',
      avisos: datos.avisos,
    },
    aptoParaEscribir: motivosNoApto.length === 0,
    motivosNoApto,
  }
}

/** Alta en formato libre (Tomás, 26/10/2026, regla A): ¿la persona ya está en el CRM de Clientes (por teléfono, correo o
 *  nombre)? Si está, no es un alta: es un pago de un cliente existente. SOLO LECTURA, con el snapshot de siempre (no fuerza:
 *  0 llamadas si está fresco). El criterio es puro: buscarClienteEnCrm (altaLibre.ts). */
export async function buscarPersonaEnCrm(p: { nombre: string | null; telefono: string | null; correo: string | null }): Promise<ClienteEncontrado | null> {
  const { snap, fuente, aviso } = await obtenerHojas({})
  const datos = datosDesdeSnapshot(snap, fuente, {}, aviso)
  return buscarClienteEnCrm(datos.clientes.map(({ id, nombre, celular, mail, estado }) => ({ id, nombre, celular, mail, estado })), p)
}
