import { describe, expect, it } from "vitest";
import type { EntradaLog } from "@/lib/crm/contratos";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { claveFaseHoy } from "@/lib/crm/motor/proxima-accion";
import { COLUMNAS, type Campo, type FilaLead } from "@/lib/crm/sheets/columnas";
import {
  INDICADORES_CLOSER,
  actividadReciente,
  callsDelDia,
  conFichaVigente,
  conteosDelDia,
  formatearMonto,
  leerPeriodo,
  metricasPeriodo,
  numeroDeCelda,
  sumarIndicadores,
  sumarMetricas,
  valorIndicador,
  type ConteosCloser,
} from "@/lib/crm//admin";

// jueves 24/09/2026 15:00 (Buenos Aires)
const AHORA = parsearFechaSheet("24/09/2026 15:00")!;

let contador = 0;
function fila(valores: Partial<Record<Campo, string>>): FilaLead {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  contador += 1;
  return { hoja: "Closer 1", numeroFila: contador + 1, valores: { ...base, nombre: `Lead ${contador}`, ...valores } };
}

function entrada(extra: Partial<EntradaLog>): EntradaLog {
  return {
    fecha: "24/09/2026 10:00:00",
    operacion: "op1",
    closer: "Closer 1",
    hoja: "Closer 1",
    fila: 5,
    lead: "Lead",
    columna: "R",
    campo: "presentoAgenda1",
    antes: "",
    despues: "Si",
    motivo: "SE_PRESENTO · Sí",
    ...extra,
  };
}

describe("leerPeriodo", () => {
  it("30 solo si dice 30; el resto es 7", () => {
    expect(leerPeriodo("30")).toBe(30);
    expect(leerPeriodo(["30"])).toBe(30);
    expect(leerPeriodo("7")).toBe(7);
    expect(leerPeriodo("90")).toBe(7);
    expect(leerPeriodo(undefined)).toBe(7);
    expect(leerPeriodo("x")).toBe(7);
  });
});

describe("numeroDeCelda", () => {
  it("lee números de la API y textos tipeados a mano", () => {
    expect(numeroDeCelda("1500")).toBe(1500);
    expect(numeroDeCelda("1500.5")).toBe(1500.5);
    expect(numeroDeCelda("1500,5")).toBe(1500.5);
    expect(numeroDeCelda("1.500,50")).toBe(1500.5);
    // "1.500" a secas es ambiguo: la API manda los números con punto decimal, así que es 1.5.
    expect(numeroDeCelda("1.500")).toBe(1.5);
    expect(numeroDeCelda("")).toBe(0);
    expect(numeroDeCelda("mil")).toBe(0);
  });
});

describe("metricasPeriodo", () => {
  const filas = [
    // Hoy a la mañana, se presentó y cerró en llamada.
    fila({ fechaCall: "24/09/2026 10:00", presentoAgenda1: "Si", situacion: "Cerrado en llamada", cashDia1: "1000", valorServicio: "3000" }),
    // Hoy más tarde: todavía no pasó, no cuenta.
    fila({ fechaCall: "24/09/2026 18:00" }),
    // Hace 3 días, no-show que vino a la reagenda y cerró en seguimiento.
    fila({ fechaCall: "21/09/2026 10:00", presentoAgenda1: "No", presentoReagenda: "Si", situacion: "cerrado en seguimiento", cashTratoCerrado: "500", valorServicio: "2000" }),
    // Hace 6 días, no se presentó.
    fila({ fechaCall: "18/09/2026 10:00", presentoAgenda1: "No" }),
    // Hace 20 días: solo entra en 30.
    fila({ fechaCall: "04/09/2026 10:00", presentoAgenda1: "Si", situacion: "Broke" }),
    // Hace 40 días: no entra en ninguno.
    fila({ fechaCall: "15/08/2026 10:00", presentoAgenda1: "Si", situacion: "Cerrado en llamada", cashDia1: "9999" }),
    // Sin fecha legible o sin nombre: se ignoran.
    fila({ fechaCall: "mañana" }),
    fila({ nombre: "", fechaCall: "23/09/2026 10:00", presentoAgenda1: "Si" }),
  ];

  it("7 días: calls pasadas de la última semana (solo conteos y sumas, sin tasas)", () => {
    expect(metricasPeriodo(filas, AHORA, 7)).toEqual({
      dias: 7,
      calls: 3,
      presentaron: 2,
      cerrados: 2,
      cashCollected: 1500,
      valorServicio: 5000,
    });
  });
  it("se presentaron = R o T = Si; U (columna oculta) no cuenta", () => {
    const soloU = [fila({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No", presentoCall2: "Si" })];
    expect(metricasPeriodo(soloU, AHORA, 7)).toMatchObject({ calls: 1, presentaron: 0 });
  });
  it("30 días suma la de hace 20 pero no la de hace 40", () => {
    const m = metricasPeriodo(filas, AHORA, 30);
    expect(m.calls).toBe(4);
    expect(m.presentaron).toBe(3);
    expect(m.cerrados).toBe(2);
    expect(m.cashCollected).toBe(1500);
  });
  it("sin calls, todo en cero", () => {
    expect(metricasPeriodo([], AHORA, 7)).toEqual({ dias: 7, calls: 0, presentaron: 0, cerrados: 0, cashCollected: 0, valorServicio: 0 });
  });
  it("sumarMetricas suma cada conteo", () => {
    const a = metricasPeriodo(filas, AHORA, 7);
    const b = metricasPeriodo([fila({ fechaCall: "23/09/2026 10:00", presentoAgenda1: "No" })], AHORA, 7);
    expect(sumarMetricas([a, b], 7)).toEqual({ dias: 7, calls: 4, presentaron: 2, cerrados: 2, cashCollected: 1500, valorServicio: 5000 });
  });
});

describe("callsDelDia", () => {
  it("cuenta la call de hoy y la reagenda de hoy, aunque sea escrita a mano", () => {
    const filas = [
      fila({ fechaCall: "24/09/2026 09:00" }),
      fila({ fechaCall: "24/09/2026 21:00" }),
      fila({ fechaCall: "20/09/2026 10:00", fechaReagenda: "24/09 16 hs" }),
      fila({ fechaCall: "20/09/2026 10:00", fechaReagenda: "coordinar" }),
      fila({ fechaCall: "23/09/2026 10:00" }),
      fila({ nombre: "", fechaCall: "24/09/2026 10:00" }),
    ];
    expect(callsDelDia(filas, AHORA)).toBe(3);
  });
});

describe("actividadReciente", () => {
  it("las últimas N, la más nueva primero", () => {
    const log = Array.from({ length: 5 }, (_, i) => entrada({ operacion: `op${i}` }));
    expect(actividadReciente(log, 3).map((e) => e.operacion)).toEqual(["op4", "op3", "op2"]);
    expect(actividadReciente(log).length).toBe(5);
  });

  it("solo se linkea la ficha si en esa fila sigue el mismo lead", () => {
    const ana = { ...fila({ nombre: "Ana Pérez" }), numeroFila: 12 };
    const filas = new Map([["Closer 1", [ana]]]);
    const actividad = conFichaVigente(
      [entrada({ fila: 12, lead: "ana perez" }), entrada({ fila: 12, lead: "Bea" }), entrada({ fila: 99, lead: "Ana Pérez" }), entrada({ hoja: "Closer 9", fila: 12, lead: "Ana Pérez" })],
      filas,
    );
    expect(actividad.map((e) => e.fichaVigente)).toEqual([true, false, false, false]);
  });
});

describe("formatos", () => {
  it("montos con punto de miles y coma decimal", () => {
    expect(formatearMonto(0)).toBe("0");
    expect(formatearMonto(1500)).toBe("1.500");
    expect(formatearMonto(1234567.5)).toBe("1.234.567,50");
    expect(formatearMonto(-800)).toBe("-800");
    expect(formatearMonto(0.005)).toBe("0,01");
  });
});

describe("conteosDelDia", () => {
  it("pendientes, atrasados y grupos sin los pre-calls listos por hoy (el contexto sale del log)", () => {
    const hecho = { precall: "Hecho - link a call" };
    const listo = fila({ fechaCall: "28/09/2026 10:00", precall: "CONF + DECISORES" }); // fase mandada hoy, call en 4 días
    const filas = [
      listo,
      // Pre-call atrasado: call mañana y faltan tres fases (una call que ya pasó ya no tiene pre-call, 26/10/2026).
      fila({ fechaCall: "25/09/2026 10:00", precall: "CONF + DECISORES" }),
      fila({ ...hecho, fechaCall: "24/09/2026 10:00", presentoAgenda1: "No" }), // no-show de hoy: S1
      fila({ ...hecho, fechaCall: "24/09/2026 09:00" }), // ¿se presentó?
    ];
    const dia = { precallHoy: new Set([claveFaseHoy(listo.hoja, listo.numeroFila, listo.valores.nombre)]) };
    expect(conteosDelDia(filas, AHORA, dia)).toEqual({
      pendientes: 3,
      atrasados: 1,
      porGrupo: { precall: 1, sePresento: 1, resultado: 0, noShow: 1, postCall: 0 },
    });
    // Sin el log (p. ej. `npm run mi-dia`), la lista por hoy cuenta como pendiente.
    expect(conteosDelDia(filas, AHORA)).toMatchObject({ pendientes: 4, porGrupo: { precall: 2 } });
  });
});

describe("indicadores por closer", () => {
  const conteos = (pendientes: number, porGrupo: Partial<ConteosCloser["porGrupo"]>, extra: Partial<ConteosCloser> = {}): ConteosCloser => ({
    pendientes,
    atrasados: 0,
    callsHoy: 0,
    hechasHoy: 0,
    porGrupo: { precall: 0, sePresento: 0, resultado: 0, noShow: 0, postCall: 0, ...porGrupo },
    ...extra,
  });

  it("los grupos de la tabla suman los pendientes (están todos)", () => {
    const c = conteos(10, { precall: 3, sePresento: 1, resultado: 2, noShow: 2, postCall: 2 });
    const grupos = INDICADORES_CLOSER.filter((i) => !["pendientes", "atrasados", "callsHoy", "hechasHoy"].includes(i.id));
    expect(grupos.reduce((s, i) => s + valorIndicador(c, i.id), 0)).toBe(c.pendientes);
  });

  it("la fila del equipo suma cada columna", () => {
    const a = conteos(3, { precall: 3 }, { atrasados: 1, callsHoy: 2, hechasHoy: 5 });
    const b = conteos(2, { postCall: 2 }, { atrasados: 2, hechasHoy: 1 });
    const total = sumarIndicadores([a, b]);
    expect(total).toMatchObject({ pendientes: 5, atrasados: 3, precall: 3, postCall: 2, callsHoy: 2, hechasHoy: 6, noShow: 0 });
    expect(Object.keys(total)).toHaveLength(INDICADORES_CLOSER.length);
  });

  it("sin \"para limpiar\" (28/09/2026): los seguimientos atrasados están en su grupo y en atrasados", () => {
    expect(INDICADORES_CLOSER.map((i) => i.id)).toEqual([
      "pendientes",
      "atrasados",
      "precall",
      "sePresento",
      "resultado",
      "noShow",
      "postCall",
      "callsHoy",
      "hechasHoy",
    ]);
  });
});
