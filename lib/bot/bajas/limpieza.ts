// ── Bot "Capital Jurídico": etapa BAJA — limpieza de un cliente de PRUEBA (BOT_CLIENTES_PRUEBA) ─────────────────────────────
// Borra todo rastro que la etapa dejó del cliente de prueba (scripts/limpiar-cliente-prueba-bajas.mjs). Dependencias
// inyectables: los tests no tocan red ni base. Por defecto SIMULA (solo lee y cuenta); con modo 'real':
//   1. Seguro: si la fila de alguno de esos IDs en el CRM NO es "PRUEBA BOT…", no se toca NADA (ni de ese ni de los otros).
//   2. WhatsApp: borra los mensajes del bot que anotó la prueba (pedidos y respuestas en Verificaciones, aviso de renovación y
//      despedida en el General de prueba) con DELETE /messages/{id}. Antes mira /health (WhatsApp seguro): si el número no
//      está sano, no borra ninguno y lo dice.
//   3. Discord: borra los avisos de Skool y de recontacto de la prueba (DELETE del webhook).
//   4. CRM: vuelve Estado, Fecha de baja y Notas renovación a lo que había, solo si la fila sigue siendo esa fila de prueba
//      y sigue en FINALIZADO / INACTIVO (lo que dejó la prueba). Si la fila ya no está (la borró la limpieza del alta), nada.
//   5. Neon: borra las filas de cj_bajas_pedidos, cj_bajas_bajas, cj_bajas_llamadas y cj_bajas_rastros de esos IDs, y las
//      listas de recontacto de prueba ("prueba:AAAA-MM"). Si algo de 2–4 falló, los rastros se conservan para reintentar.
// Lo que NO se deshace (es el final de una baja y son recursos del cliente de prueba): sacarlo de sus grupos, eliminar su
// comunidad y quitarle el acceso a su carpeta de Drive. Se listan en el informe; esos recursos los borra la limpieza del alta.
import type { Rastro } from './almacen'

export interface FilaCrmPrueba { fila: number; id: string; nombre: string; estado: string }

export interface DepsLimpiezaBajas {
  rastros(ids: readonly string[]): Promise<Rastro[]>
  /** Cantidad de filas por tabla que borraría. */
  contar(ids: readonly string[]): Promise<Record<string, number>>
  /** Borra las filas de Neon. `conRastros`: también cj_bajas_rastros. Devuelve las cantidades borradas. */
  borrar(ids: readonly string[], conRastros: boolean): Promise<Record<string, number>>
  /** Filas de Agencia con esos IDs (para el seguro y para volver atrás el CRM). */
  filasCrm(ids: readonly string[]): Promise<FilaCrmPrueba[]>
  /** Escribe celdas del CRM (USER_ENTERED). */
  escribirCrm?(datos: { range: string; values: unknown[][] }[]): Promise<void>
  /** ¿El número del bot está sano (/health en AUTH)? */
  whatsappSano?(): Promise<boolean>
  borrarWhatsapp?(mensajeId: string): Promise<void>
  borrarDiscord?(mensajeId: string): Promise<void>
  esPrueba(nombre: string): boolean
}

export interface InformeLimpieza {
  modo: 'simular' | 'real'
  ids: string[]
  abortado: string | null
  whatsapp: { mensajes: number; borrados: number; errores: string[] }
  discord: { mensajes: number; borrados: number; errores: string[] }
  crm: { filas: number; revertidas: number; detalle: string[]; errores: string[] }
  neon: Record<string, number>
  noSeDeshace: string[]
}

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\d{8,}/g, '[número]').slice(0, 160)
const yaNoEsta = (e: unknown) => [404, 410].includes(Number((e as { status?: number })?.status))

export async function limpiarPruebaBajas(idsEntrada: readonly string[], modo: 'simular' | 'real', d: DepsLimpiezaBajas): Promise<InformeLimpieza> {
  const ids = [...new Set(idsEntrada.map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]\d{1,6}$/.test(x)))]
  const inf: InformeLimpieza = {
    modo, ids, abortado: null,
    whatsapp: { mensajes: 0, borrados: 0, errores: [] }, discord: { mensajes: 0, borrados: 0, errores: [] },
    crm: { filas: 0, revertidas: 0, detalle: [], errores: [] }, neon: {}, noSeDeshace: [],
  }
  if (!ids.length) { inf.abortado = 'no hay IDs válidos del CRM (por ejemplo Z001)'; return inf }

  // 1. Seguro: todas las filas que existan con esos IDs tienen que ser "PRUEBA BOT…"
  const filas = await d.filasCrm(ids)
  const reales = filas.filter((f) => !d.esPrueba(f.nombre))
  if (reales.length) { inf.abortado = `el ID ${reales.map((f) => f.id).join(', ')} es de una fila que NO es "PRUEBA BOT…": no toco nada`; return inf }

  const rastros = await d.rastros(ids)
  const wa = [...new Set(rastros.filter((r) => r.tipo === 'whatsapp' && typeof r.datos.mensajeId === 'string' && r.datos.mensajeId).map((r) => String(r.datos.mensajeId)))]
  const dudosos = rastros.filter((r) => r.tipo === 'whatsapp' && !r.datos.mensajeId).length
  const dc = [...new Set(rastros.filter((r) => r.tipo === 'discord' && typeof r.datos.mensajeId === 'string' && r.datos.mensajeId).map((r) => String(r.datos.mensajeId)))]
  const crm = rastros.filter((r) => r.tipo === 'crm' && r.datos.anterior)
  inf.whatsapp.mensajes = wa.length
  inf.discord.mensajes = dc.length
  inf.crm.filas = crm.length
  if (dudosos) inf.whatsapp.errores.push(`${dudosos} mensaje(s) que WhatsApp no confirmó (sin id): revisar a mano en Verificaciones y en el General de prueba`)
  for (const r of rastros) {
    if (r.tipo === 'grupos') inf.noSeDeshace.push(`${r.idCrm}: lo sacó del grupo ${String(r.datos.grupo ?? '?')} (${Array.isArray(r.datos.quitados) ? r.datos.quitados.length : 0} persona(s))`)
    if (r.tipo === 'comunidad') inf.noSeDeshace.push(`${r.idCrm}: eliminó su comunidad (con Avisos)`)
    if (r.tipo === 'drive') inf.noSeDeshace.push(`${r.idCrm}: le quitó el acceso a su carpeta de Drive a ${Array.isArray(r.datos.quitados) ? r.datos.quitados.length : 0} correo(s)`)
  }

  if (modo === 'simular') { inf.neon = await d.contar(ids); return inf }

  // 2. WhatsApp (WhatsApp seguro: /health antes de cualquier DELETE)
  if (wa.length) {
    if (!d.borrarWhatsapp || !d.whatsappSano) inf.whatsapp.errores.push('sin WHAPI_TOKEN: no se borró ningún mensaje')
    else if (!(await d.whatsappSano().catch(() => false))) inf.whatsapp.errores.push('el número del bot no está sano (/health): no se borró ningún mensaje; reintentar después')
    else {
      for (const id of wa) {
        try { await d.borrarWhatsapp(id); inf.whatsapp.borrados++ } catch (e) {
          if (yaNoEsta(e)) inf.whatsapp.borrados++
          else inf.whatsapp.errores.push(`mensaje …${id.slice(-6)}: ${motivo(e)}`)
        }
      }
    }
  }
  // 3. Discord
  for (const id of dc) {
    if (!d.borrarDiscord) { inf.discord.errores.push('sin DISCORD_WEBHOOK_CLIENTES: no se borró ningún aviso'); break }
    try { await d.borrarDiscord(id); inf.discord.borrados++ } catch (e) {
      if (yaNoEsta(e)) inf.discord.borrados++
      else inf.discord.errores.push(`aviso ${id}: ${motivo(e)}`)
    }
  }
  // 4. CRM: volver atrás (solo la misma fila de prueba, y solo si sigue como la dejó la prueba)
  for (const r of crm) {
    const a = r.datos.anterior as { estado: string; fechaBaja: unknown; notas: string; celdas: { estado: string; fechaBaja: string; notas: string } }
    const fila = filas.find((f) => f.id === r.idCrm && f.fila === Number(r.datos.fila))
    if (!fila) { inf.crm.detalle.push(`${r.idCrm}: la fila ya no está en el CRM (nada que volver atrás)`); continue }
    if (!['FINALIZADO', 'INACTIVO'].includes(fila.estado.toUpperCase())) { inf.crm.detalle.push(`${r.idCrm}: la fila ${fila.fila} ya no está en FINALIZADO/INACTIVO: no la toco`); continue }
    if (!d.escribirCrm) { inf.crm.errores.push(`${r.idCrm}: sin credenciales para escribir el CRM`); continue }
    try {
      await d.escribirCrm([
        { range: a.celdas.estado, values: [[a.estado]] },
        { range: a.celdas.fechaBaja, values: [[a.fechaBaja ?? '']] },
        { range: a.celdas.notas, values: [[a.notas ? `'${a.notas}` : '']] },
      ])
      inf.crm.revertidas++
      inf.crm.detalle.push(`${r.idCrm}: fila ${fila.fila} vuelta a ${a.estado}`)
    } catch (e) { inf.crm.errores.push(`${r.idCrm}: ${motivo(e)}`) }
  }
  // 5. Neon (los rastros se conservan si algo externo falló, para reintentar)
  const fallo = inf.whatsapp.errores.some((e) => !e.includes('no confirmó')) || inf.discord.errores.length > 0 || inf.crm.errores.length > 0
  inf.neon = await d.borrar(ids, !fallo)
  if (fallo) inf.neon.rastros_conservados = 1
  return inf
}

export function textoInforme(i: InformeLimpieza): string {
  const l: string[] = [`Limpieza de la etapa Bajas (${i.modo === 'real' ? 'REAL' : 'simulación: no se tocó nada'}) para ${i.ids.join(', ') || '—'}`]
  if (i.abortado) { l.push(`ABORTADO: ${i.abortado}`); return l.join('\n') }
  l.push(`WhatsApp: ${i.whatsapp.mensajes} mensaje(s) del bot${i.modo === 'real' ? `, borrados ${i.whatsapp.borrados}` : ''}`)
  l.push(`Discord: ${i.discord.mensajes} aviso(s)${i.modo === 'real' ? `, borrados ${i.discord.borrados}` : ''}`)
  l.push(`CRM: ${i.crm.filas} cambio(s) de la prueba${i.modo === 'real' ? `, vueltos atrás ${i.crm.revertidas}` : ''}`)
  for (const x of i.crm.detalle) l.push(`  · ${x}`)
  l.push(`Neon: ${Object.entries(i.neon).map(([k, v]) => `${k} ${v}`).join(', ') || 'nada'}`)
  for (const e of [...i.whatsapp.errores, ...i.discord.errores, ...i.crm.errores]) l.push(`  ! ${e}`)
  if (i.noSeDeshace.length) { l.push('No se deshace (final de la baja; esos recursos los borra la limpieza del alta):'); for (const x of i.noSeDeshace) l.push(`  · ${x}`) }
  return l.join('\n')
}
