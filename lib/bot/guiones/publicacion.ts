import * as reg from './registro'
import { resolverDocumento, depsDocumentoReales, type DocAutomatico } from './documento'
import { escribirEnDoc, marcarParaGrabar, type ResultadoChips, type ResultadoDoc } from './envio'
import { notificarEntrega } from './entrega'
import type { FilaTanda } from './registro'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'
import type { ResultadoAlta } from '../grabacion/altaDesdeGuiones'
import type { Alerta } from '@/lib/alertas'
export interface DepsPublicacion {
  reservar(id: number): Promise<boolean>
  leer(id: number): Promise<FilaTanda | undefined>
  resolver(fila: FilaTanda, hasta: number): Promise<DocAutomatico>
  escribir(fila: FilaTanda, doc: string, hasta: number): Promise<ResultadoDoc>
  guardar(id: number, doc: { id: string; url: string; tanda: number | null; publicada: string }): Promise<void>
  notificar(fila: FilaTanda): Promise<void>
  /** Los chips de la tanda a «Para grabar». Si falla, el Doc ya está publicado: se avisa en el log y se cambia a mano. */
  marcarChips?(docId: string, tanda: number, cantidad: number, hasta: number): Promise<ResultadoChips>
  /** d05: con los chips ya en «Para grabar», los videos de la tanda entran a Edición (Esperando crudos) sin esperar al vigía.
   *  Si falla, la pasada diaria del vigía los crea igual al leer el Doc: se avisa en el log. */
  altaEdicion?(fila: FilaTanda, docId: string, tanda: number): Promise<ResultadoAlta>
  error(id: number, motivo: string, dudoso: boolean): Promise<void>
  exigirActivo?(idCrm: string | null): Promise<void>
  /** d02: el link al grupo Contenido del cliente (solo con GUIONES_WHATSAPP=real y la aprobación posterior al corte). */
  whatsapp?(fila: FilaTanda): Promise<{ estado: string; motivo?: string }>
  /** Falla de la carga en el Doc (2/11/2026): aviso en #🧰-sistema-bot a Gero M y Aylu. Nunca tira. */
  alertar?(a: Alerta): Promise<unknown>
}

/** El Doc quedó escrito pero los chips de la tanda no pasaron a «Para grabar» (los videos no entran solos a Edición). */
export function alertaChipsSinMarcar(t: TandaFallida, motivo: string): Alerta {
  const id = t.id_crm?.trim() || null
  return {
    canal: 'sistema', tipo: 'guiones_chips_falla', clave: `guiones_chips:${t.id}:${t.aprobacion?.cuando ?? 'sin-aprobacion'}`,
    idCrm: id, cliente: t.cliente?.trim() || id || 'Cliente sin nombre', emoji: '🧯', titulo: 'Los chips de la tanda no pasaron a «Para grabar»',
    lineas: [`Tanda ${t.tanda ?? '¿?'}: los guiones ya están en el Doc, pero los chips quedaron sin cambiar.`, `Motivo: ${motivo}`, 'Cambialos a mano a «Para grabar» en el Doc (el vigía toma los videos al leerlo).'],
    link: id ? `/guiones/${encodeURIComponent(id)}` : '/guiones', menciones: ['gero_m', 'aylu'],
  }
}

/** Lo que se sabe de la tanda cuando falla la publicación (puede faltar si ni siquiera se pudo leer). */
export interface TandaFallida { id: number; id_crm?: string | null; cliente?: string | null; tanda?: number | null; aprobacion?: { cuando?: string | null } | null }

/** La alerta de una carga fallida en el Doc (Tomás, 2/11/2026: que no quede silenciosa). Puro. Una por aprobación: el
 *  reintento que vuelve a fallar no repite el aviso; una nueva aprobación (corrección) sí avisa. */
export function alertaFallaPublicacion(t: TandaFallida, motivo: string, dudoso: boolean): Alerta {
  const id = t.id_crm?.trim() || null
  return {
    canal: 'sistema', tipo: 'guiones_publicacion_falla', clave: `guiones_publicacion:${t.id}:${t.aprobacion?.cuando ?? 'sin-aprobacion'}`,
    idCrm: id, cliente: t.cliente?.trim() || id || 'Cliente sin nombre', emoji: dudoso ? '⚠️' : '🧯',
    titulo: dudoso ? 'Carga de guiones en el Doc DUDOSA' : 'Falló la carga de guiones en el Doc',
    lineas: [
      `Tanda ${t.tanda ?? '¿?'} (registro ${t.id}) aprobada, pero no quedó escrita en el Doc del cliente.`,
      `Motivo: ${motivo}`,
      dudoso ? 'Puede haberse escrito a medias: revisá el Doc antes de reintentar (no duplicar la tanda).' : 'No se le mandó nada al cliente ni quedó el «para enviar».',
      'Reintentar: botón «Revisar publicación y aviso» en la tanda (lo tocan Tomi o Faus).',
    ],
    link: id ? `/guiones/${encodeURIComponent(id)}` : '/guiones', menciones: ['gero_m', 'aylu'],
  }
}
const reales: DepsPublicacion = {
  reservar: reg.reservarPublicacion, leer: reg.leerTanda,
  resolver: (fila, hasta) => resolverDocumento(fila, depsDocumentoReales(hasta)),
  escribir: (fila, id, hasta) => escribirEnDoc(fila, id, { hasta }),
  guardar: reg.anotarDoc, notificar: notificarEntrega, error: reg.errorPublicacion,
  marcarChips: (docId, tanda, cantidad, hasta) => marcarParaGrabar(docId, tanda, cantidad, { hasta }),
  altaEdicion: async (fila, docId, tanda) => (await import('../grabacion/altaDesdeGuiones')).altaDesdeTandaReal({
    id_crm: fila.id_crm ?? '', cliente: fila.cliente ?? '', doc_id: docId, tanda,
    guiones: Object.values(fila.guiones).map(g => g.guion).filter(Boolean),
  }),
  exigirActivo: exigirClienteNoArchivado,
  // d02 sin WhatsApp (2/11/2026): el link queda «para enviar» (📤 en Discord + /clientes/para-enviar) y la entrega se confirma
  // en /clientes/entregas o con «Enviado»; el aviso de la campanita (notificar) sigue igual
  whatsapp: async (fila) => (await import('./whatsappCliente')).guionesParaEnviar(fila),
  alertar: async (a) => (await import('@/lib/alertas')).alertar(a),
}
/** Una aprobación publica el Doc y, con GUIONES_WHATSAPP=real (d02), manda el link al grupo Contenido del cliente;
 *  si no sale por WhatsApp, deja el link para que Aylu/Gero lo entreguen (como antes). */
export async function publicarParaEntrega(id: number, hasta: number, deps: DepsPublicacion = reales): Promise<void> {
  let dudoso = false, reservada = false
  let conocida: TandaFallida = { id }
  try {
    if (deps.exigirActivo) { const previa = await deps.leer(id); if (previa) conocida = previa; await deps.exigirActivo(previa?.id_crm ?? null) }
    if (!(await deps.reservar(id))) return
    reservada = true
    const fila = await deps.leer(id)
    if (fila) conocida = fila
    if (!fila || fila.estado !== 'aprobada') return
    if (!fila.aprobacion?.cuando) throw new Error('La tanda no tiene un check final vigente.')
    const doc = await deps.resolver(fila, hasta)
    await deps.exigirActivo?.(fila.id_crm)
    const d = await deps.escribir(fila, doc.id, hasta)
    if (d.estado !== 'ok') { dudoso = d.estado === 'dudoso'; throw new Error(d.motivo) }
    if (d.id !== doc.id) { dudoso = true; throw new Error('El puente respondió con otro documento. Revisar antes de entregar.') }
    await deps.guardar(id, { id: d.id, url: `https://docs.google.com/document/d/${d.id}/edit`, tanda: d.tanda, publicada: fila.aprobacion!.cuando })
    const cantidad = Object.keys(fila.guiones).length
    if (deps.marcarChips && d.tanda && cantidad) {
      const c = await deps.marcarChips(d.id, d.tanda, cantidad, hasta).catch((e): ResultadoChips => ({ estado: 'error', motivo: String((e as Error)?.message ?? e) }))
      if (c.estado !== 'ok') {
        const m = c.motivo.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
        console.warn(`Guiones: publicación ${id}, chips sin pasar a «Para grabar» (cambiarlos a mano) — ${m}`)
        await deps.alertar?.(alertaChipsSinMarcar({ ...fila, tanda: d.tanda }, m)).catch(() => undefined)
      }
      // d05: solo con los chips en «Para grabar» (Edición refleja el Doc; si se cambian a mano, los toma el vigía)
      else if (deps.altaEdicion && fila.id_crm) {
        try {
          const a = await deps.altaEdicion(fila, d.id, d.tanda)
          if (a.frenadas || a.avisos.length) console.warn(`Guiones: publicación ${id}, Edición — ${a.avisos.join(' · ').slice(0, 200)}`)
        } catch (e) { console.warn(`Guiones: publicación ${id}, los videos no entraron a Edición (los crea el vigía al leer el Doc) — ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)}`) }
      }
    }
    const publicada = await deps.leer(id)
    if (publicada?.estado === 'aprobada') {
      await deps.exigirActivo?.(publicada.id_crm)
      const w = deps.whatsapp ? await deps.whatsapp(publicada).catch((e): { estado: string; motivo?: string } => ({ estado: 'error', motivo: String((e as Error)?.message ?? e) })) : null
      if (w?.estado === 'enviado') console.log(`Guiones: publicación ${id}, link enviado al grupo Contenido del cliente (d02)`)
      else {
        if (w && w.estado !== 'apagado' && w.estado !== 'manual') console.warn(`Guiones: publicación ${id}, el link no salió por WhatsApp (${w.estado}: ${(w.motivo ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}); queda para Aylu/Gero`)
        await deps.notificar(publicada)
      }
    }
  } catch (e) {
    const motivo = String((e as Error)?.message ?? 'No se pudo publicar el documento').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 180)
    if (reservada) await deps.error(id, motivo, dudoso)
    console.error(`Guiones: publicación ${id} pendiente — ${motivo}`)
    // Un cliente archivado no es una falla de la carga (el bloqueo es a propósito): ese no avisa
    const archivado = (e as { code?: string })?.code === 'CLIENTE_ARCHIVADO'
    if (deps.alertar && !archivado) {
      const tanda = (conocida as { doc?: { tanda?: number | null } | null }).doc?.tanda ?? conocida.tanda ?? null
      await deps.alertar(alertaFallaPublicacion({ ...conocida, tanda }, motivo, dudoso)).catch(err => console.error('Guiones: no salió la alerta de la falla —', (err as Error)?.name ?? 'error'))
    }
  }
}
