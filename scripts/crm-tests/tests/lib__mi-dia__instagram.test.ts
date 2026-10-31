import { beforeEach, describe, expect, it, vi } from "vitest";
import { filaDesdeValores } from "@/lib/crm/sheets/columnas";
const mocks = vi.hoisted(() => ({ hojas: vi.fn(), instagram: vi.fn(), historial: vi.fn() }));
vi.mock("@/lib/crm/auth", () => ({ NOMBRE_ADMIN: "Prueba" }));
vi.mock("@/lib/crm/config", () => ({ closers: () => [], nombreCloserDeHoja: () => "Prueba" }));
vi.mock("@/lib/crm/sheets/leer", () => ({ leerHojas: mocks.hojas }));
vi.mock("@/lib/crm/sheets/log", () => ({ leerLog: async () => [], historialDeFila: mocks.historial }));
vi.mock("@/lib/crm/sheets/desplegables", () => ({ leerDesplegables: async () => ({ situacion: [] }) }));
vi.mock("@/lib/crm/instagramCalendly", () => ({ instagramDeAgenda: mocks.instagram }));
import { datosDelLead, panelFicha } from "@/lib/crm/mi-dia";

beforeEach(() => { vi.clearAllMocks(); mocks.historial.mockResolvedValue([]); });
describe("Sheets → datosDelLead/panel lateral → Instagram opcional", () => {
  it.each([{ estado: "sin_dato" }, { estado: "no_disponible" }, { estado: "disponible", texto: "@estudio.ejemplo" }])("enriquece sin desplazar columnas ni modificar la fila: %j", async dato => {
    const fila = filaDesdeValores("Closer 4", 2, ["Lead ficticio", "+5491100000000", "lead@example.test", "01/11/2026 12:00:00", "https://meet.test/a", "VIDEOS CONF"]);
    const copia = JSON.stringify(fila);
    mocks.hojas.mockResolvedValue(new Map([["Closer 4", [fila]]])); mocks.instagram.mockResolvedValue(dato);
    const f = await datosDelLead("Closer 4", 2, new Date("2026-10-31T12:00:00-03:00"));
    expect(f?.instagram).toEqual(dato); expect(f?.valores.email).toBe("lead@example.test");
    expect(f?.valores.precall).toBe("VIDEOS CONF"); expect(f?.valores.recordatorioPrecall).toBe("");
    expect(mocks.instagram).toHaveBeenCalledWith(fila.valores); expect(JSON.stringify(fila)).toBe(copia);
    expect((await panelFicha("Closer 4", 2))?.ficha.instagram).toEqual(dato);
  });
  it("fila inexistente conserva null y no consulta Calendly", async () => {
    mocks.hojas.mockResolvedValue(new Map([["Closer 4", []]]));
    expect(await datosDelLead("Closer 4", 2)).toBeNull(); expect(mocks.instagram).not.toHaveBeenCalled();
  });
});
