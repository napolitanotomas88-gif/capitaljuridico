import type { sheets_v4 } from "googleapis";
import { SITUACIONES_POR_DEFECTO } from "@/lib/crm/config/crm";
import { spreadsheetId } from "@/lib/crm/config";
import { sheets } from "./cliente";
import { COLUMNAS, rango } from "./columnas";

// Lee la validación de datos (el desplegable) de V para ofrecer la lista real de situaciones.

const TTL_MS = 10 * 60 * 1000;
/**
 * Si la lectura falla (429, 5xx), la lista por defecto se guarda poco: no es la de la hoja (trae
 * opciones que su validación estricta rechaza) y no conviene ofrecerla 10 minutos.
 */
export const TTL_ERROR_MS = 30 * 1000;
const cache = new Map<string, { hasta: number; situacion: string[] }>();

export function invalidarCacheDesplegables() {
  cache.clear();
}

/** Interpreta una regla de validación: lista fija, o el rango de donde sale. Pura. */
export function opcionesDeValidacion(
  regla: sheets_v4.Schema$DataValidationRule | null | undefined,
): { lista: string[] } | { rangoOrigen: string } | null {
  const valores = (regla?.condition?.values ?? []).map((v) => v.userEnteredValue ?? "").filter((v) => v.trim());
  if (regla?.condition?.type === "ONE_OF_LIST" && valores.length) return { lista: valores };
  if (regla?.condition?.type === "ONE_OF_RANGE" && valores[0]) return { rangoOrigen: valores[0].replace(/^=/, "") };
  return null;
}

export async function leerDesplegables(hoja: string): Promise<{ situacion: string[] }> {
  const enCache = cache.get(hoja);
  if (enCache && enCache.hasta > Date.now()) return { situacion: enCache.situacion };

  let situacion: string[] = [...SITUACIONES_POR_DEFECTO];
  let ttl = TTL_MS;
  try {
    const api = sheets();
    const res = await api.spreadsheets.get({
      spreadsheetId: spreadsheetId(),
      ranges: [rango(hoja, `${COLUMNAS.situacion}2`)],
      includeGridData: true,
      fields: "sheets.data.rowData.values.dataValidation",
    });
    const regla = res.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
    const opciones = opcionesDeValidacion(regla);
    if (opciones && "lista" in opciones) {
      situacion = opciones.lista;
    } else if (opciones && "rangoOrigen" in opciones) {
      const origen = await api.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: opciones.rangoOrigen });
      const lista = (origen.data.values ?? []).flat().map((v) => String(v ?? "").trim()).filter(Boolean);
      if (lista.length) situacion = lista;
    }
  } catch (e) {
    console.error(`[desplegables] no se pudo leer la validación de V en "${hoja}": ${(e as Error).message}`);
    ttl = TTL_ERROR_MS;
  }

  // El seguimiento se decide aparte; conservar los valores históricos del Sheet.
  situacion = situacion.filter((valor) => valor.trim().replace(/\s+/g, " ").toLowerCase() !== "follow up");
  cache.set(hoja, { hasta: Date.now() + ttl, situacion });
  return { situacion };
}
