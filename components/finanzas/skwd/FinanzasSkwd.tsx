'use client'
// Finanzas SKWD dentro del Despacho (1/11/2026, pedido de Tomás: «va a ir todo dentro de finanzas»). Las pantallas son las
// de la app original (React + Vite, base Supabase con permisos RLS por correo), con el verde de Finanzas. El acceso es el
// de /finanzas (contraseña de Finanzas o administrador con Google) y la base entra con el correo de la sesión del Despacho:
// el servidor firma el token (/api/finanzas/base, pedido de Tomás del 1/11: «no hace falta la contraseña»). Solo si falta
// SUPABASE_JWT_SECRET se pide el usuario de la base, como en la app original.
// "Corregir" en cualquier pantalla lleva a /finanzas/correcciones?tabla=…&id=… con el registro ya elegido.
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { EstilosFinanzas } from '../Tema'
import { NavFinanzas } from '../NavFinanzas'
import { EstilosSkwd } from './estilos'
import { prepararBase, supabase, supabaseConfigurado } from './supabase'
import { VISTAS_SKWD, type VistaSkwd } from './vistas'
import { SeccionTitulo } from '@/components/ui/SeccionTitulo'
import { Boton } from '@/components/ui/Boton'

const TITULOS = Object.fromEntries(VISTAS_SKWD) as Record<VistaSkwd, string>
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
  const [base, setBase] = useState<{ modo: 'token' | 'login' | 'sin_config'; correo: string | null } | null>(null)

  useEffect(() => {
    let vivo = true
    let desuscribir = () => {}
    prepararBase().then((b) => {
      if (!vivo) return
      // Solo en el modo login (falta SUPABASE_JWT_SECRET) hay sesión propia de la base
      const cliente = supabase
      if (b.modo === 'login' && cliente) {
        cliente.auth.getSession().then(({ data }) => { if (vivo) { setSesion(data.session); setBase(b) } })
        const { data } = cliente.auth.onAuthStateChange((_e, s) => setSesion(s))
        desuscribir = () => data.subscription.unsubscribe()
      } else setBase(b)
    })
    return () => { vivo = false; desuscribir() }
  }, [])
  const adentro = base?.modo === 'token' || (base?.modo === 'login' && !!sesion)
  const correo = base?.modo === 'token' ? base.correo : sesion?.user.email ?? null

  const irACorregir = (o: Objetivo) => router.push(`/finanzas/correcciones?tabla=${encodeURIComponent(o.tabla)}&id=${encodeURIComponent(String(o.id))}`)
  const tabla = params.get('tabla'), id = params.get('id')
  // Mismo objeto mientras no cambie la dirección (Correcciones reacciona a cada objetivo nuevo)
  const objetivo = useMemo<Objetivo | null>(() => (vista === 'correcciones' && tabla && id ? { tabla, id: /^\d+$/.test(id) ? Number(id) : id } : null), [vista, tabla, id])

  return (
    <div className="fin-verde fin-fondo">
      <EstilosFinanzas />
      <EstilosSkwd />
      <div className="fin-pagina">
        <SeccionTitulo etiqueta="Finanzas" titulo={TITULOS[vista]} acciones={
          <div className="fin-acciones no-print">
            {correo && <span className="cj-texto-2" style={{ fontSize: 13 }}>{correo}</span>}
            {base?.modo === 'login' && sesion && supabase && (
              <Boton variante="secundario" onClick={() => supabase?.auth.signOut()}>Salir de la base</Boton>
            )}
            <form method="post" action="/api/finanzas/logout"><Boton variante="secundario" type="submit">Cerrar Finanzas</Boton></form>
          </div>
        } />

        <NavFinanzas actual={vista} />

        <div className="fin-skwd">
          {!supabaseConfigurado ? (
            <div className="aviso-box">
              Falta conectar la base de Finanzas: cargar <code>NEXT_PUBLIC_SUPABASE_URL</code> y <code>NEXT_PUBLIC_SUPABASE_KEY</code> (clave publicable) en Vercel y volver a publicar.
            </div>
          ) : !base ? (
            <p className="gris">Cargando…</p>
          ) : !adentro ? (
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
        </div>
      </div>
    </div>
  )
}
