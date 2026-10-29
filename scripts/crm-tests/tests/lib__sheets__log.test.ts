import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: {
    spreadsheets: {
      get: vi.fn(),
      batchUpdate: vi.fn(),
      values: { get: vi.fn(), update: vi.fn(), append: vi.fn() },
    },
  },
}));
vi.mock("@/lib/crm/sheets/cliente", () => ({ sheets: () => api }));

beforeEach(() => {
  vi.resetModules(); // el módulo recuerda si la hoja ya existe
  vi.clearAllMocks();
  process.env.SHEET_ID_VENTAS = "copia";
  api.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
  api.spreadsheets.values.update.mockResolvedValue({ data: {} });
  api.spreadsheets.values.append.mockResolvedValue({ data: {} });
});

const ENCABEZADOS = ["Fecha", "Operación", "Closer", "Hoja", "Fila", "Lead", "Columna", "Campo", "Antes", "Después", "Motivo"];
const FILA = ["f", "op", "c", "h", 2, "l", "S", "fupsNoShow", "", "S1", "m"];

describe("agregarAlLog", () => {
  it("crea 'Log App' con los encabezados en el mismo pedido si no existe, una sola vez", async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { title: "Closer 1" } }] } });
    const { agregarAlLog } = await import("@/lib/crm/sheets/log");
    await agregarAlLog([FILA]);
    await agregarAlLog([FILA]);

    expect(api.spreadsheets.get).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    const [addSheet, updateCells] = api.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(addSheet.addSheet.properties.title).toBe("Log App");
    const sheetId = addSheet.addSheet.properties.sheetId;
    expect(Number.isInteger(sheetId) && sheetId > 0).toBe(true);
    expect(updateCells.updateCells).toEqual({
      start: { sheetId, rowIndex: 0, columnIndex: 0 },
      rows: [{ values: ENCABEZADOS.map((t) => ({ userEnteredValue: { stringValue: t } })) }],
      fields: "userEnteredValue",
    });
    expect(api.spreadsheets.values.update).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(2);
    expect(api.spreadsheets.values.append.mock.calls[0][0]).toMatchObject({ range: "'Log App'!A:K", valueInputOption: "RAW" });
  });

  it("dos escrituras a la vez en la misma instancia crean la hoja una sola vez", async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [] } });
    const { agregarAlLog } = await import("@/lib/crm/sheets/log");
    await Promise.all([agregarAlLog([FILA]), agregarAlLog([FILA])]);
    expect(api.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(2);
  });

  it("si otra instancia la creó al mismo tiempo (\"already exists\"), sigue y agrega la fila", async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [] } });
    api.spreadsheets.batchUpdate.mockRejectedValue(
      Object.assign(new Error('Invalid requests[0].addSheet: A sheet with the name "Log App" already exists.'), { code: 400 }),
    );
    const { agregarAlLog } = await import("@/lib/crm/sheets/log");
    await agregarAlLog([FILA]);
    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(1);
  });

  it("si el append falla porque la hoja ya no existe, la vuelve a crear y reintenta", async () => {
    api.spreadsheets.get.mockResolvedValueOnce({ data: { sheets: [{ properties: { title: "Log App" } }] } });
    api.spreadsheets.get.mockResolvedValueOnce({ data: { sheets: [] } });
    api.spreadsheets.values.append.mockRejectedValueOnce(
      Object.assign(new Error("Unable to parse range: 'Log App'!A:K"), { code: 400 }),
    );
    const { agregarAlLog } = await import("@/lib/crm/sheets/log");
    await agregarAlLog([FILA]);
    expect(api.spreadsheets.get).toHaveBeenCalledTimes(2);
    expect(api.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(2);
  });

  it("otros errores del append se propagan", async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { title: "Log App" } }] } });
    api.spreadsheets.values.append.mockRejectedValue(Object.assign(new Error("cuota"), { code: 429 }));
    const { agregarAlLog } = await import("@/lib/crm/sheets/log");
    await expect(agregarAlLog([FILA])).rejects.toThrow("cuota");
    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(1);
  });

  it("si ya existe, solo agrega", async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { title: "Log App" } }] } });
    const { agregarAlLog } = await import("@/lib/crm/sheets/log");
    await agregarAlLog([["x"]]);
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(1);
  });
});

describe("leerLog / historialDeFila", () => {
  it("devuelve [] si la hoja no existe (error 400) y filtra por hoja + fila + lead, más nuevo primero", async () => {
    const { historialDeFila, leerLog } = await import("@/lib/crm/sheets/log");
    api.spreadsheets.values.get.mockRejectedValueOnce(Object.assign(new Error("Unable to parse range"), { code: 400 }));
    expect(await leerLog()).toEqual([]);

    const { invalidarCacheLog } = await import("@/lib/crm/sheets/log");
    invalidarCacheLog();
    api.spreadsheets.values.get.mockResolvedValue({
      data: {
        values: [
          ["24/09/2026 10:00:00", "op1", "Closer 3", "Closer 3", 12, "Ana", "S", "fupsNoShow", "", "S1", "m1"],
          ["24/09/2026 11:00:00", "op2", "Closer 3", "Closer 3", 13, "Bea", "S", "fupsNoShow", "", "S1", "m2"],
          ["24/09/2026 12:00:00", "op3", "Closer 3", "Closer 3", 12, "Ana", "S", "fupsNoShow", "S1", "S2", "m3"],
          // Alguien insertó una fila arriba: la 12 ahora es de otro lead.
          ["25/09/2026 09:00:00", "op4", "Closer 3", "Closer 3", 12, "Carla", "R", "presentoAgenda1", "", "No", "m4"],
          [],
        ],
      },
    });
    const historial = await historialDeFila("Closer 3", 12, " ANA ");
    expect(historial.map((e) => e.operacion)).toEqual(["op3", "op1"]);
    expect((await historialDeFila("Closer 3", 12, "Carla")).map((e) => e.operacion)).toEqual(["op4"]);
    expect(historial[0]).toEqual({
      fecha: "24/09/2026 12:00:00",
      operacion: "op3",
      closer: "Closer 3",
      hoja: "Closer 3",
      fila: 12,
      lead: "Ana",
      columna: "S",
      campo: "fupsNoShow",
      antes: "S1",
      despues: "S2",
      motivo: "m3",
    });
    // Caché: la segunda lectura no vuelve a la API.
    await historialDeFila("Closer 3", 13, "Bea");
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(2);
  });

  it("una lectura que salió antes de una escritura no vuelve a llenar la caché", async () => {
    const { invalidarCacheLog, leerLog } = await import("@/lib/crm/sheets/log");
    let responder: (v: unknown) => void = () => {};
    api.spreadsheets.values.get.mockImplementationOnce(() => new Promise((r) => (responder = r)));
    const enVuelo = leerLog();
    invalidarCacheLog(); // se escribió mientras tanto
    responder({ data: { values: [["24/09/2026 10:00:00", "viejo", "c", "h", 2, "l", "S", "fupsNoShow", "", "S1", "m"]] } });
    expect((await enVuelo).map((e) => e.operacion)).toEqual(["viejo"]);

    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [] } });
    expect(await leerLog()).toEqual([]);
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(2);
  });

  it("agregar al log suma las filas a la caché sin volver a leer (y una lectura en vuelo no la pisa)", async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { title: "Log App" } }] } });
    const { agregarAlLog, leerLog } = await import("@/lib/crm/sheets/log");
    api.spreadsheets.values.get.mockResolvedValue({
      data: { values: [["24/09/2026 10:00:00", "op1", "Closer 3", "Closer 3", 12, "Ana", "S", "fupsNoShow", "", "S1", "m1"]] },
    });
    expect((await leerLog()).map((e) => e.operacion)).toEqual(["op1"]);

    await agregarAlLog([["24/09/2026 10:05:00", "op2", "Closer 3", "Closer 3", 12, "Ana", "S", "fupsNoShow", "S1", "S2", "m2"]]);
    const log = await leerLog();
    expect(log.map((e) => e.operacion)).toEqual(["op1", "op2"]);
    expect(log[1]).toMatchObject({ fila: 12, antes: "S1", despues: "S2", motivo: "m2" });
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(1);
  });

  it("otros errores de la API sí se propagan", async () => {
    const { leerLog } = await import("@/lib/crm/sheets/log");
    api.spreadsheets.values.get.mockRejectedValue(Object.assign(new Error("sin permiso"), { code: 403 }));
    await expect(leerLog()).rejects.toThrow("sin permiso");
  });
});
