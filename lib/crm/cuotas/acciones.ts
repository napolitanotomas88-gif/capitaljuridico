"use server";
// Server actions de Cuotas (CRM original, ZIP del 8/10/2026). La sesión es la del dashboard (lib/crm/auth: socio = admin,
// closer = sus planes). Cada acción vuelve a verificar sesión y responsable.
import { revalidatePath } from "next/cache";
import { sesionActual } from "@/lib/crm/auth";
import { closers } from "@/lib/crm/config";
import { crearPlan, guardarPlan, obtenerPlan } from "@/lib/crm/cuotas/db";
import {
  leerPlan,
  modificarPlan,
  puedeAcceder,
  uuidValido,
  type Cambio,
  type EntradaPlan,
  type RegistroPlan,
} from "@/lib/crm/cuotas/modelo";
type Resultado =
  | { ok: true; registro: RegistroPlan }
  | { ok: false; error: string };
class ErrorEntrada extends Error {}
function responsableValido(id: string) {
  return id === "admin" || closers().some((c) => c.id === id);
}
export async function nuevoPlan(datos: EntradaPlan): Promise<Resultado> {
  try {
    const sesion = await sesionActual("cuotas");
    if (!sesion)
      return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
    let plan;
    try { plan = leerPlan(datos, undefined, sesion.nombre); } catch(e) { throw new ErrorEntrada(e instanceof Error ? e.message : "Revisá los datos."); }
    if (
      !responsableValido(plan.responsable) ||
      !puedeAcceder(sesion.rol, sesion.closerId, plan.responsable)
    )
      return {
        ok: false,
        error: "No podés crear un plan para ese responsable.",
      };
    plan.eventos.push({
      id: plan.id,
      fecha: new Date().toISOString(),
      actor: sesion.nombre,
      texto: "Plan creado",
    });
    if (!(await crearPlan(plan))) {
      const existente = await obtenerPlan(
        plan.id,
        sesion.rol === "admin" ? undefined : sesion.closerId,
      );
      if (!existente)
        return {
          ok: false,
          error: "No se pudo guardar el plan. Actualizá y reintentá.",
        };
      return { ok: true, registro: existente };
    }
    revalidatePath("/cuotas");
    return { ok: true, registro: { plan, version: 1 } };
  } catch (e) {
    console.error("[cuotas] alta", e);
    return {
      ok: false,
      error:
        e instanceof ErrorEntrada
          ? e.message
          : "No se pudo crear el plan. Probá nuevamente.",
    };
  }
}
export async function actualizarPlan(
  id: string,
  version: number,
  operacion: string,
  cambio: Cambio,
): Promise<Resultado> {
  try {
    const sesion = await sesionActual("cuotas");
    if (!sesion)
      return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
    if (
      !uuidValido(id) ||
      !uuidValido(operacion) ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      return { ok: false, error: "Solicitud inválida. Actualizá la pantalla." };
    const actual = await obtenerPlan(
      id,
      sesion.rol === "admin" ? undefined : sesion.closerId,
    );
    if (!actual)
      return { ok: false, error: "El plan no existe o no tenés acceso." };
    if (actual.plan.eventos.some((e) => e.id === operacion))
      return { ok: true, registro: actual };
    if (actual.version !== version)
      return {
        ok: false,
        error:
          "Este plan cambió en otra pantalla. Actualizá antes de continuar.",
      };
    let plan;
    try {
      plan = modificarPlan(actual.plan, cambio, operacion, sesion.nombre);
    } catch (e) {
      throw new ErrorEntrada(
        e instanceof Error ? e.message : "Datos inválidos.",
      );
    }
    if (
      !responsableValido(plan.responsable) ||
      !puedeAcceder(sesion.rol, sesion.closerId, plan.responsable)
    )
      return { ok: false, error: "No podés asignar ese responsable." };
    if (!(await guardarPlan(plan, version, actual.plan.responsable)))
      return {
        ok: false,
        error: "Alguien acaba de actualizar el plan. Actualizá la pantalla.",
      };
    revalidatePath("/cuotas");
    return { ok: true, registro: { plan, version: version + 1 } };
  } catch (e) {
    console.error("[cuotas] cambio", e);
    return {
      ok: false,
      error:
        e instanceof ErrorEntrada
          ? e.message
          : "No se pudo guardar. Probá nuevamente.",
    };
  }
}
