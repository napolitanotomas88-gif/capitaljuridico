import { escrituraPermitida, hojasClosers, spreadsheetId } from "@/lib/crm/config";
import type { Cambios, CodigoError, Identidad, Operacion } from "@/lib/crm/contratos";
import { agruparOperaciones } from "@/lib/crm/hechas";
import { sheets } from "./cliente";
import { COLUMNAS, ENCABEZADOS_ESPERADOS, rango, etiquetaCampo, type Campo } from "./columnas";
import { actualizarFilaEnCache, invalidarCache, leerFila } from "./leer";
import { agregarAlLog, invalidarCacheLog, leerLog } from "./log";
import {
  armarRangos,
  camposDistintos,
  camposProhibidos,
  conUltimoToque,
  diferencias,
  filasLog,
  mismaIdentidad,
  mismasClaves,
  normalizarTexto,
  validarCambios,
  type ModoEscritura,
} from "./verificacion";

// Escritura segura en el Sheet (docs/arquitectura.md §Escritura segura). Toda escritura de la
// app pasa por acá: bloqueo del original, lista blanca, relectura de la fila, lo esperado,
// batchUpdate USER_ENTERED, log y caché (se actualiza con lo escrito en vez de tirarla).

export class ErrorEscritura extends Error {
  constructor(
    public readonly codigo: CodigoError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorEscritura";
  }
}

export type EntradaEscritura = Identidad & {
  /** Nombre de quien escribe (va al log). */
  closer: string;
  cambios: Cambios;
  motivo: string;
  /**
   * Lo que cada celda tiene que tener hoy para poder escribir (mismas claves que `cambios`).
   * Las acciones mandan lo que había al armar la tarjeta; Deshacer, el `despues` de la operación.
   */
  esperado?: Cambios;
  /** "restaurar" relaja la validación de valores (Deshacer devuelve lo que ya estaba). */
  modo?: ModoEscritura;
  /** false = no escribir AG (el formulario de la ficha no es un toque de seguimiento). Por defecto true. */
  tocar?: boolean;
  /** Para tests y scripts. */
  ahora?: Date;
};

function idOperacion(): string {
  return crypto.randomUUID().split("-")[0];
}

const lista = (campos: string[]) => campos.map(etiquetaCampo).join(", ");

export async function aplicarCambios(entrada: EntradaEscritura): Promise<Operacion> {
  const { hoja, numeroFila, cambios, esperado, modo = "accion", tocar = true } = entrada;

  // 1. Bloqueo del original: antes de cualquier llamada a la API.
  if (!escrituraPermitida()) {
    throw new ErrorEscritura(
      "escritura_bloqueada",
      "La app está apuntando a la planilla original y la escritura ahí está bloqueada (PERMITIR_ESCRITURA_ORIGINAL).",
    );
  }
  // 2. Lista blanca de columnas y de hojas, y los valores.
  if (!hojasClosers().includes(hoja)) {
    throw new ErrorEscritura("columna_prohibida", `"${hoja}" no es una hoja de closer.`);
  }
  if (!Number.isInteger(numeroFila) || numeroFila < 2) {
    throw new ErrorEscritura("fila_cambiada", `Número de fila inválido: ${numeroFila}.`);
  }
  const prohibidos = camposProhibidos(cambios);
  if (prohibidos.length > 0) {
    throw new ErrorEscritura("columna_prohibida", `No se puede escribir en: ${lista(prohibidos)}.`);
  }
  const problema = validarCambios(cambios, modo);
  if (problema) throw new ErrorEscritura("valor_invalido", problema);
  if (esperado && !mismasClaves(cambios, esperado)) {
    throw new ErrorEscritura("entrada_invalida", "Lo esperado no corresponde a las celdas que se quieren cambiar.");
  }

  // 3. Releer la fila y verificar que sigue siendo el mismo lead.
  const fila = await leerFila(hoja, numeroFila);
  if (!fila || !mismaIdentidad(fila, entrada)) {
    invalidarCache(hoja);
    throw new ErrorEscritura(
      "fila_cambiada",
      "La fila ya no corresponde a este lead (alguien movió u ordenó la planilla). Refrescá la lista.",
    );
  }
  // 4. Lo que había cuando se armó la tarjeta (o lo que dejó la acción, para Deshacer).
  if (esperado) {
    const distintos = camposDistintos(fila, esperado);
    if (distintos.length > 0) {
      invalidarCache(hoja);
      throw new ErrorEscritura(
        "fila_cambiada",
        modo === "restaurar"
          ? `El lead cambió después de la acción (${lista(distintos)}). No se deshizo nada.`
          : `Alguien cambió este lead en la planilla (${lista(distintos)}). No se guardó nada: revisalo en la lista actualizada.`,
      );
    }
  }

  // La nueva columna se prepara antes del despliegue: nunca escribir sobre una AK ajena.
  if ("recordatorioPrecall" in cambios) {
    const encabezado = await sheets().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: rango(hoja, `${COLUMNAS.recordatorioPrecall}1`),
    });
    if (encabezado.data.values?.[0]?.[0] !== ENCABEZADOS_ESPERADOS.recordatorioPrecall) {
      throw new ErrorEscritura("escritura_bloqueada", "Recordatorio todavía no está habilitado en esta hoja.");
    }
  }

  // 5. Escribir, una range por celda, con AG salvo `tocar: false`.
  const ahora = entrada.ahora ?? new Date();
  const finales = tocar ? conUltimoToque(cambios, ahora) : { ...cambios };
  const { antes, despues } = diferencias(fila, finales);
  await sheets().spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { valueInputOption: "USER_ENTERED", data: armarRangos(hoja, numeroFila, finales, modo) },
  });

  // 6. Log. Si falla, la escritura ya está hecha: se avisa y se devuelve ok igual.
  const id = idOperacion();
  let logFallo = false;
  try {
    await agregarAlLog(
      filasLog({
        fecha: ahora,
        operacion: id,
        closer: entrada.closer,
        hoja,
        numeroFila,
        lead: fila.valores.nombre,
        antes,
        despues,
        motivo: entrada.motivo,
      }),
    );
  } catch (e) {
    logFallo = true;
    console.error(`[escribir] la escritura ${id} quedó sin log:`, e);
  }

  // 7. La fila escrita queda en la caché con los valores nuevos (la fila se releyó en el paso 3):
  // el próximo render muestra la acción siguiente sin volver a leer la hoja.
  const valores = { ...fila.valores };
  for (const [campo, valor] of Object.entries(finales) as [Campo, string][]) valores[campo] = valor;
  actualizarFilaEnCache({ ...fila, valores });

  return { id, antes, despues, ...(logFallo ? { logFallo } : {}) };
}

export type EntradaDeshacerEscritura = Identidad & {
  closer: string;
  restaurar: Cambios;
  esperado: Cambios;
  motivo: string;
  ahora?: Date;
};

/**
 * Vuelve a dejar la fila como estaba: escribe `restaurar` (incluido el AG anterior) solo si hoy
 * tiene `esperado`. Las dos tienen que traer las mismas columnas y no pueden venir vacías.
 * AG se toca solo si viene en `restaurar` (deshacer un guardado de la ficha no es un toque).
 */
export function deshacer(entrada: EntradaDeshacerEscritura): Promise<Operacion> {
  const { restaurar, esperado, motivo, ...resto } = entrada;
  if (Object.keys(esperado).length === 0) {
    return Promise.reject(new ErrorEscritura("entrada_invalida", "Falta lo que se espera encontrar para poder deshacer."));
  }
  if (!mismasClaves(restaurar, esperado)) {
    return Promise.reject(new ErrorEscritura("entrada_invalida", "Lo que se restaura no coincide con lo que se espera encontrar."));
  }
  return aplicarCambios({
    ...resto,
    cambios: restaurar,
    esperado,
    motivo: `Deshacer: ${motivo}`,
    modo: "restaurar",
    tocar: false,
  });
}

export type EntradaDeshacerOperacion = {
  idOperacion: string;
  /** Quién deshace (va al log). */
  closer: string;
  /** Si quien llama puede tocar esa hoja (`puedeVerHoja` de la sesión: un closer, solo la suya). */
  puedeVerHoja: (hoja: string) => boolean;
  ahora?: Date;
};

/**
 * "Hechas hoy" → Deshacer: busca la operación en "Log App", verifica que la hoja la pueda ver
 * quien llama, relee la fila, verifica el nombre del lead y deshace con restaurar = antes y
 * esperado = despues del log. El log no guarda el teléfono: la identidad sale de la fila releída
 * (después de comprobar el nombre), y `aplicarCambios` la vuelve a verificar al escribir.
 */
export async function deshacerOperacion(entrada: EntradaDeshacerOperacion): Promise<Operacion> {
  invalidarCacheLog(); // la operación puede ser de hace un segundo, en otra instancia
  const operaciones = agruparOperaciones(await leerLog());
  // Si el id se repite (8 hex al azar), la más reciente.
  const op = [...operaciones].reverse().find((o) => o.idOperacion === entrada.idOperacion);
  if (!op) throw new ErrorEscritura("entrada_invalida", "No encontré esa acción en el registro (Log App).");
  if (!entrada.puedeVerHoja(op.hoja)) throw new ErrorEscritura("hoja_prohibida", "No podés deshacer acciones de esa hoja.");
  if (op.esDeshacer) throw new ErrorEscritura("entrada_invalida", "Esa acción ya es un Deshacer.");
  if (op.deshecha) throw new ErrorEscritura("fila_cambiada", "Esa acción ya se deshizo.");
  if (op.cambios.length === 0) throw new ErrorEscritura("entrada_invalida", "Esa acción no cambió ninguna celda.");

  const fila = await leerFila(op.hoja, op.fila);
  if (!fila || normalizarTexto(fila.valores.nombre) !== normalizarTexto(op.lead)) {
    invalidarCache(op.hoja);
    throw new ErrorEscritura(
      "fila_cambiada",
      "La fila ya no corresponde a ese lead (alguien movió u ordenó la planilla). No se deshizo nada.",
    );
  }

  const restaurar: Cambios = {};
  const esperado: Cambios = {};
  for (const c of op.cambios) {
    restaurar[c.campo as keyof Cambios] = c.antes;
    esperado[c.campo as keyof Cambios] = c.despues;
  }
  return deshacer({
    hoja: op.hoja,
    numeroFila: op.fila,
    nombre: fila.valores.nombre,
    telefono: fila.valores.telefono,
    fechaCall: fila.valores.fechaCall,
    closer: entrada.closer,
    restaurar,
    esperado,
    motivo: op.motivo,
    ahora: entrada.ahora,
  });
}
