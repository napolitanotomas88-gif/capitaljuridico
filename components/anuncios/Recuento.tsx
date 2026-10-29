'use client'

// Recuento de días malos de Meta por MES (agosto, septiembre…) o por FECHAS elegidas.
// Consulta /api/anuncios/recuento solo cuando se abre o se cambia el período (no entra en el refresco de 15 s).
import { useEffect, useMemo, useState } from 'react'
import type { Recuento } from '@/lib/anuncios/recuento'
import type { CasaDolar } from '@/lib/anuncios/dolar'
import { CASAS } from '@/lib/anuncios/dolar'
import { nombreDia, diaSemana } from '@/lib/anuncios/feriados'
import { dm, fmtEntero, fmtGasto, fmtMonto, fmtPct, sumarDias } from '@/lib/anuncios/formato'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const LETRAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
type Periodo = { desde: string; hasta: string; etiqueta: string }

function ultimoDiaMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// Últimos 6 meses con al menos un día completo (si hoy es día 1, el mes actual todavía no tiene)
function mesesDisponibles(hoy: string): Periodo[] {
  const ayer = sumarDias(hoy, -1)
  const out: Periodo[] = []
  let y = +ayer.slice(0, 4), m = +ayer.slice(5, 7)
  for (let i = 0; i < 6; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    const fin = ultimoDiaMes(ym)
    out.push({ desde: `${ym}-01`, hasta: fin > ayer ? ayer : fin, etiqueta: `${MESES[m - 1]}${y !== +hoy.slice(0, 4) ? ` ${y}` : ''}` })
    m--; if (!m) { m = 12; y-- }
  }
  return out
}

export function RecuentoMeta({ hoy, casa }: { hoy: string; casa: CasaDolar }) {
  const meses = useMemo(() => mesesDisponibles(hoy), [hoy])
  const ayer = sumarDias(hoy, -1)
  const [abierto, setAbierto] = useState(false)
  const [periodo, setPeriodo] = useState<Periodo>(meses[0])
  const [desde, setDesde] = useState(meses[0].desde)
  const [hasta, setHasta] = useState(meses[0].hasta)
  const [datos, setDatos] = useState<Recuento | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    const t = setTimeout(async () => {
      setCargando(true); setError(null)
      try {
        const r = await fetch(`/api/anuncios/recuento?desde=${periodo.desde}&hasta=${periodo.hasta}&dolar=${casa}`)
        if (r.status === 401) { window.location.href = '/anuncios/login'; return }
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`)
        if (vigente) setDatos(j as Recuento)
      } catch (e) {
        if (vigente) setError((e as Error).message)
      } finally {
        if (vigente) setCargando(false)
      }
    }, 0)
    return () => { vigente = false; clearTimeout(t) }
  }, [abierto, periodo, casa])

  const elegirFechas = () => {
    if (!desde || !hasta) return
    const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde]
    setPeriodo({ desde: a, hasta: b > ayer ? ayer : b, etiqueta: `del ${dm(a)} al ${dm(b > ayer ? ayer : b)}` })
  }
  const nombreCasa = CASAS.find(c => c.id === casa)?.nombre.toLowerCase() ?? casa

  return (
    <section aria-label="Recuento de días malos de Meta" className="mt-5">
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="enlace" style={{ background: 'none', borderTop: 0, borderLeft: 0, borderRight: 0, cursor: 'pointer', padding: '0 0 1px' }}>
        {abierto ? 'Cerrar recuento' : 'Recuento por mes o fechas'}
      </button>

      {abierto && (
        <div className="mt-5" style={{ borderTop: '1px solid var(--filete)', borderBottom: '1px solid var(--filete)', padding: '20px 0 24px' }}>
          {/* ── Selección del período ── */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-5 lg:gap-10">
            <div className="flex flex-col gap-2 min-w-0">
              <span className="etq">Mes</span>
              <div className="flex flex-wrap gap-1.5">
                {meses.map(m => (
                  <button key={m.desde} type="button" className="chip" aria-pressed={periodo.desde === m.desde && periodo.hasta === m.hasta} onClick={() => setPeriodo(m)}>{m.etiqueta}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="etq">O fechas elegidas</span>
              <div className="flex flex-wrap items-center gap-3">
                <input className="buscar" type="date" value={desde} max={ayer} min="2024-01-01" onChange={e => setDesde(e.target.value)} aria-label="Desde" style={{ colorScheme: 'dark' }} />
                <span style={{ color: 'var(--humo)' }}>a</span>
                <input className="buscar" type="date" value={hasta} max={ayer} min="2024-01-01" onChange={e => setHasta(e.target.value)} aria-label="Hasta" style={{ colorScheme: 'dark' }} />
                <button type="button" className="chip" onClick={elegirFechas}>Ver</button>
              </div>
            </div>
          </div>

          {error && <p className="mt-6" style={{ borderLeft: '2px solid var(--borgona)', paddingLeft: 12 }}>No se pudo armar el recuento: {error}</p>}
          {cargando && <p className="mt-6" style={{ color: 'var(--humo)' }}>Contando los días de {periodo.etiqueta} con todas las cuentas…{!datos ? ' (la primera vez tarda unos segundos)' : ''}</p>}

          {datos && !error && (
            <div className="mt-8" style={{ opacity: cargando ? 0.45 : 1 }}>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <span className="serif num" style={{ fontSize: 'clamp(44px, 6vw, 64px)', lineHeight: 1 }}>{datos.malos}</span>
                <div style={{ paddingBottom: 6 }}>
                  <div className="etq">{datos.malos === 1 ? 'día malo de Meta' : 'días malos de Meta'} · {periodo.etiqueta}</div>
                  <div style={{ fontSize: 14, color: 'var(--humo)', marginTop: 2 }}>
                    {datos.malosHabiles} hábiles · {datos.malosFinde} fin de semana o feriado · de {datos.dias.length} días con datos
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-10 lg:grid-cols-[auto_1fr]">
                <Calendario r={datos} />
                <div className="min-w-0" style={{ fontSize: 14.5 }}>
                  {datos.malos > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {datos.dias.filter(x => x.malo).map(x => (
                        <li key={x.d}>
                          <span style={{ color: 'var(--hueso)' }}>{nombreDia(x.d)} {dm(x.d)}</span>
                          <span style={{ color: 'var(--humo)' }}> — subió en el {Math.round(x.parte * 100)}% de las cuentas ({x.suben} de {x.cuentas}), suba típica {fmtPct(x.mediana - 1)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p style={{ color: 'var(--humo)' }}>Ningún día malo en el período: las subas fueron de cada cuenta.</p>}
                  {datos.malos > 0 && (
                    <p className="mt-4" style={{ color: 'var(--humo)' }}>
                      Por día de la semana:{' '}
                      {[1, 2, 3, 4, 5, 6, 0].filter(i => datos.porDiaSemana[i]).map(i => `${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][i]} ${datos.porDiaSemana[i]}`).join(' · ')}
                    </p>
                  )}
                  <Totales r={datos} nombreCasa={nombreCasa} />
                  {datos.avisos.map((a, i) => <p key={i} className="mt-3" style={{ fontSize: 13, borderLeft: '2px solid var(--borgona)', paddingLeft: 10 }}>{a}</p>)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Totales({ r, nombreCasa }: { r: Recuento; nombreCasa: string }) {
  const t = r.totales
  const dif = t.cplUSDMalos != null && t.cplUSDNormales ? t.cplUSDMalos / t.cplUSDNormales - 1 : null
  return (
    <div className="mt-6" style={{ borderTop: '1px solid var(--filete)', paddingTop: 14 }}>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Cifra etq="Gasto total">{fmtGasto(t.gastoUSD, 'USD')}</Cifra>
        <Cifra etq="Mensajes">{fmtEntero(t.mensajes)}</Cifra>
        <Cifra etq="CPL general">{fmtMonto(t.cplUSD, 'USD')}</Cifra>
        {r.malos > 0 && <Cifra etq="CPL en días malos">{fmtMonto(t.cplUSDMalos, 'USD')}{dif != null && <span style={{ color: 'var(--humo)', fontSize: 13 }}> {fmtPct(dif)} vs. el resto</span>}</Cifra>}
      </div>
      <p className="mt-3" style={{ fontSize: 12.5, color: 'var(--humo)' }}>
        {t.cuentas} cuentas con gasto. Pesos pasados a USD con el dólar {nombreCasa} venta de cada día{r.dolar.promedio ? ` (promedio $ ${fmtEntero(r.dolar.promedio)})` : ''}; otras monedas, con la cotización del {dm(r.hasta)}.
        {t.sinConvertir ? ` ${t.sinConvertir} cuenta${t.sinConvertir > 1 ? 's' : ''} en otras monedas sin cotización: no se suman.` : ''}
      </p>
    </div>
  )
}

function Cifra({ etq, children }: { etq: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="etq" style={{ fontSize: 10 }}>{etq}</div>
      <div className="num" style={{ fontSize: 17, marginTop: 2 }}>{children}</div>
    </div>
  )
}

// Calendario por semanas (lunes a domingo): borgoña = día malo; hueco = fin de semana o feriado
function Calendario({ r }: { r: Recuento }) {
  const porDia = new Map(r.dias.map(x => [x.d, x]))
  const offset = (diaSemana(r.desde) + 6) % 7          // lunes = 0
  let inicio = sumarDias(r.desde, -offset)
  const semanas: string[][] = []
  while (inicio <= r.hasta) {
    semanas.push(Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i)))
    inicio = sumarDias(inicio, 7)
  }
  const celda = 30
  return (
    <div role="table" aria-label="Calendario de días malos de Meta" style={{ display: 'inline-block' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${celda}px)`, gap: 3, marginBottom: 4 }}>
        {LETRAS.map((l, i) => <span key={i} role="columnheader" className="etq" style={{ fontSize: 9.5, textAlign: 'center' }}>{l}</span>)}
      </div>
      {semanas.map(sem => (
        <div key={sem[0]} role="row" style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${celda}px)`, gap: 3, marginBottom: 3 }}>
          {sem.map(d => {
            const dentro = d >= r.desde && d <= r.hasta
            const x = porDia.get(d)
            if (!dentro) return <span key={d} role="cell" />
            const finde = x ? x.tipo === 'finde' : [0, 6].includes(diaSemana(d))
            return (
              <span
                key={d} role="cell"
                title={x ? `${nombreDia(d)} ${dm(d)}: subió en ${x.suben} de ${x.cuentas} cuentas · suba típica ${fmtPct(x.mediana - 1)}${x.malo ? ' · DÍA MALO DE META' : ''}` : `${nombreDia(d)} ${dm(d)}: sin datos`}
                className="num"
                style={{
                  height: celda, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5,
                  background: x?.malo ? 'var(--borgona)' : finde ? 'transparent' : 'rgba(239,233,220,0.08)',
                  border: x?.malo ? '1px solid var(--borgona)' : finde ? '1px solid rgba(239,233,220,0.18)' : '1px solid transparent',
                  color: x?.malo ? 'var(--hueso)' : x ? 'var(--humo)' : 'rgba(139,145,139,0.5)',
                }}
              >
                {+d.slice(8, 10)}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
