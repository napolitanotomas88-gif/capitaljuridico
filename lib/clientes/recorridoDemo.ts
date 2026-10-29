// ── Recorrido con ?demo=1 (solo en desarrollo): clientes y fuentes FICTICIOS para revisar la línea de tiempo ─────────────
// Suma clientes de ejemplo (E010 en adelante, todos "(ejemplo)") a la cartera ficticia de demo.ts y les inventa ficha,
// tanda, videos, campaña, tarea de ClickUp y puntaje para que haya alguno en cada etapa. No lee planillas ni la base.
import { sumarDias, type Ymd } from './fechas'
import type { Cliente, DatosClientes } from './tipos'
import type { FuentesCliente, VideosResumen } from './recorrido'

const NOMBRES = ['Diez', 'Once', 'Doce', 'Trece', 'Catorce', 'Quince', 'Dieciséis', 'Diecisiete', 'Dieciocho', 'Diecinueve', 'Veinte', 'Veintiuno', 'Veintidós', 'Veintitrés', 'Veinticuatro', 'Veinticinco']
const CLOSERS = ['Gero', 'Fer', 'Carlos', 'Marcos']
const NADA: FuentesCliente = { kickoff: null, tanda: null, videos: null, meta: null, clickup: null, puntaje: null }
const VID0: VideosResumen = { grabacion: 0, edicion: 0, aprobados: 0, pausados: 0, ultimoGrabacion: null, ultimoEdicion: null, ultimoAprobado: null }

type Receta = { dia1: number; vence?: number; estado?: Cliente['estado']; f: (d: (n: number) => Ymd) => Partial<FuentesCliente> }
// Una receta por cliente (los 9 de demo.ts primero, después los nuevos): días desde el Día 1 y qué se ve de él
const RECETAS: Receta[] = [
  { dia1: 3, f: () => ({}) },                                                                                  // alta
  { dia1: 12, vence: 6, f: d => ({ kickoff: { fecha: d(-9), frenos: 2, ideas: 'Ideas a medias: falta Gero M' } }) },   // kickoff frenado
  { dia1: 20, f: d => ({ kickoff: { fecha: d(-15), frenos: 0, ideas: 'Aprobadas' }, tanda: { tanda: 1, estado: 'con_notas', actualizado: d(-2), guiones: 6 } }) },
  { dia1: 26, f: d => ({ tanda: { tanda: 1, estado: 'enviada', actualizado: d(-11), guiones: 6 } }) },          // grabación frenado
  { dia1: 33, vence: 25, f: d => ({ videos: { ...VID0, edicion: 4, ultimoEdicion: d(-1) } }) },
  { dia1: 40, f: d => ({ videos: { ...VID0, aprobados: 6, ultimoAprobado: d(-3) } }) },
  { dia1: 75, f: d => ({ meta: { activa: true, ultimoLanzamiento: d(-30), semaforo: 'amarillo' }, puntaje: { valor: 7, dia: d(-5) } }) },
  { dia1: 140, f: d => ({ meta: { activa: true, ultimoLanzamiento: d(-90), semaforo: 'verde' }, puntaje: { valor: 9, dia: d(-4) } }) },   // éxito
  { dia1: 170, vence: 12, f: d => ({ meta: { activa: true, ultimoLanzamiento: d(-120), semaforo: 'verde' }, puntaje: { valor: 9, dia: d(-8) } }) }, // renovación
  { dia1: 5, f: () => ({}) },
  { dia1: 60, f: d => ({ clickup: { estado: 'guionizar', actualizada: d(-20) } }) },                           // respaldo ClickUp, frenado
  { dia1: 18, f: d => ({ kickoff: { fecha: d(-4), frenos: 0, ideas: 'Pendientes de revisión' } }) },
  { dia1: 29, f: d => ({ tanda: { tanda: 1, estado: 'a_revisar', actualizado: d(-1), guiones: 6 } }) },
  { dia1: 31, f: d => ({ videos: { ...VID0, grabacion: 3, ultimoGrabacion: d(-2) } }) },
  { dia1: 44, f: d => ({ videos: { ...VID0, edicion: 2, ultimoEdicion: d(-9) } }) },
  { dia1: 95, f: d => ({ meta: { activa: true, ultimoLanzamiento: d(-60), semaforo: 'rojo' }, puntaje: { valor: 4, dia: d(-3) } }) },
  { dia1: 120, f: d => ({ meta: { activa: true, ultimoLanzamiento: d(-70), semaforo: 'verde' }, puntaje: { valor: 8, dia: d(-12) } }) },
  { dia1: 200, f: d => ({ meta: { activa: false, ultimoLanzamiento: d(-100), semaforo: null } }) },
  { dia1: 80, f: d => ({ meta: { activa: true, ultimoLanzamiento: d(-40), semaforo: 'verde' } }) },
  { dia1: 150, estado: 'PAUSADO', f: () => ({}) },
  { dia1: 300, estado: 'FINALIZADO', f: () => ({}) },
  { dia1: 9, f: d => ({ kickoff: { fecha: d(-1), frenos: 1, ideas: 'Sin ideas todavía' } }) },
  { dia1: 52, f: d => ({ clickup: { estado: 'grabación', actualizada: d(-4) } }) },
  { dia1: 66, f: d => ({ clickup: { estado: 'creación de campaña', actualizada: d(-8) } }) },
  { dia1: 2, f: () => ({}) },
]

export function extenderDemo(datos: DatosClientes): { datos: DatosClientes; fuentes: Map<string, FuentesCliente> } {
  const d = (n: number): Ymd => sumarDias(datos.hoy, n)
  // Copias: el ejemplo de demo.ts no se toca (lo usan las cifras y la lista)
  const base = datos.clientes.filter(c => c.linea === 'agencia' && c.id).map(c => ({ ...c }))
  const molde = base[0]
  const nuevos: Cliente[] = molde ? NOMBRES.map((n, i) => ({
    ...molde, id: `E${String(10 + i).padStart(3, '0')}`, fila: 100 + i, nombre: `Estudio Ejemplo ${n} (ejemplo)`, closer: CLOSERS[i % CLOSERS.length],
    anotaciones: 'Cliente de ejemplo para revisar la línea de tiempo.', periodos: [],
  })) : []
  const copia = new Map(base.map(c => [c.id, c]))
  const clientes = [...datos.clientes.map(c => copia.get(c.id) ?? c), ...nuevos]
  const fuentes = new Map<string, FuentesCliente>()
  ;[...base, ...nuevos].forEach((c, i) => {
    const r = RECETAS[i % RECETAS.length]
    c.dia1 = d(-r.dia1)
    if (r.estado) c.estado = r.estado
    c.diasParaVencer = r.vence ?? 60 + i
    c.finPeriodo = d(c.diasParaVencer)
    fuentes.set(c.id, { ...NADA, ...r.f(d) })
  })
  return { datos: { ...datos, clientes }, fuentes }
}
