'use client'

// ── Vínculos de cuentas: lo que falta unir entre las cuentas de Meta y los clientes (13/11/2026) ─────────────────────────
// Lo arma lib/anuncios/vinculos.ts. Solo muestra: la vinculación se sigue cargando en la pestaña «Cuentas Meta» del CRM (se
// toma en 5 minutos, sin deploy), y cada línea dice qué fila agregar. Mismo estilo que las otras solapas del tablero.
import { fmtGasto } from '@/lib/anuncios/formato'
import { filaCuentasMeta, type Vinculos } from '@/lib/anuncios/vinculos'

const NOMBRE_VINCULO = { ajuste: 'ajuste privado', planilla: '«Cuentas Meta»', ficha: 'ficha de kickoff', nombre: 'nombre' } as const
const idCorto = (id: string) => id.replace(/^act_/, '')

export function PanelVinculos({ vinculos }: { vinculos: Vinculos | undefined }) {
  if (!vinculos) return null
  const { clientesSinCuenta, cuentasSinCliente, vinculadasSinGasto } = vinculos
  const total = clientesSinCuenta.length + cuentasSinCliente.length
  if (!total && !vinculadasSinGasto.length) return null
  const linea = { borderBottom: '1px solid var(--filete)' }
  const ayuda = { color: 'var(--humo)', fontSize: 13 }
  return <details id="vinculos" aria-label="Vínculos de cuentas" className="anu-solapa">
    <summary className="etq-laton">
      Vínculos de cuentas: {clientesSinCuenta.length} sin cuenta, {cuentasSinCliente.length} sin cliente{vinculadasSinGasto.length ? `, ${vinculadasSinGasto.length} vinculadas sin gasto` : ''}
    </summary>
    <p className="mt-3" style={ayuda}>Se cargan a mano en la pestaña «Cuentas Meta» del CRM (A = id de la cuenta, B = SI, C = nombre exacto del cliente en Agencia). El tablero la relee cada 5 minutos.</p>

    {clientesSinCuenta.length > 0 && <section aria-label="Clientes sin cuenta vinculada" className="mt-6">
      <h3 className="etq-laton">Clientes sin cuenta vinculada · {clientesSinCuenta.length}</h3>
      <p className="mt-1" style={ayuda}>Activos en el CRM, sin fila en el tablero y sin ninguna cuenta unida (a mano, por la ficha de kickoff o por el nombre).</p>
      <ul className="mt-2">{clientesSinCuenta.map(c => <li key={c.idCrm ?? c.cliente} className="py-3" style={linea}>
        <div style={{ fontSize: 15, color: 'var(--hueso)' }}>{c.cliente}{c.idCrm ? <span style={{ color: 'var(--humo)', fontSize: 12 }}> · {c.idCrm}</span> : null}</div>
        {c.sugerida && <div className="mt-1" style={{ fontSize: 13 }}>Se parece por el apellido: {c.sugerida.nombre} ({idCorto(c.sugerida.id)}). Confirmar que es suya antes de cargarla.</div>}
        {c.nota && <div className="mt-1" style={{ fontSize: 13, color: 'var(--laton)' }}>{c.nota}</div>}
        <div className="mt-1 num" style={ayuda}>{filaCuentasMeta(c.sugerida?.id ?? null, c.cliente)}</div>
      </li>)}</ul>
    </section>}

    {cuentasSinCliente.length > 0 && <section aria-label="Cuentas con gasto sin cliente" className="mt-6">
      <h3 className="etq-laton">Cuentas con gasto sin cliente · {cuentasSinCliente.length}</h3>
      <p className="mt-1" style={ayuda}>Gastaron en los últimos 7 días y no se pudieron unir a nadie del CRM. Solo las que el tablero ya sigue.</p>
      <ul className="mt-2">{cuentasSinCliente.map(c => <li key={c.id} className="py-3" style={linea}>
        <div style={{ fontSize: 15, color: 'var(--hueso)' }}>{c.cuenta} <span style={{ color: 'var(--humo)', fontSize: 12 }}>· {idCorto(c.id)}{c.negocio ? ` · portfolio ${c.negocio}` : ''}</span></div>
        <div className="mt-1 num" style={{ fontSize: 13 }}>Gasto en 7 días: {fmtGasto(c.gastoD7, c.moneda)}</div>
        <div className="mt-1 num" style={ayuda}>{filaCuentasMeta(c.id, 'nombre exacto del cliente')}</div>
      </li>)}</ul>
    </section>}

    {vinculadasSinGasto.length > 0 && <section aria-label="Vinculadas, sin gasto todavía" className="mt-6">
      <h3 className="etq-laton">Vinculadas, sin gasto todavía · {vinculadasSinGasto.length}</h3>
      <p className="mt-1" style={ayuda}>Unidas a un cliente activo, sin gasto en las últimas 5 semanas. Entran a la tabla cuando gasten.</p>
      <ul className="mt-2">{vinculadasSinGasto.map(c => <li key={c.id} className="py-3" style={linea}>
        <div style={{ fontSize: 15, color: 'var(--hueso)' }}>{c.cliente}</div>
        <div className="mt-1" style={ayuda}>{c.cuenta} ({idCorto(c.id)}) · por {NOMBRE_VINCULO[c.vinculo]}</div>
      </li>)}</ul>
    </section>}
  </details>
}
