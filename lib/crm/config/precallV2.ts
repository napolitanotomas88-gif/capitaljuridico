// Pre-call v2 (pedido de Tomás, 5/11/2026): el pre-call se parte en dos. El pre-caller confirma lo que el lead puso en el
// calendario (hasta 2 llamadas seguidas, chat y seguimiento) desde el WhatsApp de Tomás y lo pasa al closer; recién ahí el closer
// lo ve, y sale solo, desde el WhatsApp del closer, el video de traspaso con la cita y el video de pre-llamada (LISTO).
//
// TODO APAGADO hasta que exista el WhatsApp nuevo del pre-caller: `PRECALL_V2=1` lo prende (docs/ENCENDIDO-PRECALL-V2.md).
// Con la bandera apagada nada cambia: ni las tarjetas, ni la columna AI, ni la confirmación automática al agendar.

/** La bandera general. Se lee en el servidor (nunca llega al cliente un valor que no sea este booleano). */
export const precallV2Activo = (): boolean => process.env.PRECALL_V2?.trim() === "1";

/**
 * Desde qué reunión entra un lead al flujo nuevo: `PRECALL_V2_DESDE` (ISO, p. ej. "2026-11-20T00:00:00-03:00", el momento del
 * encendido). Las reuniones anteriores siguen con el closer como siempre. Sin la variable (o ilegible), ningún lead entra solo.
 */
export const precallV2Desde = (): Date | null => {
  const texto = process.env.PRECALL_V2_DESDE?.trim();
  if (!texto) return null;
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

/** Pestaña de cada closer (primer nombre, minúsculas y sin tildes). Igual que CLOSER_DE_PESTANA de lib/crm/calendlyReagenda.ts. */
export const HOJA_DE_CLOSER: Readonly<Record<string, string>> = {
  carlos: "Closer 1",
  marcos: "Closer 2",
  yamila: "Closer 3",
  nahuel: "Closer 4",
  brenda: "Closer 5",
};

const primerNombre = (s: string) =>
  (s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().split(/\s+/)[0] ?? "");

/**
 * Encendido por closer (Tomás, 6/11/2026: arranca con Marcos y Nahuel): `PRECALL_V2_CLOSERS="Marcos,Nahuel"`. Solo las reuniones
 * de esos closers pasan por el pre-caller; el resto sigue como siempre (tarjeta, fases y confirmación al agendar). Vacía = todos.
 */
export const precallV2Closers = (): string[] | null => {
  const lista = (process.env.PRECALL_V2_CLOSERS ?? "").split(",").map(primerNombre).filter(Boolean);
  return lista.length ? lista : null;
};

/** Las pestañas con el v2 encendido (null = todas). */
export const precallV2Hojas = (): ReadonlySet<string> | null => {
  const lista = precallV2Closers();
  return lista ? new Set(lista.map((c) => HOJA_DE_CLOSER[c]).filter(Boolean)) : null;
};

/** El closer de una reunión (nombre como viene de Calendly) tiene el v2 encendido. */
export const closerConPrecallV2 = (nombre: string): boolean => {
  const lista = precallV2Closers();
  return !lista || lista.includes(primerNombre(nombre));
};

/**
 * El WhatsApp del pase al closer sale de verdad solo con esta segunda bandera (además de `PRECALL_V2=1`) y el webhook del
 * closer cargado. Permite prender las tarjetas sin mandar nada a leads mientras se prueba con un número propio.
 */
export const envioPaseActivo = (): boolean => precallV2Activo() && process.env.PRECALL_V2_ENVIO?.trim() === "1";

/** Id de la vista que junta los leads de todos los closers para el pre-caller (`/ventas/closer/pre-caller`). */
export const ID_VISTA_PRECALLER = "pre-caller";

/** La vista del pre-caller como un "closer" más del selector (sin hoja propia: junta las que la sesión puede ver). */
export const VISTA_PRECALLER = { id: ID_VISTA_PRECALLER, nombre: "Pre-caller · todos los closers", hoja: "" } as const;

/** Los valores de las columnas nuevas (AM–AV). Tienen que coincidir con los desplegables que arma scripts/precall-v2-planilla.mjs. */
export const PRECALLER = {
  // AM · Contacto
  noAtendio1: "No atendió 1ª",
  noAtendio2: "No atendió 2ª",
  llamadaEfectiva: "Llamada efectiva",
  porChat: "Pre-call por chat",
  // AN · ¿Confirmó?
  confirmo: "Si",
  reprograma: "Reprograma",
  // AO · Decisores
  decideSolo: "Decide solo",
  vienenDecisores: "Vienen decisores",
  // AT · Estado
  pendiente: "Pendiente",
  pasado: "Pasado al closer",
  liberado: "Liberado",
} as const;

export const CONTACTOS_PRECALLER = [PRECALLER.noAtendio1, PRECALLER.noAtendio2, PRECALLER.llamadaEfectiva, PRECALLER.porChat] as const;
export const CONFIRMACIONES_PRECALLER = [PRECALLER.confirmo, PRECALLER.reprograma] as const;
export const DECISORES_PRECALLER = [PRECALLER.decideSolo, PRECALLER.vienenDecisores] as const;
export const ESTADOS_PRECALLER = [PRECALLER.pendiente, PRECALLER.pasado, PRECALLER.liberado] as const;

/**
 * Los follow-ups del pre-caller por chat (Gero, 7/11/2026): un desplegable fijo en la tarjeta de "Pre-call por chat", guardado en AS
 * como S1…S4 (los valores del desplegable de la planilla). S4 = Ultimátum: sin respuesta, la tarjeta pasa a "Reagendar o cancelar".
 */
export const PASOS_CHAT_PRECALLER = ["Follow-up 1", "Follow-up 2", "Follow-up 3", "Ultimátum"] as const;
export const MAX_SEGUIMIENTOS_PRECALLER = PASOS_CHAT_PRECALLER.length;

/**
 * Después del ultimátum, en "Reagendar o cancelar" (Gero, 11/11/2026): otro desplegable con 3 seguimientos más para intentar
 * reagendar (AS = S5…S7) y "No hacer", que saca al lead del tablero (AT = Liberado).
 */
export const PASOS_REAGENDA_PRECALLER = ["Seguimiento 1", "Seguimiento 2", "Seguimiento 3"] as const;
/** Todos los valores de AS: S1…S4 del chat y S5…S7 de la reagenda. */
export const VALORES_SEGUIMIENTO_PRECALLER = Array.from(
  { length: MAX_SEGUIMIENTOS_PRECALLER + PASOS_REAGENDA_PRECALLER.length },
  (_, i) => `S${i + 1}`,
);
/** El nombre de un valor de AS ("S2" → "Follow-up 2", "S6" → "Seguimiento 2 (reagenda)"); "" si no es uno de esos. */
export function nombreSeguimientoPrecaller(n: number): string {
  if (n >= 1 && n <= MAX_SEGUIMIENTOS_PRECALLER) return PASOS_CHAT_PRECALLER[n - 1];
  const r = n - MAX_SEGUIMIENTOS_PRECALLER;
  return r >= 1 && r <= PASOS_REAGENDA_PRECALLER.length ? `${PASOS_REAGENDA_PRECALLER[r - 1]} (reagenda)` : "";
}

/**
 * Fases del closer en v2 (F): el pase deja F = "CONF + DECISORES" (lo hizo el pre-caller) y al closer le quedan el video con
 * la palabra clave (sale solo con el pase; "Enviado" = el lead mandó LISTO) y el link del día. DOLORES no va: la situación
 * del estudio ya la confirmó el pre-caller.
 */
export const FASES_CLOSER_V2 = ["CONF + DECISORES", "VIDEOS CONF", "Hecho - link a call"] as const;
