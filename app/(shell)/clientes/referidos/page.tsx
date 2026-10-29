import type { Metadata } from 'next'
import { Resumen, SeccionTitulo, type DatoResumen } from '@/components/ui'
import { RegistrarReferido } from '@/components/clientes/RegistrarReferido'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { ESTADOS_REFERIDO, MOMENTOS_PEDIDO } from '@/lib/clientes/pestanasNuevas'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { AvisoLectura } from '@/components/clientes/AvisoLectura'
import { ErrorLectura } from '@/components/clientes/ErrorLectura'
import { exigirAcceso } from '@/lib/auth/sesion'
import { pedidoDemo } from '@/lib/clientes/demo'
import { fechaCorta } from '@/lib/clientes/formato'
import { REGLAS_REFERIDOS } from '@/lib/clientes/reglasReferidos'
import { resumirPrograma } from '@/lib/clientes/programa'
import { cargarVista, estadoDeLectura, type VistaCRM } from '@/lib/clientes/vista'
import { ReglasPrograma } from './_componentes/ReglasPrograma'
import { ResumenReferidos } from './_componentes/ResumenReferidos'
import { BaseReferidos } from './_componentes/BaseReferidos'
import { ClientesContentos } from './_componentes/ClientesContentos'
import { armarContentos } from '@/lib/clientes/contentos'
import { armarBaseReferidos, esCategoriaBase } from '@/lib/clientes/baseReferidos'

// Programa de referidos: reglas (leídas de lib/clientes/reglasReferidos.ts) y resultados (embudo, créditos, ranking).
// ?demo=1 muestra datos ficticios rotulados "(ejemplo)" para revisar el diseño: SOLO en desarrollo, en producción se ignora.

export const metadata: Metadata = { title: 'Referidos' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ReferidosPage({ searchParams }: Props) {
  const sesion = await exigirAcceso('referidos')
  const params = await searchParams
  const demo = pedidoDemo(params.demo)

  let vista: VistaCRM
  try {
    vista = await cargarVista(demo)
  } catch (e) {
    console.error('Referidos: no se pudo leer el CRM:', (e as Error).message?.slice(0, 200))
    return <ErrorLectura etiqueta="Referidos" titulo="Programa de referidos" volver="/clientes/referidos" />
  }

  const { datos } = vista
  const resumen = resumirPrograma(
    { clientes: datos.clientes, referidos: datos.referidos, movimientos: datos.movimientos, creditos: vista.creditos, hoy: datos.hoy, pestanasAusentes: datos.pestanasAusentes },
    datos.reglas,
  )
  const lectura = estadoDeLectura(datos)
  const filtroBase = (() => { const v = (params as Record<string, string | string[] | undefined>).base; const x = Array.isArray(v) ? v[0] : v; return esCategoriaBase(x) ? x : null })()
  const base = armarBaseReferidos({ referidos: datos.referidos, clientes: datos.clientes, creditos: vista.creditos, hoy: datos.hoy }, datos.reglas)
  const contentos = armarContentos({ clientes: datos.clientes, referidos: datos.referidos })
  const idHoja = process.env.SHEET_ID_CLIENTES
  const hojaUrl = !vista.esDemo && idHoja ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(idHoja)}` : null

  return (
    <div className="cj-pila">
      <SeccionTitulo
        etiqueta="Referidos"
        titulo="Programa de referidos"
        acciones={
          vista.esDemo ? undefined : (
            <p className="cj-etiqueta cj-seccion__meta">
              Datos de las {lectura.hora}
              <br />
              {lectura.dia} · hora argentina
            </p>
          )
        }
      />

      {vista.esDemo && (
        <div className="cj-panel">
          <p>
            <span className="cj-etiqueta cj-etiqueta--laton">Datos de ejemplo</span>
          </p>
          <p>
            Los clientes, referidos y créditos de esta pantalla son ficticios (ejemplo): sirven para revisar el diseño y solo existen en desarrollo con ?demo=1. No
            salen de la planilla.
          </p>
          <p>
            El programa real arranca el {fechaCorta(REGLAS_REFERIDOS.vigenteDesde)}, así que todavía no tendría créditos liberados. Para poder mostrarlos, el ejemplo se
            calcula con el inicio del programa el {fechaCorta(datos.reglas?.vigenteDesde)}; las demás reglas son las reales.
          </p>
        </div>
      )}

      <AvisoLectura lectura={lectura} />

      {/* Mini panel (25/10/2026): el embudo del programa y los créditos disponibles, de un vistazo */}
      <Resumen titulo="Resumen del programa" datos={((): DatoResumen[] => {
        const sin = datos.pestanasAusentes.includes('Referidos')
        const { embudo: e, creditos: cr } = resumen
        const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} % de los presentados` : 'Todavía sin presentados')
        return [
          { etiqueta: 'Presentados', icono: 'referidos', destacado: true, valor: sin ? '—' : e.presentados, contexto: sin ? 'Falta la pestaña “Referidos” en la planilla' : 'Personas que nos recomendaron', href: '#base-referidos', accion: 'Ver la base' },
          { etiqueta: 'Asistieron', icono: 'calendario', valor: sin ? '—' : e.asistieron, contexto: sin ? '—' : pct(e.asistieron, e.presentados) },
          { etiqueta: 'Cerraron', icono: 'ok', valor: sin ? '—' : e.cerraron, contexto: sin ? '—' : pct(e.cerraron, e.presentados), estado: !sin && e.cerraron > 0 ? { tono: 'ok', texto: 'Nuevos clientes' } : undefined },
          { etiqueta: 'Créditos disponibles', icono: 'credito', valor: <>{cr.disponiblesMeses}<span className="cj-dato__unidad">{cr.disponiblesMeses === 1 ? 'mes' : 'meses'}</span></>, contexto: `USD ${cr.usdDisponible.toLocaleString('es-AR')} sin canjear`, estado: cr.porVencerMeses > 0 ? { tono: 'atencion', texto: `${cr.porVencerMeses} por vencer` } : undefined },
        ]
      })()} />

      {!vista.esDemo && (
        <section className="cj-pila cj-pila--chica" aria-label="Registrar referido">
          <RegistrarReferido
            opciones={datos.clientes.filter(c => c.id && !c.sinId).map(c => ({ id: c.id, nombre: c.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))}
            momentos={MOMENTOS_PEDIDO}
            hoy={hoyArgentina()}
          />
        </section>
      )}

      <ClientesContentos filas={contentos.filas} medicion={contentos.medicion} sufijo={vista.esDemo ? '?demo=1' : ''} hojaUrl={hojaUrl} verTodos={params.contentos === 'todos'} />

      <BaseReferidos filas={base} filtro={filtroBase} sufijo={vista.esDemo ? '?demo=1' : ''} hojaUrl={hojaUrl} pestanaAusente={datos.pestanasAusentes.includes('Referidos')}
        edicion={!vista.esDemo && puedeHacerAcciones(sesion.email)
          ? { estados: ESTADOS_REFERIDO, hoy: hoyArgentina(), clientes: datos.clientes.filter(c => c.id && !c.sinId).map(c => ({ id: c.id, nombre: c.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) }
          : null} />

      <ReglasPrograma />
      <ResumenReferidos resumen={resumen} pestanasAusentes={datos.pestanasAusentes} sufijo={vista.esDemo ? '?demo=1' : ''} />
    </div>
  )
}
