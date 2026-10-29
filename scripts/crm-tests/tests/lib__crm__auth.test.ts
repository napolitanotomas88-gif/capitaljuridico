import { beforeEach, describe, it, expect, vi } from "vitest";
// Sesión del CRM para Cobro de cuotas (10/10/2026): quien tiene Cobro de cuotas sin Ventas ve solo los planes de Administración
const mocks = vi.hoisted(() => ({ sesion: vi.fn(), hojasDeMail: vi.fn() }));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: mocks.sesion }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/crm/config", () => ({
  closers: () => [{ id: "closer-1", nombre: "Closer 1", hoja: "Closer 1" }],
  hojasClosers: () => ["Closer 1"],
  hojasDeMail: mocks.hojasDeMail,
}));
import { RESPONSABLE_ADMINISTRACION, requerirSesion, sesionActual } from "@/lib/crm/auth";

const acceso = (secciones: string[]) => ({ email: "x@y.co", nombre: "Persona", rol: "acceso", secciones, admin: false });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.hojasDeMail.mockReturnValue([]);
});
describe("sesionActual en Cobro de cuotas", () => {
  it("Cobro de cuotas sin Ventas ni pestaña: solo los planes de Administración", async () => {
    mocks.sesion.mockResolvedValue(acceso(["resumen", "clientes", "cuotas"]));
    expect(await sesionActual("cuotas")).toEqual({ rol: "closer", closerId: RESPONSABLE_ADMINISTRACION, nombre: "Persona", email: "x@y.co", hojas: [] });
    // y no le abre Ventas
    expect(await sesionActual("ventas")).toBeNull();
  });
  it("con Ventas y sin pestaña sigue sin sesión (va a /ventas, que explica el sin CRM asignado)", async () => {
    mocks.sesion.mockResolvedValue(acceso(["ventas", "cuotas"]));
    expect(await sesionActual("cuotas")).toBeNull();
    await expect(requerirSesion("cuotas")).rejects.toThrow("redirect:/ventas");
  });
  it("con pestaña es el closer de esa pestaña", async () => {
    mocks.sesion.mockResolvedValue(acceso(["ventas", "cuotas"]));
    mocks.hojasDeMail.mockReturnValue(["Closer 1"]);
    expect((await sesionActual("cuotas"))?.closerId).toBe("closer-1");
  });
  it("sin Cobro de cuotas no hay sesión de cuotas", async () => {
    mocks.sesion.mockResolvedValue(acceso(["resumen", "clientes"]));
    expect(await sesionActual("cuotas")).toBeNull();
  });
  it("el administrador ve todo", async () => {
    mocks.sesion.mockResolvedValue({ ...acceso([]), admin: true, rol: "socio", secciones: undefined });
    expect((await sesionActual("cuotas"))?.rol).toBe("admin");
  });
});
