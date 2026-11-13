// ── EOW: recién lanzados automáticos y aviso de los domingos (13/11/2026) ────────────────────────────────────────────────
// Cada día a las 10:00 (Argentina) corre el cron /api/eow/aviso, pero solo ACTÚA los domingos (Vercel Hobby solo permite
// crons diarios; ?dry=1 muestra lo que haría cualquier día):
//   0. Crea SIEMPRE la semana nueva (la fecha de ese domingo) copiando la anterior: rojos, amarillos, verdes, pausados,
//      comentarios, vínculos y tarjetas (14/11/2026: Gero M no toca «Nueva semana», que queda como respaldo manual).
//      Idempotente: si ya existe, no la toca. Aunque Meta no responda, la semana se crea igual.
//   1. Lee los clientes con campaña lanzada (la misma fuente que la etapa «Lanzado» del Despacho: el PRIMER lanzamiento que
//      se conoce en Meta, del tablero de /anuncios; ver lib/clientes/produccion.ts campanasMeta) y se queda con los lanzados
//      en la semana del reporte: de ese lunes a ese domingo (14/11/2026, Tomás: el reporte es del cierre de la semana;
//      el domingo 15/11 se crea el de la semana lunes 09/11 → domingo 15/11).
//   2. Descarta los que ya están en el reporte de la semana (fila o cualquier tarjeta: mismo ID del CRM, mismo nombre o el
//      cruce de nombres de la cartera, crearCruce).
//   3. Los agrega como «Recién lanzados · para ubicar» (fila sin color, origen «sistema», con la fecha de lanzamiento) al
//      reporte de la semana, creándolo si no existe (copia de la semana anterior).
//   4. Avisa en #📊-reporte-eow (DISCORD_WEBHOOK_EOW; si falta, DISCORD_WEBHOOK_OPERACIONES) mencionando SOLO a Gero M
//      (pedido de Tomás, 13/11/2026). Un aviso por semana (cj_eow_avisos). Apagado salvo EOW_AVISO=encendido.
// Todo entra por DepsAvisoEow: los tests usan dependencias de juguete; lanzadosReales.ts usa Neon, Meta y Discord.
import { claveNombre, crearCruce } from '@/lib/clientes/prioridad'
import { TARJETAS, domingoDe, lunesDe, esFecha, nuevoIdFila, rangoSemana, type DatosEow, type FilaEow } from './modelo'

export interface ClienteLanzado { nombre: string; idCrm: string | null; lanzado: string }

/** ¿Este cliente ya figura en el reporte? (fila por ID o nombre, o cualquier ítem de las tarjetas por nombre) */
export function yaEnReporte(datos: DatosEow, c: Pick<ClienteLanzado, 'nombre' | 'idCrm'>): boolean {
  const id = c.idCrm?.toUpperCase() ?? null
  if (id && datos.filas.some((f) => f.idCrm === id)) return true
  const clave = claveNombre(c.nombre)
  const nombres = [...datos.filas.map((f) => f.cliente), ...TARJETAS.flatMap((k) => datos.tarjetas[k] ?? []).map((x) => x.split(/\s[-–:(]\s?|\s\(/)[0])]
  if (nombres.some((n) => claveNombre(n) === clave)) return true
  const cruce = crearCruce(nombres.map((n, i) => ({ id: String(i), n })), (x) => x.n)
  return cruce(c.nombre) !== null
}

/** Ventana de lanzamientos de la semana del reporte: del lunes al domingo de cierre (`semana` es ese domingo). */
export function ventana(semana: string): { desde: string; hasta: string } {
  return { desde: lunesDe(semana), hasta: semana }
}

/** Los recién lanzados para agregar: en la ventana, sin clientes de prueba, sin repetidos y que no estén en el reporte. */
export function recienLanzados(clientes: readonly ClienteLanzado[], datos: DatosEow, v: { desde: string; hasta: string }): ClienteLanzado[] {
  const vistos = new Set<string>()
  const salida: ClienteLanzado[] = []
  for (const c of [...clientes].sort((a, b) => a.lanzado.localeCompare(b.lanzado) || a.nombre.localeCompare(b.nombre))) {
    if (!esFecha(c.lanzado) || c.lanzado < v.desde || c.lanzado > v.hasta) continue
    if (/^\s*PRUEBA\b/i.test(c.nombre) || !c.nombre.trim()) continue
    const k = c.idCrm?.toUpperCase() || claveNombre(c.nombre)
    if (vistos.has(k)) continue
    vistos.add(k)
    if (yaEnReporte(datos, c)) continue
    salida.push(c)
  }
  return salida
}

/** Suma los recién lanzados como filas sin ubicar (al principio de la lista). */
export function agregarFilas(datos: DatosEow, nuevos: readonly ClienteLanzado[]): DatosEow {
  const filas: FilaEow[] = nuevos
    .filter((c) => !yaEnReporte(datos, c))
    .map((c) => ({ id: nuevoIdFila('s'), cliente: c.nombre.trim(), comentario: '', color: null, pausado: false, idCrm: c.idCrm, lanzado: c.lanzado, origen: 'sistema' }))
  return { filas: [...filas, ...datos.filas], tarjetas: datos.tarjetas }
}

/** Texto del aviso (sin la mención: la pone quien manda). */
export function textoAviso(semana: string, nombres: readonly string[], link: string): string {
  const n = nombres.length
  return [
    `Reporte EOW de la semana: ${n} ${n === 1 ? 'cliente recién lanzado' : 'clientes recién lanzados'} para ubicar`,
    ...nombres.map((x) => `• ${x}`),
    `${link} (semana del ${rangoSemana(semana)})`,
  ].join('\n')
}

// ── La corrida ──
export interface DepsAvisoEow {
  hoy: () => string
  encendido: boolean
  base: string
  lanzados(): Promise<ClienteLanzado[] | null>
  semanaAnterior(semana: string): Promise<string | null>
  /** Crea la semana copiando la anterior si no existe. true = la creó ahora. */
  crearSemana(semana: string): Promise<boolean>
  leer(semana: string): Promise<DatosEow | null>
  agregar(semana: string, nuevos: ClienteLanzado[]): Promise<{ ok: boolean; creado: boolean }>
  reservarAviso(semana: string, nombres: string[]): Promise<boolean>
  cerrarAviso(semana: string, estado: string): Promise<void>
  enviar(texto: string): Promise<'enviado' | 'sin_webhook' | 'error'>
}

export interface ResultadoAvisoEow {
  hoy: string
  semana: string
  dry: boolean
  actua: boolean
  motivo?: string
  ventana?: { desde: string; hasta: string }
  nuevos: { nombre: string; lanzado: string }[]
  agregados?: boolean
  creado?: boolean
  /** La semana se creó en esta corrida (o, en dry, se crearía) */
  semanaCreada?: boolean
  aviso?: string
}

export async function correrAvisoEow(d: DepsAvisoEow, opciones: { dry?: boolean; forzar?: boolean } = {}): Promise<ResultadoAvisoEow> {
  const hoy = d.hoy()
  const semana = domingoDe(hoy)
  const dry = !!opciones.dry
  const esDomingo = semana === hoy
  const base: ResultadoAvisoEow = { hoy, semana, dry, actua: false, nuevos: [] }
  if (!dry && !d.encendido) return { ...base, motivo: 'EOW_AVISO no está en «encendido»: no se hizo nada.' }
  if (!dry && !esDomingo && !opciones.forzar) return { ...base, motivo: 'Solo actúa los domingos.' }
  // 0. La semana nueva, siempre (idempotente). En dry solo se informa si se crearía.
  const existia = !!(await d.leer(semana))
  const semanaCreada = dry ? !existia : existia ? false : await d.crearSemana(semana)
  base.semanaCreada = semanaCreada
  base.actua = !dry
  const lanzados = await d.lanzados()
  if (!lanzados) return { ...base, motivo: 'No se pudo leer Meta: la semana quedó creada, pero sin los recién lanzados (se reintenta con ?forzar=1).' }
  const datos = (await d.leer(semana)) ?? null
  const anterior = await d.semanaAnterior(semana)
  const v = ventana(semana)
  // Sin reporte de la semana todavía: se compara contra la copia de la anterior (lo que quedaría al crearla)
  const comparar = datos ?? (anterior ? await d.leer(anterior) : null) ?? { filas: [], tarjetas: {} as DatosEow['tarjetas'] }
  const nuevos = recienLanzados(lanzados, { filas: comparar.filas, tarjetas: Object.fromEntries(TARJETAS.map((k) => [k, comparar.tarjetas?.[k] ?? []])) as DatosEow['tarjetas'] }, v)
  const res: ResultadoAvisoEow = { ...base, ventana: v, nuevos: nuevos.map((c) => ({ nombre: c.nombre, lanzado: c.lanzado })) }
  if (dry || !nuevos.length) return { ...res, motivo: nuevos.length ? undefined : 'No hay recién lanzados nuevos esta semana.' }
  const ag = await d.agregar(semana, nuevos)
  res.agregados = ag.ok
  res.creado = ag.creado
  if (!ag.ok) return { ...res, motivo: 'No se pudo agregar al reporte (se reintenta mañana con ?forzar=1).' }
  const nombres = nuevos.map((c) => c.nombre)
  if (!(await d.reservarAviso(semana, nombres))) return { ...res, aviso: 'ya_estaba' }
  const estado = await d.enviar(textoAviso(semana, nombres, `${d.base.replace(/\/+$/, '')}/eow`))
  await d.cerrarAviso(semana, estado)
  return { ...res, aviso: estado }
}
