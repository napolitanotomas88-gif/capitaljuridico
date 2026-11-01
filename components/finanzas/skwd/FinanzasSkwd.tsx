'use client'
// Finanzas SKWD dentro del Despacho (1/11/2026, pedido de Tomás: «va a ir todo dentro de finanzas»). Las pantallas son las
// de la app original (React + Vite, base Supabase con permisos RLS por usuario), con el verde de Finanzas. El acceso a
// /finanzas sigue igual (contraseña de Finanzas o administrador con Google) y, además, la base pide su propio inicio de
// sesión (email y contraseña de Supabase): los permisos y los datos sensibles del equipo dependen de ese usuario.
// "Corregir" en cualquier pantalla lleva a /finanzas/correcciones?tabla=…&id=… con el registro ya elegido.
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { EstilosFinanzas } from '../Tema'
import { NavFinanzas } from '../NavFinanzas'
import { EstilosSkwd } from './estilos'
import { supabase, supabaseConfigurado } from './supabase'
import type { VistaSkwd } from './vistas'
import Login from './Login'
import Pagos from './Pagos'
import Gastos from './Gastos'
import Equipo from './Equipo'
import PagosEquipo from './PagosEquipo'
import Correcciones from './Correcciones'
import EstadoResultados from './EstadoResultados'
import Dashboard from './Dashboard'
import GastosPersonales from './GastosPersonales'

type Objetivo = { tabla: string; id: string | number }
// Correcciones.jsx declara sus props con valores por defecto null (JavaScript): se le da el tipo real
const CorreccionesConObjetivo = Correcciones as unknown as (p: { objetivo: Objetivo | null; onConsumido: () => void }) => React.ReactElement

export function FinanzasSkwd({ vista }: { vista: VistaSkwd }) {
  const router = useRouter()
  const params = useSearchParams()
  const [sesion, setSesion] = useState<Session | null>(null)
  const [cargando, setCargando] = useState(supabaseConfigurado)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSesion(data.session); setCargando(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const irACorregir = (o: Objetivo) => router.push(`/finanzas/correcciones?tabla=${encodeURIComponent(o.tabla)}&id=${encodeURIComponent(String(o.id))}`)
  const tabla = params.get('tabla'), id = params.get('id')
  // Mismo objeto mientras no cambie la dirección (Correcciones reacciona a cada objetivo nuevo)
  const objetivo = useMemo<Objetivo | null>(() => (vista === 'correcciones' && tabla && id ? { tabla, id: /^\d+$/.test(id) ? Number(id) : id } : null), [vista, tabla, id])

  return (
    <div className="fin-verde fin-fondo" data-theme="dark">
      <EstilosFinanzas />
      <EstilosSkwd />
      <div className="max-w-6xl mx-auto px-4 py-5 md:py-8">
        <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              Finanzas <span style={{ color: 'var(--brand-orange)' }}>Capital Jurídico</span>
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {sesion ? `Base de Finanzas · ${sesion.user.email}` : 'Base de Finanzas'}
            </p>
          </div>
          <div className="flex items-center gap-2 no-print">
            {sesion && supabase && (
              <button type="button" onClick={() => supabase?.auth.signOut()} className="fin-sec text-xs font-semibold rounded-lg px-3 py-1.5" style={{ minHeight: 36 }}>
                Salir de la base
              </button>
            )}
            <form method="post" action="/api/finanzas/logout">
              <button type="submit" className="fin-boton text-xs font-bold rounded-lg px-3 py-1.5" style={{ minHeight: 36 }}>
                Cerrar Finanzas
              </button>
            </form>
          </div>
        </header>

        <NavFinanzas actual={vista} />

        <main className="fin-skwd">
          {!supabaseConfigurado ? (
            <div className="aviso-box">
              Falta conectar la base de Finanzas: cargar <code>NEXT_PUBLIC_SUPABASE_URL</code> y <code>NEXT_PUBLIC_SUPABASE_KEY</code> (clave publicable) en Vercel y volver a publicar.
            </div>
          ) : cargando ? (
            <p className="gris">Cargando…</p>
          ) : !sesion ? (
            <Login />
          ) : (
            <>
              {vista === 'pagos' && <Pagos onCorregir={irACorregir} />}
              {vista === 'gastos' && <Gastos onCorregir={irACorregir} />}
              {vista === 'equipo' && <Equipo />}
              {vista === 'pagos-equipo' && <PagosEquipo onCorregir={irACorregir} />}
              {vista === 'correcciones' && <CorreccionesConObjetivo objetivo={objetivo} onConsumido={() => router.replace('/finanzas/correcciones')} />}
              {vista === 'estado' && <EstadoResultados />}
              {vista === 'tablero' && <Dashboard />}
              {vista === 'personales' && <GastosPersonales />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
