// ── El puntaje interno para el EOW (13/11/2026). SOLO servidor, SOLO lectura ─────────────────────────────────────────────
// Gero M lo ve al lado de cada cliente como REFERENCIA: no cambia el color que él elige. Mismas lecturas y mismas cachés que
// la cartera (CRM, Seguimiento, Typeform, Meta, lo anotado a mano y las tres fuentes del puntaje): no suma consultas por cliente.
// «Ya lanzó» sale del hito «Campaña lanzada» de cj_hitos (anotado o guardado solo al ver gasto en Meta) o de Meta.
// Si algo falla, el EOW sale igual sin la columna (null).
import { conCache } from '../anuncios/cache'
import { leerSeguimiento, leerTypeform } from '../seguimiento/hojas'
import { estadoPorCliente } from '../seguimiento/modelo'
import { leerAnotaciones } from './hitosRegistro'
import { claveNombre } from './prioridad'
import { compacto, yaLanzo, type PuntajeCompacto } from './puntaje'
import { leerFuentesPuntaje } from './puntajeFuentes'
import { puntajesDeCartera } from './puntajeSenales'
import { campanasMetaCartera } from './recorridoFuentes'
import { cargarVista } from './vista'

export async function puntajesParaEow(): Promise<Record<string, PuntajeCompacto> | null> {
  try {
    const { datos } = await cargarVista(false, 'omitir')
    const agencia = datos.clientes.filter(c => c.linea === 'agencia' && c.id)
    const [seguimiento, typeform, meta, anotaciones, fuentes] = await Promise.all([
      leerSeguimiento().catch(() => ({ puntajes: [], ausente: false })),
      // Misma clave de caché que la cartera (EnVivo.tsx): no vuelve a leer la planilla del Typeform
      conCache('typeform-cartera-v1', 300, () => leerTypeform(agencia.map(c => ({ id: c.id, nombre: c.nombre, mail: c.mail, celular: c.celular })))).then(r => r.data, () => null),
      campanasMetaCartera(),
      leerAnotaciones().catch(() => null),
      leerFuentesPuntaje(agencia.map(c => ({ id: c.id, nombre: c.nombre, mail: c.mail, celular: c.celular }))),
    ])
    const estados = estadoPorCliente([...seguimiento.puntajes, ...(typeform?.puntajes ?? [])], datos.hoy)
    const campanaDe = (nombre: string) => meta.porCliente.get(claveNombre(nombre)) ?? null
    const puntajes = puntajesDeCartera({
      clientes: datos.clientes, hoy: datos.hoy,
      historialDe: id => estados.get(id)?.historial ?? [],
      metaLeida: meta.porCliente.size > 0 || !meta.aviso,
      campanaDe: c => campanaDe(c.nombre),
      lanzo: c => {
        const m = campanaDe(c.nombre)
        return yaLanzo({ hitoLanzamiento: !!anotaciones?.hitos.get(c.id.toUpperCase())?.some(h => h.hito === 'lanzamiento'), metaActiva: m?.activa, primerLanzamiento: m?.primerGasto ?? null })
      },
      referidos: datos.pestanasAusentes.includes('Referidos') ? null : datos.referidos,
      fuentes,
    })
    return Object.fromEntries([...puntajes].map(([id, p]) => [id, compacto(p)]))
  } catch (e) {
    console.error('[eow] puntajes:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 140))
    return null
  }
}
