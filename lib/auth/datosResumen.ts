// ── Rutas de datos del Resumen, vistas desde el navegador ───────────────────────────────────
// /api/raw, /api/metrics y /api/ads responden 401 en JSON cuando la sesión de Google venció (proxy.ts y exigirAccesoApi,
// lib/auth/acceso.ts). Sin esto, app/page.tsx ignoraba ese { error } en silencio: la pantalla seguía mostrando datos viejos
// (y hasta marcaba "actualizado") hasta que alguien recargara. Con esto, el 401 lleva al login y al entrar vuelve al Resumen.
// Sin imports de Next ni de otros módulos de auth: lo carga el navegador y se prueba con node:test (scripts/test-rutas.mjs).

/** Login con vuelta al Resumen. Es lo mismo que destinoEntrar('/', '') de lib/auth/rutas.ts; un test controla que no se desfasen. */
export const LOGIN_VUELTA_AL_RESUMEN = '/entrar?next=/'

/** Lo que devuelve leerJsonDeDatos cuando la sesión venció: la misma forma { error } de cualquier otra falla de la API. */
export const ERROR_SESION_VENCIDA = 'Sesión vencida'

/**
 * JSON de la respuesta de una ruta de datos. Con 401 (sin sesión) llama a alVencer, que lleva al login, y devuelve
 * { error } para que quien la llamó conserve los datos que tenía. Cualquier otro estado se lee igual que antes (403, 500 y
 * demás siguen llegando como el JSON que manda la ruta; un cuerpo que no es JSON sigue lanzando).
 */
export async function leerJsonDeDatos(res: Response, alVencer: () => void): ReturnType<Response['json']> {
  if (res.status === 401) {
    alVencer()
    return { error: ERROR_SESION_VENCIDA }
  }
  return res.json()
}
