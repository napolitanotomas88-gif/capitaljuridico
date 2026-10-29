// Reagendar desde Calendly (pedidos de Tomás del 19 y 22/10/2026). Mover el evento en Google Calendar NO lo mueve en Calendly
// (la sincronización es de Calendly hacia Google, no al revés) y el horario viejo queda ocupado. Por eso:
//   1. El botón "Reagendar en Calendly" (tarjetas de Pre-call y No-show) abre el link de reprogramación del lead en Calendly
//      (`linkReprogramacion`): el closer elige el horario nuevo y Calendly libera el viejo y mueve el evento en Google Calendar.
//      Para que quede con el MISMO closer, cada evento round robin "Reunión Consultiva" tiene que tener en Calendly
//      Hosts → Rescheduling preferences = "Use same hosts as original meeting" (por defecto vuelve a sortear el closer).
//      Si la reunión ya pasó (Calendly no deja reprogramarla), abre el evento "Reunión Consultiva - Reagenda <closer>" del
//      closer de esa reunión, con los datos del lead.
//   2. Calendly avisa al webhook (/api/calendly-webhook: invitee.created con `old_invitee`, o una reserva del evento Reagenda)
//      y la fila del lead se actualiza sola (`aplicarReprogramacion` / `aplicarReagendaNueva`): R = No (no se presentó a la
//      primera), T vacía, AC = fecha y hora nuevas, AH = ese día (los seguimientos de no-show esperan a la reunión nueva) y una
//      nota en AB. Decisión de Tomás: el CRM toma la fecha nueva para todo el proceso que sigue (el pre-call apunta a AC; ese
//      día vuelve la tarjeta de No-show para registrar si se presentó a la reagenda).
import { VALORES } from "@/lib/crm/config/crm";
import { hojasClosers } from "@/lib/crm/config";
import type { Cambios } from "@/lib/crm/contratos";
import { formatearFechaSheet, parsearFechaReagenda, parsearFechaSheet, partesFecha } from "@/lib/crm/fechas";
import { aplicarCambios } from "@/lib/crm/sheets/escribir";
import { invalidarCache, leerHojas } from "@/lib/crm/sheets/leer";
import type { FilaLead } from "@/lib/crm/sheets/columnas";

const API = "https://api.calendly.com";
/** Margen para reconocer la reunión de la fila en Calendly (la planilla guarda la hora redondeada). */
const TOLERANCIA_MS = 10 * 60 * 1000;
const MAX_NOTA = 50_000;

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const es = (valor: string, esperado: string) => normalizar(valor) === normalizar(esperado);
const ultimos8 = (t: string) => {
  const d = (t ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : "";
};
const dos = (n: number) => String(n).padStart(2, "0");
const corto = (f: Date) => {
  const p = partesFecha(f);
  return `${dos(p.dia)}/${dos(p.mes)} ${dos(p.hora)}:${dos(p.minuto)}`;
};

/**
 * La reunión a la que apunta hoy la fila: la reagenda (AC) si el lead no se presentó a la primera y todavía no se registró si
 * vino a la reagenda (R = No, T no es Si); si no, la call (D). Es la que se compara con el evento de Calendly.
 */
export function reunionActual(fila: FilaLead): Date | null {
  const v = fila.valores;
  const call = parsearFechaSheet(v.fechaCall);
  if (!call) return null;
  if (es(v.presentoAgenda1, VALORES.no) && !es(v.presentoReagenda, VALORES.si) && v.fechaReagenda.trim()) {
    return parsearFechaReagenda(v.fechaReagenda, call) ?? call;
  }
  return call;
}

export type Invitado = { email: string; telefono: string };

/**
 * Las filas que son de ese invitado (mail o últimos 8 dígitos del teléfono) y cuya reunión actual es `inicio` (±10 min).
 * Con `inicioNuevo`, también la fila cuya call (D) ya tiene la fecha nueva: Make (Calendly CRM 5924157) llegó a reescribir D
 * en las reprogramaciones y puede adelantarse al webhook.
 */
export function filasDeLaReunion(filas: readonly FilaLead[], invitado: Invitado, inicio: Date, inicioNuevo?: Date): FilaLead[] {
  const mail = normalizar(invitado.email);
  const tel = ultimos8(invitado.telefono);
  return filas.filter((f) => {
    const mismoLead = (mail && normalizar(f.valores.email) === mail) || (tel && ultimos8(f.valores.telefono) === tel);
    if (!mismoLead) return false;
    const reunion = reunionActual(f);
    if (reunion && Math.abs(reunion.getTime() - inicio.getTime()) <= TOLERANCIA_MS) return true;
    const call = inicioNuevo ? parsearFechaSheet(f.valores.fechaCall) : null;
    return !!call && Math.abs(call.getTime() - inicioNuevo!.getTime()) <= TOLERANCIA_MS && !es(f.valores.presentoAgenda1, VALORES.si);
  });
}

/**
 * Los cambios de una reprogramación (y lo que esas celdas tienen hoy, para no pisar otro cambio). null si la fila no está
 * en una etapa en la que corresponda: ya se presentó a una reunión (R = Si) o ya cerró.
 */
export function cambiosDeReprogramacion(
  fila: FilaLead,
  viejo: Date,
  nuevo: Date,
  ahora: Date,
  como = "Reprogramado en Calendly",
): { cambios: Cambios; esperado: Cambios } | null {
  const v = fila.valores;
  if (es(v.presentoAgenda1, VALORES.si)) return null;
  if (es(v.situacion, VALORES.cerradoEnLlamada) || es(v.situacion, VALORES.cerradoEnSeguimiento)) return null;
  const p = partesFecha(nuevo);
  const diaNuevo = parsearFechaSheet(`${p.dia}/${p.mes}/${p.anio}`)!;
  const nota = `${como} el ${corto(ahora).slice(0, 5)}: de ${corto(viejo)} a ${corto(nuevo)}.`;
  const datos = v.datosReagenda.trim() ? `${nota}\n${v.datosReagenda.trim()}` : nota;
  const cambios: Cambios = {
    presentoAgenda1: VALORES.no,
    presentoReagenda: "",
    fechaReagenda: formatearFechaSheet(nuevo),
    proximoSeguimiento: formatearFechaSheet(diaNuevo),
    datosReagenda: datos.slice(0, MAX_NOTA),
  };
  const esperado = Object.fromEntries(Object.keys(cambios).map((c) => [c, v[c as keyof typeof v]])) as Cambios;
  return { cambios, esperado };
}

// ---------------------------------------------------------------------------------------
// Calendly (cuenta de ventas)

async function calendly(): Promise<{ h: Record<string, string>; org: string } | null> {
  const token = process.env.CALENDLY_VENTAS_TOKEN || process.env.CALENDLY_TOKEN;
  if (!token) return null;
  const h = { Authorization: `Bearer ${token}` };
  const me = (await (await fetch(`${API}/users/me`, { headers: h })).json()) as { resource?: { current_organization?: string } };
  const org = me.resource?.current_organization;
  return org ? { h, org } : null;
}

type EventoAPI = { uri: string; start_time: string; status?: string; event_memberships?: { user?: string; user_name?: string }[] };
type InvitadoAPI = { email?: string; text_reminder_number?: string | null; reschedule_url?: string; status?: string };
type TipoAPI = {
  uri: string;
  name: string;
  active: boolean;
  scheduling_url: string;
  /** El dueño del evento (la cuenta dueña de la organización también lista los de los closers). */
  profile?: { owner?: string; name?: string } | null;
  custom_questions?: { type: string; position: number; enabled: boolean }[];
};

/** Evento "Reunión Consultiva - Reagenda <closer>" (individual, uno por closer) para reagendar una reunión que ya pasó. */
export type EventoReagenda = { duenio: string; nombreDuenio: string; url: string; preguntaTelefono: number | null };

/** Los eventos de reagenda activos de la organización (uno por closer). */
async function eventosReagenda(api: { h: Record<string, string>; org: string }): Promise<EventoReagenda[]> {
  const miembros = (await (await fetch(`${API}/organization_memberships?organization=${encodeURIComponent(api.org)}&count=100`, { headers: api.h })).json()) as {
    collection?: { user: { uri: string; name: string } }[];
  };
  const listas = await Promise.all(
    (miembros.collection ?? []).map(async ({ user }) => {
      const j = (await (await fetch(`${API}/event_types?user=${encodeURIComponent(user.uri)}&active=true&count=100`, { headers: api.h })).json()) as { collection?: TipoAPI[] };
      return (j.collection ?? [])
        .filter((t) => t.active && /reagenda/i.test(t.name) && /consultiva/i.test(t.name))
        .map((t) => {
          const tel = (t.custom_questions ?? []).find((q) => q.enabled && q.type === "phone_number");
          const duenio = t.profile?.owner ?? user.uri;
          return { duenio, nombreDuenio: t.profile?.name ?? user.name, url: t.scheduling_url, preguntaTelefono: tel ? tel.position : null };
        });
    }),
  );
  // Un evento por link: el mismo aparece en la lista de su closer y en la de la cuenta dueña
  return [...new Map(listas.flat().map((e) => [e.url, e])).values()];
}

/**
 * Closer de cada pestaña, para cuando la reunión que pasó no aparece en Calendly (mail distinto, evento cancelado) y la pestaña
 * no tiene un único usuario asignado en el Despacho. Cambiar acá si una pestaña cambia de closer.
 */
export const CLOSER_DE_PESTANA: Readonly<Record<string, string>> = {
  "Closer 1": "Carlos",
  "Closer 2": "Marcos",
  "Closer 3": "Yamila",
  // Closers nuevos (26/10/2026). Hasta que tengan su evento "Reunión Consultiva - Reagenda <nombre>" en Calendly, la reagenda
  // de una reunión que ya pasó en estas pestañas avisa que hay que hacerla a mano.
  "Closer 4": "Nahuel",
  "Closer 5": "Brenda",
};

/**
 * El evento de reagenda del closer: el anfitrión de la reunión que pasó o, si no se sabe, el dueño de la pestaña (por su
 * nombre en el Despacho o, si no, por `CLOSER_DE_PESTANA`).
 */
export function elegirEventoReagenda(eventos: readonly EventoReagenda[], anfitrion: string | null, closerDeHoja: string, hoja = ""): EventoReagenda | null {
  const porAnfitrion = anfitrion ? eventos.find((e) => e.duenio === anfitrion) : undefined;
  if (porAnfitrion) return porAnfitrion;
  for (const nombre of [closerDeHoja, CLOSER_DE_PESTANA[hoja] ?? ""]) {
    const primerNombre = normalizar(nombre).split(/\s+/)[0] ?? "";
    const porNombre = primerNombre ? eventos.filter((e) => normalizar(e.nombreDuenio).split(/\s+/)[0] === primerNombre) : [];
    if (porNombre.length === 1) return porNombre[0];
  }
  return null;
}

/** Link al evento de reagenda con el nombre, el mail y (si el evento lo pregunta) el celular del lead ya cargados. */
export function linkConDatos(evento: EventoReagenda, fila: FilaLead): string {
  const u = new URL(evento.url);
  const { nombre, email, telefono } = fila.valores;
  if (nombre.trim()) u.searchParams.set("name", nombre.trim());
  if (email.trim()) u.searchParams.set("email", email.trim());
  const digitos = telefono.replace(/\D/g, "");
  if (evento.preguntaTelefono !== null && digitos.length >= 8) u.searchParams.set(`a${evento.preguntaTelefono + 1}`, `+${digitos}`);
  return u.toString();
}

/**
 * La reunión actual del lead (la de la fila) en Calendly: busca por mail (y, sin mail, por las reuniones de esa hora con el
 * mismo teléfono) en ±10 min. `evento` null si no está (mail distinto, cancelada).
 */
async function buscarReunion(
  fila: FilaLead,
): Promise<
  | { error: string }
  | { reunion: Date; api: { h: Record<string, string>; org: string }; evento: { ev: EventoAPI; invitado: InvitadoAPI } | null }
> {
  const reunion = reunionActual(fila);
  if (!reunion) return { error: "La fila no tiene una fecha de reunión legible." };
  const api = await calendly();
  if (!api) return { error: "Calendly no está conectado (falta CALENDLY_VENTAS_TOKEN)." };
  const desde = new Date(reunion.getTime() - TOLERANCIA_MS).toISOString();
  const hasta = new Date(reunion.getTime() + TOLERANCIA_MS).toISOString();
  const mail = fila.valores.email.trim();
  const q = new URLSearchParams({ organization: api.org, status: "active", min_start_time: desde, max_start_time: hasta, count: "20" });
  if (mail) q.set("invitee_email", mail);
  const r = await fetch(`${API}/scheduled_events?${q}`, { headers: api.h });
  if (!r.ok) return { error: `Calendly respondió ${r.status} al buscar la reunión.` };
  const eventos = ((await r.json()) as { collection?: EventoAPI[] }).collection ?? [];
  const tel = ultimos8(fila.valores.telefono);
  for (const ev of eventos) {
    const inv = (await (await fetch(`${ev.uri}/invitees?status=active`, { headers: api.h })).json()) as { collection?: InvitadoAPI[] };
    const invitado = (inv.collection ?? []).find(
      (i) => (mail && normalizar(i.email ?? "") === normalizar(mail)) || (tel && ultimos8(i.text_reminder_number ?? "") === tel),
    );
    if (invitado) return { reunion, api, evento: { ev, invitado } };
  }
  return { reunion, api, evento: null };
}

/**
 * El link para reagendar la reunión actual del lead (la de la fila):
 *   - si todavía no empezó: su link de reprogramación de Calendly (mueve el evento y libera el horario viejo; con el mismo
 *     closer si el evento round robin tiene "Use same hosts as original meeting");
 *   - si ya pasó (Calendly no deja reprogramarla): el evento "Reagenda" del closer de esa reunión (o del dueño de la pestaña),
 *     con los datos del lead cargados. Esa reserva nueva la toma el webhook (`aplicarReagendaNueva`).
 * `{ error }` si no se puede: el botón explica que hay que hacerlo a mano.
 */
export async function linkReprogramacion(
  fila: FilaLead,
  closerDeHoja = fila.hoja,
  ahora = new Date(),
): Promise<{ url: string } | { error: string }> {
  const b = await buscarReunion(fila);
  if ("error" in b) return b;
  const { reunion, api, evento } = b;
  if (evento && new Date(evento.ev.start_time).getTime() > ahora.getTime() && evento.invitado.reschedule_url)
    return { url: evento.invitado.reschedule_url };
  const anfitrion = evento?.ev.event_memberships?.[0]?.user ?? null;
  if (anfitrion || reunion.getTime() <= ahora.getTime()) {
    const reagenda = elegirEventoReagenda(await eventosReagenda(api), anfitrion, closerDeHoja, fila.hoja);
    if (reagenda) return { url: linkConDatos(reagenda, fila) };
    return { error: `La reunión del ${corto(reunion)} ya pasó y no encontré en Calendly el evento "Reunión Consultiva - Reagenda" de ${closerDeHoja}.` };
  }
  const mail = fila.valores.email.trim();
  return { error: `No encontré en Calendly la reunión del ${corto(reunion)} de este lead${mail ? ` (${mail})` : ""}.` };
}

/**
 * Cancela en Calendly la reunión actual del lead (botón "Cancelar reunión" del Pre-call, pedido de Tomás del 19/10/2026).
 * Solo si todavía no empezó. Calendly libera el horario, saca el evento del calendario del closer y le avisa al lead por mail
 * (eso no se puede apagar desde la API). `{ cuando }` = "21/10 13:00" de la reunión cancelada.
 */
export async function cancelarEnCalendly(fila: FilaLead, ahora = new Date()): Promise<{ cuando: string } | { error: string }> {
  const b = await buscarReunion(fila);
  if ("error" in b) return b;
  if (b.reunion.getTime() <= ahora.getTime()) return { error: `La reunión del ${corto(b.reunion)} ya pasó: no se puede cancelar.` };
  if (!b.evento) return { error: `No encontré en Calendly la reunión del ${corto(b.reunion)} de este lead (¿ya estaba cancelada?).` };
  const r = await fetch(`${b.evento.ev.uri}/cancellation`, {
    method: "POST",
    headers: { ...b.api.h, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Reunión cancelada." }),
  });
  if (!r.ok) return { error: `Calendly respondió ${r.status} al cancelar la reunión.` };
  return { cuando: corto(new Date(b.evento.ev.start_time)) };
}

export type ResultadoReprogramacion =
  | { ok: true; hoja: string; fila: number; lead: string; de: string; a: string }
  | { ok: false; motivo: string };

/**
 * Aplica una reprogramación avisada por Calendly (invitee.created con `old_invitee`): busca la fila del lead cuya reunión
 * actual es la vieja y la actualiza (`cambiosDeReprogramacion`), con la escritura segura del CRM (verifica que la fila sea el
 * mismo lead y que nadie la haya cambiado, y queda en el Log App como "Calendly").
 */
export async function aplicarReprogramacion(p: {
  oldInvitee: string;
  email?: string;
  telefono?: string;
  inicioNuevo?: string;
}): Promise<ResultadoReprogramacion> {
  const nuevo = p.inicioNuevo ? new Date(p.inicioNuevo) : null;
  if (!nuevo || isNaN(nuevo.getTime())) return { ok: false, motivo: "la reprogramación no trae la fecha nueva" };
  const api = await calendly();
  if (!api) return { ok: false, motivo: "falta CALENDLY_VENTAS_TOKEN" };
  // La reunión vieja: el evento del invitado anterior
  const uriEvento = p.oldInvitee.replace(/\/invitees\/[^/]+$/, "");
  const ev = (await (await fetch(uriEvento, { headers: api.h })).json()) as { resource?: { start_time?: string } };
  const viejo = ev.resource?.start_time ? new Date(ev.resource.start_time) : null;
  if (!viejo || isNaN(viejo.getTime())) return { ok: false, motivo: "no se pudo leer la reunión anterior en Calendly" };

  invalidarCache();
  const hojas = await leerHojas(hojasClosers());
  const candidatas = [...hojas.values()].flatMap((filas) => filasDeLaReunion(filas, { email: p.email ?? "", telefono: p.telefono ?? "" }, viejo, nuevo));
  if (candidatas.length === 0) return { ok: false, motivo: `no encontré en el CRM el lead ${p.email ?? ""} con reunión el ${corto(viejo)}` };
  if (candidatas.length > 1) return { ok: false, motivo: `hay ${candidatas.length} filas posibles para ${p.email ?? ""} (${corto(viejo)}): no se tocó ninguna` };
  const fila = candidatas[0];
  const plan = cambiosDeReprogramacion(fila, viejo, nuevo, new Date());
  if (!plan) return { ok: false, motivo: `${fila.valores.nombre} (${fila.hoja}, fila ${fila.numeroFila}) ya se presentó o cerró: no se tocó` };
  const { nombre, telefono, fechaCall } = fila.valores;
  await aplicarCambios({
    hoja: fila.hoja,
    numeroFila: fila.numeroFila,
    nombre,
    telefono,
    fechaCall,
    closer: "Calendly",
    cambios: plan.cambios,
    esperado: plan.esperado,
    motivo: `CALENDLY · Reprogramado: de ${corto(viejo)} a ${corto(nuevo)}`,
    modo: "accion",
    // No es un toque del closer: no mueve el "último toque" (AG)
    tocar: false,
  });
  return { ok: true, hoja: fila.hoja, fila: fila.numeroFila, lead: nombre, de: corto(viejo), a: corto(nuevo) };
}

/**
 * La fila que corresponde a una reserva del evento "Reagenda" (reunión que ya pasó): del mismo lead (mail o teléfono), en una
 * etapa en la que se puede reagendar (no se presentó y no cerró) y con su reunión actual ANTES del horario nuevo. Si el lead
 * tiene varias, la de la reunión más reciente; si empatan, ninguna (ambigua). Si la reunión actual ya es la nueva (Calendly
 * reintentó el webhook), no hay nada que hacer.
 */
export function filaDeLaReagendaNueva(
  filas: readonly FilaLead[],
  invitado: Invitado,
  inicioNuevo: Date,
): { fila: FilaLead; viejo: Date } | { motivo: string } {
  const mail = normalizar(invitado.email);
  const tel = ultimos8(invitado.telefono);
  const delLead = filas.filter((f) => (mail && normalizar(f.valores.email) === mail) || (tel && ultimos8(f.valores.telefono) === tel));
  if (delLead.length === 0) return { motivo: `no encontré en el CRM el lead ${invitado.email}` };
  if (delLead.some((f) => Math.abs((reunionActual(f)?.getTime() ?? 0) - inicioNuevo.getTime()) <= TOLERANCIA_MS))
    return { motivo: `la reagenda de ${invitado.email} ya estaba cargada` };
  const posibles = delLead
    .map((fila) => ({ fila, viejo: reunionActual(fila) }))
    .filter((c): c is { fila: FilaLead; viejo: Date } => !!c.viejo && c.viejo.getTime() < inicioNuevo.getTime())
    .filter((c) => cambiosDeReprogramacion(c.fila, c.viejo, inicioNuevo, inicioNuevo) !== null)
    .sort((a, b) => b.viejo.getTime() - a.viejo.getTime());
  if (posibles.length === 0) return { motivo: `${invitado.email} no tiene una reunión anterior para reagendar (ya se presentó o cerró)` };
  if (posibles.length > 1 && Math.abs(posibles[0].viejo.getTime() - posibles[1].viejo.getTime()) <= TOLERANCIA_MS)
    return { motivo: `hay ${posibles.length} filas posibles para ${invitado.email}: no se tocó ninguna` };
  return posibles[0];
}

/**
 * Aplica una reserva del evento "Reunión Consultiva - Reagenda <closer>" (lead cuya reunión ya pasó, Calendly no la deja
 * reprogramar): los mismos cambios que una reprogramación (R = No, T vacía, AC = horario nuevo, AH = ese día, nota en AB),
 * con la escritura segura del CRM y en el Log App como "Calendly".
 */
export async function aplicarReagendaNueva(p: {
  email?: string;
  telefono?: string;
  inicioNuevo?: string;
  /** Closer de la reunión nueva, para la nota. */
  closerNuevo?: string;
}): Promise<ResultadoReprogramacion> {
  const nuevo = p.inicioNuevo ? new Date(p.inicioNuevo) : null;
  if (!nuevo || isNaN(nuevo.getTime())) return { ok: false, motivo: "la reserva no trae la fecha" };
  const con = p.closerNuevo?.trim() ? ` con ${p.closerNuevo.trim()}` : "";
  invalidarCache();
  const hojas = await leerHojas(hojasClosers());
  const elegida = filaDeLaReagendaNueva([...hojas.values()].flat(), { email: p.email ?? "", telefono: p.telefono ?? "" }, nuevo);
  if ("motivo" in elegida) return { ok: false, motivo: elegida.motivo };
  const { fila, viejo } = elegida;
  const plan = cambiosDeReprogramacion(fila, viejo, nuevo, new Date(), `Reagendado en Calendly${con} (la reunión ya había pasado)`);
  if (!plan) return { ok: false, motivo: `${fila.valores.nombre} (${fila.hoja}, fila ${fila.numeroFila}) ya se presentó o cerró: no se tocó` };
  const { nombre, telefono, fechaCall } = fila.valores;
  await aplicarCambios({
    hoja: fila.hoja,
    numeroFila: fila.numeroFila,
    nombre,
    telefono,
    fechaCall,
    closer: "Calendly",
    cambios: plan.cambios,
    esperado: plan.esperado,
    motivo: `CALENDLY · Reagendado${con}: de ${corto(viejo)} a ${corto(nuevo)}`,
    modo: "accion",
    tocar: false,
  });
  return { ok: true, hoja: fila.hoja, fila: fila.numeroFila, lead: nombre, de: corto(viejo), a: corto(nuevo) };
}

/** La nota en AB de una reunión cancelada desde el CRM, arriba de lo que ya había. */
export function notaCancelacion(cuando: string, quien: string, anterior: string, ahora: Date): string {
  const nota = `Reunión del ${cuando} cancelada en Calendly${quien.trim() ? ` por ${quien.trim()}` : ""} el ${corto(ahora).slice(0, 5)}.`;
  return (anterior.trim() ? `${nota}\n${anterior.trim()}` : nota).slice(0, MAX_NOTA);
}
