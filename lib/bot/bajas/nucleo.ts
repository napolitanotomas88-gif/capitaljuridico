// ── Bot "Capital Jurídico": etapa BAJA DEL CLIENTE — la lógica (dependencias inyectables: los tests no tocan red ni base) ──
// Puertas:
//   · correrDiario(): el cron diario (/api/bot/bajas, 10:30 AR): vence pedidos viejos; i01 pide el OK del aviso de fin a los
//     clientes ACTIVOS cuyo fin real cae en los próximos 14 días; i05 el día BAJA_RECONTACTO_DIA publica la lista de
//     históricos para recontactar.
//   · procesarLlamada(reunión de Fathom): i02. Si la llamada calza con UN cliente cuyo fin está cerca, Claude dice si es la de
//     renovación y qué decidió. "No renueva" o "dudoso" → pedido de CONFIRMACIÓN en Verificaciones. SIEMPRE se pide, aunque
//     el Fathom sea obvio (Tomás, 25/10): sin el OK no avanza nada (ni la despedida, ni los grupos, ni el CRM).
//   · pedirBajaManual(ID): abre el mismo pedido de confirmación a mano (el cliente avisó por otro lado).
//   · procesarEventos(candidatos del webhook de Whapi): ecos del bot y los OK / NO citando un pedido de esta etapa:
//       - aviso_fin (aprobadores) → con OK, el mensaje de renovación con el Calendly de Tomi al General;
//       - confirmar_baja (aprobadores) → con OK, la baja queda CONFIRMADA: CRM a FINALIZADO (i04), aviso a Aylu por Skool
//         (i03b) y el pedido de la despedida;
//       - despedida (Aylu o aprobadores) → con OK, PRIMERO la despedida al General y DESPUÉS sacarlo de General, Ventas y
//         Contenido (i03a). "OK sin mensaje" lo saca sin despedida. Si la despedida no salió, no se saca a nadie.
// Modo: seco = nada sale y nada se escribe (solo el registro); ensayo = lecturas reales y, como mucho, un reporte SIMULACIÓN
// corto en Verificaciones; real = por capacidad (config.ts). Drive no se toca nunca. Nunca tira: los errores van al resumen.
import { conPrefijoEnsayo } from '@/lib/bot/whapi/compuerta'
import type { AutorWhapi, ParticipanteGrupo, ResultadoQuitar } from '@/lib/bot/alta/motor/tipos'
import type { ReunionFathom } from '@/lib/fathomAnuncios/tipos'
import type { AlmacenBajas, Baja, NombrePaso, PasoBaja, Pedido, TipoPedido } from './almacen'
import type { ClasificarLlamada } from './claude'
import {
  ESPERA_DESPEDIDA_MS, MARGEN_ENVIO_MS, MARGEN_INICIO_MS, MAX_AVISOS_DIA, MAX_QUITAR_POR_GRUPO, MAX_RECONTACTO, PLAZO_BAJAS_MS, VENCE_PEDIDO_MS,
  prendida, reporteEnsayo, saleReal, type CapacidadBaja, type ConfigBajas,
} from './config'
import type { PedidoBajaCrm, ResultadoBajaCrm } from './crm'
import type { ResultadoQuitarAcceso } from '@/lib/bot/alta/puenteDrive'
import type { MetaBajas } from './meta'
import type { CandidatosBajas, RespuestaBaja } from './filtro'
import { candidatosAvisoFin, clienteDeLlamada, estadoParaBaja, historicosParaRecontacto, type ClienteBaja } from './fin'
import { GRUPOS_CLIENTE, type DirectorioGrupos, type GrupoCliente } from './grupos'
import {
  diaAR, fechaCorta, huellaTexto, telCorto, textoDespedida, textoDiscordSkool, textoPedidoAvisoFin, textoPedidoBaja, textoPedidoDespedida,
  textoPedidoMeta, textoRenovacion, textosRecontacto, type CampanaPausable, type EstadoCrmBaja, type Historico, type OrigenBaja, type PropuestaEstado,
} from './textos'

export interface RegistroLogBajas { info(m: string): void; warn(m: string): void; error(m: string): void }

export interface DepsBajas {
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  config: ConfigBajas
  almacen: AlmacenBajas
  grupos: DirectorioGrupos
  /** El cliente real de Whapi (solo se llama cuando el modo y la capacidad lo permiten). Tira ErrorWhapi. */
  enviarTexto(p: { chatId: string; texto: string; citar?: string | null }): Promise<{ id: string | null }>
  /** GET de los participantes de un grupo (ensayo y real). */
  participantes?(chatId: string): Promise<ParticipanteGrupo[]>
  /** DELETE de participantes (solo real con baja_quitar_grupos). */
  quitar?(chatId: string, ids: string[]): Promise<ResultadoQuitar>
  clasificar?: ClasificarLlamada
  /** Discord #🤝-exito-y-bajas: devuelve el id del (primer) mensaje. */
  discord?(textos: string[], menciones: string[]): Promise<string | null>
  /** Paso del CRM (crm.ts). 'simulacion' solo lee. */
  crm?(p: PedidoBajaCrm, modo: 'real' | 'simulacion'): Promise<ResultadoBajaCrm>
  /** Ronda 2: campañas de Meta (lectura y pausa, meta.ts). */
  meta?: MetaBajas
  /** Ronda 2: Puente Drive quitarAccesoCliente (solo real con baja_quitar_drive). */
  quitarAccesoDrive?(carpetaId: string, correos: string[]): Promise<ResultadoQuitarAcceso>
  /** Ronda 2: DELETE /communities/{id} de Whapi (solo real con baja_eliminar_comunidad). */
  eliminarComunidad?(comunidadId: string): Promise<void>
  /** Ronda 2: la comunidad "<Nombre> - C.J" por nombre, si el motor no guardó el id (null si no hay una sola). */
  buscarComunidad?(cliente: string): Promise<string | null>
  /** Clientes del CRM (Agencia y Consultora; la etapa filtra). */
  leerClientes(): Promise<ClienteBaja[]>
  /** Último puntaje del Typeform por ID del CRM (opcional: sin esto se usa la columna Satisfacción del CRM). */
  puntajes?(clientes: ClienteBaja[]): Promise<Map<string, number>>
  mencionAylu: string | null
  /** Teléfonos (dígitos) y @lid del equipo: nunca se sacan de un grupo. */
  equipo: ReadonlySet<string>
  ahora: () => number
  esperar?: (ms: number) => Promise<void>
  /** Márgenes del deadline de i02 (por defecto MARGEN_INICIO_MS y MARGEN_ENVIO_MS; los tests los achican). */
  margenes?: { inicio: number; envio: number }
  log: RegistroLogBajas
}

export interface ResumenBajas {
  modo: string
  avisos: number; pedidosBaja: number; despedidas: number; aprobados: number; rechazados: number; renovaciones: number
  llamadas: number; bajas: number; quitados: number; recontactos: number; vencidos: number; ecos: number; ignorados: number
  errores: string[]; registro: string[]
}
const vacio = (modo: string): ResumenBajas => ({ modo, avisos: 0, pedidosBaja: 0, despedidas: 0, aprobados: 0, rechazados: 0, renovaciones: 0, llamadas: 0, bajas: 0, quitados: 0, recontactos: 0, vencidos: 0, ecos: 0, ignorados: 0, errores: [], registro: [] })

const DIA_MS = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
const soloDigitos = (s: string) => s.replace(/\D/g, '')
const idSeguro = (s: string) => s.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120)
const quienDe = (a: AutorWhapi) => a.nombre ?? a.telefono ?? a.lid ?? 'aprobador'

/** ¿El autor está en la lista? (mismo criterio que enLista del orquestador: lid exacto o los últimos 10 dígitos). */
export function enLista(autor: Pick<AutorWhapi, 'telefono' | 'lid'>, lista: readonly string[]): boolean {
  return lista.some((x) => {
    const t = x.trim()
    if (!t) return false
    if (t.includes('@')) return !!autor.lid && autor.lid === t
    const d = soloDigitos(t)
    return !!autor.telefono && d.length >= 8 && soloDigitos(autor.telefono).slice(-10) === d.slice(-10)
  })
}

/** ¿Ese participante es del equipo? (teléfono por los últimos 10 dígitos o @lid exacto). */
export function esDelEquipo(id: string, equipo: ReadonlySet<string>): boolean {
  if (id.includes('@')) return equipo.has(id)
  const d = soloDigitos(id).slice(-10)
  return d.length >= 8 && [...equipo].some((e) => !e.includes('@') && soloDigitos(e).slice(-10) === d)
}

/** A quién se saca de un grupo: los MIEMBROS que no son del equipo (nunca un admin ni el creador: el bot y el equipo). PURO. */
export function aQuitarDe(ps: readonly ParticipanteGrupo[], equipo: ReadonlySet<string>): string[] {
  return ps.filter((p) => p.rango === 'miembro' && !esDelEquipo(p.id, equipo)).map((p) => p.id)
}

type Salida = { estado: 'enviado'; id: string | null } | { estado: 'simulado' } | { estado: 'error'; dudoso: boolean; motivo: string }
const NOMBRE_GRUPO: Record<GrupoCliente, string> = { general: 'General', ventas: 'Ventas', contenido: 'Contenido' }

export function crearNucleoBajas(d: DepsBajas) {
  const { config: c, almacen } = d
  const real = (cap: CapacidadBaja) => saleReal(cap, c.modo, c.capacidades)
  const ensayo = (cap: CapacidadBaja) => reporteEnsayo(cap, c.modo, c.capacidades)
  const hoy = () => diaAR(d.ahora())

  /** Manda un texto si `permitido`; en ensayo, con el prefijo SIMULACIÓN. Nunca tira. */
  async function salir(permitido: boolean, chatId: string | null, texto: string, citar: string | null = null): Promise<Salida & { texto: string }> {
    const final = c.modo === 'ensayo' ? conPrefijoEnsayo(texto) : texto
    if (!permitido || !chatId) return { estado: 'simulado', texto: final }
    try {
      const r = await d.enviarTexto({ chatId, texto: final, citar })
      return { estado: 'enviado', id: r.id, texto: final }
    } catch (e) {
      const ap = (e as { aplicado?: boolean | null })?.aplicado
      return { estado: 'error', dudoso: ap === null || ap === undefined ? (e as { tipo?: string })?.tipo === 'dudoso' : false, motivo: motivoDe(e), texto: final }
    }
  }
  /** Respuesta corta en Verificaciones (solo en real con la capacidad; citando el OK). */
  const responder = async (cap: CapacidadBaja, texto: string, citar: string) => { if (real(cap)) await salir(true, c.verificaciones, texto, citar) }

  /** Abre un pedido de OK en Verificaciones (o el reporte SIMULACIÓN en ensayo). false si no se abrió. */
  async function abrirPedido(r: ResumenBajas, p: { id: string; tipo: TipoPedido; cliente: ClienteBaja; general: string | null; fin: string | null; texto: string; detalle: Record<string, unknown>; permitido: boolean; haria: string }): Promise<boolean> {
    if (d.clienteOperativo && !await d.clienteOperativo(p.cliente.id, p.cliente.nombre)) { r.ignorados++; return false }
    if (!p.permitido) { r.registro.push(`haría: ${p.haria}`); return false }
    if (!c.verificaciones) { r.errores.push('falta WHAPI_GRUPO_VERIFICACIONES: no se puede pedir el OK'); return false }
    const final = c.modo === 'ensayo' ? conPrefijoEnsayo(p.texto) : p.texto
    const creado = await almacen.crearPedido({
      id: p.id, tipo: p.tipo, clave: p.cliente.id.toUpperCase(), cliente: p.cliente.nombre, idCrm: p.cliente.id.toUpperCase(), general: p.general, fin: p.fin,
      modo: c.modo, mensajePedidoId: null, huella: huellaTexto(final), detalle: p.detalle, creado: iso(d.ahora()),
    })
    if (!creado) { r.ignorados++; return false }
    const s = await salir(true, c.verificaciones, p.texto)
    if (s.estado === 'enviado') {
      if (s.id) await almacen.actualizarPedido(p.id, { mensajePedidoId: s.id })
      r.registro.push(`pedido ${p.tipo} de ${p.cliente.nombre} en Verificaciones${c.modo === 'ensayo' ? ' (SIMULACIÓN)' : ''}`)
      return true
    }
    if (s.estado === 'error' && s.dudoso) { r.registro.push(`pedido ${p.tipo} de ${p.cliente.nombre}: Whapi no confirmó (lo confirma el eco)`); return true }
    await almacen.actualizarPedido(p.id, { estado: 'vencido', error: s.estado === 'error' ? s.motivo : 'no salió', resuelto: iso(d.ahora()) })
    r.errores.push(`${p.cliente.nombre}: no salió el pedido ${p.tipo} (${s.estado === 'error' ? s.motivo : 'simulado'})`)
    return false
  }

  // ── i01: aviso de fin ──
  async function avisosFin(r: ResumenBajas, clientes: ClienteBaja[]) {
    const permitido = real('baja_aviso_fin') || ensayo('baja_aviso_fin')
    let abiertos = 0
    for (const cand of candidatosAvisoFin(clientes, hoy())) {
      const k = cand.cliente
      const id = `aviso:${k.id.toUpperCase()}:${cand.fin}`
      if (await almacen.pedido(id)) continue
      const baja = await almacen.bajaDe(k.id.toUpperCase())
      if (baja && Date.parse(baja.creado) > d.ahora() - 180 * DIA_MS) continue
      if (abiertos >= MAX_AVISOS_DIA) { r.registro.push(`tope de ${MAX_AVISOS_DIA} avisos de fin por día: el resto sigue mañana`); break }
      const general = permitido ? (await d.grupos.deCliente(k.id, k.nombre))?.grupos.general ?? null : null
      const texto = `${textoPedidoAvisoFin(k.nombre, cand.fin)}${permitido && !general ? '\n(No conozco su grupo General: el mensaje habría que mandarlo a mano.)' : ''}`
      if (await abrirPedido(r, { id, tipo: 'aviso_fin', cliente: k, general, fin: cand.fin, texto, detalle: { dias: cand.dias }, permitido, haria: `pedir el OK del aviso de fin de ${k.nombre} (termina el ${fechaCorta(cand.fin)}; sin la capacidad baja_aviso_fin)` })) { abiertos++; r.avisos++ }
    }
  }

  async function aprobarAvisoFin(r: ResumenBajas, p: Pedido, x: RespuestaBaja) {
    const por = quienDe(x.autor), ahora = iso(d.ahora())
    if (x.veredicto === 'no') {
      if (await almacen.actualizarPedido(p.id, { estado: 'rechazado', por, respuesta: `NO ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) { r.rechazados++; r.registro.push(`NO al mensaje de renovación de ${p.cliente}`) }
      return
    }
    if (!real('baja_mensaje_cliente') || p.modo !== 'real') {
      if (await almacen.actualizarPedido(p.id, { estado: 'aprobado_simulado', por, respuesta: `OK ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) {
        r.aprobados++
        r.registro.push(`haría: mandar el mensaje de renovación a ${p.cliente} (modo ${c.modo}${p.modo !== 'real' ? `, pedido de ${p.modo}` : c.modo === 'real' ? ', sin baja_mensaje_cliente' : ''})`)
      }
      return
    }
    const falta = !p.general ? 'no conozco su grupo General' : !p.fin ? 'no tengo la fecha de fin' : null
    if (falta) {
      if (await almacen.actualizarPedido(p.id, { estado: 'error', por, respuesta: `OK ${x.resto}`.trim(), error: falta, resuelto: ahora }, ['abierto'])) {
        r.errores.push(`${p.cliente}: no mandé el mensaje de renovación (${falta})`)
        await responder('baja_aviso_fin', `No le mandé el mensaje de renovación a ${p.cliente}: ${falta}. Se puede mandar a mano.`, x.mensajeId)
      }
      return
    }
    if (!(await almacen.actualizarPedido(p.id, { estado: 'aprobado', por, respuesta: `OK ${x.resto}`.trim() }, ['abierto']))) return
    r.aprobados++
    const s = await salir(true, p.general, textoRenovacion(p.cliente, p.fin!, c.calendlyUrl))
    if (s.estado === 'enviado') {
      await almacen.actualizarPedido(p.id, { estado: 'enviado', mensajeClienteId: s.id, resuelto: iso(d.ahora()) })
      r.renovaciones++
      r.registro.push(`mensaje de renovación enviado a ${p.cliente}`)
      await responder('baja_aviso_fin', `Listo: le mandé el mensaje de renovación a ${p.cliente}.`, x.mensajeId)
    } else if (s.estado === 'error' && s.dudoso) {
      await almacen.actualizarPedido(p.id, { estado: 'dudoso', error: s.motivo, resuelto: iso(d.ahora()) })
      r.errores.push(`${p.cliente}: Whapi no confirmó el mensaje de renovación (puede haber salido)`)
      await responder('baja_aviso_fin', `No sé si le llegó el mensaje de renovación a ${p.cliente} (WhatsApp no confirmó). Revisen el General antes de mandarlo a mano.`, x.mensajeId)
    } else {
      await almacen.actualizarPedido(p.id, { estado: 'error', error: s.estado === 'error' ? s.motivo : 'no salió', resuelto: iso(d.ahora()) })
      r.errores.push(`${p.cliente}: no salió el mensaje de renovación`)
      await responder('baja_aviso_fin', `No pude mandarle el mensaje de renovación a ${p.cliente}. Se puede mandar a mano.`, x.mensajeId)
    }
  }

  // ── i02: confirmación de la baja ──
  async function abrirPedidoBaja(r: ResumenBajas, k: ClienteBaja, origen: OrigenBaja, idOrigen: string): Promise<boolean> {
    if (d.clienteOperativo && !await d.clienteOperativo(k.id, k.nombre)) { r.ignorados++; return false }
    const clave = k.id.toUpperCase()
    if (await almacen.abiertoDe(clave, 'confirmar_baja')) { r.ignorados++; r.registro.push(`${k.nombre}: ya hay un pedido de confirmación de baja abierto`); return false }
    const previa = await almacen.bajaDe(clave)
    if (previa && Date.parse(previa.creado) > d.ahora() - 60 * DIA_MS) { r.ignorados++; r.registro.push(`${k.nombre}: la baja ya está confirmada`); return false }
    const general = (await d.grupos.deCliente(k.id, k.nombre))?.grupos.general ?? null
    const permitido = real('baja_fathom') || ensayo('baja_fathom')
    // Ronda 2: FINALIZADO o INACTIVO (fin.ts estadoParaBaja). Sin dudas va propuesto en el mismo OK; con dudas se pregunta
    const estadoCrm = estadoParaBaja(k, hoy())
    const ok = await abrirPedido(r, {
      id: `baja:${clave}:${idSeguro(idOrigen)}`, tipo: 'confirmar_baja', cliente: k, general, fin: null, texto: textoPedidoBaja(k.nombre, origen, estadoCrm),
      detalle: { origen, mail: k.mail, estadoCrm }, permitido, haria: `pedir la confirmación de la baja de ${k.nombre} (sin la capacidad baja_fathom)`,
    })
    if (ok) r.pedidosBaja++
    return ok
  }

  /** i02 por Fathom. La reunión ya viene validada (validarReunion de lib/fathomAnuncios/tipos.ts).
   *  Comparte la invocación con el kickoff: (1) descarta BARATO, sin escribir nada ni llamar a Claude, lo que no puede ser
   *  una renovación (reunión interna, sin transcripción, o que no calza con UN cliente cerca del fin: una kickoff de un
   *  cliente nuevo tiene el fin a ~120 días y no calza); (2) tiene su propio deadline: sin MARGEN_INICIO_MS libres no
   *  empieza (no reclama nada) y sin MARGEN_ENVIO_MS no abre el pedido: la llamada queda 'cortada' y se puede reintentar;
   *  (3) es idempotente por recording_id: Fathom reenvía o se reprocesa a mano y nunca se manda ni se escribe dos veces. */
  async function procesarLlamada(reunion: ReunionFathom, op: { deadline?: number } = {}): Promise<ResumenBajas> {
    const r = vacio(c.modo)
    const id = reunion.recording_id
    if (!prendida('baja_fathom', c.modo, c.capacidades)) { r.registro.push(`${c.modo === 'seco' ? 'seco' : 'sin la capacidad baja_fathom'}: no se mira la llamada ${id}`); return r }
    const deadline = op.deadline ?? d.ahora() + PLAZO_BAJAS_MS
    const { inicio, envio } = d.margenes ?? { inicio: MARGEN_INICIO_MS, envio: MARGEN_ENVIO_MS }
    const resta = () => deadline - d.ahora()
    // (1) Descartes sin red ni base
    if (reunion.calendar_invitees_domains_type === 'only_internal') { r.registro.push(`llamada ${id}: reunión interna, no es de renovación`); return r }
    if (!reunion.transcript?.length) { r.registro.push(`llamada ${id}: sin transcripción`); return r }
    if (resta() < inicio) { r.registro.push(`llamada ${id}: sin tiempo en esta invocación (no se reclamó: queda para reintentar)`); return r }
    try {
      const cuando = Date.parse(reunion.recording_start_time ?? reunion.created_at ?? '') || d.ahora()
      const fecha = diaAR(cuando)
      // (1b) Cruce con un cliente cerca del fin: solo lecturas (el CRM sale del snapshot). Sin cliente no se escribe nada
      const clientes = await d.leerClientes()
      const conAviso = await almacen.conAvisoDesde(iso(d.ahora() - 90 * DIA_MS))
      const k = clienteDeLlamada(clientes, { titulo: `${reunion.title} ${reunion.meeting_title ?? ''}`, mails: (reunion.calendar_invitees ?? []).map((i) => i.email ?? '').filter(Boolean), fecha }, conAviso)
      if (!k) { r.registro.push(`llamada ${id}: no calza con un cliente cerca del fin (no se gasta Claude ni se guarda nada)`); return r }
      if (d.clienteOperativo && !await d.clienteOperativo(k.id, k.nombre)) { r.ignorados++; return r }
      if (resta() < inicio) { r.registro.push(`llamada ${id}: sin tiempo en esta invocación (no se reclamó: queda para reintentar)`); return r }
      // (3) Dedupe por recording_id ('cortada' / 'error' se pueden reintentar)
      if (!(await almacen.reclamarLlamada({ recordingId: id, fecha, url: reunion.share_url ?? reunion.url }, iso(d.ahora())))) { r.ignorados++; r.registro.push(`la llamada ${id} ya se miró`); return r }
      r.llamadas++
      await almacen.actualizarLlamada(id, { clave: k.id.toUpperCase(), cliente: k.nombre })
      if (!d.clasificar) { await almacen.actualizarLlamada(id, { estado: 'cortada' }); r.registro.push(`haría: leer con Claude la llamada de ${k.nombre}`); return r }
      const transcripcion = reunion.transcript.map((t) => `[${t.timestamp}] ${t.speaker.display_name}: ${t.text}`).join('\n')
      let l
      try {
        l = await d.clasificar({ cliente: k.nombre, fecha, transcripcion, resumen: reunion.default_summary?.markdown_formatted ?? null, topeMs: Math.max(1_000, resta() - envio) })
      } catch (e) {
        const corte = resta() < envio || /a tiempo|timeout/i.test(motivoDe(e))
        await almacen.actualizarLlamada(id, { estado: corte ? 'cortada' : 'error', motivo: motivoDe(e) })
        r.errores.push(`${k.nombre}: no se pudo leer la llamada (${motivoDe(e)})${corte ? ': queda para reintentar' : ''}`)
        return r
      }
      // (2) Sin tiempo para abrir el pedido: no se guarda la decisión a medias, queda para reintentar
      if (resta() < envio) {
        await almacen.actualizarLlamada(id, { estado: 'cortada', motivo: 'se acabó el tiempo de la invocación antes de abrir el pedido' })
        r.registro.push(`llamada ${id}: sin tiempo para abrir el pedido (queda para reintentar)`)
        return r
      }
      await almacen.actualizarLlamada(id, { estado: 'clasificada', decision: l.decision, confianza: l.confianza, cita: l.cita, motivo: l.motivo, motivoBaja: l.motivoBaja })
      r.registro.push(`llamada de ${k.nombre}: ${l.decision} (${l.confianza})`)
      if (l.decision !== 'no_renueva' && l.decision !== 'dudoso') return r
      const origen: OrigenBaja = { tipo: 'fathom', decision: l.decision, fecha, cita: l.cita, motivo: l.motivoBaja || l.motivo, url: reunion.share_url ?? reunion.url }
      // El id del pedido es fijo por grabación: un reintento nunca abre otro ni manda dos veces
      if (await abrirPedidoBaja(r, k, origen, `f${id}`)) await almacen.actualizarLlamada(id, { pedidoId: `baja:${k.id.toUpperCase()}:f${id}` })
    } catch (e) {
      r.errores.push(`llamada ${id}: ${motivoDe(e)}`)
    }
    return r
  }

  async function pedirBajaManual(id: string, por: string, motivo: string): Promise<ResumenBajas> {
    const r = vacio(c.modo)
    if (c.modo === 'seco') { r.registro.push(`seco: haría: pedir la confirmación de la baja de ${id}`); return r }
    try {
      const k = (await d.leerClientes()).find((x) => x.linea === 'agencia' && x.id.toUpperCase() === id.toUpperCase())
      if (!k) { r.errores.push(`el ID ${id} no está en Agencia`); return r }
      await abrirPedidoBaja(r, k, { tipo: 'manual', por, motivo }, `m${diaAR(d.ahora())}`)
    } catch (e) { r.errores.push(`baja manual de ${id}: ${motivoDe(e)}`) }
    return r
  }

  const paso = (estado: PasoBaja['estado'], detalle: string): PasoBaja => ({ estado, detalle, en: iso(d.ahora()) })

  /** Lo que se sacaría de cada grupo (lectura). null si no hay cómo leer. */
  async function previaQuitar(grupos: Partial<Record<GrupoCliente, string>>): Promise<{ porGrupo: Partial<Record<GrupoCliente, string[]>>; errores: string[] } | null> {
    if (!d.participantes) return null
    const porGrupo: Partial<Record<GrupoCliente, string[]>> = {}, errores: string[] = []
    for (const g of GRUPOS_CLIENTE) {
      const chat = grupos[g]
      if (!chat) continue
      try { porGrupo[g] = aQuitarDe(await d.participantes(chat), d.equipo) } catch (e) { errores.push(`${NOMBRE_GRUPO[g]}: ${motivoDe(e)}`) }
    }
    return { porGrupo, errores }
  }
  const listaQuitar = (pq: Awaited<ReturnType<typeof previaQuitar>>): string[] =>
    pq ? [...new Set(Object.values(pq.porGrupo).flat().filter((x): x is string => !!x))].map(telCorto) : []

  /** OK FINALIZADO / OK INACTIVO (o el propuesto si no había dudas). null = había dudas y no lo dijeron. */
  const estadoElegido = (resto: string, propuesta: PropuestaEstado): EstadoCrmBaja | null =>
    /\binactivo\b/i.test(resto) ? 'INACTIVO' : /\bfinalizado\b/i.test(resto) ? 'FINALIZADO' : propuesta.dudoso ? null : propuesta.estado

  async function aprobarBaja(r: ResumenBajas, p: Pedido, x: RespuestaBaja) {
    const por = quienDe(x.autor), ahora = iso(d.ahora())
    if (x.veredicto === 'no') {
      if (await almacen.actualizarPedido(p.id, { estado: 'rechazado', por, respuesta: `NO ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) { r.rechazados++; r.registro.push(`NO a la baja de ${p.cliente}: no se hace nada`) }
      return
    }
    const propuesta = (p.detalle.estadoCrm ?? { dudoso: false, estado: 'FINALIZADO', motivo: '' }) as PropuestaEstado
    const estadoCrm = estadoElegido(x.resto, propuesta)
    if (!estadoCrm) {
      // Había dudas y respondieron "OK" solo: no avanza nada; se pide el estado (el pedido sigue abierto)
      r.ignorados++
      r.registro.push(`${p.cliente}: OK sin el estado del CRM (había dudas): se pide OK FINALIZADO / OK INACTIVO`)
      if (real('baja_fathom') || ensayo('baja_fathom')) await salir(true, c.verificaciones, `Para confirmar la baja de ${p.cliente} necesito el estado del CRM: respondé citando el pedido con OK FINALIZADO / OK INACTIVO.`, x.mensajeId)
      return
    }
    const origen = (p.detalle.origen ?? { tipo: 'manual', por: '', motivo: '' }) as OrigenBaja
    const mail = typeof p.detalle.mail === 'string' ? p.detalle.mail : ''
    const motivo = origen.motivo ?? ''
    const fecha = hoy()
    const notaCrm = `No renueva${motivo ? `: ${motivo}` : ''}. Baja confirmada por ${por} (bot): ${estadoCrm}.`
    const ficha = await d.grupos.deCliente(p.idCrm, p.cliente)
    const grupos = ficha?.grupos ?? {}
    const carpeta = ficha?.carpeta ?? null
    const correos = [...new Set([mail, ...(ficha?.correos ?? [])].map((m) => m.trim().toLowerCase()).filter((m) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) && !/skyward|capitaljuridico/i.test(m)))]

    // ENSAYO (o un pedido que se abrió en ensayo): nada se toca; un solo reporte SIMULACIÓN con lo que haría
    if (c.modo !== 'real' || p.modo !== 'real') {
      if (!(await almacen.actualizarPedido(p.id, { estado: 'aprobado_simulado', por, respuesta: `OK ${x.resto}`.trim(), resuelto: ahora, detalle: { estadoElegido: estadoCrm } }, ['abierto']))) return
      r.aprobados++
      const crm = d.crm && prendida('baja_crm', c.modo, c.capacidades) ? await d.crm({ id: p.idCrm, nombre: p.cliente, fecha, nota: notaCrm, estado: estadoCrm }, 'simulacion').catch((e) => ({ estado: 'error', detalle: motivoDe(e) }) as Pick<ResultadoBajaCrm, 'estado' | 'detalle'>) : null
      const pq = prendida('baja_quitar_grupos', c.modo, c.capacidades) ? await previaQuitar(grupos) : null
      const meta = d.meta && prendida('baja_pausar_meta', c.modo, c.capacidades) ? await d.meta.campanasActivas(p.cliente).catch(() => null) : null
      const partes = [
        `Baja de ${p.cliente}: con el OK se haría esto (no se tocó nada).`,
        crm ? `CRM (${estadoCrm}): ${crm.detalle}` : `CRM: pasaría a ${estadoCrm} (sin baja_crm)`,
        `Skool: aviso a Aylu con ${mail || 'el nombre (sin correo en el CRM)'}`,
        prendida('baja_quitar_drive', c.modo, c.capacidades) ? `Drive: le sacaría el acceso a ${correos.length} correo(s) en su carpeta${carpeta ? '' : ' (no conozco la carpeta: a mano)'}` : 'Drive: (sin baja_quitar_drive)',
        meta ? (meta.tokenCaido ? `Meta: no pude leer (${meta.errores[0] ?? 'token'})` : `Meta: pediría el OK para pausar ${meta.campanas.length} campaña(s)${meta.campanas.length ? `: ${meta.campanas.slice(0, 5).map((m) => m.nombre).join(', ')}` : ''}`) : 'Meta: (sin baja_pausar_meta)',
        'Despedida: se pediría el OK de Aylu',
        pq ? `Grupos: sacaría a ${listaQuitar(pq).join(', ') || 'nadie'}${pq.errores.length ? ` (no pude leer ${pq.errores.join('; ')})` : ''}` : 'Grupos: (sin baja_quitar_grupos)',
        prendida('baja_eliminar_comunidad', c.modo, c.capacidades) ? `Comunidad: después eliminaría su comunidad${ficha?.comunidad ? '' : ' (la buscaría por nombre)'}` : 'Comunidad: (sin baja_eliminar_comunidad)',
      ]
      await almacen.actualizarPedido(p.id, { detalle: { simulacion: partes } })
      if (ensayo('baja_fathom')) await salir(true, c.verificaciones, partes.join('\n'), x.mensajeId)
      r.registro.push(`haría: confirmar la baja de ${p.cliente} (${c.modo}, ${estadoCrm})`)
      return
    }

    if (!(await almacen.actualizarPedido(p.id, { estado: 'enviado', por, respuesta: `OK ${x.resto}`.trim(), resuelto: ahora, detalle: { estadoElegido: estadoCrm } }, ['abierto']))) return
    r.aprobados++
    const bajaId = `${p.idCrm}:${fecha}`
    const baja: Omit<Baja, 'pasos'> = { id: bajaId, clave: p.clave, idCrm: p.idCrm, cliente: p.cliente, general: grupos.general ?? p.general, mail, motivo, origen, por, modo: c.modo, confirmada: ahora, creado: ahora }
    if (!(await almacen.crearBaja(baja))) { r.ignorados++; r.registro.push(`${p.cliente}: la baja de hoy ya estaba confirmada`); return }
    r.bajas++
    const resumen: string[] = []

    // i04: CRM → FINALIZADO o INACTIVO (Históricos). El tablero de anuncios lo saca solo al leer cualquiera de los dos.
    if (real('baja_crm') && d.crm) {
      try {
        const res = await d.crm({ id: p.idCrm, nombre: p.cliente, fecha, nota: notaCrm, estado: estadoCrm }, 'real')
        await almacen.marcarPaso(bajaId, 'crm', paso(res.estado === 'hecho' || res.estado === 'ya_estaba' ? 'hecho' : 'error', res.detalle))
        resumen.push(`CRM: ${res.estado === 'error' ? `no se pudo (${res.detalle})` : res.detalle}`)
        if (res.estado === 'error') r.errores.push(`${p.cliente}: CRM — ${res.detalle}`)
      } catch (e) {
        await almacen.marcarPaso(bajaId, 'crm', paso('error', motivoDe(e)))
        resumen.push(`CRM: no se pudo (hay que pasarlo a ${estadoCrm} a mano)`)
        r.errores.push(`${p.cliente}: CRM — ${motivoDe(e)}`)
      }
    } else {
      await almacen.marcarPaso(bajaId, 'crm', paso('omitido', 'sin la capacidad baja_crm'))
      resumen.push(`CRM: pasarlo a ${estadoCrm} a mano (baja_crm apagada)`)
    }

    // i03b: Skool (sin API) → aviso a Aylu en Discord con el correo
    if (real('baja_aviso_skool') && d.discord) {
      try {
        const id = await d.discord([textoDiscordSkool({ cliente: p.cliente, mencion: d.mencionAylu, mail, por, fecha: fechaCorta(fecha) })], d.mencionAylu ? [d.mencionAylu] : [])
        await almacen.marcarPaso(bajaId, 'skool', paso('hecho', `aviso en Discord ${id ?? ''}`.trim()))
        resumen.push('Skool: le avisé a Aylu en #🤝-exito-y-bajas')
      } catch (e) {
        await almacen.marcarPaso(bajaId, 'skool', paso('error', motivoDe(e)))
        resumen.push('Skool: no salió el aviso a Aylu (avisarle a mano)')
        r.errores.push(`${p.cliente}: Discord — ${motivoDe(e)}`)
      }
    } else {
      await almacen.marcarPaso(bajaId, 'skool', paso('omitido', 'sin la capacidad baja_aviso_skool'))
      resumen.push('Skool: avisarle a Aylu a mano (baja_aviso_skool apagada)')
    }

    // Ronda 2: Drive → se le saca el acceso a su carpeta (cliente y socios). La carpeta y el contenido quedan intactos
    if (real('baja_quitar_drive') && d.quitarAccesoDrive) {
      if (!carpeta) { await almacen.marcarPaso(bajaId, 'drive', paso('error', 'no conozco su carpeta de Drive')); resumen.push('Drive: no conozco su carpeta "<Nombre> - C.J": sacarle el acceso a mano') }
      else if (!correos.length) { await almacen.marcarPaso(bajaId, 'drive', paso('error', 'sin correos del cliente')); resumen.push('Drive: no tengo correos del cliente ni de sus socios: revisar a mano') }
      else {
        try {
          const q = await d.quitarAccesoDrive(carpeta, correos)
          const enlace = q.enlacePublico ? ` · OJO: la carpeta tiene acceso general (${q.acceso ?? '?'}): no lo cambié, decidan ustedes` : ''
          const det = `saqué a ${q.quitados.length}${q.noTenian.length ? `, ${q.noTenian.length} ya no tenía(n) acceso` : ''}${q.protegidos.length ? `, ${q.protegidos.length} protegido(s)` : ''}${enlace}`
          await almacen.marcarPaso(bajaId, 'drive', paso('hecho', det))
          resumen.push(`Drive: ${det}`)
        } catch (e) {
          const viejo = (e as { codigo?: string })?.codigo === 'accion_desconocida'
          const m = viejo ? 'falta publicar el Puente Drive 2026-10-26a (quitarAccesoCliente)' : motivoDe(e)
          await almacen.marcarPaso(bajaId, 'drive', paso((e as { aplicado?: boolean | null })?.aplicado === null ? 'dudoso' : 'error', m))
          resumen.push(`Drive: no se pudo (${m}): sacarle el acceso a mano`)
          r.errores.push(`${p.cliente}: Drive — ${m}`)
        }
      }
    } else {
      await almacen.marcarPaso(bajaId, 'drive', paso('omitido', 'sin la capacidad baja_quitar_drive'))
      resumen.push('Drive: sacarle el acceso a su carpeta a mano (baja_quitar_drive apagada)')
    }

    // Ronda 2: Meta → pedido de OK con la lista de campañas activas (se pausan recién con el OK; nunca se borra nada)
    if (real('baja_pausar_meta') && d.meta) {
      try {
        const l = await d.meta.campanasActivas(p.cliente)
        if (l.tokenCaido) {
          const m = `el token de Meta (META_ANUNCIOS_TOKEN) venció o no tiene permiso${l.errores[0] ? ` (${l.errores[0]})` : ''}: no pausé nada`
          await almacen.marcarPaso(bajaId, 'meta', paso('error', m)); resumen.push(`Meta: ${m}. Hay que renovarlo y pausar a mano`); r.errores.push(`${p.cliente}: Meta — ${m}`)
        } else if (!l.campanas.length) {
          await almacen.marcarPaso(bajaId, 'meta', paso('hecho', `no tenía campañas activas${l.errores.length ? ` (no pude leer: ${l.errores.join('; ')})` : ''}`))
          resumen.push(`Meta: no tiene campañas activas${l.errores.length ? ` (ojo, no pude leer: ${l.errores.join('; ')})` : ''}`)
        } else {
          const ok = await abrirPedido(r, {
            id: `meta:${idSeguro(bajaId)}`, tipo: 'pausar_meta', cliente: { id: p.idCrm, nombre: p.cliente } as ClienteBaja, general: null, fin: null,
            texto: textoPedidoMeta(p.cliente, l.campanas), detalle: { bajaId, campanas: l.campanas }, permitido: true, haria: '',
          })
          await almacen.marcarPaso(bajaId, 'meta', paso(ok ? 'pendiente' : 'error', ok ? `esperando el OK para pausar ${l.campanas.length} campaña(s)` : 'no pude pedir el OK'))
          resumen.push(ok ? `Meta: pedí el OK para pausar ${l.campanas.length} campaña(s)` : 'Meta: no pude pedir el OK')
        }
      } catch (e) {
        await almacen.marcarPaso(bajaId, 'meta', paso('error', motivoDe(e))); resumen.push('Meta: no pude leer sus campañas (revisar a mano)'); r.errores.push(`${p.cliente}: Meta — ${motivoDe(e)}`)
      }
    } else {
      await almacen.marcarPaso(bajaId, 'meta', paso('omitido', 'sin la capacidad baja_pausar_meta'))
      resumen.push('Meta: pausar sus campañas a mano (baja_pausar_meta apagada)')
    }

    // i03: el pedido de la despedida (la confirma Aylu). Sin ella no se saca a nadie de los grupos (ni se elimina la comunidad).
    if (real('baja_mensaje_cliente') || real('baja_quitar_grupos')) {
      const pq = real('baja_quitar_grupos') ? await previaQuitar(grupos) : null
      const sinGrupos = !GRUPOS_CLIENTE.some((g) => grupos[g])
      const ok = await abrirPedido(r, {
        id: `desp:${idSeguro(bajaId)}`, tipo: 'despedida', cliente: { id: p.idCrm, nombre: p.cliente } as ClienteBaja, general: grupos.general ?? null, fin: null,
        texto: textoPedidoDespedida(p.cliente, textoDespedida(p.cliente), listaQuitar(pq), sinGrupos, real('baja_eliminar_comunidad')), detalle: { bajaId, grupos, comunidad: ficha?.comunidad ?? null },
        permitido: true, haria: '',
      })
      if (ok) { r.despedidas++; await almacen.marcarPaso(bajaId, 'despedida', paso('pendiente', 'esperando el OK de Aylu')) }
      resumen.push(ok ? 'Despedida: le pedí el OK a Aylu (después lo saco de los grupos)' : 'Despedida: no pude pedir el OK')
    } else {
      await almacen.marcarPaso(bajaId, 'despedida', paso('omitido', 'sin baja_mensaje_cliente ni baja_quitar_grupos'))
      resumen.push('Despedida y grupos: a mano (capacidades apagadas)')
    }
    r.registro.push(`baja de ${p.cliente} confirmada por ${por} (${estadoCrm})`)
    await responder('baja_fathom', `Listo: baja de ${p.cliente} confirmada (${estadoCrm}).\n${resumen.join('\n')}`, x.mensajeId)
  }

  /** Ronda 2: OK / NO a pausar sus campañas de Meta. Solo pausa (status PAUSED) y verifica; si el token cae, falla cerrado. */
  async function aprobarPausarMeta(r: ResumenBajas, p: Pedido, x: RespuestaBaja) {
    const por = quienDe(x.autor), ahora = iso(d.ahora())
    const bajaId = String(p.detalle.bajaId ?? '')
    if (x.veredicto === 'no') {
      if (await almacen.actualizarPedido(p.id, { estado: 'rechazado', por, respuesta: `NO ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) {
        r.rechazados++
        if (bajaId) await almacen.marcarPaso(bajaId, 'meta', paso('omitido', `NO de ${por}: no se pausó nada`))
      }
      return
    }
    if (!real('baja_pausar_meta') || p.modo !== 'real' || !d.meta) {
      if (await almacen.actualizarPedido(p.id, { estado: 'aprobado_simulado', por, respuesta: `OK ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) { r.aprobados++; r.registro.push(`haría: pausar las campañas de ${p.cliente}`) }
      return
    }
    if (!(await almacen.actualizarPedido(p.id, { estado: 'aprobado', por, respuesta: `OK ${x.resto}`.trim() }, ['abierto']))) return
    r.aprobados++
    const campanas = ((p.detalle.campanas ?? []) as CampanaPausable[])
    const res = await d.meta.pausar(campanas.map((k) => k.id))
    const nombre = (id: string) => campanas.find((k) => k.id === id)?.nombre ?? id
    let texto: string
    if (res.tokenCaido && !res.pausadas.length) {
      texto = `No pausé ninguna campaña de ${p.cliente}: el token de Meta (META_ANUNCIOS_TOKEN) venció o no tiene permiso. Hay que renovarlo (vence el 24/12) y pausarlas a mano.`
    } else {
      texto = `Listo: pausé ${res.pausadas.length} campaña(s) de ${p.cliente} en Meta (verificadas)${res.fallidas.length ? `. No pude con: ${res.fallidas.map((f) => `${nombre(f.id)} (${f.motivo})`).join('; ')}` : ''}.`
    }
    r.registro.push(texto)
    if (res.fallidas.length || res.tokenCaido) r.errores.push(`${p.cliente}: Meta — ${res.fallidas.length} sin pausar`)
    await almacen.actualizarPedido(p.id, { estado: res.fallidas.length ? 'error' : 'enviado', resuelto: iso(d.ahora()), error: res.fallidas.length ? res.fallidas.map((f) => f.motivo).join('; ').slice(0, 300) : null, detalle: { pausadas: res.pausadas } })
    if (bajaId) await almacen.marcarPaso(bajaId, 'meta', paso(res.fallidas.length ? 'error' : 'hecho', texto))
    await responder('baja_pausar_meta', texto, x.mensajeId)
  }

  /** i03a: saca a los miembros que no son del equipo de cada grupo. Nunca más de MAX_QUITAR_POR_GRUPO por grupo. */
  async function quitarDeGrupos(grupos: Partial<Record<GrupoCliente, string>>): Promise<{ estado: PasoBaja['estado']; detalle: string; quitados: number }> {
    if (!d.participantes || !d.quitar) return { estado: 'error', detalle: 'no hay cliente de Whapi', quitados: 0 }
    const partes: string[] = []
    let quitados = 0, errores = 0, dudosos = 0
    for (const g of GRUPOS_CLIENTE) {
      const chat = grupos[g]
      if (!chat) { partes.push(`${NOMBRE_GRUPO[g]}: no lo conozco`); errores++; continue }
      try {
        const ids = aQuitarDe(await d.participantes(chat), d.equipo)
        if (!ids.length) { partes.push(`${NOMBRE_GRUPO[g]}: no había nadie para sacar`); continue }
        if (ids.length > MAX_QUITAR_POR_GRUPO) { partes.push(`${NOMBRE_GRUPO[g]}: ${ids.length} personas que no son del equipo (más de ${MAX_QUITAR_POR_GRUPO}): no saqué a nadie, revisar`); errores++; continue }
        const res = await d.quitar(chat, ids)
        quitados += res.quitados.length
        partes.push(`${NOMBRE_GRUPO[g]}: saqué ${res.quitados.length}${res.fallidos.length ? `, fallaron ${res.fallidos.map(telCorto).join(', ')}` : ''}`)
        if (res.fallidos.length) errores++
      } catch (e) {
        const dud = (e as { aplicado?: boolean | null })?.aplicado === null
        if (dud) dudosos++; else errores++
        partes.push(`${NOMBRE_GRUPO[g]}: ${dud ? 'WhatsApp no confirmó (revisar)' : `no se pudo (${motivoDe(e)})`}`)
      }
    }
    return { estado: errores ? 'error' : dudosos ? 'dudoso' : 'hecho', detalle: partes.join(' · '), quitados }
  }

  /** Ronda 2: elimina (desactiva) la comunidad del cliente. Solo si se lo sacó de los 3 grupos sin errores. */
  async function eliminarComunidadDe(p: Pedido, gruposOk: boolean): Promise<{ estado: PasoBaja['estado']; detalle: string }> {
    if (!gruposOk) return { estado: 'omitido', detalle: 'no la eliminé: no se lo sacó de los 3 grupos sin errores (revisar y eliminarla a mano)' }
    if (!d.eliminarComunidad) return { estado: 'error', detalle: 'no hay cliente de Whapi' }
    let id = typeof p.detalle.comunidad === 'string' && p.detalle.comunidad ? p.detalle.comunidad : null
    if (!id && d.buscarComunidad) id = await d.buscarComunidad(p.cliente).catch(() => null)
    if (!id) return { estado: 'error', detalle: 'no conozco su comunidad (o hay más de una con su nombre): eliminarla a mano' }
    try {
      await d.eliminarComunidad(id)
      return { estado: 'hecho', detalle: 'eliminada (con su grupo de Avisos)' }
    } catch (e) {
      const st = (e as { status?: number | null })?.status
      if ((e as { aplicado?: boolean | null })?.aplicado === null) return { estado: 'dudoso', detalle: 'WhatsApp no confirmó si se eliminó (revisar)' }
      if (st === 404) return { estado: 'hecho', detalle: 'la comunidad ya no existía' }
      return { estado: 'error', detalle: st === 403 ? 'el bot no es admin de la comunidad: eliminarla a mano' : `no se pudo (${motivoDe(e)})` }
    }
  }

  async function aprobarDespedida(r: ResumenBajas, p: Pedido, x: RespuestaBaja) {
    const por = quienDe(x.autor), ahora = iso(d.ahora())
    const bajaId = String(p.detalle.bajaId ?? '')
    if (x.veredicto === 'no') {
      if (await almacen.actualizarPedido(p.id, { estado: 'rechazado', por, respuesta: `NO ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) {
        r.rechazados++
        if (bajaId) await almacen.marcarPaso(bajaId, 'despedida', paso('omitido', `NO de ${por}: no se mandó la despedida ni se lo sacó de los grupos`))
        r.registro.push(`NO a la despedida de ${p.cliente}: no se manda ni se lo saca de los grupos`)
      }
      return
    }
    const sinMensaje = /\bsin\s+(mensaje|despedida)\b/i.test(x.resto)
    if (!sinMensaje && !real('baja_mensaje_cliente')) {
      if (await almacen.actualizarPedido(p.id, { estado: 'aprobado_simulado', por, respuesta: `OK ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) {
        r.aprobados++
        await responder('baja_quitar_grupos', `No mandé la despedida a ${p.cliente} (baja_mensaje_cliente apagada) y por eso tampoco lo saqué de los grupos. Para sacarlo sin despedida: "OK sin mensaje".`, x.mensajeId)
      }
      return
    }
    if (!(await almacen.actualizarPedido(p.id, { estado: 'aprobado', por, respuesta: `OK ${x.resto}`.trim() }, ['abierto']))) return
    r.aprobados++
    const grupos = (p.detalle.grupos ?? {}) as Partial<Record<GrupoCliente, string>>
    const resumen: string[] = []
    // 1. PRIMERO la despedida
    if (!sinMensaje) {
      const s = await salir(true, grupos.general ?? p.general, textoDespedida(p.cliente))
      if (s.estado === 'enviado' || (s.estado === 'error' && s.dudoso)) {
        if (bajaId) await almacen.marcarPaso(bajaId, 'despedida', paso(s.estado === 'enviado' ? 'hecho' : 'dudoso', s.estado === 'enviado' ? 'despedida enviada al General' : 'WhatsApp no confirmó la despedida'))
        resumen.push(s.estado === 'enviado' ? 'Despedida: enviada al General' : 'Despedida: WhatsApp no confirmó (revisar el General)')
        if (d.esperar) await d.esperar(ESPERA_DESPEDIDA_MS)
      } else {
        const m = s.estado === 'error' ? s.motivo : 'no conozco su grupo General'
        await almacen.actualizarPedido(p.id, { estado: 'error', error: m, resuelto: iso(d.ahora()) })
        if (bajaId) await almacen.marcarPaso(bajaId, 'despedida', paso('error', m))
        r.errores.push(`${p.cliente}: no salió la despedida (${m}); no se lo sacó de los grupos`)
        await responder('baja_quitar_grupos', `No salió la despedida a ${p.cliente} (${m}), así que no lo saqué de los grupos. Se puede mandar a mano y después responder "OK sin mensaje".`, x.mensajeId)
        if (!real('baja_quitar_grupos')) await responder('baja_mensaje_cliente', `No salió la despedida a ${p.cliente} (${m}).`, x.mensajeId)
        return
      }
    } else if (bajaId) await almacen.marcarPaso(bajaId, 'despedida', paso('omitido', `"OK sin mensaje" de ${por}`))
    // 2. DESPUÉS sacarlo de los grupos. Revalidar porque la espera permite que el equipo archive al cliente.
    if (d.clienteOperativo && !await d.clienteOperativo(p.idCrm, p.cliente)) { r.ignorados++; return }
    let gruposOk = false
    if (real('baja_quitar_grupos')) {
      const q = await quitarDeGrupos(grupos)
      r.quitados += q.quitados
      gruposOk = q.estado === 'hecho'
      if (bajaId) await almacen.marcarPaso(bajaId, 'grupos', paso(q.estado, q.detalle))
      if (q.estado !== 'hecho') r.errores.push(`${p.cliente}: grupos — ${q.detalle}`)
      resumen.push(`Grupos: ${q.detalle}`)
    } else {
      if (bajaId) await almacen.marcarPaso(bajaId, 'grupos', paso('omitido', 'sin la capacidad baja_quitar_grupos'))
      resumen.push('Grupos: sacarlo a mano (baja_quitar_grupos apagada)')
    }
    // 3. Ronda 2: SIEMPRE al final (después de la despedida y de sacarlo de los grupos) se elimina su comunidad con Avisos
    if (real('baja_eliminar_comunidad')) {
      const m = await eliminarComunidadDe(p, gruposOk)
      if (bajaId) await almacen.marcarPaso(bajaId, 'comunidad', paso(m.estado, m.detalle))
      if (m.estado === 'error' || m.estado === 'dudoso') r.errores.push(`${p.cliente}: comunidad — ${m.detalle}`)
      resumen.push(`Comunidad: ${m.detalle}`)
    } else if (bajaId) await almacen.marcarPaso(bajaId, 'comunidad', paso('omitido', 'sin la capacidad baja_eliminar_comunidad'))
    await almacen.actualizarPedido(p.id, { estado: 'enviado', resuelto: iso(d.ahora()) })
    r.registro.push(`despedida de ${p.cliente}: ${resumen.join(' · ')}`)
    const cap: CapacidadBaja = real('baja_quitar_grupos') ? 'baja_quitar_grupos' : 'baja_mensaje_cliente'
    await responder(cap, `Listo con ${p.cliente}.\n${resumen.join('\n')}`, x.mensajeId)
  }

  // ── Webhook ──
  async function aplicarRespuesta(r: ResumenBajas, x: RespuestaBaja) {
    const p = await almacen.pedidoPorMensaje(x.citado)
    if (!p) return   // cita otra cosa (un alta, un pedido de Éxito): no es de esta etapa
    const lista = p.tipo === 'despedida' ? c.despedida : c.aprobadores
    if (!enLista(x.autor, lista)) { r.ignorados++; r.registro.push(`respuesta al pedido ${p.tipo} de ${p.cliente} de alguien que no puede aprobarlo: se ignora`); return }
    if (p.estado !== 'abierto') { r.ignorados++; return }
    if (d.clienteOperativo && !await d.clienteOperativo(p.idCrm, p.cliente)) { r.ignorados++; return }
    if (p.tipo === 'aviso_fin') return aprobarAvisoFin(r, p, x)
    if (p.tipo === 'confirmar_baja') return aprobarBaja(r, p, x)
    if (p.tipo === 'pausar_meta') return aprobarPausarMeta(r, p, x)
    return aprobarDespedida(r, p, x)
  }

  async function procesarEventos(cands: CandidatosBajas): Promise<ResumenBajas> {
    const r = vacio(c.modo)
    if (c.modo === 'seco') { r.registro.push(`seco: ${cands.respuestas.length} respuesta(s) en Verificaciones: no se mira nada`); return r }
    for (const e of cands.ecos) {
      try {
        const p = await almacen.pedidoSinIdPorHuella(huellaTexto(e.texto), iso(Date.parse(e.enviadoEn) - 3600_000))
        if (p && (await almacen.actualizarPedido(p.id, { mensajePedidoId: e.mensajeId }, ['abierto']))) { r.ecos++; r.registro.push(`eco: pedido ${p.tipo} de ${p.cliente} con su id`) }
      } catch (err) { r.errores.push(`eco ${e.mensajeId}: ${motivoDe(err)}`) }
    }
    for (const x of cands.respuestas) {
      try { await aplicarRespuesta(r, x) } catch (err) { r.errores.push(`respuesta ${x.mensajeId}: ${motivoDe(err)}`) }
    }
    return r
  }

  // ── Cron diario ──
  async function recontacto(r: ResumenBajas, clientes: ClienteBaja[], forzar: boolean) {
    const h = hoy()
    if (!forzar && Number(h.slice(8, 10)) !== c.diaRecontacto) return
    const mes = h.slice(0, 7)
    const permitido = real('baja_recontacto') || ensayo('baja_recontacto')
    const controles = await Promise.all(clientes.map(k => d.clienteOperativo ? d.clienteOperativo(k.id, k.nombre) : true))
    const permitidos = clientes.filter((_, i) => controles[i])
    const cands = historicosParaRecontacto(permitidos, h)
    if (!permitido) { r.registro.push(`haría: publicar la lista de recontacto de ${mes} (${cands.length} histórico(s); sin la capacidad baja_recontacto)`); return }
    const puntajes = d.puntajes ? await d.puntajes(clientes).catch(() => new Map<string, number>()) : new Map<string, number>()
    const motivos = await almacen.motivosDeBaja()
    const lista: Historico[] = cands.map((x) => ({
      cliente: x.cliente.nombre, seFue: x.seFue, dias: x.dias,
      puntaje: puntajes.get(x.cliente.id.toUpperCase()) ?? x.cliente.satisfaccion ?? null,
      motivo: motivos.get(x.cliente.id.toUpperCase()) ?? null,
    })).sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1) || a.dias - b.dias).slice(0, MAX_RECONTACTO)
    const clave = c.modo === 'real' ? mes : `ensayo:${mes}`
    if (!(await almacen.reclamarRecontacto({ mes: clave, modo: c.modo, cantidad: lista.length, creado: iso(d.ahora()) }))) return
    if (!lista.length) { await almacen.actualizarRecontacto(clave, { estado: 'vacio' }); r.registro.push(`recontacto ${mes}: no hay históricos para recontactar`); return }
    if (c.modo === 'ensayo') {
      await salir(true, c.verificaciones, `La lista de recontacto de ${mes} tendría ${lista.length} histórico(s): ${lista.slice(0, 8).map((x) => x.cliente).join(', ')}${lista.length > 8 ? '…' : ''} (no se publicó en Discord).`)
      await almacen.actualizarRecontacto(clave, { estado: 'simulado' })
      r.registro.push(`recontacto ${mes}: SIMULACIÓN (${lista.length})`)
      return
    }
    if (!d.discord) { r.errores.push('falta DISCORD_WEBHOOK_CLIENTES: no se publicó la lista de recontacto'); await almacen.actualizarRecontacto(clave, { estado: 'error' }); return }
    try {
      const id = await d.discord(textosRecontacto(mes, lista), [])
      await almacen.actualizarRecontacto(clave, { estado: 'publicado', discordIds: id ? [id] : [] })
      r.recontactos += lista.length
      r.registro.push(`recontacto ${mes}: ${lista.length} histórico(s) en #🤝-exito-y-bajas`)
    } catch (e) {
      await almacen.actualizarRecontacto(clave, { estado: 'error' })
      r.errores.push(`no salió la lista de recontacto (${motivoDe(e)})`)
    }
  }

  async function correrDiario(op: { forzarRecontacto?: boolean } = {}): Promise<ResumenBajas> {
    const r = vacio(c.modo)
    if (c.modo === 'seco') { r.registro.push('seco: no se lee el CRM y no sale nada'); return r }
    try {
      for (const p of await almacen.pedidosAbiertosAntesDe(iso(d.ahora() - VENCE_PEDIDO_MS))) {
        if (await almacen.actualizarPedido(p.id, { estado: 'vencido', resuelto: iso(d.ahora()) }, ['abierto'])) {
          r.vencidos++
          r.registro.push(`venció el pedido ${p.tipo} de ${p.cliente} (14 días sin respuesta)`)
          const bajaId = String(p.detalle.bajaId ?? '')
          if (p.tipo === 'despedida' && bajaId) await almacen.marcarPaso(bajaId, 'despedida', paso('omitido', 'venció el pedido (14 días sin respuesta)'))
        }
      }
    } catch (e) { r.errores.push(`vencer pedidos: ${motivoDe(e)}`) }
    let clientes: ClienteBaja[]
    try { clientes = await d.leerClientes() } catch (e) { r.errores.push(`no se pudo leer el CRM (${motivoDe(e)})`); return r }
    try { await avisosFin(r, clientes) } catch (e) { r.errores.push(`avisos de fin: ${motivoDe(e)}`) }
    try { await recontacto(r, clientes, !!op.forzarRecontacto) } catch (e) { r.errores.push(`recontacto: ${motivoDe(e)}`) }
    return r
  }

  return { procesarEventos, procesarLlamada, pedirBajaManual, correrDiario }
}

export type { NombrePaso }
