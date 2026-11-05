import { describe, expect, it } from "vitest";
import type { Campo, FilaLead } from "@/lib/crm/sheets/columnas";
import { COLUMNAS } from "@/lib/crm/sheets/columnas";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { accionesDeFila, esLeadV2, type Accion } from "@/lib/crm/motor/proxima-accion";
import { PRECALLER } from "@/lib/crm/config/precallV2";
import { formularioPase } from "@/lib/crm/pantalla";

// "Hoy": jueves 24/09/2026, 15:00 en Buenos Aires. La call del lead, el sábado 26 a las 10:30.
const AHORA = parsearFechaSheet("24/09/2026 15:00")!;
const CALL = "26/09/2026 10:30";

function fila(valores: Partial<Record<Campo, string>>): FilaLead {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  return { hoja: "Closer 1", numeroFila: 10, valores: { ...base, nombre: "Lead", telefono: "5491100000000", fechaCall: CALL, ...valores } };
}
const v2 = (valores: Partial<Record<Campo, string>>, ahora = AHORA): Accion[] => accionesDeFila(fila(valores), ahora, { precallV2: true });
const ids = (a: Accion) => a.botones.map((b) => b.id);

describe("pre-call v2 (bandera)", () => {
  it("apagado, nada cambia: el lead nuevo sigue con la tarjeta de pre-call de siempre", () => {
    const [a] = accionesDeFila(fila({}), AHORA);
    expect(a.tipo).toBe("PRE_CALL");
    expect(a.titulo).toBe("Llamar al lead");
  });
  it("los leads que ya iban por el flujo viejo (F o AI con algo) lo terminan igual", () => {
    expect(esLeadV2(fila({ precall: "VIDEOS CONF" }).valores)).toBe(false);
    expect(esLeadV2(fila({ llamadaPrecall: "Efectiva" }).valores)).toBe(false);
    expect(v2({ precall: "VIDEOS CONF", llamadaPrecall: "No efectiva" })[0].tipo).toBe("PRE_CALL");
  });
});

describe("tarjeta del pre-caller", () => {
  it("1ª llamada → 2ª llamada → pre-call por chat", () => {
    const [a] = v2({});
    expect(a.tipo).toBe("PRE_CALLER");
    expect(a.titulo).toBe("1ª llamada");
    expect(a.botones.find((b) => b.id === "noAtendio")!.cambios).toEqual({ contactoPrecaller: PRECALLER.noAtendio1 });
    expect(v2({ contactoPrecaller: PRECALLER.noAtendio1 })[0].titulo).toBe("2ª llamada");
    const [chat] = v2({ contactoPrecaller: PRECALLER.noAtendio2 });
    expect(chat.titulo).toBe("Pre-call por chat");
    expect(chat.botones[0].cambios).toEqual({ contactoPrecaller: PRECALLER.porChat });
  });
  it("por chat: confirma con decisores, reprograma o sigue con S1, S2 y después 🔴", () => {
    const [a] = v2({ contactoPrecaller: PRECALLER.porChat });
    expect(ids(a)).toEqual(["confirmoSolo", "confirmoDecisores", "reprograma", "seguimiento"]);
    expect(a.botones[3].cambios).toEqual({ seguimientosPrecaller: "S1" });
    expect(v2({ contactoPrecaller: PRECALLER.porChat, seguimientosPrecaller: "S1" })[0].botones[3].cambios).toEqual({ seguimientosPrecaller: "S2" });
    const [tope] = v2({ contactoPrecaller: PRECALLER.porChat, seguimientosPrecaller: "S2" });
    expect(tope.atrasado).toBe(true);
    expect(ids(tope)).toContain("sinRespuesta");
  });
  it("la llamada efectiva no ofrece seguimientos de chat", () => {
    expect(ids(v2({ contactoPrecaller: PRECALLER.llamadaEfectiva })[0])).toEqual(["confirmoSolo", "confirmoDecisores", "reprograma"]);
  });
  it("confirmó: pide decisores si faltan y después el pase (F, AI y estado)", () => {
    expect(v2({ contactoPrecaller: PRECALLER.porChat, confirmoPrecaller: PRECALLER.reprograma })[0].titulo).toBe("¿Vienen decisores?");
    const [pase] = v2({ contactoPrecaller: PRECALLER.llamadaEfectiva, confirmoPrecaller: "Si", decisoresPrecaller: PRECALLER.decideSolo });
    expect(pase.titulo).toBe("Pasar al closer");
    expect(pase.botones[0]).toMatchObject({
      pide: "pase",
      cambios: { estadoPrecaller: PRECALLER.pasado, precall: "CONF + DECISORES", llamadaPrecall: "Efectiva" },
    });
    const [porChat] = v2({ contactoPrecaller: PRECALLER.porChat, confirmoPrecaller: "Si", decisoresPrecaller: PRECALLER.decideSolo });
    expect(porChat.botones[0].cambios.llamadaPrecall).toBe("No efectiva");
  });
  it("regla dura: sin pase, el closer no tiene nada (tampoco ¿Se presentó? cuando pasa la hora)", () => {
    const despues = parsearFechaSheet("26/09/2026 12:00")!;
    const acciones = v2({ contactoPrecaller: PRECALLER.porChat }, despues);
    expect(acciones.map((a) => a.tipo)).toEqual(["PRE_CALLER"]);
    expect(acciones[0].titulo).toMatch(/pasó sin pasar al closer/);
    expect(acciones[0].botones[0].cambios.estadoPrecaller).toBe(PRECALLER.liberado);
    expect(v2({ estadoPrecaller: PRECALLER.liberado, precall: "Olvidar", presentoAgenda1: "No", fupsNoShow: "No hacer" }, despues)).toEqual([]);
  });
});

describe("closer en v2", () => {
  it("después del pase arranca esperando el LISTO y sigue con el link (sin DOLORES)", () => {
    const [a] = v2({ estadoPrecaller: PRECALLER.pasado, precall: "CONF + DECISORES", llamadaPrecall: "Efectiva" });
    expect(a.tipo).toBe("PRE_CALL");
    expect(a.titulo).toBe("Esperar LISTO del video de pre-llamada");
    expect(a.botones.map((b) => [b.etiqueta, b.cambios.precall])).toEqual([["Mandó LISTO", "VIDEOS CONF"]]);
    const [link] = v2({ estadoPrecaller: PRECALLER.pasado, precall: "VIDEOS CONF", llamadaPrecall: "Efectiva" });
    expect(link.titulo).toBe("Enviar fase: Hecho - link a call");
    expect(v2({ estadoPrecaller: PRECALLER.pasado, precall: "Hecho - link a call", llamadaPrecall: "Efectiva" })).toEqual([]);
  });
  it("después de la call, ¿Se presentó? es del closer", () => {
    const despues = parsearFechaSheet("26/09/2026 12:00")!;
    const tipos = v2({ estadoPrecaller: PRECALLER.pasado, precall: "Hecho - link a call", llamadaPrecall: "Efectiva" }, despues).map((a) => a.tipo);
    expect(tipos).toEqual(["SE_PRESENTO"]);
  });
});

describe("formulario del pase", () => {
  const boton = { id: "pasarAlCloser", etiqueta: "Pase", pide: "pase" as const, cambios: { estadoPrecaller: PRECALLER.pasado } };
  it("exige facturación, situación y urgencia; las notas son opcionales", () => {
    expect(formularioPase(boton, { facturacion: "", situacion: "x", urgencia: "x", notas: "" }).ok).toBe(false);
    const r = formularioPase(boton, { facturacion: " 5 a 10 mil ", situacion: "Solo, laboral", urgencia: "Alta", notas: "" });
    expect(r).toEqual({
      ok: true,
      detalle: "Pasado al closer",
      cambios: { estadoPrecaller: PRECALLER.pasado, facturacionConfirmada: "5 a 10 mil", situacionConfirmada: "Solo, laboral", urgenciaConfirmada: "Alta" },
    });
  });
  it("no deja fórmulas", () => {
    expect(formularioPase(boton, { facturacion: "=1+1", situacion: "x", urgencia: "x", notas: "" }).ok).toBe(false);
  });
});
