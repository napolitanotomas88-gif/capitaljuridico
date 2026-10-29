// ── Bot "Capital Jurídico": etapa ÉXITO — rondas de la encuesta mensual y respuestas del Typeform (PURO) ─────────────────────
// Pedido explícito de Tomás (25/10/2026): el bot NUNCA confunde respuestas de meses anteriores con las de la ronda actual.
//   · Cada ronda es un envío de la encuesta a UN cliente (cj_exito_encuestas, id "<AAAA-MM>:<ID del CRM>") con su fecha de envío.
//   · Una respuesta cuenta para una ronda solo si su submitted_at es POSTERIOR (o igual) al envío de esa ronda y ANTERIOR al
//     envío de la ronda siguiente del mismo cliente. Si llegó antes del primer envío del bot, no cuenta para ninguna.
//   · A cada ronda se le vincula una sola respuesta (la primera de su ventana).
//   · Para el éxito se usa SOLO el puntaje de la ronda vigente (la última enviada a ese cliente). Una respuesta vieja no marca
//     "respondió" ni cuenta como éxito actual.
// Formulario (Tomás, 25/10): UNO solo y fijo, "Encuesta mensual de satisfacción" (bnvnMvVn), SIN campos ocultos. El cliente se
// identifica cruzando Nombre + Apellido + Estudio con el CRM (leerRespuestas de lib/seguimiento/typeform.ts: tildes, mayúsculas,
// errores de tipeo, y nunca adivina entre dos). Lo que no cruza con un único cliente es una respuesta DUDOSA: se pregunta en
// Verificaciones C.J y un aprobador la asigna ("OK A123") o la descarta ("NO").
import { createHash } from 'node:crypto'
import { leerRespuestas, type ClienteParaCruce } from '@/lib/seguimiento/typeform'
import type { Encuesta } from './almacen'

export interface RespuestaEncuesta {
  /** Response ID de Typeform (o una huella de la fila si no viene). */
  clave: string
  /** submitted_at (ISO): la columna "Fecha (AR)" de la planilla, con hora. */
  enviadaEn: string
  valor: number | null
  /** ID del CRM si cruzó con un único cliente; null = dudosa. */
  idCliente: string | null
  /** "Nombre Apellido · Estudio" (para la consulta en Verificaciones). */
  quien: string
  motivo: string | null
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** "2/9/2026, 20:24:07" (hora AR, como la escribe el webhook) o un serial de Sheets → ISO. null si no se entiende. */
export function instanteDeCelda(c: unknown): string | null {
  if (typeof c === 'number' && c > 20000 && c < 80000) return new Date(Math.round((c - 25569) * 86_400_000) + 3 * 3600_000).toISOString()
  const s = String(c ?? '').trim()
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  if (m) {
    const [, d, mes, a, h = '0', mi = '0', se = '0'] = m
    const t = Date.parse(`${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${se.padStart(2, '0')}-03:00`)
    return Number.isFinite(t) ? new Date(t).toISOString() : null
  }
  const t = Date.parse(s)
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Las filas de la planilla (la primera, encabezados) → respuestas con su instante y su cliente (o dudosas). */
export function respuestasDeFilas(filas: unknown[][], clientes: ClienteParaCruce[]): RespuestaEncuesta[] {
  if (filas.length < 2) return []
  const enc = filas[0].map((h) => String(h ?? '').trim())
  const col = (re: RegExp) => enc.findIndex((h) => re.test(h))
  const iFecha = col(/submit|enviad|fecha|date/i), iResp = col(/response id|token|respuesta id/i)
  const iNombre = col(/^nombre|^name|first name/i), iApellido = col(/apellido|last name/i), iEstudio = col(/estudio|empresa|company/i)
  const iPuntaje = col(/(del?\s*[01]\s*(al|a)\s*10|[01]\s*-\s*10|puntaje|calific)/i)
  if (iFecha < 0) return []
  const out: RespuestaEncuesta[] = []
  const vistas = new Set<string>()
  for (const f of filas.slice(1)) {
    const celda = (i: number) => (i >= 0 ? String(f[i] ?? '').trim() : '')
    const enviadaEn = instanteDeCelda(f[iFecha])
    if (!enviadaEn) continue
    const quien = [[celda(iNombre), celda(iApellido)].filter(Boolean).join(' '), celda(iEstudio)].filter(Boolean).join(' · ')
    if (!quien) continue
    const clave = celda(iResp) || `fila:${createHash('sha256').update(`${enviadaEn}|${norm(quien)}`).digest('hex').slice(0, 24)}`
    if (vistas.has(clave)) continue   // el webhook puede reintentar: una sola vez
    vistas.add(clave)
    // El cruce por Nombre + Apellido + Estudio es el de la cartera (lib/seguimiento/typeform.ts), fila por fila
    const cruce = leerRespuestas([filas[0], f], clientes)
    if (!cruce.respuestas) continue   // fila de prueba o interna (la descarta el mismo cruce)
    const asignada = cruce.puntajes[0]
    const sin = cruce.sinAsignar[0]
    const crudo = Number(celda(iPuntaje).replace(',', '.'))
    const valor = asignada ? asignada.valor : sin?.valor ?? (Number.isFinite(crudo) && celda(iPuntaje) !== '' ? crudo : null)
    out.push({ clave, enviadaEn, valor, idCliente: asignada ? asignada.idCliente.toUpperCase() : null, quien, motivo: sin?.motivo ?? null })
  }
  return out
}

const porEnvio = (a: Encuesta, b: Encuesta) => (a.enviadaEn ?? '').localeCompare(b.enviadaEn ?? '')

/** La ronda de ese cliente a la que pertenece una respuesta (o null): envío ≤ submitted_at < envío de la siguiente. */
export function rondaDeRespuesta(rondasCliente: readonly Encuesta[], submitted: string): Encuesta | null {
  const rs = rondasCliente.filter((r) => r.enviadaEn).sort(porEnvio)
  const t = Date.parse(submitted)
  for (let i = rs.length - 1; i >= 0; i--) {
    if (Date.parse(rs[i].enviadaEn!) <= t) {
      const siguiente = rs[i + 1]
      return !siguiente || t < Date.parse(siguiente.enviadaEn!) ? rs[i] : null
    }
  }
  return null
}

/** Qué respuesta va a qué ronda (solo rondas sin respuesta; una por ronda, la primera de su ventana). */
export function vinculos(rondas: readonly Encuesta[], respuestas: readonly RespuestaEncuesta[]): { ronda: Encuesta; respuesta: RespuestaEncuesta }[] {
  const porCliente = new Map<string, Encuesta[]>()
  for (const r of rondas) {
    const k = (r.idCrm ?? r.clave).toUpperCase()
    porCliente.set(k, [...(porCliente.get(k) ?? []), r])
  }
  const tomadas = new Set(rondas.filter((r) => r.respuestaId).map((r) => r.id))
  const usadas = new Set(rondas.map((r) => r.respuestaId).filter(Boolean))
  const out: { ronda: Encuesta; respuesta: RespuestaEncuesta }[] = []
  for (const x of [...respuestas].sort((a, b) => a.enviadaEn.localeCompare(b.enviadaEn))) {
    if (!x.idCliente || usadas.has(x.clave)) continue
    const ronda = rondaDeRespuesta(porCliente.get(x.idCliente.toUpperCase()) ?? [], x.enviadaEn)
    if (!ronda || tomadas.has(ronda.id)) continue
    tomadas.add(ronda.id); usadas.add(x.clave)
    out.push({ ronda, respuesta: x })
  }
  return out
}

/** La ronda vigente de cada cliente: la última enviada. */
export function rondasVigentes(rondas: readonly Encuesta[]): Encuesta[] {
  const m = new Map<string, Encuesta>()
  for (const r of [...rondas].filter((x) => x.enviadaEn).sort(porEnvio)) m.set((r.idCrm ?? r.clave).toUpperCase(), r)
  return [...m.values()]
}
