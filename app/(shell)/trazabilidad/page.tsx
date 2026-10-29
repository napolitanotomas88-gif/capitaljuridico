import type { Metadata } from 'next'
import Link from 'next/link'
import { exigirAcceso } from '@/lib/auth/sesion'
import { Cifra, SeccionTitulo, Tabla, Vacio, type Columna } from '@/components/ui'
import { cargarDatos, type DatosTraz } from '@/lib/trazabilidad/leads'
import { META_N, mesDe, umbral, type LeadTraz } from '@/lib/trazabilidad/modelo'
import { anguloDePieza } from '@/lib/trazabilidad/reporte'
import { procesarAhora } from './acciones'
import { Capa, Direccional, SubNav, fechaCorta, nombreMes, rutaLead, usd } from './_componentes/comunes'
import { FormAccion } from './_componentes/FormAccion'

export const metadata: Metadata = { title: 'Trazabilidad' }
export const dynamic = 'force-dynamic'

type Busqueda = Promise<{ mes?: string; grupo?: string }>

// Cierres: la muestra del método (cobró ≥ 1ª cuota) y el grupo de contraste, con el estado de sus tres capas.
export default async function TrazabilidadPage({ searchParams }: { searchParams: Busqueda }) {
  await exigirAcceso('trazabilidad')
  const q = await searchParams
  let datos: DatosTraz | null = null
  let error = ''
  try {
    datos = await cargarDatos()
  } catch (e) {
    error = (e as Error).message
  }
  if (!datos) {
    return (
      <div className="cj-pila">
        <SeccionTitulo etiqueta="Trazabilidad" titulo="Cierres y contenido" />
        <SubNav actual="/trazabilidad" />
        <p className="traz-error" role="alert">No se pudieron leer los datos: {error}</p>
      </div>
    )
  }

  const meses = [...new Set(datos.leads.map((l) => mesDe(l.cierre)).filter((m): m is string => !!m))].sort().reverse()
  const mes = q.mes === 'todo' || (q.mes && meses.includes(q.mes)) ? q.mes : 'todo'
  const grupo = q.grupo === 'contraste' || q.grupo === 'todos' ? q.grupo : 'muestra'
  const delPeriodo = datos.leads.filter((l) => mes === 'todo' || mesDe(l.cierre) === mes)
  const filas = delPeriodo.filter((l) => grupo === 'todos' || l.cierre.grupo === grupo)
  const muestra = delPeriodo.filter((l) => l.cierre.grupo === 'muestra')
  const nTotal = datos.leads.filter((l) => l.cierre.grupo === 'muestra').length
  const nombreAngulo = new Map(datos.angulos.map((a) => [a.id, a.nombre]))
  const piezas = datos.piezas
  const href = (m: string, g: string) => `/trazabilidad?mes=${m}&grupo=${g}`

  const columnas: Columna<LeadTraz>[] = [
    { clave: 'fecha', titulo: 'Llamada', celda: (l) => fechaCorta(l.cierre.fecha) },
    { clave: 'nombre', titulo: 'Lead', celda: (l) => <Link className="traz-link" href={rutaLead(l.cierre.clave)}>{l.cierre.nombre}</Link> },
    { clave: 'cobrado', titulo: 'Cobrado', numerica: true, celda: (l) => usd(l.cierre.cobrado) },
    { clave: 'concepto', titulo: 'Concepto', celda: (l) => l.cierre.concepto },
    { clave: 'capas', titulo: 'Setting · Llamada', alinear: 'centro', celda: (l) => (
      <>
        <Capa estado={l.setting?.analisis ? 'si' : l.setting?.error ? 'error' : 'no'} titulo={l.setting?.analisis ? 'Setting analizado' : l.setting ? 'Setting sin analizar' : 'Sin setting'} />
        {' '}
        <Capa estado={l.llamada?.analisis ? 'si' : l.llamada?.error ? 'error' : 'no'} titulo={l.llamada?.analisis ? 'Llamada analizada' : l.llamada?.error ?? 'Sin llamada'} />
      </>
    ) },
    { clave: 'gatillo', titulo: 'Ángulo gatillo', largo: true, celda: (l) => {
      const a = l.setting?.analisis
      if (!a?.pieza_gatillo) return '—'
      const p = a.piezas.find((x) => x.etiqueta === a.pieza_gatillo)
      const id = anguloDePieza(a.pieza_gatillo, p?.angulo ?? null, piezas)
      return id ? nombreAngulo.get(id) ?? id : 'Sin ángulo asignado'
    } },
    { clave: 'ciclo', titulo: 'Ciclo', numerica: true, celda: (l) => (l.setting?.analisis?.ciclo_dias != null ? `${l.setting.analisis.ciclo_dias} d` : '—') },
    { clave: 'fuente', titulo: 'Fuente', celda: (l) => l.cierre.fuente || '—' },
  ]

  return (
    <div className="cj-pila">
      <SeccionTitulo
        etiqueta="Trazabilidad"
        titulo="Cierres y contenido"
        acciones={<FormAccion accion={procesarAhora} boton="Procesar pendientes" pendiente="Procesando (puede tardar 2 min)…" className="" />}
      />
      <SubNav actual="/trazabilidad" />
      <p className="traz-texto">
        Entran a la muestra los cierres que cobraron <strong>{usd(umbral())} o más</strong> (1ª cuota del programa). El resto queda como
        grupo de contraste. Cada cierre junta tres capas: el CRM, el setting (botonera de ManyChat) y la llamada (Fathom).
      </p>

      <div className="cj-rejilla">
        <Cifra etiqueta="Muestra" valor={muestra.length} contexto={mes === 'todo' ? 'todos los meses' : nombreMes(mes!)} />
        <Cifra etiqueta="Con setting" valor={`${muestra.filter((l) => l.setting?.analisis).length}/${muestra.length}`} contexto="resumen de la botonera analizado" />
        <Cifra etiqueta="Con llamada" valor={`${muestra.filter((l) => l.llamada?.analisis).length}/${muestra.length}`} contexto="Fathom analizado" />
        <Cifra etiqueta="Contraste" valor={delPeriodo.length - muestra.length} contexto={`cobró menos de ${usd(umbral())}`} />
      </div>
      <Direccional n={nTotal} meta={META_N} />

      <div className="cj-pila cj-pila--chica">
        <div className="cj-fila" role="group" aria-label="Mes">
          <Link className="cj-chip" aria-current={mes === 'todo' ? 'page' : undefined} href={href('todo', grupo)}>Todos</Link>
          {meses.map((m) => (
            <Link key={m} className="cj-chip" aria-current={m === mes ? 'page' : undefined} href={href(m, grupo)}>{nombreMes(m)}</Link>
          ))}
        </div>
        <div className="cj-fila" role="group" aria-label="Grupo">
          {(['muestra', 'contraste', 'todos'] as const).map((g) => (
            <Link key={g} className="cj-chip" aria-current={g === grupo ? 'page' : undefined} href={href(mes!, g)}>
              {g === 'muestra' ? 'Muestra' : g === 'contraste' ? 'Contraste' : 'Todos'}
            </Link>
          ))}
        </div>
        <Tabla descripcion="Cierres del CRM con el estado de sus capas" columnas={columnas} filas={filas} claveFila={(l) => l.cierre.clave} vacio={<Vacio frase="No hay cierres en este período." />} />
        <p className="traz-nota">● analizado · ○ falta · ! hubo un error (abrí el lead para ver el motivo). Leído del CRM {new Date(datos.leidoEn).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })}.</p>
      </div>
    </div>
  )
}
