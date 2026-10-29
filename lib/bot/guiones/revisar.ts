// ── Revisor mecánico de una tanda de guiones (puro, sin red) ─────────────────────────────────────
// Lo que se puede chequear con reglas, antes de que lo mire el revisor con criterio (Claude, contexto limpio) y una persona.
// Sale del prompt maestro de Tomás («PROMPT PARA HACER GUIONES CON CLAUDE») y de sus decisiones del 24/10/2026.
// Errores (la tanda no pasa):
//   · por guion: las 4 secciones en orden; velocidad entera de 1 a 5; indicación de grabación en cada sección; texto hablado
//     de 500 a 800 caracteres (sin indicaciones ni el gesto); la ciudad en el HOOK; sin comillas en el texto; sin WhatsApp;
//     el CTA con «escribime acá abajo (gesto con el dedo hacia abajo)»; si el HOOK va con cámara frontal, la sección
//     siguiente vuelve a la trasera; un formato que exista en el catálogo.
//   · de la tanda: la cantidad pedida; un recurso creativo distinto por guion (ninguno se repite); ningún tipo de gancho
//     más de 2 veces.
// Avisos (los mira quien revisa): velocidad fuera de la guía (HOOK y CTA 4–5, PROBLEMA y SOLUCIÓN 3–4); una sección sin
// una acción concreta, con la misma indicación que la anterior o con «cambiá levemente el ángulo» («nunca quieto»); CTA
// sin «antes de que»; cifras o plazos legales; comillas en las indicaciones; más de una actuación; mezcla de dificultad
// (dos tercios, como mínimo, en el escritorio o el estudio, y como mucho uno con ayudante o locación); ganchos que arrancan
// con las mismas palabras.
import { SECCIONES, NOMBRE_SECCION, type Catalogo, type Guion, type Hallazgo, type Tanda } from './tipos'

export const LARGO_MIN = 500
export const LARGO_MAX = 800
export const GESTO = '(gesto con el dedo hacia abajo)'
const GUIA_VELOCIDAD = { HOOK: [4, 5], PROBLEMA: [3, 4], SOLUCION: [3, 4], CTA: [4, 5] } as const

/** Sin tildes, minúsculas y espacios simples: para comparar textos. */
export const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Las palabras ENTERAS de un nombre (sin tildes, minúsculas, 3 letras o más). Para cruzar nombres sin pedazos de palabra:
 *  «Ana Ruiz» no tiene que coincidir con «Mariana Ruiz» (revisión adversarial de la sesión Grabación, 26/10). */
export const palabrasDe = (s: string): Set<string> => new Set(normalizar(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(w => w.length >= 3))
/** ¿Están TODAS las palabras de `buscado` (al menos una) entre las de `en`? */
export const contienePalabras = (en: string, buscado: string): boolean => {
  const b = palabrasDe(buscado), e = palabrasDe(en)
  return b.size > 0 && [...b].every(w => e.has(w))
}

/** El texto que se dice en voz alta: sin lo que va entre paréntesis (el gesto). */
export const textoHablado = (g: Guion) => g.secciones.map(s => s.texto.replace(/\([^)]*\)/g, ' ')).join(' ').replace(/\s+/g, ' ').trim()
export const largoHablado = (g: Guion) => textoHablado(g).length

// Preferencia 6 de Tomás: en las indicaciones, nada de jerga de cámara ni de tono o ritmo
const JERGA = /\b(plano|corte|cort[aá]|toma|tomas|primer plano|detalle|[aá]ngulo|tr[ií]pode|cenital|altura del pecho|firme|r[aá]pido|marcando|modul[aá]|energ[ií]a|en[eé]rgic)/i
// Preferencia 6 (p4): indicaciones de vos, no en tercera persona
const TERCERA = /\b(muestra|levanta|apoya|se acerca|se sienta|se para|camina|señala|deja|toca|agarra|saca|mira|sostiene|gira)\b/i
const COMILLAS = /[«»"“”„]/
const WHATSAPP = /\b(whats?app|wpp|wsp|whatsa)\b/i
// Cifras y plazos legales que no se prometen sin que los mire Tomás (los guiones viejos decían «48 horas», «el doble»…)
const CIFRAS_LEGALES: [RegExp, string][] = [
  [/\b\d+\s*(%|por ciento)/i, 'un porcentaje'],
  [/\b(\d+|un|una|dos|tres|cuatro|cinco|seis|diez|treinta|sesenta|noventa|cuarenta y ocho|veinticuatro)\s+(horas|d[ií]as|meses|a[nñ]os)\s+(para|de plazo|h[aá]biles)/i, 'un plazo'],
  [/\b(el doble|el triple|duplic|triplic|multas?)\b/i, 'un monto o una multa'],
  [/\$\s?\d|\b\d[\d.]*\s*(pesos|d[oó]lares|millones)/i, 'un monto'],
  [/\bart[ií]culo\s+\d|\bley\s+(n[°º.]?\s*)?\d/i, 'un artículo o una ley'],
]
// «Nunca quieto»: cada indicación tiene que pedir algo concreto (moverse, mostrar, cambiar el plano…)
const ACCIONES = /\b(camin|acerc|alej|par[aá]te|levant|sent[aá]|gir|mostr|se[nñ]al|agarr|sac[aá]|dej[aá]|apoy|cambi|dibuj|anot|escrib[ií]|tach|subray|cont[aá]|le[eé]|abr[ií]|golpe|romp|dobl|tom[aá]|pon[eé]|march|entr[aá]|sal[ií]|frontal|trasera|plano|[aá]ngulo|toma|detalle|cenital|zoom|pizarra|papel|hoja|telegrama|carta|recibo|celular|calculadora|cron[oó]metro)/i

export function revisarGuion(g: Guion, ciudad: string, catalogo: Catalogo): Hallazgo[] {
  const h: Hallazgo[] = []
  const err = (regla: string, detalle: string) => h.push({ gravedad: 'error', guion: g.numero, regla, detalle })
  const aviso = (regla: string, detalle: string) => h.push({ gravedad: 'aviso', guion: g.numero, regla, detalle })

  const orden = g.secciones.map(s => s.seccion).join(',')
  if (orden !== SECCIONES.join(',')) err('secciones', `las secciones tienen que ser HOOK, PROBLEMA, SOLUCIÓN y CTA, en ese orden (vino: ${orden || 'ninguna'})`)
  if (!catalogo[g.formato]) err('formato', `el formato «${g.formato}» no está en el catálogo`)

  let previa = ''
  for (const s of g.secciones) {
    const n = NOMBRE_SECCION[s.seccion] ?? s.seccion
    if (!Number.isInteger(s.velocidad) || s.velocidad < 1 || s.velocidad > 5) err('velocidad', `${n}: la velocidad tiene que ser un número entero de 1 a 5`)
    else {
      const guia = GUIA_VELOCIDAD[s.seccion as keyof typeof GUIA_VELOCIDAD]
      if (guia && (s.velocidad < guia[0] || s.velocidad > guia[1])) aviso('velocidad', `${n}: velocidad ${s.velocidad}, la guía es ${guia[0]} a ${guia[1]}`)
    }
    const ind = s.indicacion.trim()
    if (ind.length < 20) err('indicacion', `${n}: falta la indicación de grabación (o es demasiado corta)`)
    else {
      if (!ACCIONES.test(ind)) aviso('quieto', `${n}: la indicación no pide ninguna acción concreta (moverse, mostrar algo, cambiar el plano)`)
      if (previa && normalizar(ind) === normalizar(previa)) aviso('quieto', `${n}: la misma indicación que la sección anterior`)
      if (COMILLAS.test(ind)) aviso('comillas', `${n}: la indicación tiene comillas`)
      const j = ind.match(JERGA)
      if (j) err('indicacion', `${n}: la indicación usa «${j[0]}» (solo lo visual y simple: objeto o gesto, sin jerga de cámara ni tono)`)
      const t3 = ind.match(TERCERA)
      if (t3) aviso('indicacion', `${n}: la indicación está en tercera persona («${t3[0]}»): va de vos`)
      if (ind.length > 260) aviso('indicacion', `${n}: la indicación es larga (${ind.length} caracteres): una o dos frases cortas`)
    }
    previa = ind
    if (COMILLAS.test(s.texto)) err('comillas', `${n}: el texto tiene comillas (el prompt maestro no las permite)`)
    if (WHATSAPP.test(s.texto)) err('whatsapp', `${n}: el texto nombra WhatsApp (el CTA es «escribime acá abajo»)`)
  }

  const largo = largoHablado(g)
  if (largo < LARGO_MIN || largo > LARGO_MAX) err('largo', `el texto hablado tiene ${largo} caracteres (tiene que estar entre ${LARGO_MIN} y ${LARGO_MAX})`)

  const hook = g.secciones.find(s => s.seccion === 'HOOK')
  if (hook && ciudad && !normalizar(hook.texto).includes(normalizar(ciudad))) err('ciudad', `el HOOK no nombra «${ciudad}»`)

  const cta = g.secciones.find(s => s.seccion === 'CTA')
  if (cta) {
    const t = normalizar(cta.texto)
    // «escribime ahora acá abajo (gesto…)» también vale: así lo escribe Tomás
    if (!/escribime (ahora |ya )?aca abajo \(gesto con el dedo hacia abajo\)/.test(t)) err('cta', `el CTA tiene que decir «escribime acá abajo ${GESTO}», con el gesto pegado`)
    if (!t.includes('antes de que')) aviso('cta', 'el CTA no cierra con urgencia («antes de que…»)')
  }

  // Si el HOOK se graba con la frontal, la sección siguiente vuelve a la trasera (prompt maestro)
  const i = g.secciones.findIndex(s => s.seccion === 'HOOK')
  const sig = i >= 0 ? g.secciones[i + 1] : undefined
  if (hook && /frontal/i.test(hook.indicacion) && sig && !/trasera/i.test(sig.indicacion)) {
    err('camara', `el HOOK va con cámara frontal: ${NOMBRE_SECCION[sig.seccion]} tiene que indicar el cambio a la trasera`)
  }

  const todo = g.secciones.map(s => s.texto).join(' ')
  for (const [re, que] of CIFRAS_LEGALES) {
    const m = todo.match(re)
    if (m) aviso('cifra_legal', `menciona ${que} («${m[0]}»): que lo verifique Tomás`)
  }
  return h
}

export function revisarTanda(t: Tanda, catalogo: Catalogo, cantidad: number): Hallazgo[] {
  const h: Hallazgo[] = t.guiones.flatMap(g => revisarGuion(g, t.ciudad, catalogo))
  const err = (regla: string, detalle: string) => h.push({ gravedad: 'error', guion: null, regla, detalle })
  const aviso = (regla: string, detalle: string) => h.push({ gravedad: 'aviso', guion: null, regla, detalle })
  const n = t.guiones.length
  if (n !== cantidad) err('cantidad', `vinieron ${n} guiones (se pidieron ${cantidad})`)

  const contar = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  // Un recurso principal distinto por guion (catálogo de formatos): ninguno se repite mientras alcancen los del catálogo
  const formatos = contar(t.guiones.map(g => g.formato))
  for (const [f, k] of formatos) if (k > 1 && n <= Object.keys(catalogo).length) err('diversidad', `el recurso «${catalogo[f]?.nombre ?? f}» se repite ${k} veces`)
  for (const [tg, k] of contar(t.guiones.map(g => g.tipo_gancho))) if (k > 2) err('ganchos', `el tipo de gancho «${tg}» aparece ${k} veces`)
  if ((formatos.get('actuar_empleador') ?? 0) > 1) aviso('diversidad', 'más de una actuación en la tanda (retiene mucho y cierra poco)')

  const dif = t.guiones.map(g => catalogo[g.formato]?.dificultad).filter((d): d is 1 | 2 | 3 => !!d)
  if (dif.length === n && n > 1) {
    if (dif.filter(d => d <= 2).length < Math.ceil((2 * n) / 3)) aviso('dificultad', 'menos de dos tercios se graban en el escritorio o el estudio: puede no entrar en una sesión')
    if (dif.filter(d => d === 3).length > 1) aviso('dificultad', 'más de un guion necesita ayudante o locación')
  }
  for (const g of t.guiones) {
    if (g.secciones.some(s => /levemente (el )?[aá]ngulo/i.test(s.indicacion))) aviso('quieto', `Guion ${g.numero}: «cambiá levemente el ángulo» no cuenta como cambio; decí qué cambia`)
  }

  const aperturas = contar(t.guiones.map(g => {
    const hook = g.secciones.find(s => s.seccion === 'HOOK')?.texto ?? ''
    return normalizar(hook).replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 2).join(' ')
  }).filter(Boolean))
  for (const [a, k] of aperturas) if (k > 2) aviso('ganchos', `${k} ganchos arrancan igual («${a}…»)`)
  return h
}

export const errores = (h: Hallazgo[]) => h.filter(x => x.gravedad === 'error')

/** Para mandarle al redactor lo que tiene que corregir, o mostrárselo a quien revisa. */
export function hallazgosEnTexto(h: Hallazgo[]): string {
  if (!h.length) return '(sin hallazgos)'
  return h.map(x => `- [${x.gravedad}] ${x.guion === null ? 'Tanda' : `Guion ${x.guion}`} · ${x.regla}: ${x.detalle}`).join('\n')
}
