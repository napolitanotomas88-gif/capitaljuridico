import { describe, expect, it } from "vitest";
import type { Campo, FilaLead } from "@/lib/crm/sheets/columnas";
import { COLUMNAS } from "@/lib/crm/sheets/columnas";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import {
  MARCA_MANANA,
  resolverMarcaManana,
  accionPrecall,
  accionesDeFila,
  accionesDelDia,
  claveFaseHoy,
  claveFaseHoyPorF,
  compararOrden,
  indiceFase,
  numeroSeguimiento,
  precallTerminado,
  proximaAccion,
  type Accion,
  type ClaveOrden,
  type Grupo,
} from "@/lib/crm/motor/proxima-accion";

// "Hoy" para los tests: jueves 24/09/2026, 15:00 en Buenos Aires.
const AHORA = parsearFechaSheet("24/09/2026 15:00")!;

let contador = 0;
function fila(valores: Partial<Record<Campo, string>>): FilaLead {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  contador += 1;
  return {
    hoja: "Closer 1",
    numeroFila: contador + 1,
    // La llamada del pre-caller ya registrada como no efectiva: el pre-call sigue con las fases de siempre. Las pruebas de la
    // llamada (pedido de Tomás, 21/10/2026) pasan `llamadaPrecall: ""`.
    valores: { ...base, nombre: `Lead ${contador}`, telefono: "5491100000000", llamadaPrecall: "No efectiva", ...valores },
  };
}

const accion = (valores: Partial<Record<Campo, string>>, ahora = AHORA) => proximaAccion(fila(valores), ahora);
const precall = (valores: Partial<Record<Campo, string>>, ahora = AHORA, faseEnviadaHoy = false) =>
  accionPrecall(fila(valores), ahora, faseEnviadaHoy);
const boton = (a: Accion | null, id: string) => a?.botones.find((b) => b.id === id);

describe("numeroSeguimiento", () => {
  it.each([
    ["S3", 3],
    ["s1", 1],
    [" S5 ", 5],
    ["", 0],
    ["Hacer", 0],
    ["No hacer", 0],
  ])("%j → %i", (valor, esperado) => {
    expect(numeroSeguimiento(valor)).toBe(esperado);
  });
});

describe("descartes", () => {
  it("sin nombre", () => {
    expect(accion({ nombre: "  ", fechaCall: "25/09/2026 10:00" })).toBeNull();
  });
  it("fecha de call inválida", () => {
    expect(accion({ fechaCall: "mañana" })).toBeNull();
    expect(accion({ fechaCall: "" })).toBeNull();
  });
  it("call de hace más de 60 días", () => {
    expect(accion({ fechaCall: "01/07/2026 10:00", presentoAgenda1: "Si" })).toBeNull();
    expect(accion({ fechaCall: "26/07/2026 10:00", presentoAgenda1: "Si" })).not.toBeNull();
  });
  it("una reagenda reciente vuelve a mostrar una call vieja", () => {
    expect(
      accion({ fechaCall: "01/07/2026 10:00", presentoAgenda1: "No", fechaReagenda: "20/09/2026 10:00" }),
    ).not.toBeNull();
  });
  it("F = Olvidar, sin distinguir mayúsculas", () => {
    expect(accion({ fechaCall: "20/09/2026 10:00", precall: "OLVIDAR" })).toBeNull();
  });
  it("cerrados", () => {
    expect(accion({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Cerrado en llamada" })).toBeNull();
    expect(accion({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Cerrado en seguimiento" })).toBeNull();
  });
  it("V = Reagendó ya no se descarta: sigue la reunión nueva (AC)", () => {
    expect(accion({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Reagendó" })?.tipo).toBe("DEFINIR_SEGUIMIENTO");
  });
});

describe("pre-call: tarjeta aparte (decisión de Gero del 28/09/2026)", () => {
  const call = { fechaCall: "26/09/2026 10:00" }; // en dos días (sábado)

  it("sin arrancar → primero la llamada del pre-caller: ninguna fase para enviar (pedido de Tomás, 21/10/2026)", () => {
    const a = precall({ ...call, llamadaPrecall: "" });
    expect(a?.titulo).toBe("Llamar al lead");
    expect(a?.estado).toBe("Pre-call: falta la llamada del pre-caller");
    expect(a?.botones).toEqual([
      { id: "llamadaEfectiva", etiqueta: "Llamada efectiva", cambios: { llamadaPrecall: "Efectiva", precall: "DOLORES" }, principal: true },
      { id: "llamadaNoEfectiva", etiqueta: "Llamada no efectiva", cambios: { llamadaPrecall: "No efectiva" } },
    ]);
  });

  it("sin arrancar y llamada no efectiva → primera fase, con el botón Enviado", () => {
    const a = precall({ ...call, llamadaPrecall: "No efectiva" });
    expect(a?.tipo).toBe("PRE_CALL");
    expect(a?.grupo).toBe("precall");
    expect(a?.titulo).toBe("Enviar fase: CONF + DECISORES");
    expect(a?.estado).toBe("Pre-call: sin arrancar");
    expect(a?.fecha).toEqual(parsearFechaSheet("26/09/2026 10:00"));
    expect(a?.botones).toEqual([{ id: "enviado", etiqueta: "Enviado", cambios: { precall: "CONF + DECISORES" }, principal: true }]);
  });

  it("llamada del pre-caller (pedido de Tomás, 21/10/2026): primeros botones mientras AI está vacía y la reunión no pasó", () => {
    const ids = (v: Partial<Record<Campo, string>>, ahora?: Date) => precall({ ...call, llamadaPrecall: "", ...v }, ahora)?.botones.map((b) => b.id);
    expect(ids({})).toEqual(["llamadaEfectiva", "llamadaNoEfectiva"]);
    // Un pre-call que ya venía mandando fases también espera la llamada (no efectiva → sigue desde donde iba)
    expect(ids({ precall: "VIDEOS CONF" })).toEqual(["llamadaEfectiva", "llamadaNoEfectiva"]);
    expect(precall({ ...call, llamadaPrecall: "", precall: "VIDEOS CONF" })?.estado).toBe("Pre-call: VIDEOS CONF · falta la llamada del pre-caller");
    expect(precall({ ...call, llamadaPrecall: "No efectiva", precall: "VIDEOS CONF" })?.titulo).toBe("Enviar fase: DOLORES");
    expect(ids({ llamadaPrecall: "No efectiva" })).toEqual(["enviado"]);
    expect(ids({ llamadaPrecall: "Efectiva", precall: "DOLORES" })).toEqual(["enviado"]);
    // Con la reunión ya pasada no hay tarjeta de pre-call (26/10/2026)
    expect(precall({ ...call, llamadaPrecall: "" }, parsearFechaSheet("27/09/2026 10:00")!)).toBeNull();
  });

  it("llamada efectiva: da por mandadas las fases anteriores y queda solo Hecho - link a call; no efectiva: todas las fases", () => {
    const efectiva = (fase: string) => precall({ ...call, llamadaPrecall: "", precall: fase })!.botones.find((b) => b.id === "llamadaEfectiva")!.cambios;
    expect(efectiva("")).toEqual({ llamadaPrecall: "Efectiva", precall: "DOLORES" });
    expect(efectiva("VIDEOS CONF")).toEqual({ llamadaPrecall: "Efectiva", precall: "DOLORES" });
    // Si ya iba en DOLORES no se toca F (no retrocede)
    expect(efectiva("DOLORES")).toEqual({ llamadaPrecall: "Efectiva" });
    const despues = precall({ ...call, ...efectiva("") })!;
    expect(despues.titulo).toBe("Enviar fase: Hecho - link a call");
    const noEfectiva = precall({ ...call, llamadaPrecall: "No efectiva" })!;
    expect(noEfectiva.titulo).toBe("Enviar fase: CONF + DECISORES");
  });

  it("la fase siguiente, sin distinguir mayúsculas", () => {
    expect(precall({ ...call, precall: "CONF + DECISORES" })?.titulo).toBe("Enviar fase: VIDEOS CONF");
    expect(precall({ ...call, precall: "videos conf" })?.titulo).toBe("Enviar fase: DOLORES");
    expect(precall({ ...call, precall: "Dolores" })?.titulo).toBe("Enviar fase: Hecho - link a call");
  });

  it("un valor desconocido en F arranca desde la primera fase y avisa", () => {
    const a = precall({ ...call, precall: "NO RESPONDE" });
    expect(a?.titulo).toBe("Enviar fase: CONF + DECISORES");
    expect(a?.estado).toBe("Pre-call: NO RESPONDE");
    expect(a?.avisos).toEqual(['Pre-call con un valor desconocido: "NO RESPONDE"']);
  });

  it("afuera: F = Hecho u Olvidar (sin mayúsculas, tildes ni espacios alrededor), V cerrado, sin nombre, fecha inválida o fuera de la ventana", () => {
    expect(precall({ ...call, precall: "Hecho - link a call" })).toBeNull();
    expect(precall({ ...call, precall: "  HECHO - LINK A CALL " })).toBeNull();
    expect(precall({ ...call, precall: "olvidar" })).toBeNull();
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Cerrado en llamada" })).toBeNull();
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "cerrado en seguimiento" })).toBeNull();
    expect(precall({ ...call, nombre: " " })).toBeNull();
    expect(precall({ fechaCall: "mañana" })).toBeNull();
    expect(precall({ fechaCall: "01/07/2026 10:00", presentoAgenda1: "Si", situacion: "Broke" })).toBeNull();
    // Con la reunión ya pasada tampoco hay pre-call (pedido de Tomás, 26/10/2026)
    expect(precall({ fechaCall: "26/07/2026 10:00", presentoAgenda1: "Si", situacion: "Broke" })).toBeNull();
  });

  it("pre-call solo mientras la reunión no pasó (pedido de Tomás, 26/10/2026); con una reagenda futura entra aunque S = No hacer", () => {
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Broke", seguimientoPost1: "No hacer" })).toBeNull();
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "No hacer", precall: "DOLORES" })).toBeNull();
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "No hacer", precall: "DOLORES", fechaReagenda: "27/09/2026 10:00" })?.tipo).toBe("PRE_CALL");
    // La acción principal de esos leads no existe: solo queda la de pre-call.
    expect(accion({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Broke", seguimientoPost1: "No hacer" })).toBeNull();
  });

  it("sin límite por día: con una fase mandada hoy (o cualquier toque de hoy) la tarjeta sigue", () => {
    const a = precall({ ...call, precall: "CONF + DECISORES", ultimoToque: "24/09/2026 09:12:00" });
    expect(a?.titulo).toBe("Enviar fase: VIDEOS CONF");
    expect(precall({ ...call, precall: "CONF + DECISORES" }, AHORA, true)?.titulo).toBe("Enviar fase: VIDEOS CONF");
  });

  it("atrasado si faltan más fases (con Hecho) que días hasta la call contando hoy", () => {
    // Call en 3 días (27/09): quedan 4 días (hoy incluido) y faltan 4 fases.
    expect(precall({ fechaCall: "27/09/2026 10:00" })?.atrasado).toBe(false);
    // Call en 2 días: quedan 3 días y faltan 4.
    expect(precall(call)?.atrasado).toBe(true);
    expect(precall({ ...call, precall: "CONF + DECISORES" })?.atrasado).toBe(false);
    // Call mañana: quedan 2 días.
    expect(precall({ fechaCall: "25/09/2026 10:00", precall: "VIDEOS CONF" })?.atrasado).toBe(false);
    expect(precall({ fechaCall: "25/09/2026 10:00", precall: "CONF + DECISORES" })?.atrasado).toBe(true);
    // Call hoy más tarde: queda 1 día (hoy).
    expect(precall({ fechaCall: "24/09/2026 18:00", precall: "DOLORES" })?.atrasado).toBe(false);
    expect(precall({ fechaCall: "24/09/2026 18:00", precall: "VIDEOS CONF" })?.atrasado).toBe(true);
    // Hoy a las 23:30 sigue siendo hoy en Buenos Aires (en UTC ya es mañana).
    expect(precall({ fechaCall: "24/09/2026 23:30", precall: "VIDEOS CONF" })?.atrasado).toBe(true);
  });

  it("\"enviada hoy\": si no está atrasado, el estado lo dice y la tarjeta sigue", () => {
    const hoy = (valores: Partial<Record<Campo, string>>) => precall(valores, AHORA, true);
    // Call en 3 días, faltan 3: alcanza con una por día desde mañana.
    const a = hoy({ fechaCall: "27/09/2026 10:00", precall: "CONF + DECISORES" });
    expect(a?.estado).toBe("CONF + DECISORES enviada hoy · la siguiente puede esperar a mañana");
    expect(a?.atrasado).toBe(false);
    expect(a?.titulo).toBe("Enviar fase: VIDEOS CONF");
    // Call mañana y faltan 2 (DOLORES y Hecho): no está atrasado, pero la siguiente va hoy.
    expect(hoy({ fechaCall: "25/09/2026 10:00", precall: "VIDEOS CONF" })?.estado).toBe("VIDEOS CONF enviada hoy · la siguiente también va hoy");
    // La call es hoy: el link va hoy.
    expect(hoy({ fechaCall: "24/09/2026 18:00", precall: "DOLORES" })?.estado).toBe("DOLORES enviada hoy · la siguiente también va hoy");
    // Atrasado: el estado de siempre (y el badge Atrasado).
    const atrasado = hoy({ fechaCall: "25/09/2026 10:00", precall: "CONF + DECISORES" });
    expect(atrasado?.atrasado).toBe(true);
    expect(atrasado?.estado).toBe("Pre-call: CONF + DECISORES");
    // Un valor desconocido no dice "enviada hoy".
    expect(hoy({ fechaCall: "27/09/2026 10:00", precall: "NO RESPONDE" })?.estado).toBe("Pre-call: NO RESPONDE");
  });

  it("listo por hoy (decisión de Gero del 28/09/2026): fase mandada hoy y la siguiente puede esperar a mañana", () => {
    const hoy = (valores: Partial<Record<Campo, string>>) => precall(valores, AHORA, true);
    // Call en 3 días, faltan 3 (VIDEOS CONF, DOLORES, Hecho): alcanza con una por día desde mañana.
    const lista = hoy({ fechaCall: "27/09/2026 10:00", precall: "CONF + DECISORES" });
    expect(lista?.listoPorHoy).toBe(true);
    expect(lista?.atrasado).toBe(false);
    // El título y el botón no cambian: si quiere, manda la siguiente igual.
    expect(lista?.titulo).toBe("Enviar fase: VIDEOS CONF");
    expect(lista?.botones).toEqual([{ id: "enviado", etiqueta: "Enviado", cambios: { precall: "VIDEOS CONF" }, principal: true }]);
    expect(lista?.estado).toBe("CONF + DECISORES enviada hoy · la siguiente puede esperar a mañana");
    // Sin una fase mandada hoy, es pendiente.
    expect(precall({ fechaCall: "27/09/2026 10:00", precall: "CONF + DECISORES" })?.listoPorHoy).toBe(false);
    // "La siguiente también va hoy" (no alcanza con una por día desde mañana): sigue pendiente.
    expect(hoy({ fechaCall: "25/09/2026 10:00", precall: "VIDEOS CONF" })?.listoPorHoy).toBe(false);
    expect(hoy({ fechaCall: "24/09/2026 18:00", precall: "DOLORES" })?.listoPorHoy).toBe(false);
    // Atrasado (faltan más fases que días): pendiente aunque hoy se haya mandado una. Con la call pasada ya no hay tarjeta.
    expect(hoy({ fechaCall: "25/09/2026 10:00", precall: "CONF + DECISORES" })?.listoPorHoy).toBe(false);
    expect(hoy({ fechaCall: "22/09/2026 10:00", precall: "VIDEOS CONF" })).toBeNull();
    // Un valor desconocido en F o sin arrancar: no se sabe qué se mandó, pendiente.
    expect(hoy({ fechaCall: "27/09/2026 10:00", precall: "NO RESPONDE" })?.listoPorHoy).toBe(false);
    expect(hoy({ fechaCall: "27/09/2026 10:00" })?.listoPorHoy).toBe(false);
    // Con la reagenda como referencia: también.
    expect(hoy({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "30/09/2026 11:00", precall: "CONF + DECISORES" })?.listoPorHoy).toBe(true);
  });

  it("bandera roja (pedido de Tomás, 25/10/2026): es solo una marca del equipo (circulito de la tarjeta), sin aviso ni botones", () => {
    const con = precall({ ...call, llamadaPrecall: "No efectiva", banderaRoja: "Si" })!;
    expect(con.avisos).toEqual([]);
    expect(con.botones.map((b) => b.id)).toEqual(["enviado"]);
  });


  it("las acciones principales nunca son listas por hoy", () => {
    expect(accion({ fechaCall: "24/09/2026 10:00" })?.listoPorHoy).toBe(false);
    expect(accion({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No" })?.listoPorHoy).toBe(false);
    expect(accion({ fechaCall: "22/09/2026 10:00", presentoAgenda1: "Si", situacion: "Broke", seguimientoPost1: "S1" })?.listoPorHoy).toBe(false);
  });

  it("la call ya pasó: la tarjeta de pre-call se va aunque falten fases (pedido de Tomás, 26/10/2026)", () => {
    expect(precall({ fechaCall: "22/09/2026 10:00", precall: "VIDEOS CONF", presentoAgenda1: "Si", situacion: "Quiere pensarlo", seguimientoPost1: "S1" })).toBeNull();
    expect(precall({ fechaCall: "24/09/2026 14:59" })).toBeNull();
    expect(precall({ fechaCall: "24/09/2026 15:01", llamadaPrecall: "" })?.estado).toBe("Pre-call: falta la llamada del pre-caller");
    // Aunque se haya mandado una fase hoy.
    expect(precall({ fechaCall: "22/09/2026 10:00", precall: "VIDEOS CONF" }, AHORA, true)).toBeNull();
  });


  it("fecha de referencia: la reagenda (AC) futura si el flujo la usa; si no, la call (D)", () => {
    const t = (texto: string) => parsearFechaSheet(texto)!;
    // No-show reagendado con T vacía.
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "26/09/2026 11:00" })?.fecha).toEqual(t("26/09/2026 11:00"));
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "26/09 11 hs" })?.fecha).toEqual(t("26/09/2026 11:00"));
    // V = Reagendó de un lead que vino.
    // (su referencia es la call, que ya pasó: sin pre-call)
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Reagendó", fechaReagenda: "26/09/2026 11:00", precall: "DOLORES" })).toBeNull();
    // AC que ya pasó: la call (D), que también pasó: sin pre-call.
    expect(precall({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "23/09/2026 11:00" })).toBeNull();
    // El flujo no usa AC (vino y V no es Reagendó; o T ya contestada; o R vacío): la call.
    for (const extra of [
      { presentoAgenda1: "Si", situacion: "Broke" },
      { presentoAgenda1: "No", presentoReagenda: "Si" },
      { presentoAgenda1: "" },
    ]) {
      expect(precall({ fechaCall: "25/09/2026 10:00", fechaReagenda: "26/09/2026 11:00", ...extra })?.fecha).toEqual(t("25/09/2026 10:00"));
    }
    // El flujo usaría AC pero no se puede leer: la call, con aviso.
    const ilegible = precall({ fechaCall: "25/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "coordinar con Ivonne" });
    expect(ilegible?.fecha).toEqual(t("25/09/2026 10:00"));
    expect(ilegible?.avisos).toEqual(['La reagenda no tiene una fecha legible: "coordinar con Ivonne"']);
  });

  it("proximaAccion ya no devuelve PRE_CALL: con la call (o la reagenda) todavía futura no hay acción principal", () => {
    expect(accion(call)).toBeNull();
    expect(accion({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "26/09/2026 11:00" })?.grupo).toBe("noShow");
    expect(accion({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Reagendó", fechaReagenda: "26/09/2026 11:00" })?.tipo).toBe("DEFINIR_SEGUIMIENTO");
  });

  it("precallTerminado", () => {
    expect(precallTerminado("Hecho - link a call")).toBe(true);
    expect(precallTerminado(" hecho - link a call")).toBe(true);
    expect(precallTerminado("DOLORES")).toBe(false);
    expect(precallTerminado("")).toBe(false);
  });
});

describe("¿se presentó?", () => {
  it("call pasada y R vacío", () => {
    const a = accion({ fechaCall: "24/09/2026 10:00", precall: "Hecho - link a call" });
    expect(a?.tipo).toBe("SE_PRESENTO");
    expect(a?.grupo).toBe("sePresento");
    expect(a?.botones.map((b) => [b.id, b.cambios])).toEqual([
      ["si", { presentoAgenda1: "Si" }],
      ["no", { presentoAgenda1: "No" }],
    ]);
  });

  it("se muestra aunque se haya tocado hoy", () => {
    expect(accion({ fechaCall: "24/09/2026 10:00", ultimoToque: "24/09/2026 10:30:00" })?.tipo).toBe("SE_PRESENTO");
  });

  it("call de hace un minuto ya cuenta como pasada; la de dentro de un minuto todavía no tiene acción principal", () => {
    expect(accion({ fechaCall: "24/09/2026 14:59" })?.tipo).toBe("SE_PRESENTO");
    expect(accion({ fechaCall: "24/09/2026 15:01" })).toBeNull();
    expect(precall({ fechaCall: "24/09/2026 15:01" })?.tipo).toBe("PRE_CALL");
  });
});

describe("No-show: asistencia manual a la reagenda (03/10/2026)", () => {
  it.each(["", "S1", "S2", "S3", "S4", "S5"])("siempre permite registrar asistencia con S=%s, aun después del toque de hoy", (fupsNoShow) => {
    const a = accion({fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fupsNoShow, ultimoToque: "24/09/2026 10:00", precall: "Hecho - link a call"})!;
    expect(boton(a, "presentado-reagenda")?.cambios).toEqual({presentoReagenda: "Si"});
    expect(a.grupo).toBe("noShow");
    if (fupsNoShow) expect(boton(a, "enviado")).toBeUndefined();
  });
  it.each(["", "S1", "S2", "S3", "S4"])("ofrece el siguiente seguimiento sin saltear pasos con S=%s", (fupsNoShow) => {
    const a = accion({fechaCall: "10/09/2026 10:00", presentoAgenda1: "No", fupsNoShow})!;
    expect(boton(a, "enviado")?.cambios).toEqual({fupsNoShow: `S${numeroSeguimiento(fupsNoShow)+1}`});
    expect(boton(a, "presentado-reagenda")).toBeDefined();
  });
  it.each(["", "23/09/2026 10:00", "30/09/2026 10:00"])("AC=%s no activa preguntas ni saca el lead de No-show", (fechaReagenda) => {
    expect(accion({fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fechaReagenda, situacion:"Reagendó"})?.grupo).toBe("noShow");
  });
  it("marcar asistencia conserva R=No y la secuencia S, sale a Resultado y cuenta en el historial de ausentes", () => {
    const f = fila({fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"S3"});
    const cambios = boton(proximaAccion(f, AHORA), "presentado-reagenda")!.cambios;
    const siguiente = {...f, valores:{...f.valores, ...cambios}};
    expect(siguiente.valores.presentoAgenda1).toBe("No");
    expect(siguiente.valores.fupsNoShow).toBe("S3");
    expect(proximaAccion(siguiente, AHORA)?.tipo).toBe("RESULTADO");
  });
  it("No a la reagenda conserva pre-call, R y seguimientos y permanece en No-show", () => {
    const v = {fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"S3", precall:"Hecho - link a call"};
    const cambios = boton(accion(v), "no-presentado-reagenda")!.cambios;
    expect(cambios).toEqual({presentoReagenda:"No"});
    expect(accion({...v, ...cambios})?.grupo).toBe("noShow");
  });
  it("No hacer saca el no-show sin modificar el pre-call terminado", () => {
    expect(accion({fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"No hacer", precall:"Hecho - link a call"})).toBeNull();
    // Desde el 10/10/2026 Olvidar está siempre en No-show, también con el pre-call terminado
    expect(boton(accion({fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"S5", precall:"Hecho - link a call"}), "olvidar")?.cambios).toEqual({fupsNoShow:"No hacer", precall:"Olvidar"});
  });
  it("S5 permite No hacer sin cambiar pre-call ni asistencia", () => {
    const v = {fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"S5", precall:"Hecho - link a call"};
    expect(boton(accion(v), "no-hacer")?.cambios).toEqual({fupsNoShow:"No hacer"});
    expect(boton(accion({...v, fupsNoShow:"S4"}), "no-hacer")).toBeUndefined();
  });
  it.each(["", "VIDEOS CONF", "DOLORES"])("S5 habilita Olvidar con pre-call %s", (precall) => {
    const v = {fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"S5", precall};
    const cambios = boton(accion(v), "olvidar")!.cambios;
    expect(cambios).toEqual({fupsNoShow:"No hacer", precall:"Olvidar"});
    expect(proximaAccion(fila({...v, ...cambios}), AHORA)).toBeNull();
    expect(accionPrecall(fila({...v, ...cambios}), AHORA)).toBeNull();
  });
  // Pedido de Tomás (10/10/2026): Olvidar en cualquier momento del No-show (cancelan o bloquean antes del S5)
  it.each(["", "S1", "S2", "S3", "S4"])("antes de S5 (%s) también permite Olvidar y saca el lead de todo", (fupsNoShow) => {
    for (const precall of ["", "DOLORES", "Hecho - link a call"]) {
      const v = {fechaCall:"20/09/2026 10:00", presentoAgenda1:"No", fupsNoShow, precall};
      const a = accion(v);
      expect(a?.grupo).toBe("noShow");
      const cambios = boton(a, "olvidar")!.cambios;
      expect(cambios).toEqual({fupsNoShow:"No hacer", precall:"Olvidar"});
      expect(proximaAccion(fila({...v, ...cambios}), AHORA)).toBeNull();
      expect(accionPrecall(fila({...v, ...cambios}), AHORA)).toBeNull();
    }
  });
  it("Olvidar también en la tarjeta de no-show al día (seguimiento de hoy ya enviado)", () => {
    const a = accion({fechaCall:"23/09/2026 10:00", presentoAgenda1:"No", fupsNoShow:"S2"});
    expect(a?.titulo).toMatch(/Seguimiento al día/);
    expect(boton(a, "olvidar")).toBeDefined();
  });
});

describe("resultado (se presentó)", () => {
  const vino = (extra: Partial<Record<Campo, string>>) => accion({ presentoAgenda1: "Si", fechaCall: "22/09/2026 10:00", ...extra });

  it("V vacío → cargar resultado", () => {
    const a = vino({});
    expect(a?.tipo).toBe("RESULTADO");
    expect(a?.grupo).toBe("resultado");
    expect(a?.botones).toEqual([{ id: "resultado", etiqueta: "Cargar resultado", cambios: {}, pide: "situacion", principal: true }]);
  });

  it("R con S1…S4 viejos se trata como Si", () => {
    expect(accion({ presentoAgenda1: "S2", fechaCall: "22/09/2026 10:00" })?.tipo).toBe("RESULTADO");
  });

  it("V cargado y W vacío → definir seguimiento", () => {
    const a = vino({ situacion: "Quiere pensarlo" });
    expect(a?.tipo).toBe("DEFINIR_SEGUIMIENTO");
    expect(a?.estado).toBe("Resultado: Quiere pensarlo");
    expect(a?.botones.map((b) => b.cambios)).toEqual([{ seguimientoPost1: "Hacer" }, { seguimientoPost1: "Hacer" }, { seguimientoPost1: "No hacer" }]);
  });

  it("valores de V fuera del brief también piden seguimiento", () => {
    expect(vino({ situacion: "No es el momento" })?.tipo).toBe("DEFINIR_SEGUIMIENTO");
  });

  it("W = No hacer no muestra nada", () => {
    expect(vino({ situacion: "Broke", seguimientoPost1: "No hacer" })).toBeNull();
  });
});

describe("post-call", () => {
  const post = (extra: Partial<Record<Campo, string>>) =>
    accion({ presentoAgenda1: "Si", situacion: "Quiere pensarlo", seguimientoPost1: "Hacer", ...extra });

  it("S1 recién al día siguiente de la call", () => {
    expect(post({ fechaCall: "24/09/2026 10:00" })).toBeNull();
    const a = post({ fechaCall: "23/09/2026 10:00" });
    expect(a?.tipo).toBe("POST_CALL");
    expect(a?.titulo).toBe("Enviar S1");
    expect(a?.estado).toBe("Quiere pensarlo · seguimiento sin arrancar");
    expect(a?.botones.map((b) => b.id)).toEqual(["enviado", "coordinar", "cerro", "noHacer", "reagendo"]);
    expect(a?.botones[0].cambios).toEqual({ seguimientoPost1: "S1" });
  });

  it("botón Cerró escribe V y pide el cash", () => {
    const cerro = post({ fechaCall: "23/09/2026 10:00" })?.botones.find((b) => b.id === "cerro");
    expect(cerro).toEqual({ id: "cerro", etiqueta: "Cerró", cambios: { situacion: "Cerrado en seguimiento" }, pide: "cierre" });
  });

  it("uno por día, atrasado si va más de uno atrás", () => {
    expect(post({ fechaCall: "22/09/2026 10:00", seguimientoPost1: "S1" })?.titulo).toBe("Enviar S2");
    expect(post({ fechaCall: "22/09/2026 10:00", seguimientoPost1: "S1" })?.atrasado).toBe(false);
    expect(post({ fechaCall: "22/09/2026 10:00", seguimientoPost1: "S2" })).toBeNull();
    expect(post({ fechaCall: "20/09/2026 10:00", seguimientoPost1: "S1" })?.atrasado).toBe(true);
    expect(post({ fechaCall: "22/09/2026 10:00", seguimientoPost1: "S1", ultimoToque: "24/09/2026 11:00:00" })).toBeNull();
  });

  it("S1 en el momento si hoy se definió Hacer (AG de hoy)", () => {
    const a = post({ fechaCall: "22/09/2026 10:00", ultimoToque: "24/09/2026 11:00:00" });
    expect(a?.tipo).toBe("POST_CALL");
    expect(a?.titulo).toBe("Enviar S1");
  });

  it("Reagendó escribe V = Reagendó y pide la fecha (AC) y los datos (AB): nada en U ni X", () => {
    const esperado = { id: "reagendo", etiqueta: "Reagendó", cambios: { situacion: "Reagendó" }, pide: "situacion" };
    expect(boton(post({ fechaCall: "23/09/2026 10:00" }), "reagendo")).toEqual(esperado);
    // Aunque las columnas ocultas U y X tengan algo (datos viejos), el botón es el mismo.
    const conViejos = post({ fechaCall: "23/09/2026 10:00", presentoCall2: "Si", seguimientoPost2: "S1" });
    expect(boton(conViejos, "reagendo")).toEqual(esperado);
  });

  it("con S5 pide cerrar", () => {
    const a = post({ fechaCall: "19/09/2026 10:00", seguimientoPost1: "S5" });
    expect(a?.tipo).toBe("CERRAR_POST_CALL");
    expect(a?.botones.map((b) => b.id)).toEqual(["noHacer", "reagendo", "cerro"]);
  });

  it("sin LIMPIAR: un post-call viejo sin cerrar sigue en Post-call con el seguimiento que falta, atrasado", () => {
    const a = post({ fechaCall: "16/09/2026 10:00", seguimientoPost1: "S3" });
    expect(a?.tipo).toBe("POST_CALL");
    expect(a?.grupo).toBe("postCall");
    expect(a?.titulo).toBe("Enviar S4");
    expect(a?.estado).toBe("Quiere pensarlo · S3 enviado");
    expect(a?.atrasado).toBe(true);
    // Los mismos botones que la tarjeta al día: Enviado, Coordinar fecha, Cerró, No hacer y Reagendó.
    expect(a?.botones.map((b) => b.id)).toEqual(["enviado", "coordinar", "cerro", "noHacer", "reagendo"]);
    expect(a?.botones[0]).toEqual({ id: "enviado", etiqueta: "Enviado", cambios: { seguimientoPost1: "S4" }, principal: true });
    // Con un seguimiento mandado hoy no pide otro (uno por día); sin ninguno, el S1 sale igual.
    expect(post({ fechaCall: "16/09/2026 10:00", seguimientoPost1: "S3", ultimoToque: "24/09/2026 09:00:00" })).toBeNull();
    const s1 = post({ fechaCall: "01/09/2026 10:00", ultimoToque: "24/09/2026 09:00:00" });
    expect([s1?.tipo, s1?.titulo, s1?.atrasado]).toEqual(["POST_CALL", "Enviar S1", true]);
  });

  it("el seguimiento es siempre W: lo que tengan U y X (columnas ocultas) no cambia nada", () => {
    const base = { fechaCall: "22/09/2026 10:00", seguimientoPost1: "S1" };
    const sinViejos = post(base);
    expect(sinViejos?.titulo).toBe("Enviar S2");
    expect(sinViejos?.botones[0].cambios).toEqual({ seguimientoPost1: "S2" });
    for (const viejos of [{ presentoCall2: "Si" }, { seguimientoPost2: "S1" }, { seguimientoPost2: "No hacer" }, { presentoCall2: "No" }]) {
      expect(post({ ...base, ...viejos })).toEqual(sinViejos);
    }
    // Definir el seguimiento también es en W, aunque X tenga algo.
    const definir = accion({ presentoAgenda1: "Si", fechaCall: "22/09/2026 10:00", situacion: "Broke", seguimientoPost2: "S3" });
    expect(definir?.tipo).toBe("DEFINIR_SEGUIMIENTO");
    expect(definir?.botones.map((b) => b.cambios)).toEqual([{ seguimientoPost1: "Hacer" }, { seguimientoPost1: "Hacer" }, { seguimientoPost1: "No hacer" }]);
  });

  it("los días se cuentan desde la última reunión que ya pasó: AC si es legible, posterior a la call y ya pasó", () => {
    // Call de hace 14 días (desde ahí el S1 estaría atrasado); reunión reagendada ayer: S1 al día.
    const a = post({ fechaCall: "10/09/2026 10:00", fechaReagenda: "23/09/2026 10:00", seguimientoPost1: "Hacer" });
    expect(a?.tipo).toBe("POST_CALL");
    expect(a?.titulo).toBe("Enviar S1");
    expect(a?.atrasado).toBe(false);
    expect(a?.fecha).toEqual(parsearFechaSheet("23/09/2026 10:00"));
    expect(a?.botones[0].cambios).toEqual({ seguimientoPost1: "S1" });
    // AC anterior a la call o todavía futura: cuenta la call.
    for (const fechaReagenda of ["05/09/2026 10:00", "26/09/2026 10:00"]) {
      const b = post({ fechaCall: "10/09/2026 10:00", fechaReagenda, seguimientoPost1: "Hacer" });
      expect([b?.tipo, b?.titulo, b?.atrasado]).toEqual(["POST_CALL", "Enviar S1", true]);
      expect(b?.fecha).toEqual(parsearFechaSheet("10/09/2026 10:00"));
    }
  });
});

describe("Reagendó como motivo de no cierre", () => {
  it.each(["", "23/09/2026 11:00", "30/09/2026 11:00"])("no exige fecha ni abre otro resultado con AC=%s", (fechaReagenda) => {
    expect(accion({fechaCall:"20/09/2026 10:00", presentoAgenda1:"Si", situacion:"Reagendó", fechaReagenda})?.tipo).toBe("DEFINIR_SEGUIMIENTO");
  });
  it("con seguimiento habilitado sigue en Post-call", () => {
    expect(accion({fechaCall:"20/09/2026 10:00", presentoAgenda1:"Si", situacion:"Reagendó", seguimientoPost1:"Hacer"})?.grupo).toBe("postCall");
  });
});

describe("accionesDelDia", () => {
  const hecho = { precall: "Hecho - link a call" };

  it("ordena por prioridad de grupo y después por fecha; ya no hay grupo LIMPIAR (lo viejo queda en su columna, abajo)", () => {
    const filas = [
      fila({ ...hecho, fechaCall: "22/09/2026 10:00", presentoAgenda1: "Si", situacion: "Broke", seguimientoPost1: "S1" }), // post-call
      fila({ fechaCall: "27/09/2026 10:00" }), // pre-call, más lejos
      fila({ ...hecho, fechaCall: "17/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "S1" }), // no-show atrasado (antes LIMPIAR)
      fila({ ...hecho, fechaCall: "23/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "S1" }), // no-show al día
      fila({ fechaCall: "25/09/2026 10:00" }), // pre-call, más cerca
      fila({ ...hecho, fechaCall: "24/09/2026 09:00" }), // ¿se presentó?
      fila({ ...hecho, fechaCall: "23/09/2026 16:00", presentoAgenda1: "Si" }), // resultado
      fila({ fechaCall: "20/09/2026 10:00", precall: "Olvidar" }), // descartado
    ];
    const lista = accionesDelDia(filas, AHORA);
    expect(lista.map((i) => [i.accion.grupo, i.fila.valores.fechaCall, i.accion.atrasado])).toEqual([
      ["resultado", "23/09/2026 16:00", false],
      ["sePresento", "24/09/2026 09:00", false],
      ["precall", "25/09/2026 10:00", true], // faltan 4 fases en 2 días: el pre-call no cambia de orden
      ["precall", "27/09/2026 10:00", false],
      ["noShow", "23/09/2026 10:00", false],
      ["noShow", "17/09/2026 10:00", true],
      ["postCall", "22/09/2026 10:00", false],
    ]);
  });

  it("en No-show y Post-call: primero las al día (la fecha más vieja primero, con \"Terminó la secuencia\"), después las atrasadas de la más reciente a la más vieja", () => {
    const noShow = (fechaCall: string, fupsNoShow = "") => fila({ ...hecho, presentoAgenda1: "No", fechaCall, fupsNoShow });
    const post = (fechaCall: string, seguimientoPost1: string) =>
      fila({ ...hecho, presentoAgenda1: "Si", situacion: "Quiere pensarlo", fechaCall, seguimientoPost1 });
    const filas = [
      noShow("01/09/2026 10:00"), // S1 atrasado, el más frío
      noShow("24/09/2026 10:00"), // S1 al día (hoy)
      noShow("21/09/2026 10:00", "S1"), // S2 atrasado, el más caliente de los atrasados
      noShow("20/09/2026 10:00", "S5"), // Terminó la secuencia: va con los al día
      noShow("10/09/2026 10:00", "S2"), // S3 atrasado
      noShow("23/09/2026 10:00", "S1"), // S2 al día
      post("05/09/2026 10:00", "Hacer"), // S1 atrasado
      post("23/09/2026 10:00", "Hacer"), // S1 al día
      post("20/09/2026 10:00", "S1"), // S2 atrasado
      post("19/09/2026 10:00", "S5"), // Terminó la secuencia
      post("22/09/2026 10:00", "S1"), // S2 al día
    ];
    const lista = accionesDelDia(filas, AHORA);
    const columna = (grupo: string) =>
      lista.filter((i) => i.accion.grupo === grupo).map((i) => [i.fila.valores.fechaCall.slice(0, 5), i.accion.titulo, i.accion.atrasado]);
    expect(columna("noShow")).toEqual([
      ["20/09", "Terminó la secuencia", false],
      ["23/09", "Enviar S2", false],
      ["24/09", "Enviar S1", false],
      ["21/09", "Enviar S2", true],
      ["10/09", "Enviar S3", true],
      ["01/09", "Enviar S1", true],
    ]);
    expect(columna("postCall")).toEqual([
      ["19/09", "Terminó la secuencia: ¿no hacer, reagendó o cerró?", false],
      ["22/09", "Enviar S2", false],
      ["23/09", "Enviar S1", false],
      ["20/09", "Enviar S2", true],
      ["05/09", "Enviar S1", true],
    ]);
    // Los grupos siguen en su orden: todo el no-show antes que el post-call.
    expect(lista.map((i) => i.accion.grupo)).toEqual([...Array(6).fill("noShow"), ...Array(5).fill("postCall")]);
  });

  it("compararOrden: lo atrasado solo baja en No-show y Post-call; en los otros grupos manda la fecha", () => {
    const t = (texto: string) => parsearFechaSheet(texto)!.getTime();
    const clave = (grupo: Grupo, fecha: string, atrasado: boolean): ClaveOrden => ({ grupo, atrasado, tiempo: t(fecha) });
    // No-show: una al día va antes que una atrasada aunque sea más nueva; entre atrasadas, la más reciente primero.
    expect(compararOrden(clave("noShow", "24/09/2026 10:00", false), clave("noShow", "01/09/2026 10:00", true))).toBeLessThan(0);
    expect(compararOrden(clave("postCall", "20/09/2026 10:00", true), clave("postCall", "05/09/2026 10:00", true))).toBeLessThan(0);
    expect(compararOrden(clave("postCall", "22/09/2026 10:00", false), clave("postCall", "23/09/2026 10:00", false))).toBeLessThan(0);
    // Pre-call: la más vieja primero aunque las dos estén atrasadas (sin cambios).
    expect(compararOrden(clave("precall", "10/09/2026 10:00", true), clave("precall", "20/09/2026 10:00", true))).toBeLessThan(0);
    expect(compararOrden(clave("precall", "20/09/2026 10:00", true), clave("precall", "25/09/2026 10:00", false))).toBeLessThan(0);
    // El grupo manda sobre todo: un no-show atrasado va antes que un post-call al día.
    expect(compararOrden(clave("noShow", "01/09/2026 10:00", true), clave("postCall", "23/09/2026 10:00", false))).toBeLessThan(0);
  });

  it("un lead puede estar en Pre-call y en otra columna a la vez (dos tarjetas)", () => {
    // No-show con la reagenda por delante: pre-call (de la reagenda) y seguimiento de no-show a la vez
    const f = fila({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "", precall: "CONF + DECISORES", fechaReagenda: "27/09/2026 10:00" });
    const lista = accionesDelDia([f], AHORA);
    expect(lista.map((i) => [i.accion.tipo, i.accion.grupo, i.fila.numeroFila])).toEqual([
      ["PRE_CALL", "precall", f.numeroFila],
      ["NO_SHOW", "noShow", f.numeroFila],
    ]);
    // Cada tarjeta con su botón: tocar una no toca la otra.
    expect(lista.map((i) => i.accion.botones[0].cambios)).toEqual([{ precall: "VIDEOS CONF" }, { fupsNoShow: "S1" }]);
  });

  it("en la columna Pre-call, la call más próxima primero; las que ya pasaron no están (26/10/2026)", () => {
    const filas = [
      fila({ fechaCall: "27/09/2026 10:00" }),
      fila({ fechaCall: "10/09/2026 10:00", presentoAgenda1: "Si", situacion: "Broke", seguimientoPost1: "No hacer", precall: "DOLORES" }),
      fila({ fechaCall: "25/09/2026 10:00", precall: "DOLORES" }),
      fila({ fechaCall: "22/09/2026 10:00", presentoAgenda1: "Si", situacion: "Fee", seguimientoPost1: "No hacer" }),
    ];
    const precalls = accionesDelDia(filas, AHORA).filter((i) => i.accion.grupo === "precall");
    expect(precalls.map((i) => [i.fila.valores.fechaCall, i.accion.atrasado])).toEqual([
      ["25/09/2026 10:00", false],
      ["27/09/2026 10:00", false],
    ]);
  });


  it("\"enviada hoy\" sale del contexto del día (Log App), por hoja + fila + nombre", () => {
    const f = fila({ fechaCall: "27/09/2026 10:00", precall: "CONF + DECISORES" });
    const clave = claveFaseHoy(f.hoja, f.numeroFila, f.valores.nombre.toUpperCase());
    expect(accionesDeFila(f, AHORA, { precallHoy: new Set([clave]) })[0].estado).toBe(
      "CONF + DECISORES enviada hoy · la siguiente puede esperar a mañana",
    );
    expect(accionesDeFila(f, AHORA, { precallHoy: new Set([claveFaseHoy(f.hoja, f.numeroFila, "otro")]) })[0].estado).toBe(
      "Pre-call: CONF + DECISORES",
    );
    expect(accionesDeFila(f, AHORA)[0].estado).toBe("Pre-call: CONF + DECISORES");
  });

  it("un lead que cambió de fila (alguien insertó u ordenó filas) sigue listo por hoy si tiene el F que se le escribió hoy", () => {
    // Enviado hoy en la fila 10 (F: CONF + DECISORES → VIDEOS CONF), call dentro de 5 días.
    const enLaFila10 = { hoja: "Closer 1", fila: 10, lead: "Juan Pérez", fase: "VIDEOS CONF" };
    const dia = {
      precallHoy: new Set([
        claveFaseHoy(enLaFila10.hoja, enLaFila10.fila, enLaFila10.lead),
        claveFaseHoyPorF(enLaFila10.hoja, enLaFila10.lead, enLaFila10.fase),
      ]),
    };
    const movido: FilaLead = { ...fila({ nombre: "Juan Pérez", fechaCall: "29/09/2026 10:00", precall: "VIDEOS CONF" }), numeroFila: 11 };
    const [pre] = accionesDeFila(movido, AHORA, dia);
    expect([pre.tipo, pre.titulo, pre.listoPorHoy, pre.estado]).toEqual([
      "PRE_CALL",
      "Enviar fase: DOLORES",
      true,
      "VIDEOS CONF enviada hoy · la siguiente puede esperar a mañana",
    ]);
    // Un homónimo con otro F no queda listo (no es el lead al que se le mandó la fase).
    const homonimo: FilaLead = { ...fila({ nombre: "Juan Pérez", fechaCall: "29/09/2026 10:00", precall: "CONF + DECISORES" }), numeroFila: 30 };
    expect(accionesDeFila(homonimo, AHORA, dia)[0].listoPorHoy).toBe(false);
    // Sin la clave de respaldo (solo la fila del log), el lead movido volvía a pendiente.
    const soloFila = { precallHoy: new Set([claveFaseHoy(enLaFila10.hoja, enLaFila10.fila, enLaFila10.lead)]) };
    expect(accionesDeFila(movido, AHORA, soloFila)[0].listoPorHoy).toBe(false);
  });

  it("después de Enviado (F = fase siguiente y la operación en el log de hoy), la tarjeta vuelve lista por hoy", () => {
    // No-show reagendado para dentro de 5 días, pre-call sin arrancar: pendiente (no atrasada).
    let f = fila({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "S1", fechaReagenda: "29/09/2026 10:00" });
    const [antes] = accionesDelDia([f], AHORA);
    expect([antes.accion.tipo, antes.accion.titulo, antes.accion.listoPorHoy, antes.accion.atrasado]).toEqual([
      "PRE_CALL",
      "Enviar fase: CONF + DECISORES",
      false,
      false,
    ]);
    // Enviado: F cambia y "Log App" dice que hoy se mandó una fase de este lead.
    f = { ...f, valores: { ...f.valores, ...antes.accion.botones.find((b) => b.id === "enviado")!.cambios } };
    const dia = { precallHoy: new Set([claveFaseHoy(f.hoja, f.numeroFila, f.valores.nombre)]) };
    expect(accionesDelDia([f], AHORA, dia).map((i) => [i.accion.tipo, i.accion.titulo, i.accion.listoPorHoy, i.accion.atrasado])).toEqual([
      ["PRE_CALL", "Enviar fase: VIDEOS CONF", true, false],
      ["NO_SHOW", "Enviar S2", false, false],
    ]);
    // Mañana (sin otra fase mandada) vuelve a ser pendiente: la lista por hoy es solo de hoy.
    const manana = parsearFechaSheet("25/09/2026 09:00")!;
    expect(accionesDelDia([f], manana).map((i) => [i.accion.listoPorHoy, i.accion.atrasado])).toEqual([[false, false], [false, true]]);
  });

  it("una fase del pre-call mandada hoy no frena los seguimientos (el Enviado del pre-call no escribe AG)", () => {
    // No-show de ayer con S1 mandado ayer: hoy toca S2. Se manda una fase (solo F, sin AG).
    let f = fila({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No", fupsNoShow: "S1", ultimoToque: "23/09/2026 11:00:00", fechaReagenda: "27/09/2026 10:00" });
    const [pre] = accionesDeFila(f, AHORA);
    expect(pre.tipo).toBe("PRE_CALL");
    f = { ...f, valores: { ...f.valores, ...pre.botones[0].cambios } };
    expect(accionesDeFila(f, AHORA).map((a) => [a.tipo, a.titulo])).toEqual([
      ["PRE_CALL", "Enviar fase: VIDEOS CONF"],
      ["NO_SHOW", "Enviar S2"],
    ]);
    // En cambio, un seguimiento mandado hoy (S + AG) sí espera a mañana.
    const conS2 = { ...f, valores: { ...f.valores, fupsNoShow: "S2", ultimoToque: "24/09/2026 14:00:00" } };
    expect(accionesDeFila(conS2, AHORA).map((a) => a.tipo)).toEqual(["PRE_CALL", "NO_SHOW"]);
  });
});

describe("indiceFase", () => {
  it("toma la fase por su nombre, sin distinguir mayúsculas; vacío = no arrancó", () => {
    expect(indiceFase("")).toEqual({ indice: -1, conocido: true });
    expect(indiceFase("dolores")).toEqual({ indice: 2, conocido: true });
    expect(indiceFase("cualquier cosa")).toEqual({ indice: -1, conocido: false });
  });

  it("un valor viejo de EQUIVALENCIAS_FASE cuenta como su fase equivalente", () => {
    const equivalencias = { CONF: "CONF + DECISORES", Videos: "VIDEOS CONF" };
    expect(indiceFase("conf", equivalencias)).toEqual({ indice: 0, conocido: true });
    expect(indiceFase("Videos", equivalencias)).toEqual({ indice: 1, conocido: true });
    // Las fases actuales se siguen leyendo igual.
    expect(indiceFase("DOLORES", equivalencias)).toEqual({ indice: 2, conocido: true });
  });
});


describe("Archivar no-show con pre-call incompleto", () => {
  it("caso Raúl: con la call pasada el pre-call incompleto ya no queda colgado; con la reagenda por delante, No hacer habilita Olvidar", () => {
    const pasada = fila({fechaCall:"20/09/2026 10:00", precall:"DOLORES", presentoAgenda1:"No", fupsNoShow:"No hacer"});
    expect(accionPrecall(pasada, AHORA)).toBeNull();
    expect(proximaAccion(pasada, AHORA)).toBeNull();
    const f = fila({fechaCall:"20/09/2026 10:00", precall:"DOLORES", presentoAgenda1:"No", fupsNoShow:"No hacer", fechaReagenda:"27/09/2026 10:00"});
    const cambios = boton(accionPrecall(f, AHORA), "olvidar")!.cambios;
    expect(cambios).toEqual({precall:"Olvidar"});
    const actualizado = {...f, valores:{...f.valores,...cambios}};
    expect(accionPrecall(actualizado, AHORA)).toBeNull();
    expect(proximaAccion(actualizado, AHORA)).toBeNull();
  });

  it("no permite archivar desde pre-call a quien vino a la reagenda", () => {
    expect(boton(accionPrecall(fila({precall:"DOLORES", presentoAgenda1:"No", fupsNoShow:"No hacer", presentoReagenda:"Si"}), AHORA), "olvidar")).toBeUndefined();
  });
});

// Pedido de Tomás (11/10/2026): "Coordinar fecha" guarda en AH el día del próximo seguimiento de No-show y Post-call
describe("seguimiento con fecha acordada (AH)", () => {
  const post = (extra: Partial<Record<Campo, string>>) =>
    accion({ presentoAgenda1: "Si", situacion: "Quiere pensarlo", seguimientoPost1: "S1", fechaCall: "20/09/2026 10:00", ...extra });
  const ns = (extra: Partial<Record<Campo, string>>) => accion({ presentoAgenda1: "No", fechaCall: "20/09/2026 10:00", fupsNoShow: "S1", ...extra });
  const boton = (a: ReturnType<typeof accion>, id: string) => a?.botones.find((b) => b.id === id);

  it("sin fecha acordada todo sigue igual: Coordinar fecha pide el día y ningún botón escribe AH", () => {
    const a = post({});
    expect(a?.atrasado).toBe(true);
    expect(boton(a, "coordinar")).toEqual({ id: "coordinar", etiqueta: "Coordinar fecha", cambios: {}, pide: "seguimiento" });
    for (const b of a!.botones) expect(b.cambios).not.toHaveProperty("proximoSeguimiento");
    const n = ns({});
    expect(boton(n, "coordinar")?.pide).toBe("seguimiento");
    for (const b of n!.botones) expect(b.cambios).not.toHaveProperty("proximoSeguimiento");
  });
  it("con la fecha más adelante espera plegada (listo por hoy), no está atrasada y lleva la fecha acordada", () => {
    for (const a of [post({ proximoSeguimiento: "28/09/2026 00:00:00" }), ns({ proximoSeguimiento: "28/09/2026 00:00:00" })]) {
      expect(a?.listoPorHoy).toBe(true);
      expect(a?.atrasado).toBe(false);
      expect(a?.fecha).toEqual(parsearFechaSheet("28/09/2026 00:00"));
      expect(a?.estado).toContain("próximo seguimiento el 28/09");
    }
    // También aunque hoy ya se haya tocado (el Enviado de hoy deja AH en mañana)
    expect(post({ proximoSeguimiento: "25/09/2026 00:00:00", ultimoToque: "24/09/2026 11:00:00", seguimientoPost1: "S2" })?.listoPorHoy).toBe(true);
  });
  it("el día acordado vuelve a su columna; si pasa sin hacerse, queda atrasada", () => {
    const hoy = post({ proximoSeguimiento: "24/09/2026 00:00:00" });
    expect([hoy?.grupo, hoy?.titulo, hoy?.listoPorHoy, hoy?.atrasado]).toEqual(["postCall", "Enviar S2", false, false]);
    expect(hoy?.estado).toContain("próximo seguimiento: hoy");
    const pasada = ns({ proximoSeguimiento: "22/09/2026 00:00:00" });
    expect([pasada?.grupo, pasada?.titulo, pasada?.atrasado]).toEqual(["noShow", "Enviar S2", true]);
  });
  it("con fecha acordada manda la fecha, no la cuenta de días: sale aunque esté 'al día'", () => {
    // Un post-call de ayer con S1 enviado está al día (no habría tarjeta); con AH de hoy, sale.
    const aldia = { fechaCall: "23/09/2026 10:00", seguimientoPost1: "S1" };
    expect(post(aldia)).toBeNull();
    expect(post({ ...aldia, proximoSeguimiento: "24/09/2026 00:00:00" })?.titulo).toBe("Enviar S2");
  });
  it("Enviado con fecha acordada que ya llegó deja AH en mañana (la pone el servidor); el S5 la borra", () => {
    expect(boton(post({ proximoSeguimiento: "24/09/2026 00:00:00" }), "enviado")?.cambios).toEqual({ seguimientoPost1: "S2", proximoSeguimiento: MARCA_MANANA });
    expect(boton(ns({ proximoSeguimiento: "22/09/2026 00:00:00" }), "enviado")?.cambios).toEqual({ fupsNoShow: "S2", proximoSeguimiento: MARCA_MANANA });
    expect(resolverMarcaManana({ fupsNoShow: "S2", proximoSeguimiento: MARCA_MANANA }, AHORA)).toEqual({ fupsNoShow: "S2", proximoSeguimiento: "25/09/2026 00:00:00" });
    // Pasada la medianoche, con el reloj del servidor: mañana de verdad
    expect(resolverMarcaManana({ proximoSeguimiento: MARCA_MANANA }, parsearFechaSheet("25/09/2026 00:05")!)).toEqual({ proximoSeguimiento: "26/09/2026 00:00:00" });
    expect(resolverMarcaManana({ fupsNoShow: "S2" }, AHORA)).toEqual({ fupsNoShow: "S2" });
    expect(boton(ns({ fupsNoShow: "S4", proximoSeguimiento: "24/09/2026 00:00:00" }), "enviado")?.cambios).toEqual({ fupsNoShow: "S5", proximoSeguimiento: "" });
  });
  it("lo que saca al lead de la secuencia borra AH; No se presentó a la reagenda la conserva", () => {
    const a = post({ proximoSeguimiento: "28/09/2026 00:00:00" });
    for (const id of ["cerro", "noHacer", "reagendo"]) expect(boton(a, id)?.cambios.proximoSeguimiento).toBe("");
    const n = ns({ proximoSeguimiento: "28/09/2026 00:00:00" });
    expect(boton(n, "olvidar")?.cambios).toEqual({ fupsNoShow: "No hacer", precall: "Olvidar", proximoSeguimiento: "" });
    expect(boton(n, "presentado-reagenda")?.cambios).toEqual({ presentoReagenda: "Si", proximoSeguimiento: "" });
    expect(boton(n, "no-presentado-reagenda")?.cambios).not.toHaveProperty("proximoSeguimiento");
  });
  it("una fecha ilegible en AH avisa, se comporta como sin fecha y el Enviado la borra (no pasa a 'fecha acordada')", () => {
    const a = post({ proximoSeguimiento: "el martes" });
    expect(a?.avisos.join(" ")).toContain("no se entiende");
    expect(a?.listoPorHoy).toBe(false);
    expect(a?.atrasado).toBe(true);
    expect(boton(a, "enviado")?.cambios).toEqual({ seguimientoPost1: "S2", proximoSeguimiento: "" });
  });
  it("Enviado con la fecha acordada todavía por llegar la respeta (le escribió hoy y coordinó otro día)", () => {
    expect(boton(post({ proximoSeguimiento: "28/09/2026 00:00:00" }), "enviado")?.cambios).toEqual({ seguimientoPost1: "S2" });
    expect(boton(ns({ proximoSeguimiento: "28/09/2026 00:00:00" }), "enviado")?.cambios).toEqual({ fupsNoShow: "S2" });
  });
  it("una fecha acordada estira la ventana de 60 días: el lead no se pierde antes de ese día", () => {
    const viejo = { presentoAgenda1: "Si", situacion: "Quiere pensarlo", seguimientoPost1: "S1", fechaCall: "20/07/2026 10:00" };
    expect(accion(viejo)).toBeNull();
    const conFecha = accion({ ...viejo, proximoSeguimiento: "30/09/2026 00:00:00" });
    expect([conFecha?.grupo, conFecha?.listoPorHoy]).toEqual(["postCall", true]);
    // El día acordado vuelve
    expect(accion({ ...viejo, proximoSeguimiento: "30/09/2026 00:00:00" }, parsearFechaSheet("30/09/2026 10:00")!)?.listoPorHoy).toBe(false);
    // El pre-call no se estira
    expect(precall({ ...viejo, precall: "", proximoSeguimiento: "30/09/2026 00:00:00" })).toBeNull();
  });
  it("la tarjeta guarda la fecha de la call o reunión (fechaReunion) además de la acordada", () => {
    const a = post({ proximoSeguimiento: "28/09/2026 00:00:00" });
    expect(a?.fechaReunion).toEqual(parsearFechaSheet("20/09/2026 10:00"));
    expect(post({})?.fechaReunion).toBeUndefined();
  });
  it("¿Hacer seguimiento? ofrece Hacer · Coordinar fecha (W = Hacer + el día)", () => {
    const a = accion({ presentoAgenda1: "Si", situacion: "Quiere pensarlo", fechaCall: "24/09/2026 10:00" });
    expect(a?.tipo).toBe("DEFINIR_SEGUIMIENTO");
    expect(boton(a, "hacer-coordinar")).toEqual({ id: "hacer-coordinar", etiqueta: "Hacer · Coordinar fecha", cambios: { seguimientoPost1: "Hacer" }, pide: "seguimiento" });
    // Con W = Hacer y el día coordinado, espera el S1 hasta esa fecha
    const despues = accion({ presentoAgenda1: "Si", situacion: "Quiere pensarlo", fechaCall: "24/09/2026 10:00", seguimientoPost1: "Hacer", proximoSeguimiento: "29/09/2026 00:00:00" });
    expect([despues?.titulo, despues?.listoPorHoy]).toEqual(["Enviar S1", true]);
  });
});
