import { describe, expect, it, vi } from "vitest";
import { crearLectorInstagram } from "@/lib/crm/instagramCalendly";
import { PREGUNTA_INSTAGRAM } from "@/lib/crm/instagram";

const fecha = "2026-10-31T15:00:00.000Z";
const fila = { email: "lead@example.test", fechaCall: "31/10/2026 12:00:00" };
const evento = { name: "Reunión Consultiva", start_time: fecha, uri: "https://api.calendly.com/scheduled_events/ev-1" };
const invitado = { email: fila.email, questions_and_answers: [{ question: "Decisores", answer: "Sí" }, { question: PREGUNTA_INSTAGRAM, answer: "@estudio.ejemplo" }] };
function fixture(op: { eventos?: unknown; invitados?: unknown; error?: boolean } = {}) {
  const pedir = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toMatch(/^https:\/\/api\.calendly\.com\//);
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.redirect).toBe("error");
    if (op.error) return new Response("", { status: 429 });
    const body = String(url).endsWith("/users/me") ? { resource: { current_organization: "https://api.calendly.com/organizations/org-1" } }
      : String(url).includes("/invitees?") ? op.invitados ?? { collection: [invitado] }
      : op.eventos ?? { collection: [evento] };
    return new Response(JSON.stringify(body));
  });
  let now = 100;
  return { pedir, leer: crearLectorInstagram("token-ficticio", pedir as typeof fetch, () => now), avanzar: (ms: number) => { now += ms; } };
}

describe("Lectura de Instagram de la reserva original", () => {
  it("une por correo y fecha exacta, consulta sólo GET y devuelve la pregunta por nombre", async () => {
    const f = fixture();
    expect(await f.leer(fila)).toEqual({ estado: "disponible", texto: "@estudio.ejemplo" });
    const url = new URL(String(f.pedir.mock.calls[1][0]));
    expect(url.searchParams.get("invitee_email")).toBe(fila.email);
    expect(url.searchParams.get("min_start_time")).toBe("2026-10-31T14:59:59.000Z");
    expect(f.pedir).toHaveBeenCalledTimes(3);
  });
  it("no cambia el resto de la fila ni requiere columnas nuevas", async () => {
    const valores = { ...fila, precall: "VIDEOS CONF", recordatorioPrecall: "3", fechaReagenda: "01/11/2026 15:00" };
    const copia = { ...valores };
    expect((await fixture().leer(valores)).estado).toBe("disponible");
    expect(valores).toEqual(copia);
  });
  it.each([null, undefined, "", "no tengo"])("respuesta %s es opcional", async answer => {
    const f = fixture({ invitados: { collection: [{ ...invitado, questions_and_answers: [{ question: PREGUNTA_INSTAGRAM, answer }] }] } });
    expect(await f.leer(fila)).toEqual(answer ? { estado: "disponible", texto: answer } : { estado: "sin_dato" });
  });
  it.each([{ email: "", fechaCall: fila.fechaCall }, { email: fila.email, fechaCall: "" }, {}, { email: null, fechaCall: null }])("filas antiguas/incompletas no fallan ni consultan %j", async datos => {
    const f = fixture(); expect(await f.leer(datos)).toEqual({ estado: "sin_dato" }); expect(f.pedir).not.toHaveBeenCalled();
  });
  it("sin token no consulta", async () => expect(await crearLectorInstagram("", vi.fn() as typeof fetch)(fila)).toEqual({ estado: "sin_dato" }));
  it("sin reserva o con otro horario no atribuye respuestas", async () => {
    expect(await fixture({ eventos: { collection: [] } }).leer(fila)).toEqual({ estado: "sin_dato" });
    expect(await fixture({ eventos: { collection: [{ ...evento, start_time: "2026-10-31T16:00:00Z" }] } }).leer(fila)).toEqual({ estado: "sin_dato" });
  });
  it("otro correo o correo duplicado no se atribuye al lead", async () => {
    expect(await fixture({ invitados: { collection: [{ ...invitado, email: "otro@example.test" }] } }).leer(fila)).toEqual({ estado: "sin_dato" });
    expect(await fixture({ invitados: { collection: [invitado, invitado] } }).leer(fila)).toEqual({ estado: "no_disponible" });
  });
  it("eventos ambiguos, páginas incompletas y URI externa no permiten atribuir ni filtrar el token", async () => {
    expect(await fixture({ eventos: { collection: [evento, evento] } }).leer(fila)).toEqual({ estado: "no_disponible" });
    expect(await fixture({ eventos: { collection: [evento], pagination: { next_page: "otra" } } }).leer(fila)).toEqual({ estado: "no_disponible" });
    const f = fixture({ eventos: { collection: [{ ...evento, uri: "https://evil.test/event" }] } });
    expect(await f.leer(fila)).toEqual({ estado: "no_disponible" }); expect(f.pedir).toHaveBeenCalledTimes(2);
  });
  it("429 y excepción no rompen la ficha", async () => {
    expect(await fixture({ error: true }).leer(fila)).toEqual({ estado: "no_disponible" });
    expect(await crearLectorInstagram("token", vi.fn().mockRejectedValue(new Error("sin red")))(fila)).toEqual({ estado: "no_disponible" });
  });
  it("caché y solicitudes simultáneas evitan leer repetidamente Calendly; vencen", async () => {
    const f = fixture(); await Promise.all([f.leer(fila), f.leer(fila)]); expect(f.pedir).toHaveBeenCalledTimes(3);
    await f.leer(fila); expect(f.pedir).toHaveBeenCalledTimes(3);
    f.avanzar(300_001); await f.leer(fila); expect(f.pedir).toHaveBeenCalledTimes(6);
  });
});
