import { describe, expect, it } from "vitest";
import type { Campo, FilaLead } from "@/lib/crm/sheets/columnas";
import { COLUMNAS } from "@/lib/crm/sheets/columnas";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { accionesDeFila, esLeadV2, type Accion } from "@/lib/crm/motor/proxima-accion";
import { PRECALLER, closerConPrecallV2, precallV2DesdePorHoja, precallV2Hojas } from "@/lib/crm/config/precallV2";
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
  it("un solo paso de llamada (hasta 2 seguidas): Llamada efectiva = pase; Llamada no efectiva = WhatsApp del pre-caller", () => {
    const [a] = v2({});
    expect(a.tipo).toBe("PRE_CALLER");
    expect(a.titulo).toBe("Llamar (hasta 2 veces seguidas)");
    expect(ids(a)).toEqual(["llamadaEfectiva", "llamadaNoEfectiva"]);
    expect(a.botones[0]).toMatchObject({
      pide: "pase",
      cambios: { contactoPrecaller: PRECALLER.llamadaEfectiva, confirmoPrecaller: "Si", estadoPrecaller: PRECALLER.pasado, precall: "CONF + DECISORES", llamadaPrecall: "Efectiva" },
    });
    expect(a.botones[1]).toMatchObject({ pide: "noEfectiva", cambios: { contactoPrecaller: PRECALLER.noAtendio2 } });
    // Un "No atendió 1ª" de la versión anterior cae en el mismo paso
    expect(v2({ contactoPrecaller: PRECALLER.noAtendio1 })[0].titulo).toBe("Llamar (hasta 2 veces seguidas)");
  });
  it("pre-call por chat (Gero, 7/11/2026): solo Decisores y Pre-call hecho; los follow-ups van en el desplegable (AS)", () => {
    for (const s of ["", "S1", "S2", "S3"]) {
      const [a] = v2({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: s });
      expect(a.titulo).toBe("Pre-call por chat");
      expect(a.etapaPrecaller).toBe("chat");
      expect(ids(a)).toEqual(["decisores", "pasarAlCloser"]);
    }
    const [a] = v2({ contactoPrecaller: PRECALLER.noAtendio2 });
    expect(a.botones[0].cambios).toEqual({ confirmoPrecaller: "Si" });
    expect(a.botones[1]).toMatchObject({ etiqueta: "Pre-call hecho", pide: "pase", cambios: { llamadaPrecall: "No efectiva", estadoPrecaller: PRECALLER.pasado } });
    // Con los decisores ya preguntados queda solo "Pre-call hecho"
    const [b] = v2({ contactoPrecaller: PRECALLER.noAtendio2, confirmoPrecaller: "Si", seguimientosPrecaller: "S2" });
    expect(ids(b)).toEqual(["pasarAlCloser"]);
    expect(b.estado).toContain("decisores preguntados");
    expect(b.estado).toContain("Follow-up 2");
  });
  it("Ultimátum (S4) sin respuesta: pasa a Reagendar o cancelar", () => {
    const [fin] = v2({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S4" });
    expect(fin.titulo).toBe("Sin respuesta al ultimátum: cancelar la reunión");
    expect(fin.etapaPrecaller).toBe("vencida");
    expect(fin.atrasado).toBe(true);
    expect(ids(fin)).toEqual(["pasarAlCloser", "sinRespuesta"]);
  });
  it("cada tarjeta cae en su columna del tablero del pre-caller (Gero, 7/11/2026)", () => {
    const etapa = (v: Parameters<typeof v2>[0], ahora?: Date) => v2(v, ahora)[0].etapaPrecaller;
    expect(etapa({})).toBe("llamar");
    expect(etapa({ contactoPrecaller: PRECALLER.llamadaEfectiva })).toBe("llamar");
    expect(etapa({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S2" })).toBe("chat");
    expect(etapa({ contactoPrecaller: PRECALLER.noAtendio2, confirmoPrecaller: "Si", decisoresPrecaller: PRECALLER.decideSolo })).toBe("chat");
    expect(etapa({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S4" })).toBe("vencida");
    expect(etapa({ contactoPrecaller: PRECALLER.porChat }, parsearFechaSheet("26/09/2026 12:00")!)).toBe("vencida");
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

describe("closer en v2: solo recordatorios", () => {
  const pasado = { estadoPrecaller: PRECALLER.pasado, precall: "CONF + DECISORES", llamadaPrecall: "Efectiva" };
  it("antes del día espera plegado; el día de la reunión: mañana → link 30 min → 10 min, y se va", () => {
    const [manana] = v2(pasado);
    expect(manana.tipo).toBe("RECORDATORIOS");
    expect(manana.titulo).toBe("Recordatorio: mañana del día de la reunión");
    expect(manana.listoPorHoy).toBe(true); // la reunión es el 26, hoy 24
    const elDia = parsearFechaSheet("26/09/2026 08:00")!;
    expect(v2(pasado, elDia)[0].listoPorHoy).toBe(false);
    expect(manana.botones[0].cambios).toEqual({ recordatorioPrecall: "1" });
    const [link] = v2({ ...pasado, recordatorioPrecall: "1" }, elDia);
    expect(link.titulo).toBe("Recordatorio: link de la reunión (30 min antes)");
    const [diez] = v2({ ...pasado, recordatorioPrecall: "2" }, elDia);
    expect(diez.titulo).toBe("Recordatorio: aviso 10 min antes");
    expect(diez.botones[0].cambios).toEqual({ recordatorioPrecall: "3", precall: "Hecho - link a call" });
    expect(v2({ ...pasado, recordatorioPrecall: "3", precall: "Hecho - link a call" }, elDia)).toEqual([]);
  });
  it("solo «Enviado»: sin llamada efectiva/no efectiva, fases de confirmación ni «Mandó LISTO»", () => {
    expect(v2(pasado)[0].botones.map((b) => b.id)).toEqual(["recordatorio"]);
  });
  it("después de la call, ¿Se presentó? es del closer", () => {
    const despues = parsearFechaSheet("26/09/2026 12:00")!;
    expect(v2({ ...pasado, recordatorioPrecall: "3", precall: "Hecho - link a call" }, despues).map((a) => a.tipo)).toEqual(["SE_PRESENTO"]);
  });
});

describe("formulario del pase", () => {
  const boton = { id: "pasarAlCloser", etiqueta: "Pase", pide: "pase" as const, cambios: { estadoPrecaller: PRECALLER.pasado } };
  it("exige facturación, situación y urgencia; las notas son opcionales", () => {
    expect(formularioPase(boton, { facturacion: "", situacion: "x", urgencia: "x", decisores: "Decide solo", notas: "" }).ok).toBe(false);
    const r = formularioPase(boton, { facturacion: " 5 a 10 mil ", situacion: "Solo, laboral", urgencia: "Alta", decisores: "Decide solo", notas: "" });
    expect(r).toEqual({
      ok: true,
      detalle: "Pasado al closer",
      cambios: { estadoPrecaller: PRECALLER.pasado, decisoresPrecaller: "Decide solo", facturacionConfirmada: "5 a 10 mil", situacionConfirmada: "Solo, laboral", urgenciaConfirmada: "Alta" },
    });
  });
  it("exige decisores", () => {
    expect(formularioPase(boton, { facturacion: "x", situacion: "x", urgencia: "x", decisores: "", notas: "" }).ok).toBe(false);
  });
  it("no deja fórmulas", () => {
    expect(formularioPase(boton, { facturacion: "=1+1", situacion: "x", urgencia: "x", decisores: "Decide solo", notas: "" }).ok).toBe(false);
  });
});

describe("encendido por closer (PRECALL_V2_CLOSERS)", () => {
  it("solo las pestañas de los closers elegidos pasan por el pre-caller; el resto sigue como siempre", () => {
    // fila() es de Closer 1 (Carlos)
    const soloMarcosNahuel = new Set(["Closer 2", "Closer 4"]);
    const carlos = accionesDeFila(fila({}), AHORA, { precallV2: true, precallV2Desde: DESDE, precallV2Hojas: soloMarcosNahuel });
    expect(carlos[0].tipo).toBe("PRE_CALL");
    const marcos = accionesDeFila({ ...fila({}), hoja: "Closer 2" }, AHORA, { precallV2: true, precallV2Desde: DESDE, precallV2Hojas: soloMarcosNahuel });
    expect(marcos[0].tipo).toBe("PRE_CALLER");
  });
  it("lee PRECALL_V2_CLOSERS sin importar mayúsculas, tildes ni apellido; vacía = todos", () => {
    const antes = process.env.PRECALL_V2_CLOSERS;
    try {
      process.env.PRECALL_V2_CLOSERS = " marcos , Nahuel ";
      expect([...(precallV2Hojas() ?? [])]).toEqual(["Closer 2", "Closer 4"]);
      expect(closerConPrecallV2("Marcos Carlomagno")).toBe(true);
      expect(closerConPrecallV2("Carlos Roletto")).toBe(false);
      delete process.env.PRECALL_V2_CLOSERS;
      expect(precallV2Hojas()).toBeNull();
      expect(closerConPrecallV2("Carlos Roletto")).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.PRECALL_V2_CLOSERS;
      else process.env.PRECALL_V2_CLOSERS = antes;
    }
  });
});

describe("closer que se suma después (PRECALL_V2_DESDE_POR_CLOSER, Gero 12/11/2026)", () => {
  const todos = new Set(["Closer 1", "Closer 2"]);
  // Carlos (Closer 1) se suma el viernes 25/09: su reunión del 26 entra, la del 24 (sin asistencia cargada) no.
  const porHoja = { "Closer 1": parsearFechaSheet("25/09/2026 00:00")! };
  const dia = { precallV2: true, precallV2Desde: DESDE, precallV2DesdePorHoja: porHoja, precallV2Hojas: todos };
  it("las reuniones del closer anteriores a su fecha siguen con él; las posteriores van al pre-caller", () => {
    expect(accionesDeFila(fila({ fechaCall: "24/09/2026 10:00" }), AHORA, dia).map((a) => a.tipo)).not.toContain("PRE_CALLER");
    expect(accionesDeFila(fila({}), AHORA, dia)[0].tipo).toBe("PRE_CALLER");
  });
  it("los demás closers siguen con la fecha general", () => {
    const marcos = { ...fila({ fechaCall: "24/09/2026 10:00" }), hoja: "Closer 2" };
    expect(accionesDeFila(marcos, AHORA, dia)[0].tipo).toBe("PRE_CALLER");
  });
  it("lee la variable por nombre de closer; una fecha ilegible no deja entrar a nadie de esa pestaña", () => {
    const antes = process.env.PRECALL_V2_DESDE_POR_CLOSER;
    try {
      process.env.PRECALL_V2_DESDE_POR_CLOSER = " Carlos Roletto = 2026-11-12T20:00:00-03:00 , Fulano=2026-01-01";
      expect(precallV2DesdePorHoja()).toEqual({ "Closer 1": new Date("2026-11-12T20:00:00-03:00") });
      process.env.PRECALL_V2_DESDE_POR_CLOSER = "carlos=mañana";
      const mapa = precallV2DesdePorHoja()!;
      expect(accionesDeFila(fila({}), AHORA, { ...dia, precallV2DesdePorHoja: mapa }).map((a) => a.tipo)).not.toContain("PRE_CALLER");
      delete process.env.PRECALL_V2_DESDE_POR_CLOSER;
      expect(precallV2DesdePorHoja()).toBeNull();
    } finally {
      if (antes === undefined) delete process.env.PRECALL_V2_DESDE_POR_CLOSER;
      else process.env.PRECALL_V2_DESDE_POR_CLOSER = antes;
    }
  });
});

describe("Reagendar o cancelar: seguimientos de reagenda (Gero, 11/11/2026)", () => {
  const chat = { contactoPrecaller: PRECALLER.noAtendio2 };
  it("con S5…S7 sigue en Reagendar o cancelar y el estado dice el seguimiento", () => {
    for (const s of ["S5", "S6", "S7"]) {
      const [a] = v2({ ...chat, seguimientosPrecaller: s });
      expect(a.etapaPrecaller).toBe("vencida");
    }
    expect(v2({ ...chat, seguimientosPrecaller: "S6" })[0].estado).toContain("Seguimiento 2 (reagenda)");
  });
  it("«No hacer» antes de la reunión deja AT = Liberado y el lead sale del tablero", () => {
    const [a] = v2({ ...chat, seguimientosPrecaller: "S4" });
    expect(a.noHacerPrecaller?.cambios).toEqual({ estadoPrecaller: PRECALLER.liberado });
    expect(v2({ ...chat, seguimientosPrecaller: "S5", estadoPrecaller: PRECALLER.liberado }).some((x) => x.tipo === "PRE_CALLER")).toBe(false);
  });
  it("«No hacer» con la reunión pasada hace lo mismo que Liberar", () => {
    const [a] = v2(chat, parsearFechaSheet("26/09/2026 12:00")!);
    expect(a.etapaPrecaller).toBe("vencida");
    expect(a.noHacerPrecaller?.cambios).toEqual(a.botones.find((b) => b.id === "liberar")?.cambios);
  });
  it("en Llamar y Pre-call por chat no hay «No hacer»", () => {
    expect(v2({})[0].noHacerPrecaller).toBeUndefined();
    expect(v2(chat)[0].noHacerPrecaller).toBeUndefined();
  });
});

describe("reagendado en Calendly antes del pase (Gero, 11/11/2026)", () => {
  // Lo que deja una reprogramación: R = No, AC = horario nuevo, T vacía
  const reag = { presentoAgenda1: "No", fechaReagenda: "29/09/2026 11:00:00" };
  it("sigue en el tablero del pre-caller, en el mismo paso y con el horario nuevo", () => {
    const [a] = v2({ contactoPrecaller: PRECALLER.noAtendio2, ...reag });
    expect(a.tipo).toBe("PRE_CALLER");
    expect(a.etapaPrecaller).toBe("chat");
    expect(a.fecha).toEqual(parsearFechaSheet("29/09/2026 11:00"));
    expect(v2({ ...reag })[0].etapaPrecaller).toBe("llamar");
    expect(v2({ contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S5", ...reag })[0].etapaPrecaller).toBe("vencida");
  });
  it("el closer no lo ve mientras no hay pase", () => {
    expect(v2({ contactoPrecaller: PRECALLER.noAtendio2, ...reag }).map((a) => a.tipo)).toEqual(["PRE_CALLER"]);
  });
  it("si la reunión nueva también pasa sin pase, queda para reagendar o liberar", () => {
    const [a] = v2({ contactoPrecaller: PRECALLER.noAtendio2, ...reag }, parsearFechaSheet("29/09/2026 12:00")!);
    expect(a.etapaPrecaller).toBe("vencida");
    expect(a.botones.some((b) => b.id === "liberar")).toBe(true);
  });
  it("una inasistencia cargada a mano sin reagenda sigue siendo del closer", () => {
    expect(v2({ contactoPrecaller: PRECALLER.noAtendio2, presentoAgenda1: "No" }, parsearFechaSheet("26/09/2026 12:00")!).map((a) => a.tipo)).not.toContain("PRE_CALLER");
  });
});
