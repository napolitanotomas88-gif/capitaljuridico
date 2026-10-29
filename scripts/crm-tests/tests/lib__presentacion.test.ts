import { describe, expect, it } from "vitest";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { accionPrecall, accionesDeFila } from "@/lib/crm/motor/proxima-accion";
import { COLUMNAS, type Campo, type FilaLead } from "@/lib/crm/sheets/columnas";
import { armarItem, callsDelDiaDe, digitosWhatsApp, estadoDeFila, urlChat, urlWhatsApp } from "@/lib/crm//presentacion";

const AHORA = parsearFechaSheet("24/09/2026 15:00")!;

function fila(valores: Partial<Record<Campo, string>>): FilaLead {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  return { hoja: "Closer 1", numeroFila: 7, valores: { ...base, nombre: "Juan Carlos Gómez", telefono: "+54 9 11 5555-1234", llamadaPrecall: "No efectiva", ...valores } };
}

describe("urlWhatsApp", () => {
  it("wa.me con solo dígitos y sin texto (la app no sugiere mensajes)", () => {
    expect(urlWhatsApp("+54 9 11 5555-1234")).toBe("https://wa.me/5491155551234");
    expect(urlWhatsApp("(011) 15-5555-1234")).toBe("https://wa.me/0111555551234");
  });
});

describe("urlChat (pedido de Tomás, 19/10/2026)", () => {
  it("2Chat desde el número del closer de la pestaña, con el teléfono del lead en dígitos", () => {
    const espacio = "https://app.2chat.io/live-chat/STE00000000-0000-4000-8000-000000000001";
    expect(urlChat("Closer 1", "+54 9 358 000-0001")).toEqual({ url: `${espacio}/WA-WAN00000000-0000-4000-8000-000000000001-5493580000001`, es2Chat: true });
    expect(urlChat("Closer 2", "5491100000031").url).toBe(`${espacio}/WA-WAN00000000-0000-4000-8000-000000000002-5491100000031`);
    expect(urlChat("Closer 3", "5491100000032").url).toBe(`${espacio}/WA-WAN00000000-0000-4000-8000-000000000003-5491100000032`);
    expect(urlChat("Closer 4", "+54 9 11 0000-0022").url).toBe(`${espacio}/WA-WAN00000000-0000-4000-8000-000000000004-5491100000022`);
    // Un lead de Chile en la pestaña de Brenda: el número queda como está (el agregado del 9 es solo para Argentina)
    expect(urlChat("Closer 5", "+56 9 0000 0001").url).toBe(`${espacio}/WA-WAN00000000-0000-4000-8000-000000000005-56900000001`);
  });
  it("a un celular argentino cargado sin el 9 se lo agrega (así lo identifica WhatsApp); otros países quedan igual", () => {
    expect(digitosWhatsApp("+54 358 482-3217")).toBe("5493580000001");
    expect(digitosWhatsApp("+54 9 358 000-0001")).toBe("5493580000001");
    expect(digitosWhatsApp("+57 315 2886633")).toBe("573152886633");
    expect(digitosWhatsApp("+591 72011000")).toBe("59172011000");
    expect(urlChat("Closer 1", "+54 11 5133-7517").url).toMatch(/-5491100000033$/);
  });
  it("una pestaña sin número de 2Chat sigue con WhatsApp", () => {
    expect(urlChat("Gero-Xavi Rejunte", "+54 9 11 5555-1234")).toEqual({ url: "https://wa.me/5491155551234", es2Chat: false });
  });
});

describe("armarItem", () => {
  it("arma un item serializable con hora y WhatsApp, sin mensaje", () => {
    const f = fila({ fechaCall: "26/09/2026 10:30", linkCall: "https://meet/abc" });
    const accion = accionPrecall(f, AHORA)!;
    const item = armarItem(f, accion, AHORA);

    expect(item.clave).toBe("Closer 1:7");
    expect(item.id).toBe("Closer 1:7|PRE_CALL");
    expect(item.identidad).toEqual({
      hoja: "Closer 1",
      numeroFila: 7,
      nombre: "Juan Carlos Gómez",
      telefono: "+54 9 11 5555-1234",
      fechaCall: "26/09/2026 10:30",
    });
    // Solo los campos escribibles, para armar `esperado` (sin U ni X, que la app no usa).
    expect(Object.keys(item.valores)).toHaveLength(18);
    expect(item.valores.precall).toBe("");
    expect(item.valores).not.toHaveProperty("telefono");
    expect(item.valores).not.toHaveProperty("presentoCall2");
    expect(item.valores).not.toHaveProperty("seguimientoPost2");
    expect(item.accion.tipo).toBe("PRE_CALL");
    expect(item.accion.fecha).toBe("2026-09-26T13:30:00.000Z");
    expect(item.horaCall).toBe("sáb 26/09 10:30");
    expect(item).not.toHaveProperty("mensaje");
    expect(item.accion).not.toHaveProperty("plantilla");
    expect(item.urlChat).toBe("https://app.2chat.io/live-chat/STE00000000-0000-4000-8000-000000000001/WA-WAN00000000-0000-4000-8000-000000000001-5491155551234");
    expect(item.chat2Chat).toBe(true);
    // Pre-call de una reunión que todavía no empezó: se puede cancelar
    expect(item.cancelable).toBe(true);
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });

  it("las dos tarjetas de un lead comparten `clave` (el lead) y tienen `id` distinto", () => {
    // No-show con la reagenda por delante: pre-call de la reagenda + seguimiento de no-show
    const f = fila({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "27/09/2026 10:00" });
    const items = accionesDeFila(f, AHORA).map((a) => armarItem(f, a, AHORA));
    expect(items.map((i) => [i.clave, i.id])).toEqual([
      ["Closer 1:7", "Closer 1:7|PRE_CALL"],
      ["Closer 1:7", "Closer 1:7|NO_SHOW"],
    ]);
  });

  it("ninguna tarjeta carga texto en WhatsApp (decisión de Gero del 28/09/2026: el texto lo decide el closer)", () => {
    const filas = [
      fila({ fechaCall: "26/09/2026 10:30" }), // pre-call al día
      fila({ fechaCall: "17/09/2026 15:00", presentoAgenda1: "No" }), // no-show (su pre-call ya no está: la call pasó)
      fila({ fechaCall: "24/09/2026 10:00", presentoAgenda1: "No", precall: "Hecho - link a call" }), // S1 del no-show de hoy
      fila({ fechaCall: "24/09/2026 10:00", precall: "Hecho - link a call" }), // ¿se presentó?
      fila({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Quiere pensarlo", seguimientoPost1: "S1", precall: "Hecho - link a call" }), // post-call
    ];
    const items = filas.flatMap((f) => accionesDeFila(f, AHORA).map((a) => armarItem(f, a, AHORA)));
    expect(items.map((i) => i.accion.tipo)).toEqual(["PRE_CALL", "NO_SHOW", "NO_SHOW", "SE_PRESENTO", "POST_CALL"]);
    for (const item of items) expect(item.urlChat).toMatch(/^https:\/\/app\.2chat\.io\/live-chat\/[^?]+-5491155551234$/);
    // Solo el pre-call de la reunión que todavía no pasó se puede cancelar
    expect(items.map((i) => i.cancelable)).toEqual([true, false, false, false, false]);
  });
});

describe("callsDelDiaDe", () => {
  let n = 0;
  const f = (valores: Partial<Record<Campo, string>>): FilaLead => ({ ...fila(valores), numeroFila: ++n + 1 });

  it("todas las calls de hoy (D o AC), con o sin acción, por hora", () => {
    const filas = [
      f({ nombre: "Tarde", fechaCall: "24/09/2026 18:00", precall: "Hecho - link a call" }), // pre-call hecho: sin acción
      f({ nombre: "Mañana temprano", fechaCall: "24/09/2026 09:00", presentoAgenda1: "Si", situacion: "Cerrado en llamada" }),
      f({ nombre: "Reagenda", fechaCall: "20/09/2026 10:00", presentoAgenda1: "No", fechaReagenda: "24/09 16 hs", precall: "DOLORES" }),
      f({ nombre: "Ayer", fechaCall: "23/09/2026 10:00" }),
      f({ nombre: "", fechaCall: "24/09/2026 10:00" }),
      f({ nombre: "Olvidado", fechaCall: "24/09/2026 12:00", precall: "Olvidar" }),
      // La call ya pasó y el pre-call no está terminado: manda la acción principal, no el pre-call.
      f({ nombre: "Pasó", fechaCall: "24/09/2026 11:00", precall: "DOLORES" }),
      // Más tarde, con el pre-call sin terminar y sin acción principal: el pre-call.
      f({ nombre: "Noche", fechaCall: "24/09/2026 20:00", precall: "VIDEOS CONF" }),
    ];
    const calls = callsDelDiaDe(filas, AHORA);
    expect(calls.map((c) => [c.nombre, c.hora, c.esReagenda, c.grupo, c.estado])).toEqual([
      ["Mañana temprano", "09:00", false, null, "Cerrado en llamada"],
      ["Pasó", "11:00", false, "sePresento", "La call ya pasó"],
      ["Olvidado", "12:00", false, null, "Olvidado"],
      ["Reagenda", "16:00", true, "noShow", "No-show · sin seguimiento"],
      ["Tarde", "18:00", false, null, "Pre-call: Hecho - link a call"],
      ["Noche", "20:00", false, "precall", "Pre-call: VIDEOS CONF"],
    ]);
    expect(calls[0].clave).toMatch(/^Closer 1:\d+$/);
    expect(calls[0].fechaISO).toBe("2026-09-24T12:00:00.000Z");
    expect(JSON.parse(JSON.stringify(calls))).toEqual(calls);
  });
});

describe("estadoDeFila", () => {
  const ahora = AHORA;
  const call = parsearFechaSheet("24/09/2026 10:00")!;
  const v = (valores: Partial<Record<Campo, string>>) => fila(valores).valores;
  it.each([
    [{ precall: "Olvidar" }, "Olvidado"],
    [{ situacion: "Cerrado en seguimiento" }, "Cerrado en seguimiento"],
    [{ presentoAgenda1: "Si", situacion: "Broke" }, "Resultado: Broke"],
    [{ presentoAgenda1: "No" }, "No se presentó"],
    [{ presentoAgenda1: "No", presentoReagenda: "No" }, "No vino a la reagenda"],
    [{ presentoAgenda1: "Si" }, "Se presentó"],
    [{}, "La call ya pasó"],
  ] as const)("%j → %s", (valores, esperado) => {
    expect(estadoDeFila(v(valores), call, ahora)).toBe(esperado);
  });
});

describe("tarjeta con fecha acordada", () => {
  it("muestra la hora de la call, no las 00:00 de la fecha acordada; la fecha de la acción es la acordada", () => {
    const f = fila({ fechaCall: "20/09/2026 10:00", presentoAgenda1: "Si", situacion: "Quiere pensarlo", seguimientoPost1: "S1", proximoSeguimiento: "28/09/2026 00:00:00" });
    const item = accionesDeFila(f, AHORA).map((a) => armarItem(f, a, AHORA)).find((i) => i.accion.grupo === "postCall")!;
    expect(item.horaCall).toBe("dom 20/09 10:00");
    expect(item.accion.fecha).toBe(parsearFechaSheet("28/09/2026 00:00")!.toISOString());
    expect(item.accion.fechaReunion).toBe(parsearFechaSheet("20/09/2026 10:00")!.toISOString());
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });
});
