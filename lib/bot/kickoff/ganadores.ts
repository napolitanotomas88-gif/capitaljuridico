// ── Anuncios ganadores de una rama (Meta, solo lectura) para las ideas de guiones ───────────────────
// La prueba del 24/10 (.cache/kickoff-prueba/ganadores.ts) dio que es factible y barato: un pedido por cuenta a nivel
// anuncio con gasto y mensajes juntos, y el texto del anuncio solo de los mejores. Acá queda así:
//   1. Cuentas de la rama: la misma selección que el tablero (lib/anuncios/tablero.ts: lista base + cuentas de clientes
//      activos que aparecen en Meta) y la misma rama por cuenta (AJUSTES_CUENTA.rama → ClickUp "Seguimiento de Anuncios" →
//      nombre de la cuenta), leyendo las MISMAS claves de caché del tablero ('sheets', 'descubrir',
//      'clickup-presupuestos-v1', 'dolar', 'monedas'): casi siempre están calientes y no suman llamadas.
//   2. Meta: 1 Batch API con un subpedido GET por cuenta ({cuenta}/insights?level=ad, 180 días, gasto + mensajes + nombre
//      de la campaña, que dice el país o la provincia: "[DM][ABO][URUGUAY]", "[DM][Bahia]"), y 1
//      subpedido GET ?ids=… con el texto de los TOPE_COPY mejores por CPL. El cuerpo de la Batch API va por POST (así es la
//      API), pero cada subpedido es un GET: no se escribe nada. Si un token no tiene permisos sobre una cuenta, se reintenta
//      con el otro (tokensMeta: META_ANUNCIOS_TOKEN y META_CLIENTES_TOKEN), como hace lib/anuncios/meta.ts (cuyas funciones de
//      batch son privadas: ver docs/BOT-KICKOFF-CJ.md, ediciones compartidas).
//   3. Caché compartida: conCache(`kickoff-ganadores-v2:<rama>:<día>`, 12 h). Un ranking de 180 días casi no cambia en el
//      día y lleva el tag 'anuncios' (el botón de actualizar del tablero también lo invalida). Si Meta falla, conCache
//      devuelve el último bueno; si no hay ninguno, procesar.ts sigue SIN ganadores y lo anota en la ficha.
//   4. elegirGanadores (puro): saca las cuentas del propio cliente, descarta lo que es de otra rama (clasificarRama sobre el
//      nombre del anuncio y, en laboral, un filtro positivo sobre nombre + texto), máximo 2 por cliente, hasta 10, con id
//      G1…Gn para que el prompt de ideas los cite. Con menos de 3 → "pocos_datos" (no se inventa nada).
//      País: cada cuenta lleva el suyo (paisDeCuenta: la moneda ARS/UYU/… o el país o la provincia en el nombre de las
//      campañas; USD sin nada más = sin dato). Si se sabe el país del cliente, van primero los del mismo país, después los
//      sin dato y los de otro país solo para llegar a MIN_PARA_OK: otro marco legal (el BPS de Uruguay, por ejemplo) y un CPL
//      que no se compara. Cada ganador lleva su país, que el prompt de ideas ve.
// Privacidad: son anuncios de OTROS clientes. El nombre del cliente queda en la ficha (JSON interno) pero no va a Claude, ni
// al markdown, ni a Discord; nunca al cliente nuevo. Además, el nombre y el texto del anuncio pasan por anonimizar(): sin
// teléfonos, @usuarios, el nombre de ese cliente ni "Dra. Fulana" (el copy de otro abogado puede decir "Soy la Dra. X").
// Moneda: el gasto en ARS se pasa con el MEP de hoy y otras monedas con la cotización de hoy (aproximado: el gasto viejo en
// pesos queda algo subestimado en USD). Es una referencia para idear, no una medición cerrada.
import { clasificarRama, type Rama } from '@/lib/anuncios/ramas'
import type { EstadoGanadores, Ganador, GanadoresFicha } from './tipos'

export const DIAS_VENTANA = 180
export const GASTO_MIN_USD = 20
export const MENSAJES_MIN = 10
export const MAX_GANADORES = 10
export const MAX_POR_CLIENTE = 2
export const MIN_PARA_OK = 3
export const TOPE_COPY = 30
export const CACHE_SEG = 43_200      // 12 h

// ── Tipos de la lectura cacheada (lo que guarda conCache) ──
export interface FilaInsightAd { cuentaId: string; cliente: string; adId: string; nombre: string; moneda: string; gasto: number; mensajes: number; campana?: string }
export interface Candidato {
  cuentaId: string; cliente: string; anuncio: string; moneda: string
  gasto: number; gastoUSD: number; mensajes: number; cplUSD: number
  adIds: string[]; adPrincipal: string; copy: string | null
  pais?: string | null
}
export interface CandidatosRama {
  rama: Rama
  generado: string
  ventana: { desde: string; hasta: string; dias: number }
  cuentas: { id: string; cliente: string }[]
  candidatos: Candidato[]
  erroresCuentas: number
  nota: string
}

/** "12 - ¿Te despidieron? ⬇️" → "¿Te despidieron?" (el número de orden y la flecha no son parte del gancho). */
export const limpiarNombreAnuncio = (n: string): string =>
  n.replace(/\s*⬇️?\s*$/u, '').replace(/^\d+\s*-\s*/, '').replace(/\s+/g, ' ').trim()

const normTxt = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// ── País de una cuenta (moneda y nombre de las campañas) ──
const PAIS_POR_MONEDA: Record<string, string> = { ARS: 'AR', UYU: 'UY', CLP: 'CL', MXN: 'MX', COP: 'CO', PEN: 'PE', PYG: 'PY', BOB: 'BO' }
// Sobre el texto normalizado (sin acentos, minúsculas). Las provincias y ciudades argentinas son las que usan las campañas.
const PAIS_POR_TEXTO: [string, RegExp][] = [
  ['UY', /\b(uruguay|montevideo|canelones|maldonado|punta del este)\b/],
  ['CL', /\b(chile|santiago de chile)\b/],
  ['MX', /\b(mexico|cdmx)\b/],
  ['PY', /\b(paraguay|asuncion)\b/],
  ['AR', /\b(arg|argentina|bsas|caba|buenos aires|gba|amba|bahia|bahia blanca|cordoba|corrientes|salta|jujuy|tucuman|mendoza|san juan|san luis|santa fe|rosario|entre rios|parana|misiones|chaco|formosa|neuquen|rio negro|chubut|santa cruz|tierra del fuego|la pampa|la rioja|catamarca|santiago del estero|mar del plata|la plata)\b/],
]

/** País (ISO de 2 letras) de un texto libre (nombre de campaña, zona): el primero que aparece en la tabla, o null. */
export function paisDeTexto(texto: string): string | null {
  const t = normTxt(texto)
  return t ? PAIS_POR_TEXTO.find(([, re]) => re.test(t))?.[0] ?? null : null
}

/** País de una cuenta: la moneda si es de un país (ARS, UYU…) y si no (USD), lo que digan los nombres de sus campañas. */
export function paisDeCuenta(moneda: string, campanas: string[]): string | null {
  const porMoneda = PAIS_POR_MONEDA[moneda.toUpperCase()]
  if (porMoneda) return porMoneda
  const paises = new Set(campanas.map(paisDeTexto).filter((p): p is string => !!p))
  return paises.size === 1 ? [...paises][0] : null   // campañas de dos países: sin dato (no se adivina)
}

// ── Anonimizar el texto de un anuncio de OTRO cliente antes de mandarlo a Claude ──
const VOCAL: Record<string, string> = { a: '[aáàâä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôö]', u: '[uúùûü]', n: '[nñ]' }
const PALABRAS_COMUNES = new Set(['del', 'las', 'los', 'san', 'santa', 'estudio', 'abogada', 'abogado', 'abogados', 'juridico', 'consultora'])
const TELEFONO = /\+?\d[\d\s().-]{6,}\d/g
const USUARIO = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,30}/gu
const TITULO_Y_NOMBRE = /\b(Dr|Dra|Doctor|Doctora|Abogad[oa]|Lic|Licenciad[oa])(\.?)\s+\p{Lu}[\p{L}'’-]+(\s+(de\s+la\s+|del\s+|de\s+)?\p{Lu}[\p{L}'’-]+){0,3}/gu

/** Saca teléfonos, @usuarios, "Dra. Fulana" y las palabras del nombre del cliente (sin importar acentos ni mayúsculas). */
export function anonimizar(texto: string, cliente: string): string {
  let t = texto.replace(TELEFONO, '[teléfono]').replace(USUARIO, '$1[usuario]').replace(TITULO_Y_NOMBRE, '$1$2 [nombre]')
  for (const w of normTxt(cliente).split(' ').filter(w => w.length >= 3 && !PALABRAS_COMUNES.has(w))) {
    const patron = [...w].map(c => VOCAL[c] ?? c).join('')
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${patron}(?![\\p{L}\\p{N}])`, 'giu'), '[nombre]')
  }
  return t.replace(/(\[nombre\]\s*){2,}/g, '[nombre] ')
}

/**
 * Agrupa el mismo guion (mismo nombre normalizado en la misma cuenta: suele estar duplicado en varios conjuntos), pasa a USD
 * y deja los que superan los mínimos, ordenados por CPL. usdPor(moneda) = unidades de esa moneda por 1 USD (null = sin dato).
 */
export function agruparAnuncios(filas: FilaInsightAd[], usdPor: (moneda: string) => number | null): Omit<Candidato, 'copy'>[] {
  const grupos = new Map<string, Omit<Candidato, 'copy' | 'cplUSD'> & { principalGasto: number }>()
  for (const f of filas) {
    const anuncio = limpiarNombreAnuncio(f.nombre)
    if (!anuncio) continue
    const k = `${f.cuentaId}|${normTxt(anuncio)}`
    const tasa = usdPor(f.moneda)
    const g = grupos.get(k) ?? { cuentaId: f.cuentaId, cliente: f.cliente, anuncio, moneda: f.moneda, gasto: 0, gastoUSD: 0, mensajes: 0, adIds: [], adPrincipal: f.adId, principalGasto: -1 }
    g.gasto += f.gasto
    g.gastoUSD += tasa ? f.gasto / tasa : 0
    g.mensajes += f.mensajes
    g.adIds.push(f.adId)
    if (f.gasto > g.principalGasto) { g.adPrincipal = f.adId; g.principalGasto = f.gasto }
    grupos.set(k, g)
  }
  return [...grupos.values()]
    .filter(g => g.gastoUSD >= GASTO_MIN_USD && g.mensajes >= MENSAJES_MIN)
    .map(({ adIds, adPrincipal, cuentaId, cliente, anuncio, moneda, gasto, gastoUSD, mensajes }) => ({ cuentaId, cliente, anuncio, moneda, adIds, adPrincipal, mensajes, gasto: Math.round(gasto * 100) / 100, gastoUSD: Math.round(gastoUSD * 100) / 100, cplUSD: Math.round((gastoUSD / mensajes) * 100) / 100 }))
    .sort((a, b) => a.cplUSD - b.cplUSD)
}

// ── Filtros por rama ──
// Laboral: el nombre o el texto tienen que hablar de trabajo, y el nombre no puede ser de otra cosa (clasificarRama no
// detecta "¿Te separaste…?" ni "accidente en moto"). Para las otras ramas alcanza con que el nombre no sea de otra rama.
const LABORAL = /despid|echaron|echan|en negro|en gris|renunci|indemniz|liquidaci|trabaj|empleador|sueldo|recibo|monotribut|licencia|registr/i
const NO_LABORAL = /separaste|divorci|hijos|accidente en moto|choque|herencia/i
const SUBTEMAS_LABORAL: [string, RegExp][] = [
  ['trabajo en negro / en gris', /en negro|en gris|parte en (negro|mano)|sin recibo|nunca te registraron|figura por la mitad|mal registrad/i],
  ['liquidación mal calculada / firmar sin revisar', /liquidaci|firm|pagaron menos|cobraste menos|menos de lo que|indemnizaci/i],
  ['te empujan a renunciar', /renunci|empujando/i],
  ['despido con causa inventada', /con causa|causa invent|causa que nunca/i],
  ['despido en licencia / embarazo', /embaraz|licencia/i],
  ['abandono / te dejaron de llamar', /dejaron de llamar|no vengas m[aá]s|esperás que te llamen/i],
]

export function esDeLaRama(rama: Rama, anuncio: string, copy: string | null): boolean {
  const delNombre = clasificarRama(anuncio)
  if (delNombre && delNombre !== rama) return false
  if (rama !== 'laboral') return true
  return LABORAL.test(`${anuncio} ${copy ?? ''}`) && !NO_LABORAL.test(anuncio)
}

export function subtemaDe(rama: Rama, texto: string): string {
  if (rama !== 'laboral') return 'general'
  return SUBTEMAS_LABORAL.find(([, re]) => re.test(texto))?.[0] ?? 'despido (general)'
}

export interface OpcionesElegir {
  excluirCuentas?: string[]       // las cuentas del propio cliente
  excluirCliente?: string | null  // el nombre del cliente en el CRM (por si su cuenta no está cruzada)
  pais?: string | null            // el país del cliente (ISO de 2 letras): primero los ganadores del mismo país
  max?: number
  maxPorCliente?: number
}

/** De la lectura cacheada a la lista de la ficha. Puro. */
export function elegirGanadores(c: CandidatosRama, op: OpcionesElegir = {}): GanadoresFicha {
  const fuera = new Set((op.excluirCuentas ?? []).map(x => (x.startsWith('act_') ? x : `act_${x}`)))
  const clienteFuera = op.excluirCliente ? normTxt(op.excluirCliente) : null
  const max = op.max ?? MAX_GANADORES, maxPorCliente = op.maxPorCliente ?? MAX_POR_CLIENTE
  const pais = op.pais?.toUpperCase() || null
  let otraRama = 0, propias = 0
  // Los que sirven (sin el propio cliente ni otra rama), en orden de CPL
  const validos = c.candidatos.filter(x => {
    if (fuera.has(x.cuentaId) || (clienteFuera && normTxt(x.cliente) === clienteFuera)) { propias++; return false }
    if (!esDeLaRama(c.rama, x.anuncio, x.copy)) { otraRama++; return false }
    return true
  })
  // Por país: 0 = mismo país (o no se sabe el del cliente), 1 = sin dato, 2 = otro país (solo para llegar a MIN_PARA_OK)
  const nivel = (x: Candidato) => (!pais ? 0 : x.pais === pais ? 0 : x.pais ? 2 : 1)
  const porCliente = new Map<string, number>()
  const elegidos: Candidato[] = []
  for (const tope of [0, 1, 2]) {
    for (const x of validos) {
      if (elegidos.length >= (tope === 2 ? Math.min(max, MIN_PARA_OK) : max)) break
      if (nivel(x) !== tope) continue
      const n = porCliente.get(x.cuentaId) ?? 0
      if (n >= maxPorCliente) continue
      porCliente.set(x.cuentaId, n + 1)
      elegidos.push(x)
    }
  }
  const lista: Ganador[] = elegidos.map((x, i) => ({
    id: `G${i + 1}`,
    anuncio: anonimizar(x.anuncio, x.cliente),
    copy: x.copy ? anonimizar(x.copy.replace(/https?:\/\/\S+/g, '[link]'), x.cliente).slice(0, 600) : null,
    subtema: subtemaDe(c.rama, `${x.anuncio} ${x.copy ?? ''}`),
    cplUSD: x.cplUSD, mensajes: x.mensajes, gastoUSD: x.gastoUSD,
    pais: x.pais ?? null,
    cliente: x.cliente, cuentaId: x.cuentaId,
  }))
  const deOtroPais = pais ? validos.filter(x => nivel(x) === 2).length : 0
  const otroPaisElegidos = pais ? elegidos.filter(x => nivel(x) === 2).length : 0
  const estado: EstadoGanadores = lista.length >= MIN_PARA_OK ? 'ok' : lista.length ? 'pocos_datos' : 'sin_datos'
  const nota = [
    `${c.cuentas.length} cuenta${c.cuentas.length === 1 ? '' : 's'} de la rama, ${c.candidatos.length} guiones con USD ${GASTO_MIN_USD}+ y ${MENSAJES_MIN}+ mensajes`,
    otraRama ? `${otraRama} de otra rama descartados` : '',
    propias ? `${propias} del propio cliente afuera` : '',
    deOtroPais ? `${deOtroPais} de otro país (no ${pais})${otroPaisElegidos ? `: ${otroPaisElegidos} usados para completar, marcados` : ' quedaron afuera'}` : '',
    c.erroresCuentas ? `${c.erroresCuentas} cuenta${c.erroresCuentas === 1 ? '' : 's'} sin datos de Meta` : '',
    estado === 'pocos_datos' ? 'pocos datos: tomarlos como referencia débil' : '',
    c.nota,
  ].filter(Boolean).join(' · ')
  return { estado, nota, lista, ventana: `${c.ventana.desde} a ${c.ventana.hasta} (${c.ventana.dias} días)` }
}

/** Rama probable antes de llamar a Claude (para pedir los ganadores en paralelo): el resumen de Fathom y, si no, la transcripción. */
export function ramaProbable(resumen: string | null, transcripcion: string): Rama | null {
  return (resumen ? clasificarRama(resumen) : null) ?? clasificarRama(transcripcion)
}

// ── Lectura real (solo servidor): Meta por la Batch API, con las cachés del tablero ─────────────────
const GRAPH = 'https://graph.facebook.com/v23.0'
const LOTE = 25
const TIMEOUT_META_MS = 15_000
const MAX_PAGINAS = 5

type RespGraph = { ok: true; body: unknown } | { ok: false; error: string; permisos: boolean }

/** Una llamada a la Batch API (subpedidos GET). Una respuesta por pedido, en el mismo orden. */
export async function llamarBatch(token: string, urls: string[], sinTokens: (t: string) => string, esErrorPermisos: (c?: number, s?: number) => boolean): Promise<RespGraph[]> {
  try {
    const body = new URLSearchParams({ access_token: token, include_headers: 'false', batch: JSON.stringify(urls.map(u => ({ method: 'GET', relative_url: u }))) })
    const r = await fetch(`${GRAPH}/`, { method: 'POST', body, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_META_MS) })
    const j = (await r.json()) as ({ code: number; body: string } | null)[] | { error?: { message?: string; code?: number; error_subcode?: number } }
    if (!Array.isArray(j)) {
      const e = j.error
      return urls.map(() => ({ ok: false, error: sinTokens(e?.message ?? `HTTP ${r.status}`), permisos: esErrorPermisos(e?.code, e?.error_subcode) }))
    }
    return urls.map((_, i) => {
      const x = j[i]
      if (!x) return { ok: false, error: 'Meta no respondió este pedido', permisos: false }
      let b: { error?: { message?: string; code?: number; error_subcode?: number } } | null = null
      try { b = JSON.parse(x.body) } catch { /* cuerpo vacío */ }
      if (x.code === 200 && b && !b.error) return { ok: true, body: b }
      return { ok: false, error: sinTokens(`${b?.error?.message ?? `HTTP ${x.code}`}${b?.error?.code ? ` (#${b.error.code})` : ''}`), permisos: esErrorPermisos(b?.error?.code, b?.error?.error_subcode) }
    })
  } catch (e) {
    return urls.map(() => ({ ok: false, error: sinTokens(`Meta no respondió (${(e as Error)?.name ?? 'error'})`), permisos: false }))
  }
}

/** Todos los pedidos con el primer token; lo que falla por permisos, con el siguiente. Exportada para los tests. */
export async function batchConTokens(pedidos: { id: string; url: string }[]): Promise<{ ok: Record<string, { body: unknown; token: string }>; errores: Record<string, string> }> {
  const { tokensMeta, sinTokens, esErrorPermisos } = await import('@/lib/anuncios/token')
  const tokens = tokensMeta()
  const ok: Record<string, { body: unknown; token: string }> = {}
  const errores: Record<string, string> = {}
  if (!tokens.length) throw new Error('falta META_CLIENTES_TOKEN (o META_ANUNCIOS_TOKEN)')
  let pendientes = pedidos
  for (const t of tokens) {
    if (!pendientes.length) break
    const lotes: (typeof pedidos)[] = []
    for (let i = 0; i < pendientes.length; i += LOTE) lotes.push(pendientes.slice(i, i + LOTE))
    const resps = await Promise.all(lotes.map(l => llamarBatch(t.token, l.map(p => p.url), sinTokens, esErrorPermisos)))
    const otraVez: typeof pedidos = []
    lotes.forEach((l, li) => l.forEach((p, i) => {
      const r = resps[li][i]
      if (r.ok) { ok[p.id] = { body: r.body, token: t.nombre }; delete errores[p.id]; return }
      errores[p.id] = r.error
      if (r.permisos) otraVez.push(p)
    }))
    pendientes = otraVez
  }
  return { ok, errores }
}

/** Sigue paging.next (GET) de una respuesta de insights, hasta MAX_PAGINAS; solo si el next es de graph.facebook.com. */
export async function todasLasPaginas(primera: unknown): Promise<Record<string, unknown>[]> {
  const filas: Record<string, unknown>[] = []
  let pagina = primera as { data?: Record<string, unknown>[]; paging?: { next?: string } } | null
  for (let i = 0; pagina && i < MAX_PAGINAS; i++) {
    filas.push(...(pagina.data ?? []))
    const next = pagina.paging?.next
    if (!next || !next.startsWith(`${GRAPH}/`)) break
    try {
      const r = await fetch(next, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_META_MS) })
      pagina = r.ok ? ((await r.json()) as typeof pagina) : null
    } catch {
      pagina = null
    }
  }
  return filas
}

/** Las cuentas de una rama con la misma selección y la misma rama por cuenta que el tablero (cachés compartidas). */
export async function cuentasDeRama(rama: Rama, hoy: string): Promise<{ cuentas: { id: string; cliente: string }[]; avisos: string[] }> {
  const [{ conCache }, { REFRESCO }, meta, { leerSheets }, ramas, { crearCruce }, cuentas] = await Promise.all([
    import('@/lib/anuncios/cache'), import('@/lib/anuncios/tablero'), import('@/lib/anuncios/meta'), import('@/lib/anuncios/sheets'),
    import('@/lib/anuncios/ramas'), import('@/lib/anuncios/cruce'), import('@/lib/anuncios/cuentas'),
  ])
  const seguro = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p } catch { return null } }
  const [sheetsR, descR, clickupR] = await Promise.all([
    seguro(conCache('sheets', REFRESCO.sheetsSeg, async () => {
      const s = await leerSheets(hoy)
      if (s.errores.length) throw new Error(s.errores.join(' · '))   // no cachear una lectura incompleta (igual que el tablero)
      return s
    })),
    seguro(conCache('descubrir', REFRESCO.descubrimientoSeg, async () => {
      const d = await meta.descubrirCuentas()
      if (!d.cuentas.length) throw new Error(d.errores[0] ?? 'Meta no devolvió cuentas')
      return d
    })),
    seguro(conCache('clickup-presupuestos-v1', REFRESCO.clickupSeg, ramas.leerTareasClickUp)),
  ])
  const avisos: string[] = []
  if (!sheetsR) avisos.push('sin CRM (nombres de cuenta)')
  if (!descR) avisos.push('sin descubrimiento de cuentas (solo la lista base)')
  if (!clickupR) avisos.push('sin ClickUp (rama por nombre de cuenta)')
  const cruce = crearCruce(sheetsR?.data ?? { clientes: [], cuentasMeta: [], alias: [], guiones: [], errores: [] })
  const buscarTarea = ramas.crearCruceRamas(clickupR?.data ?? [])
  const descubiertas = descR?.data.cuentas ?? []
  const porId = new Map(descubiertas.map(c => [c.id, c]))
  const cuentasPrivadas = cuentas.cargarCuentas()
  const excluidas = new Set(cuentasPrivadas.excluidas)
  const base = cuentasPrivadas.base.filter(id => !excluidas.has(id) && !cuentas.esCuentaPropia(id))
  const enBase = new Set(base)
  const extras = descubiertas.filter(c => !enBase.has(c.id) && !excluidas.has(c.id) && !cuentas.esCuentaPropia(c.id) && ![100, 101].includes(c.estado)
    && cruce.resolverCliente({ id: c.id, nombre: c.nombre, negocio: c.negocio?.nombre }).activo).map(c => c.id)
  const out: { id: string; cliente: string }[] = []
  for (const id of [...base, ...extras]) {
    const d = porId.get(id)
    const nombre = d?.nombre ?? id
    const res = cruce.resolverCliente({ id, nombre, negocio: d?.negocio?.nombre })
    const tarea = buscarTarea([res.cliente?.nombre ?? '', res.nombreColC, nombre, d?.negocio?.nombre ?? ''])
    const r = cuentasPrivadas.ajustes[id]?.rama ?? tarea?.rama ?? ramas.clasificarRama(`${nombre} ${d?.negocio?.nombre ?? ''}`)
    if (r === rama) out.push({ id, cliente: res.cliente?.nombre || res.nombreColC || nombre })
  }
  return { cuentas: out, avisos }
}

/** Lee (o toma de la caché de 12 h) los candidatos de una rama. Lanza si Meta no respondió nada y no hay dato anterior. */
export async function leerCandidatos(rama: Rama): Promise<CandidatosRama> {
  const [{ conCache }, { REFRESCO }, { hoyAR, sumarDias }, { ACCION_MENSAJE }, { dolarHoy, monedasPorUSD }] = await Promise.all([
    import('@/lib/anuncios/cache'), import('@/lib/anuncios/tablero'), import('@/lib/anuncios/formato'), import('@/lib/anuncios/meta'), import('@/lib/anuncios/dolar'),
  ])
  const hoy = hoyAR()
  const r = await conCache(`kickoff-ganadores-v2:${rama}:${hoy}`, CACHE_SEG, async (): Promise<CandidatosRama> => {
    const desde = sumarDias(hoy, -(DIAS_VENTANA - 1))
    const { cuentas, avisos } = await cuentasDeRama(rama, hoy)
    const ventana = { desde, hasta: hoy, dias: DIAS_VENTANA }
    if (!cuentas.length) return { rama, generado: new Date().toISOString(), ventana, cuentas, candidatos: [], erroresCuentas: 0, nota: ['ninguna cuenta de esta rama', ...avisos].join(' · ') }
    const rango = encodeURIComponent(JSON.stringify({ since: desde, until: hoy }))
    const [ins, dolar, fx] = await Promise.all([
      batchConTokens(cuentas.map(c => ({ id: c.id, url: `${c.id}/insights?level=ad&fields=ad_id,ad_name,campaign_name,account_currency,spend,actions&time_range=${rango}&limit=500` }))),
      conCache('dolar', REFRESCO.dolarSeg, dolarHoy).then(x => x.data).catch(() => null),
      conCache('monedas', REFRESCO.monedasSeg, () => monedasPorUSD()).then(x => x.data).catch(() => null),
    ])
    if (!Object.keys(ins.ok).length) throw new Error(`Meta no devolvió datos de ninguna cuenta (${Object.values(ins.errores)[0] ?? 'sin detalle'})`)
    const usdPor = (m: string) => (m === 'USD' ? 1 : m === 'ARS' ? dolar?.bolsa?.venta ?? dolar?.oficial?.venta ?? null : fx?.[m] ?? null)
    const filas: FilaInsightAd[] = []
    for (const c of cuentas) {
      const resp = ins.ok[c.id]
      if (!resp) continue
      for (const f of await todasLasPaginas(resp.body)) {
        const acciones = Array.isArray(f.actions) ? (f.actions as { action_type?: string; value?: string }[]) : []
        filas.push({
          cuentaId: c.id, cliente: c.cliente, adId: String(f.ad_id ?? ''), nombre: String(f.ad_name ?? ''), moneda: String(f.account_currency ?? 'USD'),
          campana: String(f.campaign_name ?? ''),
          gasto: parseFloat(String(f.spend ?? '0')) || 0,
          mensajes: parseInt(acciones.find(a => a.action_type === ACCION_MENSAJE)?.value ?? '0', 10) || 0,
        })
      }
    }
    const agrupados = agruparAnuncios(filas, usdPor)
    // País por cuenta, con todas sus filas (moneda + nombres de campaña)
    const paisPorCuenta = new Map(cuentas.map(c => {
      const suyas = filas.filter(f => f.cuentaId === c.id)
      return [c.id, suyas.length ? paisDeCuenta(suyas[0].moneda, [...new Set(suyas.map(f => f.campana ?? ''))]) : null] as const
    }))
    // Texto del anuncio solo de los mejores (de a 50 ids por subpedido): el nombre a veces es genérico o de otra rama
    const top = agrupados.slice(0, TOPE_COPY)
    const CAMPOS = encodeURIComponent('creative{body,object_story_spec{video_data{message},link_data{message}},asset_feed_spec{bodies}}')
    const pedidosCopy: { id: string; url: string }[] = []
    for (let i = 0; i < top.length; i += 50) pedidosCopy.push({ id: `copy${i}`, url: `?ids=${top.slice(i, i + 50).map(t => t.adPrincipal).join(',')}&fields=${CAMPOS}` })
    type Lote = Awaited<ReturnType<typeof batchConTokens>>
    const vacio: Lote = { ok: {}, errores: {} }
    // Sin el texto se sigue igual (el nombre del anuncio alcanza para la mayoría): no tumba la lectura
    const cre: Lote = pedidosCopy.length ? await batchConTokens(pedidosCopy).catch(() => vacio) : vacio
    const ads = Object.assign({}, ...Object.values(cre.ok).map(x => x.body as Record<string, unknown>)) as Record<string, { creative?: Record<string, unknown> }>
    const copyDe = (id: string): string | null => {
      const cr = (ads[id]?.creative ?? {}) as { body?: string; object_story_spec?: { video_data?: { message?: string }; link_data?: { message?: string } }; asset_feed_spec?: { bodies?: { text?: string }[] } }
      const t = cr.body ?? cr.object_story_spec?.video_data?.message ?? cr.asset_feed_spec?.bodies?.[0]?.text ?? cr.object_story_spec?.link_data?.message ?? null
      return t ? String(t).replace(/https?:\/\/\S+/g, '[link]').slice(0, 1200) : null
    }
    return {
      rama, generado: new Date().toISOString(), ventana,
      cuentas,
      candidatos: top.map(t => ({ ...t, copy: copyDe(t.adPrincipal), pais: paisPorCuenta.get(t.cuentaId) ?? null })),
      erroresCuentas: Object.keys(ins.errores).length,
      nota: avisos.join(' · '),
    }
  })
  return r.viejo ? { ...r.data, nota: [r.data.nota, 'dato de antes: Meta no respondió ahora'].filter(Boolean).join(' · ') } : r.data
}
