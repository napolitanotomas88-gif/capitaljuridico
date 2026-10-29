// ── Rama del derecho de cada cliente y CPL "normal" por rama ────────────────────────────────────
// No todas las ramas cuestan lo mismo por mensaje: el semáforo de CPL usa los umbrales de la rama
// del cliente (UMBRALES_RAMA). La rama se saca de ClickUp, espacio "Seguimiento de Anuncios"
// (lista LISTA_SEGUIMIENTO, solo lectura): campo "c) - Tópicos Objetivos" (o "b) - Avatar Ideal" /
// descripción si está vacío), clasificado por palabras clave (el tema que aparece PRIMERO gana:
// "Accidentes laborales" → ART, "Divorcios y Sucesiones" → Familia). Se puede forzar a mano en
// cuentas.ts → AJUSTES_CUENTA[id].rama.
//
// CÓMO EDITAR LOS UMBRALES: en USD, "ok" = hasta ahí es verde, "medio" = hasta ahí amarillo, más = rojo.
// Las ramas sin valores propios usan los generales (UMBRAL_GENERAL).
export type Rama = 'laboral' | 'art' | 'transito' | 'geriatrico' | 'salud' | 'previsional' | 'familia' | 'sucesiones' | 'penal'
  | 'consumidor' | 'internacional' | 'empresas'

export const NOMBRE_RAMA: Record<Rama, string> = {
  laboral: 'Laboral (despidos)', art: 'ART / accidentes de trabajo', transito: 'Accidentes de tránsito', geriatrico: 'Salud: geriátrico', salud: 'Salud / amparos',
  previsional: 'Previsional', familia: 'Familia', sucesiones: 'Sucesiones', penal: 'Penal', consumidor: 'Consumidor / deudas',
  internacional: 'Ciudadanía / internacional', empresas: 'Empresas / contratos',
}

export const UMBRAL_GENERAL = { ok: 2.8, medio: 4 }
// CPL NORMAL por rama (USD por mensaje, datos de Tomás 30/9/2026). Verde = hasta el tope del rango
// normal · amarillo = hasta 50% arriba del tope · rojo = más. Previsional y Empresas no tienen rango
// todavía: usan el general.
const RANGO_NORMAL: Partial<Record<Rama, [number, number]>> = {
  laboral: [0.5, 1.5],        // TOP 1 · despidos
  art: [0.7, 2],              // TOP 2 · accidentes y enfermedades profesionales
  transito: [0.55, 1.5],      // TOP 3
  salud: [0.4, 1.3],          // TOP 4 · amparos (0,4 | 0,7 - 1,3)
  geriatrico: [1.6, 2.7],     // TOP 4 · geriátrico
  consumidor: [0.6, 1.5],     // TOP 5
  penal: [0.6, 2],            // TOP 6
  internacional: [0.4, 1.3],  // TOP 7 · ciudadanías
  familia: [0.6, 1.6],        // TOP 8
  sucesiones: [0.7, 2.3],     // TOP 9
}
const MARGEN_AMARILLO = 1.5
export const UMBRALES_RAMA: Partial<Record<Rama, { ok: number; medio: number }>> = Object.fromEntries(
  Object.entries(RANGO_NORMAL).map(([r, [, tope]]) => [r, { ok: tope, medio: Math.round(tope * MARGEN_AMARILLO * 100) / 100 }]))

export const umbralDe = (rama: Rama | null) => (rama && UMBRALES_RAMA[rama]) || UMBRAL_GENERAL

// Orden = desempate si dos temas aparecen en la misma posición
const CLAVES: [Rama, RegExp][] = [
  ['art', /accidentes? (de|del) trabajo|accidentes? laboral|\bART\b|enfermedad(es)? profesional/i],
  ['transito', /tr[aá]nsito|lo chocaron|choque/i],
  ['geriatrico', /geri[aá]tric/i],
  ['salud', /salud|amparo|prepaga|obra social|geri[aá]tric|oncol[oó]g|cobertura|EPOF|\bCUD\b/i],
  ['previsional', /previsional|jubilaci|jubilo|\bUCAPS?\b|moratoria|r[eé]gimen diferencial/i],
  ['sucesiones', /sucesi|suseci|herencia/i],
  ['familia', /familia|divorci|cuota alimentaria|pensi[oó]n alimenticia|tenencia|visitas|violencia/i],
  ['penal', /penal|abuso sexual|allanamiento|usurpaci/i],
  ['consumidor', /consumidor|estafas? (bancari|en banco)|homebanking|reparaci[oó]n de cr[eé]dito|deudas/i],
  ['internacional', /ciudadan[ií]a|internacional|relocation|restituci/i],
  ['laboral', /despid|laboral|en negro|en blanco/i],
  ['empresas', /empresas?|contratos?|prevenci[oó]n legal|prevensi[oó]n legal/i],
]

export function clasificarRama(texto: string): Rama | null {
  let mejor: { r: Rama; i: number; o: number } | null = null
  CLAVES.forEach(([r, re], o) => {
    const m = re.exec(texto)
    if (m && (!mejor || m.index < mejor.i || (m.index === mejor.i && o < mejor.o))) mejor = { r, i: m.index, o }
  })
  const r = (mejor as { r: Rama } | null)?.r ?? null
  // Si en salud menciona geriátrico, va con el rango de geriátrico (más caro)
  return r === 'salud' && /geri[aá]tric/i.test(texto) ? 'geriatrico' : r
}

// ── ClickUp ──
export const LISTA_SEGUIMIENTO = process.env.CLICKUP_LISTA_SEGUIMIENTO?.trim() ?? ''
export interface TareaAnuncio { presupuestoUSD: number | null; id: string; nombre: string; estado: string; portfolio: string; texto: string; rama: Rama | null; url: string }

export async function leerTareasClickUp(): Promise<TareaAnuncio[]> {
  const token = process.env.CLICKUP_TOKEN
  if (!token) throw new Error('Falta CLICKUP_TOKEN')
  const out: TareaAnuncio[] = []
  for (let p = 0; p < 10; p++) {
    if (!LISTA_SEGUIMIENTO) throw new Error('Falta CLICKUP_LISTA_SEGUIMIENTO');
    const r = await fetch(`https://api.clickup.com/api/v2/list/${LISTA_SEGUIMIENTO}/task?include_closed=true&subtasks=true&page=${p}`,
      { headers: { Authorization: token }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error(`ClickUp respondió ${r.status}`)
    const j = await r.json() as { tasks?: { id: string; name: string; url: string; description?: string; status: { status: string }; custom_fields: { name: string; value?: unknown }[] }[]; last_page?: boolean }
    for (const t of j.tasks ?? []) {
      const campo = (pref: string) => {
        const c = t.custom_fields.find(c => c.name.startsWith(pref))
        return c?.value != null ? String(c.value).replace(/\s+/g, ' ').trim() : ''
      }
      const topicos = campo('c)'), avatar = campo('b)')
      const texto = topicos || avatar || (t.description ?? '').replace(/\s+/g, ' ').trim()
      const presupuesto = campo('e)')
      const presupuestoUSD = presupuesto && Number.isFinite(Number(presupuesto)) && Number(presupuesto) >= 0 ? Number(presupuesto) : null
      out.push({ presupuestoUSD, id: t.id, nombre: t.name.trim(), estado: t.status.status, portfolio: campo('aa)'), texto: texto.slice(0, 300), rama: clasificarRama(texto), url: t.url })
    }
    if (j.last_page || !(j.tasks ?? []).length) break
  }
  return out
}

// ── Cruce cuenta ↔ tarea de ClickUp (por nombre del cliente, de la cuenta o del portfolio) ──
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'legales', 'usd', 'ars',
  'maria', 'jose', 'juan', 'carlos', 'gabriel', 'gabriela', 'dario', 'natalia', 'sofia', 'andrea', 'lucas', 'paula', 'agustina', 'yanina',
  'lopez', 'gallardo', 'diaz', 'rodriguez', 'gomez', 'garcia', 'fernandez', 'perez', 'salas', 'daniel', 'laura', 'luciana', 'noelia',
  'gisela', 'cristina', 'diego', 'pablo', 'julio', 'cesar', 'carmen', 'paz', 'ruiz', 'del', 'los', 'las', 'con', 'consultora', 'abogadas'])
const palabras = (x: string) => norm(x).split(' ').filter(w => w.length >= 4 && !GENERICAS.has(w))
const todas = (x: string) => norm(x).split(' ').filter(w => w.length >= 3)

export function crearCruceRamas(tareas: TareaAnuncio[]) {
  // Primero las tareas vivas; las de "muerte" (dadas de baja) solo si no hay otra
  const vivas = [...tareas].sort((a, b) => Number(a.estado === 'muerte') - Number(b.estado === 'muerte'))
  const frecuencia = new Map<string, number>()
  for (const t of vivas) for (const w of new Set(palabras(t.nombre))) frecuencia.set(w, (frecuencia.get(w) ?? 0) + 1)
  return function buscar(nombres: string[]): TareaAnuncio | null {
    const nn = nombres.filter(Boolean).map(norm)
    // 1) portfolio de ClickUp igual al nombre de la cuenta o del portfolio de Meta
    const porPortfolio = vivas.find(t => t.portfolio && nn.includes(norm(t.portfolio)))
    if (porPortfolio) return porPortfolio
    // 2) puntaje por palabras: distintivas (únicas en ClickUp) valen 2, el resto 1; con nombre + apellido 3
    const ws = new Set(nombres.flatMap(todas))
    let mejor: { t: TareaAnuncio; p: number } | null = null, empate = false
    for (const t of vivas) {
      const pt = palabras(t.nombre)
      let p = 0
      for (const w of pt) if (ws.has(w)) p += frecuencia.get(w) === 1 ? 2 : 1
      const tn = todas(t.nombre)
      if (tn.length >= 2 && tn.every(w => ws.has(w))) p += 3   // "Sofia Cuervo", "Paz Robles": todas sus palabras están
      if (t.estado === 'muerte') p -= 0.5
      if (p >= 2 && (!mejor || p > mejor.p)) { mejor = { t, p }; empate = false }
      else if (mejor && p === mejor.p && p >= 2 && t.id !== mejor.t.id && norm(t.nombre).replace(/ (dm|fm)$/, '') !== norm(mejor.t.nombre).replace(/ (dm|fm)$/, '')) empate = true
    }
    return mejor && !empate ? mejor.t : null
  }
}
