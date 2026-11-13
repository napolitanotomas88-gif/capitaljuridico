// Esqueleto de Ventas: mientras se leen las hojas del CRM (en frío, unos 10 s; medido el 13/11/2026). Todas las pantallas
// de Ventas comparten la forma: la barra de la marca arriba y, abajo, cifras y tarjetas. Mismas clases que esas pantallas y
// que el esqueleto de Cobro de cuotas (el pulso solo corre sin «reducir movimiento»).
// Dónde se usa: como loading.tsx de las pantallas que leen datos (admin, ficha del lead y guía) y como reserva del <Suspense>
// de «Mi día» (/ventas y /ventas/closer/[id]). Esas dos páginas NO llevan loading.tsx a propósito: primero deciden a dónde
// va cada uno (redirect) y esa redirección tiene que seguir siendo un 307 real, no una dentro de la respuesta ya empezada.
const BLOQUE = 'rounded-2xl border border-gris-linea bg-blanco motion-safe:animate-pulse'

export function CargandoVentas() {
  return (
    <div role="status" aria-busy="true" aria-label="Leyendo el CRM de ventas…" className="flex flex-1 flex-col">
      <div className="marca-barra bg-negro" style={{ paddingTop: 'env(safe-area-inset-top)' }} aria-hidden="true">
        <div className="h-[68px]" />
      </div>
      <div className="w-full flex-1 space-y-6 px-4 pb-28 pt-5 lg:px-6 lg:pb-5" aria-hidden="true">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className={`h-20 ${BLOQUE}`} />)}
        </div>
        <div className={`h-72 ${BLOQUE}`} />
        <div className={`h-40 ${BLOQUE}`} />
      </div>
    </div>
  )
}
