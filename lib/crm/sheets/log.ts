import { spreadsheetId } from "@/lib/crm/config";
import type { EntradaLog } from "@/lib/crm/contratos";
import { sheets } from "./cliente";
import { rango } from "./columnas";
import { ENCABEZADOS_LOG, normalizarTexto } from "./verificacion";
import { conCache, invalidarEtiqueta } from "@/lib/anuncios/cache";
import { claveDePlanilla, ETIQUETA_CRM_VENTAS } from "./cacheCompartida";

// Hoja "Log App": una fila por celda que escribe la app (BRIEF.md §6). Sirve para auditar,
// para Deshacer, para "Hechas hoy" y para el historial de la ficha.

export const HOJA_LOG = "Log App";
const ULTIMA_COLUMNA_LOG = "K"; // 11 columnas, ver ENCABEZADOS_LOG

let existeConfirmado = false;
let creando: Promise<void> | null = null;

const mensajeDe = (e: unknown) => String((e as Error)?.message ?? e);
/** La API contesta 400 "A sheet with the name ... already exists" si otra escritura la creó antes. */
const esYaExiste = (e: unknown) => /already exists/i.test(mensajeDe(e));
/** 400 "Unable to parse range: 'Log App'!A:K": la hoja no existe (p. ej. alguien la borró). */
const esHojaInexistente = (e: unknown) =>
  (e as { code?: number })?.code === 400 && /unable to parse range/i.test(mensajeDe(e));

/**
 * Crea la hoja con sus encabezados si no existe, en un solo batchUpdate (addSheet + updateCells
 * con el mismo sheetId): así nunca queda una hoja sin encabezados en la que otra escritura agregue
 * filas. Si otra instancia la creó al mismo tiempo, el addSheet falla con "already exists" y se
 * sigue como si existiera. Dentro de una instancia, las llamadas simultáneas comparten la creación.
 */
export async function asegurarHojaLog(): Promise<void> {
  if (existeConfirmado) return;
  creando ??= (async () => {
    const api = sheets();
    const id = spreadsheetId();
    const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
    const existe = (meta.data.sheets ?? []).some((s) => s.properties?.title === HOJA_LOG);
    if (!existe) {
      const sheetId = 1 + Math.floor(Math.random() * 2_000_000_000);
      try {
        await api.spreadsheets.batchUpdate({
          spreadsheetId: id,
          requestBody: {
            requests: [
              { addSheet: { properties: { sheetId, title: HOJA_LOG } } },
              {
                updateCells: {
                  start: { sheetId, rowIndex: 0, columnIndex: 0 },
                  rows: [{ values: ENCABEZADOS_LOG.map((t) => ({ userEnteredValue: { stringValue: t } })) }],
                  fields: "userEnteredValue",
                },
              },
            ],
          },
        });
      } catch (e) {
        if (!esYaExiste(e)) throw e;
      }
    }
    existeConfirmado = true;
  })().finally(() => {
    creando = null;
  });
  return creando;
}

async function append(filas: (string | number)[][]) {
  await sheets().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: rango(HOJA_LOG, "A", ULTIMA_COLUMNA_LOG),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: filas },
  });
}

/**
 * Agrega filas al final del log. RAW: el log guarda texto tal cual, sin que el Sheet lo interprete.
 * Si el append falla porque la hoja ya no existe, se olvida que existía, se crea y se reintenta una vez.
 */
export async function agregarAlLog(filas: (string | number)[][]): Promise<void> {
  if (filas.length === 0) return;
  await asegurarHojaLog();
  try {
    await append(filas);
  } catch (e) {
    if (!esHojaInexistente(e)) throw e;
    existeConfirmado = false;
    await asegurarHojaLog();
    await append(filas);
  }
  agregarACacheLog(filas);
}

// Dos capas, como las hojas (leer.ts): memoria de 30 s por instancia y caché compartida de 60 s (filas crudas). Cada
// agregado al log y cada invalidación la invalidan en todas las instancias. Deshacer lee con `alDia`.
const TTL_MS = 30_000;
const CACHE_COMPARTIDA_SEG = 60;
const ETIQUETA_LOG = `${ETIQUETA_CRM_VENTAS}-log`;
let cacheLog: { hasta: number; entradas: EntradaLog[] } | null = null;
/** Sube con cada invalidación: una lectura que empezó antes no vuelve a llenar la caché. */
let generacion = 0;

export function invalidarCacheLog() {
  cacheLog = null;
  generacion += 1;
  invalidarEtiqueta(ETIQUETA_LOG);
}

const texto = (c: unknown) => (c == null ? "" : String(c));

/** Una fila de la hoja (en el orden de ENCABEZADOS_LOG) como `EntradaLog`. */
function entradaDesdeFila(f: unknown[]): EntradaLog {
  return {
    fecha: texto(f[0]),
    operacion: texto(f[1]),
    closer: texto(f[2]),
    hoja: texto(f[3]),
    fila: Number(f[4]) || 0,
    lead: texto(f[5]),
    columna: texto(f[6]),
    campo: texto(f[7]),
    antes: texto(f[8]),
    despues: texto(f[9]),
    motivo: texto(f[10]),
  };
}

/**
 * Lo que se acaba de agregar al log también se agrega a la caché (si la hay), en vez de tirarla:
 * el `router.refresh()` que sigue a cada botón no vuelve a leer el log entero. Es lo mismo que
 * leería la API (el log se escribe RAW). Sube la generación, como `invalidarCacheLog`.
 */
function agregarACacheLog(filas: (string | number)[][]) {
  generacion += 1;
  invalidarEtiqueta(ETIQUETA_LOG); // las otras instancias vuelven a leer el log
  if (cacheLog) cacheLog = { hasta: cacheLog.hasta, entradas: [...cacheLog.entradas, ...filas.map(entradaDesdeFila)] };
}

/** Las filas con algún dato del log, crudas (lo que guarda la caché compartida). [] si la hoja no existe todavía. */
async function leerFilasLog(): Promise<unknown[][]> {
  let filas: unknown[][] = [];
  try {
    const res = await sheets().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: rango(HOJA_LOG, "A2", ULTIMA_COLUMNA_LOG),
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    filas = res.data.values ?? [];
  } catch (e) {
    // "Unable to parse range": la hoja no existe todavía (p. ej. en el original, que es solo lectura).
    if ((e as { code?: number }).code !== 400) throw e;
  }
  return filas.filter((f) => f.some((c) => texto(c).trim() !== ""));
}

/**
 * Todo el log en el orden de la planilla (más viejo primero). [] si la hoja no existe todavía.
 * `alDia`: directo de la API, sin cachés (Deshacer busca una operación que puede ser de hace un segundo).
 */
export async function leerLog(opciones: { alDia?: boolean } = {}): Promise<EntradaLog[]> {
  if (!opciones.alDia && cacheLog && cacheLog.hasta > Date.now()) return cacheLog.entradas;
  const generacionInicial = generacion;
  const filas = opciones.alDia
    ? await leerFilasLog()
    : (await conCache(claveDePlanilla("crm-ventas-log-v1", spreadsheetId()), CACHE_COMPARTIDA_SEG, leerFilasLog, { etiquetas: [ETIQUETA_CRM_VENTAS, ETIQUETA_LOG] })).data;
  const entradas = (Array.isArray(filas) ? filas : []).map(entradaDesdeFila);
  if (generacion === generacionInicial) cacheLog = { hasta: Date.now() + TTL_MS, entradas };
  else if (!opciones.alDia) invalidarEtiqueta(ETIQUETA_LOG); // pudo traer el log de antes del último agregado
  return entradas;
}

/**
 * Historial de un lead: filas del log de esa hoja + fila **y con ese nombre**, más nuevo primero.
 * El log guarda el número de fila del momento en que se escribió: si después alguien insertó u
 * ordenó filas (BRIEF.md §6), en esa fila hay otro lead y su historial no es el de este.
 */
export async function historialDeFila(hoja: string, numeroFila: number, nombre: string): Promise<EntradaLog[]> {
  const todo = await leerLog();
  const lead = normalizarTexto(nombre);
  return todo.filter((e) => e.hoja === hoja && e.fila === numeroFila && normalizarTexto(e.lead) === lead).reverse();
}
