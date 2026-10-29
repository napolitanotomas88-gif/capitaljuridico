// ── Tablero de Anuncios de EJEMPLO (solo desarrollo, ?demo=1, 25/10/2026) ───────────────────────────────────────────────
// Seis cuentas ficticias "(ejemplo)" con días de gasto y mensajes inventados, analizadas con las MISMAS reglas que el tablero
// real (analizarCuenta), para revisar el diseño sin Meta, ClickUp ni la planilla. No se usa en producción: la pantalla
// (components/anuncios/TableroAnuncios.tsx) solo lo pide con ?demo=1 y fuera de producción.
import { analizarCuenta } from './reglas'
import type { CuentaMeta, DiaInsight } from './meta'
import type { FilaAnuncio, Tablero } from './tablero'   // solo tipos: tablero.ts es del servidor y este archivo va al navegador

const sumar = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

type Patron = { cliente: string; gasto: number; cpl: number; deriva?: number; frenada?: number; sinMensajes?: boolean; error?: boolean; pausado?: boolean; nueva?: boolean }

const PATRONES: Patron[] = [
  { cliente: 'Estudio Ejemplo Uno (ejemplo)', gasto: 30, cpl: 2.2 },
  { cliente: 'Clienta Ejemplo Dos (ejemplo)', gasto: 25, cpl: 3.1, deriva: 0.06 },
  { cliente: 'Estudio Ejemplo Tres (ejemplo)', gasto: 18, cpl: 9, sinMensajes: true },
  { cliente: 'Estudio Ejemplo Cuatro (ejemplo)', gasto: 22, cpl: 2.8, error: true },
  { cliente: 'Estudio Ejemplo Cinco (ejemplo)', gasto: 15, cpl: 4.5, frenada: 4 },
  { cliente: 'Clienta Ejemplo Seis (ejemplo)', gasto: 20, cpl: 1.9, nueva: true },
]

function diasDe(p: Patron, hoy: string): DiaInsight[] {
  return Array.from({ length: 35 }, (_, i) => {
    const d = sumar(hoy, -(35 - i))
    const atras = 35 - i
    if (p.frenada && atras <= p.frenada) return { d, g: 0, m: 0 }
    if (p.nueva && atras > 8) return { d, g: 0, m: 0 }
    const ruido = 0.85 + ((i * 37) % 30) / 100
    const g = Math.round(p.gasto * ruido * 100) / 100
    const cpl = p.cpl * (1 + (p.deriva ?? 0) * Math.max(0, 10 - atras))
    const m = p.sinMensajes && atras <= 6 ? 0 : Math.max(0, Math.round(g / cpl))
    return { d, g, m }
  })
}

export function tableroDemo(hoy: string): Tablero {
  const filas: FilaAnuncio[] = PATRONES.map((p, i) => {
    const id = `act_10000${i}`
    const cuenta: CuentaMeta = {
      id, nombre: `CJ ${p.cliente}`, estado: p.error ? 2 : 1, motivoBaja: 0, moneda: 'USD', zonaHoraria: 'America/Argentina/Buenos_Aires',
      negocio: null, gastadoTotal: 1500 + i * 220, limiteGasto: 0, deuda: 0, entrega: 'activa',
      medioPago: { id: 'pm', texto: 'Visa (ejemplo)', tipo: 1 }, prepago: false, token: 'ejemplo',
    }
    const dias = diasDe(p, hoy)
    const a = analizarCuenta(cuenta, dias, hoy, { pausado: !!p.pausado, guiones: null, moneda: 'USD', usdPor: 1, umbral: { ok: 3, medio: 5 } })
    const fila: FilaAnuncio = {
      ...a,
      presupuesto: { mensualUSD: 600 + i * 50, objetivoDiarioUSD: 20, realDiarioUSD: p.gasto, gastadoMesUSD: p.gasto * 24, proyeccionUSD: p.gasto * 31, ajusteDiarioUSD: null, fuente: 'ejemplo', estado: 'en_rango' },
      id, idNum: id.replace('act_', ''), cliente: p.cliente, clienteCRM: p.cliente, cuenta: cuenta.nombre, negocio: null, moneda: 'USD',
      links: { ads: '#', portfolio: null }, extra: false, pausado: !!p.pausado,
      guiones: { estado: i % 3 === 0 ? 'pendiente' : 'grabado', detalle: 'Ejemplo', alias: [] },
      sinDatosCuenta: false,
      estadoSemanal: { semaforo: a.semaforo, motivos: a.motivos, frase: a.frase, prioridad: a.prioridad, nivel: a.cpl.nivel },
      previo: { semaforo: a.semaforo, rendimiento: [], aGrabar: !!a.aGrabar },
      rama: null, clickup: null,
      lanzamientos: p.nueva ? [{
        cuenta: id, campanaId: `c${i}`, campana: 'Campaña DM (ejemplo)', fecha: sumar(hoy, -8), dm: true, anuncios: 3, gasto: p.gasto * 8, mensajes: Math.round((p.gasto * 8) / p.cpl),
        dia: 8, cplUSD: p.cpl, link: '#', fechaOptimizacion: null, etapa: null, diasCompetencia: 0, pendienteRevision: false, diasDesdeRevision: 0, fechaRevision: null,
      }] : [],
      revisarDia4: false, usdPor: 1,
    }
    return fila
  })
  const cuenta = (pred: (f: FilaAnuncio) => boolean) => filas.filter(pred).length
  return {
    generado: new Date().toISOString(), hoy,
    actualizado: { cuentas: new Date().toISOString(), insights: new Date().toISOString(), sheets: new Date().toISOString() },
    refresco: { lanzamientosSeg: 900, clickupSeg: 3600, cuentasSeg: 150, insightsSeg: 720, sheetsSeg: 300, descubrimientoSeg: 1800, tokenSeg: 3600, dolarSeg: 1800, monedasSeg: 21600, kickoffsSeg: 300, pantallaSeg: 15 },
    token: null,
    avisos: ['Datos de ejemplo (?demo=1): cuentas ficticias para revisar el diseño. No salen de Meta.'],
    diasMeta: [],
    resumen: {
      porLanzar: 0, sinAccesoPorLanzar: 0, porLanzarConFicha: 0, listosParaArmar: 0, erroresNuevos: 0,
      periodoGracia: cuenta(f => f.pago.periodoGracia), revisarPresupuesto: 0, sinGasto: cuenta(f => f.semaforo === 'sin_gasto'),
      total: filas.length, errores: cuenta(f => f.semaforo === 'error'), aGrabar: cuenta(f => !!f.aGrabar),
      lanzadas: cuenta(f => f.lanzamientos.length > 0), revisarDia4: 0,
      rojos: cuenta(f => f.semaforo === 'rojo'), amarillos: cuenta(f => f.semaforo === 'amarillo'), verdes: cuenta(f => f.semaforo === 'verde'),
      erroresPago: cuenta(f => f.pago.errorPago), saldosPorAgotarse: 0, sinGuiones: 0, sinGuionesNecesarios: 0,
      frenadas: cuenta(f => f.corriendo.frenadaHace != null), sinMensajes: cuenta(f => f.motivos.some(m => m.tipo === 'sin_mensajes')),
      enAumento: cuenta(f => !!f.aumento),
    },
    filas, excluidas: [], porLanzar: [], avisosPorLanzar: [], dolar: null, optimizacionesLeidas: true,
  }
}
