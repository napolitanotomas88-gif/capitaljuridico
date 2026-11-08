import { describe, expect, it } from "vitest";
import { leadsIniciales, HORA } from "@/lib/crm/demoPrecaller";
import { accionesDeFila } from "@/lib/crm/motor/proxima-accion";
import { parsearFechaSheet } from "@/lib/crm/fechas";

describe("práctica del pre-caller", () => {
  it("dos leads de mentira por columna, todos con tarjeta del pre-caller", () => {
    const ahora = parsearFechaSheet("07/11/2026 21:00")!;
    const dia = { precallV2: true, precallV2Desde: new Date(ahora.getTime() - 7 * 24 * HORA) };
    const etapas = leadsIniciales(ahora).map((f) => {
      const [a] = accionesDeFila(f, ahora, dia).filter((x) => x.tipo === "PRE_CALLER");
      return a?.etapaPrecaller;
    });
    expect(etapas).toEqual(["llamar", "llamar", "chat", "chat", "pasar", "pasar", "vencida", "vencida"]);
  });
});
