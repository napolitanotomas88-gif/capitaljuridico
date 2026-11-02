'use client'
// Finanzas SKWD dentro del Despacho (1/11/2026, pedido de Tomás: «va a ir todo dentro de finanzas»). Las pantallas son las
// de la app original; los datos, desde el 1/11 en Neon (esquema finanzas, misma base del Despacho): ./supabase.js manda
// cada consulta a /api/finanzas/db, que firma con el correo de la sesión del Despacho. El acceso es el de /finanzas
// (contraseña de Finanzas o administrador con Google); no hay otro inicio de sesión.
// "Corregir" en cualquier pantalla lleva a /finanzas/correcciones?tabla=…&id=… con el registro ya elegido.
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { EstilosFinanzas } from '../Tema'
import { NavFinanzas } from '../NavFinanzas'
import { EstilosSkwd } from './estilos'
import { prepararBase } from './supabase'
import { VISTAS_SKWD, type VistaSkwd } from './vistas'
import { SeccionTitulo } from '@/components/ui/SeccionTitulo'
import { Boton } from '@/components/ui/Boton'

const TITULOS = Object.fromEntries(VISTAS_SKWD) as Record<VistaSkwd, string>
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

// base: dónde viven las pantallas (/finanzas; la prueba del diseño de cristal las monta en /finanzas/prueba)
export function FinanzasSkwd({ vista, base: rutaBase = '/finanzas' }: { vista: VistaSkwd; base?: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [base, setBase] = useState<{ modo: 'token' | 'sin_config' | 'sin_acceso'; correo: string | null } | null>(null)
  useEffect(() => {
    let vivo = true
    prepararBase().then((b) => { if (vivo) setBase(b) })
    return () => { vivo = false }
  }, [])
  const correo = base?.correo ?? null

  const irACorregir = (o: Objetivo) => router.push(`${rutaBase}/correcciones?tabla=${encodeURIComponent(o.tabla)}&id=${encodeURIComponent(String(o.id))}`)
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
            <form method="post" action="/api/finanzas/logout"><Boton variante="secundario" type="submit">Cerrar Finanzas</Boton></form>
          </div>
        } />

        <NavFinanzas actual={vista} />

        <div className="fin-skwd">
          {!base ? (
            <p className="gris">Cargando…</p>
          ) : base.modo === 'sin_config' ? (
            <div className="aviso-box">Falta conectar la base de Finanzas (DATABASE_URL en Vercel).</div>
          ) : base.modo === 'sin_acceso' ? (
            <div className="aviso-box">No se pudo abrir la base de Finanzas: volvé a entrar a Finanzas.</div>
          ) : (
            <>
              {vista === 'pagos' && <Pagos onCorregir={irACorregir} />}
              {vista === 'gastos' && <Gastos onCorregir={irACorregir} />}
              {vista === 'equipo' && <Equipo />}
              {vista === 'pagos-equipo' && <PagosEquipo onCorregir={irACorregir} />}
              {vista === 'correcciones' && <CorreccionesConObjetivo objetivo={objetivo} onConsumido={() => router.replace(`${rutaBase}/correcciones`)} />}
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
