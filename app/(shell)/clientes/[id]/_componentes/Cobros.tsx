import { Cifra } from '@/components/ui'
import Link from 'next/link'
import { Monto } from '@/components/clientes/Monto'
import type { FichaCliente } from '@/lib/clientes/ficha'
import { fechaCorta, numeroAR, textoDias } from '@/lib/clientes/formato'
import { SeccionFicha } from './SeccionFicha'

// Contratado del CRM y cobrado verificado directamente contra Finanzas e histórico.
export function Cobros({ f, accionHref }: { f: FichaCliente; accionHref?: string }) {
  const { cobros: c } = f
  const num = (n: number | null) => (n === null ? '—' : <Monto>{numeroAR(n)}</Monto>)
  const sinCargar = 'Sin cargar en la planilla'
  return (
    <SeccionFicha id="cobros" etiqueta="Cobros" titulo="Contratado, cobrado y saldo">
      <div className="cj-rejilla">
        <Cifra tamano="media" etiqueta="Contratado (USD)" valor={num(c.contratado)} contexto={c.contratado === null ? sinCargar : 'LTV contratado'} />
        <Cifra tamano="media" etiqueta="Cobrado (USD)" valor={num(c.cobrado)} contexto={c.cobrado === null ? (c.aviso ? 'Pendiente de verificar' : sinCargar) : 'Finanzas + pagos históricos'} />
        <Cifra
          tamano="media"
          etiqueta="Saldo (USD)"
          valor={num(c.saldo)}
          contexto={c.saldo === null ? 'Falta contratado o cobrado' : c.saldoRelevante ? 'Pendiente de cobro' : 'Sin saldo pendiente'}
        />
        <Cifra
          tamano="media"
          className="cj-cifra--fecha"
          etiqueta="Próximo cobro"
          valor={c.proximoCobro ? fechaCorta(c.proximoCobro) : '—'}
          contexto={c.proximoCobro ? textoDias(c.proximoCobroDias) : 'Sin fecha de cobro cargada'}
        />
      </div>
      {c.aviso && <p role="status" className="cj-aviso">{c.aviso}</p>}
      {accionHref && <p><Link className="cj-enlace" href={accionHref}>Agregar pago</Link></p>}
    </SeccionFicha>
  )
}
