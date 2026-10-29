'use client'
import type { FinanzasApi } from '@/lib/finanzas'
import { Aviso, Barra, Etiqueta, Seccion, fmtArs, fmtPct, fmtUsd } from './ui'

type P = { d: FinanzasApi }

// ── Entradas ──────────────────────────────────────────────────────────────────────────
export function Entradas({ d }: P) {
  const e = d.entradas
  const cats = (['FECCU', 'FECCP', 'BECC', 'Sin categoría'] as const).filter(k => k !== 'Sin categoría' || e.porCategoria[k] > 0)
  const maxCat = Math.max(...cats.map(k => e.porCategoria[k]), 1)
  const cuentas = [
    { k: 'Tomi' as const, label: 'Cuenta de Tomi' },
    { k: 'Gero' as const, label: 'Cuenta de Gero' },
    { k: 'Relay' as const, label: 'Relay (empresa)' },
    { k: 'Financiera' as const, label: 'Financiera (empresa)' },
    { k: 'otra' as const, label: 'Otras cuentas' },
    { k: 'sin dato' as const, label: 'Sin dato' },
  ].filter(c => (c.k !== 'otra' && c.k !== 'sin dato' && c.k !== 'Financiera') || e.porCuenta[c.k] > 0)
  const maxCta = Math.max(...cuentas.map(c => e.porCuenta[c.k]), 1)
  return (
    <Seccion titulo="Entradas" subtitulo={<>Cash del mes: <b style={{ color: 'var(--text)' }}>{fmtUsd(e.cash)}</b>{e.cashEr != null && Math.abs(e.cashEr - e.cash) < 0.5 ? ' · coincide con el Estado de Resultados' : ''}</>}>
      <p className="text-[11px] font-semibold uppercase tracking-wider mt-1" style={{ color: 'var(--text-muted)' }}>Por tipo</p>
      {cats.map(k => (
        <Barra key={k} label={k} valor={e.porCategoria[k]} max={maxCat} texto={`${fmtUsd(e.porCategoria[k])} · ${fmtPct(e.cash ? e.porCategoria[k] / e.cash : null, 0)}`} />
      ))}
      <p className="text-[11px] font-semibold uppercase tracking-wider mt-4" style={{ color: 'var(--text-muted)' }}>Por cuenta que recibió</p>
      {cuentas.map(c => (
        <Barra key={c.k} label={c.label} valor={e.porCuenta[c.k]} max={maxCta}
          texto={`${fmtUsd(e.porCuenta[c.k])} · ${e.cantPorCuenta[c.k]} pagos`} />
      ))}
      {e.fuenteCuenta === 'comprobantes' && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
          Según los comprobantes revisados de julio a septiembre de 2026 (el Registro no tiene este dato). “Otras cuentas” = Pagos Rio / LOHAS, efectivo, dLocal Go, Asociación Mutual de Escribanos y otras que no son de Tomi, de Gero ni Relay.
        </p>
      )}
      {!e.fuenteCuenta && (
        <Aviso>No se sabe a qué cuenta entraron los pagos de este mes: el Registro de Pagos no tiene ese dato (solo julio a septiembre de 2026 están revisados con los comprobantes). Falta decidir cómo registrarlo.</Aviso>
      )}
    </Seccion>
  )
}

// ── Gastos ────────────────────────────────────────────────────────────────────────────
export function Gastos({ d }: P) {
  const g = d.gastos
  const max = Math.max(...g.categorias.map(c => c.monto), 1)
  return (
    <Seccion titulo="Gastos por categoría" subtitulo={<>Total: <b style={{ color: 'var(--text)' }}>{fmtUsd(g.total)}</b></>}>
      {g.categorias.map(c => (
        <Barra key={c.categoria} label={c.categoria} valor={c.monto} max={max} texto={fmtUsd(c.monto)}
          marca={c.estimado ? <Etiqueta tono="aviso">estimado</Etiqueta> : c.categoria === 'Sin categoría' ? <Etiqueta tono="mal">revisar</Etiqueta> : undefined}
          nota={c.detalle} />
      ))}
      <details className="mt-3">
        <summary className="text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          Ver detalle ({g.lista.length} gastos cargados · {g.payroll.length} personas en Payroll)
        </summary>
        <div className="fin-scroll mt-2">
          <table className="fin-tabla">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Pagó</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {g.lista.map((x, i) => (
                <tr key={i}>
                  <td className="num">{x.fecha.slice(8, 10)}/{x.fecha.slice(5, 7)}</td>
                  <td>{x.concepto}</td>
                  <td>{x.categoria}{x.inferida && <> <Etiqueta tono="aviso">inferida</Etiqueta></>}</td>
                  <td>{x.pagadoPor || '—'}</td>
                  <td className="num">{fmtUsd(x.monto, 2)}</td>
                </tr>
              ))}
              {g.payroll.map((x, i) => (
                <tr key={`p${i}`}>
                  <td>Payroll</td>
                  <td>{x.nombre}{x.puesto ? ` · ${x.puesto}` : ''}{!x.pagado && <> <Etiqueta tono="aviso">pendiente</Etiqueta></>}</td>
                  <td>Staff{x.comision ? ` (+ comisión ${fmtUsd(x.comision)} → ver Comisiones)` : ''}</td>
                  <td>{x.pagadoPor || '—'}</td>
                  <td className="num">{fmtUsd(x.base + x.bonus, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Seccion>
  )
}

// ── Comisiones ────────────────────────────────────────────────────────────────────────
export function Comisiones({ d }: P) {
  const c = d.comisiones
  return (
    <Seccion
      titulo="Comisiones a pagar del mes"
      subtitulo="Mismas fórmulas que la pestaña Dashboard del sheet: closers 10% de lo cobrado; Mai 5% Inbound IG y 2,5% Enrutamiento (solo Fee, PIF y 1ra Cuota)."
      accion={<div className="text-right shrink-0"><p className="text-[11px] uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>A pagar</p><p className="text-xl font-black tabular-nums">{fmtUsd(c.aPagar, 2)}</p></div>}
    >
      <div className="fin-scroll">
        <table className="fin-tabla">
          <thead><tr><th>Persona</th><th>Regla</th><th className="num">Pagos</th><th className="num">Base</th><th className="num">Comisión</th><th className="num">En Payroll</th></tr></thead>
          <tbody>
            {/* Tomi y Gero son socios y no cobran comisión (confirmado por el usuario 1/10): no se listan */}
            {c.lineas.filter(l => !l.socio).map((l, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{l.persona}</td>
                <td>{l.regla}</td>
                <td className="num">{l.pagos}</td>
                <td className="num">{fmtUsd(l.base, 2)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtUsd(l.comision, 2)}</td>
                <td className="num">
                  {l.payroll == null ? '—' : fmtUsd(l.payroll, 2)}
                  {l.payroll != null && Math.abs(l.payroll - l.comision) > 0.5 && <> <Etiqueta tono="aviso">difiere</Etiqueta></>}
                </td>
              </tr>
            ))}
            {!c.lineas.some(l => !l.socio) && <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Sin pagos en el mes.</td></tr>}
          </tbody>
        </table>
      </div>
      {c.payrollTotal != null && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Payroll registró {fmtUsd(c.payrollTotal, 2)} de comisiones este mes (columna Comisión). El gasto usa el cálculo de la fórmula, no la suma de Payroll, para no contarlo dos veces.
        </p>
      )}
    </Seccion>
  )
}

// ── Reparto 50/50 ─────────────────────────────────────────────────────────────────────
export function Reparto({ d }: P) {
  const r = d.reparto
  const f = r.faltantes
  const fila = (label: string, t: number, g: number, fuerte = false) => (
    <tr>
      <td style={{ fontWeight: fuerte ? 700 : 400 }}>{label}</td>
      <td className="num" style={{ fontWeight: fuerte ? 700 : 400 }}>{fmtUsd(t, 2)}</td>
      <td className="num" style={{ fontWeight: fuerte ? 700 : 400 }}>{fmtUsd(g, 2)}</td>
    </tr>
  )
  return (
    <Seccion titulo="Reparto 50/50 · Tomi y Gero" subtitulo="Lo que entró a la cuenta personal de cada uno menos los gastos de la empresa que pagó cada uno. Relay es la empresa y los gastos sin “Banco / Cuenta” en Gastos se toman como pagados por Relay: quedan fuera del reparto, igual que las “otras cuentas”.">
      <div className="fin-scroll">
        <table className="fin-tabla">
          <thead><tr><th></th><th className="num">Tomi</th><th className="num">Gero</th></tr></thead>
          <tbody>
            {fila('Recibió en su cuenta', r.ingresos.Tomi, r.ingresos.Gero)}
            {fila('Pagó gastos de la empresa', r.gastos.Tomi, r.gastos.Gero)}
            {fila('Le quedó', r.saldo.Tomi, r.saldo.Gero, true)}
          </tbody>
        </table>
      </div>
      <div className="glass-tile p-3 mt-3">
        {r.deudor ? (
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            <b>{r.deudor}</b> le debe <b className="tabular-nums">{fmtUsd(r.monto, 2)}</b> a <b>{r.acreedor}</b>
            {!r.completo && <span style={{ color: 'var(--text-muted)' }}> (con los datos cargados hasta ahora)</span>}
          </p>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text)' }}>Están parejos{!r.completo && <span style={{ color: 'var(--text-muted)' }}> con los datos cargados hasta ahora</span>}.</p>
        )}
      </div>
      {f.otrasCuentas > 0 && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>Además entraron {fmtUsd(f.otrasCuentas)} a otras cuentas (Pagos Rio, efectivo, dLocal, etc.): no se reparten acá.</p>
      )}
      {!r.completo && (
        <Aviso>
          <b>Faltan datos para cerrar el reparto.</b>
          {f.ingresosSinCuenta > 0 && <> {f.pagosSinCuenta} pagos ({fmtUsd(f.ingresosSinCuenta)}) sin cuenta conocida.</>}
          {f.gastosSinPagador > 0 && <> {fmtUsd(f.gastosSinPagador)} de gastos sin un pagador claro (Payroll col Q vacía, con una nota o “Financiera”): {f.gastosSinPagadorLista.slice(0, 6).join(', ')}{f.gastosSinPagadorLista.length > 6 ? '…' : ''}.</>}
        </Aviso>
      )}
    </Seccion>
  )
}

// ── Monotributo ───────────────────────────────────────────────────────────────────────
export function Monotributo({ d }: P) {
  const m = d.monotributo
  const desdeTxt = `${m.desde.slice(5, 7)}/${m.desde.slice(0, 4)}`
  const hastaTxt = `${m.hasta.slice(5, 7)}/${m.hasta.slice(0, 4)}`
  return (
    <Seccion
      titulo="Monotributo · Categoría A"
      subtitulo={<>Ingresos a cuentas personales, mes y últimos 12 meses ({desdeTxt} a {hastaTxt}) vs el tope anual de la Categoría A: <b style={{ color: 'var(--text)' }}>{fmtArs(m.tope.topeAnualArs)}</b> (ARCA, vigente desde {m.tope.vigenteDesde.split('-').reverse().join('/')}).</>}
    >
      {m.personas.map(p => {
        const pct = p.pctTope
        const estado = pct >= 1 ? { t: 'Supera el tope', tono: 'mal' as const } : pct >= 0.8 ? { t: 'Cerca del tope', tono: 'aviso' as const } : { t: 'Debajo del tope', tono: 'bien' as const }
        const color = estado.tono === 'mal' ? 'var(--fin-mal)' : estado.tono === 'aviso' ? 'var(--fin-aviso)' : 'var(--fin-bien)'
        return (
          <div key={p.quien} className="py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{p.quien}</span>
              <span className="text-xs"><Etiqueta tono={estado.tono}>{estado.t}</Etiqueta> <b className="tabular-nums">{fmtPct(pct)}</b></span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--fin-pista)', marginTop: 6, overflow: 'hidden' }}
              role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={`${p.quien}: ${fmtPct(pct)} del tope`}>
              <div style={{ width: `${Math.min(1, pct) * 100}%`, height: '100%', borderRadius: 5, background: color, minWidth: pct > 0 ? 4 : 0 }} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div>Este mes<br /><b className="tabular-nums" style={{ color: 'var(--text)' }}>{fmtUsd(p.mesUsd)}</b> · <span className="tabular-nums">{fmtArs(p.mesArs)}</span></div>
              <div>12 meses<br /><b className="tabular-nums" style={{ color: 'var(--text)' }}>{fmtUsd(p.anioUsd)}</b> · <span className="tabular-nums">{fmtArs(p.anioArs)}</span></div>
            </div>
            {p.pagosSinCotizacion > 0 && <p className="text-[11px] mt-1" style={{ color: 'var(--fin-aviso)' }}>{p.pagosSinCotizacion} pagos sin cotización MEP: no suman en ARS.</p>}
          </div>
        )
      })}
      {m.sinCuenta12.pagos > 0 && (
        <Aviso>{m.sinCuenta12.pagos} pagos de los últimos 12 meses ({fmtUsd(m.sinCuenta12.usd)}) no tienen cuenta conocida: no se pueden atribuir a nadie y NO están en estas barras.</Aviso>
      )}
      <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
        ARS: el monto en pesos del Registro si se cargó; si no, USD × dólar MEP venta del día anterior al pago.
        {m.cuentaDesde && m.cuentaDesde > m.desde && <> <b>Solo suma desde {m.cuentaDesde.slice(5, 7)}/{m.cuentaDesde.slice(0, 4)}</b>, que es desde cuando se sabe a qué cuenta entró cada pago: el ingreso real de 12 meses es mayor.</>}
        {!m.cuentaDesde && <> Sin datos: no se sabe a qué cuenta entró cada pago.</>}
        {' '}Es un seguimiento interno, no un cálculo fiscal: consultar con el contador.
      </p>
    </Seccion>
  )
}

// ── A revisar ─────────────────────────────────────────────────────────────────────────
const TIPO: Record<string, string> = { gasto: 'Gasto', pago: 'Pago', devolucion: 'Devolución', comision: 'Comisión', dato: 'Dato' }
export function Revisar({ d }: P) {
  return (
    <Seccion titulo={`A revisar (${d.revisar.length})`} subtitulo="Lo que falta cargar o confirmar en el sheet para que los números del mes cierren.">
      {!d.revisar.length && <p className="text-sm" style={{ color: 'var(--fin-bien)' }}>✓ Nada pendiente para este mes.</p>}
      <ul className="flex flex-col gap-2">
        {d.revisar.map((x, i) => (
          <li key={i} className="glass-alert px-3 py-2.5 text-sm flex items-start gap-3">
            <Etiqueta tono={x.tipo === 'devolucion' || x.tipo === 'comision' ? 'aviso' : 'neutro'}>{TIPO[x.tipo]}</Etiqueta>
            <span className="flex-1" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {x.texto}
              {x.fila && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}> · {x.fila}</span>}
            </span>
            {x.monto != null && <b className="tabular-nums shrink-0">{fmtUsd(x.monto)}</b>}
          </li>
        ))}
      </ul>
    </Seccion>
  )
}
