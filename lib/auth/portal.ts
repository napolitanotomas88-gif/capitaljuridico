// ── Portal del cliente (2/11/2026) ──────────────────────────────────────────────────────────────────────────────────────
// Pedido de Tomás: una pestaña dentro de Clientes para UN cliente puntual (estrategia de contenido orgánico personalizada) en
// la que el cliente ve su objetivo, el plan para llegar, sus guiones y cómo viene el proceso. El cliente entra con SU cuenta de
// Google y NO ve nada más del Despacho.
//   · Quién es cliente: la variable PORTAL_CLIENTES_JSON (Vercel, nunca en el repo) = {"mail@dominio": "ID_CRM"}. Un mail queda
//     atado a UN solo ID. Sin la variable (o con JSON roto) nadie entra como cliente: el portal queda solo para el equipo.
//   · El equipo manda: si un mail figura en AUTH_USUARIOS o en la planilla de Accesos, es equipo aunque también esté acá.
//   · El cliente solo puede abrir /clientes/portal/<su ID>. Cualquier otra página lo devuelve a su portal; cualquier /api, 403.
//     Lo decide lib/auth/rutas.ts (decidir) con estas funciones; la página vuelve a controlar con accesoPortal().
// Sin imports de Next: se prueba con node:test (scripts/test-portal-cliente.mjs).
import { normalizarEmail } from './email'

/** ID de cliente del CRM: una letra y hasta 6 dígitos (Z001, B012). */
export const ID_PORTAL = /^[A-Za-z]\d{1,6}$/
export const RUTA_PORTAL_BASE = '/clientes/portal'

/** Ruta del portal de un cliente (el ID siempre en mayúscula). */
export const rutaPortal = (id: string): string => `${RUTA_PORTAL_BASE}/${encodeURIComponent(id.toUpperCase())}`

/**
 * Parsea PORTAL_CLIENTES_JSON: un objeto {mail: ID}. Función pura (el aviso se inyecta). Reglas, todas fallan cerrado:
 *  · vacío, JSON inválido o algo que no sea un objeto → nadie;
 *  · mail o ID inválidos → esa entrada se ignora;
 *  · el mismo mail dos veces con IDs distintos (p. ej. con mayúsculas) → se descarta ese mail.
 * Los avisos nunca citan mails ni el contenido de la variable.
 */
export function parsearPortalClientes(crudo: string | undefined, avisar: (m: string) => void = (m) => console.warn(m)): Map<string, string> {
  const salida = new Map<string, string>()
  if (!crudo || !crudo.trim()) return salida
  let datos: unknown
  try {
    datos = JSON.parse(crudo)
  } catch {
    avisar('[portal] PORTAL_CLIENTES_JSON no es un JSON válido: ningún cliente entra')
    return salida
  }
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    avisar('[portal] PORTAL_CLIENTES_JSON tiene que ser un objeto {"mail": "ID"}: ningún cliente entra')
    return salida
  }
  const descartados = new Set<string>()
  Object.entries(datos as Record<string, unknown>).forEach(([mailCrudo, idCrudo], i) => {
    const mail = normalizarEmail(mailCrudo)
    if (!mail) return avisar(`[portal] PORTAL_CLIENTES_JSON: entrada ${i + 1} ignorada (mail inválido)`)
    if (typeof idCrudo !== 'string' || !ID_PORTAL.test(idCrudo.trim())) return avisar(`[portal] PORTAL_CLIENTES_JSON: entrada ${i + 1} ignorada (ID inválido)`)
    const id = idCrudo.trim().toUpperCase()
    if (descartados.has(mail)) return
    const previo = salida.get(mail)
    if (previo && previo !== id) {
      salida.delete(mail)
      descartados.add(mail)
      return avisar(`[portal] PORTAL_CLIENTES_JSON: un mail aparece con dos IDs distintos: se descarta`)
    }
    salida.set(mail, id)
  })
  return salida
}

let memo: { crudo: string | undefined; mapa: Map<string, string> } | null = null

/** El ID de cliente atado a ese mail, o null. */
export function idPortalDeMail(email: unknown): string | null {
  const mail = normalizarEmail(email)
  if (!mail) return null
  const crudo = process.env.PORTAL_CLIENTES_JSON
  if (!memo || memo.crudo !== crudo) memo = { crudo, mapa: parsearPortalClientes(crudo) }
  return memo.mapa.get(mail) ?? null
}

/** IDs de cliente que tienen al menos un mail habilitado (para mostrar «con acceso» en el Despacho; sin mails). */
export function idsConMailDePortal(): Set<string> {
  idPortalDeMail('x@x.xx') // asegura el memo con el valor actual de la variable
  return new Set(memo?.mapa.values() ?? [])
}

/** ¿La ruta (ya normalizada: minúsculas, sin barra final) es exactamente el portal de ese cliente? */
export function esRutaDelPortal(rutaNormalizada: string, id: string | null | undefined): boolean {
  if (!id || !ID_PORTAL.test(id)) return false
  return rutaNormalizada === `${RUTA_PORTAL_BASE}/${id.toLowerCase()}`
}

/** Lo mínimo de una sesión que hace falta para decidir. */
export type QuienPortal = { rol: string; clienteId?: string | null }

export type AccesoPortal =
  | { tipo: 'cliente'; id: string }
  | { tipo: 'equipo'; id: string }
  | { tipo: 'redirigir'; destino: string }
  | { tipo: 'no_existe' }

/**
 * Segunda barrera, en la página del portal. `veClientes` = la sesión del equipo puede ver la sección Clientes (Cartera).
 *  · ID mal formado → no existe (404).
 *  · Cliente: su propio ID → entra en modo lectura; otro ID → a su portal; sin ID atado → a /entrar.
 *  · Equipo con Clientes → entra y edita. Equipo sin Clientes → a donde diga `sinPermiso`.
 */
export function accesoPortal(quien: QuienPortal, idPedido: string, veClientes: boolean, sinPermiso: string): AccesoPortal {
  if (!ID_PORTAL.test(idPedido)) return { tipo: 'no_existe' }
  const id = idPedido.toUpperCase()
  if (quien.rol === 'cliente') {
    const propio = quien.clienteId && ID_PORTAL.test(quien.clienteId) ? quien.clienteId.toUpperCase() : null
    if (!propio) return { tipo: 'redirigir', destino: '/entrar?error=sin_secciones' }
    return propio === id ? { tipo: 'cliente', id } : { tipo: 'redirigir', destino: rutaPortal(propio) }
  }
  return veClientes ? { tipo: 'equipo', id } : { tipo: 'redirigir', destino: sinPermiso }
}
