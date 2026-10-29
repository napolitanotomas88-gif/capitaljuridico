import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Boton, Cifra, ChipSemaforo, Etiqueta, Filete, SeccionTitulo, Tabla, Vacio, type Columna } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { DemoBotones, DemoBusqueda, DemoFiltros } from './_componentes/Interactivos'
import { PaletaYContrastes } from './_componentes/PaletaYContrastes'

// Revisión de marca de un vistazo: tokens, tipografías y primitivas en uso. SOLO en desarrollo.
// Los datos de la tabla son inventados (estudios "Demo"), no hay datos reales de clientes acá.

export const metadata: Metadata = { title: 'Sistema de diseño' }

type FilaDemo = { id: string; nombre: string; fin: string; cobrado: string; estado: 'verde' | 'amarillo' | 'rojo' | 'gris' }

const FILAS: FilaDemo[] = [
  { id: 'D001', nombre: 'Estudio Demo Uno', fin: '2026-12-18', cobrado: '4.000', estado: 'verde' },
  { id: 'D002', nombre: 'Estudio Demo Dos', fin: '2026-10-14', cobrado: '2.500', estado: 'amarillo' },
  { id: 'D003', nombre: 'Estudio Demo Tres', fin: '2026-09-30', cobrado: '1.250', estado: 'rojo' },
  { id: 'D004', nombre: 'Estudio Demo Cuatro', fin: '—', cobrado: '0', estado: 'gris' },
]

const COLUMNAS: Columna<FilaDemo>[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'nombre', titulo: 'Nombre' },
  { clave: 'fin', titulo: 'Fin del período', numerica: true },
  { clave: 'cobrado', titulo: 'Cobrado (USD)', numerica: true },
  { clave: 'estado', titulo: 'Vencimiento', celda: (f) => <ChipSemaforo estado={f.estado} /> },
]

function Bloque({ etiqueta, titulo, children }: { etiqueta: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="cj-pila cj-pila--chica" style={{ gap: 32 }}>
      <SeccionTitulo etiqueta={etiqueta} titulo={titulo} nivel={2} />
      {children}
    </section>
  )
}

export default async function SistemaPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  await exigirAcceso('resumen')

  return (
    <div className="cj-pila" style={{ gap: 96 }}>
      <SeccionTitulo etiqueta="Sistema de diseño" titulo="Capital Jurídico" />

      <Bloque etiqueta="Color" titulo="Paleta y contrastes">
        <PaletaYContrastes />
      </Bloque>

      <Bloque etiqueta="Tipografía" titulo="Bodoni y Archivo">
        <div className="cj-pila cj-pila--chica" style={{ gap: 28 }}>
          <div className="cj-pila cj-pila--chica" style={{ gap: 8 }}>
            <Etiqueta>Título de página · Bodoni Moda 30 a 46 px (solo títulos y cifras)</Etiqueta>
            <p className="cj-titulo" style={{ margin: 0 }}>Clientes en renovación</p>
          </div>
          <div className="cj-pila cj-pila--chica" style={{ gap: 8 }}>
            <Etiqueta>Título de sección · Bodoni Moda 24 a 30 px</Etiqueta>
            <p className="cj-titulo cj-titulo--seccion" style={{ margin: 0 }}>Vencimientos de las próximas dos semanas</p>
          </div>
          <div className="cj-pila cj-pila--chica" style={{ gap: 8 }}>
            <Etiqueta>Cuerpo · Archivo 15 px</Etiqueta>
            <p style={{ margin: 0, maxWidth: '62ch' }}>
              Los textos largos van siempre en Archivo. Las cifras y los títulos son lo único que usa Bodoni, para que la
              serifa de alto contraste quede como firma y no como ruido.
            </p>
          </div>
          <div className="cj-pila cj-pila--chica" style={{ gap: 8 }}>
            <Etiqueta>Tabla densa · Archivo 14 px · cifras tabulares</Etiqueta>
            <p className="cj-num" style={{ margin: 0, fontSize: 14 }}>
              1.111 · 0.000 · 8.888 · 4.000 (los cuatro ocupan el mismo ancho)
            </p>
          </div>
        </div>
      </Bloque>

      <Bloque etiqueta="Cifras" titulo="Estilo expediente">
        <div className="cj-rejilla">
          <Cifra etiqueta="Clientes activos" valor="64" contexto="Agencia, al 6/10/2026" />
          <Cifra etiqueta="Cobrado del mes (USD)" valor="18.400" contexto="Octubre 2026, hasta hoy" />
          <Cifra etiqueta="Renovaciones" valor="7" contexto="Próximos 14 días" />
        </div>
        <div className="cj-rejilla">
          <Cifra tamano="media" etiqueta="Referidos en curso" valor="12" contexto="Ciclo actual" />
          <Cifra tamano="media" etiqueta="Cierres liberados" valor="3" contexto="Últimos 30 días" />
        </div>
      </Bloque>

      <Bloque etiqueta="Datos" titulo="Tabla y semáforo">
        <Tabla descripcion="Clientes de ejemplo" columnas={COLUMNAS} filas={FILAS} claveFila={(f) => f.id} />
        <div className="cj-fila" style={{ gap: 32 }}>
          <ChipSemaforo estado="verde" />
          <ChipSemaforo estado="amarillo" />
          <ChipSemaforo estado="rojo" />
          <ChipSemaforo estado="gris" />
        </div>
      </Bloque>

      <Bloque etiqueta="Controles" titulo="Filtros, botones y búsqueda">
        <DemoFiltros />
        <DemoBotones />
        <DemoBusqueda />
      </Bloque>

      <Bloque etiqueta="Superficies" titulo="Panel, aviso, filete y vacío">
        <div className="cj-panel cj-pila cj-pila--chica" style={{ gap: 16 }}>
          <Etiqueta tono="laton">Panel Sala</Etiqueta>
          <p style={{ margin: 0 }}>Superficie de agrupación. El texto secundario pasa a humo claro para mantener 4.5:1.</p>
          <p className="cj-texto-2" style={{ margin: 0, fontSize: 14 }}>Texto secundario dentro del panel.</p>
          <div className="cj-fila" style={{ gap: 24 }}>
            <ChipSemaforo estado="verde" />
            <ChipSemaforo estado="amarillo" />
            <ChipSemaforo estado="rojo" />
          </div>
        </div>
        <div className="cj-aviso">
          <p style={{ margin: 0 }}>Aviso sobre Borgoña: todo el texto va en hueso. Se usa solo para alertas reales.</p>
        </div>
        <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
          <Filete />
          <Filete fuerte />
        </div>
        <Vacio frase="Todavía no hay referidos cargados en este ciclo." accion={<Boton>Cargar el primero</Boton>} />
      </Bloque>
    </div>
  )
}
