// Firma de las escrituras del CRM para poder deshacerlas desde el toast (HMAC-SHA256, Web Crypto).
// La sesión ya no vive acá: es la de Google del dashboard (lib/auth/*). Solo queda lo de las operaciones.
import { ErrorConfiguracion } from "@/lib/crm/errores";
import { secretoOperaciones } from "@/lib/crm/config";

/** El `nombre` de la sesión de admin (es lo que queda en la columna Closer del log). */
export const NOMBRE_ADMIN = "Admin";

const codificador = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function desdeBase64url(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(texto)) return null;
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (texto.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function clave(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", codificador.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const x = codificador.encode(a);
  const y = codificador.encode(b);
  let distinto = x.length ^ y.length;
  const largo = Math.max(x.length, y.length);
  for (let i = 0; i < largo; i++) distinto |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return distinto === 0;
}

/** Lo que identifica una escritura para poder deshacerla desde el toast (ver `firmarOperacion`). */
export type DatosOperacion = {
  hoja: string;
  numeroFila: number;
  antes: Readonly<Record<string, string | undefined>>;
  despues: Readonly<Record<string, string | undefined>>;
  motivo: string;
};

/** Siempre el mismo texto para los mismos datos, sin importar el orden de las claves. */
function textoOperacion(d: DatosOperacion): string {
  const ordenado = (o: DatosOperacion["antes"]) =>
    Object.entries(o)
      .map(([campo, valor]) => [campo, valor ?? ""])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(["operacion", d.hoja, d.numeroFila, ordenado(d.antes), ordenado(d.despues), d.motivo]);
}

/**
 * Firma de una escritura hecha (HMAC-SHA256 con AUTH_SECRET, base64url). `ejecutarAccion` la
 * devuelve con la operación y `deshacerAccion` (el Deshacer del toast) la exige: así el cliente
 * solo puede restaurar el `antes` de una escritura que hizo la app, no cualquier valor.
 */
export async function firmarOperacion(datos: DatosOperacion, secreto = secretoOperaciones()): Promise<string> {
  if (!secreto) throw new ErrorConfiguracion("Falta AUTH_SECRET");
  const firma = await crypto.subtle.sign("HMAC", await clave(secreto), codificador.encode(textoOperacion(datos)));
  return base64url(new Uint8Array(firma));
}

/** true si `firma` corresponde a esos datos. Nunca lanza. */
export async function verificarOperacion(datos: DatosOperacion, firma: unknown, secreto = secretoOperaciones()): Promise<boolean> {
  if (typeof firma !== "string" || !secreto) return false;
  const bytes = desdeBase64url(firma);
  if (!bytes || bytes.length !== 32) return false;
  try {
    return await crypto.subtle.verify("HMAC", await clave(secreto), bytes, codificador.encode(textoOperacion(datos)));
  } catch {
    return false;
  }
}
