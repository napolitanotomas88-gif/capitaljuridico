'use server'

// Puntuar a un cliente (1 a 10) desde la lista o la ficha. Vuelve a comprobar sesión y permiso sobre Clientes.
import { revalidatePath } from 'next/cache'
import { obtenerSesion } from '../auth/sesion'
import { puedeVer } from '../auth/roles'
import { validarPuntaje } from './modelo'
import { guardarPuntaje } from './hojas'

export type EstadoPuntaje = { ok?: boolean; mensaje?: string; error?: string; valor?: number }

export async function puntuarCliente(_previo: EstadoPuntaje, datos: FormData): Promise<EstadoPuntaje> {
  const s = await obtenerSesion()
  if (!s || !puedeVer(s, 'clientes')) return { error: 'No tenés permiso para puntuar clientes.' }
  const v = validarPuntaje({ idCliente: datos.get('idCliente'), valor: datos.get('valor'), nota: datos.get('nota') })
  if (!v.ok) return { error: v.error }
  const r = await guardarPuntaje(v.idCliente, v.valor, v.nota, (s.nombre?.trim() || s.email).slice(0, 60))
  if (!r.ok) return { error: r.error }
  revalidatePath('/clientes')
  revalidatePath(`/clientes/${v.idCliente}`)
  return { ok: true, mensaje: r.mensaje, valor: v.valor }
}
