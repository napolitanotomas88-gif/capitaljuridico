// ── Aviso de Discord: "📝 Kickoff · Cliente — ideas de guiones para revisar" ──────────────────────
// Puro (sin red). Lo reciben Tomi (Tomás) y Gero M (Gerónimo Mozzi), mencionados con <@ID> desde DISCORD_ID_TOMAS y
// DISCORD_ID_GERO_M; hasta que exista el bot de WhatsApp va por Discord (decisión de Tomás, 24/10/2026). Formato:
//   <@TOMI> <@GERO_M> 📝 **Kickoff · Cliente — ideas de guiones para revisar**
//   📞 Kickoff de Tomás · vie 23/10 09:00 · [Fathom](<url>)   ← quién la hizo (Tomás o Gero M)
//   ⚖️ Rama (subramas cortas) · 👤 Avatar (los filtros, solo acá: «✋ afuera:» sin el contexto del mercado) · 📍 Zona
//      (primero los lugares, al final cómo se presenta) · 💵 Presupuesto (con cuánto se arranca)
//   🧾 Portfolio: 5/7 ok según Meta · falta: … · ➜ qué hacer según Meta · a tildar: Instagram, WhatsApp (de portfolio_final)
//   💡 Ideas (1–5, título y gancho)
//   🏆 cuántas ideas se apoyan en ganadores de Meta y en cuáles (G1…: sin nombres de otros clientes ni sus números)
//   ✍️ Los guiones ya se están escribiendo… · comentalas en la [ficha](<link>)   ← 27/10: la tanda arranca sola
//   ❓ Pendientes (hasta 3) — solo sin link a la ficha (con link están en la ficha)
//   ⚠️ Falta completar (N): etiquetas cortas fijas (ETIQUETA_FALTANTE de ficha.ts: «recorte de la zona (mapa)», «cliente sin
//      cruzar»…), así entran todos; los del portfolio no se repiten: «portfolio: ver 🧾»
// Todo lo que escribió el modelo (y el título de Fathom) pasa por escaparDiscord: sin markdown propio y sin menciones; las
// ÚNICAS menciones son las de Tomi y Gero M, que ponemos nosotros (y Discord solo notifica a los users de allowed_mentions,
// ver lib/fathomAnuncios/discord.ts). Máximo 2000 caracteres: si no entra, se achican de a poco los renglones de contexto,
// los pendientes y los faltantes, y los ganchos recién al final.
// Sin cortes a mitad de frase (24/10: el renglón del avatar salía "… y trabajadores rurales: el…"): los renglones de la
// rama, el avatar, la zona, el portfolio, los pendientes y los faltantes son listas de ÍTEMS ENTEROS (encajar): entran los
// que caben y los que no se cuentan al final como "+N" (están en la ficha). El primer ítem de cada renglón va siempre. Solo
// los ganchos (en los últimos niveles), algún texto suelto muy largo (título, motivo) y, en los últimos niveles, un ítem
// que solo ya no entra (un filtro de 290 caracteres) se recortan, en un límite de palabra. Si ni así entra, se sacan ideas
// enteras desde la última ("y N más en la ficha"): el 👉 con el link y el ⚠️ de los faltantes no se pierden nunca (antes el
// recurso final cortaba la cola del mensaje y se los llevaba).
// El link a la ficha va a la pantalla del Despacho (https://despacho-capital-juridico.vercel.app/clientes/<id_crm>/kickoff,
// encendido por defecto; KICKOFF_PANTALLA=0 lo apaga) y SOLO si el cliente tiene ID del CRM: nunca a una API que pide
// Bearer (desde Discord da 401).
// Zona desde el video: si el mapa ya se leyó (al reprocesar o en la prueba en seco), el 📍 dice si coincide con lo dicho o
// qué lugares no muestra; si se está leyendo, que lo está leyendo el bot y que el resultado queda en la ficha; sin la API key
// de Fathom de quien grabó, eso. El aviso normal sale ANTES de que se lea el mapa. textoAvisoMapa arma el renglón que manda
// la ruta del mapa cuando termina y no coincide (solo con KICKOFF_AVISO_MAPA=1).
import { NOMBRE_RAMA } from '@/lib/anuncios/ramas'
import { MAX_DISCORD, escaparDiscord } from '@/lib/fathomAnuncios/mensaje'
import { fechaCortaAR } from '@/lib/fathomAnuncios/transcripcion'
import { MOTIVO_META, entreComillas, etiquetaFaltante, portfolioFinalDe, textoPresupuesto } from './ficha'
import { diferenciasMapa, leerZonaVideo, mapaUtil, sinNotaLugar, type BloqueMapaZona, type ZonaVideoFicha } from './mapa-zona'
import { ITEMS_PORTFOLIO, type FichaKickoff, type ItemPortfolio } from './tipos'

export { MAX_DISCORD }

export interface Menciones { tomi: string | null; gero_m: string | null }

/** Link a la ficha en el Despacho, o null: con la pantalla apagada (KICKOFF_PANTALLA=0) o sin ID del CRM no hay a dónde mandar a una persona. */
export function linkFicha(base: string, f: Pick<FichaKickoff, 'recording_id' | 'cliente'>, pantalla: boolean): string | null {
  if (!pantalla || !f.cliente.id_crm) return null
  return `${base.replace(/\/+$/, '')}/clientes/${encodeURIComponent(f.cliente.id_crm)}/kickoff`
}

/** Recorta en un límite de palabra (si hay uno razonablemente cerca) y agrega "…". Solo para textos sueltos (títulos, ganchos). */
export function corto(t: string, max: number): string {
  if (t.length <= max) return t
  const cabe = t.slice(0, max - 1)
  const espacio = cabe.lastIndexOf(' ')
  return `${(espacio >= max * 0.6 ? cabe.slice(0, espacio) : cabe).replace(/[\s,;:·–-]+$/u, '')}…`
}
/**
 * Subrama para el renglón de la rama: solo el tema (hasta el primer "(" o ":"), sin cortarla. Los filtros van en el avatar.
 * Si la subrama está "a confirmar", eso queda (es una decisión pendiente y el prompt no la repite en los pendientes): si no,
 * en Discord se leía como decidida.
 */
export const subramaCorta = (t: string): string => {
  const base = t.split(/[(:]/)[0].replace(/\s+/g, ' ').trim() || t.replace(/\s+/g, ' ').trim()
  return /a confirmar/i.test(t) && !/a confirmar/i.test(base) ? `${base} (a confirmar)` : base
}
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
/** Texto de afuera recortado ANTES de escapar (así el corte nunca cae en medio de un escape). */
const txt = (t: string, max: number) => escaparDiscord(corto(t.replace(/\s+/g, ' ').trim(), max))

/** Un grupo de un renglón: sus ítems (ya escapados), con un prefijo propio ("✋ afuera: ") y su separador. */
export interface GrupoAviso { items: string[]; prefijo?: string; sep?: string }

/**
 * Arma un renglón con ítems ENTEROS que entran en `max` caracteres. Primero entra el primer ítem de cada grupo (lo que más
 * dice de cada uno: el primer lugar, el radio, cómo se presenta), después el resto de cada grupo, en orden, mientras entre.
 * Nunca corta un ítem: lo que no entra se cuenta como "+N" (el detalle está en la ficha): en un grupo con prefijo
 * ("✋ afuera: ", "subramas: "), al final de ese grupo (o "prefijo +N" si no entró ninguno); los de los grupos sin prefijo,
 * en un solo "+N" después del último de ellos que quedó a la vista. El primer ítem del renglón va siempre (aunque se pase:
 * el largo de cada renglón es orientativo, el tope duro es el del mensaje, que manejan los niveles).
 */
export function encajar(grupos: GrupoAviso[], max: number, sepGrupos = ' · '): string {
  const gs = grupos.map(g => ({ pre: g.prefijo ?? '', sep: g.sep ?? ' · ', items: g.items.filter(Boolean) })).filter(g => g.items.length)
  if (!gs.length) return ''
  const render = (k: number[]): string => {
    const sueltos = gs.reduce((s, g, i) => s + (g.pre ? 0 : g.items.length - k[i]), 0)
    const ultimoSinPrefijo = gs.reduce((u, g, i) => (!g.pre && k[i] ? i : u), -1)
    const partes: string[] = []
    gs.forEach((g, i) => {
      const fuera = g.items.length - k[i]
      if (k[i]) partes.push(`${g.pre}${g.items.slice(0, k[i]).join(g.sep)}${g.pre && fuera ? `${g.sep}+${fuera}` : ''}`)
      else if (g.pre) partes.push(`${g.pre}+${fuera}`)
      if (i === ultimoSinPrefijo && sueltos) partes.push(`+${sueltos}`)
    })
    if (ultimoSinPrefijo < 0 && sueltos) partes.push(`+${sueltos}`)
    return partes.join(sepGrupos)
  }
  const n = gs.map((_, i) => (i === 0 ? 1 : 0))
  const sumar = (i: number): boolean => {
    const k = n.map((x, j) => (j === i ? x + 1 : x))
    if (render(k).length > max) return false
    n[i]++
    return true
  }
  for (let i = 1; i < gs.length; i++) sumar(i)
  for (let i = 0; i < gs.length; i++) while (n[i] < gs[i].items.length && sumar(i)) { /* el que sigue */ }
  return render(n)
}

/** Los primeros ítems enteros que entran en `max` (el primero, siempre). */
const entran = (items: string[], max: number, sep = ' · '): string[] => {
  const out: string[] = []
  for (const x of items) {
    if (out.length && [...out, x].join(sep).length > max) break
    out.push(x)
  }
  return out
}

// De más detalle a menos: se usa el primero que entra en 2000 caracteres. Lo que más se cuida son los ganchos de las ideas
// (es para lo que se avisa): primero se achican la rama, la zona, los pendientes y los faltantes, y los ganchos recién en
// los últimos niveles. El avatar tiene su propio largo (los filtros son lo que más importa para escribir).
// El renglón del portfolio (🧾) tiene su largo: lo que más importa es el conteo, lo que falta y qué hacer según Meta.
// faltantes: el largo de la lista de los que no tienen etiqueta fija (0 = solo el número y "en la ficha", únicamente con link:
// sin link va al menos uno); los que tienen etiqueta entran todos. pendientes: cuántos como mucho (solo sin link) y
// pendiente: el largo de esa lista. Con el link a la ficha y el 🧾, el aviso de Laura (24/10) entra en el nivel 7 con el
// avatar entero y los ganchos sin tocar. El último nivel es el recurso final: el primer ítem de cada renglón y sin
// pendientes.
// item: el largo máximo de UN ítem (se recorta en un límite de palabra). Hasta el nivel 8 no corta nada (los ítems de la
// ficha no llegan a eso); en los últimos, un primer ítem que solo ya no entra (un filtro de 290 caracteres, una descripción
// de la zona de 400) se acorta: si no, el mensaje no entraba nunca y el recurso final se llevaba el link y los faltantes.
const SIN_TOPE = 10_000
const NIVELES = [
  { gancho: 220, linea: 260, avatar: 360, portfolio: 260, faltantes: 400, pendientes: 3, pendiente: 420, item: SIN_TOPE },
  { gancho: 220, linea: 180, avatar: 300, portfolio: 220, faltantes: 300, pendientes: 3, pendiente: 330, item: SIN_TOPE },
  { gancho: 220, linea: 140, avatar: 260, portfolio: 200, faltantes: 220, pendientes: 2, pendiente: 180, item: SIN_TOPE },
  { gancho: 220, linea: 120, avatar: 240, portfolio: 180, faltantes: 180, pendientes: 2, pendiente: 140, item: SIN_TOPE },
  { gancho: 220, linea: 110, avatar: 220, portfolio: 160, faltantes: 140, pendientes: 1, pendiente: 70, item: SIN_TOPE },
  { gancho: 220, linea: 100, avatar: 200, portfolio: 140, faltantes: 120, pendientes: 1, pendiente: 60, item: SIN_TOPE },
  { gancho: 220, linea: 90, avatar: 190, portfolio: 120, faltantes: 60, pendientes: 1, pendiente: 50, item: SIN_TOPE },
  { gancho: 220, linea: 80, avatar: 170, portfolio: 100, faltantes: 0, pendientes: 1, pendiente: 50, item: SIN_TOPE },
  { gancho: 160, linea: 80, avatar: 150, portfolio: 100, faltantes: 0, pendientes: 1, pendiente: 50, item: 220 },
  { gancho: 130, linea: 80, avatar: 150, portfolio: 100, faltantes: 0, pendientes: 1, pendiente: 50, item: 180 },
  { gancho: 100, linea: 80, avatar: 140, portfolio: 100, faltantes: 0, pendientes: 1, pendiente: 50, item: 140 },
  { gancho: 70, linea: 80, avatar: 110, portfolio: 100, faltantes: 0, pendientes: 1, pendiente: 50, item: 110 },
  { gancho: 70, linea: 0, avatar: 0, portfolio: 0, faltantes: 0, pendientes: 0, pendiente: 0, item: 80 },
] as const
/** Sin lo que va entre paréntesis (aclaraciones que están completas en la ficha). */
const sinParentesis = (t: string) => t.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || t

/** Los ganadores (G1…) que de verdad citan las ideas, en el orden de la lista, y cuántas ideas citan alguno. */
export function ganadoresCitados(f: Pick<FichaKickoff, 'ideas_guiones' | 'ganadores'>): { ids: string[]; ideas: number } {
  const existentes = new Set(f.ganadores.lista.map(g => g.id))
  const citados = new Set<string>()
  let ideas = 0
  for (const x of f.ideas_guiones.ideas) {
    const ids = [...x.por_que.matchAll(/\bG(\d{1,2})\b/g)].map(m => `G${m[1]}`).filter(g => existentes.has(g))
    if (ids.length) ideas++
    ids.forEach(g => citados.add(g))
  }
  return { ids: f.ganadores.lista.map(g => g.id).filter(g => citados.has(g)), ideas }
}

// Nombres mínimos de los ítems para el renglón 🧾 (en la ficha van completos)
const MINI: Record<ItemPortfolio, string> = {
  instagram: 'Instagram', whatsapp_business: 'WhatsApp', pagina_facebook: 'Página', portfolio_comercial: 'Portfolio comercial',
  tarjeta: 'Tarjeta', verificacion: 'Verificación', accesos_equipo: 'Accesos del equipo',
}
/** Los faltantes del portfolio (faltantesPortfolio de ficha.ts: todos empiezan con "Portfolio"): en el aviso los resume 🧾. */
export const esFaltantePortfolio = (x: string): boolean => /^Portfolio\b/.test(x)

/**
 * Las partes del renglón 🧾: "5/7 ok según Meta", "falta: Tarjeta", "➜ <qué hacer según Meta>", "ojo, Meta y la llamada no
 * coinciden: Accesos", "a tildar: Instagram, WhatsApp". Crudas: se escapan afuera (y entran enteras o como "+N"). Salen de
 * portfolio_final (o de la llamada sola en una ficha vieja).
 */
export function partesPortfolio(f: Pick<FichaKickoff, 'portfolio'> & Partial<Pick<FichaKickoff, 'portfolio_final' | 'portfolio_meta'>>): string[] {
  const final = portfolioFinalDe(f)
  const meta = f.portfolio_meta ?? null
  const de = (e: string) => ITEMS_PORTFOLIO.filter(k => final[k].estado === e)
  const nombres = (ks: ItemPortfolio[]) => ks.map(k => MINI[k]).join(', ')
  const ok = de('ok'), okMeta = ok.filter(k => final[k].fuente === 'meta').length
  const fuente = !meta ? ' (sin chequeo de Meta)'
    : !meta.leido ? ` (Meta no pudo leer la cuenta: ${MOTIVO_META[meta.motivo ?? 'error']})`
      : !ok.length || okMeta === ok.length ? ' según Meta' : ` (${okMeta} según Meta, ${ok.length - okMeta} en la llamada)`
  const ojo = ITEMS_PORTFOLIO.filter(k => final[k].discrepancia)
  return [
    `${ok.length}/${ITEMS_PORTFOLIO.length} ok${fuente}`,
    de('problema').length ? `problema: ${nombres(de('problema'))}` : '',
    de('falta').length ? `falta: ${nombres(de('falta'))}` : '',
    meta?.aviso ? `➜ ${meta.aviso}` : '',
    // La cuenta la encontró sola el tablero: hay que cargarla en el CRM (el faltante "Portfolio · cargar act_…" va acá)
    meta?.leido && meta.origen_cuenta === 'descubrimiento' && meta.cuenta ? '➜ cargar la cuenta en «Cuentas Meta» del CRM' : '',
    ojo.length ? `ojo, Meta y la llamada no coinciden: ${nombres(ojo)}` : '',
    de('sin_dato').length ? `a tildar: ${nombres(de('sin_dato'))}` : '',
  ].filter(Boolean)
}
/** El renglón 🧾 entero (sin acortar): las partes separadas por " · ". */
export const resumenPortfolio = (f: Parameters<typeof partesPortfolio>[0]): string => partesPortfolio(f).join(' · ')

// Los lugares del mapa para el aviso: sin la nota "(de oído…)", escapados y como mucho 3 ("A, B ni 2 más"); el resto está en
// la ficha
const MAX_NOMBRES_MAPA = 3
function nombresMapa(xs: string[], y: 'y' | 'ni', esc: (t: string) => string = escaparDiscord): string {
  const v = xs.map(x => esc(sinNotaLugar(x).replace(/\s+/g, ' ').trim())).filter(Boolean)
  const ver = v.length > MAX_NOMBRES_MAPA ? [...v.slice(0, MAX_NOMBRES_MAPA - 1), `${v.length - (MAX_NOMBRES_MAPA - 1)} más`] : v
  return ver.length <= 1 ? ver.join('') : `${ver.slice(0, -1).join(', ')} ${y} ${ver[ver.length - 1]}`
}

/**
 * Lo que el mapa del video no muestra como se dijo, nombrando los lugares ("no muestra Tres Esquinas, Pedernal ni el Bordón",
 * "deja afuera Pocito", "tiene otro radio (…)", "muestra Caucete (parecido a lo dicho)"), ya escapado para Discord. Antes
 * decía "revisar (1)": contaba frases, y con tres lugares que no aparecían parecía un detalle.
 * `esc`: cómo se escapa cada nombre (por defecto, para Discord). El aviso a Valentino (aviso-ads.ts) lo pide crudo porque
 * escapa cada ítem entero al armar el renglón (escapar dos veces duplica las barras).
 */
export function resumenDiferenciasMapa(b: Pick<BloqueMapaZona, 'discrepancias' | 'parecidos'>, esc: (t: string) => string = escaparDiscord): string[] {
  const d = b.discrepancias
  const p = b.parecidos
  return [
    d.dichos_no_vistos.length ? `no muestra ${nombresMapa(d.dichos_no_vistos, 'ni', esc)}` : '',
    d.dichos_afuera.length ? `deja afuera ${nombresMapa(d.dichos_afuera, 'y', esc)}` : '',
    d.radio ? `tiene otro radio (${esc(d.radio)})` : '',
    p.length ? `muestra ${nombresMapa(p.map(x => x.visto), 'y', esc)} (parecido${p.length > 1 ? 's' : ''} a lo que se nombró)` : '',
  ].filter(Boolean)
}

/**
 * Lo que dice el 📍 del mapa: si ya se leyó del video, si coincide con lo dicho o qué no muestra; si lo está leyendo el bot,
 * eso (y que el resultado queda en la ficha); sin la API key de Fathom de quien grabó, que no se lee solo. '' si no hubo mapa.
 */
export function sufijoMapa(z: FichaKickoff['zona'], zv: FichaKickoff['zona_video'] | undefined): string {
  const b = z.mapa ?? (zv?.estado === 'ok' ? zv.mapa : null)
  if (b) {
    if (!mapaUtil(b)) return ' · 🗺️ marcada en el mapa (en el video no se lee bien)'
    const { ojos, revisar } = diferenciasMapa(b)
    if (ojos.length || revisar.length) return ` · 🗺️ el mapa del video ${resumenDiferenciasMapa(b).join('; ')}: revisar`
    return b.legible === 'parcial' ? ' · 🗺️ coincide con el mapa del video (se lee en parte: confirmarlo)' : ' · 🗺️ coincide con el mapa del video'
  }
  if (!z.mapa_en_pantalla) return ''
  if (zv?.estado === 'pedido' || zv?.estado === 'leyendo') return ' · 🗺️ marcada en el mapa (el bot la está leyendo del video: el resultado queda en la ficha)'
  if (zv?.estado === 'sin_key') {
    return zv.quien ? ` · 🗺️ marcada en el mapa (no se lee sola: falta la API key de Fathom de ${zv.quien === 'gero_m' ? 'Gero M' : 'Tomás'})`
      : ' · 🗺️ marcada en el mapa (no se lee sola: no se sabe con qué Fathom se grabó)'
  }
  if (zv?.estado === 'sin_video') return ' · 🗺️ marcada en el mapa (la grabación no tiene video)'
  return ' · 🗺️ marcada en el mapa'
}

/** "Kickoff de Tomás" / "de Gero M" / el nombre de Fathom si es otra persona; null si el payload no lo trae. */
const quienHizo = (f: Pick<FichaKickoff, 'grabo'>): string | null => f.grabo?.quien ?? f.grabo?.nombre ?? f.grabo?.email ?? null

/** Un grupo con sus ítems todavía crudos (sin escapar): se escapan (y en los últimos niveles se acotan) al armar cada nivel. */
type GrupoCrudo = GrupoAviso

export function armarAviso(f: FichaKickoff, m: Menciones, link: string | null): string {
  const quien = [m.tomi ? `<@${m.tomi}>` : 'Tomi', m.gero_m ? `<@${m.gero_m}>` : 'Gero M'].join(' ')
  const hizo = quienHizo(f)
  // Los faltantes del portfolio ya están resumidos en 🧾: en ⚠️ van los demás (el número cuenta todos)
  const faltOtros = f.faltantes.filter(x => !esFaltantePortfolio(x))
  const faltPortfolio = f.faltantes.length - faltOtros.length
  const verPortfolio = `portfolio${faltPortfolio > 1 ? ` (${faltPortfolio})` : ''}: ver 🧾`
  const nombre = txt(f.cliente.cliente_crm ?? `${f.cliente.nombre_escuchado} (sin verificar)`, 120)
  const fecha = fechaCortaAR(f.fecha)
  const r = f.rama, z = f.zona, a = f.avatar, g = f.ganadores
  const nombreRama = r.principal ? NOMBRE_RAMA[r.principal] : 'sin definir'
  const presupuesto = `💵 **Presupuesto:** ${txt(textoPresupuesto(f.presupuesto), 160)}${f.presupuesto.deducido ? ' (deducido)' : ''}${f.presupuesto.certeza === 'a_confirmar' ? ' · a confirmar' : ''}`
  // Solo los ganadores que las ideas citan de verdad (no todos los de la lista): "Apoyadas en 10" cuando una idea no tiene
  // ninguno y dos son de otro país sería falso
  const citados = ganadoresCitados(f)
  const nIdeas = f.ideas_guiones.ideas.length
  const deRama = r.principal ? NOMBRE_RAMA[r.principal] : 'la rama'
  const ganadores = !g.lista.length
    ? `🏆 Sin ganadores de Meta: ${txt(g.nota || g.estado, 160)}`
    : citados.ids.length
      ? `🏆 ${citados.ideas} de ${nIdeas} idea${nIdeas === 1 ? '' : 's'} se apoya${citados.ideas === 1 ? '' : 'n'} en ${citados.ids.length} ganador${citados.ids.length === 1 ? '' : 'es'} de ${deRama} en Meta (180 días): ${citados.ids.join(', ')}${g.estado === 'pocos_datos' ? ' · pocos datos' : ''}`
      : `🏆 Ninguna idea cita a los ${g.lista.length} ganadores de ${deRama} en Meta${g.estado === 'pocos_datos' ? ' (pocos datos)' : ''}`
  // Los renglones de contexto, como grupos de ítems enteros (crudos: se escapan de a uno al armar cada nivel)
  const ramaGrupos: GrupoCrudo[] = [
    { items: r.texto && norm(r.texto) !== norm(nombreRama) ? [r.texto] : [] },   // "Laboral: despidos" ≈ "Laboral (despidos)": no se repite
    { prefijo: 'subramas: ', items: r.subramas.map(x => subramaCorta(x.texto)), sep: '; ' },
  ]
  // Avatar: lo que incluye y, tras «✋ afuera:», lo que excluye sin la doble negación ("nada de pasantes" → "pasantes"). El
  // contexto del mercado ("contexto de la zona: hay mucha gente en negro…") no es un filtro: no va en el aviso
  const excluye = a.excluye.map(x => sinParentesis(x.texto)).filter(x => !/^contexto\b/i.test(x)).map(x => x.replace(/^nada de\s+/i, ''))
  const avatarGrupos: GrupoCrudo[] = [
    { items: a.incluye.map(x => sinParentesis(x.texto)) },
    { prefijo: '✋ afuera: ', items: excluye },
  ]
  // Zona: PRIMERO los lugares (o la descripción, de a frases) y el radio; al final cómo se presenta, sin el contexto en que
  // se dijo (está en la ficha). Antes iba primero la presentación y en el celular se leía "📍 Zona: San Juan capital", que
  // NO es la zona
  const pc = z.presentarse_como
  const zonaGrupos: GrupoCrudo[] = [
    { items: z.lugares.length ? z.lugares.map(sinParentesis) : z.descripcion.split(/;\s+/) },
    { items: z.radio_km !== null ? [`radio ${z.radio_km} km`] : [] },
    { items: pc ? [`se presenta como «${pc.texto.replace(/\s+/g, ' ').trim()}»`] : [] },
  ]
  const hayZona = zonaGrupos.some(x => x.items.some(y => y.trim()))
  const mapa = sufijoMapa(z, f.zona_video)
  // Los faltantes que arma el código van con su etiqueta corta fija (entran todos); los demás, enteros mientras entren
  const etiquetas = faltOtros.map(etiquetaFaltante)
  const conEtiqueta = etiquetas.every(Boolean)
  const portfolioPartes = partesPortfolio(f)

  /** Arma el aviso de un nivel con, como mucho, `maxIdeas` ideas (las demás: "y N más en la ficha"). */
  const armar = (n: (typeof NIVELES)[number], maxIdeas = nIdeas): { cabeza: string[]; cola: string[] } => {
    // Cada ítem, escapado; en los últimos niveles, acotado en un límite de palabra (antes de escapar)
    const it = (x: string) => txt(x, n.item)
    const escapar = (gs: GrupoCrudo[]): GrupoAviso[] => gs.map(x => ({ ...x, items: x.items.map(y => y.replace(/\s+/g, ' ').trim()).filter(Boolean).map(it) }))
    const ramaTxt = encajar(escapar(ramaGrupos), n.linea)
    const rama = `⚖️ **Rama:** ${nombreRama}${ramaTxt ? ` — ${ramaTxt}` : ''}`
    const avatar = `👤 **Avatar:** ${encajar(escapar(avatarGrupos), n.avatar) || 'sin filtros'}`
    const zona = `📍 **Zona:** ${hayZona ? encajar(escapar(zonaGrupos), n.linea) : 'sin definir'}${mapa}`
    const resto = nIdeas - Math.min(maxIdeas, nIdeas)
    const ideas = nIdeas
      ? ['💡 **Ideas para revisar:**',
        ...f.ideas_guiones.ideas.slice(0, maxIdeas).map((x, i) => `${i + 1}. **${txt(x.titulo, Math.min(80, n.item))}** — ${entreComillas(txt(x.gancho, n.gancho))}`),
        ...(resto ? [`… y ${resto} idea${resto === 1 ? '' : 's'} más en la ficha`] : [])]
      : [`💡 Sin ideas${f.ideas_guiones.motivo ? `: ${txt(f.ideas_guiones.motivo, 160)}` : ''}`]
    const portfolio = `🧾 **Portfolio:** ${encajar([{ items: portfolioPartes.map(it) }], n.portfolio)}`
    // Sin link a la ficha va al menos uno (no hay otro lugar donde verlo); con link y sin lugar, solo el número
    const itemsFalt = faltOtros.map((x, i) => etiquetas[i] ?? it(x))
    const detalleFalt = !faltOtros.length ? verPortfolio
      : !conEtiqueta && !n.faltantes && link ? 'el detalle está en la ficha'
        : [conEtiqueta ? itemsFalt.join(' · ') : encajar([{ items: itemsFalt }], n.faltantes), ...(faltPortfolio ? [verPortfolio] : [])].join(' · ')
    const faltantes = f.faltantes.length ? [`⚠️ **Falta completar (${f.faltantes.length}):** ${detalleFalt}`] : ['✅ Ficha completa']
    // Sin pantalla, los pendientes van en el aviso (con pantalla están en la ficha): enteros, hasta n.pendientes
    const pendientes = entran(f.pendientes.slice(0, n.pendientes).map(it), n.pendiente)
    const pend = !link && pendientes.length
      ? [`❓ **Pendientes${f.pendientes.length > pendientes.length ? ` (${pendientes.length} de ${f.pendientes.length})` : ''}:** ${pendientes.join(' · ')}`]
      : []
    return {
      cabeza: [
        `${quien} 📝 **Kickoff · ${nombre} — ideas de guiones para revisar**`,
        `📞 ${hizo ? `Kickoff de ${txt(hizo, 60)} · ` : ''}${fecha ? `${fecha} · ` : ''}[Fathom](<${f.url}>)`,
        '',
        rama, avatar, zona, presupuesto, portfolio,
        '',
        ...ideas,
        ganadores,
      ],
      // La aprobación queda registrada en la ficha (un "ok" en Discord no): con link, se dice dónde. El link y los faltantes
      // van siempre: el recurso final recorta antes que ellos
      cola: [
        ...(link && nIdeas ? [`✍️ Los guiones ya se están escribiendo con estas ideas · comentalas en la [ficha](<${link}>)`] : link ? [`🗂️ [Ficha](<${link}>)`] : []),
        '',
        ...pend,
        ...faltantes,
      ],
    }
  }
  const unir = (x: { cabeza: string[]; cola: string[] }) => [...x.cabeza, ...x.cola].join('\n')
  for (const n of NIVELES) {
    const t = unir(armar(n))
    if (t.length <= MAX_DISCORD) return t
  }
  // Recurso final: el último nivel con menos ideas (enteras, desde la última); el link y los faltantes quedan
  const ultimo = NIVELES[NIVELES.length - 1]
  for (let k = nIdeas - 1; k >= 0; k--) {
    const t = unir(armar(ultimo, k))
    if (t.length <= MAX_DISCORD) return t
  }
  // No debería pasar (cada renglón está acotado): se recorta la cabeza, nunca el link ni los faltantes
  const x = armar(ultimo, 0)
  const cola = x.cola.join('\n')
  return `${x.cabeza.join('\n').slice(0, Math.max(0, MAX_DISCORD - cola.length - 2))}…\n${cola}`.slice(0, MAX_DISCORD)
}

/**
 * El renglón que manda la ruta del mapa cuando la lectura TERMINA y hay algo que mirar (solo con KICKOFF_AVISO_MAPA=1): el
 * mapa no coincide con lo dicho, no deja leer el recorte, o en esos minutos no se ve. null si coincide (no hace ruido) o si
 * no terminó. Sin menciones (lo manda la ruta con allowed_mentions vacío) y con el link a la ficha. `ficha`: la guardada
 * (jsonb), leída con cuidado.
 */
export function textoAvisoMapa(ficha: unknown, zvCrudo: unknown, op: { base: string; pantalla: boolean }): string | null {
  const zv: ZonaVideoFicha | null = leerZonaVideo(zvCrudo)
  if (!zv) return null
  const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
  const f = o(ficha), cli = o(f.cliente), zona = o(f.zona)
  const s = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '')
  const nombre = txt(s(cli.cliente_crm) || s(cli.nombre_escuchado) || `la grabación ${s(String(f.recording_id ?? ''))}`, 120)
  let que: string | null = null
  if (zv.estado === 'ok' && zv.mapa) {
    const b = zv.mapa
    const { ojos, revisar } = diferenciasMapa(b)
    if (!mapaUtil(b)) que = 'el mapa del video no deja leer el recorte de la zona: hay que anotarlo a mano'
    else if (ojos.length || revisar.length) que = `el mapa del video ${resumenDiferenciasMapa(b).join('; ')} (lo que se nombró en la llamada): revisar la zona antes de lanzar`
  } else if (zv.estado === 'sin_mapa' && zona.mapa_en_pantalla === true) {
    que = 'en los minutos en que se habló de la zona el video no muestra el mapa: buscarlo en la grabación y anotar el recorte'
  }
  if (!que) return null
  const id = s(cli.id_crm)
  const link = id && typeof f.recording_id === 'number' ? linkFicha(op.base, { recording_id: f.recording_id, cliente: { id_crm: id } as FichaKickoff['cliente'] }, op.pantalla) : null
  return `🗺️ ${nombre}: ${que}${link ? ` · [ficha](<${link}>)` : ''}`.slice(0, MAX_DISCORD)
}

/** Los IDs que Discord puede notificar (allowed_mentions.users): solo Tomi y Gero M. */
export const usuariosMencionados = (m: Menciones): string[] => [m.tomi, m.gero_m].filter((x): x is string => !!x)

// ── Avisos de error para Tomás (mismo canal). Solo el título y el motivo: nada de la llamada. ──
export interface OpcionesErrorKickoff {
  registrada?: boolean          // false = ni siquiera se pudo reclamar la grabación: no hay fila ni payload guardado
  avisoDudoso?: boolean         // Discord no confirmó el aviso (timeout): puede haber salido igual
}

export function textoErrorKickoff(titulo: string, recordingId: number, motivo: string, tomas: string | null, op: OpcionesErrorKickoff = {}): string {
  const registrada = op.registrada ?? true
  const como = registrada
    ? `Lo que ya salió quedó guardado. Para reintentar, pedile a Claude que reintente el kickoff ${recordingId} (o reenviá la grabación desde Fathom).`
    : 'La grabación no quedó registrada en la base: para reintentar, reenviala desde Fathom o mandá el payload en el cuerpo del modo manual.'
  const dudoso = op.avisoDudoso ? ' Discord no confirmó el aviso a Tomi y Gero M: fijate en el canal si salió antes de reintentar (si salió, un reintento lo repite).' : ''
  return (`${tomas ? `<@${tomas}> ` : ''}⚠️ No pude armar la ficha de kickoff de «${escaparDiscord(titulo)}» (grabación ${recordingId}): ${escaparDiscord(motivo).slice(0, 300)}. ` +
    `${como}${dudoso}`).slice(0, MAX_DISCORD)
}

/** El aviso a Tomi y Gero M salió pero no se pudo anotar en la base: no hay que reintentar (y si se reintenta, no se repite). */
export function textoAvisoSinAnotar(titulo: string, recordingId: number, motivo: string, tomas: string | null): string {
  return (`${tomas ? `<@${tomas}> ` : ''}⚠️ Kickoff de «${escaparDiscord(titulo)}» (grabación ${recordingId}): el aviso a Tomi y Gero M ya salió, pero no pude anotarlo en la base (${escaparDiscord(motivo).slice(0, 200)}). ` +
    'No hace falta reintentar; si se reintenta, el aviso no se repite.').slice(0, MAX_DISCORD)
}

export function textoSinTranscripcionKickoff(titulo: string, recordingId: number, tomas: string | null): string {
  return (`${tomas ? `<@${tomas}> ` : ''}⚠️ «${escaparDiscord(titulo)}» (grabación ${recordingId}): el webhook de kickoff de Fathom llega sin transcripción: ` +
    'en Fathom → Settings → API Access → el webhook de /api/bot/kickoff, activá Transcript.').slice(0, MAX_DISCORD)
}
