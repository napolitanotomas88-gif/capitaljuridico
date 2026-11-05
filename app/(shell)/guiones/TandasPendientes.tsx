import Link from 'next/link'
import { Etiqueta, Tabla, Vacio, type Columna } from '@/components/ui'
import { PASOS, type TandaPendiente } from '@/lib/bot/guiones/resumen'

// Tandas del bot que esperan a alguien (5/11/2026: el Despacho decía «nada pendiente» mientras Discord pedía revisar; la tabla
// de abajo es por cliente y no ve las tandas de cj_guiones). Lo mismo que el resumen diario a Gero M, con link a cada tanda.
const hace = (dias: number) => (dias === 0 ? 'Hoy' : dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`)

const columnas: Columna<TandaPendiente>[] = [
  { clave: 'cliente', titulo: 'Cliente', largo: true, celda: t => (<><Link href={`/guiones/${encodeURIComponent(t.idCrm)}`}>{t.cliente}</Link><span className="cj-sub">{t.idCrm} · tanda {t.tanda}</span></>) },
  { clave: 'paso', titulo: 'Qué falta', celda: t => (<>{PASOS[t.paso].titulo}<span className="cj-sub">{t.falta}</span></>) },
  { clave: 'quien', titulo: 'Quién', celda: t => PASOS[t.paso].quien },
  { clave: 'desde', titulo: 'Desde', celda: t => hace(t.dias) },
]

export function TandasPendientes({ tandas, error }: { tandas: TandaPendiente[]; error?: boolean }) {
  return (
    <section className="cj-pila cj-pila--chica" style={{ gap: 16 }} aria-label="Tandas de guiones pendientes">
      <Etiqueta como="h2">Tandas pendientes ({tandas.length})</Etiqueta>
      {error
        ? <div className="cj-aviso"><p>No se pudieron leer las tandas de guiones ahora.</p></div>
        : <Tabla descripcion="Tandas de guiones que esperan revisión, check final o carga" columnas={columnas} filas={tandas} claveFila={t => String(t.id)} className="cj-tabla-compacta" vacio={<Vacio frase="No hay tandas esperando a nadie." />} />}
    </section>
  )
}
