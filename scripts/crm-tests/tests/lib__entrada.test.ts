import { describe, expect, it } from "vitest";
import {
  decodificarParam,
  leerCambios,
  leerCambiosFicha,
  leerFilaParam,
  leerHojaYFila,
  leerIdentidad,
  leerIdOperacion,
  leerMotivo,
} from "@/lib/crm//entrada";

describe("leerIdentidad", () => {
  it("acepta solo la forma exacta", () => {
    expect(leerIdentidad({ hoja: "Closer 1", numeroFila: 12, nombre: "A", telefono: "1", fechaCall: "" })).toEqual({
      hoja: "Closer 1",
      numeroFila: 12,
      nombre: "A",
      telefono: "1",
      fechaCall: "",
    });
  });
  const f = "24/09/2026 10:00:00";
  it.each([null, "x", [], {}, { hoja: "", numeroFila: 2, nombre: "A", telefono: "1", fechaCall: f }, { hoja: "H", numeroFila: "2", nombre: "A", telefono: "1", fechaCall: f }, { hoja: "H", numeroFila: 1, nombre: "A", telefono: "1", fechaCall: f }, { hoja: "H", numeroFila: 2.5, nombre: "A", telefono: "1", fechaCall: f }, { hoja: "H", numeroFila: 2, nombre: 3, telefono: "1", fechaCall: f }, { hoja: "H", numeroFila: 2, nombre: "A", telefono: "1" }])(
    "rechaza %j",
    (x) => {
      expect(leerIdentidad(x)).toBeNull();
    },
  );
});

describe("leerCambios / leerCambiosFicha", () => {
  it("solo textos", () => {
    expect(leerCambios({ fupsNoShow: "S1", ultimoToque: "" })).toEqual({ fupsNoShow: "S1", ultimoToque: "" });
    expect(leerCambios({ fupsNoShow: 1 })).toBeNull();
    expect(leerCambios(["S1"])).toBeNull();
    expect(leerCambios(undefined)).toBeNull();
  });
  it("la ficha solo acepta cash, valor y grabaciones", () => {
    expect(leerCambiosFicha({ cashDia1: "1500", grabacion1: "https://x" })).toEqual({ cashDia1: "1500", grabacion1: "https://x" });
    expect(leerCambiosFicha({ cashDia1: "1500", situacion: "Fee" })).toBeNull();
  });
});

describe("leerMotivo", () => {
  it("recorta y limita", () => {
    expect(leerMotivo("  NO_SHOW · Enviado S2 ")).toBe("NO_SHOW · Enviado S2");
    expect(leerMotivo("x".repeat(300))).toHaveLength(200);
    expect(leerMotivo(5)).toBe("");
  });
});

describe("leerHojaYFila / leerIdOperacion", () => {
  it("hoja con texto y fila entera desde la 2", () => {
    expect(leerHojaYFila("Closer 1", 12)).toEqual({ hoja: "Closer 1", numeroFila: 12 });
    expect(leerHojaYFila("", 12)).toBeNull();
    expect(leerHojaYFila("Closer 1", 1)).toBeNull();
    expect(leerHojaYFila("Closer 1", "12")).toBeNull();
  });
  it("id de operación de 8 hex", () => {
    expect(leerIdOperacion("a1b2c3d4")).toBe("a1b2c3d4");
    expect(leerIdOperacion("A1B2C3D4")).toBeNull();
    expect(leerIdOperacion("a1b2c3d")).toBeNull();
    expect(leerIdOperacion(12345678)).toBeNull();
  });
});

describe("decodificarParam / leerFilaParam (params de la URL, que Next 16 pasa codificados)", () => {
  it("decodifica espacios, guiones y tildes", () => {
    // Lo que arma hrefFicha (encodeURIComponent) es lo que llega en params.
    for (const hoja of ["Closer 1", "Gero-Xavi Rejunte", "Hoja con ñ y tilde á", "100% leads"]) {
      expect(decodificarParam(encodeURIComponent(hoja))).toBe(hoja);
    }
    expect(decodificarParam("Closer%201")).toBe("Closer 1");
    expect(decodificarParam("Gero-Xavi%20Rejunte")).toBe("Gero-Xavi Rejunte");
    expect(decodificarParam("closer1")).toBe("closer1");
  });

  it("un texto mal codificado o vacío no es una hoja", () => {
    expect(decodificarParam("%E0%A4%A")).toBeNull();
    expect(decodificarParam("%")).toBeNull();
    expect(decodificarParam("%20")).toBeNull();
    expect(decodificarParam("")).toBeNull();
  });

  it("fila: solo números desde la 2", () => {
    expect(leerFilaParam("541")).toBe(541);
    expect(leerFilaParam("2")).toBe(2);
    for (const x of ["1", "0", "-3", "5.5", "1e3", "abc", "", " 5", "12345678"]) expect(leerFilaParam(x)).toBeNull();
  });
});
