// ── Datos FICTICIOS de Edición para revisar el diseño (?demo=1, solo en desarrollo) y para los tests ─────────────────
// Nada sale de la base, de Drive ni de ClickUp: los clientes llevan "(ejemplo)", los ids son E101 a E105, los archivos se
// llaman como los del celular y los ids de Drive empiezan con "DEMO". Sin mails ni teléfonos. Las fechas se calculan desde
// `ahora`, así la antigüedad y los "trabados" se ven parecidos cualquier día. En producción pedidoDemo() siempre da false
// y las páginas ni importan este archivo.
import type { DatosCliente, DetalleVideo, FilaTablero } from './db/videos'
import type {
  ArchivoGrabacion, Aviso, CarpetaGrabacion, Corrida, DocGuiones, EstadoVideo, EventoVideo, FichaMarca, GuionDoc, IdCrm, NotaVideo,
  PasoSeguimiento, PedidoCliente, TandaSubida, Video,
} from './tipos'

const H = 3_600_000
export const CLIENTES_DEMO: Record<IdCrm, string> = {
  E101: 'Estudio Ejemplo Uno (ejemplo)',
  E102: 'Clienta Ejemplo Dos (ejemplo)',
  E103: 'Estudio Ejemplo Tres (ejemplo)',
  E104: 'Cliente Ejemplo Cuatro (ejemplo)',
  E105: 'Estudio Ejemplo Cinco (ejemplo)',
}

const GANCHOS = [
  '¿Te despidieron sin causa? Esto es lo que te corresponde',
  'La ART te rechazó el accidente: no firmes nada todavía',
  'Tres errores que te hacen perder la indemnización',
  'Si trabajás en negro, igual tenés derechos',
  '¿Cuánto tarda un juicio laboral de verdad?',
  'Lo que nadie te dice de la jubilación anticipada',
]

export interface DatosDemo {
  filas: FilaTablero[]
  detalle(id: number): DetalleVideo | null
  cliente(id: IdCrm): DatosCliente
  pasos: PasoSeguimiento[]
  carpetas: CarpetaGrabacion[]
  avisos: Aviso[]
  corrida: Corrida
  marcas: Map<IdCrm, FichaMarca>
  docs: Map<IdCrm, string | null>
}

export function datosDemo(ahora: Date = new Date()): DatosDemo {
  const hace = (horas: number) => new Date(ahora.getTime() - horas * H).toISOString()
  const ymd = (dias: number) => new Date(ahora.getTime() - 3 * H - dias * 24 * H).toISOString().slice(0, 10)

  const videos: Video[] = []
  const v = (o: Partial<Video> & { id: number; id_crm: IdCrm; clave: string; estado: EstadoVideo; horas: number }): Video => {
    const m = /^T(\d+)-V(\d+)$/.exec(o.clave)
    const tanda = m ? Number(m[1]) : null, numero = m ? Number(m[2]) : null
    const x: Video = {
      id: o.id, id_crm: o.id_crm, cliente: CLIENTES_DEMO[o.id_crm], clave: o.clave, tanda_guion: tanda, numero,
      guion: m ? { doc_id: `DEMOdoc${o.id_crm}00000000`, ref: `T${tanda}-V${numero}`, huella: `h${o.id}` } : null,
      guion_texto: o.guion_texto ?? `HOOK: ${GANCHOS[o.id % GANCHOS.length]}.\nPROBLEMA: Mucha gente no sabe que tiene plazos para reclamar.\nSOLUCIÓN: Te explicamos paso a paso qué hacer y qué no firmar.\nCTA: Escribinos y lo vemos juntos.`,
      gancho: o.gancho ?? GANCHOS[o.id % GANCHOS.length], estado: o.estado, estado_previo: o.estado_previo ?? null, estado_desde: hace(o.horas),
      prioridad: o.prioridad ?? 'normal', bloqueo: o.bloqueo ?? null, motivo_bloqueo: o.motivo_bloqueo ?? '', motivo_regrabar: o.motivo_regrabar ?? null,
      ronda_interna: o.ronda_interna ?? 0, ronda_cliente: o.ronda_cliente ?? 0, editado: o.editado ?? null, envio_link: o.envio_link ?? null, ok_cliente: o.ok_cliente ?? null,
      origen: o.origen ?? (m ? 'doc' : 'clickup'), clickup_id: o.clickup_id ?? null, version: o.version ?? 3, creado: hace(o.horas + 72), actualizado: hace(o.horas),
      ...(o.posible_duplicado ? { posible_duplicado: o.posible_duplicado } : {}),
    }
    videos.push(x)
    return x
  }
  const urlEd = (n: number) => `https://drive.google.com/file/d/DEMOeditado${String(n).padStart(8, '0')}/view`

  // E101: tanda 2 en edición (René tiene trabajo)
  v({ id: 1, id_crm: 'E101', clave: 'T2-V1', estado: 'para_editar', horas: 30, prioridad: 'urgente' })
  v({ id: 2, id_crm: 'E101', clave: 'T2-V2', estado: 'para_editar', horas: 20 })
  v({ id: 3, id_crm: 'E101', clave: 'T2-V3', estado: 'correccion', horas: 3, ronda_interna: 1, editado: { archivo_id: 203, url: urlEd(3) } })
  v({ id: 4, id_crm: 'E101', clave: 'T2-V4', estado: 'crudo_a_revisar', horas: 5 })
  v({ id: 5, id_crm: 'E101', clave: 'T2-V5', estado: 'esperando_crudos', horas: 50 })
  // E102: con el cliente y una 3.ª ronda esperando a Tomás
  v({ id: 6, id_crm: 'E102', clave: 'T1-V1', estado: 'editado', horas: 2, editado: null })
  v({ id: 7, id_crm: 'E102', clave: 'T1-V2', estado: 'con_cliente', horas: 26, ronda_cliente: 2, bloqueo: 'tope_rondas_cliente', motivo_bloqueo: 'tercera ronda del cliente', editado: { archivo_id: 207, url: urlEd(7) }, envio_link: { quien: 'Aylu', cuando: hace(40), texto: '(texto copiado)' } })
  v({ id: 8, id_crm: 'E102', clave: 'T1-V3', estado: 'corregido', horas: 28, ronda_interna: 1, editado: { archivo_id: 208, url: urlEd(8) } })
  v({ id: 9, id_crm: 'E102', clave: 'T1-V4', estado: 'con_cliente', horas: 4, editado: { archivo_id: 209, url: urlEd(9) } })
  // E103: regrabar y revisar; sin paleta
  v({ id: 10, id_crm: 'E103', clave: 'T1-V1', estado: 'regrabar', horas: 30, motivo_regrabar: 'duro' })
  v({ id: 11, id_crm: 'E103', clave: 'T1-V2', estado: 'crudo_a_revisar', horas: 1 })
  v({ id: 12, id_crm: 'E103', clave: 'T1-V3', estado: 'esperando_crudos', horas: 90 })
  // E104: importados de ClickUp
  v({ id: 13, id_crm: 'E104', clave: 'CU-86a0demo1', estado: 'con_cliente', horas: 100, editado: { archivo_id: null, url: urlEd(13) }, clickup_id: '86a0demo1', origen: 'clickup', envio_link: { quien: 'importado de ClickUp', cuando: hace(100), texto: 'importado de ClickUp' } })
  v({ id: 14, id_crm: 'E104', clave: 'CU-86a0demo2', estado: 'pausado', estado_previo: 'esperando_crudos', horas: 200, clickup_id: '86a0demo2', origen: 'clickup' })
  v({ id: 15, id_crm: 'E104', clave: 'T3-V1', estado: 'esperando_crudos', horas: 6, posible_duplicado: ['CU-86a0demo2'] })
  // E105: solo seguimiento (no grabó)
  v({ id: 16, id_crm: 'E105', clave: 'T1-V1', estado: 'esperando_crudos', horas: 260 })
  v({ id: 17, id_crm: 'E105', clave: 'T1-V2', estado: 'esperando_crudos', horas: 260 })

  // Archivos
  const archivos: ArchivoGrabacion[] = []
  const a = (o: Partial<ArchivoGrabacion> & { id: number; id_crm: IdCrm; nombre: string; tipo: ArchivoGrabacion['tipo']; horas: number }): ArchivoGrabacion => {
    const x: ArchivoGrabacion = {
      id: o.id, id_crm: o.id_crm, tipo: o.tipo, drive_id: `DEMO${o.tipo}${String(o.id).padStart(10, '0')}`, nombre: o.nombre,
      mime: o.mime ?? 'video/quicktime', carpeta_id: `DEMOcarpeta${o.id_crm}000`, ruta: o.ruta ?? ['Tanda 2', 'Video 1'],
      bytes: o.bytes ?? 412_000_000, duracion_ms: o.duracion_ms ?? 38_000, ancho: 1080, alto: 1920, creado: hace(o.horas), modificado: hace(o.horas),
      subio: o.subio ?? 'cliente', tanda_id: o.tanda_id ?? 31, inferido: o.inferido ?? { tanda_guion: 2, numero: 1, por: 'carpeta' },
      video_id: o.video_id ?? null, asignado_por: o.asignado_por ?? (o.video_id ? 'bot' : null), propuesta_video_id: o.propuesta_video_id ?? null,
      transcripcion: o.transcripcion ?? { estado: 'lista', proveedor_id: null, intentos: 1, motivo: '' }, borrado: o.borrado ?? null, visto: hace(0.2),
    }
    archivos.push(x)
    return x
  }
  for (const [i, vid] of [1, 1, 2, 3, 4, 4].entries()) {
    const n = vid === 4 ? 4 : vid
    a({ id: 101 + i, id_crm: 'E101', nombre: `IMG_02${49 + i}.MOV`, tipo: 'crudo', horas: 40 + i, video_id: vid, ruta: ['Tanda 2', `Video ${n}`], inferido: { tanda_guion: 2, numero: n, por: 'carpeta' } })
  }
  a({ id: 107, id_crm: 'E101', nombre: 'IMG_0260.MOV', tipo: 'crudo', horas: 6, ruta: ['Tanda 2'], inferido: { tanda_guion: 2, numero: null, por: 'carpeta' }, transcripcion: { estado: 'pendiente', proveedor_id: null, intentos: 0, motivo: 'falta ASSEMBLYAI_API_KEY' } })
  a({ id: 108, id_crm: 'E101', nombre: 'C0045.MP4', tipo: 'crudo', horas: 6, subio: 'equipo', bytes: 5_600_000_000, ruta: ['Tanda 2', 'Video 4'], video_id: 4, inferido: { tanda_guion: 2, numero: 4, por: 'carpeta' }, transcripcion: { estado: 'grande', proveedor_id: null, intentos: 0, motivo: '' } })
  a({ id: 203, id_crm: 'E101', nombre: 'Video 3 - editado.mp4', tipo: 'editado', mime: 'video/mp4', horas: 8, subio: 'equipo', video_id: 3, asignado_por: 'aylu', ruta: [] })
  a({ id: 206, id_crm: 'E102', nombre: 'T1 V1 final.mp4', tipo: 'editado', mime: 'video/mp4', horas: 1, subio: 'equipo', propuesta_video_id: 6, ruta: [], transcripcion: { estado: 'no_aplica', proveedor_id: null, intentos: 0, motivo: '' } })
  for (const [i, vid] of [6, 7, 8, 9].entries()) a({ id: 120 + i, id_crm: 'E102', nombre: `IMG_31${10 + i}.MOV`, tipo: 'crudo', horas: 70 + i, video_id: vid, ruta: ['Tanda 1', `Video ${i + 1}`], inferido: { tanda_guion: 1, numero: i + 1, por: 'carpeta' } })
  a({ id: 130, id_crm: 'E103', nombre: 'IMG_7781.MOV', tipo: 'crudo', horas: 34, video_id: 10, ruta: ['Video 1'], inferido: { tanda_guion: null, numero: 1, por: 'carpeta' } })
  a({ id: 131, id_crm: 'E103', nombre: 'IMG_7790.MOV', tipo: 'crudo', horas: 1.5, video_id: 11, ruta: ['Video 2'], inferido: { tanda_guion: null, numero: 2, por: 'carpeta' }, transcripcion: { estado: 'enviada', proveedor_id: null, intentos: 1, motivo: '' } })

  // Notas, pedidos y eventos
  const notas: NotaVideo[] = [
    { id: 1, video_id: 3, ronda: 1, origen: 'aylu', enviada: true, segundo: 17, hasta: null, tipo: 'texto', texto: 'Dice "mora" y es "demora": corregir el subtítulo.', imagen_url: null, tilde: { quien: 'René', cuando: hace(1) }, evaluacion: null, pedido_id: null, creado_por: 'Aylu', creado: hace(3), version: 2 },
    { id: 2, video_id: 3, ronda: 1, origen: 'aylu', enviada: true, segundo: 26, hasta: 32, tipo: 'corte', texto: 'Cortar de 0:26 a 0:32 (repite la frase).', imagen_url: null, tilde: null, evaluacion: null, pedido_id: null, creado_por: 'Aylu', creado: hace(3), version: 1 },
    { id: 3, video_id: 3, ronda: 1, origen: 'aylu', enviada: true, segundo: null, hasta: null, tipo: 'velocidad', texto: 'Subir la velocidad a 1,2 en todo el video.', imagen_url: null, tilde: null, evaluacion: null, pedido_id: null, creado_por: 'Aylu', creado: hace(3), version: 1 },
    { id: 4, video_id: 6, ronda: 1, origen: 'aylu', enviada: false, segundo: 4, hasta: null, tipo: 'titulo', texto: 'El título tapa la cara: subirlo un poco.', imagen_url: null, tilde: null, evaluacion: null, pedido_id: null, creado_por: 'Aylu', creado: hace(0.5), version: 1 },
    { id: 5, video_id: 7, ronda: 3, origen: 'cliente', enviada: false, segundo: 12, hasta: null, tipo: 'guion', texto: 'Cambiar "ART" por "aseguradora" en el subtítulo.', imagen_url: null, tilde: null, evaluacion: { afecta_rendimiento: false, motivo: 'es un cambio de palabra' }, pedido_id: 1, creado_por: 'Aylu', creado: hace(2), version: 1 },
  ]
  const pedidos: PedidoCliente[] = [
    { id: 1, video_id: 7, ronda: 3, texto: 'Hola! En el segundo 12 en vez de ART pongan aseguradora porfa. Lo demás perfecto', estado: 'espera_tomas', elegidas: [0], modelo: 'claude', version_prompt: 'p1-demo', creado_por: 'Aylu', creado: hace(2), decidido: null, version: 2,
      propuesta: [{ texto: 'Cambiar "ART" por "aseguradora" en el subtítulo.', tipo: 'guion', segundo: 12, hasta: -1, afecta_rendimiento: false, motivo: 'es un cambio de palabra', cita: 'en vez de ART pongan aseguradora' }] },
    { id: 2, video_id: 9, ronda: 1, texto: 'Me encantó! Solo que en el 0:20 el logo sale chiquito, y al final pongan mi WhatsApp más grande', estado: 'propuesto', elegidas: [], modelo: 'claude', version_prompt: 'p1-demo', creado_por: 'Aylu', creado: hace(0.3), decidido: null, version: 1,
      propuesta: [
        { texto: 'Agrandar el logo en 0:20.', tipo: 'otro', segundo: 20, hasta: -1, afecta_rendimiento: false, motivo: 'estético', cita: 'en el 0:20 el logo sale chiquito' },
        { texto: 'Agrandar el WhatsApp en el cierre.', tipo: 'titulo', segundo: -1, hasta: -1, afecta_rendimiento: true, motivo: 'el CTA se tiene que leer bien', cita: 'al final pongan mi WhatsApp más grande' },
      ] },
  ]
  const eventos: EventoVideo[] = []
  let idEv = 1
  const ev = (video: Video, tipo: EventoVideo['tipo'], horas: number, de: EstadoVideo | null, aa: EstadoVideo | null, quien: 'aylu' | 'rene' | 'tomas' | 'bot', nota = '') => {
    eventos.push({ id: idEv++, video_id: video.id, id_crm: video.id_crm, cliente: video.cliente, tipo, de, a: aa,
      actor: quien === 'bot' ? { tipo: 'bot', proceso: 'vigia' } : { tipo: 'persona', rol: quien, nombre: quien === 'aylu' ? 'Aylu' : quien === 'rene' ? 'René' : 'Tomás', email: '' },
      nota, datos: {}, cuando: hace(horas) })
  }
  for (const x of videos) {
    ev(x, 'creado', (ahora.getTime() - Date.parse(x.creado)) / H, null, null, 'bot')
    if (x.estado !== 'esperando_crudos') ev(x, 'estado', (ahora.getTime() - Date.parse(x.estado_desde)) / H + 0.1, 'esperando_crudos', 'crudo_a_revisar', 'bot')
  }
  const v3 = videos.find(x => x.id === 3)!
  ev(v3, 'estado', 26, 'crudo_a_revisar', 'para_editar', 'aylu')
  ev(v3, 'estado', 8, 'para_editar', 'editado', 'rene')
  ev(v3, 'estado', 3, 'editado', 'correccion', 'aylu', 'Tres detalles de texto y ritmo.')
  ev(v3, 'tilde', 1, null, null, 'rene')

  // Doc de guiones y tandas de subida
  const guion = (tanda: number, numero: number, estado: GuionDoc['estado_doc']): GuionDoc => ({
    ref: `T${tanda}-V${numero}`, tanda, numero, estado_doc: estado, titulo: GANCHOS[numero % GANCHOS.length],
    secciones: { hook: GANCHOS[numero % GANCHOS.length], problema: 'Mucha gente no sabe que tiene plazos para reclamar.', solucion: 'Te explicamos paso a paso qué hacer.', cta: 'Escribinos y lo vemos juntos.' },
    frases: ['Mucha gente no sabe que tiene plazos para reclamar', 'Te explicamos paso a paso qué hacer', 'Escribinos y lo vemos juntos'], huella: `h${tanda}${numero}`,
  })
  const docs: Record<IdCrm, DocGuiones> = {
    E101: { id_crm: 'E101', doc_id: 'DEMOdocE10100000000', modificado: hace(80), leido: hace(10), avisos: [], guiones: [1, 2, 3, 4, 5].map(n => guion(2, n, n === 5 ? 'para_grabar' : 'grabado_completo')) },
    E103: { id_crm: 'E103', doc_id: 'DEMOdocE10300000000', modificado: hace(120), leido: hace(10), avisos: ['El guion T1-V3 cambió después de grabarse: revisarlo.'], guiones: [1, 2, 3].map(n => guion(1, n, 'para_grabar')) },
  }
  const tandas: TandaSubida[] = [
    { id: 31, id_crm: 'E101', tipo: 'crudos', desde: hace(46), hasta: hace(40), archivos: 6, subio: 'cliente', estado: 'avisada', cerrada: hace(39), version: 3,
      resultado: { version: 'cmp1-demo', generado: hace(39), sin_ubicar: [107], sin_transcribir: [108], tokens: null, guiones: [
        { guion_ref: 'T2-V1', video_id: 1, frases: 9, presentes: 9, faltan: [], dudosas: [], mejor_toma: { archivo_id: 101, segundo: 4 }, por: 'cruce', estado: 'completo' },
        { guion_ref: 'T2-V2', video_id: 2, frases: 8, presentes: 8, faltan: [], dudosas: [], mejor_toma: { archivo_id: 103, segundo: 2 }, por: 'cruce', estado: 'completo' },
        { guion_ref: 'T2-V3', video_id: 3, frases: 9, presentes: 9, faltan: [], dudosas: [], mejor_toma: { archivo_id: 104, segundo: 11 }, por: 'cruce', estado: 'completo' },
        { guion_ref: 'T2-V4', video_id: 4, frases: 9, presentes: 8, faltan: ['Escribinos y lo vemos juntos'], dudosas: ['Te explicamos paso a paso qué hacer'], mejor_toma: { archivo_id: 105, segundo: 65 }, por: 'claude', estado: 'incompleto' },
      ] } },
  ]

  // Marca
  const marcas = new Map<IdCrm, FichaMarca>([
    ['E101', { id_crm: 'E101', colores: [{ hex: '#1E4740', nombre: 'Verde petróleo' }, { hex: '#6B2737', nombre: 'Bordó' }, { hex: '#F2EADC', nombre: 'Marfil' }], tipografias: ['Montserrat'], logo: null, referencia: null, carpeta_marca: null, fuentes: { colores: { origen: 'clickup', quien: 'importación', cuando: hace(200) } }, notas: '', version: 1, actualizado: hace(200) }],
    ['E102', { id_crm: 'E102', colores: [{ hex: '#20304A', nombre: 'Azul' }, { hex: '#C9A86A', nombre: 'Arena' }], tipografias: [], logo: null, referencia: { url: 'https://app.clickup.com/t/86a0demo', descripcion: 'captura en ClickUp (comentario del 12/10)' }, carpeta_marca: null, fuentes: {}, notas: '', version: 2, actualizado: hace(100) }],
  ])

  // Seguimiento e01
  const paso = (o: Partial<PasoSeguimiento> & { id: number; id_crm: IdCrm; escalon: PasoSeguimiento['escalon']; debido: string; responsable: PasoSeguimiento['responsable']; videos: number[] }): PasoSeguimiento => ({
    cliente: CLIENTES_DEMO[o.id_crm], ciclo: ymd(12), motivo: 'para_grabar', dias_habiles: 0, texto: '', hecho: null, decision: null, estado: 'abierto', version: 1, frenado: null, ...o,
  })
  const pasos: PasoSeguimiento[] = [
    paso({ id: 1, id_crm: 'E103', escalon: 'dia2', debido: ymd(0), responsable: 'gero_m', videos: [12], dias_habiles: 2, ciclo: ymd(3) }),
    paso({ id: 2, id_crm: 'E105', escalon: 'dia9', debido: ymd(1), responsable: 'tomas', videos: [16, 17], dias_habiles: 9 }),
    paso({ id: 3, id_crm: 'E101', escalon: 'dia0', debido: ymd(0), responsable: 'aylu', videos: [5], ciclo: ymd(0), motivo: 'guiones_enviados' }),
    paso({ id: 4, id_crm: 'E104', escalon: 'dia0', debido: ymd(0), responsable: 'aylu', videos: [15], ciclo: ymd(0), frenado: 'crudos_sin_ubicar' }),
  ]

  // Vínculos, avisos y corrida
  const carpeta = (o: Partial<CarpetaGrabacion> & { drive_id: string; nombre: string }): CarpetaGrabacion => ({
    padre_id: null, nivel: 1, ruta: ['Clientes', o.nombre], id_crm: null, tipo: 'crudos', raiz: 'crudos', raiz_id: o.drive_id, vinculo: 'a_confirmar', candidatos: [],
    vigilar: false, creada: hace(500), ultimo_archivo: hace(30), consultada: hace(2), borrada: null, ...o,
  })
  const carpetas: CarpetaGrabacion[] = [
    carpeta({ drive_id: 'DEMOcarpetaVinc0001', nombre: 'Crudos - De Ejemplo', candidatos: [{ id_crm: 'E102', nombre: CLIENTES_DEMO.E102, puntaje: 0.82 }, { id_crm: 'E104', nombre: CLIENTES_DEMO.E104, puntaje: 0.41 }] }),
    carpeta({ drive_id: 'DEMOcarpetaVinc0002', nombre: 'Editados - Flor y Gian (ejemplo)', tipo: 'editados', raiz: 'editados', candidatos: [{ id_crm: 'E105', nombre: CLIENTES_DEMO.E105, puntaje: 0.66 }] }),
    carpeta({ drive_id: 'DEMOcarpetaE101crud', nombre: 'Crudos - Ejemplo Uno', id_crm: 'E101', vinculo: 'alta', vigilar: true }),
  ]
  const aviso = (id: number, tipo: string, estado: Aviso['estado'], texto: string, horas: number, error = ''): Aviso => ({
    id, clave: `${tipo}:${id}`, base: `${tipo}:${id}`, tipo, canal: tipo === 'aprobado' ? 'ads' : 'edicion', datos: {}, texto, menciones: [], estado, enviar_despues: hace(horas),
    mensaje_id: null, intentos: estado === 'error' ? 3 : 0, error, creado: hace(horas), enviado: null,
  })
  const avisos: Aviso[] = [
    aviso(1, 'tanda_crudos', 'dry', 'Aylu: Crudos nuevos · Estudio Ejemplo Uno (ejemplo) · Tanda 2: 6 archivos (los subió el cliente) · 3 de 4 guiones completos · video 4: falta el CTA · [Revisar](</clientes/edicion/cliente/E101>)', 39),
    aviso(2, 'para_editar', 'dry', 'René: Para editar · Estudio Ejemplo Uno (ejemplo) · 2 videos (urgente) · paleta cargada · [Edición](</clientes/edicion?cola=rene>)', 20),
    aviso(3, 'tope_rondas', 'dudoso', 'Tomás: 3.ª ronda del cliente · Clienta Ejemplo Dos (ejemplo) · video 2 · [Revisar](</clientes/edicion/video/7>)', 2),
    aviso(4, 'aprobado', 'error', 'Valen: Cliente Ejemplo Cuatro (ejemplo) aprobó 1 video · sin dato de Meta: decidir con Tomás', 50, 'el webhook de #ads respondió 404'),
  ]
  const corrida: Corrida = { id: 77, tipo: 'vigia', origen: 'puente', estado: 'ok', inicio: hace(0.22), fin: hace(0.2), consultas: 33, archivos_nuevos: 2, tandas_cerradas: 0, error: '', resumen: {} }

  const filas: FilaTablero[] = videos.map(x => ({
    ...x,
    crudos: archivos.filter(f => f.tipo === 'crudo' && f.video_id === x.id && !f.borrado).length,
    editado_propuesto: archivos.some(f => f.propuesta_video_id === x.id && !f.video_id),
    paleta: (marcas.get(x.id_crm)?.colores.length ?? 0) > 0,
    notas_abiertas: notas.filter(n => n.video_id === x.id && n.enviada && !n.tilde && n.ronda === x.ronda_interna + x.ronda_cliente).length,
  }))

  return {
    filas, pasos, carpetas, avisos, corrida, marcas,
    docs: new Map(Object.entries(docs).map(([k, d]) => [k, d.doc_id])),
    detalle(id) {
      const video = videos.find(x => x.id === id)
      if (!video) return null
      const deEste = archivos.filter(f => f.video_id === id || f.propuesta_video_id === id)
      return {
        video, eventos: eventos.filter(e => e.video_id === id), notas: notas.filter(n => n.video_id === id),
        crudos: deEste.filter(f => f.tipo === 'crudo' && f.video_id === id), editados: deEste.filter(f => f.tipo === 'editado'),
        pedidos: pedidos.filter(p => p.video_id === id),
      }
    },
    cliente(id) {
      const k = id.toUpperCase()
      return {
        videos: filas.filter(x => x.id_crm === k), tandas: tandas.filter(t => t.id_crm === k), archivos: archivos.filter(f => f.id_crm === k),
        doc: docs[k] ?? null, seguimientos: pasos.filter(p => p.id_crm === k), carpetas: carpetas.filter(c => c.id_crm === k),
      }
    },
  }
}
