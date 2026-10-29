import Link from 'next/link'
import { BotonEnlace, Tabla, type Columna } from '@/components/ui'
import { ETIQUETA_SENAL, UMBRAL_SATISFACCION_ALTA, UMBRAL_SATISFACCION_BAJA, type FilaContento, type MedicionContentos } from '@/lib/clientes/contentos'
import { numeroAR } from '@/lib/clientes/formato'

// Clientes contentos del CRM Clientes: a quién pedirle referidos. Dos tablas fijas: la medición (cuántos tienen cada dato) y los candidatos.
// La satisfacción (1 a 10) es una columna del Sheet que se va completando: mientras esté vacía, la señal sale del semáforo, la promesa y el testimonio.
interface FilaMedicion { clave: string; indicador: string; valor: string; como: string }

const pct = (n: number, d: number) => (d ? `${n} de ${d} (${Math.round((n / d) * 100)} %)` : `${n}`)

function filasMedicion(m: MedicionContentos): FilaMedicion[] {
  return [
    { clave: 'sat', indicador: 'Con satisfacción cargada (1 a 10)', valor: pct(m.conSatisfaccion, m.activos), como: 'Columna Satisfacción del CRM Clientes, cliente activo' },
    { clave: 'prom', indicador: 'Satisfacción promedio', valor: m.promedioSatisfaccion === null ? 'Sin datos todavía' : `${numeroAR(m.promedioSatisfaccion)} de 10`, como: 'Promedio de las cargadas' },
    { clave: 'verde', indicador: 'Semáforo verde', valor: pct(m.verdes, m.activos), como: 'Semáforo del CRM (renovación, cobros, avance)' },
    { clave: 'promesa', indicador: 'Promesa cumplida', valor: pct(m.promesaSi, m.activos), como: 'Columna Promesa = Sí' },
    { clave: 'test', indicador: 'Dieron testimonio', valor: pct(m.conTestimonio, m.activos), como: 'Columna Testimonio con contenido' },
    { clave: 'alta', indicador: ETIQUETA_SENAL.alta, valor: pct(m.porSenal.alta, m.activos), como: `Verde y (satisfacción ${UMBRAL_SATISFACCION_ALTA}+ o promesa cumplida y testimonio)` },
    { clave: 'media', indicador: ETIQUETA_SENAL.media, valor: pct(m.porSenal.media, m.activos), como: 'Verde y (promesa cumplida o testimonio)' },
    { clave: 'medir', indicador: ETIQUETA_SENAL.por_medir, valor: pct(m.porSenal.por_medir, m.activos), como: 'Sin señales suficientes: cargar su satisfacción' },
    { clave: 'no', indicador: ETIQUETA_SENAL.no_pedir, valor: pct(m.porSenal.no_pedir, m.activos), como: `Rojo o satisfacción ${UMBRAL_SATISFACCION_BAJA} o menos` },
  ]
}

type Props = { filas: FilaContento[]; medicion: MedicionContentos; sufijo: string; hojaUrl: string | null; verTodos: boolean }

export function ClientesContentos({ filas, medicion, sufijo, hojaUrl, verTodos }: Props) {
  const candidatos = filas.filter(f => (verTodos ? f.senal !== 'no_pedir' : f.senal === 'alta' || f.senal === 'media'))
  const hrefTodos = `/clientes/referidos${new URLSearchParams([...(sufijo ? [['demo', '1']] : []), ...(verTodos ? [] : [['contentos', 'todos']])]).toString().replace(/^(.)/, '?$1')}`
  const columnas: Columna<FilaContento>[] = [
    { clave: 'cliente', titulo: 'Cliente', largo: true, celda: f => <Link href={`/clientes/${encodeURIComponent(f.id)}${sufijo}`} className="cj-enlace">{f.nombre || f.id}</Link> },
    { clave: 'senal', titulo: 'Señal', celda: f => ETIQUETA_SENAL[f.senal] },
    { clave: 'semaforo', titulo: 'Semáforo', celda: f => f.semaforo || '—' },
    { clave: 'promesa', titulo: 'Promesa', celda: f => f.promesa || '—' },
    { clave: 'testimonio', titulo: 'Testimonio', celda: f => (f.testimonio ? 'Sí' : '—') },
    { clave: 'sat', titulo: 'Satisfacción (1–10)', numerica: true, celda: f => (f.satisfaccion === null ? 'Sin cargar' : f.satisfaccion) },
    { clave: 'ref', titulo: 'Referidos presentados', numerica: true, celda: f => f.referidosPresentados },
    { clave: 'motivos', titulo: 'Por qué', largo: true, celda: f => f.motivos.join(' · ') },
  ]
  return (
    <section id="clientes-contentos" className="cj-pila cj-pila--chica" aria-labelledby="clientes-contentos-titulo" style={{ gap: 20 }}>
      <div className="cj-base-cabecera">
        <div>
          <p className="cj-etiqueta cj-etiqueta--laton">Clientes contentos</p>
          <h2 id="clientes-contentos-titulo" className="cj-base-titulo">A quién pedirle referidos</h2>
        </div>
        {hojaUrl && <BotonEnlace href={hojaUrl} target="_blank" rel="noopener noreferrer">Cargar satisfacción en el CRM Clientes</BotonEnlace>}
      </div>
      <p className="cj-parrafo cj-texto-2">
        El programa parte de clientes contentos, medidos con datos. Hoy la satisfacción está sin cargar ({medicion.conSatisfaccion} de {medicion.activos}): la señal sale del semáforo, la promesa
        cumplida y el testimonio, y se afina sola a medida que se vaya completando la columna Satisfacción. Los criterios son una propuesta, no una regla del programa.
      </p>
      <Tabla descripcion="Medición de clientes contentos" columnas={[
        { clave: 'indicador', titulo: 'Qué se mide', largo: true },
        { clave: 'valor', titulo: 'Hoy' },
        { clave: 'como', titulo: 'De dónde sale', largo: true },
      ]} filas={filasMedicion(medicion)} claveFila={f => f.clave} />
      <Tabla descripcion="Clientes activos para pedir referidos" columnas={columnas} filas={candidatos} claveFila={f => f.id} />
      <p className="cj-parrafo cj-texto-2">
        {verTodos ? 'Se muestran también los que faltan medir.' : `Se muestran los ${candidatos.length} con señal para pedir ya.`}{' '}
        <Link href={hrefTodos} className="cj-enlace">{verTodos ? 'Ver solo los que tienen señal' : `Ver también los ${medicion.porSenal.por_medir} que faltan medir`}</Link>
      </p>
    </section>
  )
}
