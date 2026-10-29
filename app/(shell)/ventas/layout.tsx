import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de acceso de Ventas a nivel de segmento: corre ANTES del límite de carga (loading.tsx), así un rol sin permiso
// recibe un 307 real y no una redirección dentro de la respuesta ya empezada. Cada página la repite (un layout no se
// vuelve a ejecutar en cada navegación dentro del segmento).
// `crm-raiz` marca el CRM de ventas: cj.css le da todo el ancho de la ventana (sus tableros son de 5 columnas) y
// reinicia lo que el CRM original esperaba a nivel de página (campos de 16 px para que iOS no haga zoom).
export default async function VentasLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('ventas')
  return <div className="crm-raiz">{children}</div>
}
