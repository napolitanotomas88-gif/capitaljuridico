// ── Respuestas del Typeform de satisfacción (planilla "Typeform · Satisfacción de clientes (respuestas)") ─────────
// Puro: recibe las filas (la primera = encabezados) y los clientes, y devuelve los puntajes cruzados y la bandeja de
// "respuestas sin asignar". Columnas reales (8/10/2026): Fecha (AR) · Response ID · Nombre · Apellido · Estudio · Puntaje (0-10)
// · Área a mejorar · Qué cambiaría · Formulario · ID cliente (CRM). Las respuestas nuevas las agrega un webhook de Typeform.
// Cruce, en orden: la columna "ID cliente (CRM)" si alguien la completó · mail · teléfono (si algún día vienen) · nombre + apellido
// · estudio. Normaliza acentos y mayúsculas y nunca adivina: si dos clientes calzan igual, va a "sin asignar".
// Se deduplica por Response ID (el webhook puede reintentar) y se ignoran las filas de prueba. El puntaje (0 a 10) va tal cual.
import type { Puntaje } from './modelo'
import { puntajeLeible } from './modelo'
import { esYmdValido, type Ymd } from '../clientes/fechas'

export interface ClienteParaCruce { id: string; nombre: string; mail: string; celular: string }
export interface RespuestaSinAsignar { fecha: Ymd | null; nombre: string; mail: string; telefono: string; valor: number | null; motivo: string }
export interface ResultadoTypeform { puntajes: Puntaje[]; sinAsignar: RespuestaSinAsignar[]; columnaPuntaje: string | null; respuestas: number }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim()
const digitos = (s: string) => s.replace(/\D/g, '')
const PISTA_PUNTAJE = /(del?\s*[01]\s*(al|a)\s*10|[01]\s*-\s*10|puntaje|calific|punt[uú]a|c[oó]mo te (est[aá]|va)|qu[eé] tan)/i
// Palabras que no identifican a nadie (en nombres de estudios sobre todo)
const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'juridicos', 'abogado', 'abogada', 'abogados', 'abogadas', 'asoc', 'asociados', 'asociadas', 'legal',
  'legales', 'consultora', 'consultoria', 'derecho', 'dra', 'dr', 'del', 'los', 'las', 'con', 'and', 'y', 'de', 'la', 'el', 'srl', 'sa'])
// Respuestas que no son de clientes: la de Tomás (prueba de la encuesta, 2/9/2026)
const IGNORAR_ESTUDIOS = new Set(['estudio juridico napolitano'])
const tokens = (s: string) => norm(s).replace(/[@.]/g, ' ').split(' ').filter(w => w.length >= 3 && !GENERICAS.has(w))

function dia(c: unknown): Ymd | null {
  if (typeof c === 'number' && c > 20000 && c < 80000) return new Date(Math.round((c - 25569) * 86400000)).toISOString().slice(0, 10)
  const s = String(c ?? '').trim()
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1]
  if (iso && esYmdValido(iso)) return iso
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)   // "2/9/2026, 20:24:07" (día/mes/año, hora argentina)
  if (m) { const r = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return esYmdValido(r) ? r : null }
  return null
}

/** El único cliente cuyas palabras incluyen TODAS las buscadas (o null si ninguno o más de uno) */
function unico(clientes: { c: ClienteParaCruce; ws: Set<string> }[], buscadas: string[]): ClienteParaCruce | null {
  if (!buscadas.length) return null
  const hits = clientes.filter(x => buscadas.every(w => x.ws.has(w)))
  return hits.length === 1 ? hits[0].c : null
}

/** Un solo cliente con ese apellido y un nombre que empieza con las mismas 3 letras (errores de tipeo como Melisa/Melissa) */
function apellidoYNombreParecido(clientes: { c: ClienteParaCruce; ws: Set<string> }[], nombre: string | undefined, apellidos: string[]): ClienteParaCruce | null {
  if (!nombre || nombre.length < 3 || !apellidos.length) return null
  const hits = clientes.filter(x => apellidos.some(a => a.length >= 4 && x.ws.has(a)) && [...x.ws].some(w => w.slice(0, 3) === nombre.slice(0, 3)))
  return hits.length === 1 ? hits[0].c : null
}

export function leerRespuestas(filas: unknown[][], clientes: ClienteParaCruce[], columnaForzada?: string): ResultadoTypeform {
  const vacio: ResultadoTypeform = { puntajes: [], sinAsignar: [], columnaPuntaje: null, respuestas: 0 }
  if (!filas.length) return vacio
  const enc = filas[0].map(h => String(h ?? '').trim())
  const buscar = (re: RegExp) => enc.findIndex(h => re.test(h))
  const iPuntaje = columnaForzada ? enc.findIndex(h => norm(h) === norm(columnaForzada)) : buscar(PISTA_PUNTAJE)
  const iMail = buscar(/mail/i), iTel = buscar(/tel[eé]fono|celular|whats|phone/i)
  const iNombre = buscar(/^nombre|^name|first name/i), iApellido = buscar(/apellido|last name/i), iEstudio = buscar(/estudio|empresa|company/i)
  const iFecha = buscar(/submit|enviad|fecha|date/i), iResp = buscar(/response id|token|respuesta id/i), iId = buscar(/id cliente/i)
  if (iPuntaje < 0) return { ...vacio, respuestas: filas.length - 1 }

  const porId = new Map(clientes.map(c => [c.id.toUpperCase(), c]))
  const porMail = new Map(clientes.filter(c => c.mail).map(c => [c.mail.trim().toLowerCase(), c]))
  const porTel = new Map(clientes.filter(c => digitos(c.celular).length >= 8).map(c => [digitos(c.celular).slice(-8), c]))
  const conPalabras = clientes.map(c => ({ c, ws: new Set(tokens(c.nombre)) }))

  const out: ResultadoTypeform = { ...vacio, columnaPuntaje: enc[iPuntaje] }
  const vistas = new Set<string>()
  const celda = (f: unknown[], i: number) => (i >= 0 ? String(f[i] ?? '').trim() : '')
  for (const f of filas.slice(1)) {
    const nombre = celda(f, iNombre), apellido = celda(f, iApellido), estudio = celda(f, iEstudio)
    const mail = celda(f, iMail).toLowerCase(), tel = celda(f, iTel), idManual = celda(f, iId).toUpperCase()
    const crudoPuntaje = celda(f, iPuntaje)
    if (!nombre && !apellido && !mail && !tel && !crudoPuntaje) continue
    if (/prueba|test/i.test(`${nombre} ${apellido}`)) continue                    // filas de prueba del webhook
    if (IGNORAR_ESTUDIOS.has(norm(estudio))) continue                             // respuestas internas (no son de clientes)
    const resp = celda(f, iResp)
    if (resp) { if (vistas.has(resp)) continue; vistas.add(resp) }               // reintentos del webhook: una sola vez
    out.respuestas++
    const valor = Number(crudoPuntaje.replace(',', '.'))
    const fecha = iFecha >= 0 ? dia(f[iFecha]) : null
    const completo = [nombre, apellido].filter(Boolean).join(' ')
    const pNombre = tokens(nombre), pApellido = tokens(apellido)
    const cliente = (idManual && porId.get(idManual))
      || (mail && porMail.get(mail))
      || (digitos(tel).length >= 8 && porTel.get(digitos(tel).slice(-8)))
      || unico(conPalabras, [...pNombre, ...pApellido])                          // nombre y apellido completos
      || unico(conPalabras, [...pNombre.slice(0, 1), ...pApellido.slice(0, 1)])  // primer nombre + primer apellido
      || unico(conPalabras, tokens(estudio).filter(w => w.length >= 4))          // el estudio ("Estudio Jurídico Romero & Asoc")
      || apellidoYNombreParecido(conPalabras, pNombre[0], pApellido)              // "Melisa" ↔ "Melissa": mismo apellido (único) y nombre que empieza igual
      || null
    if (!puntajeLeible(valor) || !fecha || !cliente) {
      out.sinAsignar.push({ fecha, nombre: [completo, estudio].filter(Boolean).join(' · '), mail, telefono: tel, valor: puntajeLeible(valor) ? valor : null,
        motivo: !cliente ? 'No coincide con un único cliente (nombre, apellido ni estudio)' : !fecha ? 'Sin fecha de respuesta' : 'Puntaje fuera de 0 a 10' })
      continue
    }
    out.puntajes.push({ fecha, dia: fecha, mes: fecha.slice(0, 7), idCliente: cliente.id, valor, fuente: 'typeform', nota: 'Respuesta del Typeform', quien: 'Typeform' })
  }
  return out
}
