// ── Datos FICTICIOS para revisar el diseño de Clientes y Referidos (?demo=1) ───────────────
// Solo en desarrollo: en producción demoPermitido() da false y la interfaz ignora el parámetro.
// Nada de esto sale de la planilla ni se parece a un cliente real: todos los nombres llevan "(ejemplo)",
// los IDs son E001 a E009 y los teléfonos son de relleno. Las fechas se calculan a partir de `hoy`.
// El programa real arranca el 1/10/2026, así que con la fecha de hoy todavía no hay créditos liberados: para poder mostrar
// créditos liberados, canjeados y por vencer, el EJEMPLO se calcula con un inicio del programa 14 meses antes de hoy
// (solo cambia esa fecha: las demás reglas son las reales). Esas reglas viajan en `datos.reglas`.
import type { ClienteBase, DatosClientes, MovimientoCredito, Periodo, Referido, Ymd } from './tipos'
import { REGLAS_REFERIDOS, type ReglasReferidos } from './reglasReferidos'
import { derivarClientes } from './clasificar'
import { sumarDias, sumarMeses } from './fechas'

export const demoPermitido = (): boolean => process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production'

/** ¿Pidieron ?demo=1 y está permitido? En producción siempre false */
export const pedidoDemo = (v: string | string[] | undefined): boolean => demoPermitido() && (Array.isArray(v) ? v[0] : v) === '1'

const NOMBRES = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve']

/** Reglas del ejemplo: las reales, con el programa arrancando 14 meses antes de `hoy` */
export const reglasDeDemo = (hoy: Ymd): ReglasReferidos => ({ ...REGLAS_REFERIDOS, vigenteDesde: sumarMeses(hoy, -14) })

export function crearDatosDemo(hoy: Ymd): DatosClientes {
  const d = (n: number): Ymd => sumarDias(hoy, n)
  const reglas = reglasDeDemo(hoy)
  const inicioMes = `${hoy.slice(0, 7)}-01`   // los clientes nuevos de este mes tienen Día 1 el primero: siempre cae en el mes de hoy
  const base = (i: number, { finEn, ...o }: Partial<ClienteBase> & { finEn: number }): ClienteBase => {
    const id = `E00${i + 1}`
    const dia1 = d(-200 - i * 20)
    return {
      id, linea: 'agencia', fila: i + 2, nombre: `Estudio Ejemplo ${NOMBRES[i]} (ejemplo)`, estado: 'ACTIVO',
      celular: `+54 9 11 5550-010${i + 1}`, mail: `contacto${i + 1}@ejemplo.test`, closer: ['Gero', 'Fer', 'Carlos'][i % 3], fuente: 'Instagram', contrato: 'Firmado',
      dia1, finPeriodo: d(finEn), renovo: 'NO', ltvContratado: 4000 + i * 500, ltvCobrado: 4000 + i * 500, duracionDias: 240,
      promesa: 'Sí', satisfaccion: 8, testimonio: '', gameplan: '', notasRenov: '', anotaciones: 'Cliente de ejemplo para revisar el diseño.',
      proximoCobro: null, llamadaAgendada: null, fechaBaja: null,
      periodos: [], ...o,
    }
  }
  const periodo = (c: ClienteBase, n: number, desde: number, hasta: number, precio: number | null, notas = ''): Periodo => ({
    idCliente: c.id, fila: n + 2, nombre: c.nombre, periodo: n, dia1: d(desde), fin: d(hasta), precio, notas, meses: null,
    esExtension: notas.startsWith('Extensión'), esRenovacionPaga: n > 0 && !notas.startsWith('Extensión') && precio !== 0,
  })

  // E007 a E009: clientes nuevos de este mes (Día 1 el primero), para el KPI "clientes nuevos que entran por referido"
  const nuevoDeEsteMes = { dia1: inicioMes, ltvContratado: 2600, ltvCobrado: 2600, duracionDias: 120, proximoCobro: null }
  const clientes: ClienteBase[] = [
    base(0, { finEn: 40, renovo: 'R1', ltvContratado: 8000, ltvCobrado: 6000, proximoCobro: d(9) }),
    base(1, { finEn: 6 }),
    base(2, { finEn: 90, celular: '+54 9 351 555-0103' }),   // Córdoba: la zona queda "sin determinar"
    base(3, { finEn: -5, ltvCobrado: 2000 }),
    base(4, { finEn: 25, renovo: 'R1', celular: '+598 99 555 105' }),   // Uruguay: la zona queda "sin determinar"
    base(5, { finEn: 120 }),
    base(6, { finEn: 125, closer: 'Fer', fuente: 'Referido', ...nuevoDeEsteMes }),
    base(7, { finEn: 126, closer: 'Carlos', ...nuevoDeEsteMes }),
    base(8, { finEn: 127, closer: 'Fer', ...nuevoDeEsteMes }),
  ]
  clientes[0].periodos = [periodo(clientes[0], 0, -200, -80, 2600), periodo(clientes[0], 1, -80, 40, 5400), periodo(clientes[0], 2, 40, 70, 0, 'Extensión +1 mes')]
  clientes[1].periodos = [periodo(clientes[1], 0, -220, 6, 4500)]
  clientes[4].periodos = [periodo(clientes[4], 0, -330, -210, 2600), periodo(clientes[4], 1, -200, 25, 4000)]
  for (const i of [6, 7, 8]) clientes[i].periodos = [{ ...periodo(clientes[i], 0, 0, 0, 2600), dia1: inicioMes, fin: sumarMeses(inicioMes, 4) }]

  const ref = (n: number, idReferidor: string, estado: Referido['estado'], o: Partial<Referido> = {}): Referido => ({
    id: `R${String(n).padStart(3, '0')}`, fila: n + 1, fechaPedido: d(-90), momento: 'primer_win', idReferidor,
    nombre: `Referido ${n} (ejemplo)`, telefono: `+54 9 11 5551-${String(n).padStart(4, '0')}`, mail: '', estudio: `Estudio Referido ${n} (ejemplo)`,
    estado, fechaLlamada: null, idClienteNuevo: '', fechaPrimerPago: null, fechaLiberacion: null, reembolso: false, notas: '', cargadoPor: 'Demo', ...o,
  })
  // Primer pago hace `n` días: el crédito se libera 14 días después. El pedido es anterior a la llamada.
  const cerro = (n: number, idReferidor: string, haceDias: number, o: Partial<Referido> = {}) =>
    ref(n, idReferidor, 'Cerró', { fechaPedido: d(-haceDias - 20), fechaLlamada: d(-haceDias - 10), fechaPrimerPago: d(-haceDias), idClienteNuevo: `A2${String(n).padStart(2, '0')}`, ...o })

  // Un crédito liberado hace casi 12 meses: vence dentro de unos 20 días
  const venceEn20 = sumarDias(sumarMeses(hoy, -12), 20)   // fecha de liberación
  const pagoViejo = sumarDias(venceEn20, -14)
  // Un referido presentado ANTES del inicio del programa (del ejemplo): cerró, pero no genera crédito
  const antesDelPrograma = sumarMeses(reglas.vigenteDesde, -1)

  // Un intento = el referido entró a la llamada y NO cerró: se gana el premio en la fecha de la llamada
  const noCerro = (n: number, idReferidor: string, diaLlamada: number, o: Partial<Referido> = {}) =>
    ref(n, idReferidor, 'No cerró', { fechaPedido: d(diaLlamada - 10), fechaLlamada: d(diaLlamada), ...o })
  const haceUnAnio = sumarMeses(hoy, -12)

  const referidos: Referido[] = [
    // E001: tres cierres liberados (renovación gratis de 4 meses) + 5 intentos (página web, USD 300, branding, USD 300 y +1 mes) + un presentado
    // y una llamada a la que asistió sin resultado todavía (no cuenta como intento)
    cerro(1, 'E001', 120, { momento: 'post_kickoff' }), cerro(2, 'E001', 90, { momento: 'primer_win' }), cerro(3, 'E001', 60, { momento: 'reporte_fin_de_mes' }),
    noCerro(4, 'E001', -180, { momento: 'llamada_proyeccion' }),
    ref(5, 'E001', 'Presentado', { fechaPedido: d(-6), momento: 'reporte_fin_de_mes' }),
    // E002: dos cierres liberados (nivel 2) y un tercero por liberarse en 9 días (cerca de la renovación gratis) + 2 intentos (página web y USD 300)
    cerro(6, 'E002', 100), cerro(7, 'E002', 70), cerro(8, 'E002', 5, { momento: 'reporte_fin_de_mes', idClienteNuevo: 'E007' }),
    noCerro(9, 'E002', -12),
    // E003: un cierre liberado, un intento (página web) y un referido que asistió sin resultado todavía
    cerro(10, 'E003', 45), noCerro(11, 'E003', -30), ref(12, 'E003', 'Asistió', { fechaLlamada: d(-8) }),
    // E004: un cierre sin primer pago, un presentado, un "no asistió", un cierre y un "no cerró" anteriores al programa, y un "asistió" sin resultado
    ref(13, 'E004', 'Cerró', { fechaLlamada: d(-3), idClienteNuevo: 'A230' }), ref(14, 'E004', 'Presentado', { fechaPedido: d(-2), momento: 'post_kickoff' }), ref(15, 'E004', 'No asistió', { fechaLlamada: d(-15) }),
    // E005: un cierre reembolsado y otro de un ciclo ya canjeado; intentos antes y después del canje (el USD 300 del ciclo anterior ya se consumió)
    cerro(16, 'E005', 40, { reembolso: true, notas: 'Pidió el reembolso a los 10 días.' }), cerro(17, 'E005', 330),
    // E006: un crédito que vence pronto y otro reciente; dos intentos cuyos premios vencen en 15 y 25 días (la página web y los USD 300)
    ref(18, 'E006', 'Cerró', { fechaPedido: sumarDias(pagoViejo, -20), fechaLlamada: sumarDias(pagoViejo, -10), fechaPrimerPago: pagoViejo, idClienteNuevo: 'A240', momento: 'post_kickoff' }), cerro(19, 'E006', 30),
    // Intentos que completan las escaleras de E002 (R020 va primero), E001 y E005
    noCerro(20, 'E002', -25),
    noCerro(21, 'E001', -150), noCerro(22, 'E001', -120),
    ref(23, 'E004', 'Cerró', { fechaPedido: antesDelPrograma, fechaLlamada: sumarDias(antesDelPrograma, 10), fechaPrimerPago: sumarDias(antesDelPrograma, 20), idClienteNuevo: 'A199', notas: 'Presentado antes del inicio del programa.' }),
    noCerro(24, 'E001', -60), noCerro(25, 'E001', -20),
    ref(26, 'E001', 'Asistió', { fechaLlamada: d(-3), momento: 'llamada_proyeccion' }),
    ref(27, 'E004', 'Asistió', { fechaLlamada: d(-4) }),
    ref(28, 'E004', 'No cerró', { fechaPedido: antesDelPrograma, fechaLlamada: sumarDias(antesDelPrograma, 5), notas: 'Presentado antes del inicio del programa: no es un intento.' }),
    noCerro(29, 'E005', -300), noCerro(30, 'E005', -280), noCerro(31, 'E005', -60),
    noCerro(32, 'E006', 0, { fechaLlamada: sumarDias(haceUnAnio, 15), fechaPedido: sumarDias(haceUnAnio, 5) }),
    noCerro(33, 'E006', 0, { fechaLlamada: sumarDias(haceUnAnio, 25), fechaPedido: sumarDias(haceUnAnio, 15) }),
  ]

  const mov = (n: number, idCliente: string, tipo: MovimientoCredito['tipo'], fecha: Ymd, meses: number, o: Partial<MovimientoCredito> = {}): MovimientoCredito => ({
    id: `M${String(n).padStart(3, '0')}`, fila: n + 1, fecha, idCliente, tipo, idReferido: '', meses, extra: '', vence: null, renovacionAplicada: '', nota: '', cargadoPor: 'Demo', ...o,
  })
  // El libro no tiene columna de USD: los canjes en USD van en el texto del campo Extra ("USD 300")
  const movimientos: MovimientoCredito[] = [
    mov(1, 'E001', 'ganado_cierre', d(-106), 1, { idReferido: 'R001', vence: sumarMeses(d(-106), 12) }),
    mov(2, 'E001', 'ganado_cierre', d(-76), 1, { idReferido: 'R002', vence: sumarMeses(d(-76), 12), nota: 'Pasa a 2 meses (reemplaza el nivel anterior)' }),
    mov(3, 'E001', 'ganado_cierre', d(-46), 2, { idReferido: 'R003', vence: sumarMeses(d(-46), 12), nota: 'Pasa a la renovación gratis de 4 meses' }),
    mov(4, 'E002', 'ganado_cierre', d(-86), 1, { idReferido: 'R006' }),
    mov(5, 'E002', 'ganado_cierre', d(-56), 1, { idReferido: 'R007' }),
    mov(6, 'E005', 'ganado_cierre', d(-316), 1, { idReferido: 'R017' }),
    mov(7, 'E005', 'canje', d(-250), -1, { renovacionAplicada: 'R1', extra: 'USD 300', nota: 'Canje contra renovación: 1 mes y USD 300' }),
    // Premios por intentos de E001: página web (intento 1), branding (intento 3) y el mes del intento 5
    mov(8, 'E001', 'ganado_llamada', d(-180), 0, { idReferido: 'R004', extra: 'página web', vence: sumarMeses(d(-180), 12) }),
    mov(9, 'E001', 'ganado_llamada', d(-120), 0, { idReferido: 'R022', extra: 'branding', vence: sumarMeses(d(-120), 12) }),
    mov(10, 'E001', 'ganado_llamada', d(-20), 1, { idReferido: 'R025', vence: sumarMeses(d(-20), 12), nota: 'Intento 5: +1 mes de servicio' }),
    // Entrega de la página web de E005: es un extra, no corta el ciclo
    mov(11, 'E005', 'canje', d(-200), 0, { extra: 'página web', nota: 'Entrega de la página web' }),
  ]

  const periodos = clientes.flatMap(c => c.periodos)
  return {
    hoy,
    clientes: derivarClientes(clientes, hoy),
    periodos, referidos, movimientos,
    pestanasAusentes: [], columnas: [],
    fuente: 'snapshot', snapshotEn: Date.now(), avisos: [],
    reglas,
  }
}
