// Configuración del CRM de ventas dentro del dashboard unificado. Solo servidor: acá viven los secretos.
// Cambios respecto del CRM original: la planilla sale de SHEET_ID_VENTAS, las credenciales de Google son las del
// dashboard (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY) y el login es el de Google del dashboard: ya no hay PIN
// ni CLOSERS_JSON. Quién ve qué pestaña lo decide AUTH_USUARIOS (rol y nombre) + AUTH_VENTAS_PESTANAS (mail → pestañas).
import { buscarUsuario, listarAccesos, normalizarEmail } from "@/lib/auth/usuarios";
import { ErrorConfiguracion } from "@/lib/crm/errores";
import { PESTANAS_VENTAS } from "@/lib/ventas/pendientes";

export type Closer = {
  id: string;
  nombre: string;
  /** Nombre exacto de la pestaña en el Sheet, p. ej. "Closer 1". */
  hoja: string;
};

/** Pestañas de closers del CRM (BRIEF.md §3). */
export const HOJAS_CLOSERS_POR_DEFECTO: readonly string[] = PESTANAS_VENTAS;

/**
 * Planilla ORIGINAL "2026 - CRM Ventas - SKWD". La app se niega a escribir ahí salvo que
 * PERMITIR_ESCRITURA_ORIGINAL=si (decisión de Tomás, solo cuando la cuenta de servicio tenga permiso de edición).
 */
export const ID_ORIGINAL = process.env.SHEET_ID_VENTAS_ORIGINAL?.trim() ?? "";

function requerida(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new ErrorConfiguracion(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export function spreadsheetId(): string {
  return requerida("SHEET_ID_VENTAS");
}

/** true si se puede escribir en la planilla configurada (docs/arquitectura.md §Escritura segura del CRM original). */
export function escrituraPermitida(): boolean {
  const destino = spreadsheetId();
  return !!ID_ORIGINAL && (destino !== ID_ORIGINAL || process.env.PERMITIR_ESCRITURA_ORIGINAL?.trim() === "si");
}

/**
 * La clave privada tal como la pegan: en .env y en Vercel suele quedar con "\n" literales en vez
 * de saltos de línea, y a veces con las comillas del JSON o del .env alrededor.
 */
export function limpiarClavePrivada(cruda: string): string {
  let clave = cruda.trim();
  const m = /^(["'])([\s\S]*)\1$/.exec(clave);
  if (m) clave = m[2].trim();
  return `${clave.replace(/\\r\\n|\\n/g, "\n").trim()}\n`;
}

export function credencialesGoogle(): { email: string; privateKey: string } {
  return {
    email: requerida("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: limpiarClavePrivada(requerida("GOOGLE_PRIVATE_KEY")),
  };
}

/** Secreto para firmar los "Deshacer": el mismo AUTH_SECRET del dashboard (≥ 32 caracteres), con un prefijo propio. */
export function secretoOperaciones(): string {
  const secreto = process.env.AUTH_SECRET?.trim() ?? "";
  if (secreto.length < 32) throw new ErrorConfiguracion("Falta AUTH_SECRET (32 caracteres o más)");
  return `crm-operaciones:${secreto}`;
}

/** Id estable de una pestaña para la URL: "Closer 1" → "closer-1", "Gero-Xavi Rejunte" → "gero-xavi-rejunte". */
export function idDeHoja(hoja: string): string {
  return hoja
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Mail → pestañas, tal como lo cargó el socio en AUTH_VENTAS_PESTANAS (entradas inválidas se ignoran). */
function asignaciones(): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  try {
    const datos: unknown = JSON.parse(process.env.AUTH_VENTAS_PESTANAS ?? "{}");
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return mapa;
    for (const [mail, valor] of Object.entries(datos as Record<string, unknown>)) {
      const email = normalizarEmail(mail);
      if (!email || !Array.isArray(valor)) continue;
      const hojas = valor.filter((p): p is string => typeof p === "string" && HOJAS_CLOSERS_POR_DEFECTO.includes(p));
      if (hojas.length) mapa.set(email, [...new Set(hojas)]);
    }
  } catch {
    /* JSON inválido: nadie tiene pestañas asignadas */
  }
  // Las pestañas que se asignaron desde Configuración (planilla de Accesos) se suman a las de AUTH_VENTAS_PESTANAS
  for (const a of listarAccesos()) {
    if (!a.pestanas.length) continue;
    mapa.set(a.email, [...new Set([...(mapa.get(a.email) ?? []), ...a.pestanas.filter((p) => HOJAS_CLOSERS_POR_DEFECTO.includes(p))])]);
  }
  return mapa;
}

/**
 * Las pestañas de closers con su nombre: el de su dueño si es uno solo (AUTH_USUARIOS + AUTH_VENTAS_PESTANAS), y si no,
 * el nombre de la pestaña. Dueño = quien tiene asignada SOLO esa pestaña. Quien tiene varias (p. ej. el pre-caller, que
 * trabaja en todas: pedido de Tomás, 17/10/2026) no le pone su nombre a ninguna.
 */
export function closers(): Closer[] {
  const asignadas = asignaciones();
  return HOJAS_CLOSERS_POR_DEFECTO.map((hoja) => {
    const personas = [...asignadas].filter(([, hojas]) => hojas.length === 1 && hojas[0] === hoja).map(([mail]) => buscarUsuario(mail)?.nombre);
    const unica = personas.length === 1 ? personas[0] : undefined;
    return { id: idDeHoja(hoja), nombre: unica ?? hoja, hoja };
  });
}

export function hojasClosers(): string[] {
  return [...HOJAS_CLOSERS_POR_DEFECTO];
}

/** Nombre del closer dueño de una hoja (p. ej. arriba del panel de la ficha). Si no hay dueño único, la hoja. */
export function nombreCloserDeHoja(hoja: string): string {
  return closers().find((c) => c.hoja === hoja)?.nombre ?? hoja;
}

/** Pestañas que puede abrir un mail con rol closer o setter (vacío si no tiene ninguna asignada). */
export function hojasDeMail(email: string): string[] {
  return asignaciones().get(normalizarEmail(email) ?? "") ?? [];
}
