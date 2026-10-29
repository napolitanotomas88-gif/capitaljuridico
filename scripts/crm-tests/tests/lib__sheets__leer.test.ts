import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: { spreadsheets: { values: { batchGet: vi.fn(), get: vi.fn() } } },
}));
vi.mock("@/lib/crm/sheets/cliente", () => ({ sheets: () => api }));

import { actualizarFilaEnCache, invalidarCache, leerHojas } from "@/lib/crm/sheets/leer";

const respuesta = (nombre: string) => ({ data: { valueRanges: [{ values: [[nombre, "+54 9 11 5555-1234", "", "24/09/2026 10:00:00"]] }] } });

beforeEach(() => {
  vi.clearAllMocks();
  invalidarCache();
  process.env.SHEET_ID_VENTAS = "copia";
});

describe("leerHojas: caché", () => {
  it("la segunda lectura sale de la caché; invalidar la vacía", async () => {
    api.spreadsheets.values.batchGet.mockResolvedValue(respuesta("Ana"));
    await leerHojas(["Gero-Xavi Rejunte"]);
    await leerHojas(["Gero-Xavi Rejunte"]);
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(1);
    invalidarCache("Gero-Xavi Rejunte");
    await leerHojas(["Gero-Xavi Rejunte"]);
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(2);
  });

  it("una lectura en vuelo durante una escritura no repuebla la caché con datos viejos", async () => {
    let responder: (v: unknown) => void = () => {};
    api.spreadsheets.values.batchGet.mockImplementationOnce(() => new Promise((r) => (responder = r)));
    const enVuelo = leerHojas(["Gero-Xavi Rejunte"]);
    invalidarCache("Gero-Xavi Rejunte"); // la escritura terminó mientras la lectura viajaba
    responder(respuesta("Viejo"));
    expect((await enVuelo).get("Gero-Xavi Rejunte")?.[0].valores.nombre).toBe("Viejo");

    api.spreadsheets.values.batchGet.mockResolvedValue(respuesta("Nuevo"));
    expect((await leerHojas(["Gero-Xavi Rejunte"])).get("Gero-Xavi Rejunte")?.[0].valores.nombre).toBe("Nuevo");
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(2);
  });

  it("después de escribir, la fila nueva queda en la caché sin otra lectura (y una lectura vieja no la pisa)", async () => {
    api.spreadsheets.values.batchGet.mockResolvedValue(respuesta("Ana"));
    const [ana] = (await leerHojas(["Gero-Xavi Rejunte"])).get("Gero-Xavi Rejunte")!;

    let responder: (v: unknown) => void = () => {};
    api.spreadsheets.values.batchGet.mockImplementationOnce(() => new Promise((r) => (responder = r)));
    invalidarCache("Closer 2");
    const enVuelo = leerHojas(["Closer 2"]);
    actualizarFilaEnCache({ ...ana, valores: { ...ana.valores, fupsNoShow: "S2" } });
    responder({ data: { valueRanges: [{ values: [["Bea"]] }] } });
    await enVuelo;

    expect((await leerHojas(["Gero-Xavi Rejunte"])).get("Gero-Xavi Rejunte")?.[0].valores.fupsNoShow).toBe("S2");
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(2);
    // "Closer 2" se leyó antes de la escritura: no quedó en la caché.
    api.spreadsheets.values.batchGet.mockResolvedValue({ data: { valueRanges: [{ values: [["Bea"]] }] } });
    await leerHojas(["Closer 2"]);
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(3);
  });

  it("si la fila escrita no estaba en la caché, la hoja se vuelve a leer", async () => {
    api.spreadsheets.values.batchGet.mockResolvedValue(respuesta("Ana"));
    const [ana] = (await leerHojas(["Gero-Xavi Rejunte"])).get("Gero-Xavi Rejunte")!;
    actualizarFilaEnCache({ ...ana, numeroFila: 40 });
    await leerHojas(["Gero-Xavi Rejunte"]);
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(2);
  });
});

// Pedido de Tomás (12/10/2026): el CRM solo muestra los leads de los closers actuales (corte por fila en cada pestaña)
describe("leerHojas: corte por fila", () => {
  it("Closer 1 desde la 264, Closer 2 desde la 473, Closer 3 desde la 47 (primer lead de Yamila) y Gero-Xavi todas", async () => {
    const filas = (n: number) => Array.from({ length: n }, (_, i) => [`Lead ${i + 2}`, "+54 9 11 5555-1234", "", "24/09/2026 10:00:00"]);
    api.spreadsheets.values.batchGet.mockResolvedValue({
      data: { valueRanges: [{ values: filas(300) }, { values: filas(480) }, { values: filas(50) }, { values: filas(5) }] },
    });
    const r = await leerHojas(["Closer 1", "Closer 2", "Closer 3", "Gero-Xavi Rejunte"]);
    const numeros = (h: string) => r.get(h)!.map((f) => f.numeroFila);
    expect(numeros("Closer 1")[0]).toBe(264);
    expect(numeros("Closer 1")).toHaveLength(301 - 264 + 1);
    expect(numeros("Closer 2")[0]).toBe(473);
    expect(numeros("Closer 3")).toEqual([47, 48, 49, 50, 51]);
    expect(numeros("Gero-Xavi Rejunte")).toEqual([2, 3, 4, 5, 6]);
    // El número de fila sigue siendo el real de la planilla (para escribir y para la ficha)
    expect(r.get("Closer 1")![0].valores.nombre).toBe("Lead 264");
  });
});
