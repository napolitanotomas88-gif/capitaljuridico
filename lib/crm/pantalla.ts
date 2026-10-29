// Lógica pura de la pantalla "Mi día" (docs/arquitectura.md §Pantalla, docs/diseno.md).
// Sin React, sin red y sin "server-only": la importan los componentes cliente y los tests.
// Acá viven las etiquetas, la urgencia, los filtros, el orden y cómo cada formulario de la hoja
// inferior arma el objeto `cambios` que va a `ejecutarAccion`.

import { SITUACIONES_CERRADAS, VALORES } from "@/lib/crm/config/crm";
import type {
  AccionCliente,
  CallDelDia,
  CambioHecho,
  Cambios,
  Identidad,
  ItemCliente,
  OperacionHecha,
  ValoresEscribibles,
} from "@/lib/crm/contratos";
import { diasDesde, formatearFechaSheet, parsearFechaSheet, partesFecha } from "@/lib/crm/fechas";
import {
  TIPOS_ACCION,
  compararOrden,
  numeroSeguimiento,
  type Boton,
  type ClaveOrden,
  type Grupo,
  type Pedido,
  type TipoAccion,
} from "@/lib/crm/motor/proxima-accion";
import { etiquetaCampo } from "@/lib/crm/sheets/columnas";
import {
  LARGO_MAXIMO_CELDA,
  MENSAJE_MILES,
  esNumero,
  normalizarTexto,
  pareceMiles,
  soloDigitos,
} from "@/lib/crm/sheets/verificacion";

export const ETIQUETA_GRUPO: Record<Grupo, string> = {
  precall: "Pre-call",
  sePresento: "¿Se presentó?",
  resultado: "Resultado",
  noShow: "No-show",
  postCall: "Post-call",
};

/**
 * `/lead/<hoja>/<fila>`: la ficha con URL propia (celular, abrir en otra pestaña, compartir, links
 * del admin). La página la decodifica con `decodificarParam` (src/lib/entrada.ts).
 */
export const hrefFicha = (lead: { hoja: string; numeroFila: number }) => `/ventas/lead/${encodeURIComponent(lead.hoja)}/${lead.numeroFila}`;

/**
 * Quién es el lead de la ficha: hoja, fila, nombre y teléfono (y la fecha de la call si no tiene
 * teléfono), con el mismo criterio que `mismaIdentidad` del servidor. La ficha se lee por hoja +
 * fila: si alguien ordena la planilla, en la misma fila puede aparecer otro lead. Con esta clave
 * como `key`, las notas y el formulario de cierre arrancan de cero y lo escrito para el anterior no
 * se guarda en el nuevo. Sin campos que la app escribe (montos, AB…): guardar no la cambia.
 */
export function claveIdentidad(identidad: Identidad): string {
  const telefono = soloDigitos(identidad.telefono);
  const fecha = identidad.fechaCall.trim();
  const fechaCall = telefono ? "" : String(parsearFechaSheet(fecha)?.getTime() ?? fecha);
  return JSON.stringify([identidad.hoja, identidad.numeroFila, normalizarTexto(identidad.nombre), telefono, fechaCall]);
}

/**
 * Orden de los chips en el celular (BRIEF.md §5). Sin "Limpiar" desde el 28/09/2026 (decisión de
 * Gero): los seguimientos atrasados siguen en No-show y Post-call.
 */
export const GRUPOS_CHIPS: readonly Grupo[] = ["precall", "sePresento", "resultado", "noShow", "postCall"];

/** Columnas del tablero en la computadora (docs/diseno.md): cinco, una por grupo. */
export const COLUMNAS_TABLERO: readonly { titulo: string; grupos: readonly Grupo[] }[] = [
  { titulo: "Pre-call", grupos: ["precall"] },
  { titulo: "¿Se presentó?", grupos: ["sePresento"] },
  { titulo: "Resultado", grupos: ["resultado"] },
  { titulo: "No-show", grupos: ["noShow"] },
  { titulo: "Post-call", grupos: ["postCall"] },
];

export type Urgencia = "hoy" | "normal" | "listo";

/**
 * Franja izquierda de la tarjeta: naranja = hay que hacerlo hoy (también lo atrasado), negro =
 * pendiente normal, gris = pre-call "listo por hoy" (no es pendiente).
 */
export function urgencia(accion: Pick<AccionCliente, "grupo" | "atrasado" | "listoPorHoy">): Urgencia {
  if (accion.listoPorHoy) return "listo";
  if (accion.grupo === "sePresento" || accion.grupo === "resultado" || accion.atrasado) return "hoy";
  return "normal";
}

// ---------------------------------------------------------------------------------------
// Filtros, búsqueda y orden (todo en el cliente, sobre la lista que ya vino del servidor)

export type FiltroFecha = "todo" | "hoy" | "manana" | "semana" | "atrasados" | "rango";
/** Fechas como las da un `<input type="date">`: "yyyy-mm-dd". Vacío = sin límite. */
export type Rango = { desde: string; hasta: string };

export const FILTROS_FECHA: readonly { id: FiltroFecha; etiqueta: string }[] = [
  { id: "todo", etiqueta: "Todo" },
  { id: "hoy", etiqueta: "Hoy" },
  { id: "manana", etiqueta: "Mañana" },
  { id: "semana", etiqueta: "Esta semana" },
  { id: "atrasados", etiqueta: "Atrasados" },
  { id: "rango", etiqueta: "Rango" },
];

const dos = (n: number) => String(n).padStart(2, "0");

/** "yyyy-mm-dd" en Buenos Aires: comparable como texto con el valor de un `<input type="date">`. */
export function claveDia(fecha: Date): string {
  const p = partesFecha(fecha);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** "yyyy-mm-ddTHH:mm" en Buenos Aires, para el `min` de un `<input type="datetime-local">`. */
export function datetimeLocalDesde(fecha: Date): string {
  const p = partesFecha(fecha);
  return `${claveDia(fecha)}T${dos(p.hora)}:${dos(p.minuto)}`;
}

/** Filtra por la fecha de la acción (la call, o la reagenda si corresponde). */
export function pasaFiltroFecha(item: ItemCliente, filtro: FiltroFecha, ahora: Date, rango?: Rango): boolean {
  const fecha = new Date(item.accion.fecha);
  // Días hacia adelante: 0 = hoy, 1 = mañana, negativo = ya pasó.
  const adelante = -diasDesde(fecha, ahora);
  switch (filtro) {
    case "todo":
      return true;
    case "hoy":
      return adelante === 0;
    case "manana":
      return adelante === 1;
    case "semana": {
      // La semana calendario (lunes a domingo) que contiene a hoy.
      const desdeLunes = (partesFecha(ahora).diaSemana + 6) % 7;
      return adelante >= -desdeLunes && adelante <= 6 - desdeLunes;
    }
    case "atrasados":
      return item.accion.atrasado;
    case "rango": {
      const clave = claveDia(fecha);
      return (!rango?.desde || clave >= rango.desde) && (!rango?.hasta || clave <= rango.hasta);
    }
  }
}

/** Por nombre (sin tildes ni mayúsculas) o por teléfono (al menos 3 dígitos seguidos). */
export function coincideBusqueda(item: ItemCliente, texto: string): boolean {
  const buscado = normalizarTexto(texto);
  if (!buscado) return true;
  if (normalizarTexto(item.identidad.nombre).includes(buscado)) return true;
  const digitos = soloDigitos(texto);
  return digitos.length >= 3 && soloDigitos(item.identidad.telefono).includes(digitos);
}

export type Orden = "prioridad" | "hora";

/**
 * Prioridad = el orden del motor (`compararOrden`: grupo y fecha, y en No-show y Post-call primero
 * lo que está al día y después lo atrasado, de lo más reciente a lo más viejo); hora = solo la
 * fecha, la más vieja primero. En el tablero de la computadora siempre es Prioridad.
 */
export function ordenar(items: ItemCliente[], orden: Orden): ItemCliente[] {
  const conClave = items.map((item) => {
    const clave: ClaveOrden = { grupo: item.accion.grupo, atrasado: item.accion.atrasado, tiempo: Date.parse(item.accion.fecha) };
    return { item, clave };
  });
  conClave.sort((a, b) => (orden === "prioridad" ? compararOrden(a.clave, b.clave) : a.clave.tiempo - b.clave.tiempo));
  return conClave.map((c) => c.item);
}

/** Sirve igual para las tarjetas del cliente (`ItemCliente`) y para las del motor (`ItemDelDia`). */
type ConAccion = { accion: Pick<AccionCliente, "grupo" | "atrasado" | "listoPorHoy"> };

/**
 * Una tarjeta pendiente: todas menos las de pre-call "listas por hoy" (decisión de Gero del
 * 28/09/2026: hoy ya se mandó una fase y la siguiente puede esperar a mañana). Pendientes, atrasados,
 * grupos, progreso y "Todo al día" cuentan solo las pendientes, en el closer y en el admin.
 */
export const esPendiente = (item: ConAccion) => !item.accion.listoPorHoy;

/**
 * La misma tarjeta como pendiente (una lista de otro día: ver `vistaDelDia`). Un No-show o Post-call
 * con el seguimiento acordado para un día que todavía no llegó sigue esperando (su fecha es la acordada).
 */
const sinListoPorHoy = (item: ItemCliente, ahora: Date): ItemCliente => {
  if (!item.accion.listoPorHoy) return item;
  const acordadoMasAdelante = item.accion.grupo !== "precall" && diasDesde(new Date(item.accion.fecha), ahora) < 0;
  return acordadoMasAdelante ? item : { ...item, accion: { ...item.accion, listoPorHoy: false } };
};

/**
 * La sección plegada "Listo por hoy" se muestra abierta si el closer la abrió (`elegida`, guardada en
 * MiDia: sobrevive a que la sección se desmonte, p. ej. al pasar a "Todo al día" o cambiar de chip),
 * si hay una búsqueda (lo encontrado no puede quedar escondido) o si una tarjeta de adentro volvió
 * con un error (la escritura falló: el aviso tiene que verse). Cerrada por defecto.
 */
export function seccionListosAbierta(elegida: boolean, busqueda: string, hayError: boolean, filtro: FiltroFecha = "todo"): boolean {
  // Con Mañana, Esta semana o Rango lo que se busca suele ser lo coordinado para otro día: abierta
  return elegida || busqueda.trim() !== "" || hayError || filtro === "manana" || filtro === "semana" || filtro === "rango";
}

/** Separa las pendientes de las listas por hoy, sin cambiar el orden. */
export function separarListos<T extends ConAccion>(items: readonly T[]): { pendientes: T[]; listos: T[] } {
  const pendientes: T[] = [];
  const listos: T[] = [];
  for (const item of items) (esPendiente(item) ? pendientes : listos).push(item);
  return { pendientes, listos };
}

export function contarPendientes(items: readonly ConAccion[]): number {
  return items.filter(esPendiente).length;
}

/** Pendientes por grupo (las listas por hoy no cuentan). */
export function contarPorGrupo(items: readonly ConAccion[]): Record<Grupo, number> {
  const conteo: Record<Grupo, number> = { precall: 0, sePresento: 0, resultado: 0, noShow: 0, postCall: 0 };
  for (const item of items) if (esPendiente(item)) conteo[item.accion.grupo] += 1;
  return conteo;
}

/** Pendientes atrasadas (una lista por hoy nunca está atrasada; igual se deja afuera). */
export function contarAtrasados(items: readonly ConAccion[]): number {
  return items.filter((i) => esPendiente(i) && i.accion.atrasado).length;
}

export type VistaDelDia = {
  /** Las pendientes (sin filtros): encabezado, progreso del día y "Todo al día" (cuando no queda ninguna). */
  pendientes: ItemCliente[];
  /** Atrasadas entre las pendientes (encabezado). */
  atrasados: number;
  /** Pendientes con el filtro de fecha y la búsqueda, por grupo (chips del celular y columnas del tablero). */
  conteo: Record<Grupo, number>;
  /** Pendientes con el filtro y la búsqueda (chip "Todo"). */
  totalFiltrado: number;
  /** Pendientes con el filtro y la búsqueda, en el orden pedido: la lista y las columnas. */
  lista: ItemCliente[];
  /** Listas por hoy con el filtro y la búsqueda, en el mismo orden: la sección plegada "Listo por hoy". */
  listos: ItemCliente[];
};

/**
 * Lo que muestra "Mi día" a partir de las tarjetas visibles (sin las ocultas por el optimista): las
 * pendientes arriba y las de pre-call listas por hoy aparte, para plegarlas al pie. Los contadores y
 * "Todo al día" miran solo las pendientes; el filtro de fecha y la búsqueda valen para las dos.
 *
 * `diaDeLaLista` (`claveDia` del momento en que el servidor armó la lista): si `ahora` ya es otro día
 * (la pantalla quedó abierta pasada la medianoche y la lista nueva todavía no llegó, o no se pudo
 * leer), "listo por hoy" era de aquel día: todas cuentan como pendientes. MiDia además pide la lista
 * nueva al cambiar el día, y el servidor la recalcula.
 */
export function vistaDelDia(
  visibles: readonly ItemCliente[],
  opciones: { filtro: FiltroFecha; rango?: Rango; busqueda: string; ahora: Date; orden: Orden; diaDeLaLista?: string },
): VistaDelDia {
  const { filtro, rango, busqueda, ahora, orden, diaDeLaLista } = opciones;
  const deOtroDia = diaDeLaLista !== undefined && diaDeLaLista !== claveDia(ahora);
  const vigentes = deOtroDia ? visibles.map((i) => sinListoPorHoy(i, ahora)) : visibles;
  const pendientes = vigentes.filter(esPendiente);
  const filtrados = vigentes.filter((i) => pasaFiltroFecha(i, filtro, ahora, rango) && coincideBusqueda(i, busqueda));
  const { pendientes: lista, listos } = separarListos(ordenar(filtrados, orden));
  return {
    pendientes,
    atrasados: contarAtrasados(pendientes),
    conteo: contarPorGrupo(filtrados),
    totalFiltrado: lista.length,
    lista,
    listos,
  };
}

// ---------------------------------------------------------------------------------------
// Calls de hoy (tira arriba de la lista), con TODAS las calls del día (`callsDeHoy` de mi-dia.ts)

/** Minutos de tolerancia: una call que empezó hace menos que esto todavía es "ahora". */
const MARGEN_AHORA_MIN = 5;

export type CallEnTira = CallDelDia & {
  /** Minutos hasta la call (negativo si ya pasó). */
  minutosHasta: number;
  /** La próxima (o la que está pasando ahora): va resaltada en naranja con "en 45 min". */
  proxima: boolean;
  yaPaso: boolean;
};

/** Las calls del día en orden, con la próxima marcada y cuánto falta para cada una. */
export function tiraDeCalls(calls: readonly CallDelDia[], ahora: Date): CallEnTira[] {
  const ordenadas = [...calls]
    .sort((a, b) => Date.parse(a.fechaISO) - Date.parse(b.fechaISO))
    .map((c) => ({ ...c, minutosHasta: Math.round((Date.parse(c.fechaISO) - ahora.getTime()) / 60_000) }));
  const proxima = ordenadas.find((c) => c.minutosHasta >= -MARGEN_AHORA_MIN);
  return ordenadas.map((c) => ({ ...c, proxima: c === proxima, yaPaso: c.minutosHasta < -MARGEN_AHORA_MIN }));
}

/** "en 45 min", "en 2 h", "ahora" o "" si ya pasó. */
export function textoEnCuanto(minutos: number): string {
  if (minutos < -MARGEN_AHORA_MIN) return "";
  if (minutos <= MARGEN_AHORA_MIN) return "ahora";
  if (minutos < 90) return `en ${minutos} min`;
  return `en ${Math.round(minutos / 60)} h`;
}

/** Ancho (px) del degradé del borde izquierdo de la tira "Calls de hoy" cuando está corrida (2rem). */
export const MASCARA_TIRA_PX = 32;

/**
 * Cuántos px mover la tira "Calls de hoy" (`scrollLeft`) para que la próxima se vea entera; 0 si ya
 * se ve. `caja` y `chip` son los bordes en pantalla (getBoundingClientRect); `corrida`: la tira ya
 * está desplazada, y lo que cae bajo el degradé del borde izquierdo no se ve bien. Si la próxima
 * queda a la derecha, se mueve lo justo para que entre por ese lado (con `aire`): así queda a la
 * vista todo lo que entre de la izquierda (el título con la cantidad, las calls anteriores). Solo si
 * es más ancha que la tira, se alinea su comienzo (la hora y el nombre).
 */
export function desplazamientoTira(
  caja: { left: number; right: number },
  chip: { left: number; right: number },
  corrida: boolean,
  aire = 16,
): number {
  const izquierda = caja.left + (corrida ? MASCARA_TIRA_PX : 0);
  if (chip.left >= izquierda && chip.right <= caja.right) return 0;
  const alComienzo = chip.left - caja.left - MASCARA_TIRA_PX;
  if (chip.right > caja.right) return Math.min(chip.right - caja.right + aire, alComienzo);
  return alComienzo;
}

// ---------------------------------------------------------------------------------------
// Tarjetas ocultas (optimista), progreso del día y "Hechas hoy"

/**
 * Una tarjeta ya hecha se oculta por lead + tipo + título + fecha de la acción: la siguiente acción
 * del mismo lead ("¿Se presentó? Sí" → "Cargar resultado", "Enviar S1" → "Enviar S2", "Enviar fase:
 * VIDEOS CONF" → "Enviar fase: DOLORES") tiene otra clave y sí se ve. La fecha distingue la misma
 * acción sobre otra reunión (p. ej. "No se presentó" → reagendar de nuevo con una fecha que ya pasó
 * vuelve a pedir el resultado, ahora de la nueva). Con el tipo, las dos tarjetas de un mismo lead
 * (pre-call y principal) nunca comparten clave: tocar una no esconde la otra.
 */
export const claveOculta = (item: Pick<ItemCliente, "clave" | "accion">) =>
  `${item.clave}|${item.accion.tipo}|${item.accion.titulo}|${item.accion.fecha}`;

/**
 * Cuando llega una lista nueva del servidor, las ocultas que ya no están en ella no hacen falta
 * (el servidor ya no las muestra). Las que siguen (p. ej. una lectura que salió antes de que
 * terminara la escritura) se quedan ocultas. Devuelve el mismo set si no cambió nada.
 */
export function podarOcultas(ocultas: ReadonlySet<string>, items: readonly Pick<ItemCliente, "clave" | "accion">[]): ReadonlySet<string> {
  if (ocultas.size === 0) return ocultas;
  const vigentes = new Set(items.map(claveOculta));
  const quedan = [...ocultas].filter((k) => vigentes.has(k));
  return quedan.length === ocultas.size ? ocultas : new Set(quedan);
}

/**
 * Saca las ocultas de un lead (`${hoja}:${fila}`) después de deshacer desde "Hechas hoy". Con `tipo`
 * (el de la operación deshecha: `tipoDelMotivo`) vuelven solo las tarjetas de ese tipo: la otra
 * tarjeta del lead (pre-call o principal) no se deshizo y tiene que seguir oculta. Sin tipo (p. ej.
 * un guardado de la ficha), vuelven todas las del lead.
 */
export function mostrarLead(ocultas: ReadonlySet<string>, clave: string, tipo?: TipoAccion | null): ReadonlySet<string> {
  const prefijo = tipo ? `${clave}|${tipo}|` : `${clave}|`;
  const quedan = [...ocultas].filter((k) => !k.startsWith(prefijo));
  return quedan.length === ocultas.size ? ocultas : new Set(quedan);
}

/**
 * Tipos de tarjeta que ya no existen y su equivalente de hoy, para los motivos viejos del log: hasta
 * el 28/09/2026 un seguimiento atrasado era LIMPIAR_NO_SHOW / LIMPIAR_POST_CALL.
 */
const TIPOS_VIEJOS: Readonly<Record<string, TipoAccion>> = {
  LIMPIAR_NO_SHOW: "NO_SHOW",
  LIMPIAR_POST_CALL: "POST_CALL",
};

/** El tipo de tarjeta del motivo del log ("PRE_CALL · Enviado" → "PRE_CALL"); null si no es de una tarjeta ("FICHA · …"). */
export function tipoDelMotivo(motivo: string): TipoAccion | null {
  const tipo = /^([A-Z0-9_]+) · /.exec(motivo.trim())?.[1];
  if (!tipo) return null;
  return TIPOS_ACCION.find((t) => t === tipo) ?? TIPOS_VIEJOS[tipo] ?? null;
}

/**
 * La operación del log salió de una tarjeta (resolvió una acción). Los guardados de la ficha
 * ("FICHA · notas de reagenda", "FICHA · datos de cierre") no: se listan en "Hechas hoy" para
 * poder deshacerlos, pero no suman en el progreso (se pueden guardar cuantas veces haga falta).
 */
export const esDeTarjeta = (motivo: string): boolean => tipoDelMotivo(motivo) !== null;

/**
 * La operación suma en "Hechas N de M": salió de una tarjeta (`esDeTarjeta`) y no la hizo `excluir`
 * (el admin). La misma regla para la barra (`progresoDelDia`) y para la marca "no suma en el
 * progreso" de "Hechas hoy": así la diferencia entre la barra y el chip siempre tiene explicación.
 */
export const sumaEnProgreso = (op: Pick<OperacionHecha, "closer" | "motivo">, excluir?: string): boolean =>
  op.closer !== excluir && esDeTarjeta(op.motivo);

export type Progreso = { hechas: number; total: number; porcentaje: number };

/**
 * "Hechas N de M" (docs/diseno.md): N = operaciones de tarjetas de hoy en la hoja que no se
 * deshicieron (`esDeTarjeta`: los guardados de la ficha no cuentan), sin las de `excluir` (el admin,
 * que tampoco suma en "hechas hoy" del tablero de admin), más las `optimistas` (tarjetas que ya se
 * tocaron y todavía no llegaron al log leído); M = pendientes que quedan + N (lo que había al
 * empezar el día, más o menos). `pendientes` sin las de pre-call listas por hoy (`esPendiente`): la
 * fase de hoy ya cuenta en N y la siguiente es de mañana, así que con todo hecho la barra llega a N de N.
 */
export function progresoDelDia(
  pendientes: number,
  hechas: readonly OperacionHecha[],
  excluir?: string,
  optimistas = 0,
): Progreso {
  const n = hechas.filter((h) => !h.deshecha && sumaEnProgreso(h, excluir)).length + optimistas;
  const total = pendientes + n;
  return { hechas: n, total, porcentaje: total === 0 ? 0 : Math.round((n / total) * 100) };
}

/** Clave de una operación de "Hechas hoy" (el id se puede repetir en otro día). */
export const claveHecha = (op: Pick<OperacionHecha, "idOperacion" | "fecha">) => `${op.idOperacion}|${op.fecha}`;

/**
 * Operaciones de "Hechas hoy" que todavía no se pueden deshacer: hay una posterior del mismo lead,
 * no deshecha, que tocó alguna de sus columnas. El servidor las rechazaría (`fila_cambiada`: la
 * celda ya no tiene el `despues`): primero hay que deshacer esa posterior. Las acciones que escriben
 * AG se bloquean entre sí; el Enviado del pre-call (solo F, sin AG: `tocaUltimoToque`) solo se
 * bloquea con otra que tocó F (otra fase u Olvidar), así que una fase y un S2 del mismo lead se
 * pueden deshacer en cualquier orden. `hechas` viene la más nueva primero (`operacionesDeHoy`).
 */
export function hechasBloqueadas(hechas: readonly OperacionHecha[]): ReadonlySet<string> {
  const bloqueadas = new Set<string>();
  hechas.forEach((op, i) => {
    if (op.deshecha) return;
    const columnas = new Set(op.cambios.map((c) => c.columna));
    const hayPosterior = hechas
      .slice(0, i)
      .some((nueva) => !nueva.deshecha && nueva.hoja === op.hoja && nueva.fila === op.fila && nueva.cambios.some((c) => columnas.has(c.columna)));
    if (hayPosterior) bloqueadas.add(claveHecha(op));
  });
  return bloqueadas;
}

/** El motivo del log sin el tipo técnico adelante: "NO_SHOW · Enviado" → "Enviado". */
export function motivoLegible(motivo: string): string {
  const texto = motivo.replace(/^[A-Z0-9_]+ · /, "").trim();
  return texto ? texto[0].toUpperCase() + texto.slice(1) : "";
}

/** Las celdas de una operación para mostrar: sin el último toque (AG), salvo que sea lo único. */
export function cambiosVisibles(cambios: readonly CambioHecho[]): CambioHecho[] {
  const sinToque = cambios.filter((c) => c.campo !== "ultimoToque");
  return sinToque.length > 0 ? sinToque : [...cambios];
}

/** "Situación: — → Quiere pensarlo" */
export function textoCambio(c: CambioHecho): string {
  return `${etiquetaCampo(c.campo || c.columna)}: ${c.antes.trim() || "—"} → ${c.despues.trim() || "—"}`;
}

// ---------------------------------------------------------------------------------------
// Formularios de la hoja inferior: cada uno arma `cambios` a partir de lo que cargó el closer

const MAX_MOTIVO = 200;

/** Texto corto para el log: "NO_SHOW · Enviado" o "RESULTADO · Cargar resultado: Quiere pensarlo · Hacer". */
export function motivoDe(tipo: TipoAccion, boton: Boton, detalle?: string): string {
  const base = `${tipo} · ${boton.etiqueta}`;
  return (detalle ? `${base}: ${detalle}` : base).slice(0, MAX_MOTIVO);
}

/**
 * `esperado` para `ejecutarAccion`: lo que tenía cada celda de `cambios` cuando se armó la tarjeta.
 * Si alguien la cambió desde entonces (en la planilla o en otra pestaña), la escritura se rechaza
 * con `fila_cambiada` en vez de pisarla.
 */
export function esperadoPara(valores: Partial<ValoresEscribibles>, cambios: Cambios): Cambios {
  const esperado: Cambios = {};
  for (const campo of Object.keys(cambios) as (keyof Cambios)[]) {
    esperado[campo] = (valores as Partial<Record<string, string>>)[campo] ?? "";
  }
  return esperado;
}

const esSituacion = (situacion: string, valor: string) => normalizarTexto(situacion) === normalizarTexto(valor);

/** "Cerrado en llamada" o "Cerrado en seguimiento": piden cash y valor y no llevan seguimiento. */
export const esCerrado = (situacion: string) => SITUACIONES_CERRADAS.some((s) => esSituacion(situacion, s));

/** Reconoce el motivo de no cierre "Reagendó" (sin fecha obligatoria). */
export const esReagendo = (situacion: string) => esSituacion(situacion, VALORES.reagendo);

/**
 * El formulario de resultado es de una reunión reagendada (RESULTADO_REAGENDA: V = Reagendó y la
 * fecha de AC ya pasó): ofrece "No se presentó" y, con una situación + "Hacer", reinicia W.
 */
export const esResultadoReagenda = (item: Pick<ItemCliente, "accion">) => item.accion.tipo === "RESULTADO_REAGENDA";

/**
 * "Cancelar reunión" (tarjeta de Pre-call de una reunión que todavía no empezó; pedido de Tomás del 19/10/2026): cancela el
 * evento en Calendly y deja al lead fuera de todas las listas: R = No, Pre-call = Olvidar y Fups no-show = No hacer. La nota en
 * AB la agrega el servidor (`cancelarReunion`). Pide confirmación: lo de Calendly no se deshace.
 */
export const BOTON_CANCELAR_REUNION: Boton & { pide: "cancelacion" } = {
  id: "cancelarReunion",
  etiqueta: "Cancelar reunión",
  pide: "cancelacion",
  cambios: { presentoAgenda1: VALORES.no, precall: VALORES.olvidar, fupsNoShow: VALORES.noHacer },
};

/** Título de la hoja inferior según lo que pide el botón. */
export function tituloFormulario(pide: Pedido, reagendada = false): string {
  switch (pide) {
    case "situacion":
      return reagendada ? "Resultado de la reunión reagendada" : "Resultado de la call";
    case "cierre":
      return "Cerró: datos del cierre";
    case "reagenda":
      return "Reagendó: nueva fecha";
    case "seguimiento":
      return "Coordinar fecha del próximo seguimiento";
    case "cancelacion":
      return "¿Cancelar la reunión?";
  }
}

export type CampoMonto = "cashDia1" | "cashTratoCerrado" | "valorServicio";
export type Montos = Partial<Record<CampoMonto, string>>;

/** El error de un monto dice de cuál habla (`campo`): la hoja inferior lleva el foco a ese. */
type FalloMonto = { ok: false; error: string; campo: CampoMonto };

export type ResultadoFormulario =
  | { ok: true; cambios: Cambios; detalle: string }
  | { ok: false; error: string; campo?: CampoMonto };

const fallo = (error: string): ResultadoFormulario => ({ ok: false, error });

export const ETIQUETA_MONTO: Record<CampoMonto, string> = {
  cashDia1: "Cash cobrado en la llamada (día 1)",
  cashTratoCerrado: "Cash cobrado al cerrar el trato",
  valorServicio: "Valor del servicio",
};

/**
 * Solo los montos cargados. Devuelve un error (con el `campo`) si alguno no es un número positivo o
 * viene con separador de miles ("1.500" se escribiría como 1,5: `pareceMiles`).
 */
export function leerMontos(montos: Montos): { ok: true; montos: Montos } | FalloMonto {
  const limpios: Montos = {};
  for (const campo of Object.keys(ETIQUETA_MONTO) as CampoMonto[]) {
    const valor = (montos[campo] ?? "").trim();
    if (!valor) continue;
    if (pareceMiles(valor)) return { ok: false, error: `${ETIQUETA_MONTO[campo]}: "${valor}": ${MENSAJE_MILES}.`, campo };
    if (!esNumero(valor) || Number(valor.replace(",", ".")) < 0) {
      return { ok: false, error: `${ETIQUETA_MONTO[campo]}: "${valor}" no es un número válido.`, campo };
    }
    limpios[campo] = valor;
  }
  return { ok: true, montos: limpios };
}

/** Cierre (en llamada o en seguimiento): Y, Z y AA obligatorios. Los vacíos no se mandan. */
function montosDeCierre(montos: Montos): { ok: true; montos: Montos } | FalloMonto {
  const leidos = leerMontos(montos);
  if (!leidos.ok) return leidos;
  if (!leidos.montos.cashDia1) return { ok: false, error: `Cargá el ${ETIQUETA_MONTO.cashDia1.toLowerCase()}.`, campo: "cashDia1" };
  if (!leidos.montos.valorServicio) return { ok: false, error: "Cargá el valor del servicio.", campo: "valorServicio" };
  if (!leidos.montos.cashTratoCerrado) return { ok: false, error: "Cargá el cash cobrado al cerrar el trato.", campo: "cashTratoCerrado" };
  return leidos;
}

export type DatosReagenda = { fechaHora: string; datos: string };

/** Lo mismo que acepta la escritura para el texto libre (`validarCambios`): una celda entera. */
export const MAX_TEXTO_REAGENDA = LARGO_MAXIMO_CELDA;

/** "No se presentó" a la reunión reagendada: reagendarla de nuevo (AC) o dejarlo (W = No hacer). */
export type SalidaNoVino = "reagendar" | "dejar";

export type DatosSituacion = {
  situacion: string;
  /**
   * Solo en el resultado de una reunión reagendada: eligió "No se presentó" (en vez de una
   * situación) y qué hacer (null = todavía no eligió).
   */
  noSePresento?: { salida: SalidaNoVino | null };
  /** null = todavía no eligió. Solo se usa si la situación no es un cierre ni "Reagendó". */
  hacerSeguimiento: boolean | null;
  montos: Montos;
  /** Si la situación es "Reagendó" o si no se presentó y se reagenda de nuevo. */
  reagenda: DatosReagenda;
};

/** Lo que el formulario de resultado necesita saber de la fila (sale de `ItemCliente`). */
export type ContextoResultado = {
  /** AB tal como se leyó (el campo de datos arranca con esto). */
  datosReagenda: string;
  /** Resultado de una reunión reagendada (`esResultadoReagenda`): "No se presentó" y "Hacer" reinicia W. */
  reagendada?: boolean;
  /** W tal como se leyó, p. ej. "S2" si ya se mandaron mensajes. */
  seguimientoActual?: string;
};

/**
 * RESULTADO / RESULTADO_REAGENDA: V con la situación elegida y, según el caso:
 * - "Cerrado en llamada" / "Cerrado en seguimiento": Y, Z y AA (obligatorios); W no se toca.
 * - "Reagendó": motivo de no cierre; Hacer / No hacer en W, sin fecha obligatoria.
 * - cualquier otra: Hacer / No hacer en W. En el resultado de la call (RESULTADO), si W ya tiene
 *   S1…S5 (seguimientos mandados antes de cargar el resultado), "Hacer" no la toca: la secuencia
 *   sigue donde estaba. En el de una reunión reagendada se reinicia: es una reunión nueva.
 * Solo en RESULTADO_REAGENDA, "No se presentó" en vez de una situación: "Reagendar de nuevo" (AC y
 * AB opcional; V sigue Reagendó) o "Dejarlo" (W = No hacer).
 */
export function formularioSituacion(boton: Boton, contexto: ContextoResultado, datos: DatosSituacion): ResultadoFormulario {
  if (contexto.reagendada && datos.noSePresento) return formularioNoSePresento(boton, contexto, datos);

  const situacion = datos.situacion.trim();
  if (!situacion) return fallo(contexto.reagendada ? "Elegí cómo terminó la reunión." : "Elegí el resultado de la call.");

  if (esCerrado(situacion)) {
    const leidos = montosDeCierre(datos.montos);
    if (!leidos.ok) return leidos;
    return { ok: true, cambios: { ...boton.cambios, situacion, ...leidos.montos }, detalle: situacion };
  }

  if (datos.hacerSeguimiento === null) return fallo("Decidí si vas a hacer seguimiento.");
  const seguimiento = datos.hacerSeguimiento ? VALORES.hacer : VALORES.noHacer;
  const yaEnviados = numeroSeguimiento(contexto.seguimientoActual ?? "");
  // Con "Hacer" el seguimiento sigue: la fecha acordada (AH) se conserva. El botón trae AH = "" para
  // los caminos que lo sacan de la secuencia (No hacer, cerrado).
  const base: Cambios = { ...boton.cambios };
  if (datos.hacerSeguimiento) delete base.proximoSeguimiento;
  if (datos.hacerSeguimiento && yaEnviados > 0 && !contexto.reagendada) {
    return { ok: true, cambios: { ...base, situacion }, detalle: `${situacion} · ${seguimiento} (sigue en S${yaEnviados})` };
  }
  return {
    ok: true,
    cambios: { ...base, situacion, seguimientoPost1: seguimiento },
    detalle: `${situacion} · ${seguimiento}`,
  };
}

/** "No se presentó" a la reunión reagendada: V sigue Reagendó y se reagenda de nuevo o se deja. */
function formularioNoSePresento(boton: Boton, contexto: ContextoResultado, datos: DatosSituacion): ResultadoFormulario {
  switch (datos.noSePresento?.salida) {
    case "reagendar": {
      const reagenda = formularioReagenda(boton, datos.reagenda, contexto.datosReagenda);
      return reagenda.ok ? { ...reagenda, detalle: `No se presentó · reagendó ${reagenda.detalle}` } : reagenda;
    }
    case "dejar":
      return { ok: true, cambios: { ...boton.cambios, seguimientoPost1: VALORES.noHacer }, detalle: "No se presentó · No hacer" };
    default:
      return fallo("Elegí si lo reagendás de nuevo o lo dejás.");
  }
}

/** CERRÓ (post-call): V = Cerrado en seguimiento (viene en el botón) + Y, Z y AA obligatorios. */
export function formularioCierre(boton: Boton, montos: Montos): ResultadoFormulario {
  const leidos = montosDeCierre(montos);
  if (!leidos.ok) return leidos;
  return { ok: true, cambios: { ...boton.cambios, ...leidos.montos }, detalle: `valor ${leidos.montos.valorServicio}` };
}

/** "yyyy-mm-ddTHH:mm" (input datetime-local, hora de Buenos Aires) → "dd/mm/yyyy HH:mm:00". */
export function textoSheetDesdeDatetimeLocal(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor.trim());
  if (!m) return null;
  const fecha = parsearFechaSheet(`${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`);
  return fecha ? formatearFechaSheet(fecha) : null;
}

/** Hasta cuántos días adelante se puede coordinar un seguimiento. */
export const MAX_DIAS_SEGUIMIENTO = 180;

/**
 * COORDINAR FECHA (pedido de Tomás, 11/10/2026): AH con el día acordado para el próximo seguimiento
 * (`fecha` = "AAAA-MM-DD" del input de tipo date), desde mañana y hasta `MAX_DIAS_SEGUIMIENTO`. Para
 * hoy no hace falta coordinar: se manda y se toca Enviado.
 */
export function formularioSeguimiento(boton: Boton, fecha: string, ahora: Date): ResultadoFormulario {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  const dia = m ? parsearFechaSheet(`${m[3]}/${m[2]}/${m[1]}`) : null;
  if (!m || !dia) return fallo("Elegí el día del próximo seguimiento.");
  const faltan = -diasDesde(dia, ahora);
  if (faltan < 1) return fallo("Elegí un día a partir de mañana. Si es para hoy, mandalo y tocá Enviado.");
  if (faltan > MAX_DIAS_SEGUIMIENTO) return fallo("Elegí un día dentro de los próximos 6 meses.");
  return { ok: true, cambios: { ...boton.cambios, proximoSeguimiento: formatearFechaSheet(dia) }, detalle: `seguimiento el ${m[3]}/${m[2]}` };
}

/** "AAAA-MM-DD" de mañana (mínimo del input de Coordinar fecha). */
export function mananaInput(ahora: Date): string {
  return claveDia(new Date(ahora.getTime() + 24 * 60 * 60 * 1000));
}

/** La pista para un texto libre que empieza con "=" o "+" (el Sheet lo tomaría como fórmula). */
export const PISTA_FORMULA = 'escribí algo antes (p. ej. "Tel: +54…")';

/**
 * REAGENDÓ: AC con la fecha en el texto de la planilla y AB opcional. El campo de AB arranca con
 * lo que ya tiene la celda (`abActual`): solo se escribe (y solo se mide) si el closer lo cambió
 * (y no vacío). Una nota vieja larga que no se tocó nunca frena la reagenda. Lo que cambió no puede
 * empezar con "=" ni "+" (lo rechazaría `validarCambios`): se avisa acá, antes de cerrar la hoja,
 * así no se pierden la fecha ni la nota (la escritura cierra la hoja antes de ir al servidor).
 */
export function formularioReagenda(boton: Boton, datos: DatosReagenda, abActual = ""): ResultadoFormulario {
  const texto = textoSheetDesdeDatetimeLocal(datos.fechaHora);
  if (!texto) return fallo("Elegí la fecha y la hora de la reagenda.");
  const cambios: Cambios = { ...boton.cambios, fechaReagenda: texto };
  const extra = datos.datos.trim();
  if (extra && extra !== abActual.trim()) {
    if (extra.length > MAX_TEXTO_REAGENDA) return fallo(`Los datos de la reagenda pasan de ${MAX_TEXTO_REAGENDA} caracteres.`);
    if (/^[=+]/.test(extra)) return fallo(`Los datos de la reagenda no pueden empezar con "=" ni "+": ${PISTA_FORMULA}.`);
    cambios.datosReagenda = extra;
  }
  return { ok: true, cambios, detalle: texto.slice(0, 16) };
}
