import { useEffect, useState } from 'react'

// Desplegable «SOP del puesto» al cargar un pago del equipo: dónde está el SOP del rol de la persona (lo que cobra y con qué criterios).
// Los enlaces los da /api/finanzas/sops (variable FINANZAS_SOPS_PUESTOS); el puesto se reconoce por palabras clave
// («coach», «closer», «setter»…) dentro del puesto de la línea o de la persona. Sin enlaces cargados no se muestra nada.
const normalizar = (t) => (t || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

let cache = null // una sola consulta por carga de página
function cargarSops() {
  if (!cache) cache = fetch('/api/finanzas/sops', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { puestos: [], carpeta: null })).catch(() => ({ puestos: [], carpeta: null }))
  return cache
}

export function sopDe(puestos, ...textos) {
  const t = normalizar(textos.filter(Boolean).join(' '))
  if (!t) return null
  return puestos.find((p) => p.claves.some((c) => t.includes(normalizar(c)))) || null
}

export default function SopDelPuesto({ puesto, puestoPersona }) {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    let vivo = true
    cargarSops().then((d) => vivo && setDatos(d))
    return () => { vivo = false }
  }, [])
  if (!datos || (!datos.puestos.length && !datos.carpeta)) return null
  const sop = sopDe(datos.puestos, puesto, puestoPersona)
  const rol = puesto || puestoPersona
  return (
    <details className="er-detalle sop-puesto" open={!!sop}>
      <summary>SOP del puesto{sop ? `: ${sop.nombre}` : rol ? ` (${rol}: sin SOP vinculado)` : ''}</summary>
      <ul>
        {sop && <li><a href={sop.url} target="_blank" rel="noopener noreferrer">Abrir el SOP de {sop.nombre}</a> — lo que cobra y los criterios del variable.</li>}
        {datos.carpeta && <li><a href={datos.carpeta} target="_blank" rel="noopener noreferrer">Carpeta con los SOPs de todos los puestos</a></li>}
      </ul>
    </details>
  )
}
