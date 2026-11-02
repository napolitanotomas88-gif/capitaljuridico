// ── Aprobaciones del Despacho (2/11/2026). Solo servidor ────────────────────────────────────────────────────────────────
// Lo que antes se aprobaba citando en el grupo «Verificaciones C.J.» de WhatsApp se aprueba en /clientes/aprobaciones:
//   · Éxito: pedido de testimonio (h01), lista de la encuesta del mes con exclusiones (h03) y respuestas dudosas del Typeform.
//   · Bajas: aviso de fin (i01), confirmación de la baja (i02), despedida (i03) y pausar campañas en Meta (i04).
//   · Altas: siguen en /clientes/altas (OK / NO / «Hecho a mano»); acá solo se cuentan y se enlazan.
// Aprueban Tomás, Gero A, Gero M y Aylu (los mails de BOT_ALTA_APROBADORES_*: lib/bot/alta/despacho/aprobadores.ts).
import { almacenExitoNeon } from '@/lib/bot/exito/almacenNeon'
import { almacenBajasNeon } from '@/lib/bot/bajas/almacenNeon'
import { textoListaEncuesta, textoPedidoOk } from '@/lib/bot/exito/textos'
import { textoDudosa } from '@/lib/bot/exito/nucleo'
import { sinCitar } from '@/lib/bot/sinWhatsapp'

export type FuenteAprobacion = 'exito_pedido' | 'exito_lote' | 'exito_dudosa' | 'bajas'
export const esFuente = (x: unknown): x is FuenteAprobacion => x === 'exito_pedido' || x === 'exito_lote' || x === 'exito_dudosa' || x === 'bajas'

export interface ItemAprobacion {
  fuente: FuenteAprobacion
  id: string
  titulo: string
  cliente: string
  idCrm: string | null
  texto: string
  desde: string
  /** Ayuda para el campo opcional de la respuesta («sin Ana Pérez», «FINALIZADO», «sin mensaje»). */
  ayudaResto: string | null
}

const TITULO_BAJA: Record<string, string> = { aviso_fin: 'Aviso de fin de servicio (i01)', confirmar_baja: 'Confirmar la baja (i02)', despedida: 'Despedida y salida de los grupos (i03)', pausar_meta: 'Pausar campañas en Meta (i04)' }
const AYUDA_BAJA: Record<string, string | null> = { aviso_fin: null, confirmar_baja: 'Estado del CRM: FINALIZADO o INACTIVO', despedida: '«sin mensaje» lo saca de los grupos sin despedida', pausar_meta: null }
const mesAR = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7)

export async function listarAprobaciones(): Promise<{ items: ItemAprobacion[]; errores: string[] }> {
  const items: ItemAprobacion[] = [], errores: string[] = []
  if (!process.env.DATABASE_URL?.trim()) return { items, errores: ['Falta DATABASE_URL.'] }
  try {
    const ex = almacenExitoNeon()
    for (const p of (await ex.listarPedidos(150)).filter((x) => x.estado === 'abierto')) {
      items.push({ fuente: 'exito_pedido', id: p.id, titulo: 'Pedido de testimonio (h01)', cliente: p.cliente, idCrm: p.idCrm, texto: sinCitar(textoPedidoOk(p.cliente, p.motivo)), desde: p.creado, ayudaResto: null })
    }
    const ahora = Date.now()
    const meses = [mesAR(ahora), mesAR(ahora - 32 * 86_400_000)]
    for (const mes of [...meses, ...meses.map((m) => `${m}-prueba`)]) {
      const l = await ex.lote(mes)
      if (l?.estado !== 'pedido') continue
      items.push({ fuente: 'exito_lote', id: l.mes, titulo: `Encuesta mensual ${l.mes} (h03)`, cliente: `${l.clientes.length} cliente(s)`, idCrm: null, texto: sinCitar(textoListaEncuesta(l.mes.slice(0, 7), l.clientes.map((k) => k.nombre), l.sinGrupo)), desde: l.creado, ayudaResto: 'Para dejar afuera: «sin Nombre Apellido, A123»' })
    }
    for (const s of (await ex.senalesDesde(new Date(ahora - 60 * 86_400_000).toISOString())).filter((x) => x.tipo === 'dudosa' && x.estado === 'consultada')) {
      const d = s.detalle as { quien?: string; valor?: number | null; fecha?: string }
      items.push({ fuente: 'exito_dudosa', id: s.id, titulo: 'Respuesta de la encuesta sin cliente', cliente: String(d.quien ?? '?'), idCrm: null, texto: sinCitar(textoDudosa({ quien: String(d.quien ?? '?'), valor: d.valor ?? null, enviadaEn: String(d.fecha ?? s.creado) })), desde: s.creado, ayudaResto: 'Con OK, el ID del CRM (por ejemplo A123)' })
    }
  } catch (e) { errores.push(`Éxito: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  try {
    for (const p of (await almacenBajasNeon().listarPedidos(150)).filter((x) => x.estado === 'abierto')) {
      const texto = typeof p.detalle?.texto === 'string' ? sinCitar(p.detalle.texto) : `${TITULO_BAJA[p.tipo] ?? p.tipo} de ${p.cliente}${p.fin ? ` (fin: ${p.fin})` : ''}`
      items.push({ fuente: 'bajas', id: p.id, titulo: TITULO_BAJA[p.tipo] ?? p.tipo, cliente: p.cliente, idCrm: p.idCrm, texto, desde: p.creado, ayudaResto: AYUDA_BAJA[p.tipo] ?? null })
    }
  } catch (e) { errores.push(`Bajas: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  items.sort((a, b) => a.desde.localeCompare(b.desde))
  return { items, errores }
}
