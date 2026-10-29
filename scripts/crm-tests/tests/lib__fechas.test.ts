import { describe, expect, it } from "vitest";
import {
  diasDesde,
  formatearCorto,
  formatearFechaLarga,
  formatearFechaSheet,
  horaCorta,
  mismoDia,
  parsearFechaReagenda,
  parsearFechaSheet,
  textoDesdeSerialSheets,
} from "@/lib/crm//fechas";

describe("parsearFechaSheet", () => {
  it("interpreta el texto como hora de Buenos Aires (UTC-3)", () => {
    expect(parsearFechaSheet("24/09/2026 18:30:00")?.toISOString()).toBe("2026-09-24T21:30:00.000Z");
  });

  it("acepta sin segundos y hora de un dígito", () => {
    expect(parsearFechaSheet("05/03/2026 9:05")?.toISOString()).toBe("2026-03-05T12:05:00.000Z");
  });

  it("acepta solo fecha (medianoche) y espacios alrededor", () => {
    expect(parsearFechaSheet("  01/10/2026 ")?.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it.each(["", "03/07", "31/02/2026 10:00", "24/09/2026 25:00", "2026-09-24", "mañana", undefined, null])(
    "rechaza %j",
    (texto) => {
      expect(parsearFechaSheet(texto)).toBeNull();
    },
  );
});

describe("formatearFechaSheet", () => {
  it("escribe en el formato de la planilla, en hora de Buenos Aires", () => {
    expect(formatearFechaSheet(new Date("2026-09-25T02:07:09Z"))).toBe("24/09/2026 23:07:09");
  });

  it("es la inversa de parsearFechaSheet", () => {
    const texto = "31/12/2026 23:59:59";
    expect(formatearFechaSheet(parsearFechaSheet(texto)!)).toBe(texto);
  });
});

describe("parsearFechaReagenda", () => {
  const call = parsearFechaSheet("10/03/2026 15:00")!;
  const texto = (t: string, c = call) => {
    const f = parsearFechaReagenda(t, c);
    return f && formatearFechaSheet(f);
  };

  it("acepta el formato de la planilla", () => {
    expect(texto("12/03/2026 15:30:00")).toBe("12/03/2026 15:30:00");
  });

  it.each([
    ["12/03 15 hs", "12/03/2026 15:00:00"],
    ["12/03 15hs", "12/03/2026 15:00:00"],
    ["12/03 15:30 hs", "12/03/2026 15:30:00"],
    ["12/03/26 11 hs", "12/03/2026 11:00:00"],
    ["12/03/2026 11 hs.", "12/03/2026 11:00:00"],
    ["12/03 10 am", "12/03/2026 10:00:00"],
    ["12/03 3 pm", "12/03/2026 15:00:00"],
    ["el 12/03 a las 18:15", "12/03/2026 18:15:00"],
    ["12/03", "12/03/2026 00:00:00"],
  ])("lee la fecha escrita a mano %j", (entrada, esperado) => {
    expect(texto(entrada)).toBe(esperado);
  });

  it("deduce el año siguiente si la fecha queda antes de la call", () => {
    expect(texto("05/01 10 hs", parsearFechaSheet("28/12/2025 10:00")!)).toBe("05/01/2026 10:00:00");
  });

  it.each(["12/03 FUP", "FUP 12/03 15 hs", "coordinar con Ivonne", "12/03 15", "12/03/26 hs", "31/02 10 hs", ""])(
    "no toma como reagenda %j",
    (entrada) => {
      expect(texto(entrada)).toBeNull();
    },
  );
});

describe("textoDesdeSerialSheets", () => {
  it("convierte fechas nativas de Sheets al texto de la planilla", () => {
    expect(textoDesdeSerialSheets(46289.5625)).toBe("24/09/2026 13:30:00");
    expect(textoDesdeSerialSheets(46289)).toBe("24/09/2026 00:00:00");
  });
});

describe("diasDesde / mismoDia", () => {
  // 24/09 a las 23:30 en Buenos Aires = 25/09 02:30 UTC: en UTC ya sería "mañana".
  const ahora = new Date("2026-09-25T02:30:00Z");

  it("cuenta días calendario de Buenos Aires, no de UTC", () => {
    expect(diasDesde(parsearFechaSheet("24/09/2026 08:00")!, ahora)).toBe(0);
    expect(diasDesde(parsearFechaSheet("23/09/2026 23:59")!, ahora)).toBe(1);
    expect(diasDesde(parsearFechaSheet("25/09/2026 00:10")!, ahora)).toBe(-1);
  });

  it("mismoDia usa el día de Buenos Aires", () => {
    expect(mismoDia(parsearFechaSheet("24/09/2026 00:00")!, ahora)).toBe(true);
    expect(mismoDia(parsearFechaSheet("25/09/2026 00:00")!, ahora)).toBe(false);
  });
});

describe("formatos para la pantalla", () => {
  // 24/09/2026 23:30 en Buenos Aires (en UTC ya es el 25).
  const fecha = new Date("2026-09-25T02:30:00Z");

  it("formatearCorto: día corto, dd/mm y hora de Buenos Aires", () => {
    expect(formatearCorto(fecha)).toBe("jue 24/09 23:30");
    expect(formatearCorto(parsearFechaSheet("01/03/2026 09:05")!)).toBe("dom 01/03 09:05");
  });
  it("formatearFechaLarga", () => {
    expect(formatearFechaLarga(fecha)).toBe("jueves 24 de septiembre");
  });
  it("horaCorta: hora de Buenos Aires con dos dígitos", () => {
    expect(horaCorta(fecha)).toBe("23:30");
    expect(horaCorta(parsearFechaSheet("01/03/2026 09:05")!)).toBe("09:05");
  });
});
