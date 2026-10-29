// ── Extracción de la ficha de kickoff con Claude ─────────────────────────────────────────────────
// Una llamada (claude.ts: Opus 5.5, thinking adaptativo, esfuerzo "high", salida estructurada, streaming, fallback del
// servidor) con el prompt de prompt.ts y la llamada en el mensaje de usuario. El JSON Schema obliga a la forma, pero igual se
// valida TODO a la vuelta (validarSalida), porque la ficha reemplaza la tarjeta de ClickUp y de ahí salen los guiones y la
// campaña:
//   · timestamp mal formado o fuera de la llamada → null (sin link; no se busca "el más cercano"); vacío → null sin aviso;
//   · cita de más de 25 palabras → se recorta; cita que no aparece tal cual en la transcripción → textual: false; cita que
//     está en la transcripción pero no en el renglón de su timestamp (ni en el de al lado) → anotado en ajustes;
//   · aprox: Fathom junta renglones de hasta 2 minutos, así que se estima el segundo de la cita interpolando su posición
//     dentro del renglón entre el timestamp de ese renglón y el del siguiente (el link va con "≈"; el timestamp queda igual);
//   · cliente_crm / id_crm que no están en la lista del CRM → null ("sin verificar"); si el mail del invitado externo
//     coincide con UN solo cliente del CRM, gana ese (cruce determinista, queda como: 'email');
//   · rama desconocida → null; números negativos o absurdos → null; el portfolio siempre trae los 7 ítems fijos;
//   · el país de la zona lo pone el código (paisDeTexto sobre la zona: provincias argentinas, Uruguay…), no Claude.
// Lo que se corrige queda en "ajustes" (va al registro y a la vista para revisar).
import { acotar, RE_TIMESTAMP } from '@/lib/fathomAnuncios/tipos'
import { fechaLargaAR, segundos, type Transcripcion } from '@/lib/fathomAnuncios/transcripcion'
import { normNombre } from '@/lib/fathomAnuncios/contexto'
import { llamarClaude, esfuerzoDe, TOPE_CLAUDE_MS } from './claude'
import { PROMPT_SISTEMA } from './prompt'
import { normalizarPresupuesto, normalizarRama, quienGrabo } from './ficha'
import { paisDeTexto } from './ganadores'
import {
  ESTADOS_PORTFOLIO, ITEMS_PORTFOLIO, RAMAS, TIPOS_REUNION,
  type Acuerdo, type ChequeoPortfolio, type ClienteCRMKickoff, type ClienteFicha, type Evidencia, type EstadoPortfolio,
  type ExtraccionKickoff, type ItemConEvidencia, type ItemPortfolio, type ResultadoExtraccionKickoff, type ReunionFathom, type TipoReunion,
} from './tipos'

// ── JSON Schema de la salida (additionalProperties false y todo en required, como pide la salida estructurada) ──
// Ojo con el tamaño: la API compila el schema a una gramática y rechaza las muy grandes ("The compiled grammar is too
// large", 400). Lo que la agranda son las uniones con null y los objetos repetidos. Por eso (probado contra la API el
// 24/10 con max_tokens 1): ningún campo es nullable ("" = no se dijo; los montos y el radio van como texto, "8" o "8.5",
// y se pasan a número en validarSalida) y los objetos de los arreglos van una sola vez en $defs, por referencia.
// k2 (24/10): el schema de k1 ya estaba JUSTO en el límite (sumarle un solo campo a zona daba 400). Lo que lo hizo entrar:
// la cita y el timestamp van juntos en UN campo, evidencia = "[HH:MM:SS] cita" (se separan en validarSalida), también la
// de presentarse_como (presentarse_evidencia) y la del mensual (evidencia_mes). El país no se le pide a Claude: lo deduce
// el código de la zona (paisDeTexto). Queda margen para ~1 campo de texto más: probar contra la API antes de sumar otro.
const str = { type: 'string' } as const
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props })
const ev = { evidencia: str }
const ref = (nombre: string) => ({ type: 'array', items: { $ref: `#/$defs/${nombre}` } })

export const SCHEMA_FICHA = {
  ...obj({
    tipo_reunion: { type: 'string', enum: [...TIPOS_REUNION] },
    resumen_corto: str,
    cliente: obj({ nombre_escuchado: str, apodo: str, cliente_crm: str, id_crm: str }),
    rama: obj({ principal: { type: 'string', enum: [...RAMAS, 'ninguna'] }, texto: str, ...ev, subramas: ref('item'), descartadas: ref('descartada'), a_futuro: ref('item') }),
    avatar: obj({ incluye: ref('item'), excluye: ref('item') }),
    zona: obj({
      descripcion: str, lugares: { type: 'array', items: str }, radio_km: str,
      presentarse_como: str, presentarse_cuando: str, presentarse_evidencia: str,
      contexto: ref('item'), mapa_en_pantalla: { type: 'boolean' }, ...ev,
    }),
    presupuesto: obj({
      usd_dia_min: str, usd_dia_max: str, usd_mes: str, moneda: str, texto: str, deducido: { type: 'boolean' },
      certeza: { type: 'string', enum: ['confirmado', 'a_confirmar'] }, ...ev, evidencia_mes: str,
    }),
    portfolio: ref('chequeo'),
    acuerdos: ref('acuerdo'),
    pendientes: { type: 'array', items: str },
  }),
  $defs: {
    item: obj({ texto: str, ...ev }),
    descartada: obj({ texto: str, motivo: str, ...ev }),
    chequeo: obj({ item: { type: 'string', enum: [...ITEMS_PORTFOLIO] }, estado: { type: 'string', enum: [...ESTADOS_PORTFOLIO] }, detalle: str, ...ev }),
    acuerdo: obj({ quien: str, que: str, cuando: str, ...ev }),
  },
}

// ── Mensaje de usuario: todo lo variable de la llamada, cada bloque con su etiqueta ──
/** Una línea por cliente del CRM: "A012 | Nombre | ACTIVO | email". */
export function lineasCRM(clientes: ClienteCRMKickoff[]): string {
  if (!clientes.length) return '(no disponible)'
  const limpio = (x: string) => x.replace(/[|\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
  return clientes.map(c => [limpio(c.id) || 'sin ID', limpio(c.nombre), c.estado || 'sin estado', limpio(c.email) || 'sin email'].join(' | ')).join('\n')
}

/** "Tomas Napolitano (Tomás, de Capital Jurídico)" / "Gero Mozzi (Gero M, de Capital Jurídico)" / el nombre de Fathom. */
function grabo(rb: ReunionFathom['recorded_by']): string {
  const g = quienGrabo(rb)
  if (!g) return 'sin dato'
  const nombre = (g.nombre ?? g.email ?? '').replace(/[\n\r<>]/g, ' ')
  return g.quien ? `${nombre} (${g.quien}, de Capital Jurídico)` : nombre
}

export function mensajeUsuario(r: ReunionFathom, clientes: ClienteCRMKickoff[], tr: Transcripcion): string {
  const invitados = r.calendar_invitees.length
    ? r.calendar_invitees.map(i => `${i.name ?? 'Sin nombre'}${i.email ? ` <${i.email}>` : ''} (${i.is_external ? 'externo' : 'interno'})`).join(', ')
    : '(sin invitados)'
  const tareas = r.action_items?.length
    ? r.action_items.map(t => `- ${t.recording_timestamp ? `[${t.recording_timestamp}] ` : ''}${t.description.replace(/\s+/g, ' ')}${t.assignee?.name ? ` — ${t.assignee.name}` : ''}`).join('\n')
    : '(sin tareas)'
  return [
    '<reunion>',
    `Título: ${r.title}${r.meeting_title && r.meeting_title !== r.title ? ` (evento: ${r.meeting_title})` : ''}`,
    `Fecha: ${fechaLargaAR(r.recording_start_time) ?? fechaLargaAR(r.created_at) ?? 'sin fecha'} (hora de Buenos Aires)`,
    // Quién hizo la kickoff (Tomás o Gero M): los compromisos del equipo van a su nombre (prompt k3)
    `Grabó: ${grabo(r.recorded_by)}`,
    `Invitados: ${invitados}`,
    '</reunion>',
    '<clientes_conocidos>',
    'ID | Nombre | Estado | Email',
    lineasCRM(clientes),
    '</clientes_conocidos>',
    '<resumen_fathom>',
    r.default_summary?.markdown_formatted ?? '(sin resumen)',
    '</resumen_fathom>',
    '<tareas_fathom>',
    tareas,
    '</tareas_fathom>',
    '<transcripcion>',
    tr.texto || '(sin transcripción)',
    '</transcripcion>',
  ].join('\n')
}

// ── Validación de la salida ──
const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const lista = (x: unknown, max: number): unknown[] => (Array.isArray(x) ? x.slice(0, max) : [])
const MAX_ITEMS = 20, MAX_LUGARES = 30, MAX_ACUERDOS = 30, MAX_PALABRAS_CITA = 25
const MAX_USD_DIA = 5_000, MAX_USD_MES = 150_000, MAX_RADIO_KM = 1_000

/** Texto comparable: minúsculas, sin acentos ni puntuación, espacios simples. */
export const normTexto = (x: string): string =>
  x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Un renglón de la transcripción armada (los del mismo hablante ya juntos), con su segundo y su texto normalizado. */
export interface RenglonNorm { s: number; norm: string }

export interface ContextoValidacion {
  rango: { desde: number | null; hasta: number | null }
  transcripcionNorm: string       // normTexto de la transcripción armada
  conocidos: ClienteCRMKickoff[]
  emailsInvitados: string[]       // mails de los invitados externos
  renglones?: RenglonNorm[]       // para ubicar la cita en su renglón (sin esto no se controla ni se estima el segundo)
}

const partesCita = (cita: string) => cita.split(/…|\.\.\./).map(normTexto).filter(p => p.split(' ').length >= 2)

/** ¿La cita aparece tal cual en la transcripción? Con "…" alcanza con que aparezca cada pedazo de 2+ palabras. */
export function citaTextual(cita: string, transcripcionNorm: string): boolean {
  const partes = partesCita(cita)
  return partes.length > 0 && partes.every(p => transcripcionNorm.includes(p))
}

/** Los renglones de la transcripción armada por formatearTranscripcion: "[HH:MM:SS] Nombre: texto". */
export function renglonesNorm(textoTranscripcion: string): RenglonNorm[] {
  const out: RenglonNorm[] = []
  for (const l of textoTranscripcion.split('\n')) {
    const m = l.match(/^\[(\d{2}:\d{2}:\d{2})\] [^:]*: (.*)$/)
    const s = m ? segundos(m[1]) : null
    if (m && s !== null) out.push({ s, norm: normTexto(m[2]) })
  }
  return out
}

const hhmmss = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
const MIN_DESFASE_S = 15                 // con menos que esto el link al inicio del renglón alcanza

/**
 * Ubica la cita en el renglón de su timestamp. en_renglon: aparece en ese renglón o en el de al lado (Fathom a veces corta
 * en el medio de una frase). aprox: el segundo estimado por la posición del primer pedazo dentro del renglón, interpolando
 * hasta el renglón siguiente; null si no hace falta (desfase chico) o no se puede (último renglón, no está en el renglón).
 */
export function ubicarCita(cita: string, ts: string, renglones: RenglonNorm[]): { en_renglon: boolean; aprox: string | null } {
  const s = segundos(ts)
  const i = s === null ? -1 : renglones.findIndex(r => r.s === s)
  const partes = partesCita(cita)
  if (i < 0 || !partes.length) return { en_renglon: false, aprox: null }
  const vecinos = [renglones[i - 1], renglones[i], renglones[i + 1]].filter(Boolean).map(r => r.norm).join(' ')
  const en_renglon = partes.every(p => vecinos.includes(p))
  const r = renglones[i], sig = renglones[i + 1]
  const pos = r.norm.indexOf(partes[0])
  if (pos < 0 || !sig || !r.norm.length) return { en_renglon, aprox: null }
  const desfase = Math.round((pos / r.norm.length) * (sig.s - r.s))
  return { en_renglon, aprox: desfase >= MIN_DESFASE_S ? hhmmss(r.s + desfase) : null }
}

/**
 * "[00:12:00] le voy a dar más prioridad…" → timestamp y cita por separado. Acepta sin corchetes, con «» o comillas
 * alrededor de la cita, y H:MM:SS. Sin timestamp adelante, todo es cita (y el timestamp queda vacío).
 */
export function partirEvidencia(x: string): { cita: string; timestamp: string } {
  const t = x.trim()
  const m = t.match(/^\[?\s*(\d{1,2}:\d{2}:\d{2})\s*\]?\s*[—–:-]?\s*([\s\S]*)$/)
  const quitarComillas = (c: string) => c.trim().replace(/^[«"“']\s*/, '').replace(/\s*[»"”']$/, '').trim()
  if (!m) return { cita: quitarComillas(t), timestamp: '' }
  return { cita: quitarComillas(m[2]), timestamp: m[1].padStart(8, '0') }
}

/** Valida y acota la salida del modelo. Lanza solo si no es un objeto. */
export function validarSalida(json: unknown, cx: ContextoValidacion): { extraccion: ExtraccionKickoff; ajustes: string[] } {
  if (!esObj(json)) throw new Error('la salida de Claude no es un objeto JSON')
  const ajustes: string[] = []
  let tsMalos = 0, citasLargas = 0, citasNoTextuales = 0, citasFueraDeRenglon = 0

  const evidencia = (x0: Record<string, unknown>): Evidencia => {
    // El schema la pide junta ("[HH:MM:SS] cita"); también se acepta separada (cita / timestamp)
    const x = typeof x0.evidencia === 'string' ? partirEvidencia(x0.evidencia) : x0
    const ts = typeof x.timestamp === 'string' ? x.timestamp.trim() : ''
    let timestamp: string | null = null
    if (ts) {
      const s = RE_TIMESTAMP.test(ts) ? segundos(ts) : null
      const enRango = s !== null && cx.rango.desde !== null && cx.rango.hasta !== null && s >= cx.rango.desde && s <= cx.rango.hasta
      if (enRango) timestamp = ts
      else tsMalos++
    }
    let cita = acotar(x.cita, 400) ?? ''
    const palabras = cita.split(/\s+/).filter(Boolean)
    if (palabras.length > MAX_PALABRAS_CITA) { cita = `${palabras.slice(0, MAX_PALABRAS_CITA).join(' ')}…`; citasLargas++ }
    const textual = cita ? citaTextual(cita, cx.transcripcionNorm) : false
    if (cita && !textual) citasNoTextuales++
    let aprox: string | null = null
    if (textual && timestamp && cx.renglones?.length) {
      const u = ubicarCita(cita, timestamp, cx.renglones)
      if (!u.en_renglon) citasFueraDeRenglon++
      aprox = u.aprox
    }
    return { cita, timestamp, textual, aprox }
  }
  /** Evidencia de un campo suelto (presentarse_evidencia, evidencia_mes); null si no vino nada. */
  const evidenciaSuelta = (x: unknown): Evidencia | null => (typeof x === 'string' && x.trim() ? evidencia({ evidencia: x }) : null)
  const items = (x: unknown): ItemConEvidencia[] => lista(x, MAX_ITEMS).filter(esObj).flatMap(i => {
    const texto = acotar(i.texto, 300)
    return texto ? [{ texto, ...evidencia(i) }] : []
  })
  const numero = (x: unknown, max: number, que: string): number | null => {
    if (x === null || x === undefined || (typeof x === 'string' && !x.trim())) return null
    // Texto: "8", "8.5" u "8,5"; "1.500" es mil quinientos (separador de miles), aunque el prompt pide no usarlo
    const t = typeof x === 'string' ? x.trim() : ''
    const n = typeof x === 'number' ? x
      : /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, ''))
        : /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN
    if (!Number.isFinite(n) || n < 0 || n > max) { ajustes.push(`${que} fuera de rango (${String(x).slice(0, 20)}): queda vacío`); return null }
    return Math.round(n * 100) / 100
  }

  const tipo: TipoReunion = (TIPOS_REUNION as readonly string[]).includes(json.tipo_reunion as string) ? (json.tipo_reunion as TipoReunion) : 'otra'
  const c = esObj(json.cliente) ? json.cliente : {}
  const cliente = validarCliente(c, cx, ajustes)

  const r = esObj(json.rama) ? json.rama : {}
  const ramaCruda = typeof r.principal === 'string' ? r.principal.trim() : ''
  const principal = ramaCruda && ramaCruda !== 'ninguna' ? normalizarRama(ramaCruda) : null
  if (ramaCruda && ramaCruda !== 'ninguna' && !principal) ajustes.push(`rama desconocida «${ramaCruda.slice(0, 40)}»: queda sin rama`)
  const rama = {
    principal,
    texto: acotar(r.texto, 200) ?? '',
    ...evidencia(r),
    subramas: items(r.subramas),
    descartadas: lista(r.descartadas, MAX_ITEMS).filter(esObj).flatMap(i => {
      const texto = acotar(i.texto, 300)
      return texto ? [{ texto, motivo: acotar(i.motivo, 300) ?? '', ...evidencia(i) }] : []
    }),
    a_futuro: items(r.a_futuro),
  }

  const a = esObj(json.avatar) ? json.avatar : {}
  const avatar = { incluye: items(a.incluye), excluye: items(a.excluye) }

  const z = esObj(json.zona) ? json.zona : {}
  const presentarse = acotar(z.presentarse_como, 120)
  const lugares = lista(z.lugares, MAX_LUGARES).map(l => acotar(l, 80)).filter((l): l is string => !!l)
  const descripcion = acotar(z.descripcion, 400) ?? ''
  const zona = {
    descripcion,
    lugares,
    radio_km: numero(z.radio_km, MAX_RADIO_KM, 'radio en km'),
    presentarse_como: presentarse
      ? { texto: presentarse, cuando: acotar(z.presentarse_cuando, 160) ?? '', ...(evidenciaSuelta(z.presentarse_evidencia) ?? { cita: '', timestamp: null, textual: false, aprox: null }) }
      : null,
    contexto: items(z.contexto),
    pais: paisDeTexto([descripcion, ...lugares, presentarse ?? ''].join(' ')),
    mapa_en_pantalla: z.mapa_en_pantalla === true,
    ...evidencia(z),
  }

  const p = esObj(json.presupuesto) ? json.presupuesto : {}
  const crudo = {
    usd_dia_min: numero(p.usd_dia_min, MAX_USD_DIA, 'presupuesto diario mínimo'),
    usd_dia_max: numero(p.usd_dia_max, MAX_USD_DIA, 'presupuesto diario máximo'),
    usd_mes: numero(p.usd_mes, MAX_USD_MES, 'presupuesto mensual'),
    moneda: acotar(p.moneda, 10)?.toUpperCase() || null,
    texto: acotar(p.texto, 300) ?? '',
    deducido: p.deducido === true,
    certeza: p.certeza === 'confirmado' ? ('confirmado' as const) : ('a_confirmar' as const),
    ...evidencia(p),
    evidencia_mes: evidenciaSuelta(p.evidencia_mes),
  }
  // Un solo monto diario → min = max; el mensual desde el diario (o al revés), marcado deducido
  const { presupuesto, ajustes: ajustesPresupuesto } = tipo === 'kickoff' ? normalizarPresupuesto(crudo) : { presupuesto: crudo, ajustes: [] }
  ajustes.push(...ajustesPresupuesto)

  const portfolio = {} as Record<ItemPortfolio, ChequeoPortfolio>
  for (const x of lista(json.portfolio, 30).filter(esObj)) {
    const k = x.item as ItemPortfolio
    if (!(ITEMS_PORTFOLIO as readonly string[]).includes(k)) { ajustes.push(`ítem de portfolio desconocido «${String(x.item).slice(0, 30)}»: descartado`); continue }
    if (portfolio[k]) { ajustes.push(`ítem de portfolio repetido (${k}): queda el primero`); continue }
    let estado: EstadoPortfolio = (ESTADOS_PORTFOLIO as readonly string[]).includes(x.estado as string) ? (x.estado as EstadoPortfolio) : 'no_se_hablo'
    const ev = evidencia(x)
    // "No se habló" con una cita es contradictorio: si hay de qué agarrarse, se mencionó pero no se verificó
    if (estado === 'no_se_hablo' && ev.cita) { estado = 'sin_verificar'; ajustes.push(`portfolio ${k}: «no se habló» con cita → sin verificar`) }
    portfolio[k] = { estado, detalle: acotar(x.detalle, 300) ?? '', ...ev }
  }
  for (const k of ITEMS_PORTFOLIO) portfolio[k] ??= { estado: 'no_se_hablo', detalle: '', cita: '', timestamp: null, textual: false, aprox: null }

  const acuerdos: Acuerdo[] = lista(json.acuerdos, MAX_ACUERDOS).filter(esObj).flatMap(x => {
    const que = acotar(x.que, 400)
    return que ? [{ quien: acotar(x.quien, 80) || 'sin dato', que, cuando: acotar(x.cuando, 120) || null, ...evidencia(x) }] : []
  })
  const pendientes = lista(json.pendientes, MAX_ITEMS).map(x => acotar(x, 400)).filter((x): x is string => !!x)

  if (tsMalos) ajustes.push(`${tsMalos} timestamp${tsMalos === 1 ? '' : 's'} mal formado${tsMalos === 1 ? '' : 's'} o fuera de la llamada: va${tsMalos === 1 ? '' : 'n'} sin link`)
  if (citasLargas) ajustes.push(`${citasLargas} cita${citasLargas === 1 ? '' : 's'} de más de ${MAX_PALABRAS_CITA} palabras: recortada${citasLargas === 1 ? '' : 's'}`)
  if (citasNoTextuales) ajustes.push(`${citasNoTextuales} cita${citasNoTextuales === 1 ? '' : 's'} que no aparece${citasNoTextuales === 1 ? '' : 'n'} tal cual en la transcripción (marcada${citasNoTextuales === 1 ? '' : 's'} como no textual)`)
  if (citasFueraDeRenglon) ajustes.push(`${citasFueraDeRenglon} cita${citasFueraDeRenglon === 1 ? '' : 's'} fuera del renglón de su timestamp: el link puede no caer en el momento`)

  return {
    extraccion: { tipo_reunion: tipo, resumen_corto: acotar(json.resumen_corto, 200) ?? '', cliente, rama, avatar, zona, presupuesto, portfolio, acuerdos, pendientes },
    ajustes,
  }
}

/**
 * Cliente: lo que dijo Claude, solo si está en el CRM (por ID o por nombre exacto normalizado). Si el mail de UN invitado
 * externo coincide con el de UN solo cliente del CRM, gana ese (es determinista; si Claude dijo otro, queda anotado).
 */
function validarCliente(c: Record<string, unknown>, cx: ContextoValidacion, ajustes: string[]): ClienteFicha {
  const escuchado = acotar(c.nombre_escuchado, 120) || 'Sin nombre'
  const apodo = acotar(c.apodo, 40) || null
  const porId = new Map(cx.conocidos.filter(k => k.id).map(k => [k.id.toUpperCase(), k]))
  const porNombre = new Map(cx.conocidos.map(k => [normNombre(k.nombre), k]))
  const idDicho = acotar(c.id_crm, 20)?.toUpperCase() || null
  const nombreDicho = acotar(c.cliente_crm, 120) || null
  let elegido: ClienteCRMKickoff | null = null
  const hitId = idDicho ? porId.get(idDicho) ?? null : null
  const hitNombre = nombreDicho ? porNombre.get(normNombre(nombreDicho)) ?? null : null
  if (hitId && hitNombre && hitId !== hitNombre) ajustes.push(`id_crm ${idDicho} y cliente_crm «${nombreDicho}» no coinciden: queda sin verificar`)
  else elegido = hitId ?? hitNombre
  if (!elegido && (idDicho || nombreDicho) && !(hitId && hitNombre)) ajustes.push(`cliente «${nombreDicho ?? idDicho}» no está en la lista del CRM: queda sin verificar`)

  const email = cx.emailsInvitados[0] ?? null
  let como: ClienteFicha['como'] = elegido ? 'claude' : null
  const mails = new Set(cx.emailsInvitados.map(m => m.trim().toLowerCase()).filter(Boolean))
  const porMail = cx.conocidos.filter(k => k.email && mails.has(k.email.trim().toLowerCase()))
  if (porMail.length === 1) {
    if (elegido && elegido !== porMail[0]) ajustes.push(`Claude eligió «${elegido.nombre}» pero el mail del invitado es de «${porMail[0].nombre}»: gana el mail`)
    if (!elegido) ajustes.push(`cliente cruzado con el CRM por el mail del invitado (${porMail[0].nombre})`)
    como = 'email'                       // el mail confirma (o corrige) el cruce: es lo más firme que hay
    elegido = porMail[0]
  }
  return {
    nombre_escuchado: escuchado,
    apodo,
    cliente_crm: elegido?.nombre ?? null,
    id_crm: elegido?.id || null,
    email,
    como,
    cuentas: elegido?.cuentas ?? [],
  }
}

export interface EntradaExtraccion { reunion: ReunionFathom; transcripcion: Transcripcion; clientes: ClienteCRMKickoff[] }

/** Mails de los invitados externos (los del equipo no sirven para cruzar al cliente). */
export const emailsExternos = (r: ReunionFathom): string[] =>
  r.calendar_invitees.filter(i => i.is_external && i.email).map(i => i.email!.trim().toLowerCase())

export async function extraerFicha(e: EntradaExtraccion, topeMs: number = TOPE_CLAUDE_MS): Promise<ResultadoExtraccionKickoff> {
  const res = await llamarClaude({
    que: 'la ficha',
    sistema: PROMPT_SISTEMA,
    usuario: mensajeUsuario(e.reunion, e.clientes, e.transcripcion),
    schema: SCHEMA_FICHA,
    esfuerzo: esfuerzoDe('high'),
    topeMs,
  })
  const { extraccion, ajustes } = validarSalida(res.json, {
    rango: { desde: e.transcripcion.desde, hasta: e.transcripcion.hasta },
    transcripcionNorm: normTexto(e.transcripcion.texto),
    renglones: renglonesNorm(e.transcripcion.texto),
    conocidos: e.clientes,
    emailsInvitados: emailsExternos(e.reunion),
  })
  return { extraccion, ajustes, modelo: res.modelo, usage: res.usage }
}
