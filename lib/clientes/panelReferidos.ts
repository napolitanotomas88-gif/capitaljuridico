// ── Panel de referidos de UN cliente (puro: sin red ni reloj) ───────────────────────────────
// Junta en un solo objeto lo que se muestra en las columnas de /clientes y en el panel de la ficha: cuántos referidos
// presentó, cuántos asistieron y cuántos cerraron; los créditos disponibles, usados y pendientes de liberar; y los beneficios
// (intentos y sus premios, saldo en USD, extra del nivel, grabación según la zona). NO calcula reglas: lee el ResumenCredito de
// creditos.ts, que ya las aplicó, y solo cuenta filas de la pestaña Referidos y del libro de Créditos. No inventa montos.
//   · presentados = todas las filas de Referidos con este cliente como quien refiere (también las anteriores al programa,
//     que se informan aparte porque no generan crédito).
//   · asistieron = estado dentro de reglas.estadosAsistio (Asistió, Cerró y No cerró).
//   · cerraron = estado "Cerró" (todavía no significa crédito: se libera con el primer pago y 14 días sin reembolso).
//   · intentos = los que entraron a la llamada y no cerraron ("No cerró"), vistos por el cálculo (válidos y posteriores al inicio).
//   · usados = meses ya canjeados contra una renovación (movimientos "canje" del libro, sin contar los de un extra).
import type { MovimientoCredito, Referido, ResumenCredito, Ymd } from './tipos'
import type { PremioIntento, ReglasReferidos } from './reglasReferidos'
import { REGLAS_REFERIDOS } from './reglasReferidos'
import { esCanjeDeExtra, premioDelIntento, saldoCanjeable } from './creditos'
import type { EntregableGanado } from './tipos'
import { mesesTexto, usd as usdTexto } from './formato'
import { textoExtra } from './programa'
import type { ZonaGrabacion } from './zona'

export interface PanelReferidos {
  referidos: { presentados: number; asistieron: number; cerraron: number; anterioresAlPrograma: number }
  creditos: {
    disponibles: number           // meses (escalera de cierres + mes del intento 5 con el tope + ajustes vigentes)
    usados: number                // meses canjeados contra renovaciones (suma de los canjes del libro)
    pendientesDeLiberar: number   // cierres que todavía no se liberaron (falta el primer pago o los días sin reembolso)
  }
  beneficios: {
    nivel: number
    cierresLiberados: number
    mesesPorCierres: number
    mesesPorIntentos: number
    intentos: number              // cantidad acumulada de intentos (referidos que entraron a la llamada y no cerraron)
    renovacionGratis: boolean
    extras: string[]
    paginaWeb: EntregableGanado | null
    branding: EntregableGanado | null
    usd: { ganado: number; usado: number; vencido: number; disponible: number }
    proximoIntento: { intento: number; premio: PremioIntento; etiqueta: string; creditoUSD: number }
    zona: ZonaGrabacion           // pista para ofrecer la grabación en las oficinas (la confirma el closer)
  }
}

/** Panel de un cliente. `resumen` undefined = sin actividad (se calcula con ceros: el cliente aparece, pero vacío). `zona` pisa la del resumen. */
export function panelDeCliente(
  idCliente: string,
  referidos: Referido[],
  movimientos: MovimientoCredito[],
  resumen: ResumenCredito | undefined,
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
  zona?: ZonaGrabacion,
): PanelReferidos {
  const propios = referidos.filter(r => r.idReferidor === idCliente)
  const asistieron = propios.filter(r => (reglas.estadosAsistio as string[]).includes(r.estado)).length
  const cerraron = propios.filter(r => r.estado === 'Cerró').length
  const libro = movimientos.filter(m => m.idCliente === idCliente)
  const mesesUsados = libro.filter(m => m.tipo === 'canje' && !esCanjeDeExtra(m)).reduce((s, m) => s + (Number.isFinite(m.meses) && m.meses < 0 ? -m.meses : 0), 0)
  const saldo = resumen ? saldoCanjeable(resumen, reglas) : null
  const sig = resumen?.proximoIntento ?? (({ intento, premio, etiqueta, creditoUSD }) => ({ intento, premio, etiqueta, creditoUSD }))(premioDelIntento(1, reglas))
  return {
    referidos: { presentados: propios.length, asistieron, cerraron, anterioresAlPrograma: resumen?.anterioresAlPrograma ?? 0 },
    creditos: {
      disponibles: saldo?.meses ?? 0,
      usados: mesesUsados,
      pendientesDeLiberar: resumen?.cierresPendientes.length ?? 0,
    },
    beneficios: {
      nivel: resumen?.nivel ?? 0,
      cierresLiberados: resumen?.cierresLiberados ?? 0,
      mesesPorCierres: resumen?.mesesPorCierres ?? 0,
      mesesPorIntentos: resumen?.mesesPorIntentos ?? 0,
      intentos: resumen?.intentos ?? 0,
      renovacionGratis: resumen?.renovacionGratis ?? false,
      extras: resumen?.extras ?? [],
      paginaWeb: resumen?.paginaWeb ?? null,
      branding: resumen?.branding ?? null,
      usd: resumen?.usd ?? { ganado: 0, usado: 0, vencido: 0, disponible: 0 },
      proximoIntento: sig,
      zona: zona ?? resumen?.zona ?? 'sin_determinar',
    },
  }
}

/** Un panel por cada cliente que presentó a alguien o tiene movimientos en el libro (los demás no figuran en el mapa). */
export function panelesDeTodos(
  datos: { referidos: Referido[]; movimientos: MovimientoCredito[]; hoy: Ymd },
  creditos: Map<string, ResumenCredito>,
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
): Map<string, PanelReferidos> {
  const ids = new Set<string>(creditos.keys())
  for (const r of datos.referidos) if (r.idReferidor) ids.add(r.idReferidor)
  const out = new Map<string, PanelReferidos>()
  for (const id of ids) out.set(id, panelDeCliente(id, datos.referidos, datos.movimientos, creditos.get(id), reglas))
  return out
}

// ── Detalle del beneficio, según las reglas verificadas (ver docs/REGLAS-REFERIDOS.md) ──────────────
export interface LineaBeneficio { clave: 'escalera' | 'intentos' | 'usd' | 'grabacion' | 'extra' | 'tope' | 'canje'; titulo: string; texto: string }

const textoEntregable = (nombre: string, femenino: boolean, e: EntregableGanado | null): string =>
  e ? `${nombre}: ${e.vigente ? (femenino ? 'ganada' : 'ganado') : (femenino ? 'vencida' : 'vencido')}` : `${nombre}: todavía no`

/** Qué gana este cliente y por qué, en palabras. Todo sale de `reglas` y del panel: ningún monto ni número está escrito acá. */
export function detalleBeneficio(p: PanelReferidos, reglas: ReglasReferidos = REGLAS_REFERIDOS): LineaBeneficio[] {
  const b = p.beneficios
  const escalera = [...reglas.escalera].sort((x, y) => x.cierres - y.cierres)
  const paso = b.nivel > 0 ? escalera[b.nivel - 1] : undefined
  const sig = b.proximoIntento
  const intentosTxt = `${b.intentos} ${b.intentos === 1 ? 'intento' : 'intentos'} (referidos que entraron a la llamada y no cerraron). ${textoEntregable('Página web', true, b.paginaWeb)}; ${textoEntregable('branding', false, b.branding)}. Próximo (intento ${sig.intento}): ${sig.etiqueta}.`
  const usdTxt = `Disponible ${usdTexto(b.usd.disponible)}; ganado ${usdTexto(b.usd.ganado)}; canjeado ${usdTexto(b.usd.usado)}${b.usd.vencido > 0 ? `; vencido ${usdTexto(b.usd.vencido)}` : ''}. Se canjea solo contra la renovación y se lleva aparte de los meses.`
  const g = reglas.grabacion
  const intentoDelMes = reglas.intentos.escalera.find(x => x.premio === 'mes_servicio')?.intento
  return [
    {
      clave: 'escalera', titulo: 'Escalera por cierres',
      texto: paso
        ? `Nivel ${b.nivel} de ${escalera.length}: ${paso.etiqueta}. ${b.cierresLiberados} ${b.cierresLiberados === 1 ? 'cierre liberado' : 'cierres liberados'}; el nivel alcanzado reemplaza al anterior.`
        : `Sin cierres liberados todavía. El primer cierre liberado da ${escalera[0].etiqueta.toLowerCase()}.`,
    },
    { clave: 'intentos', titulo: 'Escalera por intentos', texto: intentosTxt },
    { clave: 'usd', titulo: 'Saldo en USD', texto: usdTxt },
    {
      clave: 'grabacion', titulo: 'Grabación',
      texto: b.zona === 'buenos_aires'
        ? `Extra disponible para esta zona: grabación en las ${g.lugar} (a confirmar por el closer).`
        : `Zona sin determinar: si vive en la zona de Buenos Aires, el closer puede ofrecer la grabación en las ${g.lugar}.`,
    },
    {
      clave: 'extra', titulo: 'Extra del nivel',
      texto: b.extras.length > 0 ? b.extras.map(textoExtra).join(', ') : 'Sin extra en este nivel.',
    },
    {
      clave: 'tope', titulo: 'Tope',
      texto: reglas.topeMesesAcumulados === null
        ? `Sin tope: los meses de la escalera de cierres${intentoDelMes ? ` y el mes del intento ${intentoDelMes}` : ''} se suman sin límite.`
        : `Los meses de la escalera de cierres${intentoDelMes ? ` y el mes del intento ${intentoDelMes}` : ''} comparten un tope de ${mesesTexto(reglas.topeMesesAcumulados)} acumulados en total.`,
    },
    {
      clave: 'canje', titulo: 'Canje y vigencia',
      texto: `${reglas.canje.soloContraRenovacion ? 'Se canjea solo contra la renovación' : 'Se puede canjear'}${reglas.canje.enEfectivo ? '' : ', nunca en efectivo'}. Los meses liberados y vigentes se aplican automáticamente al confirmar una nueva renovación en el Despacho; los USD requieren un canje manual. Cada premio dura ${reglas.vigenciaMeses} meses desde que se gana.`,
    },
  ]
}
