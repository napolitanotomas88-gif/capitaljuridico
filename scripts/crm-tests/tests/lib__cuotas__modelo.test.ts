import { describe, it, expect } from "vitest";
import {
  cobrado,
  fechaValida,
  hoyBA,
  inicioAviso,
  leerPlan,
  modificarPlan,
  numeroDeCuota,
  cuotasAPagar,
  cobradoFilaPagado,
  avisoPagoInicialAnulado,
  cuotaConHistorial,
  textoPlan,
  montoCentavos,
  porCobrar,
  sumarMes,
  puedeAcceder,
  saldo,
  tarea,
  type EntradaPlan,
  type Plan,
} from "@/lib/crm/cuotas/modelo";
const id = "fixture-google-id-000000000000000000000002";
const cuota = "22222222-2222-4222-8222-222222222222";
const op = "33333333-3333-4333-8333-333333333333";
const datos: EntradaPlan = {
  id,
  responsable: "closer1",
  nombre: "Cliente de prueba",
  telefono: "5491112345678",
  concepto: "venta",
  notas: "",
  cuotas: [{ id: cuota, fecha: "2026-10-10", monto: "300" }],
};
const ahora = new Date("2026-10-10T15:00:00Z");
const plan = (): Plan => leerPlan(structuredClone(datos));
describe("Dinero y validación", () => {
  it("guarda centavos exactos, acepta coma decimal", () => {
    expect(montoCentavos("0,29")).toBe(29);
    expect(montoCentavos("300.50")).toBe(30050);
  });
  it.each(["1.000", "-3", "NaN", "Infinity", "0", "1e3", "300.001", "1000001"])(
    "rechaza %s",
    (x) => expect(() => montoCentavos(x)).toThrow(),
  );
  it("valida fechas sin autocorregir febrero", () => {
    expect(fechaValida("2026-02-30")).toBe(false);
    expect(fechaValida("2028-02-29")).toBe(true);
  });
  it("rechaza cuotas repetidas y fechas ilegibles", () => {
    expect(() =>
      leerPlan({ ...datos, cuotas: [...datos.cuotas, ...datos.cuotas] }),
    ).toThrow();
    expect(() =>
      leerPlan({ ...datos, cuotas: [{ ...datos.cuotas[0], fecha: "hola" }] }),
    ).toThrow();
  });
});
describe("Agenda Buenos Aires y SOP", () => {
  it("usa Buenos Aires aunque el servidor esté en UTC", () =>
    expect(hoyBA(new Date("2026-10-11T01:30Z"))).toBe("2026-10-10"));
  it("avisa cinco días de lunes a sábado", () =>
    expect(inicioAviso("2026-10-12")).toBe("2026-10-06"));
  it("no muestra gestión antes del aviso", () =>
    expect(tarea(plan().cuotas[0], new Date("2026-10-02T15:00Z"))?.lista).toBe(
      false,
    ));
  it("pide aviso previo, cobro hoy y vencida según fecha", () => {
    const c = plan().cuotas[0];
    expect(tarea(c, new Date("2026-10-06T15:00Z"))?.grupo).toBe("avisar");
    expect(tarea(c, ahora)?.grupo).toBe("hoy");
    expect(tarea(c, new Date("2026-10-12T15:00Z"))?.grupo).toBe("vencidas");
  });
  it("salta del sábado al lunes: el domingo cuenta pero no hay envíos", () => {
    let p = plan();
    p = modificarPlan(p, { tipo: "gestion", cuota }, op, "Closer", ahora);
    expect(tarea(p.cuotas[0], new Date("2026-10-11T15:00Z"))?.lista).toBe(
      false,
    );
    expect(tarea(p.cuotas[0], new Date("2026-10-12T15:00Z"))?.lista).toBe(true);
    expect(tarea(p.cuotas[0], ahora)?.lista).toBe(false);
  });
  it("espera 48h tras aviso previo", () => {
    const p = modificarPlan(
      plan(),
      { tipo: "gestion", cuota },
      op,
      "Closer",
      new Date("2026-10-06T15:00Z"),
    );
    expect(tarea(p.cuotas[0], new Date("2026-10-07T15:00Z"))?.lista).toBe(
      false,
    );
    expect(tarea(p.cuotas[0], new Date("2026-10-08T15:00Z"))?.lista).toBe(true);
  });
  it("aplica la tercera espera de 48h y luego continúa", () => {
    const p = plan();
    p.cuotas[0].gestiones = [6, 7, 8].map((d) => ({
      fecha: `2026-10-${String(d).padStart(2, "0")}T15:00:00Z`,
      tipo: "cobro" as const,
      actor: "Closer",
    }));
    p.cuotas[0].vencimiento = "2026-10-06";
    expect(tarea(p.cuotas[0], new Date("2026-10-09T15:00Z"))?.lista).toBe(
      false,
    );
    expect(tarea(p.cuotas[0], ahora)?.lista).toBe(true);
  });
  it("pausa hasta promesa sin perder vencimiento original", () => {
    const p = modificarPlan(
      plan(),
      { tipo: "promesa", cuota, fecha: "2026-10-15" },
      op,
      "Closer",
      ahora,
    );
    expect(p.cuotas[0].vencimiento).toBe("2026-10-10");
    expect(tarea(p.cuotas[0], new Date("2026-10-13T15:00Z"))?.lista).toBe(
      false,
    );
    expect(tarea(p.cuotas[0], new Date("2026-10-15T15:00Z"))?.lista).toBe(true);
  });
});
describe("Cobros y correcciones", () => {
  it("registra parcial y al completar desaparece la tarea", () => {
    const p = modificarPlan(
      plan(),
      { tipo: "pago", cuota, monto: "100", fecha: "2026-10-10" },
      op,
      "Closer",
      ahora,
    );
    expect(saldo(p.cuotas[0])).toBe(20000);
    const completo = modificarPlan(
      p,
      { tipo: "pago", cuota, monto: "200", fecha: "2026-10-10" },
      id,
      "Closer",
      ahora,
    );
    expect(saldo(completo.cuotas[0])).toBe(0);
    expect(tarea(completo.cuotas[0], ahora)).toBeNull();
  });
  it("no duplica la misma operación reintentada", () => {
    const p = modificarPlan(
      plan(),
      { tipo: "pago", cuota, monto: "100", fecha: "2026-10-10" },
      op,
      "Closer",
      ahora,
    );
    expect(
      modificarPlan(
        p,
        { tipo: "pago", cuota, monto: "100", fecha: "2026-10-10" },
        op,
        "Closer",
        ahora,
      ),
    ).toEqual(p);
    expect(cobrado(p.cuotas[0])).toBe(10000);
  });
  it("rechaza sobrepago y fecha futura", () => {
    expect(() =>
      modificarPlan(
        plan(),
        { tipo: "pago", cuota, monto: "301", fecha: "2026-10-10" },
        op,
        "Closer",
        ahora,
      ),
    ).toThrow();
    expect(() =>
      modificarPlan(
        plan(),
        { tipo: "pago", cuota, monto: "100", fecha: "2026-10-12" },
        op,
        "Closer",
        ahora,
      ),
    ).toThrow();
  });
  it("anula con historial, restaurando el saldo", () => {
    const p = modificarPlan(
      plan(),
      { tipo: "pago", cuota, monto: "100", fecha: "2026-10-10" },
      op,
      "Closer",
      ahora,
    );
    const q = modificarPlan(
      p,
      { tipo: "anular", cuota, pago: op },
      id,
      "Closer",
      ahora,
    );
    expect(saldo(q.cuotas[0])).toBe(30000);
    expect(q.cuotas[0].pagos[0].anulado).toBe(true);
    expect(q.eventos).toHaveLength(2);
  });
  it("no edita por debajo de lo cobrado ni quita cuotas con historial", () => {
    const p = modificarPlan(
      plan(),
      { tipo: "pago", cuota, monto: "100", fecha: "2026-10-10" },
      op,
      "Closer",
      ahora,
    );
    expect(() =>
      leerPlan({ ...datos, cuotas: [{ ...datos.cuotas[0], monto: "50" }] }, p),
    ).toThrow();
    expect(() =>
      leerPlan(
        { ...datos, cuotas: [{ id, fecha: "2026-10-10", monto: "300" }] },
        p,
      ),
    ).toThrow();
  });
  it("abandona explícitamente, conserva saldo y permite reactivar", () => {
    const p = modificarPlan(plan(), { tipo: "abandono" }, op, "Closer", ahora);
    expect(p.abandonado).toBe(true);
    expect(saldo(p.cuotas[0])).toBe(30000);
    expect(() =>
      modificarPlan(p, { tipo: "gestion", cuota }, id, "Closer", ahora),
    ).toThrow();
    expect(
      modificarPlan(p, { tipo: "reactivar" }, id, "Closer", ahora).abandonado,
    ).toBe(false);
  });
  it("rechaza acciones inventadas", () =>
    expect(() =>
      modificarPlan(
        plan(),
        { tipo: "inventada", cuota } as never,
        op,
        "Closer",
        ahora,
      ),
    ).toThrow());
});
describe("Permisos", () => {
  it("un closer solo accede a sus planes; admin a todos", () => {
    expect(puedeAcceder("closer", "closer1", "closer1")).toBe(true);
    expect(puedeAcceder("closer", "closer1", "closer2")).toBe(false);
    expect(puedeAcceder("closer", undefined, "admin")).toBe(false);
    expect(puedeAcceder("admin", undefined, "closer2")).toBe(true);
  });
});


describe("Columna según la fecha de pago coordinada", () => {
  it("un pago anticipado para hoy sale en Cobrar hoy", () => {
    const c=plan().cuotas[0]; c.promesa="2026-10-08";
    expect(tarea(c,new Date("2026-10-08T15:00Z"))?.grupo).toBe("hoy");
    expect(tarea(c,new Date("2026-10-09T15:00Z"))?.grupo).toBe("vencidas");
    expect(c.vencimiento).toBe("2026-10-10");
  });
  it("si se posterga, Cobrar hoy usa la nueva fecha y mantiene la original", () => {
    const c=plan().cuotas[0]; c.promesa="2026-10-15";
    expect(tarea(c,new Date("2026-10-15T15:00Z"))?.grupo).toBe("hoy");
    expect(tarea(c,new Date("2026-10-16T15:00Z"))?.grupo).toBe("vencidas");
  });
});

describe("Fila Pagado, concepto y copiar plan", () => {
  const pagadoId = "44444444-4444-4444-8444-444444444444";
  const conPagado = (monto: string, fecha = "2026-10-01"): EntradaPlan => ({
    ...structuredClone(datos),
    notas: "nota secreta",
    cuotas: [
      { id: pagadoId, fecha, monto, concepto: "reserva", pagado: true },
      { id: cuota, fecha: "2026-11-10", monto: "300", concepto: "completa_pago" },
    ],
  });
  it("lo ya pagado queda como cuota inicial cobrada y no se numera", () => {
    const p = leerPlan(conPagado("200"), undefined, "Tomás", ahora);
    expect(p.cuotas[0].inicial).toBe(true);
    expect(p.cuotas[0].concepto).toBe("reserva");
    expect(saldo(p.cuotas[0])).toBe(0);
    expect(p.cuotas[0].pagos[0]).toMatchObject({ id: pagadoId, centavos: 20000, fecha: "2026-10-01", actor: "Tomás" });
    expect(numeroDeCuota(p, p.cuotas[1])).toBe(1);
    expect(cuotasAPagar(p)).toBe(1);
    expect(p.cuotas[1].concepto).toBe("completa_pago");
    expect(tarea(p.cuotas[0], ahora)).toBeNull();
  });
  it("la fila Pagado vacía o en 0 no se guarda", () => {
    expect(leerPlan(conPagado(""), undefined, "x", ahora).cuotas).toHaveLength(1);
    expect(leerPlan(conPagado("0"), undefined, "x", ahora).cuotas).toHaveLength(1);
  });
  it("lo pagado no puede tener fecha futura ni ir después de una cuota", () => {
    expect(() => leerPlan(conPagado("200", "2026-12-01"), undefined, "x", ahora)).toThrow();
    const d = conPagado("200");
    d.cuotas.reverse();
    expect(() => leerPlan(d, undefined, "x", ahora)).toThrow();
  });
  it("editar conserva el pago inicial y los pagos posteriores", () => {
    const p = leerPlan(conPagado("200"), undefined, "Tomás", ahora);
    const editado = leerPlan(conPagado("250"), p, "Otro", ahora);
    expect(editado.cuotas[0].pagos[0]).toMatchObject({ centavos: 25000, actor: "Tomás", creado: p.cuotas[0].pagos[0].creado });
  });
  it("copiar plan trae todo menos las notas", () => {
    const p = leerPlan(conPagado("200"), undefined, "Tomás", ahora);
    const t = textoPlan(p, "Carlos");
    expect(t).toContain("Cliente de prueba");
    expect(t).toContain("5491112345678");
    expect(t).toContain("Responsable: Carlos");
    expect(t).toMatch(/Pagado: .*200.*Reserva/);
    expect(t).toMatch(/Cuota 1: .*300.*Completa pago/);
    expect(t).toMatch(/Total del plan: .*500/);
    expect(t).not.toContain("nota secreta");
  });
});

// Auditoría 10/10/2026: la fila "Pagado" no se cobra, no se anula ni se gestiona; se corrige (o se quita) desde Editar plan
describe("Fila Pagado: solo se corrige con Editar plan", () => {
  const pagadoId = "55555555-5555-4555-8555-555555555555";
  const otra = "66666666-6666-4666-8666-666666666666";
  const entrada = (monto: string, extra: Partial<EntradaPlan> = {}): EntradaPlan => ({
    ...structuredClone(datos),
    cuotas: [
      { id: pagadoId, fecha: "2026-10-01", monto, concepto: "reserva", pagado: true },
      { id: cuota, fecha: "2026-11-10", monto: "300" },
      { id: otra, fecha: "2026-12-10", monto: "300" },
    ],
    ...extra,
  });
  const conPagado = () => leerPlan(entrada("200"), undefined, "Tomás", ahora);
  it.each([
    { tipo: "anular", cuota: pagadoId, pago: pagadoId },
    { tipo: "pago", cuota: pagadoId, monto: "10", fecha: "2026-10-10" },
    { tipo: "promesa", cuota: pagadoId, fecha: "2026-10-20" },
    { tipo: "gestion", cuota: pagadoId },
  ] as const)("rechaza $tipo sobre la fila Pagado", (cambio) => {
    expect(() => modificarPlan(conPagado(), cambio, op, "Closer", ahora)).toThrow(/Editar plan/);
  });
  it("nunca es tarea ni suma a lo pendiente, aunque datos viejos tengan el pago anulado", () => {
    const p = conPagado();
    p.cuotas[0].pagos[0].anulado = true;
    expect(saldo(p.cuotas[0])).toBe(20000);
    expect(tarea(p.cuotas[0], ahora)).toBeNull();
    expect(porCobrar(p.cuotas[0])).toBe(0);
    expect(porCobrar(p.cuotas[1])).toBe(30000);
    const t = textoPlan(p, "Carlos");
    expect(t).toMatch(/Pagado: USD\s0,00/);
    expect(t).toMatch(/Total del plan: USD\s600,00 · Pagado: USD\s0,00 · Pendiente: USD\s600,00/);
  });
  it("editar no revive un pago inicial anulado ni deja saldo negativo", () => {
    const p = conPagado();
    p.cuotas[0].pagos[0].anulado = true;
    const editado = modificarPlan(p, { tipo: "editar", datos: entrada("200", { telefono: "549" }) }, op, "Closer", ahora);
    expect(editado.cuotas[0].pagos).toHaveLength(1);
    expect(editado.cuotas[0].pagos[0].anulado).toBe(true);
    // Datos viejos: anulado + otro pago de 200 sobre la fila; re-guardar no lo duplica
    p.cuotas[0].pagos.push({ id: op, centavos: 20000, fecha: "2026-10-02", creado: "x", actor: "x" });
    expect(saldo(leerPlan(entrada("200"), p, "x", ahora).cuotas[0])).toBe(0);
  });
  // Datos de antes del 10/10: la fila Pagado con un pago de más (id distinto del de la cuota). Antes no tenía arreglo:
  // no se podía bajar el importe ni quitar la fila, y anular ese pago también se rechazaba
  describe("pago de más sobre la fila Pagado: se anula y después se corrige", () => {
    const op2 = "77777777-7777-4777-8777-777777777777";
    const extra = { id: op, centavos: 20000, fecha: "2026-10-02", creado: "x", actor: "x" };
    it("pago inicial anulado + pago de más: anular el de más deja bajar el importe", () => {
      const p = conPagado();
      p.cuotas[0].pagos[0].anulado = true;
      p.cuotas[0].pagos.push({ ...extra });
      expect(() => modificarPlan(p, { tipo: "editar", datos: entrada("150") }, op2, "Closer", ahora)).toThrow(/Anulá el pago de más/);
      const sinExtra = modificarPlan(p, { tipo: "anular", cuota: pagadoId, pago: op }, id, "Closer", ahora);
      expect(sinExtra.eventos.at(-1)?.texto).toMatch(/^Pagado: pago anulado \(USD\s200,00\)$/);
      expect(cobrado(sinExtra.cuotas[0])).toBe(0);
      const bajado = modificarPlan(sinExtra, { tipo: "editar", datos: entrada("150") }, op2, "Closer", ahora);
      expect(bajado.cuotas[0].centavos).toBe(15000);
      expect(porCobrar(bajado.cuotas[0])).toBe(0);
    });
    it("pago inicial vigente + pago de más (cobrado mayor que el importe): anular el de más deja editar y bajar", () => {
      const p = conPagado();
      p.cuotas[0].pagos.push({ ...extra });
      // Hasta cambiar solo el teléfono se rechaza, pero el mensaje dice la salida
      expect(() => modificarPlan(p, { tipo: "editar", datos: entrada("200", { telefono: "549" }) }, op2, "Closer", ahora)).toThrow(
        /superar.*Anulá el pago de más/,
      );
      // El pago inicial en sí sigue sin anularse desde el detalle
      expect(() => modificarPlan(p, { tipo: "anular", cuota: pagadoId, pago: pagadoId }, id, "Closer", ahora)).toThrow(/Editar plan/);
      const sinExtra = modificarPlan(p, { tipo: "anular", cuota: pagadoId, pago: op }, id, "Closer", ahora);
      expect(cobrado(sinExtra.cuotas[0])).toBe(20000);
      expect(modificarPlan(sinExtra, { tipo: "editar", datos: entrada("200", { telefono: "549" }) }, op2, "Closer", ahora).telefono).toBe("549");
      const bajado = modificarPlan(sinExtra, { tipo: "editar", datos: entrada("150") }, op2, "Closer", ahora);
      expect(cobrado(bajado.cuotas[0])).toBe(15000);
      expect(saldo(bajado.cuotas[0])).toBe(0);
    });
    it("un pago de más ya anulado no se vuelve a anular", () => {
      const p = conPagado();
      p.cuotas[0].pagos.push({ ...extra, anulado: true });
      expect(() => modificarPlan(p, { tipo: "anular", cuota: pagadoId, pago: op }, id, "Closer", ahora)).toThrow(/ya está anulado/);
    });
    // El detalle no deja anular en un plan abandonado: el error de Editar plan dice que primero hay que reactivarlo
    it("en un plan abandonado el error manda a reactivar antes de anular el pago de más", () => {
      const p = conPagado();
      p.cuotas[0].pagos.push({ ...extra });
      p.abandonado = true;
      const editarTelefono = (plan: Plan) =>
        modificarPlan(plan, { tipo: "editar", datos: entrada("200", { telefono: "549" }) }, op2, "Closer", ahora);
      expect(() => editarTelefono(p)).toThrow(/superar.*Reactivá el plan, anulá el pago de más/);
      expect(() => modificarPlan(p, { tipo: "anular", cuota: pagadoId, pago: op }, id, "Closer", ahora)).toThrow(/Reactivá el plan/);
      // Siguiendo el mensaje: reactivar, anular el de más, editar y volver a marcar el abandono
      const activo = modificarPlan(p, { tipo: "reactivar" }, "88888888-8888-4888-8888-888888888888", "Closer", ahora);
      const sinExtra = modificarPlan(activo, { tipo: "anular", cuota: pagadoId, pago: op }, id, "Closer", ahora);
      const editado = editarTelefono(sinExtra);
      expect(editado.telefono).toBe("549");
      expect(modificarPlan(editado, { tipo: "abandono" }, "99999999-9999-4999-8999-999999999999", "Closer", ahora).abandonado).toBe(true);
      // Con el plan activo, el mensaje de siempre
      expect(() => editarTelefono(activo)).toThrow(/superar el importe de la fila Pagado\. Anulá el pago de más desde el detalle del plan\.$/);
    });
  });
  // Con el pago inicial anulado, editar no lo revive: el historial y "Ya pagado" del formulario dicen lo que de verdad quedó cobrado
  it("corregir un Pagado con el pago anulado avisa que sigue anulado", () => {
    const p = conPagado();
    p.cuotas[0].pagos[0].anulado = true;
    const editado = modificarPlan(p, { tipo: "editar", datos: entrada("250") }, op, "Closer", ahora);
    expect(editado.eventos.at(-1)?.texto).toMatch(
      /^Plan actualizado · Pagado corregido: USD\s200,00 del 01\/10\/2026 → USD\s250,00 del 01\/10\/2026 \(el pago sigue anulado: cobrado USD\s0,00\)$/,
    );
    expect(cobrado(editado.cuotas[0])).toBe(0);
    expect(textoPlan(editado, "x")).toMatch(/Pagado: USD\s0,00/);
    const quitado = modificarPlan(p, { tipo: "editar", datos: entrada("") }, op, "Closer", ahora);
    expect(quitado.eventos.at(-1)?.texto).toMatch(/Pagado quitado \(USD\s200,00 del 01\/10\/2026, con el pago anulado\)$/);
  });
  // El aviso de Editar plan con el pago inicial anulado solo manda a vaciar la fila cuando quitarla es posible: si no,
  // seguirlo daba "No podés quitar una cuota que tiene historial." (pago de más vigente o anulado, o gestiones)
  describe("aviso de Editar plan con el pago inicial anulado", () => {
    const op2 = "77777777-7777-4777-8777-777777777777";
    const nueva = "88888888-8888-4888-8888-888888888888";
    const anulado = (arreglar: (p: Plan) => void = () => {}) => {
      const p = conPagado();
      p.cuotas[0].pagos[0].anulado = true;
      arreglar(p);
      return p;
    };
    const vaciar = (p: Plan) => modificarPlan(p, { tipo: "editar", datos: entrada("") }, op2, "Closer", ahora);
    it("sin pago anulado no hay aviso", () => {
      expect(avisoPagoInicialAnulado(conPagado().cuotas[0])).toBeNull();
      expect(avisoPagoInicialAnulado(conPagado().cuotas[1])).toBeNull();
    });
    it("si la fila solo tiene su pago inicial: vaciarla, guardar y cargarla de nuevo funciona", () => {
      const p = anulado();
      expect(cuotaConHistorial(p.cuotas[0])).toBe(false);
      expect(avisoPagoInicialAnulado(p.cuotas[0])).toMatch(/vaciá la fila, guardá y cargala de nuevo\.$/);
      const sin = vaciar(p);
      expect(sin.cuotas.some((c) => c.inicial)).toBe(false);
      // Cargada de nuevo entra con otro id y un pago nuevo, vigente
      const otraVez = modificarPlan(
        sin,
        { tipo: "editar", datos: { ...entrada("200"), cuotas: [{ ...entrada("200").cuotas[0], id: nueva }, ...entrada("200").cuotas.slice(1)] } },
        op,
        "Closer",
        ahora,
      );
      expect(cobrado(otraVez.cuotas[0])).toBe(20000);
    });
    it("con un pago de más vigente no manda a vaciarla: lo cobrado ya cuenta", () => {
      const p = anulado((q) => q.cuotas[0].pagos.push({ id: op, centavos: 20000, fecha: "2026-10-02", creado: "x", actor: "x" }));
      const aviso = avisoPagoInicialAnulado(p.cuotas[0]);
      expect(aviso).not.toMatch(/vaciá/);
      expect(aviso).toMatch(/ya cuentan en "Ya pagado"/);
      expect(cobradoFilaPagado(20000, p.cuotas[0])).toBe(20000);
      expect(() => vaciar(p)).toThrow(/historial/);
    });
    it.each([
      ["un pago de más ya anulado", (q: Plan) => q.cuotas[0].pagos.push({ id: op, centavos: 20000, fecha: "2026-10-02", creado: "x", actor: "x", anulado: true })],
      ["gestiones", (q: Plan) => q.cuotas[0].gestiones.push({ fecha: "2026-10-02T15:00:00Z", tipo: "aviso", actor: "x" })],
    ])("con %s no manda a vaciarla y la salida que propone funciona", (_, arreglar) => {
      const p = anulado(arreglar);
      const aviso = avisoPagoInicialAnulado(p.cuotas[0]);
      expect(aviso).not.toMatch(/vaciá/);
      expect(aviso).toMatch(/agregá una cuota por ese importe, guardá y registrá el pago desde el detalle del plan\.$/);
      expect(avisoPagoInicialAnulado(p.cuotas[0], true)).toMatch(/\(antes reactivalo\)\.$/);
      expect(() => vaciar(p)).toThrow(/historial/);
      // La salida: una cuota más por ese importe y el pago registrado desde el detalle
      const base = entrada("200");
      const conCuota = modificarPlan(
        p,
        { tipo: "editar", datos: { ...base, cuotas: [...base.cuotas, { id: nueva, fecha: "2026-10-01", monto: "200" }] } },
        op2,
        "Closer",
        ahora,
      );
      const pagado = modificarPlan(conCuota, { tipo: "pago", cuota: nueva, monto: "200", fecha: "2026-10-01" }, id, "Closer", ahora);
      expect(saldo(pagado.cuotas.find((c) => c.id === nueva)!)).toBe(0);
      expect(pagado.cuotas.reduce((s, c) => s + cobrado(c), 0)).toBe(20000);
    });
    it("la regla de quitar es la misma que usa leerPlan", () => {
      const normal = conPagado().cuotas[1];
      expect(cuotaConHistorial(normal)).toBe(false);
      expect(cuotaConHistorial({ ...normal, pagos: [{ id: op, centavos: 100, fecha: "2026-10-02", creado: "x", actor: "x", anulado: true }] })).toBe(true);
      expect(cuotaConHistorial(conPagado().cuotas[0])).toBe(false);
    });
  });
  it("lo cobrado de la fila Pagado al guardar (el \"Ya pagado\" del formulario)", () => {
    const p = conPagado();
    expect(cobradoFilaPagado(25000, p.cuotas[0])).toBe(25000);
    expect(cobradoFilaPagado(30000)).toBe(30000);
    expect(cobradoFilaPagado(0, p.cuotas[0])).toBe(0);
    p.cuotas[0].pagos[0].anulado = true;
    expect(cobradoFilaPagado(25000, p.cuotas[0])).toBe(0);
    // Los otros pagos vigentes de la fila cuentan; los anulados no
    p.cuotas[0].pagos.push({ id: op, centavos: 5000, fecha: "2026-10-02", creado: "x", actor: "x" });
    p.cuotas[0].pagos.push({ id: id, centavos: 7000, fecha: "2026-10-02", creado: "x", actor: "x", anulado: true });
    expect(cobradoFilaPagado(25000, p.cuotas[0])).toBe(5000);
  });
  it("vaciar la fila Pagado la quita y queda en el historial", () => {
    for (const monto of ["", "0", "0,00"]) {
      const sin = modificarPlan(conPagado(), { tipo: "editar", datos: entrada(monto) }, op, "Closer", ahora);
      expect(sin.cuotas.some((c) => c.inicial)).toBe(false);
      expect(sin.eventos.at(-1)?.texto).toMatch(/Pagado quitado \(USD\s200,00 del 01\/10\/2026\)/);
    }
  });
  it("no se quita si además tiene gestiones u otros pagos", () => {
    const p = conPagado();
    p.cuotas[0].gestiones.push({ fecha: "2026-10-02T15:00:00Z", tipo: "aviso", actor: "x" });
    expect(() => leerPlan(entrada(""), p, "x", ahora)).toThrow(/historial/);
    // Datos viejos: un pago extra sobre la fila (id distinto del de la cuota), vigente o anulado, también es historial
    for (const anulado of [false, true]) {
      const q = conPagado();
      q.cuotas[0].pagos.push({ id: op, centavos: 5000, fecha: "2026-10-02", creado: "x", actor: "x", anulado });
      expect(() => leerPlan(entrada(""), q, "x", ahora)).toThrow(/historial/);
    }
  });
  it("corregir o agregar lo pagado deja rastro en el historial", () => {
    const p = conPagado();
    const corregido = modificarPlan(p, { tipo: "editar", datos: entrada("250") }, op, "Closer", ahora);
    expect(corregido.eventos.at(-1)?.texto).toMatch(/Pagado corregido: USD\s200,00 del 01\/10\/2026 → USD\s250,00 del 01\/10\/2026$/);
    expect(cobrado(corregido.cuotas[0])).toBe(25000);
    const sinPagado = leerPlan(entrada(""), undefined, "x", ahora);
    const agregado = modificarPlan(sinPagado, { tipo: "editar", datos: entrada("100") }, op, "Closer", ahora);
    expect(agregado.eventos.at(-1)?.texto).toMatch(/Pagado agregado/);
    expect(modificarPlan(p, { tipo: "editar", datos: entrada("200") }, id, "Closer", ahora).eventos.at(-1)?.texto).toBe("Plan actualizado");
  });
  it("editar no toca el plan original (el evento va solo en el nuevo)", () => {
    const p = conPagado();
    modificarPlan(p, { tipo: "editar", datos: entrada("250") }, op, "Closer", ahora);
    expect(p.eventos).toHaveLength(0);
    expect(p.cuotas[0].centavos).toBe(20000);
  });
  it("las cuotas siguen numerándose sin contar la fila Pagado", () => {
    const p = modificarPlan(conPagado(), { tipo: "pago", cuota, monto: "300", fecha: "2026-10-10" }, op, "Closer", ahora);
    expect(p.eventos.at(-1)?.texto).toMatch(/^Cuota 1: recibido/);
    expect(numeroDeCuota(p, p.cuotas[2])).toBe(2);
  });
});

describe("Pago coordinado de una cuota ya pagada", () => {
  it("copiar plan no muestra la fecha coordinada si la cuota está pagada", () => {
    let p = modificarPlan(plan(), { tipo: "promesa", cuota, fecha: "2026-10-15" }, op, "Closer", ahora);
    expect(textoPlan(p, "x")).toContain("pago coordinado para 15/10/2026");
    p = modificarPlan(p, { tipo: "pago", cuota, monto: "300", fecha: "2026-10-10" }, id, "Closer", ahora);
    expect(p.cuotas[0].promesa).toBe("2026-10-15");
    expect(textoPlan(p, "x")).not.toContain("pago coordinado");
    expect(textoPlan(p, "x")).toContain("· pagada");
  });
});

describe("Próxima cuota sugerida", () => {
  it("propone el mismo día del mes siguiente, o el último día si el mes es más corto", () => {
    expect(sumarMes("2026-10-10")).toBe("2026-11-10");
    expect(sumarMes("2026-12-15")).toBe("2027-01-15");
    expect(sumarMes("2027-01-31")).toBe("2027-02-28");
    expect(sumarMes("2028-01-31")).toBe("2028-02-29");
    expect(sumarMes("2026-08-31")).toBe("2026-09-30");
    expect(sumarMes("")).toBe("");
  });
});
