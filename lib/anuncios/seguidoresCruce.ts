// ── Costo por seguidor real de FM: cruce diario Meta Ads × Business Suite ─────────────────────────────────────────────
// La foto del día la arma una tarea en la Mac (Business Suite solo se lee con el navegador) y la manda a
// POST /api/ads/seguidores. Acá se valida esa foto y se calculan los costos que muestra el Resumen.
//
//   · Costo atribuido = gasto ÷ seguidores que Meta Ads le atribuye al anuncio.
//   · Costo real      = gasto ÷ seguidores «de anuncios» del posteo en Business Suite (los orgánicos NO cuentan).
//   · Con orgánicos   = gasto ÷ seguidores totales del posteo (referencia).
//   · Perfil          = anuncios que no usan un posteo (contenido subido): gasto ÷ (crecimiento del perfil − seguidores
//                       orgánicos que trajeron los posteos propios del perfil, según Business Suite).
// Todo se suma también por cuenta publicitaria («principal», «secundaria»), además del total de FM.
// Business Suite da acumulados: el dato de un día sale de restar contra la foto anterior.
// Sin imports de Next: se prueba con node:test. Los IDs de cuentas y posteos llegan con los datos, nunca en el código.

export interface PosteoFoto {
  clave: string                 // palabra corta del posteo (PAPA, REBAJA…)
  texto?: string                // comienzo del texto del posteo, para reconocerlo
  cuenta: string                // nombre corto de la cuenta publicitaria («principal», «secundaria»)
  gastoAcum: number             // USD, desde que se prendió cada anuncio
  atribuidosAcum: number        // seguidores que Meta Ads atribuye (acumulado)
  gastoAyer: number
  atribuidosAyer: number
  bsTotal: number | null        // seguidores del posteo en Business Suite (null = sin dato)
  bsAnuncios: number | null     // de esos, los que vinieron de anuncios
}

export interface PerfilFoto {
  usuario: string               // @ del perfil, sin la arroba
  cuenta: string
  seguidores: number            // seguidores del perfil al momento de la foto
  seguidoresInicio?: number     // seguidores cuando arrancaron los anuncios (para el acumulado)
  organicosAcum?: number        // seguidores orgánicos de los posteos propios del perfil desde el inicio (se restan)
  gastoAcum: number
  atribuidosAcum: number
  gastoAyer: number
  atribuidosAyer: number
}

export interface FotoCruce {
  dia: string                   // AAAA-MM-DD (hora argentina) del día en que se tomó la foto
  tomada: string                // ISO del momento de la lectura
  posteos: PosteoFoto[]
  perfiles: PerfilFoto[]
  notas?: string[]              // avisos de la tarea (p. ej. «Business Suite no cargó»)
}

const MAX_FILAS = 200
const MAX_TEXTO = 160

const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const numONull = (v: unknown): number | null | undefined => v === null ? null : esNum(v) ? v : undefined
const texto = (v: unknown, max = MAX_TEXTO): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/** Valida la foto que manda la tarea. Devuelve la foto limpia o el motivo del rechazo (nunca lanza). */
export function validarFoto(entrada: unknown): { ok: true; foto: FotoCruce } | { ok: false; motivo: string } {
  if (!entrada || typeof entrada !== 'object') return { ok: false, motivo: 'cuerpo vacío o no es un objeto' }
  const e = entrada as Record<string, unknown>
  const dia = typeof e.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.dia) ? e.dia : null
  if (!dia || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) return { ok: false, motivo: 'dia tiene que ser AAAA-MM-DD' }
  const tomada = typeof e.tomada === 'string' && !Number.isNaN(Date.parse(e.tomada)) ? new Date(e.tomada).toISOString() : null
  if (!tomada) return { ok: false, motivo: 'tomada tiene que ser una fecha ISO' }
  if (!Array.isArray(e.posteos) || !Array.isArray(e.perfiles ?? [])) return { ok: false, motivo: 'posteos y perfiles tienen que ser listas' }
  const crudosPerfiles = (e.perfiles ?? []) as unknown[]
  if (e.posteos.length + crudosPerfiles.length > MAX_FILAS) return { ok: false, motivo: `más de ${MAX_FILAS} filas` }

  const posteos: PosteoFoto[] = []
  for (const [i, p] of (e.posteos as unknown[]).entries()) {
    const f = (p ?? {}) as Record<string, unknown>
    const clave = texto(f.clave, 40), cuenta = texto(f.cuenta, 40)
    const bsTotal = numONull(f.bsTotal), bsAnuncios = numONull(f.bsAnuncios)
    if (!clave || !cuenta) return { ok: false, motivo: `posteo ${i + 1}: falta clave o cuenta` }
    if (![f.gastoAcum, f.atribuidosAcum, f.gastoAyer, f.atribuidosAyer].every(esNum))
      return { ok: false, motivo: `posteo ${clave}: gasto y atribuidos tienen que ser números ≥ 0` }
    if (bsTotal === undefined || bsAnuncios === undefined)
      return { ok: false, motivo: `posteo ${clave}: bsTotal y bsAnuncios tienen que ser números ≥ 0 o null` }
    if (bsTotal != null && bsAnuncios != null && bsAnuncios > bsTotal)
      return { ok: false, motivo: `posteo ${clave}: bsAnuncios no puede superar a bsTotal` }
    posteos.push({
      clave, texto: texto(f.texto), cuenta,
      gastoAcum: f.gastoAcum as number, atribuidosAcum: f.atribuidosAcum as number,
      gastoAyer: f.gastoAyer as number, atribuidosAyer: f.atribuidosAyer as number,
      bsTotal, bsAnuncios,
    })
  }

  const perfiles: PerfilFoto[] = []
  for (const [i, p] of crudosPerfiles.entries()) {
    const f = (p ?? {}) as Record<string, unknown>
    const usuario = texto(f.usuario, 60)?.replace(/^@/, ''), cuenta = texto(f.cuenta, 40)
    if (!usuario || !cuenta) return { ok: false, motivo: `perfil ${i + 1}: falta usuario o cuenta` }
    if (![f.seguidores, f.gastoAcum, f.atribuidosAcum, f.gastoAyer, f.atribuidosAyer].every(esNum))
      return { ok: false, motivo: `perfil ${usuario}: seguidores, gasto y atribuidos tienen que ser números ≥ 0` }
    if (f.seguidoresInicio !== undefined && !esNum(f.seguidoresInicio))
      return { ok: false, motivo: `perfil ${usuario}: seguidoresInicio tiene que ser un número ≥ 0` }
    if (f.organicosAcum !== undefined && !esNum(f.organicosAcum))
      return { ok: false, motivo: `perfil ${usuario}: organicosAcum tiene que ser un número ≥ 0` }
    perfiles.push({
      usuario, cuenta, seguidores: f.seguidores as number,
      ...(f.seguidoresInicio !== undefined ? { seguidoresInicio: f.seguidoresInicio as number } : {}),
      ...(f.organicosAcum !== undefined ? { organicosAcum: f.organicosAcum as number } : {}),
      gastoAcum: f.gastoAcum as number, atribuidosAcum: f.atribuidosAcum as number,
      gastoAyer: f.gastoAyer as number, atribuidosAyer: f.atribuidosAyer as number,
    })
  }

  const notas = Array.isArray(e.notas) ? e.notas.map(n => texto(n, 240)).filter((n): n is string => !!n).slice(0, 10) : []
  return { ok: true, foto: { dia, tomada, posteos, perfiles, ...(notas.length ? { notas } : {}) } }
}

// ── Cálculo ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** gasto ÷ seguidores; null si no hay divisor (se muestra «—», nunca infinito ni 0). */
export const costo = (gasto: number, seguidores: number | null | undefined): number | null =>
  seguidores != null && seguidores > 0 && Number.isFinite(gasto) ? gasto / seguidores : null

export interface FilaPosteo {
  clave: string
  texto?: string
  cuenta: string
  gastoAcum: number
  atribuidosAcum: number
  costoAtribuido: number | null
  bsTotal: number | null
  bsAnuncios: number | null
  costoReal: number | null            // gasto ÷ seguidores de anuncios (sin orgánicos)
  costoConOrganicos: number | null    // gasto ÷ seguidores totales (referencia)
  // Día (contra la foto anterior). null cuando no hay foto anterior o Business Suite no dio dato.
  gastoAyer: number
  atribuidosAyer: number
  costoAtribuidoAyer: number | null
  bsNuevos: number | null
  bsAnunciosNuevos: number | null
  costoRealAyer: number | null        // gasto del día ÷ seguidores de anuncios nuevos
}

export interface FilaPerfil {
  usuario: string
  cuenta: string
  seguidores: number
  crecimientoAcum: number | null      // seguidores − seguidores al inicio
  organicosAcum: number               // orgánicos de los posteos propios que se restan
  nuevosAcum: number | null           // crecimiento − orgánicos (lo que se le adjudica a los anuncios)
  costoRealAcum: number | null
  gastoAcum: number
  atribuidosAcum: number
  costoAtribuido: number | null
  gastoAyer: number
  atribuidosAyer: number
  nuevosAyer: number | null
  costoRealAyer: number | null
}

export interface TotalesCruce {
  gastoAcum: number
  atribuidosAcum: number
  costoAtribuido: number | null
  seguidoresReales: number            // de anuncios: Business Suite «de anuncios» + crecimiento de perfiles sin orgánicos
  seguidoresConOrganicos: number      // Business Suite total + crecimiento de perfiles
  gastoConDato: number                // gasto de los posteos y perfiles que tienen dato real
  costoReal: number | null
  gastoAyer: number
  atribuidosAyer: number
  costoAtribuidoAyer: number | null
  seguidoresRealesAyer: number | null // null sin foto anterior
  gastoAyerConDato: number
  costoRealAyer: number | null
}

export interface CruceCalculado {
  dia: string
  tomada: string
  diaAnterior: string | null
  posteos: FilaPosteo[]
  perfiles: FilaPerfil[]
  totales: TotalesCruce
  porCuenta: { cuenta: string; totales: TotalesCruce }[]   // principal primero, después el resto por nombre
  notas: string[]
}

const idPosteo = (p: { cuenta: string; clave: string }) => `${p.cuenta}|${p.clave}`.toLowerCase()
const resta = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? Math.max(0, a - b) : null)
const suma = (xs: number[]) => xs.reduce((a, x) => a + x, 0)

function totalizar(posteos: FilaPosteo[], perfiles: FilaPerfil[], hayAnterior: boolean): TotalesCruce {
  const posteosConDato = posteos.filter(p => p.bsAnuncios != null)
  const perfilesConDato = perfiles.filter(p => p.nuevosAcum != null)
  const gastoAcum = suma(posteos.map(p => p.gastoAcum)) + suma(perfiles.map(p => p.gastoAcum))
  const atribuidosAcum = suma(posteos.map(p => p.atribuidosAcum)) + suma(perfiles.map(p => p.atribuidosAcum))
  const gastoAyer = suma(posteos.map(p => p.gastoAyer)) + suma(perfiles.map(p => p.gastoAyer))
  const atribuidosAyer = suma(posteos.map(p => p.atribuidosAyer)) + suma(perfiles.map(p => p.atribuidosAyer))
  const seguidoresReales = suma(posteosConDato.map(p => p.bsAnuncios as number)) + suma(perfilesConDato.map(p => p.nuevosAcum as number))
  const seguidoresConOrganicos = suma(posteos.filter(p => p.bsTotal != null).map(p => p.bsTotal as number))
    + suma(perfiles.filter(p => p.crecimientoAcum != null).map(p => p.crecimientoAcum as number))
  const gastoConDato = suma(posteosConDato.map(p => p.gastoAcum)) + suma(perfilesConDato.map(p => p.gastoAcum))
  // Día: solo lo que tiene seguidores del día (posteos con dato contra la foto anterior y perfiles con dos fotos)
  const posteosDia = posteos.filter(p => p.bsAnunciosNuevos != null)
  const perfilesDia = perfiles.filter(p => p.nuevosAyer != null)
  const seguidoresRealesAyer = hayAnterior
    ? suma(posteosDia.map(p => p.bsAnunciosNuevos as number)) + suma(perfilesDia.map(p => p.nuevosAyer as number)) : null
  const gastoAyerConDato = suma(posteosDia.map(p => p.gastoAyer)) + suma(perfilesDia.map(p => p.gastoAyer))
  return {
    gastoAcum, atribuidosAcum, costoAtribuido: costo(gastoAcum, atribuidosAcum),
    seguidoresReales, seguidoresConOrganicos, gastoConDato, costoReal: costo(gastoConDato, seguidoresReales),
    gastoAyer, atribuidosAyer, costoAtribuidoAyer: costo(gastoAyer, atribuidosAyer),
    seguidoresRealesAyer, gastoAyerConDato, costoRealAyer: costo(gastoAyerConDato, seguidoresRealesAyer),
  }
}

/**
 * Calcula el cruce con la foto más nueva y, si hay, la anterior (para los seguidores del día).
 * `anterior` tiene que ser de un día previo a `actual`; si es del mismo día se ignora.
 */
export function calcularCruce(actual: FotoCruce, anterior?: FotoCruce | null): CruceCalculado {
  const previa = anterior && anterior.dia < actual.dia ? anterior : null
  const prevPosteos = new Map((previa?.posteos ?? []).map(p => [idPosteo(p), p]))
  const prevPerfiles = new Map((previa?.perfiles ?? []).map(p => [`${p.cuenta}|${p.usuario}`.toLowerCase(), p]))

  const posteos: FilaPosteo[] = actual.posteos.map(p => {
    const ant = prevPosteos.get(idPosteo(p))
    const bsAnunciosNuevos = resta(p.bsAnuncios, ant?.bsAnuncios)
    return {
      clave: p.clave, ...(p.texto ? { texto: p.texto } : {}), cuenta: p.cuenta,
      gastoAcum: p.gastoAcum, atribuidosAcum: p.atribuidosAcum, costoAtribuido: costo(p.gastoAcum, p.atribuidosAcum),
      bsTotal: p.bsTotal, bsAnuncios: p.bsAnuncios,
      costoReal: costo(p.gastoAcum, p.bsAnuncios), costoConOrganicos: costo(p.gastoAcum, p.bsTotal),
      gastoAyer: p.gastoAyer, atribuidosAyer: p.atribuidosAyer, costoAtribuidoAyer: costo(p.gastoAyer, p.atribuidosAyer),
      bsNuevos: resta(p.bsTotal, ant?.bsTotal), bsAnunciosNuevos,
      costoRealAyer: costo(p.gastoAyer, bsAnunciosNuevos),
    }
  }).sort((a, b) => b.gastoAyer - a.gastoAyer || b.gastoAcum - a.gastoAcum)

  const perfiles: FilaPerfil[] = actual.perfiles.map(p => {
    const ant = prevPerfiles.get(`${p.cuenta}|${p.usuario}`.toLowerCase())
    const organicosAcum = p.organicosAcum ?? 0
    const crecimientoAcum = resta(p.seguidores, p.seguidoresInicio)
    const nuevosAcum = resta(crecimientoAcum, organicosAcum)
    const crecimientoDia = ant ? p.seguidores - ant.seguidores : null
    const nuevosAyer = crecimientoDia == null ? null : Math.max(0, crecimientoDia - Math.max(0, organicosAcum - (ant?.organicosAcum ?? 0)))
    return {
      usuario: p.usuario, cuenta: p.cuenta, seguidores: p.seguidores,
      crecimientoAcum, organicosAcum, nuevosAcum, costoRealAcum: costo(p.gastoAcum, nuevosAcum),
      gastoAcum: p.gastoAcum, atribuidosAcum: p.atribuidosAcum, costoAtribuido: costo(p.gastoAcum, p.atribuidosAcum),
      gastoAyer: p.gastoAyer, atribuidosAyer: p.atribuidosAyer, nuevosAyer, costoRealAyer: costo(p.gastoAyer, nuevosAyer),
    }
  })

  const hayAnterior = previa != null
  const cuentas = [...new Set([...posteos.map(p => p.cuenta), ...perfiles.map(p => p.cuenta)])]
    .sort((a, b) => (a === 'principal' ? -1 : b === 'principal' ? 1 : a.localeCompare(b)))
  return {
    dia: actual.dia, tomada: actual.tomada, diaAnterior: previa?.dia ?? null, posteos, perfiles,
    totales: totalizar(posteos, perfiles, hayAnterior),
    porCuenta: cuentas.map(cuenta => ({
      cuenta, totales: totalizar(posteos.filter(p => p.cuenta === cuenta), perfiles.filter(p => p.cuenta === cuenta), hayAnterior),
    })),
    notas: actual.notas ?? [],
  }
}

/** Semáforo de costo por seguidor (el mismo del CPL Instagram del Resumen). */
export function veredictoCosto(c: number): { etiqueta: string; tono: 'bueno' | 'medio' | 'malo' } {
  if (c <= 2.2) return { etiqueta: 'Winner', tono: 'bueno' }
  if (c <= 3) return { etiqueta: 'Escalar', tono: 'bueno' }
  if (c <= 5) return { etiqueta: 'Regular', tono: 'medio' }
  return { etiqueta: 'Bajo', tono: 'malo' }
}
