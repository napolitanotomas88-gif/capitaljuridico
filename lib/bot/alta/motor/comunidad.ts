// ── Bot "Capital Jurídico": paso 5, la comunidad de WhatsApp del cliente (diseño del motor, sección 3.7) ───────────────
// Comunidad "<Nombre> - C.J" con 3 grupos (General, Ventas, Contenido), fotos, participantes y links de invitación.
// Todo con ClienteWhapi (BLOQUE W) y guardando cada id en `parcial` APENAS Whapi lo devuelve: lo que tiene id no se vuelve a
// crear. Cambios de la revisión:
//   · WhatsApp puede crear el grupo "General" solo (general_chat: true en los subgrupos): se usa ese en vez de crear otro
//     (punto 4);
//   · un intento sin respuesta (o un paso 'corriendo' de una invocación que murió) se trata como dudoso en CADA creación:
//     antes de crear de nuevo se busca lo que pudo haber quedado (GET /communities con nombre exacto y fecha; los subgrupos
//     por título). Si no se puede confirmar, pregunta en Verificaciones C.J (ok_dudoso) (punto 5);
//   · los participantes que no entran no se fuerzan: van en el aviso a Aylu con los links (punto 33). El OK de Aylu se pide
//     "cuando el cliente ya esté adentro": la bienvenida sale con ese OK.
// Antibaneo: pausa al azar de 2 a 6 s entre escrituras; como mucho maxComunidadesDia comunidades en 24 h; ante un 429,
// pausa global de 24 h (recurso whapi_pausa). No se le escribe por privado al cliente.
// A CONFIRMAR CON AYLU (decisión 3): el nombre de los grupos y la descripción de la comunidad.
//
// WhatsApp seguro (26/10/2026: WhatsApp suspendió el número del bot horas después de sumar clientes directo a sus grupos).
// POR DEFECTO, sin ninguna variable:
//   · la comunidad y los 3 grupos se arman SOLO con el equipo (y el closer en General). Al cliente y a los socios el bot NO
//     los suma, ni los verifica (POST /contacts), ni los agenda (PUT /contacts): desde un número nuevo, escribirle o sumar a
//     desconocidos es lo que dispara el ban;
//   · el link de invitación del General (GET /groups/{id}/invite) le llega al closer en Ventas C.J, citando su #ALTA:
//     "Pasale este link a <Nombre> para que entre a su grupo: <link>";
//   · la bienvenida sale cuando el cliente entra al General: el webhook de Whapi (groups_participants, evento 'ingreso')
//     resuelve solo la espera de Aylu. Si ese evento no llega, Aylu responde OK cuando lo vea adentro (o manda la
//     bienvenida a mano). El id del General queda indexado en cj_altas_recursos ('general:<id>') para encontrar el alta;
//   · ritmo: entre crear la comunidad y cada grupo pasan de 20 a 40 s al azar (nada de ráfagas); si no entra en la
//     invocación, sigue en otra respetando la pausa (`ultimaCreacion`);
//   · tope: como mucho maxComunidadesDia (BOT_ALTA_MAX_COMUNIDADES_DIA, en Vercel 2) en 24 h. El exceso queda en
//     'reintento' hasta que se libera el cupo (al día siguiente), nunca fallado. El chequeo y la creación van bajo el
//     candado 'comunidad_cupo' para que dos altas a la vez no se pasen del tope.
// El modo viejo (sumar al cliente y a los socios directo) queda detrás de BOT_COMUNIDAD_AGREGAR_DIRECTO=si (apagado).
// Cualquier escritura pasa además por la guardia de salud del número (lib/bot/whapi/salud.ts): con el número caído el paso
// queda en reintento con el motivo "número del bot desconectado o suspendido".
import { telefonos } from '../parsear'
import { GRUPOS_COMUNIDAD } from '../plan'
import { telefonoDelCliente } from '../crm'
import { nombreCliente } from '../nombreCliente'
import type { CtxPaso } from './contexto'
import { restante } from './contexto'
import type { SalidaPaso } from './estado'
import { textoLinkCloser, textoPedidoEquipo } from './mensajes'
import { altaParseada, revisarCon } from './pasos'
import type { GrupoWhapi } from './tipos'
import { MOTIVO_SIN_NUMERO } from './tipos'

export type NombreGrupo = 'General' | 'Ventas' | 'Contenido'
export const NOMBRES_GRUPOS: readonly NombreGrupo[] = ['General', 'Ventas', 'Contenido']
export const nombreComunidad = (cliente: string) => `${cliente} - C.J`
export const nombreGrupo = (g: NombreGrupo, cliente: string) => `${g} - ${cliente}`
export const descripcionComunidad = (cliente: string) => `Comunidad de ${cliente} con Capital Jurídico: General, Ventas y Contenido.`
const PAUSA_429_MS = 24 * 3600_000
const VENTANA_DIA_MS = 24 * 3600_000
/** Ritmo (WhatsApp seguro): pausa al azar entre crear la comunidad y un grupo, y entre un grupo y otro. */
export const ENTRE_CREACIONES_MIN_MS = 20_000
export const ENTRE_CREACIONES_MAX_MS = 40_000
/** Reintento cuando la guardia de salud frenó una escritura (número caído o suspendido). */
export const REINTENTO_SIN_NUMERO_MS = 10 * 60_000
const CANDADO_CUPO = 'comunidad_cupo'
/** Índice grupo General → alta, para el evento 'ingreso' del webhook (el cliente entró por el link). */
export const recursoGeneral = (grupoId: string) => `general:${grupoId}`

interface GrupoGuardado { id: string; invitacion: string | null; fallidos: string[] }
interface ParcialComunidad {
  verificados?: boolean
  agendados?: boolean
  comunidadId?: string
  avisosId?: string | null
  intentoComunidad?: string | null      // ISO: hubo un crearComunidad sin id guardado
  intentoGrupo?: Partial<Record<NombreGrupo, string>>
  grupos?: Partial<Record<'general' | 'ventas' | 'contenido', GrupoGuardado>>
  fotos?: Partial<Record<NombreGrupo | 'comunidad', boolean>>
  pendientes?: string[]
  invalidos?: string[]
  /** El General que creó WhatsApp solo: su id se guarda ANTES de renombrarlo y sumar a la gente (revisión del 24/10). */
  generalAuto?: { renombrado: boolean; agregados: boolean }
  /** El equipo respondió OK a un dudoso ("ya existe"): se busca y se sigue con lo demás, sin crearlo de nuevo. */
  existeConfirmado?: Partial<Record<NombreGrupo | 'comunidad', boolean>>
  /** ISO de la última creación (comunidad o grupo): el ritmo de 20 a 40 s se respeta aunque siga en otra invocación. */
  ultimaCreacion?: string | null
  /** Modo seguro: cómo quedó el mensaje al closer con el link del General ('enviado', 'dudoso', 'simulado', 'fallido'). */
  linkCloser?: string | null
}
const clave = (g: NombreGrupo) => g.toLowerCase() as 'general' | 'ventas' | 'contenido'
const tipoDe = (e: unknown) => ((e as { name?: string })?.name === 'ErrorWhapi' ? ((e as { tipo?: string }).tipo ?? null) : null)
const motivo = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)
const iso = (ms: number) => new Date(ms).toISOString()

/** La comunidad que ya armó un Fee anterior de la cadena (altaAnterior → altaAnterior…, hasta 10): con un Fee en formato
 *  libre se crea la comunidad (Tomás, 26/10/2026), así que el alta que completa la primera cuota usa esa y no arma otra. */
async function comunidadDeLaCadena(ctx: CtxPaso): Promise<{ altaId: string; resultado: unknown; parcial: Record<string, unknown> | null } | null> {
  let id = ctx.alta.altaAnterior
  for (let i = 0; id && i < 10; i++) {
    const p = (await ctx.almacen.leerPasos(id)).comunidad
    if (p.estado === 'hecho' && p.resultado) return { altaId: id, resultado: p.resultado, parcial: p.parcial }
    id = (await ctx.almacen.leerAlta(id))?.altaAnterior ?? null
  }
  return null
}

export async function pasoComunidad(ctx: CtxPaso): Promise<SalidaPaso> {
  const alta = ctx.alta, a = altaParseada(alta)
  if (alta.altaAnterior) {
    const previa = await comunidadDeLaCadena(ctx)
    if (previa) {
      return {
        estado: 'hecho', resultado: { ...(previa.resultado as object), heredadaDe: previa.altaId }, ...(previa.parcial ? { parcial: previa.parcial } : {}),
        registro: [`la comunidad ya la armó el Fee ${previa.altaId}: se usa esa`],
      }
    }
  }
  const cliente = nombreCliente(a.nombre) || 'Cliente'
  const telCliente = telefonoDelCliente(a)?.numero ?? null
  const socios = a.socios ? telefonos(a.socios).map((t) => t.numero).filter((n) => n !== telCliente) : []
  const delCliente = [...(telCliente ? [telCliente] : []), ...socios]
  // WhatsApp seguro: al cliente y a los socios solo se los suma directo con BOT_COMUNIDAD_AGREGAR_DIRECTO=si
  const directo = ctx.deps.agregarDirecto === true
  const sumarCliente = directo ? delCliente : []
  const equipoDe = (g: NombreGrupo) => (GRUPOS_COMUNIDAD.find((x) => x.nombre === g)?.equipo ?? []).filter((n) => n !== 'Capital Jurídico')
  const faltanTel = [...new Set(NOMBRES_GRUPOS.flatMap(equipoDe))].filter((n) => !ctx.deps.equipo[n])
  // El closer (el que mandó el #ALTA) entra solo a General (Tomás, 25/10/2026)
  const telCloser = alta.autor?.telefono?.replace(/\D/g, '') || null
  const miembros = (g: NombreGrupo) => [...new Set([
    ...equipoDe(g).map((n) => ctx.deps.equipo[n]).filter(Boolean),
    ...(g === 'General' && telCloser ? [telCloser] : []),
    ...sumarCliente,
  ])]

  if (!ctx.real) {
    return {
      estado: 'simulado', resultado: { comunidad: nombreComunidad(cliente), grupos: NOMBRES_GRUPOS.map((g) => ({ nombre: nombreGrupo(g, cliente), miembros: miembros(g).length })) },
      registro: [`armaría la comunidad "${nombreComunidad(cliente)}" con ${NOMBRES_GRUPOS.map((g) => `${g} (${miembros(g).length} personas)`).join(', ')}${directo ? ' (sumando al cliente directo)' : ' (solo el equipo: el link del General va al closer)'}${faltanTel.length ? `; sin teléfono: ${faltanTel.join(', ')}` : ''}`],
    }
  }
  if (directo && !telCliente) return revisarCon('comunidad', alta, 'el #ALTA no trae el teléfono del cliente')

  // Pausa global por un 429
  const pausa = await ctx.almacen.leerRecurso('whapi_pausa')
  const pausaHasta = pausa?.datos && typeof pausa.datos.hasta === 'string' ? Date.parse(pausa.datos.hasta) : 0
  if (pausaHasta > ctx.ahora()) return { estado: 'reintento', noAntesDe: iso(pausaHasta), error: 'Whapi en pausa por un 429' }

  const p: ParcialComunidad = JSON.parse(JSON.stringify(ctx.paso.parcial ?? {}))
  p.grupos ??= {}; p.fotos ??= {}; p.intentoGrupo ??= {}; p.pendientes ??= []
  const guardar = async (x: Partial<ParcialComunidad>) => { Object.assign(p, x); await ctx.guardarParcial(x as Record<string, unknown>) }
  let escrituras = 0
  const escribir = async <T>(f: () => Promise<T>): Promise<T> => {
    if (escrituras++ > 0) await ctx.deps.esperar(2000 + Math.round(ctx.deps.azar() * 4000))
    return f()
  }
  const conTiempo = () => restante(ctx) > 25_000
  const otraVez = (): SalidaPaso => ({ estado: 'reintento', noAntesDe: iso(ctx.ahora()), otraInvocacion: true, parcial: p as Record<string, unknown>, error: 'sigue en otra invocación (plazo)' })
  const ante = async (e: unknown, que: string): Promise<SalidaPaso> => {
    const t = tipoDe(e)
    if (t === 'soft_ban') {
      const hasta = iso(ctx.ahora() + PAUSA_429_MS)
      await ctx.almacen.guardarDatosRecurso('whapi_pausa', { hasta, por: alta.id })
      return { estado: 'reintento', noAntesDe: hasta, error: `${que}: Whapi pidió descansar el número (429): pausa de 24 h`, avisos: [`Whapi pidió descansar el número (429) al armar la comunidad de ${cliente}: el bot no escribe nada por 24 h.`] }
    }
    if (t === 'sin_numero') return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + REINTENTO_SIN_NUMERO_MS), parcial: p as Record<string, unknown>, error: `${que}: ${MOTIVO_SIN_NUMERO}` }
    if (t === 'auth') return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + 3600_000), error: `${que}: la sesión de WhatsApp del bot se cayó (401)` }
    if (t === 'pasajero') return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + 300_000), error: `${que}: ${motivo(e)}` }
    return revisarCon('comunidad', alta, `${que}: ${motivo(e)}`)
  }
  const dudoso = (que: string, buscar: string): SalidaPaso => ({
    estado: 'espera', dudoso: true, parcial: p as Record<string, unknown>, error: `${que}: no se sabe si quedó hecho`,
    esperas: [{
      paso: 'comunidad', motivo: 'dudoso', tipos: ['ok_dudoso'], grupo: 'verificaciones', quien: 'equipo', requiere: [], pedido: [`Buscar "${buscar}" en WhatsApp`],
      datos: { que },
      texto: textoPedidoEquipo({ nombre: cliente, titulo: `no sé si quedó creado "${buscar}" (${que}): Whapi no respondió.`, detalle: ['Mirá en el WhatsApp del bot si existe.'], ok: 'ya existe (el bot lo busca y sigue con lo demás sin crearlo de nuevo)', no: 'no existe: crearlo de nuevo' }),
    }],
  })
  /** Errores que frenan el paso entero (no se sigue escribiendo con el número en riesgo). */
  const frena = (e: unknown) => ['soft_ban', 'auth', 'sin_numero'].includes(tipoDe(e) ?? '')
  /** Ritmo: espera lo que falte de la pausa de 20 a 40 s desde la última creación; si no entra, sigue en otra invocación. */
  const ritmo = async (): Promise<SalidaPaso | null> => {
    if (!p.ultimaCreacion) return null
    const pausa = ENTRE_CREACIONES_MIN_MS + Math.round(ctx.deps.azar() * (ENTRE_CREACIONES_MAX_MS - ENTRE_CREACIONES_MIN_MS))
    const falta = Date.parse(p.ultimaCreacion) + pausa - ctx.ahora()
    if (falta <= 0) return null
    if (restante(ctx) < falta + 25_000) return { ...otraVez(), noAntesDe: iso(ctx.ahora() + falta) }
    await ctx.deps.esperar(falta)
    return null
  }
  /** El tope diario: cuántas comunidades se crearon en las últimas 24 h y cuándo se libera el cupo. */
  const cupo = async (): Promise<SalidaPaso | null> => {
    const r = await ctx.almacen.leerRecurso('comunidades')
    const creadas = ((r?.datos?.creadas as string[] | undefined) ?? []).filter((x) => ctx.ahora() - Date.parse(x) < VENTANA_DIA_MS)
    if (creadas.length < ctx.deps.maxComunidadesDia) return null
    const libre = Math.min(...creadas.map((x) => Date.parse(x))) + VENTANA_DIA_MS
    return { estado: 'reintento', noAntesDe: iso(libre), parcial: p as Record<string, unknown>, error: `ya se crearon ${creadas.length} comunidades en 24 h (tope ${ctx.deps.maxComunidadesDia}): espera al día siguiente` }
  }
  const existe = p.existeConfirmado ?? {}
  // OK a un dudoso, pero el bot no lo encuentra: no se crea otro; lo arma el equipo a mano
  const noLoEncuentro = (titulo: string) => revisarCon('comunidad', alta, `el equipo confirmó que "${titulo}" existe, pero el bot no lo encuentra: terminá la comunidad a mano (grupos, fotos y gente) y, si es el General, mandá la bienvenida a mano`)

  // 0. Tope diario de comunidades nuevas (antes de la primera escritura de la comunidad; se vuelve a mirar bajo el candado)
  if (!p.comunidadId) {
    const lleno = await cupo()
    if (lleno) return lleno
  }

  // 1 y 2. Números válidos y agendados: SOLO en el modo directo (en el seguro al cliente no se lo toca)
  if (directo && !p.verificados) {
    try {
      const v = await ctx.whapi.verificarNumeros(delCliente)
      const invalidos = Object.entries(v).filter(([, x]) => x === 'invalido').map(([n]) => n)
      await guardar({ verificados: true, invalidos })
      if (invalidos.length) p.pendientes.push(`Sin WhatsApp: ${invalidos.map((n) => `+${n}`).join(', ')}`)
    } catch (e) { if (frena(e)) return ante(e, 'verificar números') }
  }
  if (directo && !p.agendados) {
    for (const n of delCliente) {
      try { await escribir(() => ctx.whapi.agendarContacto({ telefono: n, nombre: n === telCliente ? `${cliente} (cliente C.J)` : `Socio de ${cliente} (C.J)` })) } catch (e) { if (frena(e)) return ante(e, 'agendar contacto') }
    }
    await guardar({ agendados: true })
  }

  // 3. La comunidad
  if (!p.comunidadId) {
    if (p.intentoComunidad || ctx.huboCorriendo) {
      const desde = iso(Date.parse(p.intentoComunidad ?? ctx.iniciadoAnterior ?? ctx.paso.iniciado ?? iso(ctx.ahora())) - 60_000)
      let encontrada: GrupoWhapi | null = null
      if (ctx.whapi.buscarComunidades) {
        try { encontrada = (await ctx.whapi.buscarComunidades({ nombre: nombreComunidad(cliente), desde }))[0] ?? null } catch { encontrada = null }
        if (!encontrada && p.intentoComunidad) return existe.comunidad ? noLoEncuentro(nombreComunidad(cliente)) : dudoso('crear la comunidad', nombreComunidad(cliente))
      } else if (p.intentoComunidad) {
        return existe.comunidad ? noLoEncuentro(nombreComunidad(cliente)) : dudoso('crear la comunidad', nombreComunidad(cliente))
      }
      if (encontrada) await guardar({ comunidadId: encontrada.id, intentoComunidad: null })
    }
  }
  if (!p.comunidadId) {
    // El chequeo del tope y la creación, bajo un candado: dos altas a la vez no pasan las dos con un solo lugar libre
    if (!(await ctx.almacen.tomarRecurso(CANDADO_CUPO, ctx.dueno, 120_000))) {
      return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + 60_000), parcial: p as Record<string, unknown>, error: 'otra alta está creando su comunidad: sigue en un minuto' }
    }
    try {
      const lleno = await cupo()
      if (lleno) return lleno
      await guardar({ intentoComunidad: iso(ctx.ahora()) })
      try {
        const c = await escribir(() => ctx.whapi.crearComunidad({ nombre: nombreComunidad(cliente), descripcion: descripcionComunidad(cliente) }))
        await guardar({ comunidadId: c.id, intentoComunidad: null, ultimaCreacion: iso(ctx.ahora()) })
        const r = await ctx.almacen.leerRecurso('comunidades')
        const creadas = ((r?.datos?.creadas as string[] | undefined) ?? []).filter((x) => ctx.ahora() - Date.parse(x) < VENTANA_DIA_MS)
        await ctx.almacen.guardarDatosRecurso('comunidades', { creadas: [...creadas, iso(ctx.ahora())] })
      } catch (e) {
        if (tipoDe(e) === 'dudoso') return dudoso('crear la comunidad', nombreComunidad(cliente))
        if (tipoDe(e) === 'bloqueado' || (e as { aplicado?: unknown })?.aplicado === false) await guardar({ intentoComunidad: null })
        return ante(e, 'crear la comunidad')
      }
    } finally {
      await ctx.almacen.soltarRecurso(CANDADO_CUPO, ctx.dueno).catch(() => {})
    }
  }
  const comunidadId = p.comunidadId as string

  // 4. Subgrupos: Avisos y, si WhatsApp lo creó solo, el General. La lectura va sola en su try: las escrituras sobre el
  // General automático van aparte y su id se guarda ANTES (revisión del 24/10: si sumar a la gente fallaba, el catch lo
  // anotaba como "no se pudieron leer los subgrupos", el id no se guardaba y el paso 5 creaba OTRO "General - X")
  let otros: GrupoWhapi[] = []
  try {
    const s = await ctx.whapi.subgruposComunidad(comunidadId)
    otros = s.otros
    if (p.avisosId === undefined) await guardar({ avisosId: s.avisos?.id ?? null })
    const general = s.otros.find((g) => g.generalChat)
    if (general && !p.grupos.general) {
      await guardar({ grupos: { ...p.grupos, general: { id: general.id, invitacion: general.codigoInvitacion, fallidos: [] } }, generalAuto: { renombrado: false, agregados: false } })
    }
  } catch (e) {
    if (frena(e)) return ante(e, 'leer los subgrupos')
    p.pendientes.push(`No se pudieron leer los subgrupos de la comunidad (${motivo(e)})`)
  }
  if (p.generalAuto && p.grupos.general) {
    const gid = p.grupos.general.id
    if (!p.generalAuto.renombrado) {
      try { await escribir(() => ctx.whapi.cambiarInfoGrupo({ grupoId: gid, nombre: nombreGrupo('General', cliente) })) } catch (e) {
        if (frena(e)) return ante(e, 'renombrar el General')
        p.pendientes.push(`El grupo General que creó WhatsApp: cambiale el nombre a "${nombreGrupo('General', cliente)}" (${motivo(e)})`)
      }
      await guardar({ generalAuto: { ...p.generalAuto, renombrado: true }, pendientes: p.pendientes })
    }
    if (!p.generalAuto.agregados) {
      let fallidos: string[] = []
      try {
        // Modo seguro: solo el equipo y el closer (el cliente entra por el link)
        if (miembros('General').length) fallidos = (await escribir(() => ctx.whapi.agregarParticipantes({ grupoId: gid, participantes: miembros('General') }))).fallidos
        else p.pendientes.push('El General no tiene a nadie del equipo con teléfono (BOT_ALTA_EQUIPO_TELEFONOS): sumalos a mano')
      } catch (e) {
        const t = tipoDe(e)
        if (frena(e)) return ante(e, 'sumar gente al General')
        if (t === 'dudoso') p.pendientes.push('No sé si se sumó la gente al General (Whapi no respondió): revisalo')
        else if (t !== 'ya_existe') { fallidos = miembros('General'); p.pendientes.push(`No se pudo sumar la gente al General (${motivo(e)})`) }
      }
      await guardar({ grupos: { ...p.grupos, general: { ...p.grupos.general, fallidos } }, generalAuto: { ...p.generalAuto, agregados: true }, pendientes: p.pendientes })
    }
  }

  // 5. Los grupos que faltan
  for (const g of NOMBRES_GRUPOS) {
    if (p.grupos[clave(g)]) continue
    if (!conTiempo()) return otraVez()
    const titulo = nombreGrupo(g, cliente)
    if (p.intentoGrupo[g]) {
      const ya = otros.find((x) => x.nombre === titulo)
      if (ya) {
        // Si lo confirmó el equipo, no se sabe si entraron todos: va en el aviso a Aylu
        if (existe[g]) p.pendientes.push(`"${titulo}": lo encontré, pero revisá que estén todos (no sé si se sumó la gente)`)
        await guardar({ grupos: { ...p.grupos, [clave(g)]: { id: ya.id, invitacion: ya.codigoInvitacion, fallidos: [] } }, pendientes: p.pendientes }); continue
      }
      return existe[g] ? noLoEncuentro(titulo) : dudoso(`crear el grupo ${g}`, titulo)
    }
    if (!miembros(g).length) return revisarCon('comunidad', alta, `el grupo ${g} no tiene a nadie del equipo con teléfono (BOT_ALTA_EQUIPO_TELEFONOS): crealo a mano o cargá los teléfonos`)
    // Ritmo: 20 a 40 s desde la última creación (nada de ráfagas)
    const pausa = await ritmo()
    if (pausa) return pausa
    await guardar({ intentoGrupo: { ...p.intentoGrupo, [g]: iso(ctx.ahora()) } })
    try {
      const r = await escribir(() => ctx.whapi.crearGrupoEnComunidad({ comunidadId, nombre: titulo, participantes: miembros(g) }))
      const { [g]: _hecho, ...resto } = p.intentoGrupo
      void _hecho
      await guardar({ grupos: { ...p.grupos, [clave(g)]: { id: r.id, invitacion: r.codigoInvitacion, fallidos: r.fallidos } }, intentoGrupo: resto, ultimaCreacion: iso(ctx.ahora()) })
    } catch (e) {
      if (tipoDe(e) === 'dudoso') return dudoso(`crear el grupo ${g}`, titulo)
      if ((e as { aplicado?: unknown })?.aplicado === false) { const { [g]: _x, ...resto } = p.intentoGrupo; void _x; await guardar({ intentoGrupo: resto }) }
      return ante(e, `crear el grupo ${g}`)
    }
  }

  // 6 y 7. Fotos (una que falla no frena: queda para Aylu)
  for (const g of [...NOMBRES_GRUPOS, 'comunidad' as const]) {
    if (p.fotos[g]) continue
    const foto = ctx.deps.fotos[g]
    if (!foto) { p.pendientes.push(`Foto de ${g === 'comunidad' ? 'la comunidad' : `"${g}"`}: no está configurada`); await guardar({ fotos: { ...p.fotos, [g]: true } }); continue }
    if (!conTiempo()) return otraVez()
    const grupoId = g === 'comunidad' ? comunidadId : p.grupos[clave(g)]!.id
    try { await escribir(() => ctx.whapi.ponerFoto({ grupoId, foto })) } catch (e) {
      if (frena(e)) return ante(e, 'poner la foto')
      p.pendientes.push(`Foto de ${g === 'comunidad' ? 'la comunidad' : `"${g}"`}: ponela a mano (${motivo(e)})`)
    }
    await guardar({ fotos: { ...p.fotos, [g]: true } })
  }

  // 8. Links de invitación
  for (const g of NOMBRES_GRUPOS) {
    const x = p.grupos[clave(g)]!
    if (x.invitacion) continue
    try {
      const link = await ctx.whapi.linkInvitacion(x.id)
      await guardar({ grupos: { ...p.grupos, [clave(g)]: { ...x, invitacion: link } } })
    } catch (e) {
      if (frena(e)) return ante(e, `leer el link de "${g}"`)
      p.pendientes.push(`Link de "${g}": no se pudo leer (${motivo(e)})`)
    }
  }
  const link = (x: GrupoGuardado) => (x.invitacion ? (x.invitacion.startsWith('http') ? x.invitacion : `https://chat.whatsapp.com/${x.invitacion}`) : '(sin link)')

  // 8 bis. Modo seguro: el link del General al closer, en Ventas C.J y citando su #ALTA. Y el índice General → alta, para que
  // el webhook reconozca cuando el cliente entra (evento 'ingreso')
  if (!directo) {
    const general = p.grupos.general!
    await ctx.almacen.guardarDatosRecurso(recursoGeneral(general.id), { altaId: alta.id, cliente: telCliente, socios }).catch(() => {})
    if (!p.linkCloser) {
      if (!general.invitacion) {
        p.pendientes.push('No pude sacar el link del General: pasáselo vos al closer para que se lo mande al cliente')
        await guardar({ linkCloser: 'sin_link', pendientes: p.pendientes })
      } else {
        const citar = alta.mensajesAlta?.[alta.mensajesAlta.length - 1] ?? alta.mensajeAltaId ?? null
        const r = await ctx.enviar({ proposito: 'comunidad:link_closer', destino: { grupo: 'ventas' }, tipo: 'texto', texto: textoLinkCloser(a.nombre ? cliente : null, link(general)), citar })
        if (r.estado === 'pausado') return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + (r.motivo ? REINTENTO_SIN_NUMERO_MS : 3600_000)), parcial: p as Record<string, unknown>, error: `link al closer: ${r.motivo ?? 'Whapi en pausa (429)'}` }
        if (r.estado === 'error' && ['soft_ban', 'auth', 'sin_numero'].includes(r.tipo ?? '')) {
          return { estado: 'reintento', noAntesDe: iso(ctx.ahora() + (r.tipo === 'soft_ban' ? PAUSA_429_MS : 3600_000)), parcial: p as Record<string, unknown>, error: `link al closer: ${r.motivo}` }
        }
        if (r.estado === 'error') p.pendientes.push(`No le llegó al closer el link del General (${r.motivo}): pasáselo vos`)
        if (r.estado === 'simulado') p.pendientes.push('El link del General no se le mandó al closer (el bot no tiene "mensajes_equipo"): pasáselo vos')
        if (r.estado === 'dudoso') p.pendientes.push('No sé si le llegó al closer el link del General: fijate en Ventas C.J.')
        await guardar({ linkCloser: r.estado === 'ya_enviado' ? 'enviado' : r.estado, pendientes: p.pendientes })
      }
    }
  }

  // 9. OK de Aylu (frena la bienvenida)
  const detalle = [
    ...NOMBRES_GRUPOS.map((g) => { const x = (p.grupos ?? {})[clave(g)]!; return `${g}: ${link(x)}${x.fallidos.length ? ` — no entraron: ${x.fallidos.map((n) => `+${n}`).join(', ')}` : ''}` }),
    ...(faltanTel.length ? [`Sin teléfono en BOT_ALTA_EQUIPO_TELEFONOS: ${faltanTel.join(', ')}`] : []),
    ...new Set(p.pendientes),
  ]
  const resultado = { comunidadId, avisosId: p.avisosId ?? null, grupos: p.grupos, pendientes: p.pendientes }
  return {
    estado: 'espera', resultado, parcial: p as Record<string, unknown>,
    esperas: [{
      paso: 'comunidad', motivo: 'comunidad', tipos: ['ok_comunidad'], grupo: 'verificaciones', quien: 'operaciones', requiere: [], pedido: ['Revisar la comunidad y que el cliente esté adentro'],
      texto: directo
        ? textoPedidoEquipo({ nombre: cliente, titulo: `quedó armada la comunidad "${nombreComunidad(cliente)}". A los que no entraron, mandales el link.`, detalle, ok: 'el cliente ya está adentro y quedó bien (la bienvenida sale con tu OK)', no: 'hay que arreglar algo (frena la bienvenida)' })
        : textoPedidoEquipo({ nombre: cliente, titulo: `quedó armada la comunidad "${nombreComunidad(cliente)}" solo con el equipo. El link del General se lo pasé al closer para que se lo mande al cliente: cuando entre, la bienvenida sale sola.`, detalle, ok: 'el cliente ya entró y quedó bien (si el bot no lo vio entrar, la bienvenida sale con tu OK)', no: 'hay que arreglar algo (frena la bienvenida)' }),
    }],
  }
}
