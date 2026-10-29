import { afterEach, describe, expect, it, vi } from "vitest";
import { SITUACIONES_POR_DEFECTO } from "@/lib/crm/config/crm";
import { leerDesplegables, opcionesDeValidacion, TTL_ERROR_MS } from "@/lib/crm/sheets/desplegables";

const { api } = vi.hoisted(() => ({ api: { spreadsheets: { get: vi.fn(), values: { get: vi.fn() } } } }));
vi.mock("@/lib/crm/sheets/cliente", () => ({ sheets: () => api }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("opcionesDeValidacion", () => {
  it("lista fija", () => {
    expect(
      opcionesDeValidacion({
        condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "Fee" }, { userEnteredValue: "Broke" }, {}] },
        strict: true,
      }),
    ).toEqual({ lista: ["Fee", "Broke"] });
  });
  it("lista desde un rango", () => {
    expect(opcionesDeValidacion({ condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "=Listas!A2:A20" }] } })).toEqual({
      rangoOrigen: "Listas!A2:A20",
    });
  });
  it("sin validación o de otro tipo", () => {
    expect(opcionesDeValidacion(undefined)).toBeNull();
    expect(opcionesDeValidacion({ condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "0" }] } })).toBeNull();
    expect(opcionesDeValidacion({ condition: { type: "ONE_OF_LIST", values: [] } })).toBeNull();
  });
});

describe("leerDesplegables", () => {
  const conLista = (lista: string[]) => ({
    data: {
      sheets: [
        { data: [{ rowData: [{ values: [{ dataValidation: { condition: { type: "ONE_OF_LIST", values: lista.map((v) => ({ userEnteredValue: v })) } } }] }] }] },
      ],
    },
  });

  it("si la API falla, la lista por defecto dura poco en la caché (después vuelve a leer la de la hoja)", async () => {
    process.env.SHEET_ID_VENTAS = "copia";
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.spreadsheets.get.mockRejectedValueOnce(Object.assign(new Error("Quota exceeded"), { code: 429 }));
    api.spreadsheets.get.mockResolvedValue(conLista(["Fee", "Broke"]));

    expect((await leerDesplegables("Hoja con error")).situacion).toEqual(SITUACIONES_POR_DEFECTO.filter((s) => s !== "Follow Up"));
    expect((await leerDesplegables("Hoja con error")).situacion).toEqual(SITUACIONES_POR_DEFECTO.filter((s) => s !== "Follow Up")); // caché corta
    expect(api.spreadsheets.get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TTL_ERROR_MS + 1);
    expect((await leerDesplegables("Hoja con error")).situacion).toEqual(["Fee", "Broke"]);
    // Lo que se leyó bien sí queda (10 minutos).
    vi.advanceTimersByTime(TTL_ERROR_MS + 1);
    expect((await leerDesplegables("Hoja con error")).situacion).toEqual(["Fee", "Broke"]);
    expect(api.spreadsheets.get).toHaveBeenCalledTimes(2);
  });
});
