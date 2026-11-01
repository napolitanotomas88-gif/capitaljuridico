'use client'
import { useEffect, useState } from 'react'
import type { FinanzasApi } from '@/lib/finanzas'
import { EstilosFinanzas } from './Tema'
import { Aviso, fmtPct, fmtUsd } from './ui'
import { SeccionTitulo } from '@/components/ui/SeccionTitulo'
import { Boton } from '@/components/ui/Boton'
import { ChipFiltro } from '@/components/ui/ChipFiltro'
import { Resumen } from '@/components/ui/Tarjetas'
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
    <div className="fin-verde fin-fondo">
      <EstilosFinanzas />
      <EstilosSkwd />
      <div className="fin-pagina">
        <SeccionTitulo etiqueta="Finanzas" titulo={d ? `Resumen · ${d.etiqueta}` : 'Resumen'} acciones={
          <div className="fin-acciones no-print">
            {cargando && d && <span className="cj-texto-2" style={{ fontSize: 13 }}>Actualizando…</span>}
            <Boton variante="secundario" onClick={() => setRecargas(n => n + 1)} aria-label="Actualizar datos">Actualizar</Boton>
            {/* Cierra solo el acceso a Finanzas (la sesión de Google sigue): vuelve a pedir la contraseña */}
            <form method="post" action="/api/finanzas/logout"><Boton variante="secundario" type="submit">Cerrar Finanzas</Boton></form>
          </div>
        } />

        <NavFinanzas actual="resumen" />

        {/* Selector de mes */}
        {d && (
          <div className="fin-meses no-print" role="group" aria-label="Mes">
            {d.mesesDisponibles.map(m => (
              <ChipFiltro key={m} activo={m === d.mes} onClick={() => setMes(m)}>{etiquetaCorta(m)}</ChipFiltro>
            ))}
          </div>
        )}

        {error && <Aviso tono="mal">No se pudieron cargar los datos: {error}</Aviso>}
        {d?.avisos.map((a, i) => <Aviso key={i}>{a}</Aviso>)}

        {!d && !error && (
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mt-2">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="cj-dato" style={{ height: 112, opacity: 0.5 }} />)}
          </div>
        )}

        {d && r && (
          <div style={{ opacity: cargando ? 0.6 : 1, transition: 'opacity .2s' }}>
            {/* Resultado del mes: las tarjetas de dato del Despacho */}
            <Resumen titulo="Resultado del mes" className="fin-resumen" datos={[
              { etiqueta: 'Entró (cash)', valor: fmtUsd(r.ingresos), contexto: `${d.entradas.pagos} pagos`, destacado: true },
              { etiqueta: 'Gastos', valor: fmtUsd(r.gastos), contexto: d.gastos.anunciosEstimado ? 'Incluye anuncios estimados' : undefined },
              { etiqueta: 'Ganancia neta', valor: fmtUsd(r.neto), estado: { tono: r.neto >= 0 ? 'ok' : 'alerta', texto: r.neto >= 0 ? 'Positiva' : 'Negativa' } },
              { etiqueta: 'Margen', valor: fmtPct(r.margen), estado: r.margen == null ? undefined : { tono: r.margen >= 0 ? 'ok' : 'alerta', texto: r.margen >= 0 ? 'Sobre el cash' : 'En rojo' } },
              { etiqueta: 'Devoluciones', valor: fmtUsd(r.devoluciones), contexto: 'Gasto del mes' },
            ]} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Entradas d={d} />
              <Gastos d={d} />
            </div>
            <div className="grid grid-cols-1 gap-6 mt-6">
              <Comisiones d={d} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <Reparto d={d} />
              <Monotributo d={d} />
            </div>
            <div className="grid grid-cols-1 gap-6 mt-6">
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
