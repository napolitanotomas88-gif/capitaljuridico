// ── Bot "Capital Jurídico": etapa BAJA — qué mensajes del webhook de Whapi le importan (PURO: sin red, sin base, sin reloj) ──
// Del mismo envío que procesan el motor de altas, el reenvío a Guiones (y la etapa Éxito), sin tocar a ninguno:
//   · respuestas: en Verificaciones C.J, un texto que CITA un mensaje y empieza con OK o NO (el mismo veredicto() del
//     webhook). A qué pedido responde y si el autor puede aprobar se mira después (nucleo.ts): si cita algo que no es un
//     pedido de bajas (un alta, un pedido de Éxito), se ignora. Igual al revés: el motor ignora las que citan un pedido de bajas.
//   · ecos: lo que el propio bot mandó por la API a Verificaciones (recupera el id de un pedido que volvió sin id).
// Nada de los grupos de los clientes: esta etapa no lee charla (la llamada de renovación llega por Fathom).
import type { AutorWhapi, ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { ANTIGUEDAD_MAX_MS, leerEnvoltura, normalizarMensaje, veredicto } from '@/lib/bot/whapi/webhook'

export const MAX_CANDIDATOS_BAJAS = 30

export interface RespuestaBaja { mensajeId: string; citado: string; veredicto: 'ok' | 'no'; resto: string; autor: AutorWhapi; enviadoEn: string }
export interface EcoBaja { mensajeId: string; texto: string; enviadoEn: string }
export interface CandidatosBajas { respuestas: RespuestaBaja[]; ecos: EcoBaja[] }
export const sinCandidatosBajas = (c: CandidatosBajas) => !c.respuestas.length && !c.ecos.length

const TIPOS_TEXTO = new Set(['text', 'link_preview'])

export function candidatosBajas(json: unknown, grupos: ConfigGrupos, ahora: number): CandidatosBajas {
  const r: CandidatosBajas = { respuestas: [], ecos: [] }
  const env = leerEnvoltura(json)
  if (!env) return r
  const vistos = new Set<string>()
  for (const x of env.mensajes) {
    const m = normalizarMensaje(x)
    if (!m || vistos.has(m.id) || m.chatId !== grupos.verificaciones) continue
    vistos.add(m.id)
    if (ahora - Date.parse(m.enviadoEn) > ANTIGUEDAD_MAX_MS) continue
    if (r.respuestas.length + r.ecos.length >= MAX_CANDIDATOS_BAJAS) break
    if (!TIPOS_TEXTO.has(m.tipo) || !m.texto) continue
    if (m.deMi) {
      if (m.fuente === 'api') r.ecos.push({ mensajeId: m.id, texto: m.texto, enviadoEn: m.enviadoEn })
      continue
    }
    const v = veredicto(m.texto)
    if (!v || !m.citado) continue
    r.respuestas.push({ mensajeId: m.id, citado: m.citado.id, veredicto: v.tipo, resto: v.tipo === 'ok' ? v.resto : v.motivo, autor: m.autor, enviadoEn: m.enviadoEn })
  }
  return r
}
