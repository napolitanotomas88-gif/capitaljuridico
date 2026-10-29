// Qué tipo de falla hizo caer una pantalla, sin mandarle detalles al navegador
// (docs/arquitectura.md §Errores). Funciones puras: las importan el servidor, `error.tsx` y los tests.
//
// En producción Next reemplaza el mensaje de un error del servidor por uno genérico y solo deja
// pasar `digest`. Next respeta el `digest` que ya trae el error (create-error-handler.js: "If the
// error already has a digest, respect the original digest"), así que acá se lo ponemos con un
// prefijo que dice el tipo: "SKWD_CONFIGURACION_1a2b3c4d". El detalle completo queda en el log
// del servidor con ese mismo código.

export type TipoFalla = "configuracion" | "google" | "desconocido";

const PREFIJO: Record<Exclude<TipoFalla, "desconocido">, string> = {
  configuracion: "SKWD_CONFIGURACION_",
  google: "SKWD_GOOGLE_",
};

function sufijoAlAzar(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "SKWD_GOOGLE_1a2b3c4d": el tipo para `error.tsx` y un sufijo para encontrarlo en los logs. */
export function digestPara(tipo: Exclude<TipoFalla, "desconocido">): string {
  return `${PREFIJO[tipo]}${sufijoAlAzar()}`;
}

/** El tipo a partir del `digest` que llega a `error.tsx`. Cualquier otro digest es "desconocido". */
export function tipoDesdeDigest(digest: string | undefined): TipoFalla {
  if (digest?.startsWith(PREFIJO.configuracion)) return "configuracion";
  if (digest?.startsWith(PREFIJO.google)) return "google";
  return "desconocido";
}

/**
 * Falta una variable de entorno o tiene un formato inválido (`config.ts`, `SESSION_SECRET`).
 * Trae su `digest` desde que se crea: cualquier pantalla que la lance muestra "Falta configurar".
 */
export class ErrorConfiguracion extends Error {
  readonly digest: string;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfiguracion";
    this.digest = digestPara("configuracion");
  }
}

// Errores de red de Node / fetch: Google no contestó.
const CODIGOS_RED = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPIPE", "TimeoutError", "AbortError"]);
// La clave o la cuenta de servicio están mal cargadas (se ve al autenticar contra Google).
const CREDENCIALES = /DECODER routines|PEM|error:1E08010C|No key or keyfile|invalid_grant|invalid_client|private key/i;

/**
 * Clasifica un error de las lecturas de la planilla:
 * - configuración: credenciales mal pegadas, planilla no compartida (401/403), id incorrecto (404)
 *   o una hoja de CLOSERS_JSON que no existe ("Unable to parse range"). No se arregla reintentando.
 * - google: cuota (429), errores 5xx o de red. Suele pasar solo.
 * - null: cualquier otra cosa (un error de la app).
 */
export function clasificarError(e: unknown): Exclude<TipoFalla, "desconocido"> | null {
  if (e instanceof ErrorConfiguracion) return "configuracion";
  if (!e || typeof e !== "object") return null;
  const { status, code, message } = e as { status?: unknown; code?: unknown; message?: unknown };
  const texto = typeof message === "string" ? message : "";
  const http = typeof status === "number" ? status : typeof code === "number" ? code : null;

  if (CREDENCIALES.test(texto)) return "configuracion";
  if (http !== null) {
    if (http === 429 || http >= 500) return "google";
    if (http === 403 && /quota|rate/i.test(texto)) return "google";
    if (http === 401 || http === 403 || http === 404) return "configuracion";
    if (http === 400 && /Unable to parse range/i.test(texto)) return "configuracion";
    return null;
  }
  if (typeof code === "string" && CODIGOS_RED.has(code)) return "google";
  if (/fetch failed|socket hang up|network/i.test(texto)) return "google";
  return null;
}

/**
 * Le pone el `digest` con el tipo a un error que va a hacer caer la pantalla. No toca los que ya
 * tienen uno: `redirect()` y `notFound()` también son errores con digest y tienen que pasar tal cual.
 */
export function marcarFalla<T>(e: T): T {
  if (!e || typeof e !== "object" || typeof (e as { digest?: unknown }).digest === "string") return e;
  const tipo = clasificarError(e);
  if (tipo) (e as { digest?: string }).digest = digestPara(tipo);
  return e;
}

/** Para las lecturas de las páginas: si fallan, la pantalla de error sabe de qué tipo fue. */
export async function conDiagnostico<T>(promesa: Promise<T>): Promise<T> {
  try {
    return await promesa;
  } catch (e) {
    throw marcarFalla(e);
  }
}

/** Lo que ve el usuario en `error.tsx`, sin detalles internos. */
export const TEXTO_FALLA: Record<TipoFalla, { titulo: string; texto: string }> = {
  configuracion: {
    titulo: "Falta configurar la app",
    texto:
      "A la app le falta un dato de conexión (las variables, el permiso de la cuenta de servicio sobre la planilla o el nombre de una hoja). No se arregla desde acá: avisale a Gero con el código de abajo.",
  },
  google: {
    titulo: "Google Sheets no respondió",
    texto:
      "La planilla no contestó a tiempo o Google frenó las lecturas por un rato. Esperá un minuto y tocá Reintentar. Lo que ya guardaste no se pierde.",
  },
  desconocido: {
    titulo: "Algo salió mal",
    texto: "Hubo un error inesperado en la app. Tocá Reintentar; si vuelve a pasar, avisale a Gero con el código de abajo.",
  },
};
