import { describe, expect, it } from "vitest";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { accionPrecall, proximaAccion } from "@/lib/crm/motor/proxima-accion";
import { COLUMNAS, type Campo, type FilaLead } from "@/lib/crm/sheets/columnas";
import { cambiosDeReprogramacion, elegirEventoReagenda, eventoAReemplazar, filaDeLaReagendaNueva, reemplazadaCancelable, notaCancelacion, filasDeLaReunion, linkConDatos, reunionActual, type EventoReagenda } from "@/lib/crm/calendlyReagenda";

// Reprogramar desde Calendly (pedido de Tomás, 19/10/2026)
const AHORA = parsearFechaSheet("19/10/2026 11:00")!;
let n = 10;
const fila = (v: Partial<Record<Campo, string>>): FilaLead => ({
  hoja: "Closer 3",
  numeroFila: n++,
  valores: { ...(Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>), nombre: "Laura", telefono: "+54 9 11 5555-1234", email: "laura@x.co", fechaCall: "20/10/2026 10:00:00", ...v },
});
const viejo = parsearFechaSheet("20/10/2026 10:00")!;
const nuevo = parsearFechaSheet("23/10/2026 15:30")!;

describe("reprogramación desde Calendly", () => {
  it("la reunión actual es la call, o la reagenda si no se presentó a la primera", () => {
    expect(reunionActual(fila({}))).toEqual(viejo);
    expect(reunionActual(fila({ presentoAgenda1: "No", fechaReagenda: "22/10/2026 09:00:00" }))).toEqual(parsearFechaSheet("22/10/2026 09:00"));
    expect(reunionActual(fila({ presentoAgenda1: "No", presentoReagenda: "Si", fechaReagenda: "22/10/2026 09:00:00" }))).toEqual(viejo);
  });
  it("encuentra la fila por mail o por los últimos 8 dígitos del teléfono y por la hora de la reunión (±10 min)", () => {
    const a = fila({}), otraHora = fila({ fechaCall: "21/10/2026 10:00:00" }), otro = fila({ email: "otro@x.co", telefono: "+54 9 11 4444-0000" });
    expect(filasDeLaReunion([a, otraHora, otro], { email: "LAURA@x.co", telefono: "" }, viejo)).toEqual([a]);
    expect(filasDeLaReunion([a, otro], { email: "", telefono: "1155551234" }, new Date(viejo.getTime() + 5 * 60_000))).toEqual([a]);
    expect(filasDeLaReunion([a], { email: "laura@x.co", telefono: "" }, new Date(viejo.getTime() + 20 * 60_000))).toEqual([]);
  });
  it("también reconoce la fila si Make ya le puso la fecha nueva en D (se adelantó al webhook)", () => {
    const movida = fila({ fechaCall: "23/10/2026 15:30:00" });
    expect(filasDeLaReunion([movida], { email: "laura@x.co", telefono: "" }, viejo)).toEqual([]);
    expect(filasDeLaReunion([movida], { email: "laura@x.co", telefono: "" }, viejo, nuevo)).toEqual([movida]);
    // pero no a quien ya se presentó
    expect(filasDeLaReunion([fila({ fechaCall: "23/10/2026 15:30:00", presentoAgenda1: "Si" })], { email: "laura@x.co", telefono: "" }, viejo, nuevo)).toEqual([]);
  });
  it("cambios: R = No, T vacía, AC = horario nuevo, AH = ese día y una nota en AB (sin pisar la anterior)", () => {
    const r = cambiosDeReprogramacion(fila({ datosReagenda: "pidió que lo llamen" }), viejo, nuevo, AHORA)!;
    expect(r.cambios).toEqual({
      presentoAgenda1: "No",
      presentoReagenda: "",
      fechaReagenda: "23/10/2026 15:30:00",
      proximoSeguimiento: "23/10/2026 00:00:00",
      datosReagenda: "Reprogramado en Calendly el 19/10: de 20/10 10:00 a 23/10 15:30.\npidió que lo llamen",
    });
    expect(Object.keys(r.esperado).sort()).toEqual(Object.keys(r.cambios).sort());
    expect(r.esperado.datosReagenda).toBe("pidió que lo llamen");
  });
  it("no toca a quien ya se presentó o cerró", () => {
    expect(cambiosDeReprogramacion(fila({ presentoAgenda1: "Si" }), viejo, nuevo, AHORA)).toBeNull();
    expect(cambiosDeReprogramacion(fila({ presentoAgenda1: "No", situacion: "Cerrado en llamada" }), viejo, nuevo, AHORA)).toBeNull();
  });
  it("después de aplicarla, el CRM toma la fecha nueva: pre-call para el 23/10 y el no-show espera hasta ese día", () => {
    const f = fila({ precall: "CONF + DECISORES" });
    const conCambios = { ...f, valores: { ...f.valores, ...cambiosDeReprogramacion(f, viejo, nuevo, AHORA)!.cambios } } as FilaLead;
    const pre = accionPrecall(conCambios, AHORA)!;
    expect(pre.fecha).toEqual(nuevo);
    const ns = proximaAccion(conCambios, AHORA)!;
    expect([ns.grupo, ns.listoPorHoy, ns.atrasado]).toEqual(["noShow", true, false]);
    // El día de la reunión nueva, la tarjeta de No-show vuelve para registrar si se presentó a la reagenda
    const ese = proximaAccion(conCambios, parsearFechaSheet("23/10/2026 17:00")!)!;
    expect(ese.listoPorHoy).toBe(false);
    expect(ese.botones.map((b) => b.id)).toContain("presentado-reagenda");
  });
});

describe("reagenda de una reunión que ya pasó (evento \"Reunión Consultiva - Reagenda <closer>\")", () => {
  const eventos: EventoReagenda[] = [
    { duenio: "u/carlos", nombreDuenio: "Carlos Roletto", url: "https://calendly.com/carlos-skyward/reunion-consultiva-reagenda-carlos", preguntaTelefono: 0 },
    { duenio: "u/marcos", nombreDuenio: "Marcos Carlomagno", url: "https://calendly.com/marcos-carlomagno/reunion-consultiva-reagenda-marcos", preguntaTelefono: null },
  ];
  it("elige el evento del anfitrión de la reunión que pasó o, si no, el del dueño de la pestaña", () => {
    expect(elegirEventoReagenda(eventos, "u/marcos", "Carlos Roletto")?.duenio).toBe("u/marcos");
    expect(elegirEventoReagenda(eventos, null, "Carlos Roletto")?.duenio).toBe("u/carlos");
    expect(elegirEventoReagenda(eventos, "u/otro", "Gero-Xavi Rejunte", "Gero-Xavi Rejunte")).toBeNull();
    // pestaña sin usuario asignado: el closer fijo de la pestaña
    expect(elegirEventoReagenda(eventos, null, "Closer 1", "Closer 1")?.duenio).toBe("u/carlos");
  });
  it("el link trae nombre, mail y (si el evento lo pregunta) el celular del lead", () => {
    const u = new URL(linkConDatos(eventos[0], fila({ nombre: "Laura Ortiz" })));
    expect([u.searchParams.get("name"), u.searchParams.get("email"), u.searchParams.get("a1")]).toEqual(["Laura Ortiz", "laura@x.co", "+5491155551234"]);
    expect(new URL(linkConDatos(eventos[1], fila({}))).searchParams.has("a1")).toBe(false);
  });

  const pasada = fila({ fechaCall: "17/10/2026 10:00:00" });
  const inv = { email: "laura@x.co", telefono: "" };
  it("toma la fila del lead con la reunión más reciente anterior al horario nuevo", () => {
    const vieja = fila({ fechaCall: "01/09/2026 10:00:00" });
    const r = filaDeLaReagendaNueva([vieja, pasada, fila({ email: "otro@x.co", telefono: "+54 9 11 4444-0000" })], inv, nuevo);
    expect("fila" in r && [r.fila, r.viejo]).toEqual([pasada, parsearFechaSheet("17/10/2026 10:00")]);
    // por teléfono, sin mail
    expect("fila" in filaDeLaReagendaNueva([pasada], { email: "", telefono: "+54 9 11 5555-1234" }, nuevo)).toBe(true);
  });
  it("no toca nada si ya estaba cargada (Calendly reintenta), si ya se presentó o si es ambiguo", () => {
    const yaCargada = fila({ fechaCall: "17/10/2026 10:00:00", presentoAgenda1: "No", fechaReagenda: "23/10/2026 15:30:00" });
    expect(filaDeLaReagendaNueva([yaCargada], inv, nuevo)).toEqual({ motivo: "la reagenda de laura@x.co ya estaba cargada", yaCargada: true });
    expect("motivo" in filaDeLaReagendaNueva([fila({ fechaCall: "17/10/2026 10:00:00", presentoAgenda1: "Si" })], inv, nuevo)).toBe(true);
    expect("motivo" in filaDeLaReagendaNueva([pasada, fila({ fechaCall: "17/10/2026 10:00:00" })], inv, nuevo)).toBe(true);
    expect("motivo" in filaDeLaReagendaNueva([pasada], { email: "nadie@x.co", telefono: "" }, nuevo)).toBe(true);
  });
  it("aplica los mismos cambios que una reprogramación, con su propia nota", () => {
    const r = cambiosDeReprogramacion(pasada, parsearFechaSheet("17/10/2026 10:00")!, nuevo, AHORA, "Reagendado en Calendly (la reunión ya había pasado)")!;
    expect(r.cambios.fechaReagenda).toBe("23/10/2026 15:30:00");
    expect(r.cambios.datosReagenda).toBe("Reagendado en Calendly (la reunión ya había pasado) el 19/10: de 17/10 10:00 a 23/10 15:30.");
  });
});

describe("Cancelar reunión (pedido de Tomás, 19/10/2026)", () => {
  it("la nota en AB dice qué reunión, quién y cuándo, arriba de lo que había", () => {
    expect(notaCancelacion("21/10 13:00", "Carlos Roletto", "", AHORA)).toBe("Reunión del 21/10 13:00 cancelada en Calendly por Carlos Roletto el 19/10.");
    expect(notaCancelacion("21/10 13:00", "", "pidió otro día", AHORA)).toBe("Reunión del 21/10 13:00 cancelada en Calendly el 19/10.\npidió otro día");
  });
});

describe("botón Cancelar reunión", () => {
  it("deja al lead fuera de todas las listas con valores que la planilla acepta", async () => {
    const { BOTON_CANCELAR_REUNION } = await import("@/lib/crm/pantalla");
    const { validarCambios } = await import("@/lib/crm/sheets/verificacion");
    expect(BOTON_CANCELAR_REUNION.cambios).toEqual({ presentoAgenda1: "No", precall: "Olvidar", fupsNoShow: "No hacer" });
    expect(validarCambios({ ...BOTON_CANCELAR_REUNION.cambios, datosReagenda: "Reunión del 21/10 13:00 cancelada en Calendly." })).toBeNull();
    const f = fila({ fechaCall: "21/10/2026 13:00:00" });
    const cancelada = { ...f, valores: { ...f.valores, ...BOTON_CANCELAR_REUNION.cambios } } as FilaLead;
    expect(accionPrecall(cancelada, AHORA)).toBeNull();
    expect(proximaAccion(cancelada, parsearFechaSheet("22/10/2026 11:00")!)).toBeNull();
  });
});

describe("reagendar una reunión que todavía no pasó con el evento Reagenda (Gero, 13/11/2026)", () => {
  const evento: EventoReagenda = { duenio: "u/carlos", nombreDuenio: "Carlos Roletto", url: "https://calendly.com/carlos-skyward/reunion-consultiva-reagenda-carlos", preguntaTelefono: 0 };
  const uuid = "AAAA1111-bbbb-2222-cccc-333344445555";
  it("el link marca la reunión vieja en utm_content y el webhook la reconoce", () => {
    const u = new URL(linkConDatos(evento, fila({}), `https://api.calendly.com/scheduled_events/${uuid}`));
    expect(u.searchParams.get("utm_content")).toBe(`reemplaza-${uuid}`);
    expect(eventoAReemplazar(u.searchParams.get("utm_content"))).toBe(uuid);
    // sin reunión a reemplazar (ya pasó) no lleva marca
    expect(new URL(linkConDatos(evento, fila({}))).searchParams.has("utm_content")).toBe(false);
    for (const raro of [null, "", "reemplaza-", "reemplaza-../x", "otra-cosa", `reemplaza-${uuid}/invitees`]) expect(eventoAReemplazar(raro)).toBeNull();
  });
  it("la fila es la de la reunión reemplazada aunque el horario nuevo sea antes", () => {
    const porVenir = fila({ fechaCall: "30/10/2026 10:00:00" });
    const antes = parsearFechaSheet("25/10/2026 12:00")!;
    expect("motivo" in filaDeLaReagendaNueva([porVenir], { email: "laura@x.co", telefono: "" }, antes)).toBe(true);
    const r = filaDeLaReagendaNueva([porVenir, fila({ fechaCall: "17/10/2026 10:00:00" })], { email: "laura@x.co", telefono: "" }, antes, parsearFechaSheet("30/10/2026 10:00"));
    expect("fila" in r && r.fila).toBe(porVenir);
    // otra reunión: no la toma
    expect("motivo" in filaDeLaReagendaNueva([porVenir], { email: "laura@x.co", telefono: "" }, antes, parsearFechaSheet("01/11/2026 10:00"))).toBe(true);
  });
  it("cancela la reunión vieja solo si sigue activa, por venir y es del mismo lead", () => {
    const ahora = parsearFechaSheet("19/10/2026 11:00")!;
    const ev = { status: "active", start_time: "2026-10-30T13:00:00.000000Z" };
    const lead = { email: "Laura@X.co", telefono: "" };
    const invs = [{ email: "laura@x.co", status: "active" }];
    expect(reemplazadaCancelable(ev, invs, lead, ahora)).toBe(true);
    expect(reemplazadaCancelable({ ...ev, status: "canceled" }, invs, lead, ahora)).toBe(false);
    expect(reemplazadaCancelable({ ...ev, start_time: "2026-10-18T13:00:00.000000Z" }, invs, lead, ahora)).toBe(false);
    expect(reemplazadaCancelable(ev, [{ email: "otro@x.co", status: "active" }], lead, ahora)).toBe(false);
    expect(reemplazadaCancelable(ev, [{ email: "otro@x.co", text_reminder_number: "+54 9 11 5555-1234" }], { email: "", telefono: "1155551234" }, ahora)).toBe(true);
    expect(reemplazadaCancelable(null, invs, lead, ahora)).toBe(false);
  });
});
