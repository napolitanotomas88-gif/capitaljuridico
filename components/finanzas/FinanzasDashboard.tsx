'use client'
import { useEffect, useState } from 'react'
import type { FinanzasApi } from '@/lib/finanzas'
import { EstilosFinanzas } from './Tema'
import { Aviso, Tile, fmtPct, fmtUsd } from './ui'
import { Comisiones, Entradas, Gastos, Monotributo, Reparto, Revisar } from './Secciones'
import { NavFinanzas } from './NavFinanzas'
import { EstilosSkwd } from './skwd/estilos'

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaCorta = (mes: string) => `${MESES_CORTOS[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`

export function FinanzasDashboard() {
  const [mes, setMes] = useState<string | null>(null)   // null = mes en curso (lo decide el server en hora AR)
  // Respuesta del último pedido terminado (se sigue mostrando el mes anterior mientras carga el nuevo)
  const [resp, setResp] = useState<{ clave: string; datos?: FinanzasApi; error?: string } | null>(null)
  const [recargas, setRecargas] = useState(0)
  const clave = `${mes ?? 'actual'}#${recargas}`

  useEffect(() => {
    let vivo = true
    fetch(`/api/finanzas${mes ? `?mes=${mes}` : ''}`, { cache: 'no-store' })
      .then(async res => {
        if (res.status === 401) { window.location.href = '/finanzas/login'; return }
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
        if (vivo) setResp({ clave, datos: json as FinanzasApi })
      })
      .catch(e => { if (vivo) setResp(r => ({ clave, datos: r?.datos, error: (e as Error).message })) })
    return () => { vivo = false }
  }, [mes, clave])

  const datos = resp?.datos ?? null
  const error = resp?.clave === clave ? resp.error ?? null : null
  const cargando = resp?.clave !== clave

  const d = datos
  const r = d?.resultado
  return (
    <div className="fin-verde fin-fondo" data-theme="dark">
      <EstilosFinanzas />
      <div className="max-w-6xl mx-auto px-4 py-5 md:py-8">
        {/* Header */}
        <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              Finanzas <span style={{ color: 'var(--brand-orange)' }}>Capital Jurídico</span>
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {d ? d.etiqueta : 'Cargando…'}
              {cargando && d && <span className="ml-2 text-xs">· actualizando…</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button onClick={() => setRecargas(n => n + 1)} className="fin-sec text-xs font-semibold rounded-lg px-3 py-1.5" style={{ minHeight: 36 }} aria-label="Actualizar datos">
              ↻
            </button>
            {/* Cierra solo el acceso a Finanzas (la sesión de Google sigue): vuelve a pedir la contraseña */}
            <form method="post" action="/api/finanzas/logout">
              <button type="submit" className="fin-boton text-xs font-bold rounded-lg px-3 py-1.5" style={{ minHeight: 36 }}>
                Cerrar Finanzas
              </button>
            </form>
          </div>
        </header>

        {/* Pestañas: Resumen y las pantallas de la base de Finanzas SKWD (1/11/2026) */}
        <EstilosSkwd />
        <NavFinanzas actual="resumen" />

        {/* Selector de mes */}
        {d && (
          <div className="flex flex-wrap gap-1.5 mb-5 no-print" role="tablist" aria-label="Mes">
            {d.mesesDisponibles.map(m => {
              const activo = m === d.mes
              return (
                <button key={m} role="tab" aria-selected={activo} onClick={() => setMes(m)}
                  className="text-xs font-semibold rounded-full px-3 py-1"
                  style={{
                    border: `1.5px solid ${activo ? 'var(--brand-orange)' : 'var(--border)'}`,
                    background: activo ? 'var(--brand-orange)' : 'transparent',
                    color: activo ? 'var(--fin-sobre-dorado)' : 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  {etiquetaCorta(m)}
                </button>
              )
            })}
          </div>
        )}

        {error && <Aviso tono="mal">No se pudieron cargar los datos: {error}</Aviso>}
        {d?.avisos.map((a, i) => <Aviso key={i}>{a}</Aviso>)}

        {!d && !error && (
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mt-2">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="glass-tile" style={{ height: 92, opacity: 0.6 }} />)}
          </div>
        )}

        {d && r && (
          <div style={{ opacity: cargando ? 0.6 : 1, transition: 'opacity .2s' }}>
            {/* Resultado del mes */}
            <div className="glass-board p-3 md:p-4 mt-2 mb-4">
              <div className="grid grid-cols-2 xl:grid-cols-5 gap-2.5 md:gap-3">
                <Tile label="Entró (cash)" valor={fmtUsd(r.ingresos)} nota={`${d.entradas.pagos} pagos`} />
                <Tile label="Gastos" valor={fmtUsd(r.gastos)} nota={d.gastos.anunciosEstimado ? 'incluye anuncios estimados' : undefined} />
                <Tile label="Ganancia neta" valor={fmtUsd(r.neto)} tono={r.neto >= 0 ? 'bien' : 'mal'} />
                <Tile label="Margen" valor={fmtPct(r.margen)} tono={r.margen == null ? 'neutro' : r.margen >= 0 ? 'bien' : 'mal'} />
                <Tile label="Devoluciones" valor={fmtUsd(r.devoluciones)} nota="gasto del mes" />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Entradas d={d} />
              <Gastos d={d} />
            </div>
            <div className="grid grid-cols-1 gap-4 mt-4">
              <Comisiones d={d} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Reparto d={d} />
              <Monotributo d={d} />
            </div>
            <div className="grid grid-cols-1 gap-4 mt-4">
              <Revisar d={d} />
            </div>
            <p className="text-[11px] mt-6 text-center" style={{ color: 'var(--text-muted)' }}>
              Datos del sheet de Finanzas (Registro de Pagos, Gastos, Payroll, Estado de Resultados) · Meta Ads · dólar MEP (argentinadatos.com / dolarapi.com).
              Actualizado {new Date(d.generado).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
