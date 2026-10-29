import { spreadsheetId } from "@/lib/crm/config";
import { sheets } from "./cliente";
import { filaVisible } from "@/lib/crm/config/crm";
import { textoDesdeSerialSheets } from "@/lib/crm/fechas";
import { COLUMNAS, filaDesdeValores, indiceColumna, rango, ULTIMA_COLUMNA, type FilaLead } from "./columnas";

const INDICES_FECHA = [COLUMNAS.fechaCall, COLUMNAS.fechaReagenda, COLUMNAS.ultimoToque, COLUMNAS.proximoSeguimiento].map(indiceColumna);
// Rango de seriales que son fechas razonables (2000–2100). Otros números (como las claves
// de orden viejas de AG, 20260311110000) quedan como texto.
const SERIAL_MIN = 36526;
const SERIAL_MAX = 73051;

// Caché corta en memoria por hoja (BRIEF.md §6). En Vercel es por instancia, alcanza
// para no pegarle a la API en cada render; las escrituras la invalidan.
const TTL_MS = 30_000;
const cache = new Map<string, { hasta: number; filas: FilaLead[] }>();
/**
 * Sube con cada invalidación. Una lectura que salió antes de una escritura no vuelve a llenar la
 * caché al llegar (traería la fila vieja): devuelve lo que leyó, pero no lo guarda.
 */
let generacion = 0;

export function invalidarCache(hoja?: string) {
  generacion += 1;
  if (hoja) cache.delete(hoja);
  else cache.clear();
}

/**
 * Después de una escritura exitosa: la fila escrita queda en la caché con sus valores nuevos, en
 * vez de tirar la hoja entera. Así el `router.refresh()` que sigue a cada botón no gasta otra
 * lectura de la hoja (la cuota de la API es por minuto y es una sola cuenta de servicio). No
 * alarga el vencimiento de la caché. Sube la generación: una lectura que salió antes de la
 * escritura no repuebla la caché con la fila vieja. Si la fila no estaba en la caché, se invalida.
 */
export function actualizarFilaEnCache(fila: FilaLead) {
  generacion += 1;
  const enCache = cache.get(fila.hoja);
  if (!enCache) return;
  if (!enCache.filas.some((f) => f.numeroFila === fila.numeroFila)) {
    cache.delete(fila.hoja);
    return;
  }
  const filas = enCache.filas.map((f) => (f.numeroFila === fila.numeroFila ? fila : f));
  cache.set(fila.hoja, { hasta: enCache.hasta, filas });
}

/** Opciones de lectura: texto tal cual y fechas nativas como número de serie. */
const OPCIONES_LECTURA = {
  // Con FORMATTED_VALUE una fecha nativa formateada "dd/mm" llegaría sin año.
  valueRenderOption: "UNFORMATTED_VALUE",
  dateTimeRenderOption: "SERIAL_NUMBER",
} as const;

/** Convierte una fila cruda de la API (con seriales en D/AC/AG) a `FilaLead`. */
export function filaDesdeCeldasCrudas(hoja: string, numeroFila: number, celdas: unknown[]): FilaLead {
  const copia = [...celdas];
  for (const k of INDICES_FECHA) {
    const valor = copia[k];
    if (typeof valor === "number" && valor > SERIAL_MIN && valor < SERIAL_MAX) {
      copia[k] = textoDesdeSerialSheets(valor);
    }
  }
  return filaDesdeValores(hoja, numeroFila, copia);
}

const tieneDatos = (celdas: unknown[]) => celdas.some((c) => String(c ?? "").trim() !== "");

/**
 * Lee las filas de datos (A2:AH) de las hojas pedidas en un solo batchGet.
 * Devuelve solo filas con algún valor y que el CRM muestra (`filaVisible`: desde el corte de cada pestaña);
 * `numeroFila` es el número real en la planilla.
 */
export async function leerHojas(hojas: string[]): Promise<Map<string, FilaLead[]>> {
  const ahora = Date.now();
  const resultado = new Map<string, FilaLead[]>();
  const faltan: string[] = [];

  for (const hoja of hojas) {
    const enCache = cache.get(hoja);
    if (enCache && enCache.hasta > ahora) resultado.set(hoja, enCache.filas);
    else faltan.push(hoja);
  }

  if (faltan.length > 0) {
    const generacionInicial = generacion;
    const res = await sheets().spreadsheets.values.batchGet({
      spreadsheetId: spreadsheetId(),
      ranges: faltan.map((h) => rango(h, "A2", ULTIMA_COLUMNA)),
      ...OPCIONES_LECTURA,
    });

    faltan.forEach((hoja, i) => {
      const filas: FilaLead[] = [];
      (res.data.valueRanges?.[i]?.values ?? []).forEach((celdas, j) => {
        // Solo las filas de los closers actuales (`filaVisible`): las de arriba del corte no existen para el CRM
        if (tieneDatos(celdas) && filaVisible(hoja, j + 2)) filas.push(filaDesdeCeldasCrudas(hoja, j + 2, celdas));
      });
      if (generacion === generacionInicial) cache.set(hoja, { hasta: ahora + TTL_MS, filas });
      resultado.set(hoja, filas);
    });
  }

  return resultado;
}

/**
 * Relee UNA fila directo de la API (sin caché), con la misma conversión que `leerHojas`.
 * Es lo que usa la escritura segura para verificar nombre + teléfono. null si la fila está vacía.
 */
export async function leerFila(hoja: string, numeroFila: number): Promise<FilaLead | null> {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: rango(hoja, `A${numeroFila}`, `${ULTIMA_COLUMNA}${numeroFila}`),
    ...OPCIONES_LECTURA,
  });
  const celdas = res.data.values?.[0] ?? [];
  return tieneDatos(celdas) ? filaDesdeCeldasCrudas(hoja, numeroFila, celdas) : null;
}
