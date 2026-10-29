import { describe, expect, it } from "vitest";
import type { EntradaLog } from "@/lib/crm/contratos";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { claveFaseHoy, claveFaseHoyPorF } from "@/lib/crm/motor/proxima-accion";
import { esDeTarjeta } from "@/lib/crm/pantalla";
import { agruparOperaciones, hechasHoyPorHoja, operacionesDeHoy, precallEnviadoHoy, precallEnviadoHoyEnLog } from "@/lib/crm//hechas";

// jueves 24/09/2026 15:00 (Buenos Aires)
const AHORA = parsearFechaSheet("24/09/2026 15:00")!;

function e(extra: Partial<EntradaLog>): EntradaLog {
  return {
    fecha: "24/09/2026 10:00:00",
    operacion: "op1",
    closer: "Carlos",
    hoja: "Closer 1",
    fila: 5,
    lead: "Lead",
    columna: "R",
    campo: "presentoAgenda1",
    antes: "",
    despues: "Si",
    motivo: "SE_PRESENTO · Sí",
    ...extra,
  };
}

/** Una operación de dos celdas (la columna pedida + AG). */
const op = (id: string, extra: Partial<EntradaLog>, columna = "S", campo = "fupsNoShow", antes = "", despues = "S1") => [
  e({ operacion: id, columna, campo, antes, despues, ...extra }),
  e({ operacion: id, columna: "AG", campo: "ultimoToque", antes: "", despues: extra.fecha ?? "24/09/2026 10:00:00", ...extra }),
];
const deshacer = (id: string, extra: Partial<EntradaLog>, columna = "S", campo = "fupsNoShow") => [
  e({ operacion: id, columna, campo, antes: "S1", despues: "", motivo: "Deshacer: algo", ...extra }),
  e({ operacion: id, columna: "AG", campo: "ultimoToque", antes: "x", despues: "", motivo: "Deshacer: algo", ...extra }),
];

describe("agruparOperaciones", () => {
  it("una operación por id + fecha, con todas sus celdas, en orden", () => {
    const ops = agruparOperaciones([...op("a", { fecha: "24/09/2026 10:00:00" }), ...op("b", { fecha: "24/09/2026 11:30:00", fila: 7 })]);
    expect(ops.map((o) => [o.idOperacion, o.hora, o.fila, o.cambios.map((c) => c.columna)])).toEqual([
      ["a", "10:00", 5, ["S", "AG"]],
      ["b", "11:30", 7, ["S", "AG"]],
    ]);
    expect(ops[0].cambios[0]).toEqual({ columna: "S", campo: "fupsNoShow", antes: "", despues: "S1" });
  });

  it("el mismo id en otro día es otra operación", () => {
    const ops = agruparOperaciones([...op("a", { fecha: "20/09/2026 10:00:00" }), ...op("a", { fecha: "24/09/2026 10:00:00" })]);
    expect(ops).toHaveLength(2);
  });

  it("un Deshacer marca la operación anterior de la misma fila cuyas columnas cubre", () => {
    const ops = agruparOperaciones([
      ...op("a", { fecha: "24/09/2026 10:00:00" }),
      ...op("b", { fecha: "24/09/2026 10:10:00" }, "V", "situacion"), // otra columna, misma fila
      ...op("c", { fecha: "24/09/2026 10:20:00", fila: 9 }), // otra fila
      ...deshacer("d", { fecha: "24/09/2026 10:30:00" }), // S + AG en la fila 5
    ]);
    expect(ops.map((o) => [o.idOperacion, o.deshecha, o.esDeshacer])).toEqual([
      ["a", true, false],
      ["b", false, false],
      ["c", false, false],
      ["d", false, true],
    ]);
  });

  it("dos Deshacer marcan dos operaciones, de la más nueva a la más vieja", () => {
    const ops = agruparOperaciones([
      ...op("a", { fecha: "24/09/2026 10:00:00" }),
      ...op("b", { fecha: "24/09/2026 10:10:00" }),
      ...deshacer("c", { fecha: "24/09/2026 10:20:00" }),
    ]);
    expect(ops.find((o) => o.idOperacion === "b")?.deshecha).toBe(true);
    expect(ops.find((o) => o.idOperacion === "a")?.deshecha).toBe(false);
  });
});

describe("operacionesDeHoy", () => {
  it("solo las de hoy y de esa hoja, la más nueva primero, sin los Deshacer y con `deshecha`", () => {
    const log = [
      ...op("viejo", { fecha: "23/09/2026 18:00:00" }),
      ...op("a", { fecha: "24/09/2026 09:00:00" }),
      ...op("otra", { fecha: "24/09/2026 09:30:00", hoja: "Closer 2" }),
      ...op("b", { fecha: "24/09/2026 10:00:00", fila: 8, closer: "Admin" }),
      ...deshacer("d", { fecha: "24/09/2026 10:05:00" }),
    ];
    const hechas = operacionesDeHoy(log, "Closer 1", AHORA);
    expect(hechas.map((o) => [o.idOperacion, o.hora, o.closer, o.deshecha])).toEqual([
      ["b", "10:00", "Admin", false],
      ["a", "09:00", "Carlos", true],
    ]);
    expect(hechas[0]).not.toHaveProperty("esDeshacer");
    expect(JSON.parse(JSON.stringify(hechas))).toEqual(hechas);
  });
});

describe("hechasHoyPorHoja", () => {
  it("netas de hoy por hoja: sin Deshacer, sin deshechas, sin otros días y sin las del admin", () => {
    const log = [
      ...op("a", { fecha: "24/09/2026 09:00:00" }),
      ...op("b", { fecha: "24/09/2026 09:10:00", fila: 6 }),
      ...deshacer("c", { fecha: "24/09/2026 09:20:00", fila: 6 }),
      ...op("d", { fecha: "24/09/2026 09:30:00", hoja: "Closer 2" }),
      ...op("e", { fecha: "23/09/2026 23:59:00", hoja: "Closer 2" }),
      ...op("f", { fecha: "24/09/2026 11:00:00", closer: "Admin" }),
      ...op("g", { fecha: "no es fecha" }),
    ];
    expect(hechasHoyPorHoja(log, AHORA, "Admin")).toEqual({ "Closer 1": 1, "Closer 2": 1 });
    expect(hechasHoyPorHoja(log, AHORA)).toEqual({ "Closer 1": 2, "Closer 2": 1 });
    // Con el filtro del admin (esDeTarjeta), un guardado de la ficha no suma
    const conFicha = [...log, ...op("h", { fecha: "24/09/2026 12:00:00", motivo: "FICHA · notas de reagenda" }, "AB", "datosReagenda", "", "nota")];
    expect(hechasHoyPorHoja(conFicha, AHORA, "Admin")).toEqual({ "Closer 1": 2, "Closer 2": 1 });
    expect(hechasHoyPorHoja(conFicha, AHORA, "Admin", esDeTarjeta)).toEqual({ "Closer 1": 1, "Closer 2": 1 });
  });

  it("todo deshecho → nada", () => {
    expect(hechasHoyPorHoja([...op("a", {}), ...deshacer("b", { fecha: "24/09/2026 10:01:00" })], AHORA)).toEqual({});
  });
});

describe("precallEnviadoHoy", () => {
  // El Enviado del pre-call escribe solo F (sin AG).
  const fase = (id: string, extra: Partial<EntradaLog>, despues = "VIDEOS CONF") =>
    e({ operacion: id, columna: "F", campo: "precall", antes: "", despues, motivo: "PRE_CALL · Enviado", ...extra });

  it("leads con una fase mandada hoy (no deshecha), por hoja + fila + nombre", () => {
    const log = [
      fase("a", { fecha: "24/09/2026 09:00:00", lead: "Ana Pérez" }),
      fase("b", { fecha: "23/09/2026 18:00:00", fila: 6, lead: "Ayer" }), // otro día
      ...op("c", { fecha: "24/09/2026 09:10:00", fila: 7, lead: "Beto" }), // otra columna (S)
      fase("d", { fecha: "24/09/2026 09:20:00", fila: 8, lead: "Caro" }),
      e({ operacion: "e", fecha: "24/09/2026 09:30:00", fila: 8, lead: "Caro", columna: "F", campo: "precall", antes: "VIDEOS CONF", despues: "", motivo: "Deshacer: PRE_CALL · Enviado" }),
    ];
    const hoy = precallEnviadoHoy(operacionesDeHoy(log, "Closer 1", AHORA));
    // Dos claves por envío: la de la fila del log y la de respaldo (nombre + el F que se escribió).
    expect([...hoy].sort()).toEqual([claveFaseHoy("Closer 1", 5, "ana perez"), claveFaseHoyPorF("Closer 1", "ana perez", "videos conf")].sort());
    // El motor la busca con el nombre de la fila: mayúsculas y tildes no importan.
    expect(hoy.has(claveFaseHoy("Closer 1", 5, "ANA PÉREZ"))).toBe(true);
    expect(hoy.has(claveFaseHoy("Closer 1", 5, "Otro lead"))).toBe(false);
  });

  it("si alguien insertó u ordenó filas, el lead se reconoce por nombre + el F escrito hoy (no por la fila del log)", () => {
    const log = [fase("a", { fecha: "24/09/2026 10:00:00", fila: 10, lead: "Juan Pérez" })];
    const hoy = precallEnviadoHoy(operacionesDeHoy(log, "Closer 1", AHORA));
    // Ahora está en la fila 11: la clave con la fila ya no sirve, la de respaldo sí (con el F de hoy).
    expect(hoy.has(claveFaseHoy("Closer 1", 11, "Juan Pérez"))).toBe(false);
    expect(hoy.has(claveFaseHoyPorF("Closer 1", "JUAN PEREZ", "Videos Conf"))).toBe(true);
    // Un homónimo con otro F (o el mismo lead con F cambiado después) no.
    expect(hoy.has(claveFaseHoyPorF("Closer 1", "Juan Pérez", "DOLORES"))).toBe(false);
    // Ni el mismo nombre en otra hoja.
    expect(hoy.has(claveFaseHoyPorF("Closer 2", "Juan Pérez", "VIDEOS CONF"))).toBe(false);
  });

  it("precallEnviadoHoyEnLog: lo mismo para todas las hojas a la vez, directo del log (admin)", () => {
    const log = [
      fase("a", { fecha: "24/09/2026 09:00:00", lead: "Ana" }),
      fase("b", { fecha: "24/09/2026 09:05:00", hoja: "Closer 2", fila: 9, lead: "Beto" }),
      fase("c", { fecha: "23/09/2026 18:00:00", hoja: "Closer 2", fila: 10, lead: "Ayer" }), // otro día
      fase("d", { fecha: "24/09/2026 09:20:00", fila: 8, lead: "Caro" }),
      e({ operacion: "e", fecha: "24/09/2026 09:30:00", fila: 8, lead: "Caro", columna: "F", campo: "precall", antes: "VIDEOS CONF", despues: "", motivo: "Deshacer: PRE_CALL · Enviado" }),
    ];
    expect([...precallEnviadoHoyEnLog(log, AHORA)].sort()).toEqual(
      [
        claveFaseHoy("Closer 1", 5, "Ana"),
        claveFaseHoyPorF("Closer 1", "Ana", "VIDEOS CONF"),
        claveFaseHoy("Closer 2", 9, "Beto"),
        claveFaseHoyPorF("Closer 2", "Beto", "VIDEOS CONF"),
      ].sort(),
    );
  });
});
