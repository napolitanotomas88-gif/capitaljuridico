// ── Envío de una tanda aprobada: Doc del cliente (Puente Drive) + aviso al grupo Contenido (Whapi) ──
// Decisiones de Tomás (25/10/2026): el cliente lee los guiones en SU Doc «Guiones - Alias» y el bot le avisa en el grupo
// «Contenido - <cliente>» de su comunidad de WhatsApp.
//   · Doc (27/10, «tal cual como lo vinimos haciendo»): cada guion va DEBAJO de su chip «Video:» de la «TANDA N°» del Doc
//     (copia de «Plantilla Guiones - C.J»), con el formato de los Docs cargados a mano: HOOK en negrita, «Velocidad N», la
//     indicación entre paréntesis resaltada y el texto, con un renglón vacío entre secciones. Si falta el chip del 6.º guion,
//     el puente lo agrega. La TANDA del Doc la elige el puente (tanda 0): la que ya cargó el bot o la primera con todos los
//     chips vacíos (el Doc puede traer tandas cargadas a mano: la tanda 1 del bot no siempre es la «TANDA 1°» del Doc). Acción «cargarEnChips» del Puente Drive (Apps Script con la cuenta administradora configurada; el código está
//     en docs/guiones/puente/GuionesChips.gs y lo publica la sesión CONSULTOR). Solo escribe bajo chips vacíos o ya cargados
//     por el bot (clave estable por tanda: una corrección reemplaza lo suyo); si una persona ya escribió ahí, frena. Mientras
//     el puente no tenga la acción, responde «acción desconocida» y el envío queda pendiente. No se reintenta (un 5xx después
//     de correr el script puede haberla escrito: queda dudoso).
//   · WhatsApp: SOLO con GUIONES_WHATSAPP=real (apagado por defecto: nada sale a un cliente sin la prueba controlada y el OK
//     de Tomás). El grupo se busca por nombre (GET /groups: «Contenido» + el nombre del cliente) o se carga a mano.
// Nunca imprime la URL ni el secreto del puente ni el token de Whapi. Solo servidor.
import { crearClienteWhapi } from '../whapi/cliente'
import { tokenWhapi } from '../whapi/config'
import { NOMBRE_SECCION, type Guion } from './tipos'
import type { FilaTanda } from './registro'
import { contienePalabras } from './revisar'
import { grupoContenidoFijo } from '../whapi/gruposFijos'
import { exigirClienteNoArchivado, leerArchivados } from '@/lib/clientes/archivados'

export interface ParrafoChip { tipo: 'seccion' | 'velocidad' | 'indicacion' | 'texto' | 'vacio'; texto: string }
export interface GuionChip { numero: number; parrafos: ParrafoChip[] }

/** Cada guion como va debajo de su chip «Video:»: por sección, «HOOK» (negrita), «Velocidad N», «(indicación)» (resaltada),
 *  el texto y un renglón vacío. Sin título ni «para tener a mano»: los Docs de los clientes no los llevan. */
/** La indicación ya puede venir entre paréntesis (una edición a mano): se sacan los de afuera para no dejar «((…))». */
export function sinParentesis(t: string): string {
  let x = t.trim()
  const envuelve = (y: string) => { if (!y.startsWith('(') || !y.endsWith(')')) return false; let n = 0; for (let i = 0; i < y.length; i++) { n += y[i] === '(' ? 1 : y[i] === ')' ? -1 : 0; if (n === 0 && i < y.length - 1) return false } return n === 0 }
  while (envuelve(x)) x = x.slice(1, -1).trim()
  return x
}

export function guionesParaChips(fila: FilaTanda): GuionChip[] {
  return Object.values(fila.guiones).map(g => g.guion).sort((a, b) => a.numero - b.numero).map(g => ({
    numero: g.numero,
    parrafos: g.secciones.flatMap((s): ParrafoChip[] => [
      { tipo: 'seccion', texto: NOMBRE_SECCION[s.seccion] },
      { tipo: 'velocidad', texto: `Velocidad ${s.velocidad}` },
      { tipo: 'indicacion', texto: `(${sinParentesis(s.indicacion)})` },
      { tipo: 'texto', texto: s.texto },
      { tipo: 'vacio', texto: '' },
    ]),
  }))
}

/** Una clave por tanda (no por aprobación): con ella el puente reconoce lo que cargó el bot y una corrección lo reemplaza. */
export const claveTanda = (fila: FilaTanda) => `cj-guiones-${fila.recording_id}-${fila.tanda}`

export type ResultadoDoc = { estado: 'ok'; id: string; url: string; yaExistia: boolean; tanda: number | null; ancla?: { tab: string | null; heading: string | null } | null } | { estado: 'pendiente' | 'dudoso' | 'error'; motivo: string }

export async function escribirEnDoc(fila: FilaTanda, docId: string, op: { hasta: number }): Promise<ResultadoDoc> {
  const url = process.env.PUENTE_DRIVE_URL?.trim(), secreto = process.env.PUENTE_DRIVE_SECRETO?.trim()
  if (!url || !secreto) return { estado: 'pendiente', motivo: 'falta PUENTE_DRIVE_URL o PUENTE_DRIVE_SECRETO' }
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(docId)) return { estado: 'error', motivo: 'id de Doc inválido' }
  await exigirClienteNoArchivado(fila.id_crm, await leerArchivados({ forzar: true }))
  let r: Response
  try {
    r = await fetch(url, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secreto, accion: 'cargarEnChips', docId, tanda: 0, clave: claveTanda(fila), guiones: guionesParaChips(fila) }),
      signal: AbortSignal.timeout(Math.max(5_000, Math.min(90_000, op.hasta - Date.now()))),
    })
  } catch { return { estado: 'dudoso', motivo: 'el puente no respondió (puede haberla escrito)' } }
  let j: Record<string, unknown> | null = null
  try { j = JSON.parse(await r.text()) as Record<string, unknown> } catch { /* HTML de Apps Script */ }
  if (!r.ok || !j) return { estado: r.status >= 500 || r.redirected ? 'dudoso' : 'error', motivo: `respuesta inválida del puente (HTTP ${r.status})` }
  if (j.ok !== true) {
    const d = String(j.error ?? '').slice(0, 160)
    return /acci[oó]n desconocida/i.test(d) ? { estado: 'pendiente', motivo: 'el Puente Drive todavía no tiene la acción cargarEnChips' } : { estado: 'error', motivo: `el puente rechazó cargarEnChips: ${d}` }
  }
  return { estado: 'ok', id: String(j.id ?? docId), url: String(j.url ?? `https://docs.google.com/document/d/${docId}/edit`), yaExistia: j.yaExistia === true, tanda: typeof j.tanda === 'number' ? j.tanda : null,
    ancla: j.ancla && typeof j.ancla === 'object' ? { tab: typeof (j.ancla as Record<string, unknown>).tab === 'string' ? String((j.ancla as Record<string, unknown>).tab) : null, heading: typeof (j.ancla as Record<string, unknown>).heading === 'string' ? String((j.ancla as Record<string, unknown>).heading) : null } : null }
}

/** Con el check final, los chips «Video:» de la tanda que cargó el bot pasan solos a «Para grabar» (pedido de RESPONSABLE_HUB del
 *  31/10). Acción «estadoChips» del Puente Drive (docs/guiones/puente/GuionesEstadoChips.gs: la Docs API, porque Apps Script no
 *  ve los chips desplegables). Solo cambia los que están en «No iniciado» (nunca baja un «Grabado completo») y es idempotente. */
export type ResultadoChips = { estado: 'ok'; cambiados: number } | { estado: 'pendiente' | 'error'; motivo: string }

export async function marcarParaGrabar(docId: string, tanda: number, cantidad: number, op: { hasta: number }): Promise<ResultadoChips> {
  const url = process.env.PUENTE_DRIVE_URL?.trim(), secreto = process.env.PUENTE_DRIVE_SECRETO?.trim()
  if (!url || !secreto) return { estado: 'pendiente', motivo: 'falta PUENTE_DRIVE_URL o PUENTE_DRIVE_SECRETO' }
  let j: Record<string, unknown> | null = null
  try {
    const r = await fetch(url, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secreto, accion: 'estadoChips', docId, tanda, cantidad, estado: 'Para grabar' }),
      signal: AbortSignal.timeout(Math.max(5_000, Math.min(60_000, op.hasta - Date.now()))),
    })
    j = JSON.parse(await r.text()) as Record<string, unknown>
  } catch { return { estado: 'error', motivo: 'el puente no respondió al cambiar los chips' } }
  if (j?.ok === true) return { estado: 'ok', cambiados: typeof j.cambiados === 'number' ? j.cambiados : 0 }
  const d = String(j?.error ?? '').slice(0, 160)
  return /acci[oó]n desconocida/i.test(d) ? { estado: 'pendiente', motivo: 'el Puente Drive todavía no tiene la acción estadoChips' } : { estado: 'error', motivo: `el puente no cambió los chips: ${d}` }
}

/** El mensaje al grupo Contenido del cliente (texto aprobado por Tomás al prender GUIONES_WHATSAPP el 2/11/2026). */
export function textoWhatsApp(fila: FilaTanda, urlDoc: string): string {
  const nombre = (fila.cliente ?? '').trim().split(/\s+/)[0] || ''
  const n = Object.keys(fila.guiones).length
  const corregida = fila.notas.some(x => x.aplicada)
  return corregida
    ? `¡Hola${nombre ? ` ${nombre}` : ''}! Ya están los guiones con los cambios que nos pediste ✅\nLos tenés en tu documento de guiones, en la Tanda ${fila.doc?.tanda ?? fila.tanda}: ${urlDoc}\nSi está todo ok, ya los podés grabar y subir a tu carpeta de Crudos.`
    : `¡Hola${nombre ? ` ${nombre}` : ''}! Ya tenés los ${n} guiones nuevos 🎬\nTe los dejé en tu documento de guiones, en la Tanda ${fila.doc?.tanda ?? fila.tanda}: ${urlDoc}\nLeelos y contanos acá qué cambiarías. Cuando estén ok, grabalos siguiendo las indicaciones y subilos a tu carpeta de Crudos.`
}

/** d02 + día 0 de grabación en UN solo mensaje: el link a la tanda en el Doc y el pedido de grabar con la fecha sugerida (dos
 *  días hábiles después de hoy, como el día 0 de e01). `fecha` ya viene para el cliente («el jueves 5/11»).
 *  Texto exacto de Tomás (9/11/2026; con su OK se corrigieron «están» y «comentanos»), también para clientes de fuera de Argentina. */
export function textoGuionesParaGrabar(fila: FilaTanda, urlDoc: string, fecha: string): string {
  const nombre = (fila.cliente ?? '').trim().split(/\s+/)[0] || ''
  const n = Object.keys(fila.guiones).length
  const tanda = fila.doc?.tanda ?? fila.tanda
  return `¡Hola${nombre ? ` ${nombre}` : ''}! Ya están los ${n} guiones nuevos. Los dejé en tu documento de guiones, en la Tanda ${tanda}: ${urlDoc}\n`
    + 'Leelos y comentanos si necesitan alguna modificación. Cuando estén ok, grabalos siguiendo las indicaciones.\n'
    + `¿Te queda bien grabarlos para ${fecha}? Cuando los subas a tu carpeta de Crudos, avisanos por acá y arrancamos con la edición.`
}

/** El link a la tanda dentro del Doc: con el título de la tanda (ancla que devuelve el puente) va directo ahí; sin ancla, el Doc. */
export function urlTanda(docId: string, ancla?: { tab?: string | null; heading?: string | null } | null): string {
  const base = `https://docs.google.com/document/d/${docId}/edit`
  const h = ancla?.heading && /^h\.[\w-]+$/.test(ancla.heading) ? ancla.heading : null
  if (!h) return base
  const t = ancla?.tab && /^t\.[\w-]+$/.test(ancla.tab) ? `?tab=${ancla.tab}` : ''
  return `${base}${t}#heading=${h}`
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Busca el grupo «Contenido - <cliente>» entre los grupos del número del bot (GET /groups). null si no hay uno solo claro. */
export async function buscarGrupoContenido(cliente: string, op: { fetch?: typeof fetch; idCrm?: string | null } = {}): Promise<{ id: string; nombre: string } | null> {
  const token = tokenWhapi()
  if (!token || !cliente.trim()) return null
  const r = await (op.fetch ?? fetch)('https://gate.whapi.cloud/groups?count=500', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!r.ok) return null
  const j = (await r.json().catch(() => null)) as { groups?: { id?: string; name?: string }[] } | null
  // Grupo fijado a mano (WHAPI_GRUPOS_CONTENIDO): manda sobre el nombre, pero solo si el bot está en ese grupo
  const fijo = grupoContenidoFijo(cliente, op.idCrm)
  if (fijo) {
    const g = (j?.groups ?? []).find(x => x.id === fijo)
    return g?.id ? { id: g.id, nombre: g.name ?? 'Contenido' } : null
  }
  // TODAS las palabras ENTERAS del nombre (revisión del 25/10: con una sola, «Estudio Hammer» caía en «Contenido - Estudio
  // Cova»; la del 26/10: por pedazos, «Ana Ruiz» caía en «Contenido - Mariana Ruiz»)
  const candidatos = (j?.groups ?? []).filter(g => g.id && g.name && /^contenido\s*-/i.test(normal(g.name)) && contienePalabras(g.name, cliente))
  if (candidatos.length !== 1) return null
  return { id: candidatos[0].id!, nombre: candidatos[0].name! }
}

export type ResultadoWhatsApp = { estado: 'enviado'; id: string | null } | { estado: 'apagado' | 'sin_grupo' | 'error'; motivo: string }

export async function avisarCliente(fila: FilaTanda, grupoId: string | null, urlDoc: string, op: { exigirActivo?: (idCrm: string | null) => Promise<void> } = {}): Promise<ResultadoWhatsApp> {
  if (process.env.GUIONES_WHATSAPP?.trim() !== 'real') return { estado: 'apagado', motivo: 'GUIONES_WHATSAPP no está en «real» (prueba controlada pendiente)' }
  if (!grupoId || !/@g\.us$/.test(grupoId)) return { estado: 'sin_grupo', motivo: 'falta el grupo Contenido del cliente' }
  const token = tokenWhapi()
  if (!token) return { estado: 'error', motivo: 'falta WHAPI_TOKEN' }
  try {
    if (op.exigirActivo) await op.exigirActivo(fila.id_crm)
    else await exigirClienteNoArchivado(fila.id_crm, await leerArchivados({ forzar: true }))
    const w = crearClienteWhapi({ token })
    const env = await w.enviarTexto({ chatId: grupoId, texto: textoWhatsApp(fila, urlDoc) })
    return { estado: 'enviado', id: (env as { id?: string | null }).id ?? null }
  } catch (e) { return { estado: 'error', motivo: ((e as Error)?.message ?? String(e)).slice(0, 200) } }
}

export const resumenGuion = (g: Guion) => `${g.numero}. ${g.titulo}`
