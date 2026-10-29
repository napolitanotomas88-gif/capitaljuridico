// ── Orquestador del seguimiento de anuncios (g04, g05, g06) ─────────────────────────────────────────
// Corre después de la alerta diaria (app/api/alerta-anuncios, cron 8:45 AR) con el MISMO tablero, así no se vuelve a
// leer Meta entero. Pasos, con las dependencias inyectadas (los tests usan falsas):
//   0. si el tablero no pudo leer «Ads Optimizaciones», no corre (todo parecería sin optimizar);
//   1. candidatos(tablero): qué campaña tiene aviso hoy (seguimiento.ts);
//   2. para los recordatorios (optimizar, ganadores): el detalle por anuncio y el historial de Meta en un batch;
//   3. si en el historial ya se ve la optimización, el recordatorio se convierte en "hecha": se registra en «Ads
//      Optimizaciones» (origen auto) para que el tablero avance y sale el texto para el cliente. Si el registro falla, no
//      sale nada (mañana se reintenta). Ganadores con 1 o 2 anuncios activos: no hay qué elegir, no se avisa ni se registra;
//   4. cada aviso se reclama en cj_anuncios_avisos ANTES de mandarlo y, además, no sale si en los últimos DIAS_REPETIDO
//      ya salió uno del mismo tipo para esa campaña (la fecha de la clave se puede correr). Las lanzadas de un cliente
//      del mismo día van en un solo mensaje, con una clave por campaña (solo las que se reclamaron).
// Con dry no se escribe nada (ni la base, ni la planilla, ni Discord): devuelve los textos y cuáles ya habían salido.
// Nunca tira: lo que falla queda en `errores` (la alerta diaria no depende de esto).
import type { Optimizacion } from '@/lib/anuncios/optimizaciones'
import type { Tablero } from '@/lib/anuncios/tablero'
import {
  MAX_AVISOS_POR_CORRIDA, candidatos, conWhatsApp, desdeDeteccion, detectarAccion, tandaDe, textoCliente, textoGanadores, textoHecha, textoLanzada, textoOptimizar,
  type Candidato, type DetalleCampana,
} from './seguimiento'
import type { DatosAviso } from './registro'

export interface DepsSeguimiento {
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  detalles(c: Candidato[], hoy: string): Promise<Map<string, DetalleCampana>>
  optimizaciones(): Promise<Optimizacion[]>
  registrarOptimizacion(o: Optimizacion): Promise<void>
  reclamar(clave: string, d: DatosAviso): Promise<boolean>
  marcarEnviado(clave: string, mensajeId: string): Promise<void>
  marcarDudoso(clave: string): Promise<void>
  soltar(clave: string): Promise<void>
  yaSalieron(claves: string[]): Promise<Set<string>>
  reciente(campanaId: string, tipo: string, dias: number): Promise<boolean>
  /** Manda un mensaje a #📣-ads (mencionando solo a Valentino) y devuelve su id. Un error con transitorio=false = rechazado. */
  enviar(texto: string, deadline: number): Promise<string>
  esperar(ms: number): Promise<void>
  /** WhatsApp al grupo Ventas del cliente (whatsapp.ts). Sin esto, el texto va solo a Valentino para que lo pegue. */
  whatsapp?: {
    permitida(cuenta: string): boolean
    grupos(): Promise<{ id?: string; name?: string }[]>
    elegir(cliente: string, grupos: { id?: string; name?: string }[], cuenta: string): { id: string; nombre: string } | null
    enviar(grupoId: string, texto: string): Promise<string | null>
    anotar(clave: string, grupoId: string, mensajeId: string | null): Promise<void>
  }
  valentino: string | null
  ahora(): number
}

export type EstadoAviso = 'enviado' | 'ya_salio' | 'dudoso' | 'rechazado' | 'error' | 'dry' | 'sin_tiempo'
export interface AvisoSalida { clave: string; tipo: Candidato['tipo']; cliente: string; campana: string; texto: string; estado: EstadoAviso; motivo?: string }
export interface ResultadoSeguimiento { candidatos: number; avisos: AvisoSalida[]; registradas: string[]; omitidos: string[]; errores: string[] }

const ORDEN: Record<Candidato['tipo'], number> = { optimizar: 0, ganadores: 1, optimizada: 2, lanzada: 3 }
const VACIO: DetalleCampana = { anuncios: [], metricas: {}, eventos: null }
export const RESERVA_ENVIO_MS = 8_000
export const PAUSA_ENTRE_AVISOS_MS = 400
export const DIAS_REPETIDO = 7
const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 200)
/** El tipo con el que se guarda (y se busca la repetición): la revisión final es otro aviso que la del día 4. */
export const tipoRegistro = (c: Candidato): string => (c.tipo === 'optimizada' && c.subtipo === 'ganadores' ? 'ganadores-hecha' : c.tipo)
/** Errores de Discord que seguro NO publicaron (429 que no se pudo esperar, o se cortó antes de pedir): se suelta y sale
 *  mañana. Un 5xx, un timeout o una conexión cortada pudieron publicar: quedan "dudoso". */
const seguroNoSalio = (m: string) => /429|se acabó el tiempo|pausa entre mensajes/i.test(m)

interface Envio { cs: Candidato[]; texto: (cs: Candidato[]) => string }

export async function seguimientoAnuncios(t: Pick<Tablero, 'hoy' | 'filas' | 'optimizacionesLeidas'>, deps: DepsSeguimiento, op: { dry?: boolean; deadline?: number } = {}): Promise<ResultadoSeguimiento> {
  const dry = !!op.dry, deadline = op.deadline ?? deps.ahora() + 50_000
  const errores: string[] = [], registradas: string[] = [], omitidos: string[] = []
  const vacio = (e: string): ResultadoSeguimiento => ({ candidatos: 0, avisos: [], registradas, omitidos, errores: [e] })
  if (t.optimizacionesLeidas === false) return vacio('el tablero no pudo leer «Ads Optimizaciones»: hoy no corre (todo parecería sin optimizar)')
  let cands: Candidato[]
  try { cands = candidatos(t) } catch (e) { return vacio(`candidatos: ${motivo(e)}`) }
  if (deps.clienteOperativo) {
    let controles: boolean[]
    try { controles = await Promise.all(cands.map(c => deps.clienteOperativo!(null, c.fila.clienteCRM ?? c.fila.cliente))) }
    catch (e) { return vacio(`estado actual del CRM: ${motivo(e)}`) }
    cands = cands.filter((_, i) => controles[i])
  }

  // 2. Detalle de Meta para los recordatorios
  const conDetalle = cands.filter(c => c.tipo === 'optimizar' || c.tipo === 'ganadores')
  let detalles = new Map<string, DetalleCampana>()
  if (conDetalle.length) {
    try { detalles = await deps.detalles(conDetalle, t.hoy) } catch (e) { errores.push(`detalle de Meta: ${motivo(e)}`) }
  }

  // 3. ¿Ya está hecha? → se registra (para que el tablero avance) y pasa a "optimizada"
  let registros: Optimizacion[] | null = null
  const finales: Candidato[] = []
  const textos = new Map<string, string>()
  for (const c of cands) {
    const d = detalles.get(c.l.campanaId) ?? VACIO
    if (c.tipo !== 'optimizar' && c.tipo !== 'ganadores') {
      if (c.tipo === 'optimizada') textos.set(c.clave, textoHecha(c, deps.valentino))
      finales.push(c)
      continue
    }
    const ganadores = c.tipo === 'ganadores'
    const accion = detectarAccion(d, desdeDeteccion(c), { tanda: tandaDe(c), conPresupuesto: !ganadores })
    const activos = d.anuncios.filter(a => a.activo).length
    // Ganadores sin nada hecho y con 1 o 2 activos: no hay qué elegir (no se avisa ni se registra)
    if (!accion && ganadores && d.anuncios.length && activos <= 2) { omitidos.push(`ganadores ${c.fila.cliente} · ${c.l.campana}: ya tiene ${activos} activo${activos === 1 ? '' : 's'}`); continue }
    if (!accion) {
      textos.set(c.clave, ganadores ? textoGanadores(c, d, deps.valentino) : textoOptimizar(c, d, deps.valentino))
      finales.push(c)
      continue
    }
    // La revisión final se registra (y se guarda la clave) con la fecha de hoy: así el tablero cierra el ciclo (≥ 7 días de
    // la optimización) y al día siguiente arma la MISMA clave desde «Ya revisé»
    const fecha = ganadores ? t.hoy : accion.fecha
    const hecha: Candidato = {
      ...c, tipo: 'optimizada', subtipo: ganadores ? 'ganadores' : 'optimizacion',
      clave: `${ganadores ? 'ganadores-hecha' : 'optimizada'}:${c.l.campanaId}:${fecha}`,
      desde: ganadores ? c.desde : c.l.fecha,
      hecha: { fecha: accion.fecha, origen: 'meta', quien: accion.quien, resumen: accion.resumen },
    }
    const o: Optimizacion = {
      cuenta: c.fila.id, campanaId: c.l.campanaId, campana: c.l.campana, cliente: c.fila.cliente, fechaLanzada: c.l.fecha,
      fecha, confirmado: new Date(deps.ahora()).toISOString(), accion: ganadores ? 'revision_competencia' : 'optimizacion',
      origen: `auto: ${accion.quien} ${accion.resumen}`.slice(0, 200),
    }
    if (!dry) {
      try {
        registros ??= await deps.optimizaciones()
        if (!registros.some(r => r.campanaId === o.campanaId && (r.accion ?? 'optimizacion') === o.accion && r.fecha === o.fecha)) {
          await deps.registrarOptimizacion(o)
          registros.push(o)
        }
        registradas.push(`${o.accion} ${c.fila.cliente} · ${c.l.campana} · ${o.fecha}`)
      } catch (e) {
        // Sin registro no se avisa: el mensaje diría "lo registré" y mañana se reintenta todo
        errores.push(`registrar ${o.accion} de ${c.fila.cliente}: ${motivo(e)}`)
        continue
      }
    } else registradas.push(`(dry) ${o.accion} ${c.fila.cliente} · ${c.l.campana} · ${o.fecha}`)
    textos.set(hecha.clave, textoHecha(hecha, deps.valentino))
    finales.push(hecha)
  }

  // 4. Envíos: las lanzadas de un cliente del mismo día van juntas; el resto, de a uno. Orden: lo que hay que hacer primero
  const envios: Envio[] = []
  const lanzadas = new Map<string, Candidato[]>()
  for (const c of finales) {
    if (c.tipo === 'lanzada') { const k = `${c.fila.id}|${c.desde}`; lanzadas.set(k, [...(lanzadas.get(k) ?? []), c]) }
    else envios.push({ cs: [c], texto: () => textos.get(c.clave) ?? '' })
  }
  for (const cs of lanzadas.values()) envios.push({ cs: cs.sort((a, b) => a.l.campanaId.localeCompare(b.l.campanaId)), texto: xs => textoLanzada(xs, deps.valentino) })
  envios.sort((a, b) => ORDEN[a.cs[0].tipo] - ORDEN[b.cs[0].tipo])

  const avisos: AvisoSalida[] = []
  const salida = (cs: Candidato[], texto: string, estado: EstadoAviso, m?: string): AvisoSalida => ({
    clave: cs.map(c => c.clave).join(' + '), tipo: cs[0].tipo, cliente: cs[0].fila.clienteCRM ?? cs[0].fila.cliente, campana: cs.map(c => c.l.campana).join(' · '), texto, estado, ...(m ? { motivo: m } : {}),
  })
  /** Las de este envío que no salieron ya (por su clave o por un aviso del mismo tipo de la campaña en los últimos días). */
  const pendientes = async (cs: Candidato[], ya: Set<string>): Promise<Candidato[]> => {
    const out: Candidato[] = []
    for (const c of cs) {
      if (ya.has(c.clave)) continue
      let repetido = false
      try { repetido = await deps.reciente(c.l.campanaId, tipoRegistro(c), DIAS_REPETIDO) } catch (e) { errores.push(`leer avisos: ${motivo(e)}`); repetido = true }
      if (!repetido) out.push(c)
    }
    return out
  }

  if (dry) {
    let ya = new Set<string>()
    try { ya = await deps.yaSalieron(finales.map(c => c.clave)) } catch (e) { errores.push(`leer avisos: ${motivo(e)}`) }
    for (const e of envios.slice(0, MAX_AVISOS_POR_CORRIDA)) {
      const quedan = await pendientes(e.cs, ya)
      avisos.push(salida(quedan.length ? quedan : e.cs, e.texto(quedan.length ? quedan : e.cs), quedan.length ? 'dry' : 'ya_salio'))
    }
    return { candidatos: cands.length, avisos, registradas, omitidos, errores }
  }

  let mandados = 0
  let gruposWa: { id?: string; name?: string }[] | null = null
  for (const e of envios) {
    if (deps.clienteOperativo && !await deps.clienteOperativo(null, e.cs[0].fila.clienteCRM ?? e.cs[0].fila.cliente)) { omitidos.push('Cliente archivado: sin envíos nuevos'); continue }
    if (mandados >= MAX_AVISOS_POR_CORRIDA) break
    if (deadline - deps.ahora() < RESERVA_ENVIO_MS) { avisos.push(salida(e.cs, '', 'sin_tiempo')); continue }
    // Reclamar cada campaña del envío (las que ya salieron quedan afuera del mensaje)
    const mias: Candidato[] = []
    let fallo: string | null = null
    for (const c of await pendientes(e.cs, new Set())) {
      const datos: DatosAviso = { tipo: tipoRegistro(c), cuenta: c.fila.id, campana_id: c.l.campanaId, cliente: c.fila.clienteCRM ?? c.fila.cliente, texto_cliente: c.tipo === 'lanzada' || c.tipo === 'optimizada' ? textoCliente(c) : null }
      try { if (await deps.reclamar(c.clave, datos)) mias.push(c) } catch (err) { fallo = motivo(err) }
    }
    if (!mias.length) { avisos.push(salida(e.cs, '', fallo ? 'error' : 'ya_salio', fallo ?? undefined)); continue }
    let texto = e.texto(mias)
    if (mandados > 0) await deps.esperar(PAUSA_ENTRE_AVISOS_MS)
    if (deps.clienteOperativo) {
      try {
        if (!await deps.clienteOperativo(null, mias[0].fila.clienteCRM ?? mias[0].fila.cliente)) {
          for (const c of mias) await deps.soltar(c.clave)
          omitidos.push('Cliente archivado durante la espera: envío detenido')
          continue
        }
      } catch (e) {
        // Todavía no salió ningún envío; liberar el reclamo es seguro y permite retomarlo con CRM confirmado.
        for (const c of mias) await deps.soltar(c.clave).catch(() => {})
        errores.push(`estado actual del CRM: ${motivo(e)}`)
        continue
      }
    }
    // WhatsApp al cliente (solo los avisos con texto para él y si está prendido para esa cuenta). Si sale, el aviso ya no
    // se repite nunca (aunque después falle Discord): el cliente no puede recibirlo dos veces
    let whatsappSalio = false
    const c0 = mias[0], paraCliente = c0.tipo === 'lanzada' || c0.tipo === 'optimizada'
    if (paraCliente && deps.whatsapp?.permitida(c0.fila.id)) {
      try {
        gruposWa ??= await deps.whatsapp.grupos()
        const g = deps.whatsapp.elegir(c0.fila.clienteCRM ?? c0.fila.cliente, gruposWa, c0.fila.id)
        if (!g) texto = conWhatsApp(texto, { estado: 'no', motivo: 'no encontré un único grupo «Ventas» suyo en el WhatsApp del bot' })
        else {
          const idWa = await deps.whatsapp.enviar(g.id, textoCliente(c0.tipo === 'lanzada' ? { ...c0, rotacion: mias.every(x => x.rotacion) } : c0))
          whatsappSalio = true
          texto = conWhatsApp(texto, { estado: 'enviado', grupo: g.nombre })
          for (const c of mias) { try { await deps.whatsapp.anotar(c.clave, g.id, idWa) } catch (err) { errores.push(`anotar WhatsApp ${c.clave}: ${motivo(err)}`) } }
        }
      } catch (err) {
        errores.push(`WhatsApp de ${c0.fila.cliente}: ${motivo(err)}`)
        texto = conWhatsApp(texto, { estado: 'no', motivo: 'el WhatsApp falló' })
      }
    }
    try {
      const id = await deps.enviar(texto, deadline - 2_000)
      mandados++
      for (const c of mias) { try { await deps.marcarEnviado(c.clave, id) } catch (err) { errores.push(`anotar ${c.clave}: ${motivo(err)}`) } }
      avisos.push(salida(mias, texto, 'enviado'))
    } catch (err) {
      const m = motivo(err)
      const rechazado = (err as { transitorio?: boolean })?.transitorio === false
      const soltar = !whatsappSalio && (rechazado || seguroNoSalio(m))
      for (const c of mias) { try { await (soltar ? deps.soltar(c.clave) : deps.marcarDudoso(c.clave)) } catch (e2) { errores.push(`anotar ${c.clave}: ${motivo(e2)}`) } }
      avisos.push(salida(mias, texto, rechazado ? 'rechazado' : soltar ? 'error' : 'dudoso', m))
    }
  }
  return { candidatos: cands.length, avisos, registradas, omitidos, errores }
}
