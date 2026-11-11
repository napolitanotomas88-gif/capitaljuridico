// Motor de reglas: "¿qué le toca hoy a este lead?" (BRIEF.md §4).
// Funciones puras: no leen el Sheet ni la hora del sistema; todo entra por parámetro.
// La lógica base es la de la pestaña "Mi día" (docs/referencia-formula-mi-dia.md), más lo
// que agrega el brief: último toque (AG), fase siguiente del pre-call y botones.
// Nada de acá lee las columnas ocultas que la app no usa (N, O, P, U, X: `COLUMNAS_IGNORADAS`):
// el seguimiento post-call es siempre W.
//
// Decisión de Gero del 28/09/2026 (manda sobre BRIEF.md §4 regla 1): el pre-call es una acción
// INDEPENDIENTE de la acción principal del lead (`accionPrecall`). Todo lead cuyo F no dice
// "Hecho - link a call" ni "Olvidar" tiene su tarjeta de pre-call, aunque la call ya haya pasado:
// primero se termina el pre-call. `proximaAccion` ya no devuelve PRE_CALL y `accionesDelDia`
// devuelve hasta dos tarjetas por lead (pre-call + principal).
//
// Decisión de Gero del 28/09/2026 (manda sobre BRIEF.md §4 reglas 3 y 5): no hay LIMPIAR. Un no-show
// o un post-call con la secuencia atrasada son los mismos seguimientos, solo que tarde: siguen en
// su columna ("Enviar S<n+1>", atrasados) y van abajo de los que están al día (`compararOrden`).
//
// Decisión de Gero del 28/09/2026 ("Listo por hoy"): al terminar el día todas las columnas tienen que
// quedar vacías. Una tarjeta de pre-call a la que hoy ya se le mandó una fase y cuya siguiente puede
// esperar a mañana sin atrasarse sale con `listoPorHoy`: sigue en la lista (el closer puede mandar la
// siguiente igual), pero no cuenta como pendiente (la pantalla la pliega en "Listo por hoy").

import {
  EQUIVALENCIAS_FASE,
  FASES_PRECALL,
  MAX_SEGUIMIENTOS,
  SITUACIONES_CERRADAS,
  VALORES,
  VENTANA_DIAS,
} from "@/lib/crm/config/crm";
import { FASES_CLOSER_V2, MAX_SEGUIMIENTOS_PRECALLER, nombreSeguimientoPrecaller, PRECALLER } from "@/lib/crm/config/precallV2";
import { diasDesde, formatearFechaSheet, mismoDia, parsearFechaReagenda, parsearFechaSheet, partesFecha } from "@/lib/crm/fechas";
import type { Campo, FilaLead } from "@/lib/crm/sheets/columnas";

export type Grupo = "sePresento" | "resultado" | "precall" | "noShow" | "postCall";

/** Todos los tipos de tarjeta (también sirve para reconocerlos en el motivo del log: `tipoDelMotivo`). */
export const TIPOS_ACCION = [
  "PRE_CALL",
  "PRE_CALLER",
  "RECORDATORIOS",
  "SE_PRESENTO",
  "SE_PRESENTO_REAGENDA",
  "RESULTADO",
  "RESULTADO_REAGENDA",
  "DEFINIR_SEGUIMIENTO",
  "FALTA_FECHA_REAGENDA",
  "NO_SHOW",
  "CERRAR_NO_SHOW",
  "POST_CALL",
  "CERRAR_POST_CALL",
] as const;

export type TipoAccion = (typeof TIPOS_ACCION)[number];

/** Datos extra que el botón le pide al closer antes de escribir. */
export type Pedido =
  | "situacion" // elegir V y, según el caso, seguimiento (W), cash (Y, Z, AA) o fecha (AC)
  | "cierre" // cash día 1 (Y), cash trato cerrado (Z), valor del servicio (AA)
  | "reagenda" // fecha y hora (AC) y datos (AB)
  | "seguimiento" // fecha acordada para el próximo seguimiento (AH): "Coordinar fecha"
  | "cancelacion" // confirmar "Cancelar reunión" (Pre-call): cancela en Calendly y saca al lead de la lista
  | "pase" // pre-call v2: "Llamada efectiva" / "Pre-call hecho" (datos confirmados y notas; manda el WhatsApp del closer)
  | "noEfectiva"; // pre-call v2: "Llamada no efectiva" (manda el WhatsApp automático desde el número del pre-caller)

export type Boton = {
  id: string;
  etiqueta: string;
  /**
   * Celdas que escribe. AG (último toque) se agrega al escribir, salvo en el "Enviado" del pre-call
   * (`tocaUltimoToque` de verificacion.ts): una fase mandada hoy no frena los seguimientos.
   */
  cambios: Partial<Record<Campo, string>>;
  pide?: Pedido;
  principal?: boolean;
};

export type Accion = {
  tipo: TipoAccion;
  grupo: Grupo;
  /** La acción concreta: "Enviar S3", "Enviar fase: VIDEOS CONF". */
  titulo: string;
  /** El estado actual del lead en una línea. */
  estado: string;
  /** Fecha de la call (o de la reagenda) a la que se refiere la acción; con fecha acordada (AH), ese día. */
  fecha: Date;
  /** Con fecha acordada: la de la call o reunión (la tarjeta muestra esa hora, no las 00:00 de AH). */
  fechaReunion?: Date;
  atrasado: boolean;
  /**
   * Solo el pre-call (`accionPrecall`): hoy ya se mandó una fase y la siguiente puede esperar a
   * mañana sin quedar atrasada. La tarjeta se muestra igual (título y botón de siempre), pero NO es
   * pendiente: no cuenta en pendientes, atrasados, grupos ni progreso, y la pantalla la pliega en
   * "Listo por hoy". Nunca va junto con `atrasado`. También un No-show o Post-call con el próximo
   * seguimiento acordado para otro día (AH, `conFechaAcordada`): espera plegado hasta esa fecha.
   */
  listoPorHoy: boolean;
  botones: Boton[];
  /** Datos raros de la fila que el closer debería ver (p. ej. reagenda ilegible). */
  avisos: string[];
  /** Solo PRE_CALLER: la columna del tablero del pre-caller (Llamar / Pre-call por chat / Reagendar o cancelar). */
  etapaPrecaller?: EtapaPrecaller;
  /**
   * Solo PRE_CALLER en "Reagendar o cancelar": lo que escribe "No hacer" del desplegable de seguimientos de reagenda (saca al
   * lead del tablero). Si la reunión ya pasó, es lo mismo que "Liberar".
   */
  noHacerPrecaller?: Boton;
};

/**
 * Las etapas del pipeline del pre-caller (Gero, 7/11/2026: su tablero muestra solo sus tareas, no las columnas del closer).
 * llamar → (no atendió) chat → pase al closer; vencida = la reunión pasó sin pase o no respondió el ultimátum (Gero, 7/11/2026).
 */
export type EtapaPrecaller = "llamar" | "chat" | "vencida";

// ---------------------------------------------------------------------------------------

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Compara como el Sheet: sin distinguir mayúsculas, tildes ni espacios alrededor. */
const es = (valor: string, esperado: string) => normalizar(valor) === normalizar(esperado);

/** "S3" → 3. Vacío, "Hacer" o cualquier otro valor → 0. */
export function numeroSeguimiento(valor: string): number {
  const m = /^s(\d)/i.exec(valor.trim());
  return m ? Number(m[1]) : 0;
}

/**
 * Índice en FASES_PRECALL de la última fase enviada; -1 si no arrancó o el valor es desconocido.
 * Un valor viejo de `EQUIVALENCIAS_FASE` cuenta como su fase equivalente.
 */
export function indiceFase(
  valor: string,
  equivalencias: Readonly<Record<string, string>> = EQUIVALENCIAS_FASE,
): { indice: number; conocido: boolean } {
  if (!valor.trim()) return { indice: -1, conocido: true };
  const equivalente = Object.entries(equivalencias).find(([viejo]) => es(valor, viejo))?.[1];
  const buscado = equivalente ?? valor;
  const indice = FASES_PRECALL.findIndex((fase) => es(fase, buscado));
  return { indice, conocido: indice >= 0 };
}

const FASE_FINAL = FASES_PRECALL.length - 1;

/** El pre-call está terminado: F dice "Hecho - link a call" (o su equivalente). */
export const precallTerminado = (valor: string) => indiceFase(valor).indice === FASE_FINAL;

type Contexto = {
  v: FilaLead["valores"];
  ahora: Date;
  tocadoHoy: boolean;
  /** Fecha acordada para el próximo seguimiento (AH, "Coordinar fecha"); null si no hay o no se entiende. */
  proximo: Date | null;
  avisos: string[];
};

type Parcial = Omit<Accion, "avisos" | "atrasado" | "listoPorHoy"> & { atrasado?: boolean };

/** Las acciones principales (todo menos el pre-call) nunca quedan "listas por hoy". */
function crear(ctx: Contexto, a: Parcial): Accion {
  return { atrasado: false, ...a, listoPorHoy: false, avisos: ctx.avisos };
}

const seguimiento = (n: number) => `S${n}`;

// ---------------------------------------------------------------------------------------
// Seguimiento con fecha acordada (pedido de Tomás, 11/10/2026): "Coordinar fecha" en No-show y
// Post-call guarda en AH el día en que hay que mandar el próximo seguimiento. Hasta ese día la
// tarjeta no es pendiente (va plegada en "Listo por hoy" y aparece en los filtros Mañana / Esta
// semana / Rango); ese día vuelve a su columna, y si pasa sin hacerse queda atrasada. Con fecha
// acordada, el Enviado deja AH en mañana: la secuencia sigue diaria desde ahí (decisión de Tomás).
// Lo que saca al lead de la secuencia (se presentó, cerró, no hacer, olvidar, reagendó) borra AH.

const botonCoordinar = (): Boton => ({ id: "coordinar", etiqueta: "Coordinar fecha", cambios: {}, pide: "seguimiento" });

/**
 * Lo que manda el Enviado en AH para "mañana". La fecha real la pone el servidor al escribir
 * (`resolverMarcaManana` en `ejecutarAccion`), con su reloj: una lista armada antes de la medianoche
 * no puede dejar AH en "hoy" (y la tarjeta volvería enseguida).
 */
export const MARCA_MANANA = "(mañana)";

/** Reemplaza `MARCA_MANANA` por la fecha de mañana (Buenos Aires) en los cambios que van a la planilla. */
export function resolverMarcaManana<T extends Partial<Record<Campo, string>>>(cambios: T, ahora: Date): T {
  return cambios.proximoSeguimiento === MARCA_MANANA ? { ...cambios, proximoSeguimiento: mananaSheet(ahora) } : cambios;
}

/** Mañana a las 00:00 de Buenos Aires, como la escribe la planilla. */
export function mananaSheet(ahora: Date): string {
  const p = partesFecha(ahora);
  const hoy = parsearFechaSheet(`${p.dia}/${p.mes}/${p.anio}`)!;
  return formatearFechaSheet(new Date(hoy.getTime() + 24 * 60 * 60 * 1000));
}

/** "15/10": la fecha acordada en el estado de la tarjeta. */
const diaMes = (fecha: Date) => {
  const p = partesFecha(fecha);
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}`;
};

/** Con fecha acordada, un botón que saca al lead de la secuencia también borra AH. */
function sinFecha(ctx: Contexto, b: Boton): Boton {
  return ctx.v.proximoSeguimiento.trim() ? { ...b, cambios: { ...b.cambios, proximoSeguimiento: "" } } : b;
}

/**
 * El Enviado de S<n>. Con fecha acordada que ya llegó (hoy o atrasada) deja AH en mañana (sigue
 * diaria); si la fecha acordada todavía no llegó (le escribió hoy y coordinó otro día), la respeta.
 * El último (S5) la borra para que "Terminó la secuencia" salga como siempre. Un AH ilegible se borra.
 */
function enviado(ctx: Contexto, campo: "fupsNoShow" | "seguimientoPost1", n: number): Boton {
  const cambios: Partial<Record<Campo, string>> = { [campo]: seguimiento(n) };
  if (ctx.proximo) {
    if (n >= MAX_SEGUIMIENTOS) cambios.proximoSeguimiento = "";
    else if (diasDesde(ctx.proximo, ctx.ahora) >= 0) cambios.proximoSeguimiento = MARCA_MANANA;
  } else if (ctx.v.proximoSeguimiento.trim()) cambios.proximoSeguimiento = "";
  return { id: "enviado", etiqueta: "Enviado", cambios, principal: true };
}

/** Aplica la fecha acordada (AH) a la tarjeta: espera plegada, vence ese día o queda atrasada. */
function conFechaAcordada(ctx: Contexto, a: Accion): Accion {
  const p = ctx.proximo;
  if (!p) return a;
  const faltan = -diasDesde(p, ctx.ahora);
  if (faltan > 0) return { ...a, fecha: p, fechaReunion: a.fecha, atrasado: false, listoPorHoy: true, estado: `${a.estado} · próximo seguimiento el ${diaMes(p)}` };
  return {
    ...a,
    fecha: p,
    fechaReunion: a.fecha,
    atrasado: faltan < 0,
    listoPorHoy: false,
    estado: `${a.estado} · ${faltan === 0 ? "próximo seguimiento: hoy" : `próximo seguimiento: era el ${diaMes(p)}`}`,
  };
}

/** Asistencia manual a la reagenda: conserva la ausencia original y los seguimientos. */
const botonPresentadoReagenda = (): Boton => ({
  id: "presentado-reagenda",
  etiqueta: "Se presentó a la reagenda",
  cambios: { presentoReagenda: VALORES.si },
});

const botonReagendoPost = (): Boton => ({
  id: "reagendo",
  etiqueta: "Reagendó",
  cambios: { situacion: VALORES.reagendo },
  pide: "situacion",
});

/**
 * La última reunión que ya pasó: la call (D), o la reagenda (AC) si es legible, posterior a la
 * call y ya pasó. Desde ahí se cuentan los días del seguimiento post-call (S1 al día siguiente).
 */
function ultimaReunion(fechaCall: Date, fechaReag: Date | null, ahora: Date): Date {
  return fechaReag && fechaReag > fechaCall && fechaReag <= ahora ? fechaReag : fechaCall;
}

type Base = { v: FilaLead["valores"]; fechaCall: Date; fechaReag: Date | null };

/**
 * Los descartes que valen para todo el motor (pre-call y acción principal): sin nombre, fecha de
 * la call inválida, fuera de la ventana de 60 días (contando la reagenda), F = Olvidar y V cerrado.
 */
function leerBase(fila: FilaLead, ahora: Date, proximo: Date | null = null): Base | null {
  const v = fila.valores;
  if (!v.nombre.trim()) return null;

  const fechaCall = parsearFechaSheet(v.fechaCall);
  if (!fechaCall) return null;
  const fechaReag = v.fechaReagenda.trim() ? parsearFechaReagenda(v.fechaReagenda, fechaCall) : null;

  const reunion = fechaReag && fechaReag > fechaCall ? fechaReag : fechaCall;
  // Un seguimiento con fecha acordada (AH) estira la ventana: el lead no se pierde antes de ese día
  // (solo para la acción principal: `proximaAccion` la pasa; el pre-call no).
  const ultima = proximo && proximo > reunion ? proximo : reunion;
  if (diasDesde(ultima, ahora) > VENTANA_DIAS) return null;
  if (es(v.precall, VALORES.olvidar)) return null;
  if (SITUACIONES_CERRADAS.some((s) => es(v.situacion, s))) return null;
  return { v, fechaCall, fechaReag };
}

const avisoReagendaIlegible = (v: FilaLead["valores"]) => `La reagenda no tiene una fecha legible: "${v.fechaReagenda.trim()}"`;

// ---------------------------------------------------------------------------------------
// Pre-call (independiente de la acción principal)

/**
 * La reunión a la que apunta el pre-call: la reagenda (AC) si es legible y futura y el flujo la usa
 * (no-show reagendado con T vacía, o V = Reagendó de un lead que vino a alguna call); si no, la
 * call (D). Si esa fecha ya pasó, el pre-call quedó sin terminar de una call que ya pasó.
 * `avisoReagenda`: el flujo usaría AC pero no se puede leer como fecha.
 */
function reunionDelPrecall(base: Base, ahora: Date): { fecha: Date; avisoReagenda: boolean } {
  const { v, fechaCall, fechaReag } = base;
  const presento = v.presentoAgenda1.trim();
  const usaReagenda = es(presento, VALORES.no) && !es(v.presentoReagenda, VALORES.si);
  return {
    fecha: usaReagenda && fechaReag && fechaReag > ahora ? fechaReag : fechaCall,
    avisoReagenda: usaReagenda && v.fechaReagenda.trim() !== "" && !fechaReag,
  };
}

/**
 * La tarjeta de pre-call del lead, o null. Aparece siempre que F NO dice "Hecho - link a call" ni
 * "Olvidar" (sin distinguir mayúsculas, tildes ni espacios alrededor), salvo los descartes de todo
 * el motor (`leerBase`). F vacío, fases intermedias y valores desconocidos (p. ej. "NO RESPONDE",
 * con un aviso) entran. No importa lo que diga el resto de la fila (R, S, T, V, W): primero se
 * termina el pre-call.
 *
 * - Título "Enviar fase: <siguiente>", botón Enviado (F = siguiente). Sin límite por día: después de
 *   Enviado vuelve con la fase siguiente.
 * - `atrasado`: faltan más fases (con "Hecho - link a call") que días hasta la call contando hoy,
 *   o la call ya pasó ("La call ya pasó · pre-call en: …", fecha de esa call).
 *   Ofrece Olvidar si R = No, S = No hacer y T no es Si.
 * - `faseEnviadaHoy` (sale de "Log App": `precallEnviadoHoy` de hechas.ts): si ya se mandó una fase
 *   hoy y no está atrasado, el estado lo dice, pero la tarjeta se sigue mostrando.
 * - `listoPorHoy` (decisión de Gero del 28/09/2026): ya se mandó una fase hoy y la siguiente puede
 *   esperar a mañana (con una por día desde mañana alcanzan los días hasta la call: `faltan <
 *   diasQuedan`, lo que también quiere decir que no está atrasado). No cuenta como pendiente. Si no
 *   alcanza ("… la siguiente también va hoy", p. ej. la call es hoy o mañana con dos fases por
 *   mandar) o está atrasado, sigue pendiente aunque hoy se haya mandado una: hay que mandar la
 *   siguiente enseguida (si no, mañana quedaría atrasado, o la call de hoy sin el link).
 */
/**
 * La llamada del pre-caller (pedido de Tomás, 21/10/2026): los dos primeros botones del Pre-call mientras no se registró (AI
 * vacía); mientras tanto son los únicos (`esperaLlamada` en `accionPrecall`). "Llamada efectiva" da por mandadas las fases anteriores (F = la anterior a "Hecho - link a call",
 * sin retroceder si ya iba más adelante): la tarjeta queda pidiendo solo esa. "Llamada no efectiva" (no atendió) deja F como
 * está: siguen todas las fases.
 */
function botonesLlamada(v: FilaLead["valores"], indice: number): Boton[] {
  if (v.llamadaPrecall.trim()) return [];
  const anteriorAlLink = FASE_FINAL - 1;
  return [
    {
      id: "llamadaEfectiva",
      etiqueta: "Llamada efectiva",
      cambios: { llamadaPrecall: VALORES.llamadaEfectiva, ...(indice < anteriorAlLink ? { precall: FASES_PRECALL[anteriorAlLink] } : {}) },
    },
    { id: "llamadaNoEfectiva", etiqueta: "Llamada no efectiva", cambios: { llamadaPrecall: VALORES.llamadaNoEfectiva } },
  ];
}

export function accionPrecall(fila: FilaLead, ahora: Date, faseEnviadaHoy = false, v2 = false): Accion | null {
  const base = leerBase(fila, ahora);
  if (!base) return null;
  const { v } = base;
  // Pre-call v2: al closer le quedan solo sus fases (`FASES_CLOSER_V2`); la llamada y la confirmación las hizo el pre-caller.
  const fases: readonly string[] = v2 ? FASES_CLOSER_V2 : FASES_PRECALL;
  const { indice, conocido } = v2 ? indiceFaseV2(v.precall) : indiceFase(v.precall);
  if (indice === fases.length - 1) return null;

  const { fecha, avisoReagenda } = reunionDelPrecall(base, ahora);
  // Pedido de Tomás (26/10/2026): pasado el horario de la reunión, el pre-call ya no tiene sentido y la tarjeta se va (el lead
  // sigue con "¿Se presentó?"). Antes quedaba como "La call ya pasó · atrasado" y llenaba la columna (44 tarjetas el 24/10) y
  // alguien llegó a mandar fases después de la reunión.
  if (fecha <= ahora) return null;
  const avisos: string[] = [];
  if (avisoReagenda) avisos.push(avisoReagendaIlegible(v));
  if (!conocido) avisos.push(`Pre-call con un valor desconocido: "${v.precall.trim()}"`);

  const fase = v.precall.trim();
  const siguiente = fases[indice + 1];
  const faltan = fases.length - (indice + 1);
  // Días calendario de Buenos Aires desde hoy hasta el día de la call, los dos incluidos.
  const diasQuedan = 1 - diasDesde(fecha, ahora);
  const atrasado = faltan > diasQuedan;
  // Con una fase por día, ¿alcanzan los días desde mañana? Si no (p. ej. la call es hoy), la
  // siguiente también va hoy aunque todavía no esté atrasado.
  const puedeEsperar = faltan < diasQuedan;
  const enviadaHoy = faseEnviadaHoy && conocido && indice >= 0 && !atrasado;

  const llamada = v2 ? [] : botonesLlamada(v, indice);
  // v2: el video con la palabra clave ya salió solo con el pase; el closer marca cuando el lead manda LISTO.
  const esperaListo = v2 && siguiente === "VIDEOS CONF";
  // Pedido de Tomás (21/10/2026): el pre-call no ofrece ninguna fase hasta que el pre-caller registra la llamada. Efectiva →
  // solo queda "Hecho - link a call"; no efectiva → siguen las fases (desde la primera, o desde donde iba).
  const esperaLlamada = llamada.length > 0;

  let estado = `Pre-call: ${fase || "sin arrancar"}`;
  if (esperaLlamada) {
    estado = fase ? `Pre-call: ${fase} · falta la llamada del pre-caller` : "Pre-call: falta la llamada del pre-caller";
  } else if (enviadaHoy) {
    estado = puedeEsperar ? `${fase} enviada hoy · la siguiente puede esperar a mañana` : `${fase} enviada hoy · la siguiente también va hoy`;
  }

  return {
    tipo: "PRE_CALL",
    grupo: "precall",
    titulo: esperaLlamada ? "Llamar al lead" : esperaListo ? "Esperar LISTO del video de pre-llamada" : `Enviar fase: ${siguiente}`,
    estado,
    fecha,
    atrasado,
    // Lista por hoy: no es pendiente. El título y el botón no cambian (puede mandar la siguiente igual).
    listoPorHoy: enviadaHoy && puedeEsperar,
    botones: [
      ...(esperaLlamada ? llamada.map((b) => (b.id === "llamadaEfectiva" ? { ...b, principal: true } : b)) : llamada),
      ...(esperaLlamada ? [] : [{ id: "enviado", etiqueta: esperaListo ? "Mandó LISTO" : "Enviado", cambios: { precall: siguiente }, principal: true }]),
      ...(es(v.presentoAgenda1, VALORES.no) && !es(v.presentoReagenda, VALORES.si) && es(v.fupsNoShow, VALORES.noHacer)
        ? [{ id: "olvidar", etiqueta: "Olvidar", cambios: { precall: VALORES.olvidar } }]
        : [])
    ],
    avisos,
  };
}

// ---------------------------------------------------------------------------------------
// Pre-call v2 (lib/crm/config/precallV2.ts): la tarjeta del pre-caller y la regla dura

/** Índice de F en `FASES_CLOSER_V2` (-1 vacío o desconocido). DOLORES (fase vieja) cuenta como VIDEOS CONF ya hecho. */
function indiceFaseV2(valor: string): { indice: number; conocido: boolean } {
  if (!valor.trim()) return { indice: -1, conocido: true };
  const buscado = es(valor, "DOLORES") ? "VIDEOS CONF" : valor;
  const indice = FASES_CLOSER_V2.findIndex((fase) => es(fase, buscado));
  return { indice, conocido: indice >= 0 };
}

/**
 * El lead va por el flujo v2: ya lo tocó el pre-caller (estado en AT), o es una reunión desde el encendido (`desde`, la variable
 * PRECALL_V2_DESDE) que nadie empezó por el flujo viejo (F y AI vacías). Las reuniones anteriores al encendido (incluidas las
 * que ya tienen "¿Se presentó?" y resultado) siguen con el closer como siempre; sin `desde`, ninguna entra sola.
 */
export function esLeadV2(v: FilaLead["valores"], desde: Date | null = null): boolean {
  if (v.estadoPrecaller.trim() !== "") return true;
  if (!desde || v.precall.trim() !== "" || v.llamadaPrecall.trim() !== "") return false;
  const call = parsearFechaSheet(v.fechaCall);
  return call !== null && call.getTime() >= desde.getTime();
}

const pasadoAlCloser = (v: FilaLead["valores"]) => es(v.estadoPrecaller, PRECALLER.pasado);
/**
 * Reagendado sin haberse presentado (R = No, AC con la reunión nueva, T sin "Si"): lo deja así una reprogramación de Calendly
 * (`cambiosDeReprogramacion`). En v2, sin pase, el lead sigue con el pre-caller en el mismo paso y con el horario nuevo
 * (Gero, 11/11/2026: el pre-caller sigue el pre-call hasta terminarlo, aunque se reagende).
 */
const reagendadoSinPresentarse = (v: FilaLead["valores"]) =>
  es(v.presentoAgenda1, VALORES.no) && !es(v.presentoReagenda, VALORES.si) && v.fechaReagenda.trim() !== "";
const confirmoConPrecaller = (v: FilaLead["valores"]) => es(v.confirmoPrecaller, PRECALLER.confirmo) || es(v.confirmoPrecaller, PRECALLER.reprograma);

/** "Liberar" de una reunión que pasó sin pase: como Cancelar reunión, sin Calendly (el horario ya pasó). */
const botonLiberar = (): Boton => ({
  id: "liberar",
  etiqueta: "Liberar (no se pasa al closer)",
  cambios: { estadoPrecaller: PRECALLER.liberado, presentoAgenda1: VALORES.no, precall: VALORES.olvidar, fupsNoShow: VALORES.noHacer },
});

/**
 * La tarjeta del pre-caller (tipo PRE_CALLER), o null. Mientras el lead no se pasó al closer, el closer no lo ve (regla dura
 * de Tomás, 5/11/2026): la confirmación y el seguimiento para que confirme son del pre-caller.
 *
 * Hasta 2 llamadas seguidas, en el momento. Si atiende: guion y "Llamada efectiva" (pase; el WhatsApp del closer sale a los 3 minutos).
 * Si no atiende ninguna: "Llamada no efectiva" (sale solo el WhatsApp del pre-caller: "Hace unos minutos te llamé… ¿Confirmamos
 * tu asistencia?") y sigue la escalera por chat: «¿Pudiste leerme?» → decisores (2 h después) → seguimiento de decisores →
 * ultimátum → cancelar. Si confirma por chat: decisores → recomendaciones → "Pre-call hecho" (pase, sin demora). Si la reunión
 * pasa sin pase, queda para reagendar o liberar. Pedidos de Tomás del 5 y 6/11/2026.
 */
export function accionPrecaller(fila: FilaLead, ahora: Date): Accion | null {
  const base = leerBase(fila, ahora);
  if (!base) return null;
  const { v } = base;
  if (pasadoAlCloser(v) || es(v.estadoPrecaller, PRECALLER.liberado)) return null;
  const { fecha, avisoReagenda } = reunionDelPrecall(base, ahora);
  const avisos = avisoReagenda ? [avisoReagendaIlegible(v)] : [];
  const contacto = v.contactoPrecaller.trim();
  const seguimientos = numeroSeguimiento(v.seguimientosPrecaller);
  const partes = [
    contacto || "sin contacto",
    confirmoConPrecaller(v) ? (es(v.confirmoPrecaller, PRECALLER.reprograma) ? "reprogramó" : "decisores preguntados") : "",
    v.decisoresPrecaller.trim(),
    nombreSeguimientoPrecaller(seguimientos),
  ];
  const estado = `Pre-caller: ${partes.filter(Boolean).join(" · ")}`;
  // "No hacer" de la reagenda (Gero, 11/11/2026): sale del tablero. Con la reunión pasada y sin "¿Se presentó?", como "Liberar".
  const noHacer: Boton = {
    id: "noHacerReagenda",
    etiqueta: "No hacer",
    cambios:
      fecha <= ahora && (!v.presentoAgenda1.trim() || reagendadoSinPresentarse(v))
        ? botonLiberar().cambios
        : { estadoPrecaller: PRECALLER.liberado },
  };
  const tarjeta = (etapaPrecaller: EtapaPrecaller, titulo: string, botones: Boton[], atrasado = false): Accion => ({
    tipo: "PRE_CALLER",
    grupo: "precall",
    etapaPrecaller,
    titulo,
    estado,
    fecha,
    atrasado,
    listoPorHoy: false,
    botones,
    avisos,
    ...(etapaPrecaller === "vencida" ? { noHacerPrecaller: noHacer } : {}),
  });

  // Pasó la hora sin pase: el closer no la toma. Se reagenda en Calendly (y vuelve a confirmar) o se libera.
  // "Liberar" nunca pisa un "¿Se presentó?" ya cargado (con R cargada la tarjeta ni existe: `accionesDeFila`).
  if (fecha <= ahora) {
    const botones = v.presentoAgenda1.trim() && !reagendadoSinPresentarse(v) ? [] : [botonLiberar()];
    return tarjeta("vencida", "La reunión pasó sin pasar al closer: reagendar o liberar", botones, true);
  }

  // El pase al closer (Tomás, 6/11/2026): "Llamada efectiva" (atendió y se hizo el guion; el WhatsApp del closer sale a los
  // 3 minutos) o "Pre-call hecho" (terminó por chat; sale enseguida). Los dos abren el formulario del pase (`pide: "pase"`).
  const pase = (porLlamada: boolean): Boton => ({
    id: porLlamada ? "llamadaEfectiva" : "pasarAlCloser",
    etiqueta: porLlamada ? "Llamada efectiva" : "Pre-call hecho",
    pide: "pase",
    principal: true,
    // AI se sigue llenando (métrica de la llamada del pre-call)
    cambios: {
      ...(porLlamada ? { contactoPrecaller: PRECALLER.llamadaEfectiva, confirmoPrecaller: PRECALLER.confirmo } : {}),
      estadoPrecaller: PRECALLER.pasado,
      precall: FASES_CLOSER_V2[0],
      llamadaPrecall: porLlamada ? VALORES.llamadaEfectiva : VALORES.llamadaNoEfectiva,
    },
  });

  // Las 2 llamadas van seguidas, en el momento (Tomás, 6/11/2026): un solo paso. "No atendió 1ª" quedó de una versión anterior.
  if (contacto === "" || es(contacto, PRECALLER.noAtendio1)) {
    return tarjeta("llamar", "Llamar (hasta 2 veces seguidas)", [
      pase(true),
      // Dispara el WhatsApp automático desde el número del pre-caller ("Hace unos minutos te llamé… ¿Confirmamos?")
      { id: "llamadaNoEfectiva", etiqueta: "Llamada no efectiva", pide: "noEfectiva", cambios: { contactoPrecaller: PRECALLER.noAtendio2 } },
    ]);
  }
  // Atendió pero el pase no quedó hecho (p. ej. se cerró el formulario): sigue en Llamar, con el pase a mano
  if (es(contacto, PRECALLER.llamadaEfectiva)) return tarjeta("llamar", "Pasar al closer", [pase(true)]);

  // Pre-call por chat (Gero, 7/11/2026): ya le salió el mensaje automático de confirmación, así que quedan 2 botones:
  // "Decisores" (marca que le preguntó por los decisores; AN = Si) y "Pre-call hecho" (el pase: desde el WhatsApp del pre-caller
  // salen las recomendaciones y después el WhatsApp del closer). Los follow-ups van en un desplegable fijo de la tarjeta (AS:
  // S1–S3 = Follow-up 1–3, S4 = Ultimátum). Con el ultimátum marcado, la tarjeta pasa a "Reagendar o cancelar".
  const roja: Boton[] = es(v.banderaRoja, VALORES.si) ? [] : [{ id: "sinRespuesta", etiqueta: "Sin respuesta 🔴", cambios: { banderaRoja: VALORES.si } }];
  if (seguimientos >= MAX_SEGUIMIENTOS_PRECALLER) {
    return tarjeta("vencida", "Sin respuesta al ultimátum: cancelar la reunión", [pase(false), ...roja], true);
  }
  const decisores: Boton[] = confirmoConPrecaller(v)
    ? []
    : [{ id: "decisores", etiqueta: "Decisores", cambios: { confirmoPrecaller: PRECALLER.confirmo } }];
  return tarjeta("chat", "Pre-call por chat", [...decisores, { ...pase(false), principal: decisores.length === 0 }]);
}

/** Los recordatorios del closer en v2 (AK: vacío → 1 → 2 → 3). Tomás, 6/11/2026: la columna del closer arranca acá. */
const PASOS_RECORDATORIO = [
  "Recordatorio: mañana del día de la reunión",
  "Recordatorio: link de la reunión (30 min antes)",
  "Recordatorio: aviso 10 min antes",
] as const;

/**
 * La tarjeta del closer en v2 (tipo RECORDATORIOS), después del pase: arranca directo en los recordatorios previos (mañana del
 * día, link 30 min antes, aviso 10 min antes). El video con la palabra clave ya salió solo con el pase; los hasta 2 seguimientos
 * del LISTO los hace el closer por WhatsApp sin registrarlos en el CRM (Tomás, 6/11/2026). El último recordatorio escribe
 * F = "Hecho - link a call" y la tarjeta se va; después de la hora, "¿Se presentó?" como siempre. Antes del día de la reunión
 * espera plegada en "Listo por hoy".
 */
export function accionRecordatoriosV2(fila: FilaLead, ahora: Date): Accion | null {
  const base = leerBase(fila, ahora);
  if (!base) return null;
  const { v } = base;
  if (indiceFaseV2(v.precall).indice === FASES_CLOSER_V2.length - 1) return null;
  const { fecha, avisoReagenda } = reunionDelPrecall(base, ahora);
  if (fecha <= ahora) return null;
  const paso = Math.min(Math.max(Number(v.recordatorioPrecall.trim()) || 0, 0), PASOS_RECORDATORIO.length);
  if (paso >= PASOS_RECORDATORIO.length) return null;
  const ultimo = paso === PASOS_RECORDATORIO.length - 1;
  const botones: Boton[] = [
    {
      id: "recordatorio",
      etiqueta: "Enviado",
      principal: true,
      cambios: { recordatorioPrecall: String(paso + 1), ...(ultimo ? { precall: FASES_CLOSER_V2[FASES_CLOSER_V2.length - 1] } : {}) },
    },
  ];
  return {
    tipo: "RECORDATORIOS",
    grupo: "precall",
    titulo: PASOS_RECORDATORIO[paso],
    estado: "Pasado al closer · video de pre-llamada enviado",
    fecha,
    // El de la mañana espera al día de la reunión
    atrasado: false,
    listoPorHoy: paso === 0 && !mismoDia(fecha, ahora),
    botones,
    avisos: avisoReagenda ? [avisoReagendaIlegible(v)] : [],
  };
}

// ---------------------------------------------------------------------------------------
// Acción principal (sin el pre-call)

/**
 * La acción principal del lead (todo menos el pre-call, que es `accionPrecall`). Donde antes
 * tocaba el pre-call (call o reagenda todavía futura) no hay acción principal: la call no pasó.
 */
export function proximaAccion(fila: FilaLead, ahora: Date): Accion | null {
  const proximo = parsearFechaSheet(fila.valores.proximoSeguimiento);
  const base = leerBase(fila, ahora, proximo);
  if (!base) return null;
  const { v, fechaCall, fechaReag } = base;

  const ultimoToque = parsearFechaSheet(v.ultimoToque);
  const ctx: Contexto = {
    v,
    ahora,
    tocadoHoy: ultimoToque !== null && mismoDia(ultimoToque, ahora),
    proximo,
    avisos: [],
  };
  if (v.proximoSeguimiento.trim() && !ctx.proximo)
    ctx.avisos.push(`La fecha del próximo seguimiento no se entiende: "${v.proximoSeguimiento.trim()}". Coordiná la fecha de nuevo.`);
  if (v.fechaReagenda.trim() && !fechaReag) ctx.avisos.push(avisoReagendaIlegible(v));

  const presento = v.presentoAgenda1.trim();
  if (!presento) {
    return fechaCall > ahora ? null : sePresento(ctx, fechaCall);
  }

  // La asistencia a la reagenda se registra manualmente desde No-show.
  // AC y V nunca mueven por sí solas una tarjeta fuera de No-show.
  if (es(presento, VALORES.no) && !es(v.presentoReagenda, VALORES.si)) {
    return noShow(ctx, fechaCall);
  }

  // Se presentó (R = Si, o vino a la reagenda). Los S1…S4 viejos de R se tratan como Si,
  // igual que la fórmula; ningún lead activo los tiene.
  return resultado(ctx, ultimaReunion(fechaCall, fechaReag, ahora));
}

// ---------------------------------------------------------------------------------------

function sePresento(ctx: Contexto, fecha: Date): Accion {
  return crear(ctx, {
    tipo: "SE_PRESENTO",
    grupo: "sePresento",
    titulo: "¿Se presentó a la call?",
    estado: "La call ya pasó",
    fecha,
    botones: [
      { id: "si", etiqueta: "Sí", cambios: { presentoAgenda1: VALORES.si }, principal: true },
      { id: "no", etiqueta: "No", cambios: { presentoAgenda1: VALORES.no } },
    ],
  });
}

function noShow(ctx: Contexto, base: Date): Accion | null {
  const valor = ctx.v.fupsNoShow;
  const n = numeroSeguimiento(valor);
  const dias = diasDesde(base, ctx.ahora);
  const estado = `No-show · ${n > 0 ? `${seguimiento(n)} enviado` : "sin seguimiento"}`;
  // Siempre disponible, incluso si el seguimiento de hoy ya se envió.
  // "Se presentó" pasa a Resultado: borra la fecha acordada. "No se presentó" sigue en No-show: la conserva.
  const presentado = sinFecha(ctx, botonPresentadoReagenda());
  const noPresentado: Boton = {
    id: "no-presentado-reagenda",
    etiqueta: "No se presentó a la reagenda",
    cambios: { presentoReagenda: VALORES.no },
  };
  if (es(valor, VALORES.noHacer)) return null;
  const coordinar = botonCoordinar();

  // Pedido de Tomás (10/10/2026): Olvidar está en TODAS las tarjetas de No-show, en cualquier
  // momento (un lead que cancela o bloquea no necesita llegar al S5). Escribe S = No hacer y
  // F = Olvidar juntos: el lead sale de No-show y de Pre-call. Reemplaza "solo después del S5".
  const olvidar: Boton = sinFecha(ctx, {
    id: "olvidar",
    etiqueta: "Olvidar",
    cambios: { fupsNoShow: VALORES.noHacer, precall: VALORES.olvidar },
  });

  if (n >= MAX_SEGUIMIENTOS) {
    return conFechaAcordada(ctx, crear(ctx, {
      tipo: "CERRAR_NO_SHOW",
      grupo: "noShow",
      titulo: "Terminó la secuencia",
      estado,
      fecha: base,
      botones: [
        sinFecha(ctx, { id: "no-hacer", etiqueta: "No hacer seguimiento", cambios: { fupsNoShow: VALORES.noHacer } }),
        olvidar, presentado, noPresentado,
      ],
    }));
  }

  // Con fecha acordada manda la fecha, no la cuenta de días desde la call (ni el toque de hoy).
  if (ctx.proximo) {
    return conFechaAcordada(ctx, crear(ctx, {
      tipo: "NO_SHOW",
      grupo: "noShow",
      titulo: `Enviar ${seguimiento(n + 1)}`,
      estado,
      fecha: base,
      botones: [enviado(ctx, "fupsNoShow", n + 1), coordinar, presentado, noPresentado, olvidar],
    }));
  }

  // S1 el mismo día del no-show, S2 al día siguiente, etc. Sin tope de días (no hay LIMPIAR desde el
  // 28/09/2026): un no-show viejo sin cerrar sigue acá con el seguimiento que falta, atrasado. El
  // toque de hoy solo frena si ya se mandó un seguimiento (n > 0): marcar R = No escribe AG y el S1
  // tiene que salir en el momento.
  const debido = Math.min(MAX_SEGUIMIENTOS, dias + 1);
  if (n >= debido || (ctx.tocadoHoy && n > 0)) {
    return crear(ctx, {
      tipo: "NO_SHOW", grupo: "noShow", titulo: "Seguimiento al día · registrar si se presentó a la reagenda",
      estado, fecha: base, botones: [presentado, noPresentado, coordinar, olvidar],
    });
  }
  return crear(ctx, {
    tipo: "NO_SHOW",
    grupo: "noShow",
    titulo: `Enviar ${seguimiento(n + 1)}`,
    estado,
    fecha: base,
    // S1 el día del no-show, S2 al siguiente…: S<n+1> tocaba el día n. Sin tope, así un S5 de agosto
    // también figura atrasado (con el tope de 5 de `debido` quedaba "al día").
    atrasado: dias > n,
    botones: [enviado(ctx, "fupsNoShow", n + 1), coordinar, presentado, noPresentado, olvidar],
  });
}

/**
 * Se presentó y V no es Reagendó (o está vacío). `base` = la última reunión que ya pasó
 * (`ultimaReunion`): el resultado es de esa reunión y los días del seguimiento se cuentan desde ahí.
 * El seguimiento post-call va siempre en W.
 */
function resultado(ctx: Contexto, base: Date): Accion | null {
  const { v } = ctx;
  if (!v.situacion.trim()) {
    return crear(ctx, {
      tipo: "RESULTADO",
      grupo: "resultado",
      titulo: "Cargar el resultado de la call",
      estado: "Se presentó · falta el resultado",
      fecha: base,
      botones: [botonCargarResultado()],
    });
  }

  const valor = v.seguimientoPost1;
  if (es(valor, VALORES.noHacer)) return null;

  const noHacer = botonNoHacer();
  if (!valor.trim()) {
    return crear(ctx, {
      tipo: "DEFINIR_SEGUIMIENTO",
      grupo: "resultado",
      titulo: "¿Hacer seguimiento?",
      estado: `Resultado: ${v.situacion.trim()}`,
      fecha: base,
      botones: [
        { id: "hacer", etiqueta: "Hacer", cambios: { seguimientoPost1: VALORES.hacer }, principal: true },
        // Al terminar la call es cuando más se acuerda "hablamos el jueves": Hacer con el día ya coordinado
        { id: "hacer-coordinar", etiqueta: "Hacer · Coordinar fecha", cambios: { seguimientoPost1: VALORES.hacer }, pide: "seguimiento" },
        noHacer,
      ],
    });
  }

  const n = numeroSeguimiento(valor);
  const dias = diasDesde(base, ctx.ahora);
  const estado = `${v.situacion.trim()} · ${n > 0 ? `${seguimiento(n)} enviado` : "seguimiento sin arrancar"}`;
  const cerro: Boton = {
    id: "cerro",
    etiqueta: "Cerró",
    cambios: { situacion: VALORES.cerradoEnSeguimiento },
    pide: "cierre",
  };
  // Reagendó es un motivo de no cierre, con decisión de seguimiento en W.
  const reagendo = botonReagendoPost();
  // Con fecha acordada, lo que saca al lead de la secuencia también borra AH
  const coordinar = botonCoordinar();
  const [noHacerS, cerroS, reagendoS] = [noHacer, cerro, reagendo].map((b) => sinFecha(ctx, b));

  if (n >= MAX_SEGUIMIENTOS) {
    if (ctx.tocadoHoy) return null;
    return conFechaAcordada(ctx, crear(ctx, {
      tipo: "CERRAR_POST_CALL",
      grupo: "postCall",
      titulo: "Terminó la secuencia: ¿no hacer, reagendó o cerró?",
      estado,
      fecha: base,
      botones: [noHacerS, reagendoS, cerroS],
    }));
  }

  // Con fecha acordada manda la fecha, no la cuenta de días desde la reunión (ni el toque de hoy).
  if (ctx.proximo) {
    return conFechaAcordada(ctx, crear(ctx, {
      tipo: "POST_CALL",
      grupo: "postCall",
      titulo: `Enviar ${seguimiento(n + 1)}`,
      estado,
      fecha: base,
      botones: [enviado(ctx, "seguimientoPost1", n + 1), coordinar, cerroS, noHacerS, reagendoS],
    }));
  }

  // S1 al día siguiente de la reunión, S2 a los dos días, etc. Sin tope de días, como en el no-show:
  // un post-call viejo sin cerrar sigue acá, atrasado. El toque de hoy solo frena si ya se mandó un
  // seguimiento: si hoy se definió "Hacer", el S1 sale en el momento.
  const debido = Math.min(MAX_SEGUIMIENTOS, dias);
  if (n >= debido || (ctx.tocadoHoy && n > 0)) return null;
  return crear(ctx, {
    tipo: "POST_CALL",
    grupo: "postCall",
    titulo: `Enviar ${seguimiento(n + 1)}`,
    estado,
    fecha: base,
    // S1 al día siguiente de la call: S<n+1> tocaba el día n + 1. Sin tope (ver no-show).
    atrasado: dias > n + 1,
    botones: [enviado(ctx, "seguimientoPost1", n + 1), coordinar, cerroS, noHacerS, reagendoS],
  });
}

const botonCargarResultado = (): Boton => ({
  id: "resultado",
  etiqueta: "Cargar resultado",
  cambios: {},
  pide: "situacion",
  principal: true,
});

const botonNoHacer = (): Boton => ({ id: "noHacer", etiqueta: "No hacer", cambios: { seguimientoPost1: VALORES.noHacer } });

// ---------------------------------------------------------------------------------------

export const PRIORIDAD: Record<Grupo, number> = {
  sePresento: 0,
  resultado: 0,
  precall: 1,
  noShow: 2,
  postCall: 3,
};

/** Columnas de seguimientos: lo atrasado va abajo (`compararOrden`). */
const GRUPOS_SEGUIMIENTO: readonly Grupo[] = ["noShow", "postCall"];

/** Lo que hace falta para ordenar una tarjeta: el grupo, si está atrasada y su fecha en milisegundos. */
export type ClaveOrden = { grupo: Grupo; atrasado: boolean; tiempo: number };

/**
 * El orden de las tarjetas: el del motor y el "Prioridad" de la pantalla (`ordenar` de pantalla.ts
 * usa esta misma función). Primero el grupo (PRIORIDAD) y, dentro del grupo:
 * - No-show y Post-call (decisión de Gero del 28/09/2026): primero las que están al día (y los
 *   "Terminó la secuencia"), la fecha más vieja primero; después las atrasadas, de la reunión más
 *   reciente a la más vieja: lo más caliente arriba y lo más frío abajo.
 * - El resto: la fecha más vieja primero (en Pre-call, las calls que ya pasaron quedan arriba).
 */
export function compararOrden(a: ClaveOrden, b: ClaveOrden): number {
  const porGrupo = PRIORIDAD[a.grupo] - PRIORIDAD[b.grupo];
  if (porGrupo !== 0) return porGrupo;
  if (a.grupo === b.grupo && GRUPOS_SEGUIMIENTO.includes(a.grupo)) {
    if (a.atrasado !== b.atrasado) return a.atrasado ? 1 : -1;
    if (a.atrasado) return b.tiempo - a.tiempo;
  }
  return a.tiempo - b.tiempo;
}

type ParaOrdenar = Pick<Accion, "grupo" | "atrasado" | "fecha">;
const claveOrden = (a: ParaOrdenar): ClaveOrden => ({ grupo: a.grupo, atrasado: a.atrasado, tiempo: a.fecha.getTime() });

/** `compararOrden` sobre acciones del motor (con la fecha como `Date`). */
export function compararAcciones(a: ParaOrdenar, b: ParaOrdenar): number {
  return compararOrden(claveOrden(a), claveOrden(b));
}

/**
 * Lo que sale de "Log App" para armar el día (opcional: sin esto, el motor igual funciona, pero
 * ninguna tarjeta de pre-call sale "enviada hoy" ni `listoPorHoy`).
 * `precallHoy`: leads a los que hoy ya se les mandó una fase del pre-call, con las dos claves de
 * cada envío (`claveFaseHoy` y `claveFaseHoyPorF`).
 */
export type ContextoDia = {
  precallHoy?: ReadonlySet<string>;
  /** Pre-call v2 prendido (`precallV2Activo()`): lo pasa el servidor, el motor no lee el entorno. */
  precallV2?: boolean;
  /** Desde qué reunión entra un lead nuevo al v2 (`precallV2Desde()`, PRECALL_V2_DESDE). */
  precallV2Desde?: Date | null;
  /** Pestañas con el v2 encendido (`precallV2Hojas()`, PRECALL_V2_CLOSERS); sin esto, todas. */
  precallV2Hojas?: ReadonlySet<string> | null;
};

/** Clave de un lead para `ContextoDia.precallHoy`: hoja + fila + nombre (por si se movieron filas). */
export const claveFaseHoy = (hoja: string, fila: number, nombre: string) => `${hoja}:${fila}:${normalizar(nombre)}`;

/**
 * Clave de respaldo para `ContextoDia.precallHoy`, sin la fila: hoja + nombre + el F que la app
 * escribió hoy. El log guarda el número de fila del momento del Enviado; si después alguien insertó u
 * ordenó filas (las hojas se mantienen ordenadas por fecha de la call), la fila ya no coincide. Con
 * esta clave, el lead que se movió y sigue con el F que se le escribió hoy se reconoce igual (sigue
 * "listo por hoy"); un homónimo con otro F, no. Otro separador que `claveFaseHoy`: no se confunden.
 */
export const claveFaseHoyPorF = (hoja: string, nombre: string, fase: string) =>
  `${hoja}\u0000${normalizar(nombre)}\u0000${normalizar(fase)}`;

/** Hoy ya se le mandó una fase del pre-call a este lead: por su fila o, si se movió, por nombre + F. */
function faseEnviadaHoyDe(fila: FilaLead, dia: ContextoDia): boolean {
  const hoy = dia.precallHoy;
  if (!hoy) return false;
  const { hoja, numeroFila, valores } = fila;
  return hoy.has(claveFaseHoy(hoja, numeroFila, valores.nombre)) || hoy.has(claveFaseHoyPorF(hoja, valores.nombre, valores.precall));
}

/** Las acciones de hoy de un lead (hasta dos: pre-call y principal), en el orden del motor. */
export function accionesDeFila(fila: FilaLead, ahora: Date, dia: ContextoDia = {}): Accion[] {
  const faseHoy = faseEnviadaHoyDe(fila, dia);
  // Pre-call v2: hasta el pase el lead es solo del pre-caller (ni pre-call ni "¿Se presentó?" para el closer)
  const hojaV2 = !dia.precallV2Hojas || dia.precallV2Hojas.has(fila.hoja);
  const v2 = dia.precallV2 === true && hojaV2 && esLeadV2(fila.valores, dia.precallV2Desde ?? null);
  const pasado = v2 && pasadoAlCloser(fila.valores);
  // Sin pase pero con "¿Se presentó?" ya cargado (alguien lo cargó a mano): lo que sigue es del closer, como siempre
  // Una reagenda (R = No con AC) no cuenta: el pre-caller sigue hasta el pase, con el horario nuevo.
  const conAsistencia = fila.valores.presentoAgenda1.trim() !== "" && !reagendadoSinPresentarse(fila.valores);
  const candidatas = !v2
    ? [accionPrecall(fila, ahora, faseHoy), proximaAccion(fila, ahora)]
    : pasado
      ? [accionRecordatoriosV2(fila, ahora), proximaAccion(fila, ahora)]
      : conAsistencia
        ? [proximaAccion(fila, ahora)]
        : [accionPrecaller(fila, ahora)];
  const acciones = candidatas.filter((a): a is Accion => a !== null);
  return acciones.sort(compararAcciones);
}

export type ItemDelDia = { fila: FilaLead; accion: Accion };

/**
 * La lista del día de un closer: una tarjeta por acción (un lead puede tener dos: la de pre-call y
 * la principal, en columnas distintas), en el orden de `compararOrden` (grupo y, dentro, fecha; en
 * No-show y Post-call las atrasadas abajo). Incluye las de pre-call "listas por hoy"
 * (`listoPorHoy`, solo con `dia.precallHoy`): quien cuenta pendientes las tiene que dejar afuera
 * (`contarPendientes` y compañía de pantalla.ts).
 */
export function accionesDelDia(filas: readonly FilaLead[], ahora: Date, dia: ContextoDia = {}): ItemDelDia[] {
  const items: ItemDelDia[] = [];
  for (const fila of filas) {
    for (const accion of accionesDeFila(fila, ahora, dia)) items.push({ fila, accion });
  }
  return items.sort((a, b) => compararAcciones(a.accion, b.accion));
}
