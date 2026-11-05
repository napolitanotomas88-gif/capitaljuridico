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
// El encendido (PRECALL_V2_DESDE): el martes 22/09/2026. La call del lead (26/09) es posterior.
const DESDE = parsearFechaSheet("22/09/2026 00:00")!;
const v2 = (valores: Partial<Record<Campo, string>>, ahora = AHORA): Accion[] =>
  accionesDeFila(fila(valores), ahora, { precallV2: true, precallV2Desde: DESDE });
const ids = (a: Accion) => a.botones.map((b) => b.id);

describe("pre-call v2 (bandera)", () => {
  it("apagado, nada cambia: el lead nuevo sigue con la tarjeta de pre-call de siempre", () => {
    const [a] = accionesDeFila(fila({}), AHORA);
    expect(a.tipo).toBe("PRE_CALL");
    expect(a.titulo).toBe("Llamar al lead");
  });
  it("los leads que ya iban por el flujo viejo (F o AI con algo) lo terminan igual", () => {
    expect(esLeadV2(fila({ precall: "VIDEOS CONF" }).valores, DESDE)).toBe(false);
    expect(esLeadV2(fila({ llamadaPrecall: "Efectiva" }).valores, DESDE)).toBe(false);
    expect(v2({ precall: "VIDEOS CONF", llamadaPrecall: "No efectiva" })[0].tipo).toBe("PRE_CALL");
  });
});

describe("encendido: solo reuniones desde PRECALL_V2_DESDE", () => {
  // Reunión vieja (antes del encendido) con F y AI vacías y "¿Se presentó?" = Si: sigue con el closer (RESULTADO).
  const vieja = { fechaCall: "21/09/2026 10:00", presentoAgenda1: "Si" };
  it("una reunión anterior al encendido no es v2 y el closer conserva su resultado", () => {
    expect(esLeadV2(fila(vieja).valores, DESDE)).toBe(false);
    expect(v2(vieja).map((a) => a.tipo)).toEqual(["RESULTADO"]);
  });
  it("una reunión anterior sin asistencia cargada sigue con el pre-call de siempre (no con el pre-caller)", () => {
    expect(v2({ fechaCall: "21/09/2026 10:00" }).map((a) => a.tipo)).not.toContain("PRE_CALLER");
  });
  it("sin PRECALL_V2_DESDE ningún lead entra solo (solo los que ya tienen estado del pre-caller)", () => {
    expect(esLeadV2(fila({}).valores, null)).toBe(false);
    expect(esLeadV2(fila({ estadoPrecaller: PRECALLER.pasado }).valores, null)).toBe(true);
    expect(accionesDeFila(fila({}), AHORA, { precallV2: true })[0].tipo).toBe("PRE_CALL");
  });
  it("con ¿Se presentó? cargado a mano y sin pase, lo que sigue es del closer y no hay Liberar", () => {
    const despues = parsearFechaSheet("26/09/2026 12:00")!;
    const tipos = v2({ presentoAgenda1: "Si" }, despues).map((a) => a.tipo);
    expect(tipos).toEqual(["RESULTADO"]);
    const botones = v2({ presentoAgenda1: "No", estadoPrecaller: PRECALLER.pendiente }, despues).flatMap((a) => a.botones);
    expect(botones.some((b) => b.id === "liberar")).toBe(false);
  });
});

describe("tarjeta del pre-caller", () => {
  it("1ª llamada → 2ª llamada → escalera por chat; en las llamadas también puede confirmar por chat", () => {
    const [a] = v2({});
    expect(a.tipo).toBe("PRE_CALLER");
    expect(a.titulo).toBe("1ª llamada");
    expect(ids(a)).toEqual(["atendio", "noAtendio", "respondioChat"]);
    expect(a.botones[1].cambios).toEqual({ contactoPrecaller: PRECALLER.noAtendio1 });
    expect(a.botones[2].cambios).toEqual({ contactoPrecaller: PRECALLER.porChat, confirmoPrecaller: "Si" });
    const [segunda] = v2({ contactoPrecaller: PRECALLER.noAtendio1 });
    expect(segunda.titulo).toMatch(/^2ª llamada/);
    expect(segunda.botones[1].cambios).toEqual({ contactoPrecaller: PRECALLER.noAtendio2 });
  });
  it("escalera: ¿Pudiste leerme? → decisores → seguimiento de decisores → ultimátum → cancelar", () => {
    const titulos = ["", "S1", "S2", "S3"].map((s) => v2({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: s })[0]);
    expect(titulos.map((t) => t.titulo)).toEqual([
      "Chat: «¿Pudiste leerme?»",
      "Chat: preguntar por los decisores (2 h después)",
      "Chat: seguimiento de decisores",
      "Chat: ultimátum (confirmamos o liberamos)",
    ]);
    expect(titulos[3].botones[0].cambios).toEqual({ seguimientosPrecaller: "S4" });
    // En cualquier paso puede confirmar o reprogramar
    expect(ids(titulos[1])).toEqual(["seguimiento", "confirmoSolo", "confirmoDecisores", "confirmo", "reprograma"]);
    const [fin] = v2({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S4" });
    expect(fin.titulo).toBe("Sin respuesta al ultimátum: cancelar la reunión");
    expect(fin.atrasado).toBe(true);
    expect(ids(fin)).toContain("sinRespuesta");
  });
  it("la llamada efectiva no ofrece seguimientos de chat", () => {
    expect(ids(v2({ contactoPrecaller: PRECALLER.llamadaEfectiva })[0])).toEqual(["confirmoSolo", "confirmoDecisores", "reprograma"]);
  });
  it("por chat: confirmó → pregunta de decisores → recomendaciones y pase", () => {
    expect(v2({ contactoPrecaller: PRECALLER.porChat, confirmoPrecaller: "Si" })[0].titulo).toBe("Chat: preguntar por los decisores");
    const [pase] = v2({ contactoPrecaller: PRECALLER.porChat, confirmoPrecaller: "Si", decisoresPrecaller: PRECALLER.vienenDecisores });
    expect(pase.titulo).toBe("Chat: mandar las recomendaciones y pasar al closer");
    expect(pase.botones[0].pide).toBe("pase");
  });
  it("confirmó: pide decisores si faltan y después el pase (F, AI y estado)", () => {
    expect(v2({ contactoPrecaller: PRECALLER.llamadaEfectiva, confirmoPrecaller: PRECALLER.reprograma })[0].titulo).toBe("¿Vienen decisores?");
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
