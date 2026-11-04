// ── Escribir en el Doc «Organización de ADS - Orgánico» el video que pasó a Publicar (4/11/2026) ─────────────────────
// El flujo Publicar del tablero de Edición (lib/edicion/publicar.ts) anota el video en el Doc, con el formato del equipo:
//   · el cliente ya tiene un bloque LISTO (el más nuevo) → «video N: <link>» + su copy al final de ese bloque;
//   · si no → un bloque nuevo ARRIBA de todo: «<Nombre> - LISTO» + «video 1: <link>» + copy.
// Sin duplicar: si el archivo de Drive ya figura en el Doc, no se escribe nada. Antes de escribir se relee el Doc y la
// escritura exige esa misma revisión (requiredRevisionId): si alguien lo cambió en el medio, se reintenta en la próxima.
// Se escribe con la API de Google Docs (cuenta de servicio). Apagado salvo ANUNCIOS_DOC_ESCRIBIR=real. Si la API no está
// habilitada en el proyecto de Google o la cuenta no puede editar, se informa y el flujo sigue igual (el armado no
// depende del Doc). La parte pura (planEscrituraDoc) la prueba scripts/test-edicion-sync.mjs.
import { createSign } from 'node:crypto'
import { cruzarNombreDoc, idDrive, parsearDocAds } from './docAds'

export interface ParrafoDoc { inicio: number; fin: number; texto: string }
export type PlanDoc = { tipo: 'nada'; motivo: string } | { tipo: 'insertar'; indice: number; texto: string; bloque: 'nuevo' | 'existente'; titulo: string }

const linkDrive = (id: string) => `https://drive.google.com/file/d/${id}/view`
/** Dónde y qué insertar. Puro. */
export function planEscrituraDoc(parrafos: readonly ParrafoDoc[], x: { cliente: string; drive: string; copy: string }): PlanDoc {
  // Una línea por párrafo (los saltos suaves \v cuentan como línea, como en el export a texto)
  const lineas: { texto: string; fin: number }[] = []
  for (const p of parrafos) {
    const partes = p.texto.replace(/\n$/, '').split('\u000b')
    let pos = p.inicio
    for (const [i, t] of partes.entries()) { pos += t.length; lineas.push({ texto: t, fin: i === partes.length - 1 ? p.fin - 1 : pos }); pos += 1 }
  }
  const texto = lineas.map(l => l.texto).join('\n')
  if (texto.split('\n').some(l => idDrive(l) === x.drive)) return { tipo: 'nada', motivo: 'el video ya está en el Doc de ADS' }
  const copy = x.copy.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').trim()
  const bloques = parsearDocAds(texto)
  const i = bloques.findIndex(b => cruzarNombreDoc(b.nombre, [{ cliente: x.cliente }])?.fuerza === 'firme')
  const b = i >= 0 ? bloques[i] : null
  if (b && b.listo) {
    // Fin del bloque = la última línea del último video (su link y las líneas de su copy o fecha), nunca lo que sigue.
    const hasta = i + 1 < bloques.length ? bloques[i + 1].linea - 1 : lineas.length
    const ult = b.videos[b.videos.length - 1]
    let ultima = b.linea - 1
    for (let j = b.linea; j < hasta; j++) if (/^\s*video\s*\d{1,2}/i.test(lineas[j].texto) && (!ult || (idDrive(lineas[j].texto) ?? '') === (ult.drive ?? idDrive(lineas[j].texto) ?? '') && new RegExp(`video\\s*${ult.numero}\\b`, 'i').test(lineas[j].texto))) ultima = j
    const resto = `${ult?.copy ?? ''}\n${ult?.fecha ?? ''}`
    while (ultima + 1 < hasta && lineas[ultima + 1].texto.trim() && (resto.includes(lineas[ultima + 1].texto.trim()) || idDrive(lineas[ultima + 1].texto) === ult?.drive)) ultima++
    const n = Math.max(0, ...b.videos.map(v => v.numero)) + 1
    return { tipo: 'insertar', indice: lineas[ultima].fin, texto: `\nvideo ${n}: ${linkDrive(x.drive)}\n${copy}`, bloque: 'existente', titulo: b.titulo }
  }
  const titulo = `${x.cliente} - LISTO`
  return { tipo: 'insertar', indice: 1, texto: `${titulo}\nvideo 1: ${linkDrive(x.drive)}\n${copy}\n\n`, bloque: 'nuevo', titulo }
}

export const docEscrituraEncendida = (env: Record<string, string | undefined> = process.env): boolean => env.ANUNCIOS_DOC_ESCRIBIR?.trim() === 'real'

let token: { valor: string; vence: number } | null = null
async function tokenDocs(): Promise<string> {
  if (token && token.vence > Date.now() + 60_000) return token.valor
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  let k = (process.env.GOOGLE_PRIVATE_KEY ?? '').trim()
  if (!email || !k) throw new Error('Falta la cuenta de servicio de Google')
  const m = /^(["'])([\s\S]*)\1$/.exec(k)
  if (m) k = m[2].trim()
  k = `${k.replace(/\\r\\n|\\n/g, '\n').trim()}\n`
  const b64u = (s: string) => Buffer.from(s).toString('base64url'), ahora = Math.floor(Date.now() / 1000), aud = 'https://oauth2.googleapis.com/token'
  const cab = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), carga = b64u(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/documents', aud, iat: ahora, exp: ahora + 3600 }))
  const firma = createSign('RSA-SHA256').update(`${cab}.${carga}`).sign(k).toString('base64url')
  const r = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cab}.${carga}.${firma}` }), signal: AbortSignal.timeout(8_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`Google rechazó la cuenta de servicio (${r.status})`)
  const j = (await r.json()) as { access_token: string; expires_in: number }
  token = { valor: j.access_token, vence: Date.now() + j.expires_in * 1000 }
  return token.valor
}

/** Escribe el video en el Doc. Devuelve qué pasó (nunca tira): escrito, ya estaba, apagado o sin permiso (con el motivo exacto). */
export async function escribirVideoEnDoc(x: { cliente: string; drive: string; copy: string }, op: { docId: string | null; f?: typeof fetch } = { docId: null }): Promise<string> {
  if (!docEscrituraEncendida()) return 'apagado (ANUNCIOS_DOC_ESCRIBIR): no se escribe el Doc de ADS'
  if (!op.docId) return 'falta ANUNCIOS_DOC_ADS_ID'
  const f = op.f ?? fetch
  try {
    const t = await tokenDocs()
    const g = await f(`https://docs.googleapis.com/v1/documents/${op.docId}?fields=revisionId,body.content(startIndex,endIndex,paragraph.elements.textRun.content)`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    const j = await g.json() as { revisionId?: string; error?: { message?: string }; body?: { content?: { startIndex?: number; endIndex?: number; paragraph?: { elements?: { textRun?: { content?: string } }[] } }[] } }
    if (!g.ok) return g.status === 403 ? `sin permiso: ${String(j.error?.message ?? 'Google respondió 403').replace(/https?:\/\/\S+/g, '').slice(0, 160)}` : `Google respondió ${g.status} al leer el Doc`
    const parrafos: ParrafoDoc[] = (j.body?.content ?? []).filter(c => c.paragraph && typeof c.startIndex === 'number').map(c => ({ inicio: c.startIndex!, fin: c.endIndex!, texto: (c.paragraph!.elements ?? []).map(e => e.textRun?.content ?? '').join('') }))
    const plan = planEscrituraDoc(parrafos, x)
    if (plan.tipo === 'nada') return plan.motivo
    const w = await f(`https://docs.googleapis.com/v1/documents/${op.docId}:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ insertText: { location: { index: plan.indice }, text: plan.texto } }], writeControl: { requiredRevisionId: j.revisionId } }), signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!w.ok) return w.status === 403 ? 'sin permiso para editar el Doc' : w.status === 400 ? 'el Doc cambió mientras se escribía: se reintenta en la próxima' : `Google respondió ${w.status} al escribir`
    return plan.bloque === 'nuevo' ? `escrito: bloque nuevo «${plan.titulo}» arriba de todo` : `escrito: sumado al bloque «${plan.titulo}»`
  } catch (e) { return `no se pudo escribir el Doc (${String((e as Error)?.message ?? e).slice(0, 120)})` }
}
