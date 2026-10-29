// ── Textos para el cliente (grupo Contenido) y guías internas del seguimiento (puro: sin red ni base) ──────────────
// Versión `tx1`: BORRADOR que aprueba Tomás. Hasta que llegue el chip de WhatsApp, Aylu copia el texto en el grupo
// Contenido del cliente y toca "enviado" (queda la constancia). Con el chip, el mismo botón pasa a "enviar".
// Reglas (P6 y relevamiento):
//   · ningún texto para el cliente menciona rondas, topes ni negativas: no se le dice "no" en automático (la palabra
//     "no" directamente no aparece; lo controla scripts/test-edicion-textos.mjs);
//   · los motivos de regrabación se pasan a un lenguaje amable (MOTIVO_AMABLE);
//   · el día 2 (audio de Gero M), el día 4 (llamada citando el contrato) y el día 9 (decide Tomás) son GUÍAS INTERNAS, no
//     textos para el cliente. La cláusula del contrato del día 4 la confirma Tomás (CLAUSULA_CONTRATO);
//   · el día 0 y los recordatorios llevan el link al doc de guiones y una fecha propuesta (dos días hábiles después), que
//     Aylu puede editar antes de copiar (la pantalla muestra el texto en un cuadro editable);
//   · ningún mail ni teléfono del CRM: el texto se arma con el nombre de saludo y los datos del video.
// La vista (bloque B) arma el texto del paso con textoE01 al mostrarlo; se guarda recién cuando Aylu marca "hecho".
import { esHabil, nombreDia } from '@/lib/anuncios/feriados'
import { sumarDias } from '@/lib/clientes/fechas'
import type { MotivoRegrabar, PasoSeguimiento, Ymd } from './tipos'

export const VERSION_TEXTOS = 'tx1'

export interface TextoCliente { para: 'grupo_contenido'; texto: string; version: string }
export interface GuiaInterna { para: 'interno'; responsable: 'gero_m' | 'tomas'; pasos: string[]; version: string }

/** La cláusula que se cita en la llamada del día 4. PENDIENTE: la confirma Tomás (no se inventa). */
export const CLAUSULA_CONTRATO = '[cláusula del contrato a confirmar por Tomás]'

/** Cómo se le pide cada regrabación al cliente: amable, en positivo y con una sugerencia concreta. */
export const MOTIVO_AMABLE: Record<MotivoRegrabar, string> = {
  duro: 'que salga más suelto y natural, como si se lo contaras a un amigo (leé la frase, levantá la vista y decila a cámara)',
  audio: 'que el audio se escuche más claro: buscá un lugar silencioso y dejá el celular más cerca',
  encuadre: 'acomodar el encuadre: celular en vertical, a la altura de los ojos y con la cara entera en cuadro',
  falta_frase: 'sumar una parte del guion que quedó afuera',
  otro: 'un ajuste chico',
}

/** "T2-V4" → "Video 4"; un importado de ClickUp (CU-…) → "Video N" si se leyó el número del nombre ("video 3"), si no "Video". */
export function etiquetaVideo(clave: string, numero?: number | null): string {
  const m = /^T\d+-V(\d+)$/.exec(clave.trim())
  if (m) return `Video ${Number(m[1])}`
  return typeof numero === 'number' && Number.isInteger(numero) && numero > 0 ? `Video ${numero}` : 'Video'
}

/** "2026-10-29" → "el jueves 29/10". */
export function fechaParaCliente(ymd: Ymd): string {
  const [, mes, dia] = ymd.split('-')
  return `el ${nombreDia(ymd)} ${Number(dia)}/${Number(mes)}`
}

/** El día hábil número `n` después de `desde` (sin contar `desde`). */
export function sumarHabiles(desde: Ymd, n: number): Ymd {
  let d = desde, cuenta = 0
  for (let i = 0; i < 60 && cuenta < n; i++) {
    d = sumarDias(d, 1)
    if (esHabil(d)) cuenta++
  }
  return d
}

/** La fecha que se le propone al cliente para grabar: dos días hábiles después de hoy (Aylu la puede cambiar). */
export const fechaSugeridaE01 = (hoy: Ymd): Ymd => sumarHabiles(hoy, 2)

/** Nombre de saludo: el primer nombre de una persona; una dupla o un estudio va entero ("Flor y Gianfranco", "Estudio Romero"). */
export function nombreDeSaludo(cliente: string): string {
  const t = cliente.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (/(\sy\s|&|\+|\/)/i.test(t) || /^(estudio|bufete|dr\.?|dra\.?)\b/i.test(t)) return t
  return t.split(' ')[0]
}

const una = (t: string) => t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
const hola = (nombre: string) => (nombre.trim() ? `¡Hola, ${nombre.trim()}!` : '¡Hola!')
const losVideos = (n: number) => (n === 1 ? 'el video' : `los ${n} videos`)
const delVideo = (n: number) => (n === 1 ? 'del video' : `de los ${n} videos`)
/** Concordancia con la cantidad: lo(s), listo(s), está(n)… (con un solo video los textos van en singular). */
const sp = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)
const linkDoc = (link: string | null) => (link ? `Te dejo los guiones acá: ${link}` : 'Los guiones están en el doc «Guiones» de tu carpeta de Drive.')

/** e01: el texto del paso (día 0 y recordatorios: para el cliente) o la guía interna (días 2, 4 y 9). */
export function textoE01(p: { paso: PasoSeguimiento; nombre: string; linkGuiones: string | null; fechaSugerida: Ymd; videos: number }): TextoCliente | GuiaInterna {
  const { paso, nombre, linkGuiones, videos } = p
  const fecha = fechaParaCliente(p.fechaSugerida)
  const n = Math.max(1, videos)
  switch (paso.escalon) {
    case 'dia0':
      if (paso.motivo === 'regrabar') {
        return {
          para: 'grupo_contenido', version: VERSION_TEXTOS, texto: una(`${hola(nombre)} ¿Cómo venís con ${n === 1 ? 'el video' : 'los videos'} para volver a grabar? 🎬
          ¿Te queda bien ${sp(n, 'tenerlo', 'tenerlos')} para ${fecha}? Cuando ${sp(n, 'lo subas', 'los subas')} a la carpeta de Crudos, avisanos por acá y seguimos con la edición.`),
        }
      }
      return {
        para: 'grupo_contenido', version: VERSION_TEXTOS, texto: una(`${hola(nombre)} Ya ${sp(n, 'está listo', 'están listos')} ${losVideos(n)} para grabar 🎬
        ${linkDoc(linkGuiones)}
        ¿Te queda bien ${sp(n, 'grabarlo', 'grabarlos')} para ${fecha}? Cuando ${sp(n, 'lo subas', 'los subas')} a la carpeta de Crudos, avisanos por acá y arrancamos con la edición.`),
      }
    case 'dia2':
      return {
        para: 'interno', responsable: 'gero_m', version: VERSION_TEXTOS, pasos: [
          `Mandale a ${nombre || 'el cliente'} un audio corto (de 30 a 60 segundos) por el grupo Contenido.`,
          `Contale que ${n === 1 ? 'el guion ya está listo' : `los ${n} guiones ya están listos`} y que la idea es grabar esta semana.`,
          'Preguntale si tiene alguna traba (tiempo, lugar, dudas con los guiones) y ofrecele ayuda concreta.',
          `Proponé una fecha: ${fecha}.`,
          'Al terminar, marcá «hecho» en Grabaciones pendientes, con una nota de lo que respondió.',
        ],
      }
    case 'dia4':
      return {
        para: 'interno', responsable: 'gero_m', version: VERSION_TEXTOS, pasos: [
          `Llamalo/a por teléfono (si no atiende, por WhatsApp) a ${nombre || 'el cliente'}.`,
          `Recordale con buena onda lo que acordamos en el contrato: ${CLAUSULA_CONTRATO}.`,
          'Explicale que sin los videos grabados no podemos arrancar con los anuncios, y preguntale qué necesita para grabar.',
          `Acordá una fecha concreta (por ejemplo, ${fecha}) y anotala en la nota del paso.`,
          'Al terminar, marcá «hecho» en Grabaciones pendientes.',
        ],
      }
    case 'dia9':
      return {
        para: 'interno', responsable: 'tomas', version: VERSION_TEXTOS, pasos: [
          'Revisá el historial del cliente en Grabaciones pendientes (mensaje del día 0, audio, llamada y sus notas).',
          'Decidí: pausar el servicio o seguir con un recordatorio cada 4 días hábiles.',
          'Marcá la decisión en Grabaciones pendientes («Pausar» o «Seguir con recordatorios»).',
        ],
      }
    default:   // recordatorios r1, r2…
      return {
        para: 'grupo_contenido', version: VERSION_TEXTOS, texto: una(`${hola(nombre)} ¿Cómo venís con la grabación ${delVideo(n)}? 🎬
        ${linkDoc(linkGuiones)}
        Si te sirve, lo agendamos para ${fecha}. Cualquier duda con algún guion, escribinos y lo vemos juntos.`),
      }
  }
}

/** e04: el pedido de regrabación para el cliente (los motivos, en lenguaje amable). */
export function textoRegrabar(p: { nombre: string; tanda: number | null; videos: { clave: string; motivo: MotivoRegrabar; detalle: string; numero?: number | null }[] }): TextoCliente {
  const renglones = p.videos.map(v => {
    const detalle = v.detalle.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
    const motivo = v.motivo === 'otro' && detalle ? detalle : `${MOTIVO_AMABLE[v.motivo] ?? MOTIVO_AMABLE.otro}${detalle ? ` (${detalle})` : ''}`
    return `• ${etiquetaVideo(v.clave, v.numero)}: ${motivo}.`
  })
  const tanda = p.tanda ? ` de la tanda ${p.tanda}` : ''
  const n = p.videos.length
  return {
    para: 'grupo_contenido', version: VERSION_TEXTOS, texto: una(`${hola(p.nombre)} ¡Gracias por los videos${tanda}! 🙌
    Para que queden de diez, te pedimos volver a grabar ${sp(n, 'este', 'estos')}:
    ${renglones.join('\n')}
    Cuando ${sp(n, 'lo tengas, subilo', 'los tengas, subilos')} a la misma carpeta de Crudos y avisanos por acá.`),
  }
}

/** f04: el link final para el cliente (un renglón por video, con su título y el link del editado en Drive). */
export function textoLinkFinal(p: { nombre: string; tanda: number | null; videos: { clave: string; titulo: string; url: string; numero?: number | null }[] }): TextoCliente {
  const renglones = p.videos.map(v => {
    const titulo = v.titulo.replace(/\s+/g, ' ').trim()
    return `• ${etiquetaVideo(v.clave, v.numero)}${titulo ? ` — ${titulo}` : ''}: ${v.url}`
  })
  const tanda = p.tanda ? ` de la tanda ${p.tanda}` : ''
  const n = p.videos.length
  return {
    para: 'grupo_contenido', version: VERSION_TEXTOS, texto: una(`${hola(p.nombre)} ¡Ya ${sp(n, 'está listo el video', 'están listos los videos')}${tanda}! 🎬
    ${renglones.join('\n')}
    ${sp(n, 'Miralo', 'Miralos')} con tiempo y contanos qué te parece${sp(n, '', 'n')}. Si querés ajustar algo, escribinos acá con el detalle (si podés, con el segundo del video) y lo vemos.`),
  }
}
