// Lógica pura del tablero de admin (docs/diseno.md §Admin): métricas de 7 / 30 días por hoja
// (solo lectura de las columnas del CRM; solo conteos y sumas, sin tasas: decisión de Gero del
// 27/09/2026), calls del día y la actividad reciente. Las acciones
// hechas hoy según "Log App" están en src/lib/hechas.ts (las comparte con "Hechas hoy").
// Sin React, sin red y sin "server-only": la importan la página y los tests.

import { SITUACIONES_CERRADAS, VALORES } from "@/lib/crm/config/crm";
import type { EntradaLog } from "@/lib/crm/contratos";
import { diasDesde, parsearFechaSheet } from "@/lib/crm/fechas";
import { accionesDelDia, type ContextoDia, type Grupo } from "@/lib/crm/motor/proxima-accion";
import { contarAtrasados, contarPendientes, contarPorGrupo } from "@/lib/crm/pantalla";
import { callsDelDiaDe } from "@/lib/crm/presentacion";
import type { FilaLead } from "@/lib/crm/sheets/columnas";
import { esNumero, normalizarTexto } from "@/lib/crm/sheets/verificacion";

export const PERIODOS = [7, 30] as const;
export type Periodo = (typeof PERIODOS)[number];

/** El selector 7 / 30 días viene por la URL (`?dias=30`); cualquier otra cosa es 7. */
export function leerPeriodo(valor: string | string[] | undefined): Periodo {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return Number(texto) === 30 ? 30 : 7;
}

/** Solo conteos y sumas: el admin no muestra tasas (ni de show-up ni de cierre). */
export type Metricas = {
  dias: Periodo;
  /** Calls (D) de los últimos `dias` días que ya pasaron. */
  calls: number;
  /** De esas calls, las que tienen R = Si o T = Si. */
  presentaron: number;
  /** V = Cerrado en llamada o Cerrado en seguimiento. */
  cerrados: number;
  /** Suma de Y + Z. */
  cashCollected: number;
  /** Suma de AA. */
  valorServicio: number;
};

const es = (valor: string, esperado: string) => normalizarTexto(valor) === normalizarTexto(esperado);

/** "1500", "1500.5" o "1.500,50" (texto tipeado) → número. Cualquier otra cosa → 0. */
export function numeroDeCelda(valor: string): number {
  const texto = valor.trim();
  if (esNumero(texto)) return Number(texto.replace(",", "."));
  // Miles con punto y decimales con coma, como se escribe a mano en la planilla.
  const sinMiles = texto.replace(/\.(?=\d{3}(\D|$))/g, "");
  return esNumero(sinMiles) ? Number(sinMiles.replace(",", ".")) : 0;
}

/** Los conteos de hoy de un closer (lo que arma `tableroAdmin` en mi-dia.ts). */
export type ConteosCloser = {
  pendientes: number;
  atrasados: number;
  porGrupo: Record<Grupo, number>;
  callsHoy: number;
  hechasHoy: number;
};

/**
 * Pendientes, atrasados y pendientes por grupo de una hoja: las tarjetas del día (las mismas que ve
 * el closer), sin los pre-calls "listos por hoy" (`contarPendientes`). Con `dia.precallHoy` (sale del
 * log) el motor sabe a quién ya se le mandó una fase hoy; sin eso, ninguna tarjeta queda lista por hoy.
 */
export function conteosDelDia(
  filas: readonly FilaLead[],
  ahora: Date,
  dia: ContextoDia = {},
): Pick<ConteosCloser, "pendientes" | "atrasados" | "porGrupo"> {
  const acciones = accionesDelDia(filas, ahora, dia);
  return { pendientes: contarPendientes(acciones), atrasados: contarAtrasados(acciones), porGrupo: contarPorGrupo(acciones) };
}

export type Indicador = "pendientes" | "atrasados" | Grupo | "callsHoy" | "hechasHoy";

/**
 * Las columnas de la tabla por closer (docs/diseno.md §Admin), en el orden del tablero del closer.
 * Los grupos cuentan las tarjetas pendientes de hoy de ese grupo (lo mismo que el closer ve en su
 * tablero), así que suman "Pendientes". Son tarjetas, no leads: desde el 28/09/2026 un lead puede
 * tener la de pre-call y otra (p. ej. no-show) a la vez y suma en las dos columnas. Los pre-calls
 * "listos por hoy" no cuentan en ninguna (`conteosDelDia`).
 * `destacar`: se marca en naranja si es mayor que 0.
 */
export const INDICADORES_CLOSER: readonly { id: Indicador; etiqueta: string; destacar?: boolean }[] = [
  { id: "pendientes", etiqueta: "Pendientes" },
  { id: "atrasados", etiqueta: "Atrasados", destacar: true },
  { id: "precall", etiqueta: "Pre-calls" },
  { id: "sePresento", etiqueta: "¿Se presentó? sin resolver", destacar: true },
  { id: "resultado", etiqueta: "Resultados sin cargar", destacar: true },
  { id: "noShow", etiqueta: "No-shows en curso" },
  { id: "postCall", etiqueta: "Post-calls en curso" },
  { id: "callsHoy", etiqueta: "Calls de hoy" },
  { id: "hechasHoy", etiqueta: "Hechas hoy" },
];

export function valorIndicador(c: ConteosCloser, id: Indicador): number {
  if (id === "pendientes" || id === "atrasados" || id === "callsHoy" || id === "hechasHoy") return c[id];
  return c.porGrupo[id];
}

/** La fila "Equipo" de la tabla: la suma de cada indicador. */
export function sumarIndicadores(lista: readonly ConteosCloser[]): Record<Indicador, number> {
  const total = {} as Record<Indicador, number>;
  for (const { id } of INDICADORES_CLOSER) total[id] = lista.reduce((suma, c) => suma + valorIndicador(c, id), 0);
  return total;
}

/** Métricas de una hoja para las calls de los últimos `dias` días (hoy incluido) que ya pasaron. */
export function metricasPeriodo(filas: readonly FilaLead[], ahora: Date, dias: Periodo): Metricas {
  const m: Metricas = { dias, calls: 0, presentaron: 0, cerrados: 0, cashCollected: 0, valorServicio: 0 };
  for (const { valores: v } of filas) {
    if (!v.nombre.trim()) continue;
    const fecha = parsearFechaSheet(v.fechaCall);
    if (!fecha || fecha > ahora) continue;
    const hace = diasDesde(fecha, ahora);
    if (hace < 0 || hace >= dias) continue;

    m.calls += 1;
    if (es(v.presentoAgenda1, VALORES.si) || es(v.presentoReagenda, VALORES.si)) m.presentaron += 1;
    if (SITUACIONES_CERRADAS.some((s) => es(v.situacion, s))) m.cerrados += 1;
    m.cashCollected += numeroDeCelda(v.cashDia1) + numeroDeCelda(v.cashTratoCerrado);
    m.valorServicio += numeroDeCelda(v.valorServicio);
  }
  return m;
}

/** Las métricas del equipo: la suma de las de cada closer. */
export function sumarMetricas(lista: readonly Metricas[], dias: Periodo): Metricas {
  const total: Metricas = { dias, calls: 0, presentaron: 0, cerrados: 0, cashCollected: 0, valorServicio: 0 };
  for (const m of lista) {
    total.calls += m.calls;
    total.presentaron += m.presentaron;
    total.cerrados += m.cerrados;
    total.cashCollected += m.cashCollected;
    total.valorServicio += m.valorServicio;
  }
  return total;
}

/** Cuántas calls hay hoy en la hoja: la fecha de la call (D) o la de la reagenda (AC) es hoy (una por lead). */
export function callsDelDia(filas: readonly FilaLead[], ahora: Date): number {
  return callsDelDiaDe(filas, ahora).length;
}

/** Las últimas `maximo` filas del log, la más nueva primero. */
export function actividadReciente(log: readonly EntradaLog[], maximo = 30): EntradaLog[] {
  return log.slice(-maximo).reverse();
}

/** Una fila de "Actividad reciente": `fichaVigente` = en esa hoja + fila sigue el mismo lead (se puede linkear). */
export type EntradaActividad = EntradaLog & { fichaVigente: boolean };

/**
 * El log guarda el número de fila del momento en que se escribió. Si después alguien insertó u
 * ordenó filas, el link `/lead/<hoja>/<fila>` abriría la ficha de otro lead: esas no se linkean.
 */
export function conFichaVigente(actividad: readonly EntradaLog[], filasPorHoja: ReadonlyMap<string, readonly FilaLead[]>): EntradaActividad[] {
  return actividad.map((e) => {
    const nombre = filasPorHoja.get(e.hoja)?.find((f) => f.numeroFila === e.fila)?.valores.nombre ?? "";
    return { ...e, fichaVigente: normalizarTexto(nombre) !== "" && normalizarTexto(nombre) === normalizarTexto(e.lead) };
  });
}

/** "1.500" o "1.500,50": separador de miles con punto, como en Argentina. Sin ICU. */
export function formatearMonto(valor: number): string {
  const redondeado = Math.round(valor * 100) / 100;
  const [entero, decimales] = Math.abs(redondeado).toFixed(2).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const signo = redondeado < 0 ? "-" : "";
  return decimales === "00" ? `${signo}${conMiles}` : `${signo}${conMiles},${decimales}`;
}
