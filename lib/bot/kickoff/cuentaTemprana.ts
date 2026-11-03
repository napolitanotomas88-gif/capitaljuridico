// ── Chequeo TEMPRANO de la cuenta de Meta: apenas la ficha de kickoff queda «lista» ──────────────────────────────────
// Pedido de Tomás (3/11/2026): una ficha se armó sin cuenta (el nombre de la cuenta en Meta no coincidía con el del CRM) y
// nadie se enteró hasta el día de lanzar. Ahora, cuando la ficha queda lista (trasWebhook, procesar.ts) y en la corrida de
// las 9:05 (las fichas listas de los últimos DIAS_BARRIDO días de clientes por lanzar), si la ficha no tiene cuenta o el
// token no la ve, sale UN aviso «⚠️ sin cuenta / sin acceso» en #📣-ads a Valen y a Tomás (clave
// cuenta-temprana:<grabación>:<motivo> en cj_anuncios_avisos).
// La búsqueda mejorada (pura, puntuarCuentas): no solo el nombre completo, también el APELLIDO, el nombre del negocio y el
// nombre de las PÁGINAS que promociona cada cuenta. Si hay una sola candidata clara, va PROPUESTA en el aviso con cómo
// cargarla; nunca se carga sola (Tomás o Valen la confirman). Las cuentas que el tablero ya asigna a otro cliente no cuentan.
import { tokens } from '@/lib/bot/anuncios/docAds'

export const DIAS_BARRIDO = 21
/** Apellidos muy comunes: solos no alcanzan para una candidata clara. */
const APELLIDOS_COMUNES = new Set(('gonzalez rodriguez gomez fernandez lopez diaz martinez perez garcia sanchez romero sosa alvarez torres ruiz '
  + 'ramirez flores benitez acosta medina herrera suarez aguirre gimenez gutierrez pereyra rojas molina castro ortiz silva nuñez nunez '
  + 'luna juarez cabrera rios ferreyra godoy morales dominguez moreno peralta vega carrizo quiroga ponce vazquez cardozo').split(/\s+/))
/** Nombres de pila frecuentes: como segundo nombre no cuentan como apellido. */
const NOMBRES_DE_PILA = new Set(('jose maria juan luis carlos ana pablo andrea jorge javier daniel diego lucas martin martina sofia sofi lucia laura '
  + 'florencia flor gabriel gabriela alejandro alejandra fernando fernanda esteban eduardo manuel miguel angel antonio francisco paula '
  + 'agustin agustina carolina claudia claudio cristian cristina mariano marcelo marcela nicolas sergio ricardo roberto rodrigo gustavo '
  + 'silvia valeria veronica victoria ines teresa teresita rosa rocio carmen pilar belen camila julieta julio cesar hector raul ramon '
  + 'emilio enrique ignacio joaquin santiago tomas mauro mauricio federico facundo gonzalo hernan leandro leonardo matias maximiliano '
  + 'patricio ezequiel exequiel guillermo hugo oscar pedro ruben adrian alberto alfredo andres benjamin bruno damian dario emanuel '
  + 'graciela liliana lorena marina mariana monica natalia noelia patricia romina sandra soledad susana viviana yamila').split(/\s+/))
export const MIN_PUNTOS_CLARA = 2

export interface CuentaCandidata {
  id: string
  nombre: string
  negocio: string | null
  paginas: string[]
  /** El cliente del CRM al que el cruce del tablero ya asigna esta cuenta (null = a nadie). */
  asignada: string | null
}
export interface Puntaje { id: string; nombre: string; puntos: number; por: string[] }

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const casi = (a: string, b: string) => {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1)
}
const contiene = (texto: string, w: string) => tokens(texto).some(x => casi(x, w))

/**
 * Cuánto se parece cada cuenta al cliente: nombre completo en la cuenta, el negocio o una página (+3); cada apellido
 * (+2, en cualquiera de los tres); el nombre del negocio de la ficha (+2 si comparten 2 palabras); solo el nombre de pila
 * (+0,5). Ordenado de mayor a menor, sin las de 0 puntos ni las asignadas a otro cliente. Puro.
 */
export function puntuarCuentas(cliente: { nombre: string; negocio?: string | null }, cuentas: readonly CuentaCandidata[]): Puntaje[] {
  const ts = tokens(cliente.nombre)
  if (!ts.length) return []
  const [pila, ...resto] = ts
  // «Jorge Luis Alfonso»: «luis» es un segundo nombre, no un apellido (no sirve para buscar la cuenta)
  const apellidos = resto.filter(w => !NOMBRES_DE_PILA.has(w))
  const negocio = cliente.negocio ? tokens(cliente.negocio) : []
  const yo = normal(cliente.nombre)
  const out: Puntaje[] = []
  for (const c of cuentas) {
    if (c.asignada && normal(c.asignada) !== yo) continue
    const campos: [string, string][] = [['la cuenta', c.nombre], ['el negocio', c.negocio ?? ''], ...c.paginas.map((p): [string, string] => ['la página', p])]
    let puntos = 0
    const por: string[] = []
    const completo = campos.find(([, t]) => ts.every(w => contiene(t, w)))
    if (completo && ts.length > 1) { puntos += 3; por.push(`nombre completo en ${completo[0]}`) }
    for (const a of apellidos) {
      const donde = campos.find(([, t]) => contiene(t, a))
      // Un apellido muy común («López») suma poco: solo no alcanza para proponer la cuenta
      if (donde && !completo) { puntos += APELLIDOS_COMUNES.has(a) ? 1 : 2; por.push(`apellido «${a}»${APELLIDOS_COMUNES.has(a) ? ' (común)' : ''} en ${donde[0]}`) }
    }
    if (negocio.length >= 2) {
      const donde = campos.find(([, t]) => negocio.filter(w => contiene(t, w)).length >= 2)
      if (donde) { puntos += 2; por.push(`negocio en ${donde[0]}`) }
    }
    if (!puntos && campos.some(([, t]) => contiene(t, pila))) { puntos += 0.5; por.push('solo el nombre de pila') }
    if (puntos > 0) out.push({ id: c.id, nombre: c.nombre, puntos, por })
  }
  return out.sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, 'es'))
}

/** La única candidata clara (puntos ≥ MIN_PUNTOS_CLARA y sin empate arriba), o null. */
export function candidataClara(ps: readonly Puntaje[]): Puntaje | null {
  const [a, b] = ps
  return a && a.puntos >= MIN_PUNTOS_CLARA && (!b || b.puntos < a.puntos) ? a : null
}

export type ProblemaCuenta = 'sin_cuenta' | 'sin_acceso'

/** El aviso de #📣-ads. Puro. */
export function textoCuentaTemprana(x: {
  cliente: string; idCrm: string | null; recordingId: number; problema: ProblemaCuenta; cuenta: string | null
  candidatas: Puntaje[]; menciones: string[]; ficha: string | null
}): string {
  const clara = candidataClara(x.candidatas)
  const lineas = [`${x.menciones.map(m => `<@${m}>`).join(' ')}${x.menciones.length ? ' ' : ''}⚠️ **${x.problema === 'sin_cuenta' ? 'Sin cuenta de Meta' : 'Sin acceso a su cuenta de Meta'}** · ${x.cliente}${x.idCrm ? ` (${x.idCrm})` : ''} · la ficha de kickoff quedó lista`]
  if (x.problema === 'sin_acceso') lineas.push(`🏦 La ficha tiene \`${x.cuenta}\` pero el token no la ve: falta que el cliente comparta el portfolio o el acceso a la cuenta.`)
  else if (clara) lineas.push(`🔎 **Propuesta:** \`${clara.id}\` «${clara.nombre}» (${clara.por.join(', ')}). Si es esa, cargala en «Cuentas Meta» del CRM o con POST /api/bot/kickoff?recording_id=${x.recordingId}&cuenta=${clara.id}`)
  else if (x.candidatas.length) lineas.push(`🔎 Candidatas (ninguna clara, no cargo nada): ${x.candidatas.slice(0, 4).map(c => `\`${c.id}\` «${c.nombre}» (${c.por.join(', ')})`).join(' · ')}`)
  else lineas.push('🔎 No encontré ninguna cuenta que se le parezca (ni por apellido, negocio o página): pedile el acceso al portfolio al cliente.')
  lineas.push(`Hay que resolverlo antes de que lleguen los videos: sin cuenta el bot no puede armar la campaña.${x.ficha ? ` · [Ficha](<${x.ficha}>)` : ''}`)
  return lineas.join('\n').slice(0, 1900)
}
