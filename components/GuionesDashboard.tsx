'use client'

import { useEffect, useState } from 'react'
import { GrabacionesPanel } from '@/components/GrabacionesPanel'
import { LOGIN_VUELTA_AL_RESUMEN, leerJsonDeDatos } from '@/lib/auth/datosResumen'
import type { RawSerializada } from '@/lib/serializeRaw'

// Guiones y grabaciones de los clientes: el tracker que estaba dentro del Resumen. Los datos salen de /api/raw (la misma fuente).
// Usa los colores claros de la marca (marfil) como el resto del shell.
const irAlLogin = () => { window.location.href = LOGIN_VUELTA_AL_RESUMEN }
const obtener = () => fetch('/api/raw', { cache: 'no-store' }).then(res => leerJsonDeDatos(res, irAlLogin))

const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export default function GuionesDashboard({ clientesPermitidos }: { clientesPermitidos: string[] }) {
  const [grabaciones, setGrabaciones] = useState<RawSerializada['grabaciones'] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)

  async function cargar() {
    try {
      const r = await obtener()
      if (r && !r.error && Array.isArray(r.grabaciones)) setGrabaciones(r.grabaciones)
      else setFallo(true)
    } catch { setFallo(true) } finally { setCargando(false) }
  }
  useEffect(() => {
    let vigente = true
    void obtener().then(r => {
      if (!vigente) return
      if (r && !r.error && Array.isArray(r.grabaciones)) setGrabaciones(r.grabaciones)
      else setFallo(true)
    }).catch(() => { if (vigente) setFallo(true) }).finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [])
  const permitidos = new Set(clientesPermitidos.map(normal))
  const visibles = grabaciones?.filter(g => permitidos.has(normal(g.cliente)))

  return (
    <div className="cj-pila">
      <h2 className="cj-titulo cj-titulo--seccion">Tracker de grabaciones</h2>
      {cargando && !grabaciones && <p className="cj-parrafo cj-texto-2">Leyendo la planilla de guiones…</p>}
      {fallo && !grabaciones && (
        <div className="cj-aviso" role="status">
          <p>No se pudo leer el tracker de guiones. No se muestra nada hasta que cargue.</p>
          <p><button type="button" className="cj-enlace" onClick={() => { setCargando(true); setFallo(false); void cargar() }}>Reintentar</button></p>
        </div>
      )}
      {visibles && (visibles.length ? <GrabacionesPanel grabaciones={visibles} /> : <p className="cj-parrafo cj-texto-2">No hay guiones ni grabaciones cargados todavía.</p>)}
    </div>
  )
}
