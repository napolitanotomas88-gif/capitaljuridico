import { beforeEach, describe, expect, it, vi } from "vitest";
import { ID_ORIGINAL } from "@/lib/crm/config";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { COLUMNAS, indiceColumna, type Campo } from "@/lib/crm/sheets/columnas";

// Cliente de Google Sheets simulado: ninguna prueba toca la red.
const { api } = vi.hoisted(() => ({
  api: {
    spreadsheets: {
      get: vi.fn(),
      batchUpdate: vi.fn(),
      values: { get: vi.fn(), batchGet: vi.fn(), batchUpdate: vi.fn(), update: vi.fn(), append: vi.fn() },
    },
  },
}));
vi.mock("@/lib/crm/sheets/cliente", () => ({ sheets: () => api }));

import { aplicarCambios, deshacer, deshacerOperacion, ErrorEscritura } from "@/lib/crm/sheets/escribir";
import { invalidarCacheLog } from "@/lib/crm/sheets/log";

const COPIA = "id-de-la-copia-de-prueba";
const AHORA = parsearFechaSheet("24/09/2026 15:04:05")!;

/** Fila cruda como la devuelve la API (A..AG), con seriales donde corresponda. */
function celdas(valores: Partial<Record<Campo, string | number>>): unknown[] {
  const fila: unknown[] = Array(indiceColumna(COLUMNAS.ultimoToque) + 1).fill("");
  fila[indiceColumna(COLUMNAS.nombre)] = "Ana Pérez";
  fila[indiceColumna(COLUMNAS.telefono)] = "+54 9 11 5555-1234";
  fila[indiceColumna(COLUMNAS.fechaCall)] = "20/09/2026 10:00:00";
  for (const [campo, valor] of Object.entries(valores)) fila[indiceColumna(COLUMNAS[campo as Campo])] = valor;
  return fila;
}

const identidad = {
  hoja: "Closer 3",
  numeroFila: 12,
  nombre: "ana perez",
  telefono: "5491155551234",
  fechaCall: "20/09/2026 10:00:00",
  closer: "Closer 3",
};

function apiNoLlamada() {
  expect(api.spreadsheets.values.get).not.toHaveBeenCalled();
  expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  expect(api.spreadsheets.values.append).not.toHaveBeenCalled();
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorEscritura> {
  try {
    await promesa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorEscritura);
    return e as ErrorEscritura;
  }
  throw new Error("no lanzó");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHEET_ID_VENTAS = COPIA;
  delete process.env.PERMITIR_ESCRITURA_ORIGINAL;
  delete process.env.CLOSERS_JSON;
  api.spreadsheets.values.get.mockResolvedValue({ data: { values: [celdas({ fupsNoShow: "S1", ultimoToque: "" })] } });
  api.spreadsheets.values.batchUpdate.mockResolvedValue({ data: {} });
  api.spreadsheets.values.append.mockResolvedValue({ data: {} });
  // "Log App" ya existe: no hace falta crearla.
  api.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { title: "Log App" } }] } });
});

describe("bloqueos antes de tocar la API", () => {
  it("con el SHEET_ID_VENTAS original falla con escritura_bloqueada", async () => {
    process.env.SHEET_ID_VENTAS = ID_ORIGINAL;
    const e = await errorDe(aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("escritura_bloqueada");
    apiNoLlamada();
  });

  it("con PERMITIR_ESCRITURA_ORIGINAL=si pasa el bloqueo", async () => {
    process.env.SHEET_ID_VENTAS = ID_ORIGINAL;
    process.env.PERMITIR_ESCRITURA_ORIGINAL = "si";
    await aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, motivo: "x", ahora: AHORA });
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
  });

  it("columna fuera de la lista blanca", async () => {
    const e = await errorDe(aplicarCambios({ ...identidad, cambios: { nombre: "otro" } as never, motivo: "x" }));
    expect(e.codigo).toBe("columna_prohibida");
    expect(e.message).toBe("No se puede escribir en: Nombre.");
    apiNoLlamada();
  });

  it("U y X (columnas ocultas que la app no usa) están fuera de la lista blanca", async () => {
    for (const cambios of [{ presentoCall2: "Si" }, { seguimientoPost2: "Hacer" }, { presentoCall2: "", situacion: "Reagendó" }]) {
      const e = await errorDe(aplicarCambios({ ...identidad, cambios, motivo: "x" }));
      expect(e.codigo).toBe("columna_prohibida");
      expect(e.message).toMatch(/^No se puede escribir en: (¿Se presentó a la call 2\?|Seguimientos post-call 2)\.$/);
    }
    // Tampoco al deshacer (una operación vieja que las tocó no se puede restaurar).
    const e = await errorDe(deshacer({ ...identidad, restaurar: { seguimientoPost2: "S1" }, esperado: { seguimientoPost2: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("columna_prohibida");
    apiNoLlamada();
  });

  it("hoja que no es de un closer", async () => {
    const e = await errorDe(aplicarCambios({ ...identidad, hoja: "Dashboard Ventas", cambios: { fupsNoShow: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("columna_prohibida");
    apiNoLlamada();
  });

  it("valor que no está en el desplegable, con el nombre legible de la columna", async () => {
    const e = await errorDe(aplicarCambios({ ...identidad, cambios: { seguimientoPost1: "s2" }, motivo: "x" }));
    expect(e.codigo).toBe("valor_invalido");
    expect(e.message).toBe('Seguimientos post-call 1: "s2" no es una opción del desplegable.');
    apiNoLlamada();
  });

  it("`esperado` con otras columnas que `cambios`", async () => {
    const e = await errorDe(
      aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, esperado: { fupsNoShow: "S1", situacion: "" }, motivo: "x" }),
    );
    expect(e.codigo).toBe("entrada_invalida");
    apiNoLlamada();
  });

  it("fila 1 (encabezados) o inválida", async () => {
    const e = await errorDe(aplicarCambios({ ...identidad, numeroFila: 1, cambios: { fupsNoShow: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("fila_cambiada");
    apiNoLlamada();
  });
});

describe("relectura de la fila", () => {
  it("si el nombre o el teléfono no coinciden, no escribe", async () => {
    const e = await errorDe(aplicarCambios({ ...identidad, telefono: "5491100000000", cambios: { fupsNoShow: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("fila_cambiada");
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.values.get.mock.calls[0][0]).toMatchObject({
      spreadsheetId: COPIA,
      range: "'Closer 3'!A12:AJ12",
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("sin teléfono en la fila, compara además la fecha de la call (D)", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [celdas({ telefono: "", fupsNoShow: "S1" })] } });
    const sinTel = { ...identidad, telefono: "" };
    const e = await errorDe(aplicarCambios({ ...sinTel, fechaCall: "21/09/2026 10:00:00", cambios: { fupsNoShow: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("fila_cambiada");
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    await aplicarCambios({ ...sinTel, cambios: { fupsNoShow: "S2" }, motivo: "x", ahora: AHORA });
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
  });

  it("si la fila está vacía, no escribe", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: {} });
    const e = await errorDe(aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, motivo: "x" }));
    expect(e.codigo).toBe("fila_cambiada");
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("tarjeta vieja: si `esperado` no coincide con lo que hay hoy, no pisa nada", async () => {
    // La tarjeta se armó con S vacío, pero en la planilla ya dice S1.
    const e = await errorDe(
      aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S1" }, esperado: { fupsNoShow: "" }, motivo: "x" }),
    );
    expect(e.codigo).toBe("fila_cambiada");
    expect(e.message).toMatch(/Seguimientos no-show/);
    expect(e.message).toMatch(/No se guardó nada/);
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("con `esperado` igual a lo que hay, escribe", async () => {
    await aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, esperado: { fupsNoShow: "S1" }, motivo: "x", ahora: AHORA });
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("escritura", () => {
  it("USER_ENTERED, una range por celda, AG = ahora, log y antes/despues", async () => {
    const op = await aplicarCambios({
      ...identidad,
      cambios: { fupsNoShow: "S2", cashDia1: "1500" },
      motivo: "NO_SHOW · Enviado S2",
      ahora: AHORA,
    });

    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0]).toEqual({
      spreadsheetId: COPIA,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          { range: "'Closer 3'!S12", values: [["S2"]] },
          { range: "'Closer 3'!Y12", values: [[1500]] },
          { range: "'Closer 3'!AG12", values: [["24/09/2026 15:04:05"]] },
        ],
      },
    });

    expect(op.id).toMatch(/^[0-9a-f]{8}$/);
    expect(op.logFallo).toBeUndefined();
    expect(op.antes).toEqual({ fupsNoShow: "S1", cashDia1: "", ultimoToque: "" });
    expect(op.despues).toEqual({ fupsNoShow: "S2", cashDia1: "1500", ultimoToque: "24/09/2026 15:04:05" });

    expect(api.spreadsheets.values.append).toHaveBeenCalledTimes(1);
    const log = api.spreadsheets.values.append.mock.calls[0][0];
    expect(log).toMatchObject({ range: "'Log App'!A:K", valueInputOption: "RAW" });
    expect(log.requestBody.values).toEqual([
      ["24/09/2026 15:04:05", op.id, "Closer 3", "Closer 3", 12, "Ana Pérez", "S", "fupsNoShow", "S1", "S2", "NO_SHOW · Enviado S2"],
      ["24/09/2026 15:04:05", op.id, "Closer 3", "Closer 3", 12, "Ana Pérez", "Y", "cashDia1", "", "1500", "NO_SHOW · Enviado S2"],
      ["24/09/2026 15:04:05", op.id, "Closer 3", "Closer 3", 12, "Ana Pérez", "AG", "ultimoToque", "", "24/09/2026 15:04:05", "NO_SHOW · Enviado S2"],
    ]);
  });

  it("tocar: false no escribe AG (formulario de la ficha)", async () => {
    const op = await aplicarCambios({ ...identidad, cambios: { cashDia1: "1500" }, motivo: "FICHA", tocar: false, ahora: AHORA });
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([{ range: "'Closer 3'!Y12", values: [[1500]] }]);
    expect(op.despues).toEqual({ cashDia1: "1500" });
    expect(api.spreadsheets.values.append.mock.calls[0][0].requestBody.values).toHaveLength(1);
  });

  it("texto libre (AB, grabaciones) literal: con apóstrofo, así el Sheet no lo convierte; el log y `despues` sin él", async () => {
    const op = await aplicarCambios({
      ...identidad,
      cambios: { datosReagenda: "12/03", grabacion1: "https://x", fechaReagenda: "30/09/2026 10:00:00" },
      motivo: "x",
      ahora: AHORA,
    });
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([
      { range: "'Closer 3'!AB12", values: [["'12/03"]] },
      { range: "'Closer 3'!AD12", values: [["'https://x"]] },
      { range: "'Closer 3'!AC12", values: [["30/09/2026 10:00:00"]] },
      { range: "'Closer 3'!AG12", values: [["24/09/2026 15:04:05"]] },
    ]);
    expect(op.despues.datosReagenda).toBe("12/03");
    const log = api.spreadsheets.values.append.mock.calls[0][0].requestBody.values;
    expect(log[0][9]).toBe("12/03");
  });

  it("convierte el AG nativo (serial) al releer, así `antes` queda en texto", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [celdas({ ultimoToque: 46289.5625 })] } });
    const op = await aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, motivo: "x", ahora: AHORA });
    expect(op.antes.ultimoToque).toBe("24/09/2026 13:30:00");
  });

  it("si el log falla, la escritura vale igual y avisa con logFallo", async () => {
    api.spreadsheets.values.append.mockRejectedValue(new Error("cuota"));
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    const op = await aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, motivo: "x", ahora: AHORA });
    expect(op.logFallo).toBe(true);
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
    silencio.mockRestore();
  });

  it("si la API rechaza la escritura, el error llega tal cual (sin log)", async () => {
    api.spreadsheets.values.batchUpdate.mockRejectedValue(new Error("Invalid value"));
    await expect(aplicarCambios({ ...identidad, cambios: { fupsNoShow: "S2" }, motivo: "x" })).rejects.toThrow("Invalid value");
    expect(api.spreadsheets.values.append).not.toHaveBeenCalled();
  });
});

describe("deshacer", () => {
  it("restaura `antes` (incluido el AG viejo) solo si la fila tiene `despues`, y lo loguea como Deshacer", async () => {
    // La fila ya quedó como después de la acción.
    api.spreadsheets.values.get.mockResolvedValue({
      data: { values: [celdas({ fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" })] },
    });
    const op = await deshacer({
      ...identidad,
      restaurar: { fupsNoShow: "S1", ultimoToque: "" },
      esperado: { fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" },
      motivo: "NO_SHOW · Enviado S2",
      ahora: AHORA,
    });
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([
      { range: "'Closer 3'!S12", values: [["S1"]] },
      { range: "'Closer 3'!AG12", values: [[""]] },
    ]);
    expect(op.antes).toEqual({ fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" });
    expect(op.despues).toEqual({ fupsNoShow: "S1", ultimoToque: "" });
    const filasLog = api.spreadsheets.values.append.mock.calls[0][0].requestBody.values;
    expect(filasLog.map((f: unknown[]) => f[10])).toEqual(["Deshacer: NO_SHOW · Enviado S2", "Deshacer: NO_SHOW · Enviado S2"]);
  });

  it("rechaza `esperado` vacío o con otras columnas que `restaurar`, sin tocar la API", async () => {
    const base = { ...identidad, motivo: "x", ahora: AHORA };
    let e = await errorDe(deshacer({ ...base, restaurar: { fupsNoShow: "S1" }, esperado: {} }));
    expect(e.codigo).toBe("entrada_invalida");
    e = await errorDe(deshacer({ ...base, restaurar: { fupsNoShow: "S1", ultimoToque: "" }, esperado: { fupsNoShow: "S2" } }));
    expect(e.codigo).toBe("entrada_invalida");
    apiNoLlamada();
  });

  it("si la operación no tocó AG (ficha), deshacerla tampoco lo toca", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [celdas({ grabacion1: "https://nuevo" })] } });
    await deshacer({ ...identidad, restaurar: { grabacion1: "" }, esperado: { grabacion1: "https://nuevo" }, motivo: "FICHA", ahora: AHORA });
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([{ range: "'Closer 3'!AD12", values: [[""]] }]);
  });

  it("AG solo vuelve a una fecha legible o a vacío", async () => {
    const e = await errorDe(
      deshacer({ ...identidad, restaurar: { ultimoToque: "20260311110000" }, esperado: { ultimoToque: "24/09/2026 15:04:05" }, motivo: "x" }),
    );
    expect(e.codigo).toBe("valor_invalido");
    apiNoLlamada();
  });

  it("al restaurar texto libre, un número vuelve como número y el resto literal", async () => {
    api.spreadsheets.values.get.mockResolvedValue({
      data: { values: [celdas({ datosReagenda: "nuevo", grabacion1: "nuevo", ultimoToque: "24/09/2026 15:04:05" })] },
    });
    await deshacer({
      ...identidad,
      restaurar: { datosReagenda: "46094", grabacion1: "12/03", ultimoToque: "" },
      esperado: { datosReagenda: "nuevo", grabacion1: "nuevo", ultimoToque: "24/09/2026 15:04:05" },
      motivo: "x",
      ahora: AHORA,
    });
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([
      { range: "'Closer 3'!AB12", values: [[46094]] },
      { range: "'Closer 3'!AD12", values: [["'12/03"]] },
      { range: "'Closer 3'!AG12", values: [[""]] },
    ]);
  });

  it("acepta restaurar valores que hoy no pasarían la validación (estaban en la planilla)", async () => {
    api.spreadsheets.values.get.mockResolvedValue({
      data: { values: [celdas({ fechaReagenda: "30/09/2026 10:00:00", ultimoToque: "24/09/2026 15:04:05" })] },
    });
    await deshacer({
      ...identidad,
      restaurar: { fechaReagenda: "12/03 15 hs", ultimoToque: "" },
      esperado: { fechaReagenda: "30/09/2026 10:00:00", ultimoToque: "24/09/2026 15:04:05" },
      motivo: "x",
      ahora: AHORA,
    });
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("deshacerOperacion (Hechas hoy)", () => {
  // Log con una operación de hoy sobre 'Closer 3' fila 12 (S: S1 → S2, AG: "" → hoy).
  const LOG = [
    ["24/09/2026 15:04:05", "a1b2c3d4", "Closer 3", "Closer 3", 12, "Ana Pérez", "S", "fupsNoShow", "S1", "S2", "NO_SHOW · Enviado"],
    ["24/09/2026 15:04:05", "a1b2c3d4", "Closer 3", "Closer 3", 12, "Ana Pérez", "AG", "ultimoToque", "", "24/09/2026 15:04:05", "NO_SHOW · Enviado"],
  ];
  const puede = () => true;

  function simular(fila: unknown[], log: unknown[][] = LOG) {
    api.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) =>
      range.startsWith("'Log App'") ? { data: { values: log } } : { data: { values: [fila] } },
    );
  }

  beforeEach(() => invalidarCacheLog());

  it("restaura `antes` del log si la fila tiene `despues` y el nombre coincide", async () => {
    simular(celdas({ fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" }));
    const op = await deshacerOperacion({ idOperacion: "a1b2c3d4", closer: "Closer 3", puedeVerHoja: puede, ahora: AHORA });
    expect(api.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([
      { range: "'Closer 3'!S12", values: [["S1"]] },
      { range: "'Closer 3'!AG12", values: [[""]] },
    ]);
    expect(op.despues).toEqual({ fupsNoShow: "S1", ultimoToque: "" });
    const filasLog = api.spreadsheets.values.append.mock.calls[0][0].requestBody.values;
    expect(filasLog.map((f: unknown[]) => f[10])).toEqual(["Deshacer: NO_SHOW · Enviado", "Deshacer: NO_SHOW · Enviado"]);
  });

  it("un closer no deshace operaciones de otra hoja", async () => {
    simular(celdas({ fupsNoShow: "S2" }));
    const e = await errorDe(deshacerOperacion({ idOperacion: "a1b2c3d4", closer: "Closer 1", puedeVerHoja: (h) => h === "Closer 1" }));
    expect(e.codigo).toBe("hoja_prohibida");
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("id que no está en el log", async () => {
    simular(celdas({}));
    const e = await errorDe(deshacerOperacion({ idOperacion: "ffffffff", closer: "x", puedeVerHoja: puede }));
    expect(e.codigo).toBe("entrada_invalida");
  });

  it("si en la fila ahora hay otro lead, no deshace", async () => {
    simular(celdas({ nombre: "Otra Persona", fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" }));
    const e = await errorDe(deshacerOperacion({ idOperacion: "a1b2c3d4", closer: "x", puedeVerHoja: puede }));
    expect(e.codigo).toBe("fila_cambiada");
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("si el lead cambió después (esperado distinto), no deshace", async () => {
    simular(celdas({ fupsNoShow: "S3", ultimoToque: "24/09/2026 16:00:00" }));
    const e = await errorDe(deshacerOperacion({ idOperacion: "a1b2c3d4", closer: "x", puedeVerHoja: puede }));
    expect(e.codigo).toBe("fila_cambiada");
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  it("una operación ya deshecha no se vuelve a deshacer", async () => {
    const deshecha = [
      ...LOG,
      ["24/09/2026 15:05:00", "e5f6a7b8", "Closer 3", "Closer 3", 12, "Ana Pérez", "S", "fupsNoShow", "S2", "S1", "Deshacer: NO_SHOW · Enviado"],
      ["24/09/2026 15:05:00", "e5f6a7b8", "Closer 3", "Closer 3", 12, "Ana Pérez", "AG", "ultimoToque", "24/09/2026 15:04:05", "", "Deshacer: NO_SHOW · Enviado"],
    ];
    simular(celdas({ fupsNoShow: "S1" }), deshecha);
    let e = await errorDe(deshacerOperacion({ idOperacion: "a1b2c3d4", closer: "x", puedeVerHoja: puede }));
    expect(e.message).toMatch(/ya se deshizo/);
    e = await errorDe(deshacerOperacion({ idOperacion: "e5f6a7b8", closer: "x", puedeVerHoja: puede }));
    expect(e.message).toMatch(/ya es un Deshacer/);
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });
});
