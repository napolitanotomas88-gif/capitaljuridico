// ── "Por lanzar" con la ficha de kickoff: lo que Valentino necesita para armar la campaña de cada cliente nuevo ──────
// Desde el 24/10/2026 la tarjeta de ClickUp "Seguimiento de Anuncios" se reemplaza por la FICHA DE KICKOFF del Despacho
// (Neon, tabla cj_kickoffs, ver docs/BOT-KICKOFF-CJ.md). Pedido de Tomás: que el media buyer vea en el tablero todo lo
// que necesita para lanzar a cada cliente nuevo sin abrir la ficha. Todo lo de acá es PURO (sin red ni base: se prueba en
// scripts/test-anuncios-por-lanzar.mjs); la lectura de Neon está en kickoffs.ts.
//   · resumirKickoff: una fila de cj_kickoffs → lo que muestra la tarjeta. Pasa por armarVista (lib/bot/kickoff/vista.ts),
//     la MISMA vista de la pantalla de la ficha: lectura defensiva del jsonb, ningún mail, los faltantes recalculados con
//     los tildes y las marcas hechas a mano, la lectura del mapa desde el video. De ahí se queda solo con lo de lanzar: sin
//     ideas, ganadores, acuerdos ni citas de la llamada.
//   · resumirKickoffs: de las filas "lista" que son kickoff legible, la más nueva de cada cliente que da tarjeta (una que
//     no se puede leer no tapa a una anterior que sí). El cliente se reconoce por el id Y por el nombre del CRM (una ficha
//     con id y otra sin id del mismo cliente son una sola); sin cliente del CRM, por el nombre que se escuchó.
//   · cuentasDelCliente: la heurística de antes del 24/10 (las cuentas visibles cuyo nombre se parece al del cliente), con
//     CÓMO llegó cada una: a mano, dos palabras en común o un solo apellido (débil).
//   · cruzarKickoffs: cada cliente de "Por lanzar" con su ficha. El tablero no lee los IDs del CRM (solo nombre y estado de
//     Agencia), así que se cruza 1) por el NOMBRE del CRM que guardó la ficha, con el mismo cruce del tablero
//     (opcionesCruceTablero: normTxt + buscarCliente de cruce.ts) y 2) si no alcanza, por la cuenta publicitaria que
//     revisó la ficha, solo si el tablero se la asoció al cliente con algo firme (a mano o dos palabras): con un apellido
//     solo le pegaría la ficha de otra clienta. Una ficha que entra por la cuenta y está a nombre de otro (o de nadie) en
//     el CRM queda "a confirmar".
//   · Con cuenta en la ficha, el acceso es el de ESA cuenta: el token la ve (y está libre) o ya gasta en el tablero con otro
//     nombre. Las que el tablero adivinó por el nombre quedan como "también visibles", y la cuenta de una ficha se le saca
//     a cualquier otro cliente que la tuviera solo por el nombre. Sin cuenta en la ficha, el acceso es el de antes.
//   · Grupos y orden (grupoPorLanzar): listos para armar (ficha + acceso + nada que frene ni que confirmar) · con ficha, a
//     revisar · con ficha, sin acceso · con ficha, ya gastan con otro nombre; los de ficha, de la kickoff más vieja a la más
//     nueva (la que más espera, arriba). Después los sin ficha, como hasta ahora: sin acceso primero y por nombre.
//   · Fichas sueltas: las que no cruzaron con nadie, de clientes que no están en el CRM de Agencia (o sin cliente del CRM)
//     y sin fila: van a los avisos de "Por lanzar" (avisosFichasSueltas), para que no se pierdan.
//   · Sin lectura de la base (falló, tardó o no hay DATABASE_URL): kickoffs = null y todo queda como antes del 24/10, sin
//     la marca "sin ficha de kickoff" (no se sabe si la tiene).
import { armarVista, esFichaKickoff, ordenarFilas, taparMails, type VistaKickoff } from '@/lib/bot/kickoff/vista'
import type { FilaFichaCliente } from '@/lib/bot/kickoff/registro'
import { NOMBRE_ITEM_PORTFOLIO, type ItemPortfolio } from '@/lib/bot/kickoff/tipos'
import { normTxt } from './cruce'

// ── Lo que muestra la tarjeta ──
export interface MomentoLanzar { href: string; etiqueta: string }   // "▶ ≈17:18": link a la grabación de Fathom en ese segundo
// leido: el recorte se leyó del video y coincide · anotado: alguien lo anotó a mano en la ficha · revisar: el video dice
// otra cosa que lo dicho y nadie lo revisó · leyendo: el bot lo está leyendo · pendiente: falta el recorte (verlo en la grabación)
export type EstadoMapaLanzar = 'leido' | 'anotado' | 'revisar' | 'leyendo' | 'pendiente'
export interface FrenoPortfolio {
  item: ItemPortfolio
  nombre: string                   // corto: "Tarjeta", "Accesos del equipo"
  estado: 'falta' | 'problema' | 'para_tildar'
  detalle: string
  frena: boolean                   // falta / problema (según Meta, la llamada o el tilde a mano); para_tildar = nadie lo resolvió
}
export interface KickoffPorLanzar {
  recordingId: number
  idCrm: string | null
  clienteCRM: string | null        // el nombre del CRM que guardó la ficha (para el cruce); null = el bot no la cruzó con el CRM
  clienteOido: string | null       // el nombre que se escuchó en la llamada (para nombrar una ficha sin cliente del CRM)
  link: string | null              // la ficha en el Despacho (/clientes/<id>/kickoff, pide login de Google); null sin id del CRM
  fathom: string | null            // la grabación (solo fathom.video)
  fecha: string | null             // "vie 23/10 09:00"
  fechaIso: string | null
  quien: string | null             // la cuenta de Fathom que la grabó (Tomás o Gero M): si grabaron los dos, la que llegó primero, que no es necesariamente quien llevó la llamada
  cuenta: { id: string; nombre: string | null; monedaHora: string } | null   // la que revisó la ficha en Meta
  cuentaAviso: string | null       // Meta no pudo leer la cuenta (y qué hacer)
  rama: { nombre: string | null; texto: string; subramas: string[] }
  avatar: { incluye: string[]; excluye: string[] }
  zona: {
    pais?: string | null           // ISO de la ficha; no adivinar Argentina al armar una campaña
    lugares: string[]
    descripcion: string            // solo si no hay lugares
    radioKm: number | null
    presentarse: { texto: string; cuando: string } | null
    mapa: { estado: EstadoMapaLanzar; texto: string; momento: MomentoLanzar | null } | null   // null = no hubo mapa en pantalla
  }
  presupuesto: { texto: string; aConfirmar: boolean }
  lanzamiento: { fecha: string | null; texto: string }   // fecha: la estimada cargada a mano en la ficha; texto: lo que sale de los acuerdos
  whatsapp: string | null          // el WhatsApp de destino cargado a mano en la ficha
  frenos: FrenoPortfolio[]         // lo del portfolio que no está ok: primero lo que frena (accesos y tarjeta antes)
  ojos: string[]                   // lo del portfolio que Meta y la llamada ven distinto (no frena: revisar), "Tarjeta: Meta dice «ok»…"
  otrosFaltantes: string[]         // lo que queda en la ficha y no es del portfolio ni del mapa (moneda, cuenta en el CRM…)
  ideas: string                    // cómo va la revisión de las ideas de guiones (Tomi y Gero M)
}

// ── Las cuentas de un cliente de "Por lanzar" ──
/** Cómo llegó una cuenta a un cliente de "Por lanzar": a mano (AJUSTES_CUENTA), dos palabras del nombre en común, un solo
 *  apellido distintivo (débil: no alcanza para pegarle una ficha) o la cuenta que revisó su ficha de kickoff. */
export type PorCuenta = 'manual' | 'nombre' | 'apellido' | 'ficha'
export interface CuentaPorLanzar { id: string; nombre: string; estado: number; por: PorCuenta }
/** Qué pasa en el tablero con la cuenta que revisó la ficha. */
export type CuentaFicha =
  | { estado: 'visible'; cuenta: { id: string; nombre: string; estado: number } }   // el token la ve y está libre: da el acceso
  | { estado: 'con_fila'; cliente: string }     // ya tiene fila (gasta) a nombre de ese cliente: el CRM no lo cruza por el nombre
  | { estado: 'excluida'; motivo: string }      // el tablero no la sigue: ex-cliente, cerrada en Meta, quitada a mano o la propia
  | { estado: 'no_visible' }                    // el token no la ve: falta el acceso
  | { estado: 'sin_dato' }                      // no se pudieron listar las cuentas de Meta: no se sabe
// listo: ficha + acceso + nada que frene ni que confirmar · revisar: ficha (con acceso o con la cuenta fuera del tablero) y
// algo que frena o que confirmar · sin_acceso: ficha, el tablero no ve su cuenta · ya_gasta: la cuenta de la ficha ya
// tiene fila con otro nombre · los sin ficha, como antes
export type GrupoPorLanzar = 'listo' | 'revisar' | 'sin_acceso' | 'ya_gasta' | 'sin_ficha_sin_acceso' | 'sin_ficha_con_acceso'
const ORDEN_GRUPO: GrupoPorLanzar[] = ['listo', 'revisar', 'sin_acceso', 'ya_gasta', 'sin_ficha_sin_acceso', 'sin_ficha_con_acceso']

/** Lo mínimo de un cliente de "Por lanzar" para cruzarlo (PorLanzar de tablero.ts lo cumple). */
export interface BasePorLanzar {
  cliente: string
  acceso: 'si' | 'no'
  cuentas: CuentaPorLanzar[]
}
export interface ConKickoff {
  kickoff: KickoffPorLanzar | null
  sinFicha: boolean                // se leyó la base y no hay ficha "lista" de este cliente (con la base caída queda false)
  cuentaFicha: CuentaFicha | null  // null: sin ficha, o la ficha no identificó la cuenta
  confirmar: string | null         // la ficha entró por la cuenta y está a nombre de otro (o de nadie) en el CRM
  grupo: GrupoPorLanzar
}
/** Una ficha que no cruzó con ningún cliente de "Por lanzar" ni con una fila: va a los avisos. */
export interface FichaSuelta { recordingId: number; cliente: string | null; verificado: boolean; fecha: string | null; fechaIso: string | null }

// ── Lectura defensiva (la ficha es jsonb de la base: puede venir de una versión vieja) ──
type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {})
const str = (x: unknown): string => (typeof x === 'string' ? taparMails(x.replace(/\s+/g, ' ').trim()) : '')
const RE_CUENTA = /^act_\d{5,20}$/
// Misma forma que ID_CRM_VALIDO de lib/bot/kickoff/registro.ts (no se importa: arrastra el cliente de Neon)
const RE_ID_CRM = /^[A-Za-z]\d{1,6}$/
const NOMBRE_CORTO: Record<ItemPortfolio, string> = Object.fromEntries(
  (Object.keys(NOMBRE_ITEM_PORTFOLIO) as ItemPortfolio[]).map(k => [k, NOMBRE_ITEM_PORTFOLIO[k].replace(/\s*\(.*\)$/, '')]),
) as Record<ItemPortfolio, string>
// Lo que frena primero: sin accesos Valentino no entra y sin tarjeta la campaña no sale
const PRIORIDAD_FRENO: ItemPortfolio[] = ['accesos_equipo', 'tarjeta', 'verificacion', 'pagina_facebook', 'portfolio_comercial', 'whatsapp_business', 'instagram']

/** La ficha en el Despacho. `base`: DESPACHO_URL o el dominio de producción (lo resuelve kickoffs.ts). */
export const linkFicha = (base: string, idCrm: string | null): string | null =>
  idCrm && RE_ID_CRM.test(idCrm) ? `${base.replace(/\/+$/, '')}/clientes/${encodeURIComponent(idCrm.toUpperCase())}/kickoff` : null

/** El mapa de la zona para la tarjeta: lo anotado, lo leído del video o qué falta (misma prioridad que el aviso a Valentino). */
function mapaDe(v: VistaKickoff): KickoffPorLanzar['zona']['mapa'] {
  const z = v.lanzar.zona, video = v.zona.video
  if (!v.zona.mapa && !video) return null
  const momento = z.momento ? { href: z.momento.href, etiqueta: z.momento.etiqueta } : null
  if (z.revisar) {
    const que = [z.video ? `según el video: ${z.video}` : '', z.nota ? `anotado antes: ${z.nota}` : ''].filter(Boolean).join(' · ')
    return { estado: 'revisar', texto: `Revisar con Tomi: el mapa del video no coincide del todo con lo dicho${que ? ` (${que})` : ''}`, momento }
  }
  if (z.nota) return { estado: 'anotado', texto: `Recorte anotado en la ficha: ${z.nota}`, momento }
  if (z.video) return { estado: 'leido', texto: `Recorte leído del mapa del video: ${z.video}`, momento }
  if (z.leyendo) return { estado: 'leyendo', texto: 'Mapa pendiente: el bot lo está leyendo del video (en unos minutos queda en la ficha)', momento }
  // El porqué de la lectura que no sirvió (la vista lo trae con mayúscula: acá va entre paréntesis)
  const porque = (video && video.estado !== 'ok' ? video.texto : video && !video.util ? 'el mapa del video no deja leer el recorte' : '').replace(/\.$/, '')
  return { estado: 'pendiente', texto: `Mapa pendiente: el recorte se marcó en pantalla en la llamada y todavía no está anotado${porque ? ` (${porque[0].toLowerCase()}${porque.slice(1)})` : ''}`, momento }
}

/** Lo del portfolio que no está ok, con lo que frena primero. Los tildes a mano mandan (los aplica armarVista). */
function frenosDe(v: VistaKickoff): FrenoPortfolio[] {
  const out: FrenoPortfolio[] = []
  for (const f of v.portfolio.filas) {
    const e = f.visto.estado
    if (e === 'ok') continue
    if (e === 'falta' || e === 'problema') {
      const nota = f.check?.nota ? ` · ${str(f.check.nota)}` : ''
      out.push({ item: f.item, nombre: NOMBRE_CORTO[f.item], estado: e, detalle: `${f.visto.aMano ? `tildado a mano${f.check?.quien ? ` por ${f.check.quien}` : ''}${nota}` : f.detalle}`, frena: true })
    } else if (f.tildable && !f.check) {
      out.push({ item: f.item, nombre: NOMBRE_CORTO[f.item], estado: 'para_tildar', detalle: f.detalle, frena: false })
    }
  }
  const p = (x: FrenoPortfolio) => PRIORIDAD_FRENO.indexOf(x.item)
  return out.sort((a, b) => Number(b.frena) - Number(a.frena) || p(a) - p(b))
}

// Los faltantes del portfolio que la tarjeta ya muestra como frenos o para tildar. La discrepancia ("Portfolio · X: ojo:
// Meta dice «ok», en la llamada se dijo «falta»… : revisar") NO es un freno (Meta dice ok): sale aparte, en `ojos`.
const NOMBRES_ITEM = Object.values(NOMBRE_ITEM_PORTFOLIO).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const RE_FALTANTE_PORTFOLIO = new RegExp(`^Portfolio (para tildar a mano|· (${NOMBRES_ITEM}):(?! ojo:))`)
const RE_OJO_PORTFOLIO = new RegExp(`^Portfolio · (${NOMBRES_ITEM}): ojo: (.+?)(?::\\s*revisar)?$`)
const CORTO_POR_NOMBRE = new Map((Object.keys(NOMBRE_ITEM_PORTFOLIO) as ItemPortfolio[]).map(k => [NOMBRE_ITEM_PORTFOLIO[k], NOMBRE_CORTO[k]]))

/**
 * La tarjeta de una fila de cj_kickoffs. null = no es una kickoff "lista" legible. `base`: el dominio del Despacho para el
 * link a la ficha. `ahoraMs`: para dar por cortada una lectura del mapa que quedó colgada (lo mismo que la pantalla).
 */
export function resumirKickoff(fila: FilaFichaCliente, op: { base: string; ahoraMs?: number }): KickoffPorLanzar | null {
  if (fila.estado !== 'lista') return null
  const v = armarVista(fila, op.ahoraMs ?? Date.now())
  if (!v || !v.encabezado.esKickoff) return null
  const ficha = obj(fila.ficha), cli = obj(ficha.cliente), meta = obj(ficha.portfolio_meta)
  const idCrm = (str(cli.id_crm) || str(fila.id_crm)).toUpperCase() || null
  const cuentaId = str(meta.cuenta)
  const datos = new Map(v.lanzar.datos.map(d => [d.clave, d.marca?.nota ? str(d.marca.nota) : null]))
  const presentarse = v.zona.presentarse ? { texto: v.zona.presentarse.texto, cuando: v.zona.presentarse.cuando } : null
  // Meta no leyó la cuenta: su aviso va con la cuenta (cuentaAviso) y no se repite en "también falta" ("Portfolio en Meta…")
  const avisoConCuenta = meta.leido !== true
  return {
    recordingId: v.recording_id,
    idCrm: idCrm && RE_ID_CRM.test(idCrm) ? idCrm : null,
    clienteCRM: str(cli.cliente_crm) || str(fila.cliente_crm) || null,
    clienteOido: str(cli.nombre_escuchado) || null,
    link: linkFicha(op.base, idCrm),
    fathom: v.encabezado.fathom,
    fecha: v.encabezado.fecha,
    fechaIso: v.encabezado.fechaIso,
    quien: v.encabezado.quien,
    cuenta: RE_CUENTA.test(cuentaId) ? { id: cuentaId, nombre: str(meta.nombre) || null, monedaHora: v.lanzar.monedaHora } : null,
    cuentaAviso: !avisoConCuenta ? null
      : [v.portfolio.meta.lineas[0] ?? '', v.portfolio.meta.aviso ?? ''].filter(Boolean).join(' · ') || null,
    rama: { nombre: v.rama.principal, texto: v.rama.texto, subramas: v.rama.subramas.map(d => d.texto) },
    avatar: {
      incluye: v.avatar.incluye.map(d => d.texto),
      excluye: v.avatar.excluye.map(d => d.texto.replace(/^nada de\s+/i, '')),
    },
    zona: {
      pais: v.zona.pais,
      lugares: v.zona.lugares,
      descripcion: v.zona.lugares.length ? '' : v.zona.descripcion.texto,
      radioKm: v.zona.radioKm,
      presentarse,
      mapa: mapaDe(v),
    },
    presupuesto: { texto: v.presupuesto.texto, aConfirmar: v.presupuesto.certeza !== 'Confirmado' || v.presupuesto.deducido },
    lanzamiento: { fecha: datos.get('fecha_lanzamiento') ?? null, texto: v.lanzar.lanzamiento },
    whatsapp: datos.get('whatsapp_destino') ?? null,
    frenos: frenosDe(v),
    ojos: v.faltantes.flatMap(x => {
      const m = RE_OJO_PORTFOLIO.exec(x.texto)
      return m ? [`${CORTO_POR_NOMBRE.get(m[1]) ?? m[1]}: ${m[2]}`] : []
    }),
    otrosFaltantes: v.faltantes
      .filter(x => x.clave !== 'zona_mapa' && x.clave !== 'zona_mapa_video' && !RE_FALTANTE_PORTFOLIO.test(x.texto)
        && !RE_OJO_PORTFOLIO.test(x.texto) && !(avisoConCuenta && /^Portfolio en Meta\b/.test(x.texto)))
      .map(x => x.texto),
    ideas: v.ideas.texto,
  }
}

/**
 * Las claves del cliente de una fila: el id del CRM y el nombre del CRM normalizado, las dos (una ficha con id y otra sin id
 * del mismo cliente son una sola). Sin cliente del CRM, el nombre que se escuchó; sin nada, la grabación (no se agrupa).
 */
function clavesCliente(f: FilaFichaCliente): string[] {
  const cli = obj(obj(f.ficha).cliente)
  const id = (str(cli.id_crm) || str(f.id_crm)).toUpperCase()
  const nombre = normTxt(str(cli.cliente_crm) || str(f.cliente_crm))
  const claves = [RE_ID_CRM.test(id) ? id : '', nombre ? `nombre:${nombre}` : ''].filter(Boolean)
  if (claves.length) return claves
  const oido = normTxt(str(cli.nombre_escuchado))
  return [oido ? `oido:${oido}` : `grabacion:${f.recording_id}`]
}
// Lista, legible (la forma mínima de la ficha: esFichaKickoff, la que pide armarVista) y kickoff
const esKickoffLista = (f: FilaFichaCliente) => f.estado === 'lista' && esFichaKickoff(f.ficha) && f.ficha.tipo_reunion === 'kickoff'

/** La más nueva de cada cliente (por la fecha de la grabación) entre las que `tarjeta` acepta: una que no da no tapa a otra. */
function unaPorCliente<T>(filas: FilaFichaCliente[], tarjeta: (f: FilaFichaCliente) => T | null): T[] {
  const vistas = new Set<string>(), out: T[] = []
  for (const f of ordenarFilas(filas.filter(esKickoffLista))) {
    const claves = clavesCliente(f)
    if (claves.some(k => vistas.has(k))) continue
    const t = tarjeta(f)
    if (t == null) continue
    for (const k of claves) vistas.add(k)
    out.push(t)
  }
  return out
}

/** De todas las filas, la kickoff "lista" legible más nueva de cada cliente. */
export const ultimasPorCliente = (filas: FilaFichaCliente[]): FilaFichaCliente[] => unaPorCliente(filas, f => f)

/** Las tarjetas de todas las filas (la última kickoff lista de cada cliente que da tarjeta). */
export const resumirKickoffs = (filas: FilaFichaCliente[], op: { base: string; ahoraMs?: number }): KickoffPorLanzar[] =>
  unaPorCliente(filas, f => resumirKickoff(f, op))

// ── Las cuentas visibles de un cliente sin fila (la heurística del tablero, de antes del 24/10) ──
const NOMBRES_COMUNES = new Set(['maria', 'jose', 'juan', 'laura', 'gabriela', 'florencia', 'daniel', 'carlos', 'javier', 'jorge', 'luis', 'pablo', 'claudia', 'andrea', 'lucas', 'ana', 'del', 'los', 'las', 'abogado', 'abogada', 'abogados', 'estudio', 'juridico', 'asociados', 'legal', 'usd', 'gonzalo', 'manuel', 'esteban', 'ernesto', 'alejandro', 'teresita', 'cristina', 'antonia', 'nicolas', 'eduardo', 'francisco', 'fernando', 'sebastian', 'martin', 'roberto', 'ricardo', 'alberto', 'monica', 'veronica', 'mariano', 'santiago', 'geraldina', 'geraldine', 'daniela', 'daiana', 'agustina', 'sofia', 'valentina', 'lourdes', 'belen'])
/** Las palabras de un nombre que sirven para cruzarlo con una cuenta (sin nombres de pila comunes ni palabras genéricas). */
export const tokensNombre = (s: string): string[] =>
  [...new Set(normTxt(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !NOMBRES_COMUNES.has(t)))]
export interface CandidataCuenta { id: string; nombre: string; estado: number; negocio?: { nombre: string } | null }

/**
 * Las cuentas visibles y libres (sin fila, no excluidas) que el tablero le asocia a un cliente sin fila, con cómo: la de
 * AJUSTES_CUENTA (`manual`), dos palabras en común o un apellido distintivo (6 letras o más). `tokFilas`: las palabras de
 * clientes que ya tienen fila (no sirven para cruzar a otro).
 */
export function cuentasDelCliente(cliente: string, candidatas: CandidataCuenta[], op: { manual?: string | null; tokFilas: ReadonlySet<string> }): CuentaPorLanzar[] {
  const t = tokensNombre(cliente).filter(k => !op.tokFilas.has(k))
  const out: CuentaPorLanzar[] = []
  for (const a of candidatas) {
    const comunes = t.filter(k => tokensNombre(`${a.nombre} ${a.negocio?.nombre ?? ''}`).includes(k))
    const por: PorCuenta | null = a.id === op.manual ? 'manual' : comunes.length >= 2 ? 'nombre' : comunes.some(k => k.length >= 6) ? 'apellido' : null
    if (por) out.push({ id: a.id, nombre: a.nombre, estado: a.estado, por })
  }
  return out
}

// ── El cruce ──
export interface OpcionesCruce {
  /** ¿El nombre del CRM que guardó la ficha es este cliente del CRM? (opcionesCruceTablero: normTxt + buscarCliente de cruce.ts) */
  mismoCliente: (nombreFicha: string, nombreCRM: string) => boolean
  /** Qué pasa en el tablero con la cuenta de la ficha. */
  cuentaFicha: (id: string) => CuentaFicha
  /** ¿El cliente está en el CRM de Agencia (con cualquier estado)? Una ficha suelta de un cliente que sí está no es un aviso: ya lanzó, se fue o está en pausa. */
  enCRM: (nombreCRM: string) => boolean
}

/**
 * Las opciones del cruce con los datos del tablero. `visibles`: las cuentas que el token ve y están libres (las candidatas de
 * tablero.ts) · `filas`: las del tablero · `excluida`: por qué el tablero no sigue una cuenta, o null · `descubrimientoOk`:
 * si se pudieron listar las cuentas de Meta (si no, una cuenta que no aparece "no se sabe").
 */
export function opcionesCruceTablero(o: {
  buscarCliente: (nombre: string) => { nombre: string } | null
  visibles: { id: string; nombre: string; estado: number }[]
  filas: { id: string; cliente: string }[]
  excluida: (id: string) => string | null
  descubrimientoOk: boolean
}): OpcionesCruce {
  const visibles = new Map(o.visibles.map(c => [c.id, { id: c.id, nombre: c.nombre, estado: c.estado }]))
  const filaDe = new Map(o.filas.map(f => [f.id, f.cliente]))
  return {
    mismoCliente: (ficha, crm) => normTxt(ficha) === normTxt(crm) || normTxt(o.buscarCliente(ficha)?.nombre ?? '') === normTxt(crm),
    cuentaFicha: id => {
      const fila = filaDe.get(id)
      if (fila) return { estado: 'con_fila', cliente: fila }
      const motivo = o.excluida(id)
      if (motivo) return { estado: 'excluida', motivo }
      const v = visibles.get(id)
      if (v) return { estado: 'visible', cuenta: v }
      return o.descubrimientoOk ? { estado: 'no_visible' } : { estado: 'sin_dato' }
    },
    enCRM: nombre => !!o.buscarCliente(nombre),
  }
}

const tiempo = (k: KickoffPorLanzar | null) => (k?.fechaIso ? Date.parse(k.fechaIso) || 0 : 0)
const FIRMES: PorCuenta[] = ['manual', 'nombre']

/** El grupo de un cliente de "Por lanzar" en la pantalla (y su orden). */
export function grupoPorLanzar(x: Pick<BasePorLanzar, 'acceso'> & Pick<ConKickoff, 'kickoff' | 'cuentaFicha' | 'confirmar'>): GrupoPorLanzar {
  if (!x.kickoff) return x.acceso === 'si' ? 'sin_ficha_con_acceso' : 'sin_ficha_sin_acceso'
  if (x.cuentaFicha?.estado === 'con_fila') return 'ya_gasta'
  if (x.acceso === 'si' && !x.confirmar && !x.kickoff.frenos.some(f => f.frena)) return 'listo'
  return x.acceso === 'no' && x.cuentaFicha?.estado !== 'excluida' ? 'sin_acceso' : 'revisar'
}

/** Lo que se le muestra a Valentino cuando la ficha entró por la cuenta y el CRM no dice que sea de este cliente. */
function textoConfirmar(k: KickoffPorLanzar): string {
  const cuenta = k.cuenta ? ` ${k.cuenta.id}` : ''
  return k.clienteCRM
    ? `Ficha guardada a nombre de «${k.clienteCRM}», cruzada por la cuenta${cuenta}: confirmar que es este cliente`
    : `Ficha sin cliente del CRM${k.clienteOido ? ` (en la llamada: «${k.clienteOido}»)` : ''}, cruzada por la cuenta${cuenta}: confirmar que es este cliente`
}

/**
 * Suma a cada cliente de "Por lanzar" su ficha de kickoff, lo agrupa y los ordena; devuelve también las fichas sueltas.
 * `kickoffs` null = no se pudo leer la base: quedan como antes (sin ficha ni marca, sin sueltas). Una ficha se usa una sola
 * vez: primero los cruces por nombre, después por cuenta.
 */
export function cruzarKickoffs<T extends BasePorLanzar>(items: T[], kickoffs: KickoffPorLanzar[] | null, op: OpcionesCruce): { porLanzar: (T & ConKickoff)[]; sueltas: FichaSuelta[] } {
  const fichas = kickoffs ?? []
  const usadas = new Set<number>()
  const elegida = new Map<number, { k: KickoffPorLanzar; porCuenta: boolean }>()
  const masNueva = (xs: KickoffPorLanzar[]) => [...xs].sort((a, b) => tiempo(b) - tiempo(a))[0] ?? null
  // 1. Por el nombre del CRM
  items.forEach((it, i) => {
    const k = masNueva(fichas.filter(x => !usadas.has(x.recordingId) && !!x.clienteCRM && op.mismoCliente(x.clienteCRM, it.cliente)))
    if (k) { usadas.add(k.recordingId); elegida.set(i, { k, porCuenta: false }) }
  })
  // 2. Por la cuenta publicitaria que revisó la ficha, si el tablero se la asoció a este cliente con algo firme (a mano o
  //    dos palabras): con un solo apellido («Laura Fernández» ↔ «USD FERNANDEZ RUIZ») le pegaría la ficha de otra clienta
  items.forEach((it, i) => {
    if (elegida.has(i)) return
    const ids = new Set(it.cuentas.filter(c => FIRMES.includes(c.por)).map(c => c.id))
    const k = masNueva(fichas.filter(x => !usadas.has(x.recordingId) && !!x.cuenta && ids.has(x.cuenta.id)))
    if (k) { usadas.add(k.recordingId); elegida.set(i, { k, porCuenta: true }) }
  })
  // 3. La cuenta de una ficha es de SU cliente (el de la ficha a la que se cruzó, o el de una ficha suelta): a los demás se
  //    les saca si la tenían solo por el nombre. La de AJUSTES_CUENTA queda.
  const duenio = new Map<string, number>()   // cuenta → índice del cliente que tiene esa ficha (-1: ninguno de "Por lanzar")
  for (const k of fichas) if (k.cuenta) duenio.set(k.cuenta.id, -1)
  for (const [i, { k }] of elegida) if (k.cuenta) duenio.set(k.cuenta.id, i)

  const out = items.map((it, i): T & ConKickoff => {
    const e = elegida.get(i) ?? null, k = e?.k ?? null
    let cuentas = it.cuentas.filter(c => c.por === 'manual' || !duenio.has(c.id) || duenio.get(c.id) === i)
    if (!k) {
      const acceso = cuentas.length ? 'si' as const : 'no' as const
      return { ...it, cuentas, acceso, kickoff: null, sinFicha: !!kickoffs, cuentaFicha: null, confirmar: null, grupo: grupoPorLanzar({ acceso, kickoff: null, cuentaFicha: null, confirmar: null }) }
    }
    // Con cuenta en la ficha, el acceso es el de ESA cuenta: la ve el token (va primera) o ya gasta con otro nombre. Las
    // que el tablero adivinó por el nombre quedan como "también visibles", sin dar acceso.
    const cuentaFicha = k.cuenta ? op.cuentaFicha(k.cuenta.id) : null
    if (cuentaFicha?.estado === 'visible') cuentas = [{ ...cuentaFicha.cuenta, por: 'ficha' }, ...cuentas.filter(c => c.id !== cuentaFicha.cuenta.id)]
    const acceso = cuentaFicha ? (cuentaFicha.estado === 'visible' || cuentaFicha.estado === 'con_fila' ? 'si' as const : 'no' as const)
      : cuentas.length ? 'si' as const : 'no' as const
    const confirmar = e?.porCuenta ? textoConfirmar(k) : null
    return { ...it, cuentas, acceso, kickoff: k, sinFicha: false, cuentaFicha, confirmar, grupo: grupoPorLanzar({ acceso, kickoff: k, cuentaFicha, confirmar }) }
  })
  const porLanzar = out.sort((a, b) => ORDEN_GRUPO.indexOf(a.grupo) - ORDEN_GRUPO.indexOf(b.grupo)
    || (a.kickoff && b.kickoff ? tiempo(a.kickoff) - tiempo(b.kickoff) : 0)
    || a.cliente.localeCompare(b.cliente, 'es'))
  // Sueltas: no cruzaron con nadie, su cuenta no gasta en el tablero y el cliente no está en el CRM de Agencia (o la ficha
  // no tiene cliente del CRM). Las de clientes que sí están (ya lanzaron, se fueron, en pausa) no son un aviso.
  const sueltas = fichas
    .filter(k => !usadas.has(k.recordingId) && !(k.cuenta && op.cuentaFicha(k.cuenta.id).estado === 'con_fila') && !(k.clienteCRM && op.enCRM(k.clienteCRM)))
    .sort((a, b) => tiempo(a) - tiempo(b))
    .map(k => ({ recordingId: k.recordingId, cliente: k.clienteCRM ?? k.clienteOido, verificado: !!k.clienteCRM, fecha: k.fecha, fechaIso: k.fechaIso }))
  return { porLanzar, sueltas }
}

/** Una ficha suelta vieja ya no es un aviso (la kickoff → el lanzamiento lleva días, no meses). */
export const DIAS_FICHA_SUELTA = 60
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Los avisos de "Por lanzar" por las fichas sueltas recientes (las de los últimos DIAS_FICHA_SUELTA días; sin fecha, también). */
export function avisosFichasSueltas(xs: FichaSuelta[], ahoraMs: number = Date.now()): string[] {
  const desde = ahoraMs - DIAS_FICHA_SUELTA * 86_400_000
  const recientes = xs.filter(x => !x.fechaIso || !(Date.parse(x.fechaIso) < desde))
  const de = (x: FichaSuelta) => `«${x.cliente ?? 'sin nombre'}»${x.fecha ? ` (kickoff ${x.fecha})` : ''}`
  const con = recientes.filter(x => x.verificado), sin = recientes.filter(x => !x.verificado)
  const out: string[] = []
  if (con.length) out.push(`${plural(con.length, 'ficha', 'fichas')} de kickoff de clientes que no están en el CRM de Agencia ni gastan en el tablero: ${con.map(de).join(' · ')}. ${con.length === 1 ? 'Cargarlo' : 'Cargarlos'} en el CRM (ACTIVO) para que ${con.length === 1 ? 'aparezca' : 'aparezcan'} en «Por lanzar».`)
  if (sin.length) {
    const la = sin.length === 1 ? 'la' : 'las'
    out.push(`${plural(sin.length, 'ficha', 'fichas')} de kickoff sin cliente del CRM (el bot no ${la} pudo cruzar; nombre escuchado en la llamada): ${sin.map(de).join(' · ')}. Avisarle a Tomi para que ${la} cruce con el cliente.`)
  }
  return out
}
