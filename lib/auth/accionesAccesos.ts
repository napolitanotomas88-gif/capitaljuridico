'use server'

// Acciones de la pantalla Configuración (alta, cambio y baja de accesos). Cada una vuelve a comprobar que quien llama es
// ADMINISTRADOR: que la página esté protegida no alcanza (una server action se puede invocar a mano).
import { revalidatePath } from 'next/cache'
import { guardarAcceso, quitarAcceso, asegurarUsuarios } from './accesos'
import { obtenerSesion } from './sesion'
import { puedeVer } from './roles'

export type EstadoForm = { ok?: boolean; mensaje?: string; error?: string }

async function admin() {
  await asegurarUsuarios()
  const s = await obtenerSesion()
  return s && s.admin && puedeVer(s, 'configuracion') ? s : null
}

export async function guardarAccesoAccion(_previo: EstadoForm, datos: FormData): Promise<EstadoForm> {
  const s = await admin()
  if (!s) return { error: 'Solo un administrador puede cambiar los accesos.' }
  const r = await guardarAcceso(
    { email: datos.get('email'), nombre: datos.get('nombre'), tipo: datos.get('tipo'), secciones: datos.getAll('secciones'), pestanas: datos.getAll('pestanas') },
    s.email,
  )
  if (r.ok) revalidatePath('/configuracion')
  return r.ok ? { ok: true, mensaje: r.mensaje } : { error: r.error }
}

export async function quitarAccesoAccion(_previo: EstadoForm, datos: FormData): Promise<EstadoForm> {
  const s = await admin()
  if (!s) return { error: 'Solo un administrador puede cambiar los accesos.' }
  const r = await quitarAcceso(datos.get('email'), s.email)
  if (r.ok) revalidatePath('/configuracion')
  return r.ok ? { ok: true, mensaje: r.mensaje } : { error: r.error }
}
