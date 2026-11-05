// Pre-call v2 (pedido de Tomás, 5/11/2026): el pre-call se parte en dos. El pre-caller confirma lo que el lead puso en el
// calendario (llamada, 2ª llamada, chat y seguimiento) desde el WhatsApp de Tomás y lo pasa al closer; recién ahí el closer
// lo ve, y sale solo, desde el WhatsApp del closer, el video de traspaso con la cita y el video de pre-llamada (LISTO).
//
// TODO APAGADO hasta que exista el WhatsApp nuevo del pre-caller: `PRECALL_V2=1` lo prende (docs/ENCENDIDO-PRECALL-V2.md).
// Con la bandera apagada nada cambia: ni las tarjetas, ni la columna AI, ni la confirmación automática al agendar.

/** La bandera general. Se lee en el servidor (nunca llega al cliente un valor que no sea este booleano). */
export const precallV2Activo = (): boolean => process.env.PRECALL_V2?.trim() === "1";

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

/** Máximo de seguimientos por chat del pre-caller antes de la 🔴 (regla general del SOP: 2 por paso). */
export const MAX_SEGUIMIENTOS_PRECALLER = 2;

/**
 * Fases del closer en v2 (F): el pase deja F = "CONF + DECISORES" (lo hizo el pre-caller) y al closer le quedan el video con
 * la palabra clave (sale solo con el pase; "Enviado" = el lead mandó LISTO) y el link del día. DOLORES no va: la situación
 * del estudio ya la confirmó el pre-caller.
 */
export const FASES_CLOSER_V2 = ["CONF + DECISORES", "VIDEOS CONF", "Hecho - link a call"] as const;
