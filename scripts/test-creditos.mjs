// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-creditos.mjs
// Lógica pura del programa de referidos (lib/clientes/creditos.ts + zona.ts + metas.ts + fechas.ts + reglas). Sin red ni reloj.
// Reglas finales del 7/10/2026 (docs/REGLAS-REFERIDOS.md): escalera por cierres (igual que el 6/10), escalera por INTENTOS (un referido que
// entra a la llamada y NO cierra), créditos en USD aparte de los meses, sin tope de meses (8/10), grabación como
// extra por zona. Las pruebas de MECÁNICA (liberación, vigencia, ciclo, escalera) usan `R0`: las mismas reglas con el programa arrancando en
// el año 2000, para poder usar fechas de 2025 y de septiembre de 2026; las del inicio del programa usan las reglas reales (arranca el 1/10/2026).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  nivelPorCierres, liberarPorFecha, calcularCreditos, vencimientoDeCredito, creditoVigente, proximosVencimientos, saldoCanjeable, puedeCanjear,
  planCanje, validarReferido, indiceContactos, calcularCreditosDeTodos, valorizarMeses, combinarMeses, premioDelIntento, premiosHastaElIntento,
  esPremioUnico, usdDeTexto, esCanjeDeExtra, cierresParaElTope, mesesRenovacionGratis, fechaDePresentacion, esAnteriorAlPrograma,
} from '../lib/clientes/creditos.ts'
import { zonaPorTelefono } from '../lib/clientes/zona.ts'
import { metaDelMes, kpiClientesNuevosPorReferido, esMesValido, mesDe, mesLargo, porcentajeTexto, rangoMetaTexto, objetivoApoyoTexto } from '../lib/clientes/metas.ts'
import { REGLAS_REFERIDOS } from '../lib/clientes/reglasReferidos.ts'
import { sumarDias, sumarMeses, diasEntre, esYmdValido, serialAYmd, fechaDeCelda, hoyArgentina } from '../lib/clientes/fechas.ts'

// ── fábricas ──
const REF = (o = {}) => ({
  id: 'R001', fila: 2, fechaPedido: null, momento: '', idReferidor: 'A001', nombre: 'Lead', telefono: '', mail: '', estudio: '',
  estado: 'Cerró', fechaLlamada: '2026-09-01', idClienteNuevo: '', fechaPrimerPago: '2026-09-10', fechaLiberacion: null,
  reembolso: false, notas: '', cargadoPor: '', ...o,
})
// n cierres ya liberados a la fecha HOY (primer pago el 2026-09-10 → liberados desde el 2026-09-24)
const cierres = (n, o = {}) => Array.from({ length: n }, (_, i) => REF({ id: `R${String(i + 1).padStart(3, '0')}`, ...o }))
// n INTENTOS: referidos que entraron a la llamada y NO cerraron ("No cerró"), con fechas de llamada distintas y consecutivas desde el 1/8/2026
const intentos = (n, o = {}) => Array.from({ length: n }, (_, i) => REF({ id: `S${String(i + 1).padStart(3, '0')}`, estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: sumarDias('2026-08-01', i), ...o }))
const HOY = '2026-10-06'
const R0 = { ...REGLAS_REFERIDOS, vigenteDesde: '2000-01-01' }
const calc = (referidos, extra = {}, reglas = R0) => calcularCreditos({ idCliente: 'A001', referidos, hoy: HOY, ...extra }, reglas)
const MOV = (o = {}) => ({ id: 'M001', fila: 2, fecha: '2026-09-30', idCliente: 'A001', tipo: 'canje', idReferido: '', meses: -4, extra: '', vence: null, renovacionAplicada: 'R2', nota: '', cargadoPor: '', ...o })

describe('configuración final del 7/10/2026', () => {
  const R = REGLAS_REFERIDOS
  test('versión, estado y arranque del programa en octubre de 2026', () => {
    assert.equal(R.version, 'final-2026-10-08'); assert.equal(R.estado, 'vigente'); assert.equal(R.vigenteDesde, '2026-10-01')
  })
  test('escalera por cierres (igual que antes): 1 cierre = 1 mes · 2 = 2 meses + identidad de marca · 3 = renovación gratis de 4 meses; sin tope de meses (8/10)', () => {
    assert.deepEqual(R.escalera.map(p => [p.cierres, p.mesesServicio, p.renovacionGratis, p.extra]), [
      [1, 1, false, null], [2, 2, false, 'identidad_marca_completa'], [3, 4, true, null],
    ])
    assert.equal(R.masAllaDeLaEscalera.mesesPorCierreExtra, 1); assert.equal(R.topeMesesAcumulados, null)   // Tomás quitó el tope de 8 meses (8/10/2026)
    assert.equal(mesesRenovacionGratis(R), 4); assert.equal(cierresParaElTope(R), null)
    assert.equal(cierresParaElTope({ ...R, topeMesesAcumulados: 8 }), 7)   // el mecanismo sigue: si se vuelve a fijar un tope de 8, se llega con 7 cierres
  })
  test('escalera por intentos: 1 = página web · 2 = USD 300 · 3 = branding · 4 = USD 300 · 5 = +1 mes · del 6.º en adelante USD 150 sin tope (tentativo)', () => {
    assert.equal(R.intentos.estado, 'No cerró')
    assert.deepEqual(R.intentos.escalera.map(p => [p.intento, p.premio, p.creditoUSD, p.mesesServicio]), [
      [1, 'pagina_web', 0, 0], [2, 'credito_usd', 300, 0], [3, 'branding', 0, 0], [4, 'credito_usd', 300, 0], [5, 'mes_servicio', 0, 1],
    ])
    assert.deepEqual(R.intentos.masAllaDeLaEscalera, { creditoUSD: 150, sinTope: true, tentativo: true })
    const et = n => R.intentos.escalera.find(p => p.intento === n).etiqueta
    assert.match(et(1), /Página web completa con los servicios específicos del abogado/); assert.match(et(1), /para siempre/); assert.match(et(1), /enseña a editarla/)
    assert.match(et(2), /USD 300/); assert.match(et(4), /USD 300/); assert.match(et(5), /1 mes de servicio/)
    for (const parte of ['historias', 'foto de perfil', 'logo', 'colorimetría', 'usos', 'banner', '1 carrusel explicativo']) assert.match(et(3), new RegExp(parte), parte)
    assert.equal(R.intentos.escalera.map(p => p.intento).join(), '1,2,3,4,5')
  })
  test('valores de referencia: mes de USD 650; renovación gratis de USD 2.600 en pago único y USD 3.800 en plan de pagos', () => {
    assert.equal(R.valorMesUSD, 650)
    assert.deepEqual(R.renovacionGratis, { valorPagoUnicoUSD: 2600, valorPlanDePagosUSD: 3800 })
    assert.equal(mesesRenovacionGratis(R) * R.valorMesUSD, R.renovacionGratis.valorPagoUnicoUSD)   // 4 × 650 = 2.600
  })
  test('beneficios del referido: USD 300 de descuento + 1 mes más, solo si se suma en la llamada (confirmado)', () => {
    assert.deepEqual(R.referido, { descuentoUSD: 300, soloEnLlamada: true, mesesServicioExtra: 1 })
  })
  test('grabación: extra con cámara profesional en las oficinas, solo zona de Buenos Aires, la ofrece el closer', () => {
    assert.deepEqual(R.grabacion, { camaraProfesional: true, lugar: 'oficinas de Buenos Aires', zona: 'buenos_aires', ofreceElCloser: true })
  })
  test('lo demás que ya estaba: máximo de nombres, liberación, vigencia, canje', () => {
    assert.equal(R.pedido.maxNombresPorPedido, 3); assert.equal(R.liberacion.diasSinReembolso, 14); assert.equal(R.vigenciaMeses, 12); assert.equal(R.vigenciaDesde, 'liberacion')
    assert.deepEqual(R.canje, { soloContraRenovacion: true, enEfectivo: false, venceSiNoRenueva: true })
  })
  test('lo obsoleto ya no existe: la regla de llamadas (1.ª = grabación, cada 5 = 1 mes), el descuento sin confirmar, el tope de 12 meses, el mes de USD 500', () => {
    assert.ok(!('llamadas' in R)); assert.ok(!('grabacionPorLlamada' in R)); assert.ok(!('eleccionNivel1PorDefecto' in R))
    assert.ok(!('descuentoAnteriorUSD' in R.referido) && R.referido.descuentoUSD !== null)
    assert.ok(R.escalera.every(p => !('alternativaGrabacion' in p) && !('valorNetoUSD' in p)))
    assert.ok(!('topeMesesAcumulados' in R.masAllaDeLaEscalera))
    assert.ok(R.topeMesesAcumulados !== 12 && R.valorMesUSD !== 500 && !R.escalera.some(p => p.mesesServicio === 8))
  })
  test('dudas abiertas: exactamente las 10 de la lista, en lenguaje claro y sin identificadores de código', () => {
    assert.deepEqual(R.dudasAbiertas.map(d => d.clave).sort(), [
      'cerro_en_llamada', 'contador_intentos', 'credito_150_sin_tope', 'credito_usd_en_libro', 'dias_liberacion', 'entregables', 'otro_estudio',
      'reembolso_posterior', 'vigencia_desde', 'zona_buenos_aires',
    ])
    assert.equal(R.dudasAbiertas.length, 10)
    // las que se resolvieron o se reemplazaron ya no están
    for (const vieja of ['descuento_referido', 'viaje_grabacion', 'contador_llamadas']) assert.ok(!R.dudasAbiertas.some(d => d.clave === vieja), vieja)
    for (const d of R.dudasAbiertas) {
      assert.doesNotMatch(d.texto, /[a-z]+_[a-z_]+|[a-z]+[A-Z][a-zA-Z]+|\bnull\b|\(\)/, `identificador de código en: ${d.clave}`)
      assert.ok(d.texto.length > 60)
    }
    const t = clave => R.dudasAbiertas.find(d => d.clave === clave).texto
    assert.match(t('dias_liberacion'), /14 días/); assert.match(t('vigencia_desde'), /12 meses/)
    assert.match(t('contador_intentos'), /vuelve a cero en cada ciclo/); assert.match(t('contador_intentos'), /página web y el branding/)
    assert.match(t('credito_150_sin_tope'), /USD 150/); assert.match(t('credito_150_sin_tope'), /tentativos/); assert.match(t('credito_150_sin_tope'), /sin tope/)
    assert.match(t('cerro_en_llamada'), /planilla de Referidos no tiene un dato/); assert.match(t('cerro_en_llamada'), /USD 300 de descuento/)
    assert.match(t('zona_buenos_aires'), /código de área 11/); assert.match(t('zona_buenos_aires'), /solo una pista/); assert.match(t('zona_buenos_aires'), /no es un no/)
    assert.match(t('credito_usd_en_libro'), /columna de USD/); assert.match(t('credito_usd_en_libro'), /Crédito USD \(\+\/-\)/); assert.match(t('credito_usd_en_libro'), /campo Extra/)
    assert.match(t('entregables'), /alcance fino/); assert.match(t('entregables'), /quién lo hace/); assert.match(t('entregables'), /plazo/)
    assert.ok(!R.dudasAbiertas.some(d => d.clave === 'tope_con_intento_5'))   // sin tope no hay duda sobre qué entra en él
    // lo resuelto no figura como duda
    const todo = R.dudasAbiertas.map(d => d.texto).join(' ')
    assert.doesNotMatch(todo, /1 grabación|cada 5 llamadas|1 mes cada 5|primera llamada|quién paga el traslado|sin confirmar que sea definitivo/i)
  })
  test('metas: hitos del KPI principal y 4 indicadores de apoyo, todos sin verificar', () => {
    assert.deepEqual(R.metas.kpiPrincipal.hitos, [
      { desde: '2026-10', minPct: 5, maxPct: 5 }, { desde: '2026-12', minPct: 10, maxPct: 10 }, { desde: '2027-03', minPct: 15, maxPct: 20 },
    ])
    assert.deepEqual(R.metas.apoyo.map(i => i.clave), ['pedido_hecho', 'presentan_a_alguien', 'cierre_de_referidos', 'costo_por_cierre'])
    assert.ok(R.metas.apoyo.every(i => i.verificado === false))
  })
})

describe('valorización (solo reportes)', () => {
  test('sin renovación gratis: meses × USD 650 en las dos formas de pago', () => {
    assert.deepEqual(valorizarMeses(0, false), { pagoUnicoUSD: 0, planDePagosUSD: 0 })
    assert.deepEqual(valorizarMeses(2, false), { pagoUnicoUSD: 1300, planDePagosUSD: 1300 })
  })
  test('renovación gratis: USD 2.600 en pago único y USD 3.800 en plan de pagos; los meses de más, a USD 650', () => {
    assert.deepEqual(valorizarMeses(4, true), { pagoUnicoUSD: 2600, planDePagosUSD: 3800 })
    assert.deepEqual(valorizarMeses(8, true), { pagoUnicoUSD: 2600 + 4 * 650, planDePagosUSD: 3800 + 4 * 650 })
  })
  test('entradas inválidas', () => {
    for (const malo of [-1, NaN, '4', null, Infinity]) assert.throws(() => valorizarMeses(malo, false), RangeError)
  })
})

describe('escalera por cierres (nivelPorCierres)', () => {
  test('0 cierres: nada, y falta 1 para el primer escalón', () => {
    const n = nivelPorCierres(0)
    assert.equal(n.nivel, 0); assert.equal(n.mesesServicio, 0); assert.equal(n.renovacionGratis, false)
    assert.equal(n.proximoNivel.cierresFaltantes, 1); assert.equal(n.valorUSD, 0)
  })
  test('1 cierre: +1 mes de servicio (ya no hay elección de una grabación en su lugar)', () => {
    const n = nivelPorCierres(1)
    assert.equal(n.nivel, 1); assert.equal(n.mesesServicio, 1); assert.equal(n.renovacionGratis, false)
    assert.equal(n.valorUSD, 650); assert.equal(n.proximoNivel.cierresFaltantes, 1)
    assert.equal(nivelPorCierres(1, { eleccionNivel1: 'grabacion' }).mesesServicio, 1)   // la opción vieja se ignora
  })
  test('2 cierres: REEMPLAZA al nivel 1 (2 meses, no 3) y trae la identidad de marca completa', () => {
    const n = nivelPorCierres(2)
    assert.equal(n.nivel, 2); assert.equal(n.mesesServicio, 2); assert.deepEqual(n.extras, ['identidad_marca_completa'])
    assert.equal(n.renovacionGratis, false); assert.equal(n.valorUSD, 1300)
  })
  test('3 cierres: renovación gratis de 4 meses (USD 2.600 / 3.800), reemplaza todo lo anterior, incluido el extra', () => {
    const n = nivelPorCierres(3)
    assert.equal(n.nivel, 3); assert.equal(n.mesesServicio, 4); assert.equal(n.renovacionGratis, true)
    assert.equal(n.valorUSD, 2600); assert.equal(n.valorPlanDePagosUSD, 3800); assert.deepEqual(n.extras, []); assert.equal(n.mesesExtraSobreRenovacion, 0)
    assert.equal(n.proximoNivel.cierresFaltantes, 1)
  })
  test('4, 5 y 6 cierres: +1 mes por cada cierre extra sobre la renovación', () => {
    const n4 = nivelPorCierres(4), n5 = nivelPorCierres(5), n6 = nivelPorCierres(6)
    assert.equal(n4.mesesServicio, 5); assert.equal(n4.mesesExtraSobreRenovacion, 1); assert.equal(n4.renovacionGratis, true)
    assert.equal(n4.valorUSD, 2600 + 650); assert.equal(n4.valorPlanDePagosUSD, 3800 + 650)
    assert.equal(n5.mesesServicio, 6); assert.equal(n5.mesesExtraSobreRenovacion, 2); assert.equal(n5.topeAlcanzado, false)
    assert.equal(n6.mesesServicio, 7); assert.equal(n6.topeAlcanzado, false); assert.equal(n6.proximoNivel.cierresFaltantes, 1)
  })
  test('SIN tope: 7, 8 y 15 cierres siguen sumando +1 mes por cierre (4 de la renovación + los extra)', () => {
    const n7 = nivelPorCierres(7)
    assert.equal(n7.mesesServicio, 8); assert.equal(n7.mesesExtraSobreRenovacion, 4); assert.equal(n7.topeAlcanzado, false)
    assert.equal(n7.cierresAportantes, 7); assert.equal(n7.cierresSobreTope, 0); assert.equal(n7.proximoNivel.cierresFaltantes, 1)
    const n8 = nivelPorCierres(8)
    assert.equal(n8.mesesServicio, 9); assert.equal(n8.cierresSobreTope, 0); assert.equal(n8.mesesSinTope, 9); assert.equal(n8.cierresAportantes, 8)
    const n15 = nivelPorCierres(15)
    assert.equal(n15.mesesServicio, 16); assert.equal(n15.topeAlcanzado, false); assert.equal(n15.cierresAportantes, 15); assert.equal(n15.cierresSobreTope, 0)
    assert.equal(n15.valorUSD, 2600 + 12 * 650); assert.equal(n15.valorPlanDePagosUSD, 3800 + 12 * 650); assert.equal(n15.renovacionGratis, true)
  })
  test('con un tope de 8 CONFIGURADO a mano el mecanismo sigue funcionando (7 cierres justo; del 8.º en adelante no suma)', () => {
    const reglas = { ...REGLAS_REFERIDOS, topeMesesAcumulados: 8 }
    const n7 = nivelPorCierres(7, { reglas }); assert.equal(n7.mesesServicio, 8); assert.equal(n7.topeAlcanzado, true); assert.equal(n7.proximoNivel, null)
    const n15 = nivelPorCierres(15, { reglas }); assert.equal(n15.mesesServicio, 8); assert.equal(n15.cierresAportantes, 7); assert.equal(n15.cierresSobreTope, 8)
  })
  test('0 a 15 cierres: la escalera completa, número por número', () => {
    const esperado = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    esperado.forEach((meses, c) => {
      const n = nivelPorCierres(c)
      assert.equal(n.mesesServicio, meses, `${c} cierres`); assert.equal(n.nivel, Math.min(c, 3)); assert.equal(n.renovacionGratis, c >= 3)
    })
  })
  test('el tope sale de la configuración (no está fijo en el código)', () => {
    const reglas = { ...REGLAS_REFERIDOS, topeMesesAcumulados: 6 }
    assert.equal(nivelPorCierres(13, { reglas }).mesesServicio, 6)
    assert.equal(nivelPorCierres(5, { reglas }).topeAlcanzado, true)
    assert.equal(cierresParaElTope(reglas), 5)
  })
  test('entradas inválidas: negativo, decimal, NaN, texto, null, infinito', () => {
    for (const malo of [-1, 1.5, NaN, '3', null, undefined, Infinity]) assert.throws(() => nivelPorCierres(malo), RangeError, `cierres=${String(malo)}`)
  })
})

describe('escalera por intentos, créditos en USD y tope común', () => {
  test('qué da cada intento: 1 web · 2 USD 300 · 3 branding · 4 USD 300 · 5 +1 mes · 6 en adelante USD 150', () => {
    const forma = n => { const p = premioDelIntento(n); return [p.intento, p.premio, p.creditoUSD, p.mesesServicio] }
    assert.deepEqual(forma(1), [1, 'pagina_web', 0, 0]); assert.deepEqual(forma(2), [2, 'credito_usd', 300, 0]); assert.deepEqual(forma(3), [3, 'branding', 0, 0])
    assert.deepEqual(forma(4), [4, 'credito_usd', 300, 0]); assert.deepEqual(forma(5), [5, 'mes_servicio', 0, 1])
    for (const n of [6, 7, 12, 100]) assert.deepEqual(forma(n), [n, 'credito_usd', 150, 0], `intento ${n}`)
    assert.match(premioDelIntento(6).etiqueta, /USD 150 de crédito por cada intento adicional, sin tope/)
  })
  test('intento inválido: 0, negativo, decimal, NaN, texto, null', () => {
    for (const malo of [0, -1, 1.5, NaN, '2', null, undefined, Infinity]) assert.throws(() => premioDelIntento(malo), RangeError, String(malo))
    for (const malo of [-1, 1.5, NaN, '2', null]) assert.throws(() => premiosHastaElIntento(malo), RangeError, String(malo))
  })
  test('los premios hasta el intento N: la web y el branding aparecen una sola vez; los USD suman 300 + 300 + 150 por cada intento desde el 6.º', () => {
    assert.deepEqual(premiosHastaElIntento(0), [])
    for (let n = 0; n <= 14; n++) {
      const lista = premiosHastaElIntento(n)
      assert.equal(lista.length, n)
      assert.equal(lista.filter(p => p.premio === 'pagina_web').length, n >= 1 ? 1 : 0, `${n}: web`)
      assert.equal(lista.filter(p => p.premio === 'branding').length, n >= 3 ? 1 : 0, `${n}: branding`)
      assert.equal(lista.filter(p => p.premio === 'mes_servicio').length, n >= 5 ? 1 : 0, `${n}: mes`)
      assert.equal(lista.reduce((s, p) => s + p.creditoUSD, 0), (n >= 2 ? 300 : 0) + (n >= 4 ? 300 : 0) + Math.max(0, n - 5) * 150, `${n}: USD`)
    }
  })
  test('premios únicos por cliente: página web y branding; los créditos y el mes no lo son', () => {
    assert.deepEqual(['pagina_web', 'branding', 'credito_usd', 'mes_servicio'].map(esPremioUnico), [true, true, false, false])
  })
  test('el tope y los premios salen de la configuración (no están fijos en el código)', () => {
    const reglas = { ...R0, intentos: { ...R0.intentos, masAllaDeLaEscalera: { creditoUSD: 200, sinTope: true, tentativo: true } } }
    assert.equal(premioDelIntento(6, reglas).creditoUSD, 200)
    assert.equal(calc(intentos(7), {}, reglas).usd.ganado, 600 + 400)   // 300 + 300 + 200 × 2
  })

  describe('lectura de los USD canjeados desde el texto del campo Extra', () => {
    test('formas habituales: "USD 300", "usd300", "U$S 300", "US$ 300", "300 USD", "300 dólares"', () => {
      for (const t of ['USD 300', 'usd 300', 'USD300', 'U$S 300', 'u$s300', 'US$ 300', '300 USD', '300 usd', '300 dólares', '300 dolares', 'canje de USD 300 contra R2'])
        assert.deepEqual(usdDeTexto(t), { usd: 300, varios: false }, t)
    })
    test('junto con otro texto: "renovación gratis + USD 450"', () => {
      assert.deepEqual(usdDeTexto('renovación gratis + USD 450'), { usd: 450, varios: false })
      assert.deepEqual(usdDeTexto('USD 150 (intento 6)'), { usd: 150, varios: false })
    })
    test('formato argentino: miles con punto y decimales con coma', () => {
      assert.equal(usdDeTexto('USD 1.200').usd, 1200); assert.equal(usdDeTexto('USD 1.200,50').usd, 1200.5)
      assert.equal(usdDeTexto('USD 1.200.000').usd, 1200000); assert.equal(usdDeTexto('USD 150,5').usd, 150.5)
      assert.equal(usdDeTexto('USD 12345').usd, 12345); assert.equal(usdDeTexto('USD 300.').usd, 300)
    })
    test('con más de un monto toma el primero y lo marca', () => {
      assert.deepEqual(usdDeTexto('USD 300 y USD 150'), { usd: 300, varios: true })
      assert.deepEqual(usdDeTexto('USD 450 (300 USD + 150 USD)'), { usd: 450, varios: true })
    })
    test('sin monto en USD: null (no inventa)', () => {
      for (const t of ['', 'grabación', 'renovación gratis', 'USD', 'USD sin monto', 'USD 0', '300', '300 pesos', 'USDT 300', 'musd 300', 'una renovación de 4 meses', null, undefined, 300, {}, []])
        assert.equal(usdDeTexto(t), null, String(JSON.stringify(t)))
    })
  })

  test('sin tope: escalera + mes del intento 5 se SUMAN sin límite', () => {
    assert.deepEqual(combinarMeses(4, 1), { meses: 5, sinTope: 5, sobreTope: 0, topeAlcanzado: false })
    assert.deepEqual(combinarMeses(7, 1), { meses: 8, sinTope: 8, sobreTope: 0, topeAlcanzado: false })
    assert.deepEqual(combinarMeses(8, 1), { meses: 9, sinTope: 9, sobreTope: 0, topeAlcanzado: false })
    assert.deepEqual(combinarMeses(0, 1), { meses: 1, sinTope: 1, sobreTope: 0, topeAlcanzado: false })
    for (const malo of [[-1, 0], [1, 1.5], [NaN, 1], ['2', 1]]) assert.throws(() => combinarMeses(...malo), RangeError)
  })
  test('con un tope de 8 configurado a mano, combinarMeses lo aplica', () => {
    const reglas = { ...REGLAS_REFERIDOS, topeMesesAcumulados: 8 }
    assert.deepEqual(combinarMeses(7, 1, reglas), { meses: 8, sinTope: 8, sobreTope: 0, topeAlcanzado: true })
    assert.deepEqual(combinarMeses(8, 1, reglas), { meses: 8, sinTope: 9, sobreTope: 1, topeAlcanzado: true })
  })
})

describe('liberación por fecha (liberarPorFecha)', () => {
  const pago = '2026-09-10'   // el 10/9 entra el primer pago
  const lib = (hoy, o = {}) => liberarPorFecha({ estado: 'Cerró', fechaPrimerPago: pago, reembolso: false, ...o }, hoy)
  test('día 13: todavía no se libera (falta 1 día)', () => {
    const l = lib('2026-09-23')
    assert.equal(l.liberado, false); assert.equal(l.motivo, 'esperando_dias'); assert.equal(l.diasParaLiberar, 1); assert.equal(l.fechaLiberacion, '2026-09-24')
  })
  test('día 14: se libera', () => {
    const l = lib('2026-09-24')
    assert.equal(l.liberado, true); assert.equal(l.motivo, 'liberado'); assert.equal(l.diasParaLiberar, 0)
  })
  test('día 15: sigue liberado', () => {
    assert.equal(lib('2026-09-25').liberado, true)
  })
  test('con reembolso no se libera nunca, ni el día 13, ni el 14, ni el 15, ni meses después', () => {
    for (const hoy of ['2026-09-23', '2026-09-24', '2026-09-25', '2027-03-01']) {
      const l = lib(hoy, { reembolso: true })
      assert.equal(l.liberado, false, hoy); assert.equal(l.motivo, 'reembolsado')
    }
  })
  test('sin primer pago, sin cierre y fecha inválida', () => {
    assert.equal(lib('2026-10-01', { fechaPrimerPago: null }).motivo, 'sin_primer_pago')
    assert.equal(lib('2026-10-01', { estado: 'Asistió' }).motivo, 'no_cerro')
    assert.equal(lib('2026-10-01', { fechaPrimerPago: '2026-13-45' }).motivo, 'fecha_invalida')
    assert.equal(lib('2026-10-01', { fechaPrimerPago: '10/9/2026' }).liberado, false)
  })
  test('cruza fin de mes y de año', () => {
    const l = liberarPorFecha({ estado: 'Cerró', fechaPrimerPago: '2026-12-25', reembolso: false }, '2027-01-08')
    assert.equal(l.liberado, true); assert.equal(l.fechaLiberacion, '2027-01-08')
  })
  test('la configuración manda: con 7 días se libera antes', () => {
    const reglas = { ...REGLAS_REFERIDOS, liberacion: { diasSinReembolso: 7 } }
    assert.equal(liberarPorFecha({ estado: 'Cerró', fechaPrimerPago: pago, reembolso: false }, '2026-09-17', reglas).liberado, true)
  })
  test('hoy inválido es un error de quien llama', () => {
    for (const malo of ['', '2026-9-1', '1/10/2026', null, 20261001]) assert.throws(() => lib(malo), TypeError)
  })
})

describe('vigencia de 12 meses', () => {
  test('vence 12 meses después de la liberación, inclusive', () => {
    const vence = vencimientoDeCredito('2026-01-15')
    assert.equal(vence, '2027-01-15')
    assert.equal(creditoVigente(vence, '2027-01-15'), true)    // el último día todavía vale
    assert.equal(creditoVigente(vence, '2027-01-16'), false)
  })
  test('29 de febrero: pasa al 28', () => {
    assert.equal(vencimientoDeCredito('2028-02-29'), '2029-02-28')
  })
  test('un cierre liberado hace más de 12 meses ya no suma', () => {
    // primer pago 2025-09-01 → liberado 2025-09-15 → vence 2026-09-15
    const r = [REF({ fechaPrimerPago: '2025-09-01', fechaLlamada: '2025-08-20' })]
    const vencido = calcularCreditos({ idCliente: 'A001', referidos: r, hoy: '2026-09-16' }, R0)
    assert.equal(vencido.cierresLiberados, 0); assert.equal(vencido.cierresVencidos, 1); assert.equal(vencido.mesesGanados, 0)
    assert.equal(vencido.nivel, 0)
    assert.equal(vencido.intentos, 0)   // un cierre no es un intento: no gana premios por intentos
    const ultimoDia = calcularCreditos({ idCliente: 'A001', referidos: r, hoy: '2026-09-15' }, R0)
    assert.equal(ultimoDia.cierresLiberados, 1); assert.equal(ultimoDia.mesesGanados, 1)
    assert.deepEqual(ultimoDia.vencimientos, [{ fecha: '2026-09-15', cierres: 1, mesesIntentos: 0, usd: 0, entregables: 0 }])
  })
  test('al vencer el primero, el nivel baja: la escalera se mide con lo vigente', () => {
    const r = [
      REF({ id: 'R1', fechaPrimerPago: '2025-09-01' }),   // vence 2026-09-15
      REF({ id: 'R2', fechaPrimerPago: '2026-02-01' }),
      REF({ id: 'R3', fechaPrimerPago: '2026-03-01' }),
    ]
    assert.equal(calcularCreditos({ idCliente: 'A001', referidos: r, hoy: '2026-09-10' }, R0).renovacionGratis, true)
    const despues = calcularCreditos({ idCliente: 'A001', referidos: r, hoy: '2026-09-20' }, R0)
    assert.equal(despues.renovacionGratis, false); assert.equal(despues.mesesGanados, 2); assert.equal(despues.cierresVencidos, 1)
  })
  test('próximos vencimientos dentro de una ventana', () => {
    const r = calcularCreditos({ idCliente: 'A001', referidos: [REF({ fechaPrimerPago: '2025-10-20' })], hoy: HOY }, R0)   // vence 2026-11-03
    assert.equal(r.cierresLiberados, 1)
    assert.deepEqual(proximosVencimientos(r, 30).map(v => [v.fecha, v.dias]), [['2026-11-03', 28]])
    assert.deepEqual(proximosVencimientos(r, 10), [])
    assert.throws(() => proximosVencimientos(r, -5), RangeError)
  })
  test('los premios por intentos también vencen a los 12 meses de ganados, cada uno desde la llamada de su intento', () => {
    // 5 intentos en octubre de 2025: web (1/10), USD 300 (5/10), branding (10/10), USD 300 (15/10) y el mes (20/10) → vencen el mismo día de 2026
    const refs = ['2025-10-01', '2025-10-05', '2025-10-10', '2025-10-15', '2025-10-20'].map((f, i) => REF({ id: `S${i}`, estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: f }))
    const a = hoy => calcularCreditos({ idCliente: 'A001', referidos: refs, hoy }, R0)
    const v = a('2026-10-06')
    assert.equal(v.intentos, 5)
    assert.equal(v.paginaWeb.vigente, false); assert.equal(v.paginaWeb.vence, '2026-10-01')           // la web (1/10/2025) ya venció
    assert.deepEqual(v.premiosIntentos.map(p => p.estado), ['vencido', 'vencido', 'vigente', 'vigente', 'vigente'])
    assert.equal(v.branding.vigente, true)
    assert.deepEqual(v.usd, { ganado: 600, usado: 0, vencido: 300, disponible: 300 })   // el USD 300 del 5/10 venció el 5/10/2026; el del 15/10 sigue
    assert.equal(v.mesesPorIntentos, 1); assert.equal(v.mesesGanados, 1)
    assert.deepEqual(v.vencimientos, [
      { fecha: '2026-10-10', cierres: 0, mesesIntentos: 0, usd: 0, entregables: 1 },
      { fecha: '2026-10-15', cierres: 0, mesesIntentos: 0, usd: 300, entregables: 0 },
      { fecha: '2026-10-20', cierres: 0, mesesIntentos: 1, usd: 0, entregables: 0 },
    ])
    assert.deepEqual(proximosVencimientos(v, 30).map(x => [x.fecha, x.mesesIntentos, x.usd, x.entregables, x.dias]), [['2026-10-10', 0, 0, 1, 4], ['2026-10-15', 0, 300, 0, 9], ['2026-10-20', 1, 0, 0, 14]])
    // último día de cada premio (inclusive) y el día siguiente
    assert.equal(a('2026-10-01').paginaWeb.vigente, true); assert.equal(a('2026-10-02').paginaWeb.vigente, false)
    assert.equal(a('2026-10-05').usd.disponible, 600); assert.equal(a('2026-10-06').usd.disponible, 300)
    assert.equal(a('2026-10-15').usd.disponible, 300); assert.equal(a('2026-10-16').usd.disponible, 0)
    assert.equal(a('2026-10-20').mesesPorIntentos, 1)
    const vencido = a('2026-10-21')
    assert.equal(vencido.mesesPorIntentos, 0); assert.equal(vencido.mesesGanados, 0); assert.deepEqual(vencido.usd, { ganado: 600, usado: 0, vencido: 600, disponible: 0 })
    assert.equal(vencido.branding.vigente, false); assert.equal(vencido.intentos, 5)   // lo que vence es el premio, no el intento: el contador sigue de largo
    assert.deepEqual(vencido.vencimientos, [])
  })
})

describe('calcularCreditos con historial de referidos', () => {
  test('sin referidos: todo en cero y el próximo intento da la página web', () => {
    const r = calc([])
    assert.equal(r.nivel, 0); assert.equal(r.mesesGanados, 0); assert.equal(r.renovacionGratis, false); assert.equal(r.reglasVersion, 'final-2026-10-08')
    assert.equal(r.intentos, 0); assert.deepEqual(r.premiosIntentos, []); assert.equal(r.paginaWeb, null); assert.equal(r.branding, null)
    assert.deepEqual(r.usd, { ganado: 0, usado: 0, vencido: 0, disponible: 0 }); assert.equal(r.mesesPorIntentos, 0)
    assert.equal(r.proximoIntento.intento, 1); assert.equal(r.proximoIntento.premio, 'pagina_web'); assert.equal(r.topeMeses, null); assert.equal(r.valorUSD, 0)
    assert.equal(r.zona, 'sin_determinar'); assert.deepEqual(r.vencimientos, []); assert.deepEqual(r.advertencias, [])
  })
  // Los cierres NO son intentos: n cierres liberados dan la escalera de cierres y 0 intentos
  for (const [n, meses, gratis] of [[1, 1, false], [2, 2, false], [3, 4, true], [4, 5, true], [5, 6, true], [6, 7, true], [7, 8, true], [8, 9, true], [13, 14, true]]) {
    test(`${n} cierre(s) liberados → ${meses} meses${gratis ? ', renovación gratis' : ''}, y ningún intento`, () => {
      const r = calc(cierres(n))
      assert.equal(r.cierresLiberados, n); assert.equal(r.mesesGanados, meses); assert.equal(r.renovacionGratis, gratis)
      assert.equal(r.intentos, 0); assert.equal(r.mesesPorIntentos, 0); assert.equal(r.paginaWeb, null)
      assert.equal(r.valorUSD, valorizarMeses(meses, gratis).pagoUnicoUSD)
    })
  }
  test('13 cierres: sin tope, los 14 meses suman y la escalera sigue abierta', () => {
    const r = calc(cierres(13))
    assert.equal(r.topeAlcanzado, false); assert.equal(r.mesesPorCierres, 14); assert.equal(r.mesesSobreTope, 0); assert.equal(r.mesesGanados, 14)
    assert.equal(r.proximoNivel.cierresFaltantes, 1)
  })

  // Oráculo INDEPENDIENTE (tablas escritas a mano, sin usar ninguna función del código): premios de cada intento y escalera de cierres.
  const oraculo = (c, n) => {
    const mesesCierres = [0, 1, 2, 4, 5, 6, 7, 8, 9][c]                  // c = 0 a 8
    const mesIntento = n >= 5 ? 1 : 0
    const total = mesesCierres + mesIntento
    return {
      mesesCierres, mesIntento, meses: total, sobreTope: 0, tope: false,   // sin tope de meses (8/10/2026)
      web: n >= 1, branding: n >= 3,
      usd: (n >= 2 ? 300 : 0) + (n >= 4 ? 300 : 0) + (n >= 6 ? 150 * (n - 5) : 0),
      nivel: Math.min(c, 3), gratis: c >= 3, extras: c === 2 ? ['identidad_marca_completa'] : [],
      premios: ['pagina_web', 'credito_usd', 'branding', 'credito_usd', 'mes_servicio'].slice(0, n).concat(Array(Math.max(0, n - 5)).fill('credito_usd')),
    }
  }
  test('0 a 12 intentos combinados con 0 a 8 cierres: coincide con el cálculo hecho aparte (117 combinaciones)', () => {
    let casos = 0
    for (let c = 0; c <= 8; c++) {
      for (let n = 0; n <= 12; n++) {
        const o = oraculo(c, n), cual = `${c} cierres, ${n} intentos`
        const r = calc([...cierres(c), ...intentos(n)])
        assert.equal(r.cierresLiberados, c, cual); assert.equal(r.intentos, n, cual)
        assert.equal(r.mesesPorCierres, o.mesesCierres, cual); assert.equal(r.mesesPorIntentos, o.mesIntento, cual)
        assert.equal(r.mesesGanados, o.meses, cual); assert.equal(r.mesesSobreTope, o.sobreTope, cual); assert.equal(r.topeAlcanzado, o.tope, cual)
        assert.equal(r.nivel, o.nivel, cual); assert.equal(r.renovacionGratis, o.gratis, cual); assert.deepEqual(r.extras, o.extras, cual)
        assert.equal(r.mesesExtraSobreRenovacion, o.gratis ? o.meses - 4 : 0, cual)
        assert.equal(!!r.paginaWeb, o.web, cual); assert.equal(!!r.branding, o.branding, cual)
        assert.equal(r.usd.ganado, o.usd, cual); assert.equal(r.usd.disponible, o.usd, cual); assert.equal(r.usd.usado, 0, cual); assert.equal(r.usd.vencido, 0, cual)
        assert.deepEqual(r.premiosIntentos.map(p => p.premio), o.premios, cual)
        assert.deepEqual(r.premiosIntentos.map(p => p.intento), Array.from({ length: n }, (_, i) => i + 1), cual)
        assert.ok(r.premiosIntentos.every(p => p.estado === 'vigente'), cual)
        assert.equal(r.proximoIntento.intento, n + 1, cual)
        assert.equal(r.valorUSD, o.gratis ? 2600 + (o.meses - 4) * 650 : o.meses * 650, cual)
        assert.equal(r.valorPlanDePagosUSD, o.gratis ? 3800 + (o.meses - 4) * 650 : o.meses * 650, cual)
        const s = saldoCanjeable(r, R0); assert.equal(s.meses, o.meses, cual); assert.equal(s.usd, o.usd, cual)
        casos++
      }
    }
    assert.equal(casos, 9 * 13)
  })
  test('la web y el branding se ganan UNA sola vez: con 12 intentos hay exactamente una de cada una', () => {
    const r = calc(intentos(12))
    assert.equal(r.premiosIntentos.filter(p => p.premio === 'pagina_web').length, 1); assert.equal(r.premiosIntentos.filter(p => p.premio === 'branding').length, 1)
    assert.equal(r.paginaWeb.fecha, '2026-08-01'); assert.equal(r.branding.fecha, '2026-08-03')   // la fecha del intento 1 y del intento 3
  })
  test('USD: 300 + 300 + 150 por cada intento desde el 6.º, sin tope', () => {
    const usd = n => calc(intentos(n)).usd.ganado
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 30, 100].map(usd), [0, 0, 300, 300, 600, 600, 750, 900, 1050, 1650, 4350, 14850])
    assert.equal(calc(intentos(100)).usd.disponible, 14850)
  })
  test('cada premio se gana en la fecha de la llamada de SU intento y vence 12 meses después', () => {
    const r = calc(intentos(6))
    assert.deepEqual(r.premiosIntentos.map(p => [p.intento, p.fecha, p.vence]), [
      [1, '2026-08-01', '2027-08-01'], [2, '2026-08-02', '2027-08-02'], [3, '2026-08-03', '2027-08-03'],
      [4, '2026-08-04', '2027-08-04'], [5, '2026-08-05', '2027-08-05'], [6, '2026-08-06', '2027-08-06'],
    ])
    assert.deepEqual(r.vencimientos.map(v => [v.fecha, v.usd, v.mesesIntentos, v.entregables]), [
      ['2027-08-01', 0, 0, 1], ['2027-08-02', 300, 0, 0], ['2027-08-03', 0, 0, 1], ['2027-08-04', 300, 0, 0], ['2027-08-05', 0, 1, 0], ['2027-08-06', 150, 0, 0],
    ])
  })
  test('el orden de los premios lo da la fecha de la llamada, no el orden de las filas', () => {
    const r = calc([REF({ id: 'B', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '2026-09-20' }), REF({ id: 'A', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '2026-09-01' })])
    assert.deepEqual(r.premiosIntentos.map(p => [p.intento, p.premio, p.fecha]), [[1, 'pagina_web', '2026-09-01'], [2, 'credito_usd', '2026-09-20']])
  })
  test('el mes del intento 5 se SUMA a los de la escalera de cierres, sin tope', () => {
    // 3 cierres = 4 meses (renovación gratis): con 4 intentos todavía no hay mes; con 5 se suma 1
    const a = calc([...cierres(3), ...intentos(4)]), b = calc([...cierres(3), ...intentos(5)])
    assert.equal(a.mesesGanados, 4); assert.equal(b.mesesPorCierres, 4); assert.equal(b.mesesPorIntentos, 1); assert.equal(b.mesesGanados, 5)
    assert.equal(b.renovacionGratis, true); assert.equal(b.mesesExtraSobreRenovacion, 1); assert.equal(b.valorUSD, 2600 + 650)
    // 6 cierres = 7 meses + 1 del intento 5 = 8, y 7 cierres = 8 + 1 = 9: nada se descarta
    const c6 = calc([...cierres(6), ...intentos(5)])
    assert.equal(c6.mesesGanados, 8); assert.equal(c6.topeAlcanzado, false); assert.equal(c6.mesesSobreTope, 0); assert.equal(c6.proximoNivel.cierresFaltantes, 1)
    const c7 = calc([...cierres(7), ...intentos(5)])
    assert.equal(c7.mesesGanados, 9); assert.equal(c7.mesesSobreTope, 0); assert.equal(c7.mesesPorCierres, 8); assert.equal(c7.mesesPorIntentos, 1)
    // con un tope de 8 configurado a mano, el mes del intento 5 comparte ese tope (sobra 1)
    const c7t = calc([...cierres(7), ...intentos(5)], {}, { ...R0, topeMesesAcumulados: 8 })
    assert.equal(c7t.mesesGanados, 8); assert.equal(c7t.mesesSobreTope, 1); assert.equal(c7t.topeAlcanzado, true); assert.equal(c7t.proximoNivel, null)
    // 5 cierres = 6 meses + 1 = 7
    const c5 = calc([...cierres(5), ...intentos(5)]); assert.equal(c5.mesesGanados, 7); assert.equal(c5.topeAlcanzado, false)
    // sin cierres, el mes del intento 5 suma solo: 1 mes, sin renovación gratis
    const solo = calc(intentos(5)); assert.equal(solo.mesesGanados, 1); assert.equal(solo.renovacionGratis, false); assert.equal(solo.nivel, 0)
  })
  test('solo "No cerró" es un intento: "Asistió" sin resultado todavía, "Cerró", "No asistió", "Presentado", "Descartado" y vacío NO cuentan', () => {
    for (const estado of ['Asistió', 'Cerró', 'No asistió', 'Presentado', 'Descartado', '']) {
      const r = calc([REF({ estado, fechaPrimerPago: null, fechaLlamada: '2026-09-02' })])
      assert.equal(r.intentos, 0, estado); assert.equal(r.paginaWeb, null, estado); assert.equal(r.usd.ganado, 0, estado)
    }
    // una llamada "Asistió" que luego pasa a "No cerró" sí cuenta, y a "Cerró" ya no
    assert.equal(calc([REF({ estado: 'No cerró', fechaPrimerPago: null })]).intentos, 1)
    assert.equal(calc([REF({ estado: 'Asistió', fechaPrimerPago: null })]).mesesGanados, 0)
  })
  test('un cierre no es un intento y un intento no es un cierre: se combinan sin pisarse', () => {
    const r = calc([REF({ id: 'R1' }), REF({ id: 'S1', estado: 'No cerró', fechaPrimerPago: null })])
    assert.equal(r.cierresLiberados, 1); assert.equal(r.intentos, 1); assert.equal(r.mesesPorCierres, 1); assert.equal(r.paginaWeb.fecha, '2026-09-01')
  })
  test('la fecha del intento es la de la llamada; si falta o es ilegible, la del pedido; si no hay ninguna, no cuenta y avisa', () => {
    const r = calc([
      REF({ id: 'A', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: null, fechaPedido: '2026-09-05' }),
      REF({ id: 'B', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '31/02/2026', fechaPedido: '2026-09-07' }),
      REF({ id: 'C', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '2026-09-03', fechaPedido: '2026-09-01' }),
    ])
    assert.equal(r.intentos, 3); assert.deepEqual(r.premiosIntentos.map(p => p.fecha), ['2026-09-03', '2026-09-05', '2026-09-07'])
    const sin = calc([REF({ id: 'X1', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: null, fechaPedido: null })])
    assert.equal(sin.intentos, 0); assert.match(sin.advertencias.join(' '), /X1: no cerró pero no tiene fecha de llamada ni de pedido/)
    assert.match(calc([REF({ estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: 'ayer', fechaPedido: null })]).advertencias.join(' '), /no se cuenta el intento/)
    // el primer pago NO es la fecha de un intento
    assert.equal(calc([REF({ estado: 'No cerró', fechaLlamada: null, fechaPedido: null, fechaPrimerPago: '2026-09-10' })]).intentos, 0)
  })
  test('cierres todavía no liberados quedan pendientes con su fecha (y no son intentos)', () => {
    const r = calc([
      REF({ id: 'R1', fechaPrimerPago: '2026-10-01' }),          // se libera el 15/10: faltan 9 días
      REF({ id: 'R2', fechaPrimerPago: null }),                   // cerró pero no pagó todavía
    ])
    assert.equal(r.cierresLiberados, 0); assert.equal(r.mesesGanados, 0); assert.equal(r.intentos, 0)
    assert.deepEqual(r.cierresPendientes.map(p => [p.idReferido, p.motivo, p.fechaLiberacion, p.diasParaLiberar]),
      [['R1', 'esperando_dias', '2026-10-15', 9], ['R2', 'sin_primer_pago', null, null]])
  })
  test('el cierre del día 13 todavía no suma y el del día 14 sí', () => {
    const refs = [REF({ fechaPrimerPago: '2026-09-23' })]   // se libera el 7/10
    const dia13 = calcularCreditos({ idCliente: 'A001', referidos: refs, hoy: '2026-10-06' }, R0)
    assert.equal(dia13.cierresLiberados, 0); assert.equal(dia13.cierresPendientes[0].diasParaLiberar, 1)
    assert.equal(calcularCreditos({ idCliente: 'A001', referidos: refs, hoy: '2026-10-07' }, R0).cierresLiberados, 1)
    assert.equal(calcularCreditos({ idCliente: 'A001', referidos: refs, hoy: '2026-10-08' }, R0).cierresLiberados, 1)
  })
  test('cierres con reembolso no suman y se cuentan aparte', () => {
    const r = calc([REF({ id: 'R1', reembolso: true }), REF({ id: 'R2' })])
    assert.equal(r.cierresReembolsados, 1); assert.equal(r.cierresLiberados, 1); assert.equal(r.mesesGanados, 1)
  })
  test('solo cuentan los referidos del cliente', () => {
    const r = calc([REF({ idReferidor: 'A001' }), REF({ id: 'R2', idReferidor: 'A002' }), REF({ id: 'R3', idReferidor: '' }), ...intentos(2, { idReferidor: 'A002' })])
    assert.equal(r.cierresLiberados, 1); assert.equal(r.intentos, 0)
  })
  test('referido no válido (predicado) no suma ni como cierre ni como intento, y deja advertencia', () => {
    const r = calc(cierres(3), { esValido: x => x.id !== 'R003' })
    assert.equal(r.cierresLiberados, 2); assert.equal(r.mesesGanados, 2); assert.match(r.advertencias[0], /R003/)
    const i = calc(intentos(3), { esValido: x => x.id !== 'S002' })
    assert.equal(i.intentos, 2); assert.match(i.advertencias[0], /S002/)
    assert.deepEqual(i.premiosIntentos.map(p => p.premio), ['pagina_web', 'credito_usd'])   // el 3.º fila pasa a ser el 2.º intento: USD 300
    assert.equal(i.usd.ganado, 300)
  })
  test('cierre no válido y sin "ID cliente nuevo": la advertencia da la pista (el referido ya figura como cliente en el CRM)', () => {
    const sin = calc([REF({ idClienteNuevo: '' })], { esValido: () => false })
    assert.equal(sin.mesesGanados, 0); assert.match(sin.advertencias[0], /ID cliente nuevo/)
    const con = calc([REF({ idClienteNuevo: 'A141' })], { esValido: () => false })
    assert.doesNotMatch(con.advertencias[0], /ID cliente nuevo/)   // si ya lo tiene cargado, la causa es otra
  })
  test('primer pago inválido: no se libera y avisa', () => {
    const r = calc([REF({ fechaPrimerPago: 'ayer' })])
    assert.equal(r.cierresLiberados, 0); assert.match(r.advertencias.join(' '), /primer pago es inválida/)
  })
  test('entradas inválidas', () => {
    assert.throws(() => calcularCreditos({ idCliente: '', referidos: [], hoy: HOY }), TypeError)
    assert.throws(() => calcularCreditos({ idCliente: 'A001', referidos: null, hoy: HOY }), TypeError)
    assert.throws(() => calcularCreditos({ idCliente: 'A001', referidos: [], hoy: '06/10/2026' }), TypeError)
    assert.throws(() => calcularCreditos(null), TypeError)
    assert.throws(() => calc([], { zona: 'cordoba' }), TypeError)
    assert.doesNotThrow(() => calc([null, undefined]))   // filas basura no rompen
  })
})

describe('créditos en USD: saldo, canjes del libro y premios únicos', () => {
  const canjeUSD = (fecha, extra, o = {}) => MOV({ fecha, meses: 0, extra, ...o })
  test('saldo en USD: ganado, usado (leído del campo Extra de los canjes), vencido y disponible', () => {
    const r = calc(intentos(4), { movimientos: [] })
    assert.deepEqual(r.usd, { ganado: 600, usado: 0, vencido: 0, disponible: 600 })
    assert.equal(saldoCanjeable(r, R0).usd, 600)
  })
  test('un canje en USD cierra el ciclo: lo ganado antes ya se consumió y se cuenta como usado', () => {
    // 4 intentos en agosto (USD 600) y un canje el 1/9 por USD 600 → disponible 0; el intento 5 de septiembre suma 1 mes
    const refs = [...intentos(4), REF({ id: 'S9', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '2026-09-15' })]
    const r = calc(refs, { movimientos: [canjeUSD('2026-09-01', 'USD 600')] })
    assert.equal(r.cicloDesde, '2026-09-01'); assert.deepEqual(r.usd, { ganado: 600, usado: 600, vencido: 0, disponible: 0 })
    assert.deepEqual(r.premiosIntentos.map(p => p.estado), ['vigente', 'canjeado', 'vigente', 'canjeado', 'vigente'])   // la web y el branding no se canjean
    assert.equal(r.mesesPorIntentos, 1)   // el 5.º intento (15/9) es posterior al canje
  })
  test('varios canjes en USD suman; un monto por canje; sin USD en el texto no descuenta nada', () => {
    const r = calc(intentos(6), { movimientos: [canjeUSD('2026-09-01', 'USD 300', { id: 'M1' }), canjeUSD('2026-09-10', 'renovación gratis + USD 150', { id: 'M2', meses: -4 }), canjeUSD('2026-09-20', 'renovación gratis', { id: 'M3', meses: -4 })] })
    assert.equal(r.usd.usado, 450)
  })
  test('con más de un monto en el texto toma el primero y avisa', () => {
    const r = calc(intentos(2), { movimientos: [canjeUSD('2026-09-01', 'USD 300 y USD 150', { id: 'MX' })] })
    assert.equal(r.usd.usado, 300); assert.match(r.advertencias.join(' '), /MX nombra más de un monto en USD en el campo Extra: se tomó el primero \(USD 300\)/)
  })
  test('solo los movimientos "canje" cuentan como USD usados: un ajuste o un ganado con "USD" en el texto no', () => {
    const r = calc(intentos(2), { movimientos: [MOV({ id: 'A1', tipo: 'ajuste', meses: 0, extra: 'USD 300', fecha: '2026-09-01' }), MOV({ id: 'A2', tipo: 'ganado_llamada', meses: 0, extra: 'USD 300', fecha: '2026-09-01' })] })
    assert.equal(r.usd.usado, 0); assert.equal(r.cicloDesde, null)
  })
  test('los canjes de otros clientes no cuentan', () => {
    assert.equal(calc(intentos(2), { movimientos: [canjeUSD('2026-09-01', 'USD 300', { idCliente: 'A002' })] }).usd.usado, 0)
  })
  test('el canje de un extra (grabación, página web, branding) no corta el ciclo ni descuenta meses ni USD', () => {
    for (const extra of ['grabación', 'Grabación con cámara', 'página web', 'Pagina web entregada', 'branding', 'Branding completo']) {
      assert.equal(esCanjeDeExtra(MOV({ extra })), true, extra)
      const r = calc(intentos(2), { movimientos: [MOV({ meses: 0, extra, renovacionAplicada: '' })] })
      assert.equal(r.cicloDesde, null, extra); assert.equal(r.usd.disponible, 300, extra)
    }
    assert.equal(esCanjeDeExtra(MOV({ extra: 'USD 300' })), false); assert.equal(esCanjeDeExtra(MOV({ extra: 'renovación gratis' })), false)
    assert.equal(esCanjeDeExtra(MOV({ tipo: 'ajuste', extra: 'página web' })), false)
  })
  test('el contador de intentos sigue de largo: el primer intento después de un canje es el 3.º (branding), no otra página web', () => {
    // 2 intentos antes del canje (marzo) y 2 después (agosto); canje el 1/6/2026
    const antes = intentos(2, { fechaLlamada: '2026-03-01' }).map((r, i) => ({ ...r, id: `A${i}`, fechaLlamada: sumarDias('2026-03-01', i) }))
    const despues = intentos(2, {}).map((r, i) => ({ ...r, id: `D${i}`, fechaLlamada: sumarDias('2026-08-01', i) }))
    const r = calc([...antes, ...despues], { movimientos: [canjeUSD('2026-06-01', 'USD 300')] })
    assert.equal(r.intentos, 4); assert.equal(r.cicloDesde, '2026-06-01')
    assert.deepEqual(r.premiosIntentos.map(p => [p.intento, p.premio, p.estado]), [[1, 'pagina_web', 'vigente'], [2, 'credito_usd', 'canjeado'], [3, 'branding', 'vigente'], [4, 'credito_usd', 'vigente']])
    assert.equal(r.premiosIntentos.filter(p => p.premio === 'pagina_web').length, 1)
    assert.deepEqual(r.usd, { ganado: 600, usado: 300, vencido: 0, disponible: 300 })
    assert.equal(r.proximoIntento.intento, 5)
  })
  test('la web y el branding NO se consumen en un canje contra la renovación', () => {
    const r = calc(intentos(3), { movimientos: [MOV({ fecha: '2026-09-30', meses: -1 })] })   // canje posterior a los tres intentos
    assert.equal(r.paginaWeb.vigente, true); assert.equal(r.branding.vigente, true)
    assert.deepEqual(r.premiosIntentos.map(p => p.estado), ['vigente', 'canjeado', 'vigente'])   // solo el crédito en USD se consumió
    assert.equal(r.usd.disponible, 0)
  })
  test('el USD vencido del ciclo actual se informa aparte del canjeado', () => {
    // intentos 1 y 2 el 1 y 2/9/2025: el USD 300 venció el 2/9/2026
    const refs = [REF({ id: 'S1', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '2025-09-01' }), REF({ id: 'S2', estado: 'No cerró', fechaPrimerPago: null, fechaLlamada: '2025-09-02' })]
    const r = calc(refs)
    assert.deepEqual(r.usd, { ganado: 300, usado: 0, vencido: 300, disponible: 0 }); assert.equal(r.paginaWeb.vigente, false)
  })
  test('el control cruzado con el libro compara el mes del intento 5 (ganado_llamada) con el cálculo', () => {
    const libro = n => [MOV({ id: 'M1', tipo: 'ganado_llamada', meses: n, fecha: '2026-08-05', renovacionAplicada: '' }), MOV({ id: 'M2', tipo: 'ganado_llamada', meses: 0, extra: 'página web', fecha: '2026-08-01', renovacionAplicada: '' })]
    assert.deepEqual(calc(intentos(5), { movimientos: libro(1) }).advertencias, [])
    assert.match(calc(intentos(5), { movimientos: libro(2) }).advertencias.join(' '), /ganados por intentos/)
  })
})

describe('zona de la grabación (extra solo para Buenos Aires)', () => {
  const BA = [
    '+54 9 11 5555-1234', '+54 11 5555-1234', '54 9 11 5555 1234', '54 11 5555 1234', '0054 9 11 5555 1234', '011 5555-1234', '(011) 5555-1234', '011 15 5555-1234',
    '(011) 15-5555-1234', '11 5555 1234', '1155551234', '11 15 5555 1234', '+5491155551234', '+54 011 5555 1234', '+54 0 11 15 5555 1234', '11.5555.1234',
    '  +54 9 11 5555-1234  ', '+54 9 11 5555-1234 (Mari)', '+54 9 351 555 1234 / +54 9 11 5555 1234', '11 5555 1234; 351 555 1234', '351 555 1234, 11 5555 1234',
    '+54 9 351 555 1234\n+54 9 11 5555 1234', 1155551234, 5491155551234, '+54 9 1155551234',
  ]
  const SIN_DETERMINAR = [
    '', '   ', null, undefined, 0, NaN, {}, [], true, 'sin teléfono', 'abc', '+54', '0054', '+',
    '+54 9 351 555 1234', '351 555 1234', '+54 9 221 555 1234', '+54 9 261 555 1234', '+54 9 341 555 1234',   // otro código de área: no es una pista de Buenos Aires
    '+598 99 123 456', '+55 11 91234-5678', '+34 11 5555 1234', '+1 (11) 5555-1234', '+57 300 123 4567',          // otro país, aunque traiga un 11
    '11 91234-5678', '11 5555 123', '11 5555 12345', '5555-1234', '1155551', '+54 9 11 5555', '54 11 5555 123', '+54 9 12 5555 1234', '12 15 5555 1234',   // incompletos o con otro prefijo
    '+54 9 11 5555-1234567',
  ]
  test('formas de escribir un número de Buenos Aires (código de área 11): todas dan "buenos_aires"', () => {
    for (const t of BA) assert.equal(zonaPorTelefono(t), 'buenos_aires', JSON.stringify(t))
  })
  test('lo que no se puede deducir da "sin_determinar" (no es un no) y nunca rompe', () => {
    for (const t of SIN_DETERMINAR) assert.equal(zonaPorTelefono(t), 'sin_determinar', JSON.stringify(t))
  })
  test('solo hay dos resultados posibles', () => {
    for (const t of [...BA, ...SIN_DETERMINAR]) assert.ok(['buenos_aires', 'sin_determinar'].includes(zonaPorTelefono(t)))
  })
  test('una nota entre paréntesis con letras se ignora, pero los paréntesis del código de área son parte del número', () => {
    assert.equal(zonaPorTelefono('(Mari) 11 5555 1234'), 'buenos_aires'); assert.equal(zonaPorTelefono('(011) 5555 1234'), 'buenos_aires')
    assert.equal(zonaPorTelefono('+598 99 123 456 (Juan 11 5555 1234)'), 'sin_determinar')   // los dígitos de una nota con letras no se toman como número
  })
  test('el resultado viaja en el resumen de créditos', () => {
    assert.equal(calc([], { zona: 'buenos_aires' }).zona, 'buenos_aires'); assert.equal(calc([]).zona, 'sin_determinar')
    assert.equal(calc([], { zona: zonaPorTelefono('+54 9 11 5555-1234') }).zona, 'buenos_aires')
  })
  test('calcularCreditosDeTodos le da a cada cliente su zona', () => {
    const m = calcularCreditosDeTodos({ referidos: [REF({ idReferidor: 'A001' }), REF({ id: 'R2', idReferidor: 'A002' })], movimientos: [], hoy: HOY, zonaDe: id => (id === 'A001' ? 'buenos_aires' : undefined) }, R0)
    assert.equal(m.get('A001').zona, 'buenos_aires'); assert.equal(m.get('A002').zona, 'sin_determinar')
  })
})

describe('inicio del programa: octubre de 2026', () => {
  const HOY_PROG = '2026-11-20'
  const real = (referidos, extra = {}) => calcularCreditos({ idCliente: 'A001', referidos, hoy: HOY_PROG, ...extra })   // reglas reales
  test('fecha de presentación: la del pedido; si falta, la de la llamada; si falta, la del primer pago; si no hay, ninguna', () => {
    assert.equal(fechaDePresentacion({ fechaPedido: '2026-10-02', fechaLlamada: '2026-09-01', fechaPrimerPago: '2026-09-10' }), '2026-10-02')
    assert.equal(fechaDePresentacion({ fechaPedido: null, fechaLlamada: '2026-10-05', fechaPrimerPago: '2026-09-10' }), '2026-10-05')
    assert.equal(fechaDePresentacion({ fechaPedido: null, fechaLlamada: null, fechaPrimerPago: '2026-10-10' }), '2026-10-10')
    assert.equal(fechaDePresentacion({ fechaPedido: null, fechaLlamada: null, fechaPrimerPago: null }), null)
    assert.equal(fechaDePresentacion({ fechaPedido: 'ayer', fechaLlamada: '2026-10-05', fechaPrimerPago: null }), '2026-10-05')   // una fecha ilegible se saltea
  })
  test('el 30/9 es anterior al programa; el 1/10 ya cuenta; sin fecha no se puede decir que sea anterior', () => {
    assert.equal(esAnteriorAlPrograma({ fechaPedido: '2026-09-30', fechaLlamada: null, fechaPrimerPago: null }), true)
    assert.equal(esAnteriorAlPrograma({ fechaPedido: '2026-10-01', fechaLlamada: null, fechaPrimerPago: null }), false)
    assert.equal(esAnteriorAlPrograma({ fechaPedido: null, fechaLlamada: null, fechaPrimerPago: null }), false)
    assert.equal(esAnteriorAlPrograma({ fechaPedido: '2026-09-30', fechaLlamada: null, fechaPrimerPago: null }, { ...REGLAS_REFERIDOS, vigenteDesde: '2026-09-30' }), false)   // la fecha sale de la configuración
  })
  test('un referido presentado antes de octubre NO genera cierre ni intento, aunque cierre y pague en octubre', () => {
    const r = real([REF({ fechaPedido: '2026-09-30', fechaLlamada: '2026-10-05', fechaPrimerPago: '2026-10-06' })])
    assert.equal(r.anterioresAlPrograma, 1); assert.equal(r.cierresLiberados, 0); assert.equal(r.cierresPendientes.length, 0)
    assert.equal(r.intentos, 0); assert.equal(r.mesesGanados, 0); assert.deepEqual(r.advertencias, [])
    // y un "No cerró" presentado en septiembre tampoco es un intento, aunque la llamada haya sido en octubre
    const i = real([REF({ estado: 'No cerró', fechaPedido: '2026-09-30', fechaLlamada: '2026-10-05', fechaPrimerPago: null })])
    assert.equal(i.anterioresAlPrograma, 1); assert.equal(i.intentos, 0); assert.equal(i.paginaWeb, null); assert.equal(i.usd.ganado, 0)
  })
  test('presentado el 1/10 (primer día del programa): cuenta completo', () => {
    const r = real([REF({ fechaPedido: '2026-10-01', fechaLlamada: '2026-10-05', fechaPrimerPago: '2026-10-06' })])   // liberado el 20/10
    assert.equal(r.anterioresAlPrograma, 0); assert.equal(r.cierresLiberados, 1); assert.equal(r.mesesGanados, 1)
    const i = real([REF({ estado: 'No cerró', fechaPedido: '2026-10-01', fechaLlamada: '2026-10-05', fechaPrimerPago: null })])
    assert.equal(i.intentos, 1); assert.equal(i.paginaWeb.fecha, '2026-10-05'); assert.equal(i.paginaWeb.vence, '2027-10-05')
  })
  test('sin fecha de pedido se usa la de la llamada', () => {
    assert.equal(real([REF({ fechaPedido: null, fechaLlamada: '2026-09-15', fechaPrimerPago: '2026-10-06' })]).anterioresAlPrograma, 1)
    assert.equal(real([REF({ fechaPedido: null, fechaLlamada: '2026-10-02', fechaPrimerPago: '2026-10-06' })]).cierresLiberados, 1)
    assert.equal(real([REF({ estado: 'No cerró', fechaPedido: null, fechaLlamada: '2026-09-15', fechaPrimerPago: null })]).intentos, 0)
    assert.equal(real([REF({ estado: 'No cerró', fechaPedido: null, fechaLlamada: '2026-10-02', fechaPrimerPago: null })]).intentos, 1)
  })
  test('mezcla: 3 de septiembre y 2 de octubre → solo suman los 2 de octubre (cierres e intentos)', () => {
    const viejos = cierres(3, { fechaPedido: '2026-09-01', fechaLlamada: '2026-09-05', fechaPrimerPago: '2026-09-10' })
    const nuevos = [REF({ id: 'N1', fechaPedido: '2026-10-02', fechaLlamada: '2026-10-03', fechaPrimerPago: '2026-10-04' }), REF({ id: 'N2', fechaPedido: '2026-10-02', fechaLlamada: '2026-10-03', fechaPrimerPago: '2026-10-04' })]
    const r = real([...viejos, ...nuevos])
    assert.equal(r.anterioresAlPrograma, 3); assert.equal(r.cierresLiberados, 2); assert.equal(r.nivel, 2); assert.equal(r.mesesGanados, 2); assert.equal(r.intentos, 0)
    const viejosI = intentos(4, { fechaPedido: '2026-09-01', fechaLlamada: '2026-09-05' }).map((x, k) => ({ ...x, id: `V${k}` }))
    const nuevosI = intentos(2, { fechaPedido: '2026-10-02', fechaLlamada: '2026-10-03' }).map((x, k) => ({ ...x, id: `N${k}` }))
    const m = real([...viejosI, ...nuevosI])
    assert.equal(m.anterioresAlPrograma, 4); assert.equal(m.intentos, 2); assert.deepEqual(m.premiosIntentos.map(p => p.premio), ['pagina_web', 'credito_usd'])   // el contador arranca en octubre
  })
  test('con las reglas reales y la fecha de hoy (6/10/2026) todavía no puede haber ningún crédito liberado por cierres (los intentos sí ganan de inmediato)', () => {
    const r = calcularCreditos({ idCliente: 'A001', referidos: [REF({ fechaPedido: '2026-10-01', fechaLlamada: '2026-10-01', fechaPrimerPago: '2026-10-01' })], hoy: '2026-10-06' })
    assert.equal(r.cierresLiberados, 0); assert.equal(r.cierresPendientes[0].fechaLiberacion, '2026-10-15')
    const i = calcularCreditos({ idCliente: 'A001', referidos: [REF({ estado: 'No cerró', fechaPedido: '2026-10-01', fechaLlamada: '2026-10-02', fechaPrimerPago: null })], hoy: '2026-10-06' })
    assert.equal(i.intentos, 1); assert.equal(i.paginaWeb.vigente, true)
  })
  test('un referido anterior al programa no genera advertencias aunque no sea válido', () => {
    const r = real([REF({ fechaPedido: '2026-08-01' }), REF({ id: 'S1', estado: 'No cerró', fechaPedido: '2026-08-01' })], { esValido: () => false })
    assert.deepEqual(r.advertencias, []); assert.equal(r.anterioresAlPrograma, 2)
  })
})


describe('ciclo, canje y libro de movimientos', () => {
  test('un canje contra la renovación consume lo anterior y empieza un ciclo nuevo', () => {
    const refs = [
      ...cierres(3, { fechaPrimerPago: '2026-06-01', fechaLlamada: '2026-05-20' }).map((r, i) => ({ ...r, id: `V${i}` })),     // liberados el 15/6
      REF({ id: 'N1', fechaPrimerPago: '2026-09-10' }),                                                                         // liberado el 24/9 (después del canje)
    ]
    const sinCanje = calc(refs); assert.equal(sinCanje.cierresLiberados, 4); assert.equal(sinCanje.mesesGanados, 5)
    const conCanje = calc(refs, { movimientos: [MOV({ fecha: '2026-07-01' })] })
    assert.equal(conCanje.cicloDesde, '2026-07-01'); assert.equal(conCanje.cierresLiberados, 1); assert.equal(conCanje.mesesGanados, 1)
    assert.equal(conCanje.renovacionGratis, false)
  })
  test('el canje de un extra (la grabación, la página web) no corta el ciclo', () => {
    const r = calc(cierres(1), { movimientos: [MOV({ id: 'M2', meses: 0, extra: 'grabación', renovacionAplicada: '' })] })
    assert.equal(r.cicloDesde, null); assert.equal(r.mesesGanados, 1)
  })
  test('ajustes manuales vigentes suman al saldo', () => {
    const r = calc(cierres(2), { movimientos: [MOV({ tipo: 'ajuste', meses: 1, fecha: '2026-10-01', renovacionAplicada: '' }), MOV({ id: 'M3', tipo: 'ajuste', meses: 5, fecha: '2025-01-01', vence: '2025-12-31' })] })
    assert.equal(r.ajusteMeses, 1)
    assert.equal(saldoCanjeable(r, R0).meses, 3)
  })
  test('el libro que no coincide con la escalera deja advertencia', () => {
    const r = calc(cierres(2), { movimientos: [MOV({ tipo: 'ganado_cierre', meses: 1, fecha: '2026-09-24', renovacionAplicada: '' })] })
    assert.match(r.advertencias.join(' '), /libro de Créditos suma 1/)
  })
  test('el libro que coincide con la escalera (los meses de cada cierre son el incremento del total) no avisa', () => {
    const libro = [1, 1, 2].map((m, i) => MOV({ id: `M${i}`, tipo: 'ganado_cierre', meses: m, fecha: '2026-09-24', renovacionAplicada: '' }))   // 1 + 1 + 2 = 4 = renovación gratis
    assert.deepEqual(calc(cierres(3), { movimientos: libro }).advertencias, [])
  })
  test('canje sin fecha avisa y no corta el ciclo', () => {
    const r = calc(cierres(1), { movimientos: [MOV({ fecha: null })] })
    assert.equal(r.cicloDesde, null); assert.match(r.advertencias.join(' '), /sin fecha|no tiene fecha/)
  })
  test('saldo canjeable, canje solo contra renovación y plan de canje (dry-run)', () => {
    const r = calc(cierres(3))
    const s = saldoCanjeable(r, R0)
    assert.equal(s.meses, 4); assert.equal(s.usd, 0); assert.equal(s.valorUSD, 2600); assert.equal(s.valorPlanDePagosUSD, 3800); assert.equal(s.renovacionGratis, true); assert.equal(s.soloContraRenovacion, true)
    assert.equal(puedeCanjear('renovacion'), true); assert.equal(puedeCanjear('efectivo'), false)
    assert.throws(() => puedeCanjear('regalo'), RangeError)
    const plan = planCanje(r, { fecha: HOY, renovacionAplicada: 'R3', cargadoPor: 'Tomás' }, R0)
    assert.equal(plan.tipo, 'canje'); assert.equal(plan.meses, -4); assert.equal(plan.renovacionAplicada, 'R3'); assert.equal(plan.idCliente, 'A001'); assert.equal(plan.extra, 'renovación gratis')
    assert.throws(() => planCanje(calc([]), { fecha: HOY, renovacionAplicada: 'R3', cargadoPor: 'x' }), RangeError)   // ni meses ni USD
    assert.throws(() => planCanje(r, { fecha: HOY, renovacionAplicada: ' ', cargadoPor: 'x' }), TypeError)
    assert.throws(() => planCanje(r, { fecha: 'hoy', renovacionAplicada: 'R3', cargadoPor: 'x' }), TypeError)
  })
  test('el plan de canje incluye los USD en el campo Extra (el libro no tiene columna) y se lee de vuelta', () => {
    const r = calc([...cierres(3), ...intentos(5)])   // 5 meses (renovación gratis + 1) y USD 600
    const plan = planCanje(r, { fecha: HOY, renovacionAplicada: 'R3', cargadoPor: 'Tomás' }, R0)
    assert.equal(plan.meses, -5); assert.equal(plan.extra, 'renovación gratis + USD 600'); assert.deepEqual(usdDeTexto(plan.extra), { usd: 600, varios: false })
    // solo USD (sin meses): se puede canjear y el movimiento no trae meses negativos
    const soloUsd = planCanje(calc(intentos(2)), { fecha: HOY, renovacionAplicada: 'R3', cargadoPor: 'x' }, R0)
    assert.equal(soloUsd.meses, 0); assert.equal(soloUsd.extra, 'USD 300')
    // si el canje se escribiera en el libro, cierra el ciclo y lo ganado queda usado
    const despues = calcularCreditos({ idCliente: 'A001', referidos: [...cierres(3), ...intentos(5)], hoy: '2026-10-10', movimientos: [{ ...plan, id: 'M9', fila: 2 }] }, R0)
    assert.equal(despues.cicloDesde, HOY); assert.deepEqual(despues.usd, { ganado: 600, usado: 600, vencido: 0, disponible: 0 }); assert.equal(despues.mesesGanados, 0)
    assert.equal(despues.paginaWeb.vigente, true)   // la web no se canjea
  })
  test('saldo nunca negativo aunque el ajuste sea negativo', () => {
    const r = calc(cierres(1), { movimientos: [MOV({ tipo: 'ajuste', meses: -4, fecha: '2026-10-01' })] })
    assert.equal(saldoCanjeable(r, R0).meses, 0)
  })
  test('calcularCreditosDeTodos arma un resumen por cada cliente con actividad', () => {
    const m = calcularCreditosDeTodos({ referidos: [REF({ idReferidor: 'A001' }), REF({ id: 'R2', idReferidor: 'A002', estado: 'No cerró', fechaPrimerPago: null })], movimientos: [MOV({ idCliente: 'A003', tipo: 'ajuste', meses: 1, fecha: '2026-10-01' })], hoy: HOY }, R0)
    assert.deepEqual([...m.keys()].sort(), ['A001', 'A002', 'A003'])
    assert.equal(m.get('A001').mesesGanados, 1); assert.equal(m.get('A002').mesesGanados, 0); assert.equal(m.get('A002').intentos, 1); assert.equal(m.get('A003').ajusteMeses, 1)
  })
})


describe('referido válido: lead nuevo, de otro estudio, que asiste', () => {
  const clientes = [{ id: 'A001', celular: '+54 9 11 5555-1234', mail: 'Cliente@Estudio.com' }, { id: 'A050', celular: '11 4444 9999', mail: '' }]
  const conocido = indiceContactos(clientes)
  test('lead nuevo y de otro estudio que asistió es válido', () => {
    const v = validarReferido(REF({ telefono: '11 3333 0000', estudio: 'Estudio Nuevo' }), { estudioReferidor: 'Estudio Viejo', esContactoConocido: conocido })
    assert.deepEqual(v, { valido: true, motivos: [] })
  })
  test('no asistió, mismo estudio y contacto ya conocido son motivos de rechazo', () => {
    assert.equal(validarReferido(REF({ estado: 'No asistió' })).valido, false)
    assert.match(validarReferido(REF({ estudio: 'Estudio Viejo' }), { estudioReferidor: 'estudio  viejo' }).motivos[0], /mismo estudio/)
    const k = validarReferido(REF({ telefono: '5555-1234' }), { esContactoConocido: conocido })
    assert.match(k.motivos[0], /lead nuevo/)
    assert.equal(validarReferido(REF({ mail: 'cliente@estudio.com' }), { esContactoConocido: conocido }).valido, false)
  })
  test('el cliente que nació de ese mismo referido no lo vuelve "conocido"', () => {
    const conNuevo = indiceContactos([...clientes, { id: 'A120', celular: '11 3333 0000', mail: '' }])
    assert.equal(conNuevo(REF({ telefono: '11 3333 0000', idClienteNuevo: 'A120' })), false)
    assert.equal(conNuevo(REF({ telefono: '11 3333 0000', idClienteNuevo: '' })), true)
  })
})

describe('metas y KPI: clientes nuevos del mes que entran por referido', () => {
  const R = REGLAS_REFERIDOS
  test('meta de cada mes: antes del programa ninguna; octubre 5 %; noviembre sigue la de octubre; diciembre 10 %; marzo de 2027 15 a 20 %', () => {
    assert.equal(metaDelMes('2026-09'), null); assert.equal(metaDelMes('2025-01'), null)
    const oct = metaDelMes('2026-10'); assert.deepEqual([oct.minPct, oct.maxPct, oct.esHito, oct.hitoDesde, oct.siguiente.desde], [5, 5, true, '2026-10', '2026-12'])
    const nov = metaDelMes('2026-11'); assert.deepEqual([nov.minPct, nov.maxPct, nov.esHito, nov.hitoDesde], [5, 5, false, '2026-10'])
    const dic = metaDelMes('2026-12'); assert.deepEqual([dic.minPct, dic.maxPct, dic.esHito, dic.siguiente.desde], [10, 10, true, '2027-03'])
    for (const m of ['2027-01', '2027-02']) assert.deepEqual([metaDelMes(m).minPct, metaDelMes(m).esHito], [10, false], m)
    const mar = metaDelMes('2027-03'); assert.deepEqual([mar.minPct, mar.maxPct, mar.esHito], [15, 20, true])
    const lejos = metaDelMes('2028-08'); assert.deepEqual([lejos.minPct, lejos.maxPct, lejos.esHito, lejos.siguiente], [15, 20, false, null])
  })
  test('meses inválidos son un error de quien llama; la meta sale de la configuración', () => {
    for (const malo of ['2026-13', '2026-1', '10/2026', '2026-10-06', null, 202610]) assert.throws(() => metaDelMes(malo), TypeError, String(malo))
    assert.deepEqual([esMesValido('2026-10'), esMesValido('2026-00'), esMesValido('2026-10-01')], [true, false, false])
    assert.equal(mesDe('2026-10-06'), '2026-10'); assert.throws(() => mesDe('2026-02-30'), TypeError)
    const reglas = { ...R, metas: { ...R.metas, kpiPrincipal: { ...R.metas.kpiPrincipal, hitos: [{ desde: '2026-10', minPct: 7, maxPct: 9 }] } } }
    assert.equal(metaDelMes('2027-05', reglas).minPct, 7)
    assert.equal(metaDelMes('2026-09', { ...reglas, vigenteDesde: '2026-10-01' }), null)
    // si los hitos empezaran antes del inicio del programa, igual no hay meta antes del inicio
    assert.equal(metaDelMes('2026-05', { ...reglas, metas: { ...reglas.metas, kpiPrincipal: { ...reglas.metas.kpiPrincipal, hitos: [{ desde: '2026-01', minPct: 1, maxPct: 1 }] } } }), null)
  })

  const CL = (id, dia1, o = {}) => ({ id, linea: 'agencia', dia1, cuentaEnMetricas: true, ...o })
  const RF = (idClienteNuevo, o = {}) => ({ id: 'R', estado: 'Cerró', idClienteNuevo, fechaPrimerPago: '2026-10-03', fechaLlamada: null, fechaPedido: null, reembolso: false, ...o })
  const kpi = (clientes, referidos, extra = {}) => kpiClientesNuevosPorReferido({ clientes, referidos, hoy: '2026-10-20', ...extra })

  test('2 de 4 clientes nuevos de octubre vinieron por referido = 50 %, y supera la meta del 5 %', () => {
    const k = kpi(
      [CL('A101', '2026-10-01'), CL('A102', '2026-10-15'), CL('A103', '2026-10-31'), CL('A104', '2026-10-10'),
        CL('A090', '2026-09-30'), CL('A105', '2026-11-01'), CL('C001', '2026-10-05', { linea: 'consultora', cuentaEnMetricas: false }), CL('A106', '2026-10-05', { cuentaEnMetricas: false })],
      [RF('A101'), RF('a103 ', { reembolso: true }), RF('A090'), RF('A105'), RF('A104', { estado: 'Asistió' })],
    )
    assert.equal(k.mes, '2026-10'); assert.equal(k.estado, 'ok'); assert.equal(k.clientesNuevos, 4); assert.equal(k.porReferido, 2); assert.equal(k.porcentaje, 50)
    assert.equal(k.meta.minPct, 5); assert.equal(k.cumpleMeta, true)
  })
  test('un cliente presentado por dos referidos cuenta una sola vez; el ID se compara sin mayúsculas ni espacios', () => {
    const k = kpi([CL('A101', '2026-10-02'), CL('A102', '2026-10-03')], [RF('A101'), RF(' a101'), RF('A101', { id: 'R2' })])
    assert.equal(k.porReferido, 1); assert.equal(k.porcentaje, 50)
  })
  test('el cierre reembolsado igual cuenta como entrada por referido; el que no cerró, no', () => {
    const k = kpi([CL('A101', '2026-10-02')], [RF('A101', { reembolso: true })]); assert.equal(k.porReferido, 1)
    assert.equal(kpi([CL('A101', '2026-10-02')], [RF('A101', { estado: 'No cerró' })]).porReferido, 0)
  })
  test('por debajo de la meta: 1 de 40 = 2,5 % < 5 %; justo en la meta: 1 de 20 = 5 %', () => {
    const nuevos = n => Array.from({ length: n }, (_, i) => CL(`A${200 + i}`, '2026-10-05'))
    const bajo = kpi(nuevos(40), [RF('A200')]); assert.equal(bajo.porcentaje, 2.5); assert.equal(bajo.cumpleMeta, false)
    const justo = kpi(nuevos(20), [RF('A200')]); assert.equal(justo.porcentaje, 5); assert.equal(justo.cumpleMeta, true)
    assert.equal(kpi(nuevos(10), []).porcentaje, 0)   // hay datos y ninguno vino por referido: 0 % verdadero
  })
  test('estados vacíos honestos: sin clientes nuevos, sin la pestaña Referidos', () => {
    const sinNuevos = kpi([CL('A090', '2026-09-30')], [RF('A090')])
    assert.equal(sinNuevos.estado, 'sin_clientes_nuevos'); assert.equal(sinNuevos.porcentaje, null); assert.equal(sinNuevos.cumpleMeta, null); assert.equal(sinNuevos.clientesNuevos, 0)
    const sinPestana = kpi([CL('A101', '2026-10-02')], [], { pestanaReferidosAusente: true })
    assert.equal(sinPestana.estado, 'sin_pestana'); assert.equal(sinPestana.porcentaje, null); assert.equal(sinPestana.porReferido, 0); assert.equal(sinPestana.clientesNuevos, 1)
    assert.equal(kpi([], []).estado, 'sin_clientes_nuevos')
  })
  test('cierres sin "ID cliente nuevo": no se estiman, se informan (solo los del mes o sin fecha)', () => {
    const k = kpi([CL('A101', '2026-10-02')], [RF('', { id: 'R1' }), RF('', { id: 'R2', fechaPrimerPago: '2026-09-02' }), RF('', { id: 'R3', fechaPrimerPago: null }), RF('', { id: 'R4', fechaPrimerPago: null, fechaLlamada: '2026-10-09' }), RF('A101', { id: 'R5' })])
    assert.equal(k.cierresSinCliente, 3); assert.equal(k.porReferido, 1)
  })
  test('mes pedido distinto de hoy; antes del programa no hay meta ni "cumple"', () => {
    const sep = kpi([CL('A090', '2026-09-10'), CL('A091', '2026-09-20')], [RF('A090')], { mes: '2026-09' })
    assert.equal(sep.mes, '2026-09'); assert.equal(sep.porcentaje, 50); assert.equal(sep.meta, null); assert.equal(sep.cumpleMeta, null)
    const mar = kpiClientesNuevosPorReferido({ clientes: [CL('A300', '2027-03-04')], referidos: [RF('A300')], hoy: '2027-03-20' })
    assert.equal(mar.meta.minPct, 15); assert.equal(mar.meta.maxPct, 20); assert.equal(mar.cumpleMeta, true)
  })
  test('el mes sale de hoy en hora argentina (no del reloj del servidor)', () => {
    assert.equal(kpiClientesNuevosPorReferido({ clientes: [], referidos: [], hoy: hoyArgentina(new Date('2026-11-01T01:00:00Z')) }).mes, '2026-10')   // 22:00 del 31/10 en Buenos Aires
  })
  test('entradas inválidas', () => {
    assert.throws(() => kpiClientesNuevosPorReferido(null), TypeError)
    assert.throws(() => kpiClientesNuevosPorReferido({ clientes: null, referidos: [], hoy: '2026-10-01' }), TypeError)
    assert.throws(() => kpiClientesNuevosPorReferido({ clientes: [], referidos: [], hoy: '1/10/2026' }), TypeError)
    assert.doesNotThrow(() => kpi([null, CL('', '2026-10-01'), CL('A1', null)], [null, RF('')]))   // filas basura no rompen
  })
  test('textos de metas e indicadores de apoyo', () => {
    assert.deepEqual([mesLargo('2026-10'), mesLargo('2027-03')], ['octubre de 2026', 'marzo de 2027'])
    assert.deepEqual([porcentajeTexto(5), porcentajeTexto(12.5), porcentajeTexto(33.3)], ['5 %', '12,5 %', '33,3 %'])
    assert.deepEqual(R.metas.kpiPrincipal.hitos.map(rangoMetaTexto), ['5 %', '10 %', '15 a 20 %'])
    assert.deepEqual(R.metas.apoyo.map(objetivoApoyoTexto), ['60 %', '8 a 10 %', '30 % o más', 'menos de USD 446'])
  })
})

describe('fechas', () => {
  test('aritmética de días y meses', () => {
    assert.equal(sumarDias('2026-12-25', 14), '2027-01-08'); assert.equal(diasEntre('2026-09-10', '2026-09-24'), 14)
    assert.equal(diasEntre('2026-10-06', '2026-10-05'), -1); assert.equal(sumarMeses('2026-10-31', 4), '2027-02-28')
    assert.equal(sumarMeses('2026-01-15', -2), '2025-11-15')
  })
  test('validez estricta', () => {
    assert.equal(esYmdValido('2026-02-29'), false); assert.equal(esYmdValido('2028-02-29'), true); assert.equal(esYmdValido('2026-2-1'), false)
    assert.equal(esYmdValido(20261006), false)
  })
  test('serial de Sheets y texto d/m/aaaa; la hora del serial no corre el día', () => {
    assert.equal(serialAYmd(46023), '2026-01-01'); assert.equal(serialAYmd(46023.9), '2026-01-01')   // las 21:36 siguen siendo el 1/1
    assert.equal(serialAYmd(46022.9999999), '2026-01-01')   // error de float de un serial entero (tolerancia 1e-6)
    assert.equal(serialAYmd(0), null); assert.equal(serialAYmd(NaN), null)
    assert.equal(fechaDeCelda('14/07/2025'), '2025-07-14'); assert.equal(fechaDeCelda('1/2/26'), '2026-02-01')
    assert.equal(fechaDeCelda('2026-10-06'), '2026-10-06'); assert.equal(fechaDeCelda('31/02/2026'), null)
    assert.equal(fechaDeCelda('Agendada (10/9)'), null); assert.equal(fechaDeCelda(''), null); assert.equal(fechaDeCelda(null), null)
  })
  test('hoy en Argentina (UTC-3): a las 22:30 del 6/10 ya es 7/10 en UTC pero acá sigue siendo 6/10', () => {
    assert.equal(hoyArgentina(new Date('2026-10-07T01:30:00Z')), '2026-10-06')
    assert.equal(hoyArgentina(new Date('2026-10-07T03:00:00Z')), '2026-10-07')
  })
  test('el primer día del programa se decide en hora argentina: a las 22:00 del 30/9 todavía es septiembre', () => {
    const ayer = hoyArgentina(new Date('2026-10-01T01:00:00Z'))   // 22:00 del 30/9 en Buenos Aires
    assert.equal(ayer, '2026-09-30'); assert.equal(esAnteriorAlPrograma({ fechaPedido: ayer, fechaLlamada: null, fechaPrimerPago: null }), true)
    const hoy = hoyArgentina(new Date('2026-10-01T03:30:00Z'))    // 00:30 del 1/10
    assert.equal(hoy, '2026-10-01'); assert.equal(esAnteriorAlPrograma({ fechaPedido: hoy, fechaLlamada: null, fechaPrimerPago: null }), false)
  })
})

