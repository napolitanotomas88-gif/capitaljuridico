'use client'

import { useActionState } from 'react'
import { guardarAccesoAccion, type EstadoForm } from '@/lib/auth/accionesAccesos'

export type Edicion = { email: string; nombre: string; tipo: 'admin' | 'acceso'; secciones: string[]; pestanas: string[] }
type Opcion = { clave: string; etiqueta: string }

// Formulario de alta/cambio. Dos tipos de acceso: "Acceso" (elegís qué ve) y "Administrador" (ve todo y gestiona accesos).
// El bloque de secciones se oculta solo cuando se elige Administrador (CSS :has, sin JavaScript extra) y el de pestañas
// del CRM aparece solo con Ventas marcada.
export function FormularioAcceso({ secciones, pestanas, edicion }: { secciones: Opcion[]; pestanas: string[]; edicion: Edicion | null }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(guardarAccesoAccion, {})
  const tipo = edicion?.tipo ?? 'acceso'
  return (
    <form action={accion} className="cfg-form" key={edicion?.email ?? 'nuevo'} aria-busy={pendiente}>
      <div className="cfg-campos">
        <label className="cfg-campo">
          <span className="cj-etiqueta">Mail de Google</span>
          <input name="email" type="email" required autoComplete="off" defaultValue={edicion?.email ?? ''} readOnly={!!edicion} placeholder="persona@example.test" />
        </label>
        <label className="cfg-campo">
          <span className="cj-etiqueta">Nombre</span>
          <input name="nombre" type="text" required maxLength={80} autoComplete="off" defaultValue={edicion?.nombre ?? ''} placeholder="Nombre y apellido" />
        </label>
      </div>

      <fieldset className="cfg-tipos">
        <legend className="cj-etiqueta">Tipo de acceso</legend>
        <label className="cfg-tipo">
          <input type="radio" name="tipo" value="acceso" defaultChecked={tipo === 'acceso'} />
          <span><strong>Acceso</strong>Vos elegís qué secciones puede ver.</span>
        </label>
        <label className="cfg-tipo">
          <input type="radio" name="tipo" value="admin" defaultChecked={tipo === 'admin'} />
          <span><strong>Administrador</strong>Ve todo y puede agregar o quitar accesos.</span>
        </label>
      </fieldset>

      <fieldset className="cfg-secciones">
        <legend className="cj-etiqueta">Qué puede ver</legend>
        <div className="cfg-casillas">
          {secciones.map((s) => (
            <label key={s.clave} className="cfg-casilla">
              <input type="checkbox" name="secciones" value={s.clave} defaultChecked={edicion?.secciones.includes(s.clave)} />
              <span>{s.etiqueta}</span>
            </label>
          ))}
        </div>
        <div className="cfg-pestanas">
          <p className="cj-etiqueta">Pestañas del CRM de ventas (si tiene Ventas)</p>
          <div className="cfg-casillas">
            {pestanas.map((p) => (
              <label key={p} className="cfg-casilla">
                <input type="checkbox" name="pestanas" value={p} defaultChecked={edicion?.pestanas.includes(p)} />
                <span>{p}</span>
              </label>
            ))}
          </div>
          <p className="cj-texto-2 cfg-nota">Una pestaña: es el closer de esa hoja y la hoja lleva su nombre. Varias (por ejemplo un pre-caller): trabaja en todas, cambia de hoja con el selector y no le pone su nombre a ninguna. Sin pestañas, en Ventas ve el aviso &ldquo;sin CRM asignado&rdquo;. Finanzas y Anuncios siguen pidiendo su propia contraseña.</p>
        </div>
      </fieldset>

      <div className="cfg-acciones">
        <button type="submit" className="cj-boton cj-boton--primario" disabled={pendiente}>{pendiente ? 'Guardando…' : edicion ? 'Guardar cambios' : 'Agregar persona'}</button>
        {edicion && <a className="cj-boton cj-boton--secundario" href="/configuracion">Cancelar</a>}
        <p role="status" aria-live="polite" className={estado.error ? 'cfg-error' : 'cfg-ok'}>{estado.error ?? estado.mensaje ?? ''}</p>
      </div>
    </form>
  )
}
