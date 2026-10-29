"use server";

// Server actions (docs/arquitectura.md §Server actions). Cada una verifica la sesión y la hoja,
// y devuelve objetos planos: nunca lanza al cliente (salvo redirect, que es control de flujo).

import { revalidatePath } from "next/cache";
import { secretoOperaciones } from "@/lib/crm/config";
import { firmarOperacion, puedeVerHoja, sesionActual, verificarOperacion, type Sesion } from "@/lib/crm/auth";
import type {
  CodigoError,
  EntradaAccion,
  EntradaDeshacer,
  EntradaFicha,
  Identidad,
  Operacion,
  PanelFicha,
  Resultado,
} from "@/lib/crm/contratos";
import { leerCambios, leerCambiosFicha, leerHojaYFila, leerIdentidad, leerIdOperacion, leerMotivo } from "@/lib/crm/entrada";
import { esMotivoDeshacer } from "@/lib/crm/hechas";
import { panelFicha } from "@/lib/crm/mi-dia";
import { aplicarCambios, deshacer, deshacerOperacion as deshacerOperacionDelLog, ErrorEscritura } from "@/lib/crm/sheets/escribir";
import { camposDistintos, mismaIdentidad, mismasClaves, tocaUltimoToque } from "@/lib/crm/sheets/verificacion";
import { cancelarEnCalendly, notaCancelacion } from "@/lib/crm/calendlyReagenda";
import { filaVisible } from "@/lib/crm/config/crm";
import { BOTON_CANCELAR_REUNION } from "@/lib/crm/pantalla";
import { leerFila } from "@/lib/crm/sheets/leer";
import { resolverMarcaManana } from "@/lib/crm/motor/proxima-accion";

const fallo = (codigo: CodigoError, error: string): Resultado<never> => ({ ok: false, error, codigo });

const NO_SE_PUDO_GUARDAR = "No se pudo guardar. Probá de nuevo en un rato.";
const NO_SE_PUDO_LEER = "No se pudo leer la planilla. Probá de nuevo en un rato.";

/**
 * Los errores previstos (`ErrorEscritura`) llegan con su texto; cualquier otro (la API de Google,
 * la red, una variable mal cargada) se registra entero en el servidor y al cliente le llega un
 * texto genérico, sin detalles internos.
 */
function desdeError(e: unknown, generico = NO_SE_PUDO_GUARDAR): Resultado<never> {
  if (e instanceof ErrorEscritura) return fallo(e.codigo, e.message);
  console.error("[acciones] error no previsto:", e);
  return fallo("api", generico);
}

const SIN_SESION = () => fallo("sin_sesion", "Tu sesión venció. Volvé a entrar.");

/** El motivo que va al log; el mismo texto se firma en `ejecutarAccion` y se verifica en `deshacerAccion`. */
const motivoDelLog = (x: unknown) => leerMotivo(x) || "Acción desde la app";

type Autorizacion =
  | { ok: true; sesion: Sesion; identidad: Identidad }
  | { ok: false; error: Resultado<never> };

/** Sesión válida y con permiso sobre la hoja, o el `Resultado` de error para devolver. */
async function autorizar(entrada: unknown): Promise<Autorizacion> {
  const sesion = await sesionActual();
  if (!sesion) return { ok: false, error: SIN_SESION() };
  const identidad = leerIdentidad(entrada);
  if (!identidad) return { ok: false, error: fallo("entrada_invalida", "Faltan datos del lead. Actualizá la página.") };
  if (!puedeVerHoja(sesion, identidad.hoja)) {
    return { ok: false, error: fallo("hoja_prohibida", "No podés escribir en esa hoja.") };
  }
  return { ok: true, sesion, identidad };
}

/**
 * Un botón de la tarjeta: escribe `cambios` (+ AG, salvo el Enviado del pre-call) solo si esas celdas todavía tienen `esperado`
 * (lo que había al armar la tarjeta), y devuelve `antes`/`despues` y la `firma` para Deshacer.
 * Un motivo "Deshacer: …" se rechaza: "Hechas hoy" y el admin tomarían la escritura por un Deshacer.
 */
export async function ejecutarAccion(entrada: EntradaAccion): Promise<Resultado<Operacion>> {
  try {
    const auth = await autorizar(entrada);
    if (!auth.ok) return auth.error;
    const leidos = leerCambios(entrada?.cambios);
    const esperado = leerCambios(entrada?.esperado);
    if (!leidos || !esperado) return fallo("entrada_invalida", "Los cambios no tienen el formato esperado. Actualizá la página.");
    // El Enviado de un seguimiento con fecha acordada manda "(mañana)": la fecha la pone el reloj del servidor
    const cambios = resolverMarcaManana(leidos, new Date());
    if (!mismasClaves(cambios, esperado)) {
      return fallo("entrada_invalida", "Lo esperado no corresponde a las celdas que se quieren cambiar. Actualizá la página.");
    }
    if (["Cerrado en llamada", "Cerrado en seguimiento"].includes(cambios.situacion ?? "")) {
      if (["cashDia1", "cashTratoCerrado", "valorServicio"].some((campo) => !String(cambios[campo as keyof typeof cambios] ?? "").trim())) {
        return fallo("entrada_invalida", "Completá Cash día 1, Cash trato cerrado y Valor del servicio.");
      }
    }
    const motivo = motivoDelLog(entrada.motivo);
    if (esMotivoDeshacer(motivo)) return fallo("entrada_invalida", "Para deshacer usá el botón Deshacer.");
    const secreto = secretoOperaciones();
    // El "Enviado" del pre-call no escribe AG: no frena los seguimientos de ese día (`tocaUltimoToque`).
    const datos = await aplicarCambios({
      ...auth.identidad,
      closer: auth.sesion.nombre,
      cambios,
      esperado,
      motivo,
      modo: "accion",
      tocar: tocaUltimoToque(cambios),
    });
    const { hoja, numeroFila } = auth.identidad;
    const firma = await firmarOperacion({ hoja, numeroFila, antes: datos.antes, despues: datos.despues, motivo }, secreto);
    return { ok: true, datos: { ...datos, firma } };
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * "Cancelar reunión" (Pre-call, pedido de Tomás del 19/10/2026): cancela el evento en Calendly y después escribe los cambios
 * del botón (R = No, Pre-call = Olvidar, Fups no-show = No hacer) más una nota en AB. Antes de cancelar verifica que la fila
 * sea el mismo lead y que nadie haya cambiado esas celdas (lo de Calendly no se deshace, así que no se cancela a ciegas).
 * Sin firma ni Deshacer: volver la fila atrás no devuelve la reunión.
 */
export async function cancelarReunion(entrada: EntradaAccion): Promise<Resultado<Operacion>> {
  try {
    const auth = await autorizar(entrada);
    if (!auth.ok) return auth.error;
    const { identidad, sesion } = auth;
    const cambios = leerCambios(entrada?.cambios);
    const esperado = leerCambios(entrada?.esperado);
    const propios = BOTON_CANCELAR_REUNION.cambios as Record<string, string>;
    if (
      !cambios ||
      !esperado ||
      !mismasClaves(cambios, esperado) ||
      !mismasClaves(cambios, propios) ||
      Object.entries(propios).some(([c, v]) => (cambios as Record<string, string>)[c] !== v)
    ) {
      return fallo("entrada_invalida", "Los cambios no tienen el formato esperado. Actualizá la página.");
    }
    if (!filaVisible(identidad.hoja, identidad.numeroFila)) return fallo("hoja_prohibida", "No podés escribir en esa fila.");
    const fila = await leerFila(identidad.hoja, identidad.numeroFila);
    if (!fila || !mismaIdentidad(fila, identidad)) return fallo("fila_cambiada", "En esa fila ahora hay otro lead. Actualizá la página.");
    if (camposDistintos(fila, esperado).length > 0) return fallo("fila_cambiada", "Alguien cambió esta fila; actualizá la página antes de cancelar.");

    const cancelada = await cancelarEnCalendly(fila);
    if ("error" in cancelada) return fallo("api", `No se canceló: ${cancelada.error}`);

    const motivo = motivoDelLog(entrada.motivo);
    const datosReagenda = notaCancelacion(cancelada.cuando, sesion.nombre, fila.valores.datosReagenda, new Date());
    try {
      const datos = await aplicarCambios({
        ...identidad,
        closer: sesion.nombre,
        cambios: { ...cambios, datosReagenda },
        esperado: { ...esperado, datosReagenda: fila.valores.datosReagenda },
        motivo,
        modo: "accion",
        tocar: true,
      });
      return { ok: true, datos };
    } catch (e) {
      console.error("[acciones] reunión cancelada en Calendly pero sin guardar en el CRM:", identidad.hoja, identidad.numeroFila, e);
      return fallo(
        "api",
        "La reunión se canceló en Calendly, pero no se pudo guardar en el CRM. Cargalo a mano: Se presentó = No, Pre-call = Olvidar, Fups no-show = No hacer.",
      );
    }
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * El toast "Deshacer": restaura `restaurar` solo si es el `antes` de una escritura que hizo la app
 * (la `firma` que devolvió `ejecutarAccion`, con la misma hoja, fila, `despues` y motivo) y la fila
 * todavía tiene `esperado` (mismas columnas, no vacío). Sin la firma, un POST armado a mano podría
 * escribir cualquier texto con la validación suelta del modo "restaurar".
 */
export async function deshacerAccion(entrada: EntradaDeshacer): Promise<Resultado<Operacion>> {
  try {
    const auth = await autorizar(entrada);
    if (!auth.ok) return auth.error;
    const restaurar = leerCambios(entrada?.restaurar);
    const esperado = leerCambios(entrada?.esperado);
    if (!restaurar || !esperado) return fallo("entrada_invalida", "Los cambios no tienen el formato esperado.");
    const motivo = motivoDelLog(entrada.motivo);
    const { hoja, numeroFila } = auth.identidad;
    const valida = await verificarOperacion({ hoja, numeroFila, antes: restaurar, despues: esperado, motivo }, entrada?.firma, secretoOperaciones());
    if (!valida) return fallo("entrada_invalida", "No reconozco esa acción. Deshacela desde \"Hechas hoy\".");
    const datos = await deshacer({ ...auth.identidad, closer: auth.sesion.nombre, restaurar, esperado, motivo });
    return { ok: true, datos };
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * "Hechas hoy" → Deshacer: deshace una operación del log por su id (la busca en "Log App", relee
 * la fila y verifica el lead). Un closer solo puede deshacer operaciones de su hoja.
 */
export async function deshacerOperacion(idOperacion: string): Promise<Resultado<Operacion>> {
  try {
    const sesion = await sesionActual();
    if (!sesion) return SIN_SESION();
    const id = leerIdOperacion(idOperacion);
    if (!id) return fallo("entrada_invalida", "No reconozco esa acción.");
    const datos = await deshacerOperacionDelLog({
      idOperacion: id,
      closer: sesion.nombre,
      puedeVerHoja: (hoja) => puedeVerHoja(sesion, hoja),
    });
    return { ok: true, datos };
  } catch (e) {
    return desdeError(e);
  }
}

/** Formulario de cierre de la ficha: Y, Z, AA, AD, AE, AF. No toca AG (no es un toque de seguimiento). */
export async function guardarFicha(entrada: EntradaFicha): Promise<Resultado<Operacion>> {
  try {
    const auth = await autorizar(entrada);
    if (!auth.ok) return auth.error;
    const cambios = leerCambiosFicha(entrada?.cambios);
    if (!cambios) return fallo("entrada_invalida", "La ficha solo puede cambiar cash, valor, grabaciones y notas de reagenda.");
    const esperado = entrada?.esperado === undefined ? undefined : leerCambiosFicha(entrada.esperado);
    if (esperado === null || (esperado && !mismasClaves(cambios, esperado))) {
      return fallo("entrada_invalida", "Lo esperado no corresponde a los campos que se quieren cambiar. Actualizá la página.");
    }
    const datos = await aplicarCambios({
      ...auth.identidad,
      closer: auth.sesion.nombre,
      cambios,
      esperado,
      motivo: Object.keys(cambios).every((c) => c === "datosReagenda") ? "FICHA · notas de reagenda" : "FICHA · datos de cierre",
      modo: "accion",
      tocar: false,
    });
    revalidatePath("/ventas/lead/[hoja]/[fila]", "page");
    return { ok: true, datos };
  } catch (e) {
    return desdeError(e);
  }
}

/** La ficha de un lead para abrirla como panel lateral: lo mismo que usa /lead/[hoja]/[fila]. */
export async function obtenerFicha(hoja: string, fila: number): Promise<Resultado<PanelFicha>> {
  try {
    const sesion = await sesionActual();
    if (!sesion) return SIN_SESION();
    const pedido = leerHojaYFila(hoja, fila);
    if (!pedido) return fallo("entrada_invalida", "Faltan datos del lead.");
    if (!puedeVerHoja(sesion, pedido.hoja)) return fallo("hoja_prohibida", "No podés ver esa hoja.");
    const datos = await panelFicha(pedido.hoja, pedido.numeroFila);
    if (!datos) return fallo("fila_cambiada", "Ese lead ya no está en esa fila. Refrescá la lista.");
    return { ok: true, datos };
  } catch (e) {
    return desdeError(e, NO_SE_PUDO_LEER);
  }
}
