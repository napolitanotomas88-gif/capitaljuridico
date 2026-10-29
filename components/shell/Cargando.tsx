// Mientras el servidor lee la planilla (o el snapshot) para armar una pantalla del CRM. Sin animaciones: solo texto.
// Cada sección que lee datos lo usa desde su propio loading.tsx (queda debajo de la barrera de acceso del layout de la sección).
export function Cargando() {
  return (
    <p className="cj-cargando cj-etiqueta" role="status">
      Leyendo la planilla del CRM…
    </p>
  )
}
