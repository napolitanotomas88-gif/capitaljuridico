import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErrorLectura } from '@/components/clientes/ErrorLectura'
import { Estado } from '@/components/ui'
import { destinoSinPermiso } from '@/lib/auth/hubClientes'
import { accesoPortal, idsConMailDePortal } from '@/lib/auth/portal'
import { puedeVer, rutaInicial } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'
import { armarPortal, type PaginaPortal } from '@/lib/clientes/portal/armar'
import { EditorPortal } from './_componentes/EditorPortal'
import { VistaPortal } from './_componentes/VistaPortal'

// Portal del cliente (2/11/2026): /clientes/portal/<ID>. Lo abre el CLIENTE con su cuenta de Google (mail en
// PORTAL_CLIENTES_JSON, atado a ESTE ID) para leer, y el equipo con la Cartera para leer y editar. Barreras: proxy (lib/auth/rutas.ts
// decidir: el cliente solo llega a SU portal) y, acá de nuevo, accesoPortal (lib/auth/portal.ts). Sin montos ni datos de otros.

type Props = { params: Promise<{ id: string }> }

export const metadata: Metadata = { title: 'Portal del cliente' }

export default async function PortalClientePage({ params }: Props) {
  const { id } = await params
  const sesion = await obtenerSesion({ incluirCliente: true })
  if (!sesion) redirect('/entrar')
  const acceso = accesoPortal(sesion, id, puedeVer(sesion, 'clientes'), destinoSinPermiso(sesion, 'clientes', rutaInicial))
  if (acceso.tipo === 'no_existe') notFound()
  if (acceso.tipo === 'redirigir') redirect(acceso.destino)

  let pagina: PaginaPortal | null
  try {
    pagina = await armarPortal(acceso.id)
  } catch (e) {
    console.error('[portal] no se pudo armar:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    if (acceso.tipo === 'cliente') return <ErrorPortal />
    return <ErrorLectura etiqueta="Clientes" titulo="Portal del cliente" volver={`/clientes/portal/${acceso.id}`} />
  }
  if (!pagina) notFound()

  if (acceso.tipo === 'cliente') return <VistaPortal p={pagina} />

  // Equipo: el panel para armarlo y, abajo, exactamente lo que ve el cliente
  const conMail = idsConMailDePortal().has(pagina.id)
  return (
    <div className="cj-pila">
      <section className="cj-panel cj-pila cj-pila--chica" aria-labelledby="portal-equipo">
        <div className="cj-fila" style={{ justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p className="cj-etiqueta cj-etiqueta--laton">Portal del cliente · solo lo ve el equipo</p>
            <h1 id="portal-equipo" className="cj-titulo cj-titulo--seccion">{pagina.nombreCRM} <span className="cj-texto-2">({pagina.id})</span></h1>
          </div>
          {conMail
            ? <Estado tono="ok">El cliente ya puede entrar con su mail</Estado>
            : <Estado tono="atencion">Falta habilitar el mail del cliente</Estado>}
        </div>
        <p className="cj-parrafo cj-texto-2">
          Lo que cargues acá lo ve el cliente debajo, tal cual. Guiones y proceso salen solos del Despacho (solo tandas aprobadas o
          enviadas, sin nada interno). {conMail ? '' : 'Para darle acceso, sumá su mail a PORTAL_CLIENTES_JSON en Vercel.'}
        </p>
        {pagina.avisos.map(a => <p key={a} className="cj-formulario__error" role="alert">{a}</p>)}
        <details className="cj-detalles" open={pagina.portal.version === 0}>
          <summary><strong>Editar el portal</strong></summary>
          <div style={{ marginTop: 16 }}>
            <EditorPortal id={pagina.id} inicial={pagina.portal.datos} version={pagina.portal.version} nombreCRM={pagina.nombreCRM} />
          </div>
        </details>
      </section>
      <p className="cj-etiqueta">Así lo ve el cliente</p>
      <VistaPortal p={pagina} />
    </div>
  )
}

function ErrorPortal() {
  return (
    <div className="cj-pila">
      <div className="cj-aviso" role="alert">
        <p>No pudimos cargar tu portal en este momento. Probá de nuevo en un minuto.</p>
      </div>
    </div>
  )
}
