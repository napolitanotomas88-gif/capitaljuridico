import { describe, expect, it } from "vitest";
import { COLUMNAS_IGNORADAS } from "@/lib/crm/config/crm";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { CAMPOS_ESCRIBIBLES, CAMPOS_USADOS, COLUMNAS, filaDesdeValores, indiceColumna, type Campo, type FilaLead } from "@/lib/crm/sheets/columnas";
import {
  armarRangos,
  camposDistintos,
  camposProhibidos,
  conUltimoToque,
  diferencias,
  esClaveVieja,
  filasLog,
  mismaIdentidad,
  mismasClaves,
  mismoValor,
  pareceMiles,
  tocaUltimoToque,
  validarCambios,
  valorCelda,
} from "@/lib/crm/sheets/verificacion";

function fila(valores: Partial<Record<Campo, string>>, numeroFila = 12): FilaLead {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  return { hoja: "Closer 3", numeroFila, valores: { ...base, nombre: "Ana María Pérez", telefono: "+54 9 11 5555-1234", ...valores } };
}

describe("mismaIdentidad", () => {
  const f = fila({ fechaCall: "20/09/2026 10:00:00" });
  it("tolera espacios, mayúsculas, tildes y el formato del teléfono", () => {
    expect(mismaIdentidad(f, { nombre: "  ana maria  perez ", telefono: "5491155551234", fechaCall: "" })).toBe(true);
  });
  it("rechaza otro nombre u otro teléfono", () => {
    expect(mismaIdentidad(f, { nombre: "Ana Pérez", telefono: "+54 9 11 5555-1234", fechaCall: "" })).toBe(false);
    expect(mismaIdentidad(f, { nombre: "Ana María Pérez", telefono: "+54 9 11 5555-1235", fechaCall: "" })).toBe(false);
  });
  it("con teléfono, la fecha de la call no se mira", () => {
    expect(mismaIdentidad(f, { nombre: "Ana María Pérez", telefono: "5491155551234", fechaCall: "01/01/2026 10:00" })).toBe(true);
  });
  it("sin teléfono en la fila, además tiene que coincidir la fecha de la call (D)", () => {
    const sinTel = fila({ telefono: "", fechaCall: "20/09/2026 10:00:00" });
    expect(mismaIdentidad(sinTel, { nombre: "Ana María Pérez", telefono: "", fechaCall: "20/09/2026 10:00" })).toBe(true);
    expect(mismaIdentidad(sinTel, { nombre: "Ana María Pérez", telefono: "", fechaCall: "21/09/2026 10:00:00" })).toBe(false);
    expect(mismaIdentidad(sinTel, { nombre: "Ana María Pérez", telefono: "", fechaCall: "" })).toBe(false);
  });
});

describe("mismasClaves", () => {
  it("mismas claves, sin importar el orden", () => {
    expect(mismasClaves({ a: "1", b: "" }, { b: "x", a: "y" })).toBe(true);
    expect(mismasClaves({ a: "1" }, { a: "1", b: "" })).toBe(false);
    expect(mismasClaves({}, {})).toBe(true);
  });
});

describe("camposProhibidos", () => {
  it("deja pasar la lista blanca y frena el resto", () => {
    expect(camposProhibidos({ precall: "DOLORES", ultimoToque: "" })).toEqual([]);
    expect(camposProhibidos({ nombre: "x", fechaCall: "y", situacion: "Fee" })).toEqual(["nombre", "fechaCall"]);
    expect(camposProhibidos({ inventado: "1" })).toEqual(["inventado"]);
  });
  it("la lista blanca es F, R, S, T, V, W, Y, Z, AA, AB, AC, AD, AE, AF, AG, AH, AI y AJ: sin U ni X", () => {
    expect(CAMPOS_ESCRIBIBLES.map((c) => COLUMNAS[c])).toEqual(["F", "R", "S", "T", "V", "W", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK"]);
    expect(camposProhibidos({ presentoCall2: "", seguimientoPost2: "Hacer", seguimientoPost1: "Hacer" })).toEqual(["presentoCall2", "seguimientoPost2"]);
    for (const c of COLUMNAS_IGNORADAS) expect(camposProhibidos({ [c]: "" })).toEqual([c]);
  });
});

describe("columnas ignoradas (N, O, P, U, X)", () => {
  it("llegan vacías al leer la fila, aunque la planilla tenga algo", () => {
    const celdas = Array.from({ length: indiceColumna(COLUMNAS.ultimoToque) + 1 }, (_, i) => `valor ${i}`);
    const { valores } = filaDesdeValores("Closer 1", 5, celdas);
    for (const c of COLUMNAS_IGNORADAS) expect(valores[c]).toBe("");
    // El resto se lee por su letra, igual que siempre (los índices no se corren).
    expect(valores.leadScoring).toBe(`valor ${indiceColumna("Q")}`);
    expect(valores.situacion).toBe(`valor ${indiceColumna("V")}`);
    expect(valores.seguimientoPost1).toBe(`valor ${indiceColumna("W")}`);
    expect(valores.cashDia1).toBe(`valor ${indiceColumna("Y")}`);
  });
  it("CAMPOS_USADOS son todos menos las ignoradas", () => {
    expect(CAMPOS_USADOS).toHaveLength(Object.keys(COLUMNAS).length - COLUMNAS_IGNORADAS.length);
    for (const c of COLUMNAS_IGNORADAS) expect(CAMPOS_USADOS).not.toContain(c);
  });
});

describe("validarCambios", () => {
  it("acepta los textos exactos de los desplegables, números y fechas", () => {
    expect(
      validarCambios({
        precall: "VIDEOS CONF",
        presentoAgenda1: "No",
        fupsNoShow: "S3",
        seguimientoPost1: "No hacer",
        situacion: "Quiere pensarlo",
        cashDia1: "1500",
        valorServicio: "2500,50",
        fechaReagenda: "30/09/2026 10:00:00",
        datosReagenda: "lo llamo el lunes",
      }),
    ).toBeNull();
  });
  it("Olvidar del no-show (S = No hacer + F = Olvidar) es válido", () => {
    expect(validarCambios({ fupsNoShow: "No hacer", precall: "Olvidar" })).toBeNull();
  });
  it.each([
    [{ precall: "videos conf" }, /desplegable/],
    [{ presentoAgenda1: "Sí" }, /desplegable/],
    [{ fupsNoShow: "S6" }, /desplegable/],
    [{ cashDia1: "mil" }, /número/],
    [{ fechaReagenda: "12/03 15 hs" }, /fecha/],
    [{ datosReagenda: "=IMPORTRANGE(...)" }, /"="/],
    [{ situacion: "x".repeat(501) }, /largo/],
    [{ datosReagenda: "x".repeat(50_001) }, /largo/],
    [{ cashDia1: "1.500" }, /sin puntos ni comas de miles/],
    [{ valorServicio: "3,000" }, /sin puntos ni comas de miles/],
    [{ valorServicio: "1.500.000" }, /sin puntos ni comas de miles/],
    [{}, /nada/],
  ])("rechaza %j", (cambios, esperado) => {
    expect(validarCambios(cambios)).toMatch(esperado);
  });
  it("los mensajes usan el nombre legible de la columna, no el id", () => {
    expect(validarCambios({ seguimientoPost1: "S9" })).toBe('Seguimientos post-call 1: "S9" no es una opción del desplegable.');
    expect(validarCambios({ cashDia1: "mil" })).toBe('Cash cobrado en la llamada (día 1): "mil" no es un número.');
  });
  it("vacío siempre vale (borra la celda), también T al reagendar", () => {
    expect(validarCambios({ fupsNoShow: "", cashDia1: "" })).toBeNull();
    expect(validarCambios({ presentoReagenda: "", situacion: "Reagendó", fechaReagenda: "30/09/2026 10:00:00" })).toBeNull();
    expect(armarRangos("Closer 1", 5, { presentoReagenda: "" })).toEqual([{ range: "'Closer 1'!T5", values: [[""]] }]);
  });
  it("en modo restaurar devuelve lo que ya estaba, aunque no pase la validación", () => {
    expect(validarCambios({ fechaReagenda: "12/03 15 hs", precall: "NO RESPONDE" }, "restaurar")).toBeNull();
    expect(validarCambios({ datosReagenda: "=x" }, "restaurar")).toMatch(/"="/);
  });
  it("el texto libre y lo que se restaura pueden ocupar una celda entera (AB de más de 500)", () => {
    const notaLarga = "llamó el lunes, pidió otra fecha. ".repeat(30); // ~1000 caracteres
    expect(validarCambios({ datosReagenda: notaLarga })).toBeNull();
    expect(validarCambios({ datosReagenda: notaLarga, fechaReagenda: "30/09/2026 10:00:00" }, "restaurar")).toBeNull();
    expect(validarCambios({ situacion: "x".repeat(700) }, "restaurar")).toBeNull();
    expect(validarCambios({ datosReagenda: "x".repeat(50_001) }, "restaurar")).toMatch(/largo/);
  });
  it("montos: acepta decimales con coma o punto, no los separadores de miles", () => {
    expect(pareceMiles("1500")).toBe(false);
    expect(pareceMiles("1500,50")).toBe(false);
    expect(pareceMiles("1.5")).toBe(false);
    expect(pareceMiles("1.500")).toBe(true);
    expect(pareceMiles("1.500,50")).toBe(true);
    expect(validarCambios({ cashDia1: "1500,50", valorServicio: "3000.5" })).toBeNull();
  });
  it("en modo restaurar, AG solo puede ser una fecha legible o vacío", () => {
    expect(validarCambios({ ultimoToque: "" }, "restaurar")).toBeNull();
    expect(validarCambios({ ultimoToque: "24/09/2026 15:04:05" }, "restaurar")).toBeNull();
    expect(validarCambios({ ultimoToque: "20260311110000" }, "restaurar")).toMatch(/Último toque/);
  });
});

describe("mismoValor", () => {
  it.each([
    ["S1", " S1 ", true],
    ["1500", "1500.00", true],
    ["1500,5", "1500.5", true],
    ["30/09/2026 10:00:00", "30/09/2026 10:00", true],
    ["", "", true],
    ["S1", "S2", false],
    ["1500", "1501", false],
    ["Si", "si", false],
  ])("%j vs %j → %s", (a, b, esperado) => {
    expect(mismoValor(a, b)).toBe(esperado);
  });
});

describe("camposDistintos", () => {
  it("lista los campos cuyo valor actual no es el esperado", () => {
    const f = fila({ fupsNoShow: "S2", ultimoToque: "24/09/2026 10:00:00" });
    expect(camposDistintos(f, { fupsNoShow: "S2", ultimoToque: "24/09/2026 10:00:00" })).toEqual([]);
    expect(camposDistintos(f, { fupsNoShow: "S3", ultimoToque: "24/09/2026 11:00:00" })).toEqual(["fupsNoShow", "ultimoToque"]);
  });
});

describe("conUltimoToque / diferencias", () => {
  const ahora = parsearFechaSheet("24/09/2026 15:04:05")!;
  it("agrega AG = ahora salvo que ya venga (Deshacer)", () => {
    expect(conUltimoToque({ fupsNoShow: "S1" }, ahora)).toEqual({ fupsNoShow: "S1", ultimoToque: "24/09/2026 15:04:05" });
    expect(conUltimoToque({ fupsNoShow: "S1", ultimoToque: "" }, ahora)).toEqual({ fupsNoShow: "S1", ultimoToque: "" });
  });
  it("tocaUltimoToque: todas las acciones escriben AG menos el Enviado del pre-call (solo F con una fase)", () => {
    expect(tocaUltimoToque({ precall: "VIDEOS CONF" })).toBe(false);
    expect(tocaUltimoToque({ precall: "Hecho - link a call" })).toBe(false);
    expect(tocaUltimoToque({ precall: "hecho - link a call " })).toBe(false);
    // Olvidar (S + F) y cualquier otra acción sí.
    expect(tocaUltimoToque({ fupsNoShow: "No hacer", precall: "Olvidar" })).toBe(true);
    expect(tocaUltimoToque({ precall: "Olvidar" })).toBe(true);
    expect(tocaUltimoToque({ fupsNoShow: "S2" })).toBe(true);
    expect(tocaUltimoToque({ precall: "VIDEOS CONF", fupsNoShow: "S2" })).toBe(true);
    expect(tocaUltimoToque({})).toBe(true);
    // La llamada del pre-caller (AI, con o sin la fase que salta) tampoco: es parte del pre-call
    expect(tocaUltimoToque({ llamadaPrecall: "No efectiva" })).toBe(false);
    expect(tocaUltimoToque({ banderaRoja: "Si" })).toBe(false);
    expect(tocaUltimoToque({ banderaRoja: "" })).toBe(false);
    expect(tocaUltimoToque({ llamadaPrecall: "Efectiva", precall: "DOLORES" })).toBe(false);
    expect(tocaUltimoToque({ llamadaPrecall: "Efectiva", fupsNoShow: "S2" })).toBe(true);
  });
  it("antes/despues campo por campo", () => {
    const f = fila({ fupsNoShow: "S1", ultimoToque: "23/09/2026 09:00:00" });
    expect(diferencias(f, { fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" })).toEqual({
      antes: { fupsNoShow: "S1", ultimoToque: "23/09/2026 09:00:00" },
      despues: { fupsNoShow: "S2", ultimoToque: "24/09/2026 15:04:05" },
    });
  });
});

describe("armarRangos", () => {
  it("una range por celda, con la hoja entre comillas y los números como número", () => {
    expect(armarRangos("Gero-Xavi Rejunte", 12, { precall: "DOLORES", cashDia1: "1500,50", cashTratoCerrado: "" })).toEqual([
      { range: "'Gero-Xavi Rejunte'!F12", values: [["DOLORES"]] },
      { range: "'Gero-Xavi Rejunte'!Y12", values: [[1500.5]] },
      { range: "'Gero-Xavi Rejunte'!Z12", values: [[""]] },
    ]);
  });
  it("escapa comillas simples en el nombre de la hoja", () => {
    expect(armarRangos("O'Closer", 2, { ultimoToque: "x" })[0].range).toBe("'O''Closer'!AG2");
  });
  it("el texto libre va con apóstrofo para que el Sheet no lo convierta", () => {
    expect(armarRangos("Closer 1", 5, { datosReagenda: "12/03 15", grabacion3: "1500", situacion: "Fee" })).toEqual([
      { range: "'Closer 1'!AB5", values: [["'12/03 15"]] },
      { range: "'Closer 1'!AF5", values: [["'1500"]] },
      { range: "'Closer 1'!V5", values: [["Fee"]] },
    ]);
  });
});

describe("valorCelda", () => {
  it.each([
    ["datosReagenda", "12/03", "accion", "'12/03"],
    ["datosReagenda", "TRUE", "accion", "'TRUE"],
    ["datosReagenda", "-5", "accion", "'-5"],
    ["grabacion1", "", "accion", ""],
    ["grabacion1", "   ", "accion", ""],
    ["datosReagenda", "46094", "restaurar", 46094],
    // Un texto que la API no podría haber leído como número vuelve literal (sin perder el 0 ni los miles).
    ["datosReagenda", "01155556666", "restaurar", "'01155556666"],
    ["datosReagenda", "1.500", "restaurar", "'1.500"],
    ["grabacion1", "1500.5", "restaurar", 1500.5],
    ["cashDia1", "1500.5", "restaurar", 1500.5],
    // Un monto que era texto en la planilla ("1.500") no vuelve como 1,5: va como se escribiría a mano.
    ["cashDia1", "1.500", "restaurar", "1.500"],
    ["datosReagenda", "12/03 15 hs", "restaurar", "'12/03 15 hs"],
    ["cashDia1", "1500,5", "accion", 1500.5],
    ["fechaReagenda", "30/09/2026 10:00:00", "accion", "30/09/2026 10:00:00"],
    ["presentoReagenda", "", "accion", ""],
  ] as const)("%s %j (%s) → %j", (campo, valor, modo, esperado) => {
    expect(valorCelda(campo, valor, modo)).toEqual(esperado);
  });
});

describe("esClaveVieja", () => {
  it.each([
    ["20260311110000", true],
    [" 99991231235959 ", true],
    ["24/09/2026 10:00:00", false],
    ["2026031111000", false],
    ["", false],
  ])("%j → %s", (v, esperado) => {
    expect(esClaveVieja(v)).toBe(esperado);
  });
});

describe("filasLog", () => {
  it("una fila por celda que cambió, en el orden de los encabezados", () => {
    const filas = filasLog({
      fecha: parsearFechaSheet("24/09/2026 15:04:05")!,
      operacion: "op1",
      closer: "Closer 3",
      hoja: "Closer 3",
      numeroFila: 12,
      lead: "Ana",
      antes: { fupsNoShow: "S1", datosReagenda: "igual", ultimoToque: "" },
      despues: { fupsNoShow: "S2", datosReagenda: "igual", ultimoToque: "24/09/2026 15:04:05" },
      motivo: "NO_SHOW · Enviado S2",
    });
    expect(filas).toEqual([
      ["24/09/2026 15:04:05", "op1", "Closer 3", "Closer 3", 12, "Ana", "S", "fupsNoShow", "S1", "S2", "NO_SHOW · Enviado S2"],
      ["24/09/2026 15:04:05", "op1", "Closer 3", "Closer 3", 12, "Ana", "AG", "ultimoToque", "", "24/09/2026 15:04:05", "NO_SHOW · Enviado S2"],
    ]);
  });
});


describe("Recordatorio no altera último toque", () => {
  it.each(["", "1", "2", "3"])("%s es metadato del pre-call", valor => {
    expect(tocaUltimoToque({ recordatorioPrecall: valor })).toBe(false);
  });
});
