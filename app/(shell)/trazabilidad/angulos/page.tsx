import type { Metadata } from 'next'
import { exigirAcceso } from '@/lib/auth/sesion'
import { SeccionTitulo, Tabla, Vacio } from '@/components/ui'
import { BOLSAS, ETIQUETA_BOLSA, type Angulo } from '@/lib/trazabilidad/catalogo'
import { listarAngulos, listarPiezas, listarSetting } from '@/lib/trazabilidad/db'
import type { TipoPieza } from '@/lib/trazabilidad/modelo'
import { asignarPieza, guardarAngulo } from '../acciones'
import { SubNav } from '../_componentes/comunes'
import { FormAccion } from '../_componentes/FormAccion'

export const metadata: Metadata = { title: 'Ángulos · Trazabilidad' }
export const dynamic = 'force-dynamic'

const TIPOS: TipoPieza[] = ['reel', 'carrusel', 'historia', 'anuncio', 'otro']
type FilaPieza = { etiqueta: string; angulo: string | null; tipo: TipoPieza; origen: 'ia' | 'manual'; leads: number; gatillo: number }

// Catálogo de ángulos (con su bolsa) y la asignación de cada pieza de contenido (etiqueta de ManyChat) a un ángulo.
// La IA propone el ángulo de cada pieza nueva; lo que se asigna acá a mano manda y la IA no lo vuelve a tocar.
export default async function AngulosPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await exigirAcceso('trazabilidad')
  const { ver } = await searchParams
  const [angulos, piezas, envios] = await Promise.all([listarAngulos(), listarPiezas(), listarSetting()])
  const filas = new Map<string, FilaPieza>()
  for (const p of piezas.values()) filas.set(p.etiqueta, { ...p, leads: 0, gatillo: 0 })
  for (const e of envios) for (const p of e.analisis?.piezas ?? []) {
    const f = filas.get(p.etiqueta) ?? { etiqueta: p.etiqueta, angulo: p.angulo, tipo: p.tipo, origen: 'ia' as const, leads: 0, gatillo: 0 }
    f.leads++
    if (e.analisis?.pieza_gatillo === p.etiqueta) f.gatillo++
    filas.set(p.etiqueta, f)
  }
  const todas = [...filas.values()].sort((a, b) => b.gatillo - a.gatillo || b.leads - a.leads || a.etiqueta.localeCompare(b.etiqueta))
  const lista = ver === 'todas' ? todas : todas.filter((f) => !f.angulo || f.origen === 'ia')

  const selectAngulo = (actual: string | null) => (
    <select name="angulo" defaultValue={actual ?? ''} aria-label="Ángulo">
      <option value="">Sin ángulo</option>
      {angulos.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.descartado ? ' (descartado)' : ''}</option>)}
    </select>
  )

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Trazabilidad · Catálogo" titulo="Ángulos y piezas" />
      <SubNav actual="/trazabilidad/angulos" />

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Piezas" titulo={ver === 'todas' ? `Todas las piezas (${todas.length})` : `Piezas para revisar (${lista.length} de ${todas.length})`}
          acciones={<a className="cj-chip" href={ver === 'todas' ? '/trazabilidad/angulos' : '/trazabilidad/angulos?ver=todas'}>{ver === 'todas' ? 'Solo para revisar' : 'Ver todas'}</a>} />
        <p className="traz-texto">Cada pieza es una etiqueta de ManyChat (el nombre del flujo del reel, carrusel o historia). «Para revisar» = sin ángulo o con el ángulo que propuso la IA. Al guardar, queda fijo.</p>
        <Tabla<FilaPieza>
          descripcion="Piezas de contenido y su ángulo"
          filas={lista}
          claveFila={(f) => f.etiqueta}
          vacio={<Vacio frase={todas.length ? 'No hay piezas para revisar.' : 'Todavía no llegó ningún envío de la botonera.'} />}
          columnas={[
            { clave: 'etiqueta', titulo: 'Pieza', largo: true },
            { clave: 'leads', titulo: 'Leads', numerica: true },
            { clave: 'gatillo', titulo: 'Gatillo', numerica: true },
            { clave: 'asignar', titulo: 'Ángulo y tipo', celda: (f) => (
              <FormAccion accion={asignarPieza} boton="Guardar" className="traz-inline">
                <input type="hidden" name="etiqueta" value={f.etiqueta} />
                {selectAngulo(f.angulo)}
                <select name="tipo" defaultValue={f.tipo} aria-label="Tipo">{TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <span className="traz-nota">{f.origen === 'manual' ? 'asignado a mano' : f.angulo ? 'propuesto por IA' : ''}</span>
              </FormAccion>
            ) },
          ]}
        />
      </section>

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Catálogo" titulo={`Ángulos (${angulos.length})`} />
        <p className="traz-texto">Semilla: los 7 ángulos de la estrategia del motor de contenido (488 llamadas), sus cadenas y los descartados. La bolsa la decide el equipo: siembra atrae, cosecha nutre, urgencia cierra.</p>
        <Tabla<Angulo>
          descripcion="Catálogo de ángulos"
          filas={angulos}
          claveFila={(a) => a.id}
          columnas={[
            { clave: 'nombre', titulo: 'Ángulo', largo: true, celda: (a) => <>{a.nombre}<br /><span className="traz-nota">{a.descripcion}</span></> },
            { clave: 'editar', titulo: 'Bolsa', celda: (a) => (
              <FormAccion accion={guardarAngulo} boton="Guardar" className="traz-inline">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="nombre" value={a.nombre} />
                <input type="hidden" name="descripcion" value={a.descripcion} />
                <select name="bolsa" defaultValue={a.bolsa ?? ''} aria-label="Bolsa">
                  <option value="">Sin bolsa</option>
                  {BOLSAS.map((b) => <option key={b} value={b}>{ETIQUETA_BOLSA[b]}</option>)}
                </select>
                <select name="descartado" defaultValue={a.descartado ? 'si' : 'no'} aria-label="Estado">
                  <option value="no">Vigente</option>
                  <option value="si">Descartado</option>
                </select>
              </FormAccion>
            ) },
          ]}
        />
        <details>
          <summary className="cj-etiqueta">Agregar un ángulo nuevo</summary>
          <FormAccion accion={guardarAngulo} boton="Agregar">
            <input type="text" name="nombre" placeholder="Nombre del ángulo" aria-label="Nombre" />
            <textarea name="descripcion" placeholder="De qué habla (una línea)" aria-label="Descripción" style={{ minHeight: 70 }} />
            <select name="bolsa" defaultValue="" aria-label="Bolsa">
              <option value="">Sin bolsa</option>
              {BOLSAS.map((b) => <option key={b} value={b}>{ETIQUETA_BOLSA[b]}</option>)}
            </select>
          </FormAccion>
        </details>
      </section>
    </div>
  )
}
