import { beforeEach, describe, it, expect, vi } from "vitest";
import { leerPlan, type EntradaPlan } from "@/lib/crm/cuotas/modelo";
const mocks = vi.hoisted(() => ({
  sesion: vi.fn(),
  leer: vi.fn(),
  crear: vi.fn(),
  guardar: vi.fn(),
  revalidar: vi.fn(),
}));
vi.mock("@/lib/crm/auth", () => ({ sesionActual: mocks.sesion }));
vi.mock("@/lib/crm/config", () => ({
  closers: () => [{ id: "closer1" }, { id: "closer2" }],
}));
vi.mock("@/lib/crm/cuotas/db", () => ({
  obtenerPlan: mocks.leer,
  crearPlan: mocks.crear,
  guardarPlan: mocks.guardar,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
import { actualizarPlan, nuevoPlan } from "@/lib/crm/cuotas/acciones";
const id = "fixture-google-id-000000000000000000000002";
const cuota = "22222222-2222-4222-8222-222222222222";
const op = "33333333-3333-4333-8333-333333333333";
const datos: EntradaPlan = {
  id,
  responsable: "closer1",
  nombre: "Cliente",
  telefono: "",
  concepto: "venta",
  notas: "",
  cuotas: [{ id: cuota, fecha: "2026-10-01", monto: "300" }],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.sesion.mockResolvedValue({
    rol: "closer",
    closerId: "closer1",
    nombre: "Closer 1",
  });
  mocks.crear.mockResolvedValue(true);
  mocks.guardar.mockResolvedValue(true);
  mocks.leer.mockResolvedValue({ plan: leerPlan(datos), version: 1 });
});
describe("Acciones de cuotas", () => {
  it("sin sesión no consulta ni escribe", async () => {
    mocks.sesion.mockResolvedValue(null);
    expect((await nuevoPlan(datos)).ok).toBe(false);
    expect((await actualizarPlan(id, 1, op, { tipo: "abandono" })).ok).toBe(
      false,
    );
    expect(mocks.leer).not.toHaveBeenCalled();
    expect(mocks.crear).not.toHaveBeenCalled();
  });
  it("el closer no crea planes ajenos", async () => {
    expect((await nuevoPlan({ ...datos, responsable: "closer2" })).ok).toBe(
      false,
    );
    expect(mocks.crear).not.toHaveBeenCalled();
  });
  it("consulta con filtro de propietario y no permite un id ajeno", async () => {
    mocks.leer.mockResolvedValue(null);
    expect((await actualizarPlan(id, 1, op, { tipo: "abandono" })).ok).toBe(
      false,
    );
    expect(mocks.leer).toHaveBeenCalledWith(id, "closer1");
    expect(mocks.guardar).not.toHaveBeenCalled();
  });
  it("el closer no transfiere su plan a otro", async () => {
    expect(
      (
        await actualizarPlan(id, 1, op, {
          tipo: "editar",
          datos: { ...datos, responsable: "closer2" },
        })
      ).ok,
    ).toBe(false);
    expect(mocks.guardar).not.toHaveBeenCalled();
  });
  it("rechaza pantalla desactualizada antes de escribir", async () => {
    mocks.leer.mockResolvedValue({ plan: leerPlan(datos), version: 2 });
    expect((await actualizarPlan(id, 1, op, { tipo: "abandono" })).ok).toBe(
      false,
    );
    expect(mocks.guardar).not.toHaveBeenCalled();
  });
  it("detecta carreras concurrentes en la escritura", async () => {
    mocks.guardar.mockResolvedValue(false);
    expect((await actualizarPlan(id, 1, op, { tipo: "abandono" })).ok).toBe(
      false,
    );
    expect(mocks.guardar).toHaveBeenCalledWith(
      expect.objectContaining({ abandonado: true }),
      1,
      "closer1",
    );
  });
  it("el administrador puede transferir el responsable", async () => {
    mocks.sesion.mockResolvedValue({ rol: "admin", nombre: "Admin" });
    expect(
      (
        await actualizarPlan(id, 1, op, {
          tipo: "editar",
          datos: { ...datos, responsable: "closer2" },
        })
      ).ok,
    ).toBe(true);
    expect(mocks.leer).toHaveBeenCalledWith(id, undefined);
  });
  it("reintento de la misma operación retorna sin cobrar dos veces", async () => {
    const p = leerPlan(datos);
    p.eventos.push({
      id: op,
      fecha: "2026-10-06",
      actor: "Closer",
      texto: "Prueba",
    });
    mocks.leer.mockResolvedValue({ plan: p, version: 2 });
    expect((await actualizarPlan(id, 1, op, { tipo: "abandono" })).ok).toBe(
      true,
    );
    expect(mocks.guardar).not.toHaveBeenCalled();
  });
  // Auditoría 10/10/2026: el tablero manda en "Editar plan" la versión con la que se abrió el formulario (eso es del cliente
  // y se verifica a mano: ver docs/CUOTAS.md). Acá, lo que el tablero necesita del servidor: que una edición con versión
  // vieja no escriba y que sus errores digan "Actualizá", porque con ese texto refresca y ofrece "Recargar datos del plan"
  it("una edición con versión vieja no escribe y sus errores piden actualizar", async () => {
    mocks.leer.mockResolvedValue({ plan: leerPlan(datos), version: 4 });
    const r = await actualizarPlan(id, 3, op, { tipo: "editar", datos });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/otra pantalla.*Actualizá/);
    expect(mocks.guardar).not.toHaveBeenCalled();
    // Carrera: la versión coincidía al leer pero otra pantalla escribió justo antes
    mocks.leer.mockResolvedValue({ plan: leerPlan(datos), version: 3 });
    mocks.guardar.mockResolvedValue(false);
    const carrera = await actualizarPlan(id, 3, op, { tipo: "editar", datos });
    expect(!carrera.ok && carrera.error).toMatch(/Actualizá/);
  });
  it("si guarda, devuelve el plan ya editado (el aviso del tablero usa ese nombre)", async () => {
    const r = await actualizarPlan(id, 1, op, {
      tipo: "editar",
      datos: { ...datos, nombre: "  Nombre corregido " },
    });
    expect(r.ok && r.registro.plan.nombre).toBe("Nombre corregido");
    expect(r.ok && r.registro.version).toBe(2);
  });
  it("la fila Pagado no se anula ni se cobra desde una acción: no escribe", async () => {
    const pagado = "44444444-4444-4444-8444-444444444444";
    const conPagado: EntradaPlan = {
      ...datos,
      cuotas: [{ id: pagado, fecha: "2026-10-01", monto: "200", pagado: true }, ...datos.cuotas],
    };
    mocks.leer.mockResolvedValue({ plan: leerPlan(conPagado, undefined, "x", new Date("2026-10-10T15:00Z")), version: 1 });
    for (const cambio of [
      { tipo: "anular", cuota: pagado, pago: pagado },
      { tipo: "pago", cuota: pagado, monto: "10", fecha: "2026-10-01" },
    ] as const) {
      const r = await actualizarPlan(id, 1, op, cambio);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/Editar plan/);
    }
    expect(mocks.guardar).not.toHaveBeenCalled();
  });
  it("un responsable desconocido es rechazado", async () => {
    expect((await nuevoPlan({ ...datos, responsable: "inexistente" })).ok).toBe(
      false,
    );
    expect(mocks.crear).not.toHaveBeenCalled();
  });
});
