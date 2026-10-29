import type { Seccion } from '@/lib/auth/roles'

// A quién le toca una notificación que va a una sección (menú rápido): el nombre de la sección como lo dice el equipo.
export const NOMBRE_SECCION_CORTO: Partial<Record<Seccion, string>> = {
  resumen: 'socios', guiones: 'Guiones', edicion: 'Edición', ventas: 'Ventas', cuotas: 'Cobro de cuotas', trazabilidad: 'Trazabilidad',
  clientes: 'Clientes', referidos: 'Referidos', finanzas: 'Finanzas', anuncios: 'Anuncios', configuracion: 'administradores',
}
