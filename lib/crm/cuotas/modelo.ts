import { ZONA_NEGOCIO } from "@/lib/crm/fechas";

export type Pago = {
  id: string;
  centavos: number;
  fecha: string;
  creado: string;
  actor: string;
  anulado?: boolean;
};
export type Gestion = { fecha: string; tipo: "aviso" | "cobro"; actor: string };
// Concepto de cada cuota (10/10/2026, pedido de Tomás): reserva, cuota o completa pago
export const CONCEPTOS_CUOTA = ["reserva", "cuota", "completa_pago"] as const;
export type ConceptoCuota = (typeof CONCEPTOS_CUOTA)[number];
export const ETIQUETA_CONCEPTO_CUOTA: Record<ConceptoCuota, string> = { reserva: "Reserva", cuota: "Cuota", completa_pago: "Completa pago" };
export type Cuota = {
  id: string;
  vencimiento: string;          // en la fila "Pagado" (inicial), la fecha en que se pagó
  centavos: number;
  concepto?: ConceptoCuota;
  inicial?: boolean;            // fila "Pagado": lo que el cliente YA pagó al armar el plan (se guarda como cuota cobrada)
  promesa?: string;
  pagos: Pago[];
  gestiones: Gestion[];
};
export type Evento = {
  id: string;
  fecha: string;
  actor: string;
  texto: string;
};
export type Plan = {
  id: string;
  responsable: string;
  nombre: string;
  telefono: string;
  concepto: "venta" | "renovacion";
  notas: string;
  abandonado: boolean;
  origen?: string;
  cuotas: Cuota[];
  eventos: Evento[];
};
export type RegistroPlan = { plan: Plan; version: number };
export type EntradaPlan = {
  id: string;
  responsable: string;
  nombre: string;
  telefono: string;
  concepto: string;
  notas: string;
  cuotas: { id: string; fecha: string; monto: string; concepto?: string; pagado?: boolean }[];
};
export type Cambio =
  | { tipo: "gestion"; cuota: string }
  | { tipo: "pago"; cuota: string; monto: string; fecha: string }
  | { tipo: "anular"; cuota: string; pago: string }
  | { tipo: "promesa"; cuota: string; fecha: string }
  | { tipo: "abandono" }
  | { tipo: "reactivar" }
  | { tipo: "editar"; datos: EntradaPlan };
export type Grupo = "avisar" | "hoy" | "vencidas";
export type Tarea = {
  grupo: Grupo;
  texto: string;
  proxima: string;
  lista: boolean;
};
export const uuidValido = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s);
export function fechaValida(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T12:00:00Z`);
  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === x &&
    +x.slice(0, 4) >= 2000 &&
    +x.slice(0, 4) <= 2100
  );
}
export function hoyBA(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_NEGOCIO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}
export const diaSemana = (fecha: string) =>
  new Date(`${fecha}T12:00:00Z`).getUTCDay();
export function sumarDias(fecha: string, n: number) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Mismo día del mes siguiente; si ese mes es más corto, su último día (31/01 → 28/02). Para proponer la próxima cuota. */
export function sumarMes(fecha: string) {
  if (!fechaValida(fecha)) return fecha;
  const [a, m, d] = fecha.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
export const sinDomingo = (fecha: string) =>
  diaSemana(fecha) === 0 ? sumarDias(fecha, 1) : fecha;
export function inicioAviso(fecha: string) {
  let f = fecha;
  for (let n = 0; n < 5; ) {
    f = sumarDias(f, -1);
    if (diaSemana(f) !== 0) n++;
  }
  return f;
}
export function montoCentavos(x: unknown): number {
  if (typeof x !== "string" || !/^\d{1,8}(?:[.,]\d{1,2})?$/.test(x.trim()))
    throw new Error(
      "Ingresá un importe en USD, sin separadores de miles y con hasta dos decimales.",
    );
  const [entero, decimal = ""] = x.trim().replace(",", ".").split(".");
  const n = +entero * 100 + +decimal.padEnd(2, "0");
  if (n <= 0 || n > 100_000_000)
    throw new Error("El importe debe estar entre USD 0,01 y USD 1.000.000.");
  return n;
}
export const cobrado = (c: Cuota) =>
  c.pagos.filter((p) => !p.anulado).reduce((s, p) => s + p.centavos, 0);
export const saldo = (c: Cuota) => c.centavos - cobrado(c);
/** Lo que falta cobrar de una cuota en el tablero, los saldos y el texto copiado: la fila "Pagado" nunca se cobra */
export const porCobrar = (c: Cuota) => (c.inicial ? 0 : saldo(c));
/** Fila "Pagado" cuyo pago inicial (id = id de la cuota) quedó anulado: datos de antes del 10/10, cuando se podía anular */
export const pagoInicialAnulado = (c: Cuota) =>
  !!c.inicial && c.pagos.some((p) => p.id === c.id && p.anulado);
/**
 * Lo que queda cobrado en la fila "Pagado" si se guarda con este importe (el "Ya pagado" de Editar plan), igual que lo arma
 * leerPlan: el importe más los otros pagos vigentes de la fila. Si su pago inicial quedó anulado, editar no lo revive y el
 * importe no cuenta. Vacía (0) no se guarda.
 */
export function cobradoFilaPagado(centavos: number, vieja?: Cuota) {
  if (centavos <= 0) return 0;
  const otros = vieja ? cobrado({ ...vieja, pagos: vieja.pagos.filter((p) => p.id !== vieja.id) }) : 0;
  return (vieja && pagoInicialAnulado(vieja) ? 0 : centavos) + otros;
}
/**
 * Una cuota con gestiones o pagos tiene historial y no se quita del plan. La fila "Pagado" sí se quita (vaciándola) si lo único
 * que tiene es su propio pago inicial, vigente o anulado: así se corrige una carga por error. Lo usan leerPlan y Editar plan
 */
export const cuotaConHistorial = (c: Cuota) =>
  c.gestiones.length > 0 || c.pagos.some((p) => !(c.inicial && p.id === c.id));
/**
 * Aviso de Editar plan cuando el pago inicial de la fila "Pagado" quedó anulado (datos de antes del 10/10): editar no lo revive,
 * así que dice qué hacer si el cliente sí pagó. Vaciar la fila y cargarla de nuevo solo se aconseja si se puede quitar: con otros
 * pagos o gestiones, leerPlan la rechaza ("No podés quitar una cuota que tiene historial.")
 */
export function avisoPagoInicialAnulado(c: Cuota, abandonado = false): string | null {
  if (!pagoInicialAnulado(c)) return null;
  const base = "El pago de la fila Pagado está anulado: cambiar el importe no lo vuelve a contar.";
  if (!cuotaConHistorial(c)) return `${base} Si el cliente sí pagó, vaciá la fila, guardá y cargala de nuevo.`;
  // Un pago de más vigente sobre la fila (el "Registrar pago" de antes) ya suma en "Ya pagado"
  if (cobrado(c) > 0) return `${base} Los otros pagos de esa fila que siguen vigentes ya cuentan en "Ya pagado".`;
  return `${base} La fila tiene otros registros y no se puede quitar: si el cliente sí pagó, agregá una cuota por ese importe, guardá y registrá el pago desde el detalle del plan${
    abandonado ? " (antes reactivalo)" : ""
  }.`;
}
export const dolares = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
  }).format(n / 100);
export const fechaCorta = (f: string) => f.split("-").reverse().join("/");
export function tarea(c: Cuota, ahora = new Date()): Tarea | null {
  // La fila "Pagado" no es una cuota a cobrar: nunca va a las columnas (aunque su pago haya quedado anulado en datos viejos)
  if (c.inicial || saldo(c) <= 0) return null;
  const hoy = hoyBA(ahora);
  const base = c.promesa || c.vencimiento;
  const cobro = hoy >= base;
  const grupo: Grupo =
    hoy > base ? "vencidas" : hoy === base ? "hoy" : "avisar";
  if (c.promesa && hoy < c.promesa)
    return {
      grupo,
      texto: "Pago coordinado",
      proxima: sinDomingo(c.promesa),
      lista: false,
    };
  const gestiones = c.gestiones.filter(
    (g) => g.tipo === (cobro ? "cobro" : "aviso"),
  );
  const ultima = gestiones.at(-1);
  let proxima = cobro ? sinDomingo(base) : inicioAviso(c.vencimiento);
  let texto = cobro ? "Pedir el pago" : "Enviar aviso previo";
  if (ultima) {
    const espera = cobro ? (gestiones.length === 3 ? 2 : 1) : 2;
    proxima = sinDomingo(sumarDias(hoyBA(new Date(ultima.fecha)), espera));
    texto = cobro
      ? `Hacer seguimiento ${gestiones.length}`
      : "Volver a coordinar el pago";
  }
  return {
    grupo,
    texto,
    proxima,
    lista: diaSemana(hoy) !== 0 && hoy >= proxima,
  };
}
export function puedeAcceder(
  rol: string,
  closerId: string | undefined,
  responsable: string,
) {
  return (
    rol === "admin" ||
    (rol === "closer" && !!closerId && responsable === closerId)
  );
}
function texto(x: unknown, max: number, obligatorio = false) {
  if (typeof x !== "string" || x.length > max || (obligatorio && !x.trim()))
    throw new Error("Revisá los datos del formulario.");
  return x.trim();
}
/** Número de una cuota para mostrar ("Cuota 2"): la fila "Pagado" no cuenta */
export const numeroDeCuota = (plan: Plan, c: Cuota) => plan.cuotas.filter((x) => !x.inicial).indexOf(c) + 1;
export const cuotasAPagar = (plan: Plan) => plan.cuotas.filter((x) => !x.inicial).length;

export function leerPlan(datos: EntradaPlan, anterior?: Plan, actor = "Alta del plan", ahora = new Date()): Plan {
  // La fila "Pagado" vacía o en 0 (el cliente todavía no pagó nada) no se guarda
  if (datos && Array.isArray(datos.cuotas))
    datos = { ...datos, cuotas: datos.cuotas.filter((c) => !(c?.pagado && /^\s*0*(?:[.,]0*)?\s*$/.test(String(c.monto ?? "")))) };
  if (
    !datos ||
    !uuidValido(datos.id) ||
    !Array.isArray(datos.cuotas) ||
    datos.cuotas.length < 1 ||
    datos.cuotas.length > 60
  )
    throw new Error("Cargá entre 1 y 60 cuotas.");
  if (datos.cuotas.filter((c) => c.pagado).length > 1 || datos.cuotas.some((c, i) => c.pagado && i > 0))
    throw new Error("Lo ya pagado va una sola vez y en la primera fila.");
  if (datos.concepto !== "venta" && datos.concepto !== "renovacion")
    throw new Error("Elegí venta o renovación.");
  const ids = new Set<string>();
  const cuotas = datos.cuotas.map((c) => {
    if (!c || !uuidValido(c.id) || ids.has(c.id) || !fechaValida(c.fecha))
      throw new Error("Revisá las fechas y las cuotas.");
    ids.add(c.id);
    const vieja = anterior?.cuotas.find((x) => x.id === c.id);
    const centavos = montoCentavos(c.monto);
    const concepto: ConceptoCuota = (CONCEPTOS_CUOTA as readonly string[]).includes(c.concepto ?? "") ? (c.concepto as ConceptoCuota) : c.pagado ? "reserva" : "cuota";
    if (c.pagado) {
      // "Pagado": una cuota cobrada desde el alta, con un pago (id = id de la cuota) por el total, en la fecha indicada
      if (c.fecha > hoyBA(ahora)) throw new Error("La fecha de lo ya pagado no puede ser futura.");
      const otros = (vieja?.pagos ?? []).filter((p) => p.id !== c.id);
      const inicialPrevio = vieja?.pagos.find((p) => p.id === c.id);
      // Si el pago inicial quedó anulado (datos de antes del 10/10), editar no lo revive en silencio: sigue anulado tal cual
      const pagoInicial: Pago = inicialPrevio?.anulado
        ? inicialPrevio
        : { id: c.id, centavos, fecha: c.fecha, creado: inicialPrevio?.creado ?? ahora.toISOString(), actor: inicialPrevio?.actor ?? actor };
      const fila: Cuota = { ...vieja, id: c.id, vencimiento: c.fecha, centavos, concepto, inicial: true, pagos: [pagoInicial, ...otros], gestiones: vieja?.gestiones ?? [] };
      // Solo pasa con pagos de más sobre la fila (datos viejos): se anulan desde el detalle del plan y después se corrige el importe.
      // En un plan abandonado el detalle no deja anular (modificarPlan lo rechaza): primero hay que reactivarlo
      if (saldo(fila) < 0)
        throw new Error(
          anterior?.abandonado
            ? "Lo cobrado no puede superar el importe de la fila Pagado. Reactivá el plan, anulá el pago de más desde el detalle y, si corresponde, volvé a marcar el abandono."
            : "Lo cobrado no puede superar el importe de la fila Pagado. Anulá el pago de más desde el detalle del plan.",
        );
      return fila;
    }
    if (vieja && centavos < cobrado(vieja))
      throw new Error("El importe no puede ser menor a lo que ya cobraste.");
    return {
      ...vieja,
      id: c.id,
      vencimiento: c.fecha,
      centavos,
      concepto,
      inicial: undefined,
      pagos: vieja?.pagos ?? [],
      gestiones: vieja?.gestiones ?? [],
    };
  });
  // La fila "Pagado" se puede quitar (vaciándola) si lo único que tiene es su propio pago inicial: así se corrige una carga por error
  if (anterior?.cuotas.some((c) => !ids.has(c.id) && cuotaConHistorial(c)))
    throw new Error("No podés quitar una cuota que tiene historial.");
  return {
    id: datos.id,
    responsable: texto(datos.responsable, 100, true),
    nombre: texto(datos.nombre, 150, true),
    telefono: texto(datos.telefono, 50),
    concepto: datos.concepto,
    notas: texto(datos.notas, 2000),
    abandonado: anterior?.abandonado ?? false,
    origen: anterior?.origen,
    cuotas,
    eventos: anterior?.eventos ?? [],
  };
}
/** Lo ya pagado se cambia solo desde Editar plan: el historial dice qué pasó con la fila "Pagado" */
function cambioPagado(antes: Plan, despues: Plan) {
  const a = antes.cuotas.find((c) => c.inicial);
  const d = despues.cuotas.find((c) => c.inicial);
  if (a && !d)
    return ` · Pagado quitado (${dolares(a.centavos)} del ${fechaCorta(a.vencimiento)}${pagoInicialAnulado(a) ? ", con el pago anulado" : ""})`;
  if (!a && d) return ` · Pagado agregado (${dolares(d.centavos)} del ${fechaCorta(d.vencimiento)})`;
  if (a && d && (a.centavos !== d.centavos || a.vencimiento !== d.vencimiento))
    // Con el pago inicial anulado, editar cambia el importe de la fila pero no lo cobrado: el historial lo dice
    return ` · Pagado corregido: ${dolares(a.centavos)} del ${fechaCorta(a.vencimiento)} → ${dolares(d.centavos)} del ${fechaCorta(d.vencimiento)}${
      pagoInicialAnulado(d) ? ` (el pago sigue anulado: cobrado ${dolares(cobrado(d))})` : ""
    }`;
  return "";
}
export function modificarPlan(
  plan: Plan,
  cambio: Cambio,
  operacion: string,
  actor: string,
  ahora = new Date(),
): Plan {
  if (
    !cambio ||
    ![
      "gestion",
      "pago",
      "anular",
      "promesa",
      "abandono",
      "reactivar",
      "editar",
    ].includes(cambio.tipo)
  )
    throw new Error("Acción inválida.");
  if (!uuidValido(operacion)) throw new Error("Operación inválida.");
  if (plan.eventos.some((e) => e.id === operacion)) return plan;
  let siguiente = structuredClone(plan);
  const fecha = ahora.toISOString();
  let descripcion = "";
  if (cambio.tipo === "editar") {
    if (cambio.datos.id !== plan.id) throw new Error("Plan inválido.");
    // Sobre la copia: leerPlan reutiliza eventos y pagos del plan anterior y acá se les agrega el evento nuevo
    siguiente = leerPlan(cambio.datos, siguiente, actor, ahora);
    descripcion = `Plan actualizado${cambioPagado(plan, siguiente)}`;
  } else if (cambio.tipo === "abandono" || cambio.tipo === "reactivar") {
    siguiente.abandonado = cambio.tipo === "abandono";
    descripcion = siguiente.abandonado
      ? "Servicio abandonado: se detuvo el reclamo"
      : "Plan reactivado";
  } else {
    if (plan.abandonado)
      throw new Error("Reactivá el plan antes de registrar nuevas gestiones.");
    const c = siguiente.cuotas.find((c) => c.id === cambio.cuota);
    if (!c) throw new Error("No se encontró la cuota.");
    // La fila "Pagado" no se cobra, no se gestiona ni se anula su pago inicial: si está mal, se corrige el importe (o se vacía)
    // en Editar plan. Los otros pagos de esa fila (datos de antes del 10/10) sí se anulan: si no, un cobro de más no tendría arreglo
    if (c.inicial && (cambio.tipo !== "anular" || cambio.pago === c.id))
      throw new Error("Lo ya pagado se corrige con Editar plan.");
    const etiqueta = c.inicial ? "Pagado" : `Cuota ${numeroDeCuota(siguiente, c)}`;
    if (cambio.tipo === "pago") {
      const centavos = montoCentavos(cambio.monto);
      if (!fechaValida(cambio.fecha) || cambio.fecha > hoyBA(ahora))
        throw new Error("La fecha del pago no puede ser futura.");
      if (centavos > saldo(c))
        throw new Error("El pago supera el saldo pendiente de esta cuota.");
      c.pagos.push({
        id: operacion,
        centavos,
        fecha: cambio.fecha,
        creado: fecha,
        actor,
      });
      descripcion = `${etiqueta}: recibido ${dolares(centavos)}`;
    } else if (cambio.tipo === "anular") {
      const pago = c.pagos.find((p) => p.id === cambio.pago);
      if (!pago || pago.anulado)
        throw new Error("Ese pago ya está anulado o no existe.");
      pago.anulado = true;
      descripcion = `${etiqueta}: pago anulado (${dolares(pago.centavos)})`;
    } else if (cambio.tipo === "promesa") {
      if (
        cambio.fecha &&
        (!fechaValida(cambio.fecha) || cambio.fecha < hoyBA(ahora))
      )
        throw new Error("Elegí una fecha de hoy en adelante.");
      c.promesa = cambio.fecha || undefined;
      descripcion = `${etiqueta}: ${cambio.fecha ? `pago coordinado para ${fechaCorta(cambio.fecha)}` : "fecha prometida retirada"}`;
    } else if (cambio.tipo === "gestion") {
      if (diaSemana(hoyBA(ahora)) === 0)
        throw new Error(
          "Los domingos no se registran envíos. Retomá el lunes.",
        );
      if (saldo(c) <= 0) throw new Error("La cuota ya está pagada.");
      const tipo =
        hoyBA(ahora) >=
        (c.promesa || c.vencimiento)
          ? "cobro"
          : "aviso";
      if (
        c.gestiones.some(
          (g) => g.tipo === tipo && hoyBA(new Date(g.fecha)) === hoyBA(ahora),
        )
      )
        throw new Error("Ya registraste esta gestión hoy.");
      c.gestiones.push({ fecha, tipo, actor });
      descripcion = `${etiqueta}: ${tipo === "aviso" ? "aviso previo" : "gestión de cobro"} realizada`;
    }
  }
  siguiente.eventos.push({ id: operacion, fecha, actor, texto: descripcion });
  return siguiente;
}

/**
 * "Copiar plan" (10/10/2026, pedido de Tomás): todo el plan como texto para pegar en WhatsApp o donde haga falta, SIN las notas.
 * Cliente, WhatsApp, responsable, tipo, lo ya pagado, cada cuota (monto, vencimiento, concepto, pago coordinado, lo cobrado y
 * los pagos registrados) y los totales.
 */
export function textoPlan(plan: Plan, responsable: string): string {
  const l: string[] = [`Plan de pago · ${plan.nombre}`];
  if (plan.telefono.trim()) l.push(`WhatsApp: ${plan.telefono.trim()}`);
  l.push(`Responsable: ${responsable}`);
  l.push(`Tipo: ${plan.concepto === "venta" ? "Venta inicial" : "Renovación"}${plan.abandonado ? " · Abandonado" : ""}`);
  l.push("");
  for (const c of plan.cuotas) {
    const concepto = ETIQUETA_CONCEPTO_CUOTA[c.concepto ?? (c.inicial ? "reserva" : "cuota")];
    if (c.inicial) {
      l.push(`Pagado: ${dolares(cobrado(c))} · ${fechaCorta(c.vencimiento)} · ${concepto}`);
      continue;
    }
    let t = `Cuota ${numeroDeCuota(plan, c)}: ${dolares(c.centavos)} · vence ${fechaCorta(c.vencimiento)} · ${concepto}`;
    // Una cuota ya pagada no muestra la fecha coordinada (la promesa se conserva por si se anula el pago)
    if (c.promesa && saldo(c) > 0) t += ` · pago coordinado para ${fechaCorta(c.promesa)}`;
    const cob = cobrado(c);
    if (cob > 0) t += saldo(c) <= 0 ? " · pagada" : ` · cobrado ${dolares(cob)}, saldo ${dolares(saldo(c))}`;
    l.push(t);
    for (const p of c.pagos.filter((p) => !p.anulado)) l.push(`   · pago de ${dolares(p.centavos)} el ${fechaCorta(p.fecha)}`);
  }
  // La fila "Pagado" suma lo que efectivamente se cobró: así Pendiente es solo lo que falta de las cuotas
  const total = plan.cuotas.reduce((s, c) => s + (c.inicial ? cobrado(c) : c.centavos), 0);
  const pagado = plan.cuotas.reduce((s, c) => s + cobrado(c), 0);
  l.push("", `Total del plan: ${dolares(total)} · Pagado: ${dolares(pagado)} · Pendiente: ${dolares(plan.cuotas.reduce((s, c) => s + porCobrar(c), 0))}`);
  return l.join("\n");
}
