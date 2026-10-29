import type { Metadata } from 'next'
import Link from 'next/link'
import { filasDeLaPlanilla, planillaConfigurada } from '@/lib/auth/accesos'
import { PESTANAS_VENTAS } from '@/lib/ventas/pendientes'
import { SECCIONES_ASIGNABLES, ETIQUETA_ROL } from '@/lib/auth/roles'
import { exigirAcceso } from '@/lib/auth/sesion'
import { listarAccesos } from '@/lib/auth/usuarios'
import { SeccionTitulo } from '@/components/ui'
import { ETIQUETA_ACCESO } from '@/components/shell/secciones'
import { BotonQuitar } from './_componentes/BotonQuitar'
import { FormularioAcceso, type Edicion } from './_componentes/FormularioAcceso'

export const metadata: Metadata = { title: 'Configuración' }
export const dynamic = 'force-dynamic'

export default async function ConfiguracionPage({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const sesion = await exigirAcceso('configuracion')
  const { editar } = await searchParams
  const conectada = planillaConfigurada()
  let filas: Awaited<ReturnType<typeof filasDeLaPlanilla>> = []
  let falloLectura = false
  if (conectada) {
    try { filas = await filasDeLaPlanilla() } catch { falloLectura = true }
  }
  // La última fila de cada mail es la vigente
  const vigentes = new Map(filas.map((f) => [f.email, f]))
  const personas = [...vigentes.values()]
  const fijas = listarAccesos().filter((a) => a.origen === 'vercel')
  const aEditar = editar ? vigentes.get(editar.trim().toLowerCase()) : undefined
  const edicion: Edicion | null = aEditar && aEditar.activo ? { email: aEditar.email, nombre: aEditar.nombre, tipo: aEditar.tipo, secciones: aEditar.secciones, pestanas: aEditar.pestanas } : null
  const correoCuenta = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? 'la cuenta de servicio del dashboard'

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Configuración" titulo="Accesos al dashboard" />
      <p className="cj-parrafo cj-texto-2">
        Agregá a una persona con su mail de Google y elegí qué puede ver, o dale acceso de administrador. Entra con esa cuenta en el botón &ldquo;Entrar con Google&rdquo;.
        Los cambios rigen en menos de un minuto.
      </p>

      {!conectada && (
        <section className="cj-panel cfg-aviso" aria-label="Falta conectar la planilla">
          <h2 className="cj-etiqueta cj-etiqueta--laton">Falta un paso: conectar la planilla de Accesos</h2>
          <ol className="cfg-pasos">
            <li>Creá una planilla de Google en blanco llamada &ldquo;Capital Jurídico – Accesos&rdquo;.</li>
            <li>Compartila como <strong>Editor</strong> con <code>{correoCuenta}</code>.</li>
            <li>Copiá el id de la planilla (lo que está entre <code>/d/</code> y <code>/edit</code> en la dirección) y cargalo en Vercel como <code>SHEET_ID_ACCESOS</code> (Production). Después, redesplegá.</li>
          </ol>
          <p className="cj-texto-2">Mientras tanto siguen entrando los administradores de la lista fija de Vercel.</p>
        </section>
      )}
      {falloLectura && <p role="alert" className="cfg-error">No se pudo leer la planilla de Accesos. Revisá que esté compartida con la cuenta de servicio.</p>}

      {conectada && !falloLectura && (
        <section aria-label={edicion ? 'Editar persona' : 'Agregar persona'} className="cj-panel">
          <h2 className="cj-etiqueta cj-etiqueta--laton">{edicion ? `Editar a ${edicion.nombre}` : 'Agregar persona'}</h2>
          <FormularioAcceso
            secciones={SECCIONES_ASIGNABLES.map((s) => ({ clave: s, etiqueta: ETIQUETA_ACCESO[s] }))}
            pestanas={[...PESTANAS_VENTAS]}
            edicion={edicion}
          />
        </section>
      )}

      <section aria-label="Personas con acceso">
        <h2 className="cj-etiqueta">Personas con acceso</h2>
        <div className="cj-tabla-scroll cfg-tabla">
          <table className="cj-tabla">
            <thead>
              <tr><th>Persona</th><th>Tipo</th><th>Puede ver</th><th><span className="cj-solo-lectores">Acciones</span></th></tr>
            </thead>
            <tbody>
              {fijas.map((a) => (
                <tr key={a.email}>
                  <td><strong>{a.nombre}</strong><br /><span className="cj-texto-2">{a.email}</span></td>
                  <td><span className={`cfg-chip ${a.admin ? 'cfg-chip--admin' : ''}`}>{a.admin ? 'Administrador' : ETIQUETA_ROL[a.rol]}</span><br /><span className="cj-texto-2">Lista fija (Vercel)</span></td>
                  <td className="cj-largo">{a.secciones.map((s) => ETIQUETA_ACCESO[s]).join(', ')}</td>
                  <td />
                </tr>
              ))}
              {personas.map((f) => (
                <tr key={f.email} className={f.activo ? undefined : 'cfg-baja'}>
                  <td><strong>{f.nombre}</strong><br /><span className="cj-texto-2">{f.email}</span></td>
                  <td>
                    <span className={`cfg-chip ${f.tipo === 'admin' ? 'cfg-chip--admin' : ''}`}>{f.tipo === 'admin' ? 'Administrador' : 'Acceso'}</span>
                    {!f.activo && <><br /><span className="cj-texto-2">Sin acceso (baja)</span></>}
                  </td>
                  <td className="cj-largo">
                    {f.tipo === 'admin' ? 'Todo, incluida Configuración' : (
                      <>{f.secciones.map((s) => ETIQUETA_ACCESO[s]).join(', ') || '—'}{f.pestanas.length > 0 && <><br /><span className="cj-texto-2">CRM: {f.pestanas.join(', ')}</span></>}</>
                    )}
                  </td>
                  <td className="cfg-fila-acciones">
                    {f.activo && <Link className="cj-boton cj-boton--secundario cfg-boton-chico" href={`/configuracion?editar=${encodeURIComponent(f.email)}`}>Editar</Link>}
                    {f.activo && f.email !== sesion.email && <BotonQuitar email={f.email} nombre={f.nombre} />}
                    {!f.activo && f.tipo && <Link className="cj-boton cj-boton--secundario cfg-boton-chico" href={`/configuracion?editar=${encodeURIComponent(f.email)}`}>Reactivar</Link>}
                  </td>
                </tr>
              ))}
              {fijas.length === 0 && personas.length === 0 && <tr><td colSpan={4} className="cj-texto-2">Todavía no hay personas.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="cj-texto-2 cfg-nota">Las cuentas de la lista fija de Vercel (<code>AUTH_USUARIOS</code>) siempre pueden entrar y no se cambian desde acá: son el respaldo para que nunca quede nadie afuera.</p>
      </section>
    </div>
  )
}
