// ── Analista SKWD: revisa el negocio de arriba a abajo y devuelve hallazgos simples ──
// Función PURA (sin fetch ni Date.now: la fecha llega en opts.hoy). La usan el panel del
// dashboard (navegador) y el cron /api/analista (Discord), así los dos dicen exactamente lo mismo.
// Cada hallazgo = 1 frase con el número clave + 1 acción. Foco: franjas de oportunidad para
// escalar embudos (regla del mentor FECCU:CAC: >5 escalar · 3–5 mantener · <3 revisar/apagar).
// Solo `import type`: este archivo tiene que poder correr suelto en Node (type-stripping).
import type { RawSerializada } from './serializeRaw'

export interface Hallazgo {
  id: string                  // clave estable para no repetir en Discord (ej 'escalar-vsl-2026-09')
  prioridad: 1 | 2 | 3        // 1 = importante (va a Discord), 2 = a mirar, 3 = dato
  tipo: 'oportunidad' | 'riesgo' | 'dato'
  area: 'caja' | 'embudos' | 'ventas' | 'backend' | 'clientes' | 'operaciones'
  icono: string
  titulo: string              // ≤ 8 palabras
  texto: string               // 1 frase simple con el número clave
  accion?: string             // qué hacer, 1 frase imperativa (solo en el mes en curso: un mes cerrado no se "hace")
}
export interface Analisis { resumen: string; hallazgos: Hallazgo[] }   // hallazgos ordenados por prioridad

// ── Vista defensiva de los datos ──────────────────────────────────────────
// Los campos nuevos (monthlyBECC, backend.mensual, grabaciones nuevas, flags de Meta…) pueden
// faltar si responde un /api/raw viejo: se leen todos como opcionales y nunca se asume nada.
type Serie = (number | null | undefined)[] | undefined
interface CallV { date: string; closer?: string; occurred?: boolean; presented?: boolean; closed?: boolean; channel?: string; letra?: string | null; cash?: number; sinRegistro?: boolean }
interface TxV { date: string; amount?: number }
interface CuentaMetaV { nombre: string; estado?: string; pausadoCRM?: boolean; enGracia?: boolean; sinMedioPago?: boolean; clienteCRM?: string }
interface GrabV { cliente: string; dias?: number | null; diasDesdeGrabacion?: number | null; grabado?: boolean; guionesListos?: string | null; diasEsperando?: number | null; nota?: string | null; inactiva?: boolean; aliasSinResolver?: boolean }
interface Vista {
  transactions?: TxV[]; calls?: CallV[]
  monthlyCash?: Serie; monthlyFECCU?: Serie; monthlyBECC?: Serie; monthlyFECCP?: Serie
  monthlyCerradas?: Serie; monthlyAds?: Serie
  monthlyVSL?: Serie; monthlyIG?: Serie
  // Retargeting es un embudo PROPIO (no es parte del VSL): agendas, gasto y FECCU:CAC por separado.
  // monthlyVSL / monthlyAdsVSL / monthlyFeccuVSL no incluyen nada de retargeting.
  monthlyRetargeting?: Serie
  monthlyAdsVSL?: Serie; monthlyAdsFM?: Serie; monthlyFeccuVSL?: Serie; monthlyFeccuFM?: Serie
  // Un /api/raw viejo no trae retargeting/webinar/uruguay por separado: quedan dentro de "otros"
  monthlyAdsRetargeting?: Serie; monthlyAdsWebinar?: Serie; monthlyAdsUruguay?: Serie
  monthlyFeccuRetargeting?: Serie
  monthlyFeccuCacVSL?: Serie; monthlyFeccuCacFM?: Serie; monthlyFeccuCacRetargeting?: Serie; monthlyFeccuCacWebinar?: Serie; monthlyFeccuCacUruguay?: Serie
  monthlyAsignadosSetter?: Serie; monthlyTasaAgendaSetter?: Serie
  backend?: {
    churn?: Serie
    crm?: { disponible?: boolean; churnBajas?: Serie; churnActivosInicio?: Serie; churnRenov?: Serie; bajasSinFecha?: number }
    mensual?: { churn?: Serie; bajas?: Serie; activosInicio?: Serie; renovaciones?: Serie; tasaRenovacion?: Serie; beccPct?: Serie; nuevos?: Serie }
  }
  clickup?: { disponible?: boolean; rojo?: number; nombresRojo?: string[] }
  grabaciones?: GrabV[]
  alertas?: {
    pagosPendientes?: { nombre: string; saldo: number; fecha: string; dias: number }[]
    pagosSinFecha?: { cantidad: number; total: number }
    vencidos?: { nombre: string; dias: number; llamada: string | null; llamadaPasada?: boolean }[]
    porVencer?: { nombre: string; fecha: string; dias: number; llamada: string | null }[]
    onboarding?: { nombre: string; dias: number; status: string }[]
    metaClientes?: { disponible?: boolean; cuentas?: CuentaMetaV[] }
  }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmtUSD = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
// Montos grandes en "K" para que la frase se lea de un vistazo ($22.3K)
const fmtK = (v: number) => Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}K` : fmtUSD(v)
const fmtX = (v: number) => `${v.toFixed(1)}x`
const pct = (v: number) => `${v.toFixed(v < 10 && v % 1 !== 0 ? 1 : 0)}%`
const nombres = (lista: string[], max = 3) => {
  const arr = [...new Set(lista.map(x => x.trim()).filter(Boolean))]   // sin repetidos (ej. 2 cuentas Meta del mismo cliente)
  return arr.slice(0, max).join(', ') + (arr.length > max ? ` y ${arr.length - max} más` : '')
}
// "1 baja" / "2 bajas" (pl solo si el plural no es sing + 's')
const plural = (n: number, sing: string, pl = `${sing}s`) => `${n} ${n === 1 ? sing : pl}`
// Nombre + apellido PATERNO, sin lo que va entre paréntesis ni puntos sueltos:
// · 3 palabras o menos → tal cual (no se sabe si es "nombre nombre apellido" o "nombre apellido apellido":
//   "Jonathan Daniel Estevez" / "Agustina Vega Rojas"; cortar inventaría "Agustina Rojas").
// · 4 o más → 1ra + 3ra ("Julio César Cordero Gariza" → "Julio Cordero"); si arranca con María/Juan/José
//   el nombre es compuesto → 3 primeras ("Juan Pablo Galvan Arias" → "Juan Pablo Galvan").
// · Partículas (de, del, la, di…) se pegan a la palabra siguiente: "Maria de la Paz Robles" queda entero,
//   "Heliana Mayra Di Suero" también; "Sabina María del Rosario Espejo" → "Sabina Espejo".
// · Dos personas ("&" o " y ") → nombre de pila de cada una: "Silvia & María".
const PARTICULA = /^(de|del|la|las|los|di|da|van|von)$/i
const nombreCorto = (s: string) => {
  const limpio = s.replace(/\([^)]*\)/g, ' ').replace(/[.,;]+/g, ' ').replace(/\s+/g, ' ').trim()
  const personas = limpio.split(/ & | y /i)
  if (personas.length > 1) return personas.map(x => x.trim().split(' ')[0]).filter(Boolean).join(' & ')
  const w: string[] = []
  for (const x of limpio.split(' ')) {
    const prev = w[w.length - 1]
    if (prev && PARTICULA.test(prev.split(' ').pop() ?? '')) w[w.length - 1] = `${prev} ${x}`
    else w.push(x)
  }
  if (w.length <= 3) return w.join(' ')
  if (/^(mar[ií]a|juan|jos[eé])$/i.test(w[0])) return `${w[0]} ${w[1]} ${w[2]}`
  return /^(de|del)\s/i.test(w[2]) ? `${w[0]} ${w[w.length - 1]}` : `${w[0]} ${w[2]}`
}
const normNombre = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
// Nota de la col E de guiones que saca al cliente del seguimiento ("no mandar", "no grabar", "pausa", "baja")
// (un /api/raw viejo no trae `inactiva`: se deduce de la nota)
const NOTA_INACTIVA = /no\s+mandar|no\s+grabar|pausa|\bbaja\b/i
// Desde septiembre 2026 los asignados del setter salen de las filas vivas de "Setter IG" (regla ASIGNADO
// del 8-sep); antes, de la etiqueta de ManyChat cargada a mano. Meses de métodos distintos no se comparan.
const metodoSetter = (anio: number, i: number) => anio > 2026 || (anio === 2026 && i >= 8) ? 'filas' : 'etiqueta'

// Número válido de una serie (null si falta, no es finito o el índice no existe)
function v(serie: Serie, i: number): number | null {
  if (!serie || i < 0 || i >= serie.length) return null
  const x = serie[i]
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}
const promedio = (xs: (number | null)[]) => { const ok = xs.filter((x): x is number => x != null); return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null }

export function analizarNegocio(raw: RawSerializada, opts: { monthIdx: number; hoy: Date; metaMensual: number }): Analisis {
  const r = raw as unknown as Vista
  const { hoy, metaMensual } = opts
  const m = opts.monthIdx
  const anio = hoy.getFullYear()
  const mesHoy = hoy.getMonth()
  const ym = (i: number) => `${anio}-${String(i + 1).padStart(2, '0')}`
  const idm = ym(m)
  const mes = cap(MESES[m] ?? '')
  const mesPrev = m > 0 ? MESES[m - 1] : null
  const esMesActual = m === mesHoy
  const diasMes = new Date(anio, m + 1, 0).getDate()
  const diaHoy = hoy.getDate()
  const transcurridos = esMesActual ? diaHoy : diasMes
  const quedan = esMesActual ? diasMes - diaHoy + 1 : 0          // incluye hoy: 24/9 → quedan 7
  const avance = transcurridos / diasMes                           // fracción del mes ya corrida
  const hs: Hallazgo[] = []
  const add = (h: Hallazgo) => hs.push(h)

  if (m > mesHoy) return { resumen: `${mes} todavía no empezó: sin datos para analizar.`, hallazgos: [] }

  const calls = r.calls ?? []
  const tx = r.transactions ?? []
  const callsMes = (i: number) => calls.filter(c => typeof c.date === 'string' && c.date.startsWith(ym(i)))
  // Show-up y cierre sobre agendas ocurridas CON registro (igual que el tablero): una llamada
  // ocurrida sin nada en "¿Se presentó?" no se sabe si fue, así que no entra al denominador.
  const tasas = (cs: CallV[]) => {
    const sinRegistro = cs.filter(c => c.occurred && c.sinRegistro).length
    const ocurridas = cs.filter(c => c.occurred).length - sinRegistro
    const pres = cs.filter(c => c.presented).length
    const cierres = cs.filter(c => c.closed).length
    return { agendas: cs.length, ocurridas, sinRegistro, pres, cierres, showUp: ocurridas > 0 ? pres / ocurridas * 100 : null, cierre: ocurridas > 0 ? cierres / ocurridas * 100 : null }
  }
  // Proyección a mes completo (mes en curso) — para comparar gasto/agendas con meses cerrados
  const proy = (x: number) => esMesActual && avance > 0 ? x / avance : x

  // ═════════════════════ 0) DATOS COMPLETOS (por mes) ═════════════════════
  // Si el Registro de Pagos vino a medias (categorías vacías, lote de Sheets fallido, arranque en frío)
  // los ratios FECCU:CAC y la meta mienten: ese mes no se juzga, se avisa.
  // · cash > 0 y FECCU+FECCP+BECC < 50% del cash → pagos sin categorizar
  // · cash 0 con anuncios > 0 y ≥5 días corridos del mes → el Registro no llegó
  // Con un /api/raw viejo (sin FECCP/BECC) solo se marca FECCU 0 con cash > 0.
  const hayCategorias = !!r.monthlyFECCP && !!r.monthlyBECC
  const incompleto = (i: number): boolean => {
    if (i < 0 || i > mesHoy) return false
    const c = v(r.monthlyCash, i) ?? 0
    const feccu = v(r.monthlyFECCU, i) ?? 0
    if (c > 0) return hayCategorias ? feccu + (v(r.monthlyFECCP, i) ?? 0) + (v(r.monthlyBECC, i) ?? 0) < c * 0.5 : feccu === 0
    const diasCorridos = i === mesHoy ? diaHoy : 99
    return (v(r.monthlyAds, i) ?? 0) > 0 && diasCorridos >= 5
  }
  // FECCU 0 en todo el año con cash (Registro roto de raíz): tampoco se puede juzgar nada
  const feccuAnio = Array.from({ length: m + 1 }, (_, i) => v(r.monthlyFECCU, i) ?? 0).reduce((a, b) => a + b, 0)
  const cashAnio = Array.from({ length: m + 1 }, (_, i) => v(r.monthlyCash, i) ?? 0).reduce((a, b) => a + b, 0)
  const feccuRoto = feccuAnio === 0 && cashAnio > 0
  const datosIncompletos = incompleto(m) || feccuRoto
  // Al principio del mes el ratio es ruido (pocos días): se juzga con el último mes cerrado
  const mesMaduro = !esMesActual || diaHoy >= 10

  // ═════════════════════ 1) CAJA ═════════════════════
  const cash = v(r.monthlyCash, m) ?? 0
  const pctMeta = metaMensual > 0 ? cash / metaMensual * 100 : 0
  const cashPrev = v(r.monthlyCash, m - 1)
  const pendientes = r.alertas?.pagosPendientes ?? []
  const vencidoCobro = pendientes.filter(p => p.dias < 0).reduce((a, p) => a + (p.saldo || 0), 0)
  const porCobrarMes = pendientes.reduce((a, p) => a + (p.saldo || 0), 0)

  if (datosIncompletos) {
    // Un solo aviso en lugar de juzgar la meta y los embudos con datos rotos
    const cat = (v(r.monthlyFECCU, m) ?? 0) + (v(r.monthlyFECCP, m) ?? 0) + (v(r.monthlyBECC, m) ?? 0)
    const adsMes = v(r.monthlyAds, m) ?? 0
    add({
      id: `datos-incompletos-${idm}`, prioridad: 1, tipo: 'riesgo', area: 'caja', icono: '🧩',
      titulo: `${mes}: datos incompletos, no se juzga`,
      texto: cash > 0
        ? `Del cash de ${MESES[m]} (${fmtK(cash)}) solo ${fmtK(cat)} tiene categoría FECCU/FECCP/BECC, así que la meta y el FECCU:CAC por embudo no son confiables.`
        : `El Registro de Pagos no trae cobros de ${MESES[m]} pero hay ${fmtK(adsMes)} de anuncios: faltan datos para juzgar la meta y los embudos.`,
      accion: cash > 0
        ? 'Completá "Tipos de venta" y "Tipo de pago" en el Registro de Pagos.'
        : 'Revisá que el Registro de Pagos tenga los cobros del mes y recargá el dashboard.',
    })
  } else if (esMesActual) {
    const falta = Math.max(0, metaMensual - cash)
    const ritmo = diaHoy > 0 ? cash / diaHoy : 0
    const necesario = quedan > 0 ? falta / quedan : falta
    if (falta > 0) {
      add({
        id: `meta-${idm}`, prioridad: 1, tipo: ritmo * diasMes < metaMensual * 0.8 ? 'riesgo' : 'dato', area: 'caja', icono: '💰',
        titulo: `Meta: faltan ${fmtK(falta)} en ${quedan} días`,
        texto: `Van ${fmtK(cash)} (${pct(pctMeta)} de ${fmtK(metaMensual)}): hace falta ${fmtK(necesario)} por día y venís a ${fmtK(ritmo)}/día.`,
        accion: porCobrarMes > 0
          ? `Cobrá los ${fmtK(porCobrarMes)} pendientes del mes y empujá los seguimientos calientes para cerrar esta semana.`
          : 'Empujá los seguimientos calientes para cerrar esta semana.',
      })
    } else {
      add({ id: `meta-ok-${idm}`, prioridad: 1, tipo: 'oportunidad', area: 'caja', icono: '🏆', titulo: 'Meta del mes cumplida', texto: `Van ${fmtK(cash)}, el ${pct(pctMeta)} de la meta.`, accion: 'Aprovechá el envión: subí presupuesto al embudo que mejor rinde.' })
    }
    // Misma altura del mes anterior (Registro de Pagos, por fecha de pago)
    if (m > 0) {
      const aLaFecha = (i: number) => tx.filter(t => t.date?.startsWith(ym(i)) && Number(t.date.slice(8, 10)) <= diaHoy).reduce((a, t) => a + (t.amount || 0), 0)
      const antes = aLaFecha(m - 1), ahora = aLaFecha(m)
      if (antes > 0) {
        const dif = (ahora - antes) / antes * 100
        add({
          id: `ritmo-vs-prev-${idm}`, prioridad: dif <= -20 ? 2 : 3, tipo: dif <= -20 ? 'riesgo' : 'dato', area: 'caja', icono: dif >= 0 ? '📈' : '📉',
          titulo: `Ritmo vs ${mesPrev}: ${dif >= 0 ? '+' : ''}${dif.toFixed(0)}%`,
          texto: `Al día ${diaHoy} de ${mesPrev} llevabas ${fmtK(antes)}; hoy ${fmtK(ahora)}.`,
          accion: dif <= -20 ? 'Revisá qué embudo se frenó (abajo) antes de que cierre el mes.' : undefined,
        })
      }
    }
  } else {
    const dif = cashPrev ? (cash - cashPrev) / cashPrev * 100 : null
    add({
      id: `cierre-mes-${idm}`, prioridad: 2, tipo: 'dato', area: 'caja', icono: '💰',
      titulo: `${mes} cerró en ${fmtK(cash)}`,
      texto: `Fue el ${pct(pctMeta)} de la meta${dif != null ? ` y ${dif >= 0 ? '+' : ''}${dif.toFixed(0)}% vs ${mesPrev} (${fmtK(cashPrev!)})` : ''}.`,
    })
  }

  // ═════════════════════ 2) EMBUDOS ═════════════════════
  // Con datos incompletos del mes no se juzga ningún embudo (ya salió el aviso arriba)
  if (!datosIncompletos) {
    interface Embudo { key: string; nombre: string; ratio: Serie; ads?: Serie; agendas: (i: number) => number; canal: string }
    const porCanal = (canal: string) => (i: number) => callsMes(i).filter(c => c.channel === canal).length
    // Retargeting es un embudo más, con las mismas reglas (gasto mínimo, escalar, revisar, costo por
    // agenda). No tiene leads propios (el público sale de las visitas del VSL), y el analista no usa leads.
    const embudos: Embudo[] = [
      { key: 'vsl', nombre: 'VSL', ratio: r.monthlyFeccuCacVSL, ads: r.monthlyAdsVSL, agendas: i => v(r.monthlyVSL, i) ?? porCanal('vsl')(i), canal: 'vsl' },
      { key: 'fm', nombre: 'IG/FM', ratio: r.monthlyFeccuCacFM, ads: r.monthlyAdsFM, agendas: i => v(r.monthlyIG, i) ?? porCanal('ig')(i), canal: 'ig' },
      { key: 'retargeting', nombre: 'Retargeting', ratio: r.monthlyFeccuCacRetargeting, ads: r.monthlyAdsRetargeting, agendas: i => v(r.monthlyRetargeting, i) ?? porCanal('retargeting')(i), canal: 'retargeting' },
      { key: 'uruguay', nombre: 'VSL Uruguay', ratio: r.monthlyFeccuCacUruguay, ads: r.monthlyAdsUruguay, agendas: porCanal('uruguay'), canal: 'uruguay' },
      { key: 'webinar', nombre: 'Webinar', ratio: r.monthlyFeccuCacWebinar, ads: r.monthlyAdsWebinar, agendas: porCanal('webinar'), canal: 'webinar' },
    ]
    const mesRef = mesMaduro ? m : m - 1
    // Ratio de un mes, null si ese mes tiene datos incompletos
    const ratioMes = (e: Embudo, i: number) => incompleto(i) ? null : v(e.ratio, i)
    // Gasto mínimo para tomar el ratio como señal ($30 de ads no dicen nada):
    // mes cerrado ≥ $500 · mes en curso proyectado ≥ $1.000. Sin serie de gasto no se puede validar.
    const muestraOk = (e: Embudo, i: number) => {
      const a = v(e.ads, i)
      if (a == null || i < 0) return false
      return i === mesHoy ? (diaHoy > 0 ? a / (diaHoy / new Date(anio, i + 1, 0).getDate()) : 0) >= 1000 : a >= 500
    }
    // Gasto 'otros' = total − VSL − FM − retargeting − webinar − uruguay: campañas que no son de ningún
    // embudo (pre-call "hammer", nombres genéricos). Si /api/raw no trae retargeting/webinar/uruguay por
    // separado quedan adentro: es una cota alta (conservadora).
    const otrosAds = (i: number) => Math.max(0,
      (v(r.monthlyAds, i) ?? 0) - (v(r.monthlyAdsVSL, i) ?? 0) - (v(r.monthlyAdsFM, i) ?? 0) - (v(r.monthlyAdsRetargeting, i) ?? 0)
      - (v(r.monthlyAdsWebinar, i) ?? 0) - (v(r.monthlyAdsUruguay, i) ?? 0))
    // Gasto mínimo para que un mes cuente como "con anuncios" en las reglas de 0 ventas / revisar
    // (con $3 de gasto residual no se puede decir que un embudo "no vende")
    const GASTO_MIN = 300
    const resumenEmbudo: { key: string; nombre: string; ratio: number | null; costoCierre: number | null; cierres: number; ocurridas: number; tasaCierre: number | null; muestra: boolean }[] = []

    for (const e of embudos) {
      const ads = v(e.ads, m) ?? 0
      const ratio = ratioMes(e, m)
      // El mes anterior solo se cita / compara si tuvo gasto suficiente (un 2x con $133 de gasto es ruido)
      const ratioPrevCrudo = ratioMes(e, m - 1)
      const ratioPrev = muestraOk(e, m - 1) ? ratioPrevCrudo : null
      const ratioRef = ratioMes(e, mesRef)       // el que decide si se puede recomendar subir
      const ag = e.agendas(m)
      const t = tasas(callsMes(m).filter(c => c.channel === e.canal))
      if (!ads && ratio == null && !ag) continue
      const cpa = ads > 0 && ag > 0 ? ads / ag : null
      const gastoMinimo = !e.ads || ads >= GASTO_MIN   // sin serie de gasto no se puede validar: no bloquea
      const costoCierre = ads > 0 && t.cierres > 0 ? ads / t.cierres : null
      resumenEmbudo.push({ key: e.key, nombre: e.nombre, ratio, costoCierre, cierres: t.cierres, ocurridas: t.ocurridas, tasaCierre: t.cierre, muestra: muestraOk(e, m) })

      // Gasto diario actual y el sugerido (+25%) para la acción de escalar
      const diario = ads > 0 ? ads / transcurridos : 0
      // Retargeting tiene techo: su público son las visitas del VSL, así que se sube mirando la frecuencia
      const techoRtg = e.key === 'retargeting' ? ' Ojo: el público sale de las visitas del VSL; si la frecuencia se dispara, no rinde más.' : ''
      const subir = (diario > 0
        ? `Subí el presupuesto 20–30%: de ${fmtUSD(diario)}/día a ${fmtUSD(diario * 1.2)}–${fmtUSD(diario * 1.3)}/día.`
        : 'Subí el presupuesto 20–30% y medí una semana.') + techoRtg

      // ¿Se puede recomendar subir? ratio ≥3 en el mes de referencia (el seleccionado si está maduro,
      // si no el último cerrado) y con gasto suficiente.
      const puedeSubir = ratioRef != null && ratioRef >= 3 && muestraOk(e, mesRef)

      // Gasto que cayó fuerte mientras el embudo rinde. El pico de referencia solo cuenta si ESE mes
      // rindió ≥3x (no tiene sentido "volver" a un gasto que no pagaba, ej. VSL junio $6.3K a 2.0x).
      const picos = [1, 2, 3]
        .map(k => ({ k, a: v(e.ads, m - k), rt: ratioMes(e, m - k) }))
        .filter((x): x is { k: number; a: number; rt: number } => x.a != null && x.rt != null && x.rt >= 3)
      const pico = picos.length ? picos.reduce((a, b) => b.a > a.a ? b : a) : null
      const picoPrev = pico?.a ?? 0
      const idxPico = pico?.k ?? 0
      const gastoCayo = puedeSubir && ads > 0 && picoPrev >= 1000 && proy(ads) <= picoPrev * 0.5
      // El ratio del pico se omite si ese mes ya se citó en la misma frase (no repetir "julio: 5.1x")
      const txtCaida = (mesesCitados: number[]) => gastoCayo
        ? ` y gastás ${fmtK(proy(ads))}/mes vs ${fmtK(picoPrev)} en ${MESES[m - idxPico]}${mesesCitados.includes(m - idxPico) ? '' : ` (${fmtX(ratioMes(e, m - idxPico)!)})`}`
        : ''

      const escala = mesMaduro && ratio != null && ratioPrev != null && ratio > 5 && ratioPrev > 5
        && muestraOk(e, m) && muestraOk(e, m - 1)
      // Mes muy nuevo: solo se sugiere mirar si el último mes cerrado también permite subir
      const escalarMirar = ratio != null && ratio > 5 && muestraOk(e, m) && (mesMaduro || puedeSubir)
      if (escala) {
        // Franja de oportunidad clara: >5x sostenido 2 meses
        add({
          id: `escalar-${e.key}-${idm}`, prioridad: 1, tipo: 'oportunidad', area: 'embudos', icono: '🚀',
          titulo: esMesActual ? `Escalá ${e.nombre}: ${fmtX(ratio)} sostenido` : `${e.nombre} en ${fmtX(ratio)} sostenido: zona de escalar`,
          texto: `${e.nombre} devuelve ${fmtX(ratio)} en ${MESES[m]} y ${fmtX(ratioPrev)} en ${mesPrev}${txtCaida([m, m - 1])}${cpa ? `; cada agenda cuesta ${fmtUSD(cpa)}` : ''}.`,
          accion: subir,
        })
      } else if (gastoCayo) {
        const refPrev = mesRef === m && ratioPrev != null ? ` (${mesPrev}: ${fmtX(ratioPrev)})` : ''
        add({
          id: `reactivar-${e.key}-${idm}`, prioridad: 1, tipo: 'oportunidad', area: 'embudos', icono: '⛽',
          titulo: `${e.nombre} rinde y le bajaste el gasto`,
          texto: `${e.nombre} devuelve ${fmtX(ratioRef!)} en ${MESES[mesRef]}${mesRef !== m ? ' (último mes cerrado)' : refPrev}${txtCaida(refPrev ? [mesRef, m - 1] : [mesRef])}${cpa ? `; cada agenda cuesta ${fmtUSD(cpa)}` : ''}.`,
          accion: `Volvé a subirlo de a 20–30% por semana: de ${fmtUSD(diario)}/día a ${fmtUSD(diario * 1.25)}/día.`,
        })
      } else if (escalarMirar) {
        add({
          id: `escalar-mirar-${e.key}-${idm}`, prioridad: mesMaduro ? 2 : 3, tipo: 'oportunidad', area: 'embudos', icono: '📈',
          titulo: `${e.nombre} en ${fmtX(ratio!)}: zona de escalar`,
          texto: `${e.nombre} devuelve ${fmtX(ratio!)} en ${MESES[m]}${ratioPrev != null ? ` (${mesPrev}: ${fmtX(ratioPrev)})` : ''}${cpa ? `, ${fmtUSD(cpa)} por agenda` : ''}.`,
          accion: esMesActual ? `Si sigue arriba de 5x una semana más, ${subir.charAt(0).toLowerCase()}${subir.slice(1)}` : subir,
        })
      } else if (ratio != null && ratio > 5 && !muestraOk(e, m)) {
        // Ratio altísimo con poco gasto = muestra chica, no señal de escalar
        add({
          id: `muestra-chica-${e.key}-${idm}`, prioridad: 3, tipo: 'dato', area: 'embudos', icono: '🔬',
          titulo: `${e.nombre} en ${fmtX(ratio)}: muestra chica`,
          texto: v(e.ads, m) != null
            ? `${e.nombre} devuelve ${fmtX(ratio)} pero con solo ${fmtK(ads)} de anuncios${esMesActual ? ' en lo que va del mes' : ''}: poco gasto para decidir.`
            : `${e.nombre} devuelve ${fmtX(ratio)} pero no hay gasto por embudo para validar la muestra.`,
        })
      } else if (ratio != null && ratio >= 3) {
        add({
          id: `mantener-${e.key}-${idm}`, prioridad: 3, tipo: 'dato', area: 'embudos', icono: '🟡',
          titulo: `${e.nombre} en ${fmtX(ratio)}: mantener`,
          texto: `${e.nombre} devuelve ${fmtX(ratio)}${cpa ? ` con ${fmtUSD(cpa)} por agenda` : ''}: franja de mantener (3–5x).`,
          accion: 'Mantené el presupuesto y optimizá anuncios (cortá los de CPL más alto).',
        })
      } else if (ratio === 0 && (!e.ads || e.key === 'webinar' || e.key === 'uruguay')) {
        // Webinar/Uruguay (o sin serie de gasto): ratio 0 (no null) = hubo anuncios y 0 de FECCU.
        // Solo cuenta con gasto mínimo ($300), también el mes anterior para decir "2 meses".
        // Es 0 de FECCU (al contado), no "sin ventas": puede haber cierres en cuotas (FECCP).
        const prevCero = ratioPrevCrudo === 0 && (!e.ads || (v(e.ads, m - 1) ?? 0) >= GASTO_MIN)
        if (mesMaduro && gastoMinimo) add({
          id: `sin-ventas-${e.key}-${idm}`, prioridad: 2, tipo: 'riesgo', area: 'embudos', icono: '🕳',
          titulo: `${e.nombre}: gasto con 0 de FECCU`,
          texto: `${e.nombre} ${e.ads ? `gastó ${fmtK(ads)} en anuncios` : 'tuvo anuncios'} en ${MESES[m]} y trajo 0 de FECCU (ventas al contado)${prevCero ? `, igual que en ${mesPrev}` : ''}.`,
          accion: prevCero ? `Pausá ${e.nombre} o cambiá la oferta: van 2 meses con gasto y 0 de FECCU.` : `Revisá si ${e.nombre} trae agendas calificadas antes de seguir pautando.`,
        })
      } else if (ratio != null && (ads > 0 || ratio > 0) && !mesMaduro && ratioPrev != null && ratioPrev >= 3) {
        // Mes muy nuevo: el ratio de pocos días es ruido y el último mes cerrado rindió → dato, no "revisar"
        add({
          id: `arranque-${e.key}-${idm}`, prioridad: 3, tipo: 'dato', area: 'embudos', icono: '⏳',
          titulo: `${e.nombre} arranca el mes en ${fmtX(ratio)}`,
          texto: `${e.nombre} va ${fmtX(ratio)} en ${diaHoy} días (${mesPrev}: ${fmtX(ratioPrev)}); con tan pocos días todavía es ruido.`,
        })
      } else if (ratio != null && (ads > 0 || ratio > 0) && gastoMinimo) {
        const gastoAlto = proy(ads) >= 1500
        const sostenido = ratioPrev != null && ratioPrev < 3
        add({
          id: `revisar-${e.key}-${idm}`, prioridad: gastoAlto && sostenido && mesMaduro ? 1 : 2, tipo: 'riesgo', area: 'embudos', icono: '🔻',
          titulo: `${e.nombre} en ${fmtX(ratio)}: revisar`,
          texto: `${e.nombre} devuelve ${fmtX(ratio)}${ads > 0 ? ` con ${fmtK(ads)} gastados` : ''}${ratioPrev != null ? `; en ${mesPrev}: ${fmtX(ratioPrev)}` : ''}.`,
          accion: sostenido && gastoAlto
            ? 'No sumes presupuesto: apagá los anuncios de peor CPL y renová creativos hasta volver a >3x.'
            : 'Revisá creativos y calidad de agendas antes de poner más plata.',
        })
      }

      // Costo por agenda: bajó mucho con volumen estable = señal de escalar; subió mucho = alerta
      // (si ya se recomendó escalar/reactivar este embudo no se repite: esa tarjeta ya dice el costo por agenda)
      if (cpa != null && ads >= 300 && !escala && !gastoCayo) {
        const cpasPrev = [1, 2, 3].map(k => { const a = v(e.ads, m - k), n = e.agendas(m - k); return a != null && a >= 1000 && n ? a / n : null })
        const cpaPrev = promedio(cpasPrev)
        const agPrev = promedio([1, 2, 3].map(k => { const n = e.agendas(m - k); return n || null }))
        if (cpaPrev && agPrev) {
          if (cpa <= cpaPrev * 0.75 && proy(ag) >= agPrev * 0.8) {
            const baja = `${((1 - cpa / cpaPrev) * 100).toFixed(0)}%`
            // Agendas baratas solo son franja para subir si además rinden: misma regla que escalar
            // (ratio de referencia ≥3 con gasto suficiente). Sin ratio o con muestra chica es solo un dato.
            const rinde = puedeSubir
            if (rinde) {
              const recorte = picoPrev >= 1000 && proy(ads) <= picoPrev * 0.6
              add({
                id: `cpa-baja-${e.key}-${idm}`, prioridad: recorte && mesMaduro ? 1 : 2, tipo: 'oportunidad', area: 'embudos', icono: '🎯',
                titulo: `${e.nombre}: agendas ${baja} más baratas`,
                texto: `Cada agenda de ${e.nombre} cuesta ${fmtUSD(cpa)} vs ${fmtUSD(cpaPrev)} de promedio, con volumen estable (${ag} agendas)` +
                  (recorte ? ` aunque gastás ${fmtK(proy(ads))}/mes vs ${fmtK(picoPrev)} en ${MESES[m - idxPico]}.` : '.'),
                accion: recorte ? subir : 'Es buen momento para subir presupuesto 20% y ver si el costo aguanta.',
              })
            } else if (ratioRef != null && ratioRef < 3) {
              add({
                id: `cpa-baja-${e.key}-${idm}`, prioridad: 3, tipo: 'dato', area: 'embudos', icono: '🎯',
                titulo: `${e.nombre}: agendas ${baja} más baratas`,
                texto: `Cada agenda de ${e.nombre} cuesta ${fmtUSD(cpa)} vs ${fmtUSD(cpaPrev)} de promedio, pero el FECCU:CAC está en ${fmtX(ratioRef!)}: agendas baratas que no se convierten en cash.`,
              })
            } else if (ratioRef == null || !muestraOk(e, mesRef)) {
              // Sin FECCU:CAC confiable todavía: se informa, sin recomendar subir
              add({
                id: `cpa-baja-${e.key}-${idm}`, prioridad: 3, tipo: 'dato', area: 'embudos', icono: '🎯',
                titulo: `${e.nombre}: agendas ${baja} más baratas`,
                texto: `Cada agenda de ${e.nombre} cuesta ${fmtUSD(cpa)} vs ${fmtUSD(cpaPrev)} de promedio (${ag} agendas), pero todavía no hay FECCU:CAC con gasto suficiente para saber si se convierten en cash.`,
              })
            }
          }
          else if (cpa >= cpaPrev * 1.4)
            add({
              id: `cpa-sube-${e.key}-${idm}`, prioridad: 2, tipo: 'riesgo', area: 'embudos', icono: '💸',
              titulo: `${e.nombre}: agendas ${((cpa / cpaPrev - 1) * 100).toFixed(0)}% más caras`,
              texto: `Cada agenda de ${e.nombre} cuesta ${fmtUSD(cpa)} vs ${fmtUSD(cpaPrev)} de promedio.`,
              accion: 'Renová creativos y apagá los anuncios con CPL más alto.',
            })
        }
      }
    }

    // Dónde se cierran las ventas (por canal, sobre agendas ocurridas) + dónde poner la plata
    {
      const conCierres = resumenEmbudo.filter(x => x.ocurridas >= 10 && x.tasaCierre != null).sort((a, b) => b.tasaCierre! - a.tasaCierre!)
      // Solo embudos con gasto suficiente para que el ratio sea señal
      const conRatio = resumenEmbudo.filter(x => x.ratio != null && x.ratio > 0 && x.muestra).sort((a, b) => b.ratio! - a.ratio!)
      if (mesMaduro && conRatio.length >= 2 && conRatio[0].ratio! >= conRatio[1].ratio! * 1.4 && conRatio[0].ratio! >= 3) {
        const [a, b] = conRatio
        add({
          id: `mover-plata-${idm}`, prioridad: 2, tipo: 'oportunidad', area: 'embudos', icono: '⚖️',
          titulo: `Cada dólar rinde más en ${a.nombre}`,
          texto: `${a.nombre} devuelve ${fmtX(a.ratio!)} vs ${fmtX(b.ratio!)} de ${b.nombre}${a.costoCierre ? `; cada cierre cuesta ${fmtK(a.costoCierre)}` : ''}.`,
          accion: `Si tenés que sumar presupuesto, ponelo en ${a.nombre} primero.`,
        })
      } else if (conCierres.length >= 2) {
        const [a, b] = conCierres
        add({
          id: `cierres-canal-${idm}`, prioridad: 3, tipo: 'dato', area: 'embudos', icono: '🎯',
          titulo: `Donde más se cierra: ${a.nombre}`,
          texto: `${a.nombre} cierra ${pct(a.tasaCierre!)} de las agendas ocurridas (${a.cierres}) vs ${pct(b.tasaCierre!)} de ${b.nombre} (${b.cierres}).`,
        })
      }
    }

    // Gasto "otros" = total − VSL − FM − retargeting − webinar − uruguay (el MISMO monto que usan las
    // otras tarjetas): campañas sin embudo (pre-call "hammer", nombres genéricos) que no entran en
    // ningún FECCU:CAC. Un /api/raw viejo sin retargeting por separado lo deja adentro de 'otros'.
    {
      const total = v(r.monthlyAds, m) ?? 0
      const otros = otrosAds(m)
      if (total > 0 && otros >= 500 && otros / total >= 0.15) {
        const rtgAparte = Array.isArray(r.monthlyAdsRetargeting)
        add({
          id: `ads-otros-${idm}`, prioridad: otros / total >= 0.25 ? 2 : 3, tipo: 'dato', area: 'embudos', icono: '🔁',
          titulo: `${fmtK(otros)} en anuncios sin embudo`,
          texto: rtgAparte
            ? `El ${pct(otros / total * 100)} del gasto es de campañas que no son de VSL, FM, Retargeting, Webinar ni Uruguay (ej. pre-call) y no entra en ningún FECCU:CAC por embudo.`
            : `El ${pct(otros / total * 100)} del gasto (retargeting y campañas sin embudo) no entra en ningún FECCU:CAC por embudo.`,
          accion: 'Si una campaña es de un embudo, poné el embudo en su nombre ("vsl", "fm", "retargeting", "webinar" o "uruguay") para que se mida ahí.',
        })
      }
    }
  }

  // ═════════════════════ 3) VENTAS ═════════════════════
  {
    const t = tasas(callsMes(m))
    // El mes anterior solo se compara si tuvo muestra (≥10 ocurridas con registro): 6 agendas con 0% no dicen nada
    const tpCruda = m > 0 ? tasas(callsMes(m - 1)) : null
    const tp = tpCruda && tpCruda.ocurridas >= 10 ? tpCruda : null
    if (t.ocurridas >= 10 && t.cierre != null && t.showUp != null) {
      const dCierre = tp?.cierre != null ? t.cierre - tp.cierre : null
      const dShow = tp?.showUp != null ? t.showUp - tp.showUp : null
      const malo = (dCierre != null && dCierre <= -3) || (dShow != null && dShow <= -8)
      const bueno = (dCierre != null && dCierre >= 2) && (dShow == null || dShow > -5)
      add({
        id: `tasas-${idm}`, prioridad: malo ? 2 : 3, tipo: malo ? 'riesgo' : bueno ? 'oportunidad' : 'dato', area: 'ventas', icono: malo ? '📉' : '📞',
        titulo: `Cierre ${pct(t.cierre)} · show-up ${pct(t.showUp)}`,
        texto: `${plural(t.cierres, 'cierre')} sobre ${t.ocurridas} agendas ocurridas${t.sinRegistro ? ` con registro (${t.sinRegistro} sin registrar)` : ''}${tp?.cierre != null ? `; en ${mesPrev}: cierre ${pct(tp.cierre)}, show-up ${pct(tp.showUp ?? 0)}` : ''}.`,
        accion: malo
          ? (dShow != null && dShow <= -8 ? 'Reforzá confirmaciones y recordatorios de agenda (show-up en baja).' : 'Revisá llamadas grabadas y objeciones con los closers (cierre en baja).')
          : undefined,
      })
    }

    // Closers: quién cierra y quién no (mínimo 15 agendas ocurridas para opinar)
    const porCloser: Record<string, CallV[]> = {}
    for (const c of callsMes(m)) { const k = c.closer || '?'; (porCloser[k] ??= []).push(c) }
    const closers = Object.entries(porCloser).map(([n, cs]) => ({ n, ...tasas(cs) })).filter(x => x.ocurridas >= 15 && x.cierre != null).sort((a, b) => b.cierre! - a.cierre!)
    if (closers.length >= 2) {
      // El "mejor" (modelo a copiar) tiene que tener ≥3 cierres: 2 de 16 es suerte, no método
      const peor = closers[closers.length - 1]
      const modelo = closers.find(x => x.cierres >= 3 && x !== peor)
      const mejor = modelo ?? closers[0]
      const brecha = !!modelo && peor.cierre! < mejor.cierre! / 2
      add({
        id: `closers-${idm}`, prioridad: brecha && peor.ocurridas >= 25 ? 2 : 3, tipo: brecha ? 'riesgo' : 'dato', area: 'ventas', icono: '🧑‍💼',
        titulo: `Closers: ${mejor.n} ${pct(mejor.cierre!)} vs ${peor.n} ${pct(peor.cierre!)}`,
        texto: `${mejor.n} cerró ${mejor.cierres} de ${mejor.ocurridas} agendas ocurridas y ${peor.n} ${peor.cierres} de ${peor.ocurridas}${modelo ? '' : ' (muestra chica: nadie llega a 3 cierres)'}.`,
        accion: brecha ? `Hacé role-play de ${peor.n} con las llamadas de ${mejor.n} esta semana.` : undefined,
      })
    }

    // Setter (Maite): % de asignados que agenda (serie en proporción 0–1; solo con volumen real)
    const asig = v(r.monthlyAsignadosSetter, m), tasaS = v(r.monthlyTasaAgendaSetter, m)
    if (asig != null && asig >= 50 && tasaS != null) {
      const pS = tasaS <= 1 ? tasaS * 100 : tasaS
      const asigP = v(r.monthlyAsignadosSetter, m - 1), tasaP = v(r.monthlyTasaAgendaSetter, m - 1)
      // Solo contra un mes medido con el mismo método (etiqueta de ManyChat vs filas vivas de "Setter IG")
      const mismoMetodo = m > 0 && metodoSetter(anio, m) === metodoSetter(anio, m - 1)
      const pP = mismoMetodo && asigP != null && asigP >= 50 && tasaP != null ? (tasaP <= 1 ? tasaP * 100 : tasaP) : null
      add({
        id: `setter-${idm}`, prioridad: 3, tipo: 'dato', area: 'ventas', icono: '💬',
        titulo: `Setter agenda el ${pct(pS)} de asignados`,
        texto: `Maite agendó el ${pct(pS)} de ${Math.round(asig)} leads asignados${pP != null ? ` (${mesPrev}: ${pct(pP)})` : ''}.`,
      })
    }

    // Calidad de leads por letra: qué letras traen la plata
    const letras: Record<string, { ag: number; cierres: number; cash: number }> = {}
    for (const c of callsMes(m)) { if (!c.letra) continue; const l = (letras[c.letra] ??= { ag: 0, cierres: 0, cash: 0 }); l.ag++; if (c.closed) l.cierres++; l.cash += c.cash || 0 }
    const totalAg = Object.values(letras).reduce((a, x) => a + x.ag, 0)
    if (totalAg >= 20) {
      const cd = ['C', 'D', 'E'].reduce((a, k) => a + (letras[k]?.ag ?? 0), 0)
      const cdCierres = ['C', 'D', 'E'].reduce((a, k) => a + (letras[k]?.cierres ?? 0), 0)
      const ab = ['A', 'B'].reduce((a, k) => a + (letras[k]?.ag ?? 0), 0)
      const abCierres = ['A', 'B'].reduce((a, k) => a + (letras[k]?.cierres ?? 0), 0)
      const cashAB = ['A', 'B'].reduce((a, k) => a + (letras[k]?.cash ?? 0), 0)
      const cashTot = Object.values(letras).reduce((a, x) => a + x.cash, 0)
      const shareCD = cd / totalAg * 100
      const malo = shareCD >= 50 && cdCierres <= 1
      add({
        id: `letras-${idm}`, prioridad: malo ? 2 : 3, tipo: malo ? 'riesgo' : 'dato', area: 'ventas', icono: '🔤',
        titulo: `Leads A/B cierran ${ab ? pct(abCierres / ab * 100) : '—'}, C/D/E ${cd ? pct(cdCierres / cd * 100) : '—'}`,
        texto: `El ${pct(shareCD)} de las agendas son C/D/E${cashTot > 0 ? ` y los A/B traen el ${pct(cashAB / cashTot * 100)} del cash` : ''}.`,
        accion: malo ? 'Filtrá C/D/E antes de la agenda (formulario o setter) para liberar a los closers.' : undefined,
      })
    }
  }

  // ═════════════════════ 4) BACKEND ═════════════════════
  {
    const men = r.backend?.mensual
    const becc = v(r.monthlyBECC, m)
    const beccPct = v(men?.beccPct, m) ?? (becc != null && cash > 0 ? becc / cash * 100 : null)
    if (beccPct != null && !datosIncompletos) {   // sin categorías confiables el BECC % tampoco lo es
      const bajo = beccPct < 10
      add({
        id: `becc-${idm}`, prioridad: bajo && mesMaduro ? 2 : 3, tipo: bajo ? 'riesgo' : 'dato', area: 'backend', icono: bajo ? '🔁' : '✅',
        titulo: `BECC ${pct(beccPct)} del cash (meta 10%)`,
        texto: `El backend (renovaciones y upsells) trajo ${becc != null ? fmtK(becc) : pct(beccPct)} este mes${bajo ? ', por debajo del 10%' : ''}.`,
        accion: bajo ? 'Agendá llamadas de proyección con los que vencen y ofrecé renovación.' : undefined,
      })
    }

    const bajas = v(men?.bajas, m) ?? v(r.backend?.crm?.churnBajas, m)
    const activos = v(men?.activosInicio, m) ?? v(r.backend?.crm?.churnActivosInicio, m)
    const churn = v(men?.churn, m) ?? (bajas != null && activos != null && activos >= 3 ? bajas / activos * 100 : null)
    const renov = v(men?.renovaciones, m) ?? v(r.backend?.crm?.churnRenov, m)
    if (churn != null && bajas != null) {
      const alto = churn >= 10
      // Mes en curso: las bajas FINALIZADO/INACTIVO sin "Fecha de baja" (col V de Agencia) y con fin futuro
      // se imputan a HOY → caen todas en este mes aunque se hayan ido antes. Se avisa y, si son la
      // mayoría, no se sube a P1 (el número depende de un dato sin cargar).
      const sinFechaBaja = esMesActual ? Math.min(r.backend?.crm?.bajasSinFecha ?? 0, bajas) : 0
      const mayoriaImputada = sinFechaBaja > 0 && sinFechaBaja * 2 >= bajas
      // Mes cerrado: esas mismas bajas sin fecha se cuentan en el mes en curso → este mes puede quedar corto
      const sinFechaFuera = !esMesActual && m < mesHoy ? (r.backend?.crm?.bajasSinFecha ?? 0) : 0
      const prioridadChurn: 1 | 2 | 3 = churn >= 15 && bajas >= 5 ? 1 : alto ? 2 : 3
      add({
        id: `churn-${idm}`, prioridad: mayoriaImputada && prioridadChurn === 1 ? 2 : prioridadChurn, tipo: alto ? 'riesgo' : 'dato', area: 'backend', icono: '🚪',
        titulo: `Churn ${pct(churn)}: ${plural(bajas, 'baja')}${renov != null ? `, ${plural(renov, 'renovación', 'renovaciones')}` : ''}`,
        texto: `${bajas === 1 ? 'Se fue 1' : `Se fueron ${bajas}`} de ${activos ?? '?'} clientes activos a inicio de ${MESES[m]}${renov != null ? ` y ${renov === 1 ? 'renovó 1' : `renovaron ${renov}`}` : ''}.`
          + (sinFechaBaja > 0 ? ` ${sinFechaBaja === bajas ? `Ninguna tiene` : sinFechaBaja === 1 ? `1 no tiene` : `${sinFechaBaja} no tienen`} "Fecha de baja" en el CRM: se cuentan hoy aunque se hayan ido antes.` : '')
          + (sinFechaFuera > 0 ? ` Ojo: ${sinFechaFuera === 1 ? 'hay 1 baja' : `hay ${sinFechaFuera} bajas`} sin "Fecha de baja" en el CRM que se cuentan en el mes en curso; este mes puede estar subestimado.` : ''),
        accion: mayoriaImputada ? 'Cargá la "Fecha de baja" (col V de Agencia) de los finalizados/inactivos para ubicar cada baja en su mes.'
          : alto ? 'Llamá a los que vencen en 14 días antes de que se den de baja.' : undefined,
      })
    }

    if (esMesActual) {
      // Cobros vencidos: plata ya vendida que no entró
      if (vencidoCobro > 0) {
        const venc = pendientes.filter(p => p.dias < 0).sort((a, b) => b.saldo - a.saldo)
        add({
          id: `cobros-vencidos-${idm}`, prioridad: vencidoCobro >= 3000 ? 1 : 2, tipo: 'riesgo', area: 'backend', icono: '💵',
          titulo: `${fmtK(vencidoCobro)} en cobros vencidos`,
          texto: `${venc.length} cliente${venc.length > 1 ? 's deben' : ' debe'} cuotas vencidas: ${nombres(venc.map(p => `${nombreCorto(p.nombre)} ${fmtK(p.saldo)}`))}.`,
          accion: 'Cobralos hoy: es cash que ya está vendido.',
        })
      }
      const sinFecha = r.alertas?.pagosSinFecha
      if (sinFecha && sinFecha.cantidad > 0 && sinFecha.total >= 2000)
        add({
          id: `cobros-sin-fecha-${idm}`, prioridad: 3, tipo: 'dato', area: 'backend', icono: '🗓',
          titulo: `${fmtK(sinFecha.total)} de deuda sin fecha`,
          texto: `${sinFecha.cantidad === 1 ? '1 cliente debe' : `${sinFecha.cantidad} clientes deben`} saldo sin fecha de próximo cobro en el CRM.`,
          accion: 'Cargá la fecha de cobro en el CRM para que entre en el seguimiento.',
        })

      // Renovaciones: clientes por vencer = oportunidad de backend
      const porVencer = r.alertas?.porVencer ?? []
      const sinLlamada = porVencer.filter(p => !p.llamada)
      if (sinLlamada.length)
        add({
          id: `por-vencer-${idm}`, prioridad: sinLlamada.length >= 5 ? 1 : 2, tipo: 'oportunidad', area: 'backend', icono: '🔄',
          titulo: `${sinLlamada.length} por vencer sin llamada`,
          texto: `${porVencer.length === 1 ? '1 cliente vence' : `${porVencer.length} clientes vencen`} en ≤14 días y ${sinLlamada.length === porVencer.length
            ? (porVencer.length === 1 ? 'no tiene' : 'ninguno tiene')
            : sinLlamada.length === 1 ? '1 no tiene' : `${sinLlamada.length} no tienen`} llamada de proyección: ${nombres(sinLlamada.map(p => nombreCorto(p.nombre)))}.`,
          accion: 'Agendá las llamadas de proyección esta semana: cada renovación es BECC.',
        })
      const vencidosSin = (r.alertas?.vencidos ?? []).filter(x => !x.llamada)
      // Llamada de la col U con fecha ya pasada y sin resultado cargado (ni renovación ni baja)
      const vencidosSinRes = (r.alertas?.vencidos ?? []).filter(x => x.llamada && x.llamadaPasada)
      if (vencidosSin.length || vencidosSinRes.length) {
        const n = vencidosSin.length + vencidosSinRes.length
        const txtSin = vencidosSin.length
          ? `${nombres(vencidosSin.map(x => `${nombreCorto(x.nombre)} (${x.dias}d)`))} ${vencidosSin.length > 1 ? 'ya vencieron y nadie los llamó' : 'ya venció y nadie lo llamó'}`
          : ''
        const txtRes = vencidosSinRes.length
          ? `${nombres(vencidosSinRes.map(x => `${nombreCorto(x.nombre)} (${x.dias}d)`))} ${vencidosSinRes.length > 1 ? 'tuvieron' : 'tuvo'} la llamada y no hay resultado cargado`
          : ''
        add({
          id: `vencidos-sin-llamada-${idm}`, prioridad: 2, tipo: 'riesgo', area: 'clientes', icono: '⏰',
          titulo: vencidosSin.length && vencidosSinRes.length
            ? `Vencidos: ${vencidosSin.length} sin llamada, ${vencidosSinRes.length} sin resultado`
            : vencidosSin.length ? `${vencidosSin.length} con programa vencido sin llamada` : `${vencidosSinRes.length} vencidos sin resultado de llamada`,
          texto: `${cap([txtSin, txtRes].filter(Boolean).join('; '))}.`,
          accion: vencidosSin.length
            ? `${n > 1 ? 'Llamalos' : 'Llamalo'} hoy para renovar o cerrar bien el servicio${vencidosSinRes.length ? ' y cargá el resultado de las llamadas hechas' : ''}.`
            : 'Cargá en el CRM el resultado de esas llamadas (renovó o se da de baja).',
        })
      }
    }
  }

  // ═════════════════════ 5) CLIENTES Y OPERACIONES (foto de hoy) ═════════════════════
  if (esMesActual) {
    const meta = r.alertas?.metaClientes
    if (meta?.disponible) {
      const cuentas = (meta.cuentas ?? []).filter(c => !c.pausadoCRM)
      const conError = cuentas.filter(c => c.estado === 'error_pago')
      const enGracia = cuentas.filter(c => c.enGracia && c.estado !== 'error_pago')
      const sinTarjeta = cuentas.filter(c => c.sinMedioPago && c.estado !== 'error_pago' && !c.enGracia)
      const nom = (c: CuentaMetaV) => c.clienteCRM ? nombreCorto(c.clienteCRM) : c.nombre.replace(/^usd\s+/i, '')
      if (conError.length || enGracia.length)
        add({
          id: `meta-pagos-${idm}`, prioridad: 2, tipo: 'riesgo', area: 'clientes', icono: '💳',
          titulo: `Meta: ${conError.length} con error de pago${enGracia.length ? `, ${enGracia.length} por caer` : ''}`,
          texto: `${[...conError, ...enGracia].length === 1 ? '1 cuenta de cliente no puede pautar o va a cortar' : `${[...conError, ...enGracia].length} cuentas de clientes no pueden pautar o van a cortar`}: ${nombres([...conError, ...enGracia].map(nom), 4)}.`,
          accion: 'Avisales hoy que carguen o cambien la tarjeta en Meta.',
        })
      // Se cuentan CLIENTES (un cliente puede tener 2 cuentas: Otamendi) para que el título cuadre con los nombres
      const clientesSin = [...new Set(sinTarjeta.map(nom))]
      if (clientesSin.length)
        add({
          id: `meta-sin-tarjeta-${idm}`, prioridad: 3, tipo: 'dato', area: 'clientes', icono: '💳',
          titulo: `${plural(clientesSin.length, 'cliente')} sin medio de pago en Meta`,
          texto: `${nombres(clientesSin)} ${clientesSin.length > 1 ? 'no tienen' : 'no tiene'} tarjeta cargada.`,
          accion: 'Pediles que carguen una tarjeta antes de lanzar campañas.',
        })
    }

    const rojos = r.clickup?.disponible ? (r.clickup.nombresRojo ?? []) : []
    if (rojos.length)
      add({
        id: `clickup-rojo-${idm}`, prioridad: 2, tipo: 'riesgo', area: 'clientes', icono: '🔴',
        titulo: `${rojos.length} cliente${rojos.length > 1 ? 's' : ''} en rojo`,
        texto: `${nombres(rojos)} ${rojos.length > 1 ? 'están' : 'está'} en rojo en ClickUp.`,
        accion: `${rojos.length > 1 ? 'Llamalos' : 'Llamalo'} esta semana antes de que sea una baja.`,
      })

    // Grabaciones: tolera el formato viejo ({dias}) y el nuevo ({diasDesdeGrabacion, guionesListos})
    const grab = r.grabaciones ?? []
    const diasGrab = (g: GrabV) => g.diasDesdeGrabacion ?? g.dias ?? null
    // Fuera del seguimiento: nota "no mandar/no grabar/pausa/baja" (inactiva), alias sin resolver
    // (no se sabe de quién es) y clientes con el programa vencido (no se graba para alguien que se va)
    const inactiva = (g: GrabV) => g.inactiva ?? NOTA_INACTIVA.test(g.nota ?? '')
    const vencidosN = new Set((r.alertas?.vencidos ?? []).map(x => normNombre(x.nombre)))
    const activa = (g: GrabV) => !inactiva(g) && !g.aliasSinResolver && !vencidosN.has(normNombre(g.cliente))
    const atrasadas = grab.filter(g => { const d = diasGrab(g); return d != null && d > 30 && activa(g) })
    // Con la grabación ya agendada (nota "agendada 30/9") no hay nada que coordinar
    const esperando = grab.filter(g => g.guionesListos && (g.diasEsperando ?? 0) > 7 && !/^agendada/i.test(g.nota ?? '') && activa(g))
      .sort((a, b) => (b.diasEsperando ?? 0) - (a.diasEsperando ?? 0))
    if (atrasadas.length || esperando.length)
      add({
        id: `grabaciones-${idm}`, prioridad: atrasadas.length + esperando.length >= 5 ? 2 : 3, tipo: 'riesgo', area: 'operaciones', icono: '🎥',
        titulo: [atrasadas.length ? `${atrasadas.length} sin grabar +30d` : '', esperando.length ? `${esperando.length} con guiones esperando` : ''].filter(Boolean).join(', '),
        texto: atrasadas.length
          ? `${nombres(atrasadas.sort((a, b) => (diasGrab(b) ?? 0) - (diasGrab(a) ?? 0)).map(g => `${nombreCorto(g.cliente)} (${diasGrab(g)}d)`))} ${atrasadas.length > 1 ? 'no graban' : 'no graba'} hace más de un mes.`
          : `${nombres(esperando.map(g => `${nombreCorto(g.cliente)} (${g.diasEsperando}d)`))} ${esperando.length > 1 ? 'tienen' : 'tiene'} guiones listos sin grabar.`,
        accion: 'Coordiná las grabaciones pendientes esta semana: sin videos no hay campañas.',
      })

    const onbLargo = (r.alertas?.onboarding ?? []).filter(o => o.dias > 30).sort((a, b) => b.dias - a.dias)
    if (onbLargo.length)
      add({
        id: `onboarding-${idm}`, prioridad: onbLargo.length >= 3 ? 2 : 3, tipo: 'riesgo', area: 'operaciones', icono: '🐢',
        titulo: `${onbLargo.length} en onboarding hace +30 días`,
        texto: `${nombres(onbLargo.map(o => `${nombreCorto(o.nombre)} (${o.dias}d, ${o.status})`))}.`,
        accion: 'Destrabá la etapa de cada uno: un cliente sin campaña activa es un churn en camino.',
      })
  }

  // Mes cerrado: se informa, no se ordena (no hay nada que "hacer" en junio). Solo queda la acción
  // de completar datos, que sigue sirviendo para que el mes se pueda leer bien.
  if (!esMesActual) for (const h of hs) if (!h.id.startsWith('datos-incompletos-')) delete h.accion

  // ── Orden y resumen ─────────────────────────────────────────────────────
  const ordenArea: Record<Hallazgo['area'], number> = { caja: 0, embudos: 1, ventas: 2, backend: 3, clientes: 4, operaciones: 5 }
  const ordenTipo: Record<Hallazgo['tipo'], number> = { oportunidad: 0, riesgo: 1, dato: 2 }
  const hallazgos = hs
    .map((h, i) => ({ h, i }))
    .sort((a, b) => a.h.prioridad - b.h.prioridad || (a.h.area === 'caja' ? -1 : b.h.area === 'caja' ? 1 : 0) || ordenTipo[a.h.tipo] - ordenTipo[b.h.tipo] || ordenArea[a.h.area] - ordenArea[b.h.area] || a.i - b.i)
    .map(x => x.h)

  const foco = hallazgos.find(h => h.prioridad === 1 && h.area !== 'caja') ?? hallazgos.find(h => h.area !== 'caja' && h.tipo !== 'dato')
  const cabeza = datosIncompletos
    ? `${mes}: datos incompletos en el Registro de Pagos (${fmtK(cash)} de cash cargado)`
    : esMesActual
    ? `${mes}: ${fmtK(cash)} de ${fmtK(metaMensual)} (${pct(pctMeta)})${cash < metaMensual ? ` · faltan ${fmtK(metaMensual - cash)} en ${quedan} días` : ' · meta cumplida'}`
    : `${mes} cerró en ${fmtK(cash)} (${pct(pctMeta)} de la meta)`
  const resumen = foco ? `${cabeza}. Foco: ${foco.titulo}.` : `${cabeza}.`

  return { resumen, hallazgos }
}
