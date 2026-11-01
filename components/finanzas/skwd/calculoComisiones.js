// Motor de COMISIONES NUEVAS (para líneas nuevas de Pagos del equipo). Funciones puras: reciben filas ya leídas y devuelven una PROPUESTA.
// Está separado a propósito del cálculo del Dashboard (calculoDashboard.js, que sigue mostrando la comisión teórica histórica sin cambios)
// y NUNCA recalcula ni modifica Payroll histórico: solo propone importes para un mes y una persona; los confirma quien carga la línea.
//
// Reglas (aprobadas):
//  - Setter: 5% si la fuente es "Inbound IG" y 2,5% si es "Enrutamiento", SOLO sobre Fee, PIF y 1ra Cuota.
//  - Bono KPI (solo Setter): 15% adicional sobre la comisión de Setter generada, cuando se alcanza el objetivo. Se tilda a mano.
//  - Closer: 10% de todo el dinero cobrado de Front-end a su nombre (incluye cuotas posteriores). Back-end no genera comisión.
//  - Sobre importes efectivamente cobrados (cada pago cuenta, incluidos los parciales). Sin diferenciar programa.
//  - Gero y Tomi no generan comisión (lista de configuración; nunca se asigna por parecido de nombre).
//  - La persona de un pago se identifica por coincidencia EXACTA (sin tildes, mayúsculas ni espacios sobrantes) con su nombre completo o con
//    alguno de sus apodos (Equipo → apodos, separados por coma o punto y coma). No hay coincidencias aproximadas.
//  - Concepto, fuente y tipo de venta se comparan normalizados (mayúsculas, tildes, guiones y espacios), pero SOLO se aceptan las categorías conocidas:
//    un valor desconocido no se asume, queda explicado como excluido.
//  - Ante cualquier duda de identidad o de datos (alias compartido, alias que coincide con Gero/Tomi, IDs de pago repetidos) la propuesta
//    se BLOQUEA con una advertencia, en vez de calcular algo posiblemente incorrecto.

export const REGLAS_COMISION = {
  setterInbound: 0.05,
  setterEnrutamiento: 0.025,
  fuenteInbound: 'Inbound IG',
  fuenteEnrutamiento: 'Enrutamiento',
  conceptosSetter: ['Fee', 'PIF', '1ra Cuota'],
  conceptosConocidos: ['Fee', 'PIF', '1ra Cuota', '2da Cuota', '3ra Cuota', '4ta Cuota', 'Renovación'],
  closer: 0.1,
  tipoVentaCloser: 'Front-end',
  variantesTipoVentaCloser: ['Front-end', 'Front end', 'Frontend'], // lista cerrada de escrituras equivalentes (se comparan normalizadas); cualquier otra NO se acepta
  tipoVentaBack: 'Back-end',
  bonoKpiSetter: 0.15,
  // Identidades (nombre principal, ya normalizado) que NUNCA reciben comisión: configuración explícita, no deducción.
  // Se comparan SOLO contra el nombre principal de la persona; un apodo igual a uno de estos nombres no excluye a nadie: bloquea la propuesta.
  excluidos: ['gero', 'tomi', 'gero a.', 'tomi n.', 'tomi / gero'],
  // En Pagos, el setter de Enrutamiento figura como "ENRU / <nombre>": se compara con el nombre que sigue al prefijo
  prefijoSetterEnrutamiento: 'enru',
}

/** Texto comparable: sin tildes, en minúsculas, con espacios simples. */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
/** Categorías (concepto, fuente, tipo de venta): igual que norm, y además guiones y guiones bajos valen como espacio ("Front-end" = "Front End"). */
export const clave = (s) => norm(s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
const vacio = (v) => v === null || v === undefined || String(v).trim() === ''

// Centavos enteros (mitad hacia afuera del cero) para no arrastrar errores de coma flotante
const aC = (v) => { const n = Number(v); if (!Number.isFinite(n)) return NaN; const r = Math.round(Math.abs(n) * 100 + 1e-7); return n < 0 ? -r : r }
const redC = (c) => { const r = Math.round(Math.abs(c) + 1e-7); return c < 0 ? -r : r }
const deC = (c) => c / 100
const pct = (x) => (x * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%'
const usd = (c) => '$' + deC(c).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const mismoId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b)

/** Alias por los que se reconoce a una persona en Pagos: nombre completo + apodos (separados por coma, punto y coma o salto de línea). */
export function aliasDe(persona) {
  const apodos = String(persona?.apodos ?? '').split(/[;,\n]/).map(norm).filter(Boolean)
  return [...new Set([norm(persona?.nombre), ...apodos].filter(Boolean))]
}

/**
 * Setter tal como se compara con los alias. Reconoce "ENRU / Nombre" (con o sin espacios alrededor de la barra, cualquier combinación de
 * mayúsculas) y devuelve el nombre que sigue al prefijo. Un nombre que NO empieza con ese prefijo se deja tal cual (nunca se recorta a ciegas).
 */
export function setterNormalizado(valor) {
  const n = norm(valor)
  const m = n.match(new RegExp(`^${REGLAS_COMISION.prefijoSetterEnrutamiento}\\s*/\\s*(.*)$`))
  return m ? { nombre: m[1].trim(), conPrefijo: true } : { nombre: n, conPrefijo: false }
}

/** Una persona está excluida solo por su IDENTIDAD PRINCIPAL (nombre). Sus apodos no la excluyen ni excluyen a otra persona. */
export const esExcluida = (persona) => REGLAS_COMISION.excluidos.includes(norm(persona?.nombre))

/** Apodos de la persona que coinciden con un nombre excluido (configuración inconsistente: ese nombre no puede pertenecer a nadie más). */
const apodosExcluidos = (persona) => aliasDe(persona).filter((a) => a !== norm(persona?.nombre) && REGLAS_COMISION.excluidos.includes(a))

/** Estado del importe de un pago: 'ok' | 'vacio' | 'no_numerico' | 'cero' | 'negativo'. */
function estadoMonto(valor) {
  if (vacio(valor)) return { estado: 'vacio', c: NaN }
  const c = aC(valor)
  if (Number.isNaN(c)) return { estado: 'no_numerico', c }
  if (c === 0) return { estado: 'cero', c }
  if (c < 0) return { estado: 'negativo', c }
  return { estado: 'ok', c }
}
const MOTIVO_MONTO = { vacio: 'Monto vacío', no_numerico: 'Monto no numérico', cero: 'Monto cero', negativo: 'Monto negativo (¿devolución?: revisar)' }

/**
 * Propuesta de comisión de UNA persona en UN mes.
 * @param {object} d
 * @param {object[]} d.pagos     filas de pagos_vigentes: { id, fecha, monto_usd, closer, setter, concepto, fuente, tipo_venta } (cualquier mes; se filtra acá)
 * @param {object[]} d.personas  todas las personas (para detectar alias ambiguos)
 * @param {object}  d.persona    la persona elegida (debe tener id)
 * @param {string}  d.mes        'YYYY-MM'
 * @param {boolean} d.kpi        objetivo KPI alcanzado (tilda manual; solo suma bono a la comisión de Setter). Solo `true` lo activa.
 * @returns propuesta con: lineas, comisionSetter, comisionCloser, comision, bono, total, notas, pagosUsados, y para revisar:
 *   pagosIncluidos (cada pago con su rol, porcentaje y motivo), pagosExcluidos (cada pago relevante que NO suma, con su motivo),
 *   y las banderas excluida / ambiguo / bloqueada (+ motivoBloqueo). Si `bloqueada`, no hay importes: no se debe usar.
 */
export function calcularComision({ pagos = [], personas = [], persona, mes, kpi = false }) {
  const R = REGLAS_COMISION
  const notas = []
  const base = (extra) => ({ persona: persona?.nombre ?? null, mes, excluida: false, ambiguo: false, bloqueada: false, motivoBloqueo: null, lineas: [], comisionSetter: 0, comisionCloser: 0, comision: 0, bono: 0, total: 0, notas, pagosUsados: 0, pagosIncluidos: [], pagosExcluidos: [], requiereRevision: false, alias: [], ...extra })
  const bloquear = (motivo, extra = {}) => base({ bloqueada: true, motivoBloqueo: motivo, notas: [...notas, motivo], ...extra })

  const mesValido = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))
  if (!persona || !mesValido) return bloquear('Elegí una persona y un mes.')
  if (persona.id === null || persona.id === undefined || persona.id === '') return bloquear(`${persona.nombre ?? 'La persona'} no tiene identificador en Equipo: no se puede comprobar que sus alias sean únicos.`)
  if (esExcluida(persona)) return bloquear(`${persona.nombre} no genera comisión (Gero y Tomi están excluidos por configuración).`, { excluida: true })

  const alias = aliasDe(persona)
  // Un apodo igual a un nombre excluido (Gero/Tomi) no se puede usar: los pagos de esos nombres no pertenecen a nadie. No se adivina quién es.
  const colisionExcluida = apodosExcluidos(persona)
  if (colisionExcluida.length) return bloquear(`El apodo «${colisionExcluida.join('», «')}» de ${persona.nombre} coincide con un nombre excluido de las comisiones (Gero / Tomi): no se puede determinar con seguridad quién es. Corregí el apodo en Equipo.`, { ambiguo: true, alias })
  // Un alias que también usa OTRA persona (por id distinto) es ambiguo: no se asigna nada (nunca se adivina)
  const otras = personas.filter((o) => !mismoId(o.id, persona.id))
  const compartidos = alias.filter((a) => otras.some((o) => aliasDe(o).includes(a)))
  if (compartidos.length) return bloquear(`El alias «${compartidos.join('», «')}» lo usa más de una persona en Equipo: no se calcula hasta que cada alias sea único.`, { ambiguo: true, alias })

  const parseSetter = (p) => (vacio(p.setter) ? null : setterNormalizado(p.setter))
  const esSetter = (p) => { const s = parseSetter(p); return !!s && s.nombre !== '' && alias.includes(s.nombre) }
  const esCloser = (p) => !vacio(p.closer) && alias.includes(norm(p.closer))
  const fechaMes = (p) => (typeof p.fecha === 'string' ? p.fecha.slice(0, 7) : null)

  // ---- pagos relevantes (los que llevan el nombre o alias de la persona como Setter o Closer)
  const delMes = pagos.filter((p) => fechaMes(p) === mes)
  const relevantes = delMes.filter((p) => esSetter(p) || esCloser(p))
  const sinFecha = pagos.filter((p) => fechaMes(p) === null && (esSetter(p) || esCloser(p)))
  if (sinFecha.length) notas.push(`${sinFecha.length} pago(s) con el nombre de ${persona.nombre} no tienen una fecha válida: no se pueden asignar a ningún mes (ids ${sinFecha.map((p) => p.id ?? '(sin id)').join(', ')}).`)
  // IDs: sin id o repetidos entre los pagos relevantes -> bloquea (podría duplicarse un pago sin que se note)
  const sinId = relevantes.filter((p) => p.id === null || p.id === undefined || p.id === '')
  if (sinId.length) return bloquear(`${sinId.length} pago(s) del mes de ${persona.nombre} no tienen identificador: no se puede garantizar que ningún pago se cuente dos veces. No se calcula la comisión.`, { alias })
  // Un id repetido en los datos del mes (aunque la otra copia sea de otro nombre) podría contar un pago dos veces: se bloquea.
  const veces = new Map()
  for (const p of delMes) veces.set(String(p.id), (veces.get(String(p.id)) || 0) + 1)
  const repetidos = [...new Set(relevantes.map((p) => String(p.id)))].filter((id) => veces.get(id) > 1)
  if (repetidos.length) return bloquear(`El pago con id ${repetidos.join(', ')} aparece más de una vez en los datos del mes: se podría contar dos veces. No se calcula la comisión hasta revisar los datos.`, { alias })
  const repetidosAjenos = [...veces.entries()].filter(([id, n]) => n > 1 && id !== 'undefined' && id !== 'null').map(([id]) => id)
  if (repetidosAjenos.length) notas.push(`Hay ids de pago repetidos en el mes que no son de ${persona.nombre} (${repetidosAjenos.join(', ')}); no afectan este cálculo, pero conviene revisar los datos.`)

  const incluidos = [], excluidos = []
  const detalle = (p, rol, extra) => ({ id: p.id, fecha: p.fecha, rol, concepto: p.concepto ?? null, fuente: p.fuente ?? null, tipo_venta: p.tipo_venta ?? null, monto: Number.isFinite(Number(p.monto_usd)) && !vacio(p.monto_usd) ? Number(p.monto_usd) : null, ...extra })
  // `revisar`: el pago queda excluido Y marcado para revisión (inconsistencias y devoluciones), no solo explicado
  const excluir = (p, rol, codigo, motivo, revisar = false) => excluidos.push(detalle(p, rol, { codigo, motivo, revisar }))
  const incluir = (p, rol, regla, porc, c) => incluidos.push(detalle(p, rol, { regla, pct: porc, centavos: c, motivo: `${regla}: ${pct(porc)}` }))
  const conceptoKey = (p) => clave(p.concepto), fuenteKey = (p) => clave(p.fuente), tipoKey = (p) => clave(p.tipo_venta)
  const setterKeys = R.conceptosSetter.map(clave), conocidosKeys = R.conceptosConocidos.map(clave)
  // Front-end: variantes equivalentes controladas (lista cerrada en REGLAS_COMISION): «Front-end», «Front end» y «Frontend» (ya normalizadas). Nada más.
  const kInbound = clave(R.fuenteInbound), kEnru = clave(R.fuenteEnrutamiento), kFront = R.variantesTipoVentaCloser.map(clave), kBack = clave(R.tipoVentaBack)
  const decimalesDeMas = []

  for (const p of relevantes) {
    const m = estadoMonto(p.monto_usd)
    const roles = [esSetter(p) && 'Setter', esCloser(p) && 'Closer'].filter(Boolean)
    // Decisión: los montos negativos (posibles devoluciones) se excluyen y se marcan para revisión. No restan de la base ni de comisiones futuras
    // mientras no exista una regla explícita de devoluciones.
    if (m.estado !== 'ok') { for (const r of roles) excluir(p, r, m.estado === 'negativo' ? 'monto_negativo' : 'monto_invalido', MOTIVO_MONTO[m.estado], m.estado === 'negativo'); continue }
    if (Math.abs(Number(p.monto_usd) * 100 - m.c) > 1e-6) decimalesDeMas.push(p.id)
    for (const rol of roles) {
      if (rol === 'Setter') {
        const s = parseSetter(p)
        const ck = conceptoKey(p)
        if (!setterKeys.includes(ck)) {
          if (conocidosKeys.includes(ck)) excluir(p, rol, 'concepto_no_comisiona', `Concepto «${p.concepto}»: el Setter solo comisiona Fee, PIF y 1ra Cuota (otros conceptos, por ejemplo cuotas posteriores)`)
          else excluir(p, rol, 'concepto_no_reconocido', vacio(p.concepto) ? 'Sin concepto: sin datos suficientes' : `Concepto no reconocido «${p.concepto}»: no se asume`)
          continue
        }
        const fk = fuenteKey(p)
        // Decisión: un setter «ENRU / Nombre» solo es válido con fuente Enrutamiento. Con cualquier otra fuente (o sin fuente) se BLOQUEA la comisión de ese
        // pago y se avisa de la inconsistencia; nunca se elige la tasa de otra fuente. (Afecta solo a ese pago, no a toda la propuesta.)
        if (s.conPrefijo && fk !== kEnru) { excluir(p, rol, 'enru_inconsistente', `INCONSISTENCIA: el setter figura como «${p.setter}» (Enrutamiento) pero la fuente es ${vacio(p.fuente) ? 'vacía' : `«${p.fuente}»`}: no se comisiona ni se elige la tasa de otra fuente; revisar el pago`, true); continue }
        if (vacio(p.fuente)) { excluir(p, rol, 'sin_fuente', 'Sin fuente: no se sabe si corresponde 5% o 2,5%'); continue }
        if (fk !== kInbound && fk !== kEnru) { excluir(p, rol, 'fuente_sin_regla', `Fuente «${p.fuente}»: no hay regla de comisión para esa fuente`); continue }
        incluir(p, rol, fk === kInbound ? `Setter · ${R.fuenteInbound}` : `Setter · ${R.fuenteEnrutamiento}`, fk === kInbound ? R.setterInbound : R.setterEnrutamiento, m.c)
      } else {
        const tk = tipoKey(p)
        if (vacio(p.tipo_venta)) excluir(p, rol, 'sin_tipo_venta', 'Sin tipo de venta: sin datos suficientes')
        else if (tk === kBack) excluir(p, rol, 'back_end', 'Back-end: no genera comisión de Closer')
        else if (!kFront.includes(tk)) excluir(p, rol, 'tipo_venta_no_reconocido', `Tipo de venta no reconocido «${p.tipo_venta}»: no se asume`)
        else incluir(p, rol, `Closer · ${R.tipoVentaCloser}`, R.closer, m.c)
      }
    }
  }

  // ---- líneas (una por regla) y totales, en centavos enteros
  const lineas = []
  const sumarLinea = (rol, regla, porc, texto) => {
    const lista = incluidos.filter((x) => x.rol === rol && x.regla === regla)
    if (!lista.length) return 0
    const baseC = lista.reduce((s, x) => s + x.centavos, 0)
    const montoC = redC(baseC * porc)
    lineas.push({ rol, regla: texto, pct: porc, n: lista.length, base: deC(baseC), monto: deC(montoC), pagos: lista.map((x) => x.id), texto: `${texto}: ${pct(porc)} de ${usd(baseC)} (${lista.length} pago${lista.length === 1 ? '' : 's'})` })
    return montoC
  }
  const setterInboundC = sumarLinea('Setter', `Setter · ${R.fuenteInbound}`, R.setterInbound, `Setter · ${R.fuenteInbound} (Fee, PIF y 1ra Cuota)`)
  const setterEnruC = sumarLinea('Setter', `Setter · ${R.fuenteEnrutamiento}`, R.setterEnrutamiento, `Setter · ${R.fuenteEnrutamiento} (Fee, PIF y 1ra Cuota)`)
  const setterC = setterInboundC + setterEnruC
  const closerC = sumarLinea('Closer', `Closer · ${R.tipoVentaCloser}`, R.closer, `Closer · todo lo cobrado de ${R.tipoVentaCloser} (incluye cuotas posteriores)`)

  // ---- avisos agrupados (compatibles con la interfaz: texto resumido; el detalle por pago está en pagosExcluidos)
  const grupo = (codigo) => excluidos.filter((x) => x.codigo === codigo)
  const sumaE = (arr) => arr.reduce((s, x) => s + (x.monto === null ? 0 : aC(x.monto)), 0)
  const negativos = grupo('monto_negativo')
  const invalidos = [...grupo('monto_invalido'), ...negativos]
  if (negativos.length) notas.push(`REVISAR: ${new Set(negativos.map((x) => x.id)).size} pago(s) con monto negativo (posibles devoluciones) se excluyeron y quedan marcados para revisión. No se descuentan de esta ni de futuras comisiones: todavía no existe una regla explícita de devoluciones.`)
  if (invalidos.length) notas.push(`${new Set(invalidos.map((x) => x.id)).size} pago(s) de ${persona.nombre} con monto vacío, cero o negativo no se tuvieron en cuenta (ver el detalle de pagos excluidos).`)
  if (decimalesDeMas.length) notas.push(`${decimalesDeMas.length} pago(s) tienen importes con más de 2 decimales y se redondearon al centavo antes de calcular (ids ${decimalesDeMas.join(', ')}).`)
  const g1 = grupo('concepto_no_comisiona')
  if (g1.length) notas.push(`${g1.length} pago(s) como Setter por ${usd(sumaE(g1))} son de otros conceptos (por ejemplo cuotas posteriores): el Setter solo comisiona Fee, PIF y 1ra Cuota.`)
  const g2 = grupo('concepto_no_reconocido')
  if (g2.length) notas.push(`${g2.length} pago(s) como Setter con concepto vacío o no reconocido: sin datos suficientes; no se comisionan.`)
  const g3 = grupo('sin_fuente')
  if (g3.length) notas.push(`${g3.length} pago(s) como Setter sin fuente: sin datos suficientes para saber si corresponde ${pct(R.setterInbound)} o ${pct(R.setterEnrutamiento)}; no se comisionan.`)
  const g4 = grupo('fuente_sin_regla')
  if (g4.length) notas.push(`${g4.length} pago(s) como Setter de otra fuente (${[...new Set(g4.map((x) => x.fuente))].join(', ')}): no hay regla de comisión para esa fuente.`)
  const g5 = grupo('enru_inconsistente')
  if (g5.length) notas.push(`INCONSISTENCIA: ${g5.length} pago(s) con setter «ENRU / …» pero fuente distinta de Enrutamiento (ids ${g5.map((x) => x.id).join(', ')}). Su comisión está bloqueada y no se eligió la tasa de otra fuente: revisá esos pagos.`)
  const g6 = grupo('sin_tipo_venta')
  if (g6.length) notas.push(`${g6.length} pago(s) como Closer sin tipo de venta: sin datos suficientes; no se comisionan.`)
  const g7 = grupo('back_end')
  if (g7.length) notas.push(`${g7.length} pago(s) como Closer de ${R.tipoVentaBack} por ${usd(sumaE(g7))}: solo ${R.tipoVentaCloser} genera comisión de Closer.`)
  const g8 = grupo('tipo_venta_no_reconocido')
  if (g8.length) notas.push(`${g8.length} pago(s) como Closer con un tipo de venta no reconocido (${[...new Set(g8.map((x) => x.tipo_venta))].join(', ')}): no se asume; no se comisionan.`)

  // ---- Bono KPI: 15% de la comisión de Setter, y solo con la tilda manual (kpi === true). Nunca sobre la de Closer.
  const bonoC = kpi === true ? redC(setterC * R.bonoKpiSetter) : 0
  if (kpi === true && setterC === 0) notas.push('Marcaste KPI alcanzado, pero esta persona no generó comisión de Setter en el mes: no hay bono.')
  if (kpi === true && closerC > 0) notas.push(`El bono KPI (${pct(R.bonoKpiSetter)}) se calcula solo sobre la comisión de Setter (${usd(setterC)}); la de Closer no lleva bono.`)
  if (!relevantes.length) notas.push(`No hay pagos del mes con el nombre o alias de ${persona.nombre} (${alias.join(', ') || 'sin alias'}). Si figura con otro nombre en Pagos, agregalo en Equipo → apodos.`)

  return {
    persona: persona.nombre, mes, excluida: false, ambiguo: false, bloqueada: false, motivoBloqueo: null, lineas, notas,
    comisionSetter: deC(setterC), comisionCloser: deC(closerC), comision: deC(setterC + closerC), bono: deC(bonoC), total: deC(setterC + closerC + bonoC),
    pagosUsados: new Set(incluidos.map((x) => String(x.id))).size, alias,
    pagosIncluidos: incluidos.map(({ centavos, ...resto }) => ({ ...resto, base: deC(centavos) })),
    pagosExcluidos: excluidos, requiereRevision: excluidos.some((x) => x.revisar),
  }
}

/** Nombres de closer/setter de los pagos del mes que NO coinciden con ninguna persona (para ayudar a cargar apodos). Informativo: nunca asigna nada. */
export function nombresSinPersona({ pagos = [], personas = [], mes }) {
  const conocidos = new Set(personas.flatMap(aliasDe))
  const excluidos = new Set(REGLAS_COMISION.excluidos)
  const cuenta = new Map()
  for (const p of pagos) {
    if (typeof p.fecha !== 'string' || p.fecha.slice(0, 7) !== mes) continue
    for (const [campo, valor, n] of [['Closer', p.closer, norm(p.closer)], ['Setter', p.setter, setterNormalizado(p.setter).nombre]]) {
      if (vacio(valor) || n === '' || conocidos.has(n) || excluidos.has(n)) continue
      const k = `${campo}: ${n}`
      const previo = cuenta.get(k)
      cuenta.set(k, { nombre: previo?.nombre ?? `${campo}: ${String(valor).trim()}`, n: (previo?.n || 0) + 1 }) // se muestra la primera escritura encontrada
    }
  }
  return [...cuenta.values()].sort((a, b) => b.n - a.n)
}
