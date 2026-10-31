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

describe("WhatsApp Web (pedido de Gero, 30/10/2026)", () => {
  it("abre el chat web con solo dígitos y sin texto precargado", () => {
    const url = new URL(urlWhatsApp("+54 9 11 5555-1234"));
    expect(url.origin).toBe("https://web.whatsapp.com");
    expect(url.pathname).toBe("/send");
    expect([...url.searchParams]).toEqual([["phone", "5491155551234"]]);
  });
  it.each(["Gero-Xavi Rejunte", "Closer 1", "Closer 2", "Closer 3", "Closer 4", "Closer 5", "Nueva pestaña"])(
    "%s usa WhatsApp Web sin depender de un número configurado en 2Chat",
    (hoja) => expect(urlChat(hoja, "+54 9 11 5555-1234")).toEqual({
      url: "https://web.whatsapp.com/send?phone=5491155551234", es2Chat: false,
    }),
  );
  it("normaliza celulares argentinos sin 9 y conserva otros países", () => {
    expect(digitosWhatsApp("+54 358 000-0001")).toBe("5493580000001");
    expect(digitosWhatsApp("+54 9 358 000-0001")).toBe("5493580000001");
    expect(urlChat("Closer 1", "+54 11 0000-0033").url).toBe("https://web.whatsapp.com/send?phone=5491100000033");
    expect(urlChat("Closer 5", "+56 9 0000 0001").url).toBe("https://web.whatsapp.com/send?phone=56900000001");
    expect(digitosWhatsApp("+57 300 0000000")).toBe("573000000000");
    expect(digitosWhatsApp("+591 70000000")).toBe("59170000000");
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
    expect(Object.keys(item.valores)).toHaveLength(19);
    expect(item.valores.precall).toBe("");
    expect(item.valores).not.toHaveProperty("telefono");
    expect(item.valores).not.toHaveProperty("presentoCall2");
    expect(item.valores).not.toHaveProperty("seguimientoPost2");
    expect(item.accion.tipo).toBe("PRE_CALL");
    expect(item.accion.fecha).toBe("2026-09-26T13:30:00.000Z");
    expect(item.horaCall).toBe("sáb 26/09 10:30");
    expect(item).not.toHaveProperty("mensaje");
    expect(item.accion).not.toHaveProperty("plantilla");
    expect(item.urlChat).toBe("https://web.whatsapp.com/send?phone=5491155551234");
    expect(item.chat2Chat).toBe(false);
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
    for (const item of items) expect(item.urlChat).toBe("https://web.whatsapp.com/send?phone=5491155551234");
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
