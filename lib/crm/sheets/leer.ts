import { spreadsheetId } from "@/lib/crm/config";
import { sheets } from "./cliente";
import { filaVisible } from "@/lib/crm/config/crm";
import { textoDesdeSerialSheets } from "@/lib/crm/fechas";
import { COLUMNAS, filaDesdeValores, indiceColumna, rango, ultimaColumnaLectura, type FilaLead } from "./columnas";
import { precallV2Activo } from "@/lib/crm/config/precallV2";
import { conCache, invalidarEtiqueta } from "@/lib/anuncios/cache";
import { claveDePlanilla, ETIQUETA_CRM_VENTAS } from "./cacheCompartida";

const INDICES_FECHA = [COLUMNAS.fechaCall, COLUMNAS.fechaReagenda, COLUMNAS.ultimoToque, COLUMNAS.proximoSeguimiento].map(indiceColumna);
// Rango de seriales que son fechas razonables (2000–2100). Otros números (como las claves
// de orden viejas de AG, 20260311110000) quedan como texto.
const SERIAL_MIN = 36526;
const SERIAL_MAX = 73051;

// Dos capas (velocidad, tanda 2):
//   1) Memoria por hoja (BRIEF.md §6), 30 s por instancia. Las escrituras la actualizan con la fila escrita.
//   2) Caché COMPARTIDA entre instancias (conCache: Data Cache de Next), 60 s, con el último dato bueno mientras se refresca
//      de fondo. Guarda las celdas crudas (más chicas que FilaLead), con una etiqueta por hoja: toda escritura del CRM
//      (escribir.ts → invalidarCache / actualizarFilaEnCache) la invalida en todas las instancias.
// Lo que decide o escribe (la reagenda de Calendly, el setter de un alta) lee con `alDia`: directo de la API, sin cachés.
const TTL_MS = 30_000;
const CACHE_COMPARTIDA_SEG = 60;
const etiquetaHoja = (hoja: string) => `${ETIQUETA_CRM_VENTAS}-hoja:${hoja}`;
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
  invalidarEtiqueta(hoja ? etiquetaHoja(hoja) : ETIQUETA_CRM_VENTAS);
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
  // Las otras instancias (y la caché compartida) vuelven a leer la hoja: solo esta tiene la fila nueva en memoria
  invalidarEtiqueta(etiquetaHoja(fila.hoja));
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

/** Filas con algún dato de una hoja, crudas: [número real de fila, celdas]. Es lo que guarda la caché compartida (JSON). */
type FilasCrudas = [number, unknown[]][];

/** Un solo batchGet para las hojas pedidas, en el mismo orden. Sin cachés. */
async function leerCrudas(hojas: string[]): Promise<FilasCrudas[]> {
  const res = await sheets().spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(),
    ranges: hojas.map((h) => rango(h, "A2", ultimaColumnaLectura(precallV2Activo()))),
    ...OPCIONES_LECTURA,
  });
  return hojas.map((_, i) => {
    const filas: FilasCrudas = [];
    (res.data.valueRanges?.[i]?.values ?? []).forEach((celdas, j) => {
      if (tieneDatos(celdas)) filas.push([j + 2, celdas]);
    });
    return filas;
  });
}

/** Las mismas hojas desde la caché compartida (una clave por conjunto de hojas, una etiqueta por hoja). */
async function leerCrudasCompartidas(hojas: string[]): Promise<FilasCrudas[]> {
  const ordenadas = [...hojas].sort();
  const clave = `${claveDePlanilla("crm-ventas-hojas-v1", spreadsheetId())}:${ultimaColumnaLectura(precallV2Activo())}:${ordenadas.join("|")}`;
  const r = await conCache(clave, CACHE_COMPARTIDA_SEG, () => leerCrudas(ordenadas), {
    etiquetas: [ETIQUETA_CRM_VENTAS, ...ordenadas.map(etiquetaHoja)],
  });
  const porHoja = new Map(ordenadas.map((h, i) => [h, Array.isArray(r.data?.[i]) ? r.data[i] : []]));
  return hojas.map((h) => porHoja.get(h) ?? []);
}

export type OpcionesLectura = {
  /** true = directo de la API, sin ninguna caché (para lo que decide o escribe). Igual deja la lectura en la memoria. */
  alDia?: boolean;
};

/**
 * Lee las filas de datos (A2:AH) de las hojas pedidas en un solo batchGet.
 * Devuelve solo filas con algún valor y que el CRM muestra (`filaVisible`: desde el corte de cada pestaña);
 * `numeroFila` es el número real en la planilla.
 */
export async function leerHojas(hojas: string[], opciones: OpcionesLectura = {}): Promise<Map<string, FilaLead[]>> {
  const ahora = Date.now();
  const resultado = new Map<string, FilaLead[]>();
  const faltan: string[] = [];

  for (const hoja of hojas) {
    const enCache = opciones.alDia ? undefined : cache.get(hoja);
    if (enCache && enCache.hasta > ahora) resultado.set(hoja, enCache.filas);
    else faltan.push(hoja);
  }

  if (faltan.length > 0) {
    const generacionInicial = generacion;
    const crudas = opciones.alDia ? await leerCrudas(faltan) : await leerCrudasCompartidas(faltan);
    // Hubo una escritura mientras se leía: lo que trajo la caché compartida puede ser de antes. Se devuelve, pero no se
    // guarda en memoria, y se vuelve a invalidar para que nadie lo sirva (la escritura ya invalidó, pero esta lectura
    // pudo haber vuelto a llenar la memoria de conCache con el dato viejo).
    const huboEscritura = generacion !== generacionInicial;
    if (huboEscritura && !opciones.alDia) for (const hoja of faltan) invalidarEtiqueta(etiquetaHoja(hoja));

    faltan.forEach((hoja, i) => {
      // Solo las filas de los closers actuales (`filaVisible`): las de arriba del corte no existen para el CRM
      const filas = (crudas[i] ?? [])
        .filter(([numeroFila]) => filaVisible(hoja, numeroFila))
        .map(([numeroFila, celdas]) => filaDesdeCeldasCrudas(hoja, numeroFila, celdas));
      if (!huboEscritura) cache.set(hoja, { hasta: ahora + TTL_MS, filas });
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
    range: rango(hoja, `A${numeroFila}`, `${ultimaColumnaLectura(precallV2Activo())}${numeroFila}`),
    ...OPCIONES_LECTURA,
  });
  const celdas = res.data.values?.[0] ?? [];
  return tieneDatos(celdas) ? filaDesdeCeldasCrudas(hoja, numeroFila, celdas) : null;
}
