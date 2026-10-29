import { describe, expect, it } from "vitest";
import type { CallDelDia, ItemCliente, OperacionHecha } from "@/lib/crm/contratos";
import { parsearFechaSheet } from "@/lib/crm/fechas";
import type { Boton } from "@/lib/crm/motor/proxima-accion";
import { decodificarParam, leerFilaParam } from "@/lib/crm/entrada";
import { CAMPOS_ESCRIBIBLES } from "@/lib/crm/sheets/columnas";
import {
  cambiosVisibles,
  claveDia,
  claveHecha,
  claveOculta,
  coincideBusqueda,
  contarAtrasados,
  contarPendientes,
  contarPorGrupo,
  datetimeLocalDesde,
  desplazamientoTira,
  esCerrado,
  esDeTarjeta,
  esResultadoReagenda,
  esperadoPara,
  formularioCierre,
  formularioReagenda,
  formularioSituacion,
  hechasBloqueadas,
  hrefFicha,
  leerMontos,
  motivoDe,
  motivoLegible,
  mostrarLead,
  ordenar,
  pasaFiltroFecha,
  podarOcultas,
  progresoDelDia,
  seccionListosAbierta,
  separarListos,
  sumaEnProgreso,
  textoCambio,
  textoEnCuanto,
  textoSheetDesdeDatetimeLocal,
  tipoDelMotivo,
  tiraDeCalls,
  tituloFormulario,
  urgencia,
  vistaDelDia,
  formularioSeguimiento,
  mananaInput,
  MAX_DIAS_SEGUIMIENTO,
} from "@/lib/crm//pantalla";

// jueves 24/09/2026 15:00 (Buenos Aires)
const AHORA = parsearFechaSheet("24/09/2026 15:00")!;

let siguienteFila = 100;
function item(extra: {
  fecha?: string;
  grupo?: ItemCliente["accion"]["grupo"];
  tipo?: ItemCliente["accion"]["tipo"];
  atrasado?: boolean;
  listoPorHoy?: boolean;
  nombre?: string;
  telefono?: string;
  clave?: string;
}): ItemCliente {
  const fecha = parsearFechaSheet(extra.fecha ?? "24/09/2026 16:00")!;
  const clave = extra.clave ?? `Closer 1:${siguienteFila++}`;
  const tipo = extra.tipo ?? "PRE_CALL";
  return {
    clave,
    id: `${clave}|${tipo}`,
    identidad: {
      hoja: "Closer 1",
      numeroFila: 7,
      nombre: extra.nombre ?? "Juan Pérez",
      telefono: extra.telefono ?? "+54 9 11 5555-1234",
      fechaCall: "24/09/2026 16:00:00",
    },
    valores: Object.fromEntries(CAMPOS_ESCRIBIBLES.map((c) => [c, ""])) as ItemCliente["valores"],
    accion: {
      tipo,
      grupo: extra.grupo ?? "precall",
      titulo: "Enviar fase: DOLORES",
      estado: "Pre-call: VIDEOS CONF",
      fecha: fecha.toISOString(),
      atrasado: extra.atrasado ?? false,
      listoPorHoy: extra.listoPorHoy ?? false,
      botones: [],
      avisos: [],
    },
    horaCall: "jue 24/09 16:00",
    urlChat: "https://wa.me/5491155551234",
    chat2Chat: false,
    cancelable: false,
  };
}

describe("urgencia", () => {
  const u = (grupo: ItemCliente["accion"]["grupo"], atrasado: boolean, listoPorHoy = false) => urgencia({ grupo, atrasado, listoPorHoy });
  it("naranja para ¿se presentó?, resultado y atrasados (un seguimiento viejo también); negro para el resto", () => {
    expect(u("sePresento", false)).toBe("hoy");
    expect(u("resultado", false)).toBe("hoy");
    expect(u("noShow", true)).toBe("hoy");
    expect(u("postCall", true)).toBe("hoy");
    expect(u("precall", false)).toBe("normal");
    expect(u("postCall", false)).toBe("normal");
  });
  it("gris para un pre-call listo por hoy (no es pendiente)", () => {
    expect(u("precall", false, true)).toBe("listo");
  });
});

describe("filtro por fecha", () => {
  const hoy = item({ fecha: "24/09/2026 18:00" });
  const manana = item({ fecha: "25/09/2026 09:00" });
  const domingo = item({ fecha: "27/09/2026 10:00" });
  const lunesQueViene = item({ fecha: "28/09/2026 10:00" });
  const lunesPasado = item({ fecha: "21/09/2026 10:00", atrasado: true });

  it("hoy y mañana en Buenos Aires", () => {
    expect(pasaFiltroFecha(hoy, "hoy", AHORA)).toBe(true);
    expect(pasaFiltroFecha(manana, "hoy", AHORA)).toBe(false);
    expect(pasaFiltroFecha(manana, "manana", AHORA)).toBe(true);
    // 23:30 de hoy en Buenos Aires ya es mañana en UTC: sigue siendo hoy.
    expect(pasaFiltroFecha(item({ fecha: "24/09/2026 23:30" }), "hoy", AHORA)).toBe(true);
  });

  it("esta semana = de lunes a domingo, incluyendo lo que ya pasó", () => {
    expect(pasaFiltroFecha(lunesPasado, "semana", AHORA)).toBe(true);
    expect(pasaFiltroFecha(domingo, "semana", AHORA)).toBe(true);
    expect(pasaFiltroFecha(lunesQueViene, "semana", AHORA)).toBe(false);
  });

  it("atrasados usa la marca del motor; todo deja pasar todo", () => {
    expect(pasaFiltroFecha(lunesPasado, "atrasados", AHORA)).toBe(true);
    expect(pasaFiltroFecha(hoy, "atrasados", AHORA)).toBe(false);
    expect(pasaFiltroFecha(lunesQueViene, "todo", AHORA)).toBe(true);
  });

  it("rango con los textos de un input date (límites incluidos, vacío = sin límite)", () => {
    expect(pasaFiltroFecha(manana, "rango", AHORA, { desde: "2026-09-25", hasta: "2026-09-27" })).toBe(true);
    expect(pasaFiltroFecha(domingo, "rango", AHORA, { desde: "2026-09-25", hasta: "2026-09-27" })).toBe(true);
    expect(pasaFiltroFecha(lunesQueViene, "rango", AHORA, { desde: "2026-09-25", hasta: "2026-09-27" })).toBe(false);
    expect(pasaFiltroFecha(lunesPasado, "rango", AHORA, { desde: "", hasta: "2026-09-27" })).toBe(true);
    expect(pasaFiltroFecha(lunesPasado, "rango", AHORA, { desde: "2026-09-22", hasta: "" })).toBe(false);
  });

  it("claveDia y datetimeLocalDesde van en hora de Buenos Aires", () => {
    expect(claveDia(parsearFechaSheet("24/09/2026 23:30")!)).toBe("2026-09-24");
    expect(datetimeLocalDesde(parsearFechaSheet("05/01/2026 09:05")!)).toBe("2026-01-05T09:05");
  });
});

describe("búsqueda y orden", () => {
  it("por nombre sin tildes ni mayúsculas, o por teléfono", () => {
    const i = item({ nombre: "María José Gutiérrez", telefono: "+54 9 11 4444-9876" });
    expect(coincideBusqueda(i, "")).toBe(true);
    expect(coincideBusqueda(i, "jose gut")).toBe(true);
    expect(coincideBusqueda(i, "GUTIERREZ")).toBe(true);
    expect(coincideBusqueda(i, "4444-98")).toBe(true);
    expect(coincideBusqueda(i, "11")).toBe(false); // menos de 3 dígitos
    expect(coincideBusqueda(i, "Pedro")).toBe(false);
  });

  it("prioridad = grupo y fecha; hora = solo fecha", () => {
    const a = item({ grupo: "postCall", fecha: "20/09/2026 10:00", clave: "a" });
    const b = item({ grupo: "sePresento", fecha: "24/09/2026 10:00", clave: "b" });
    const c = item({ grupo: "precall", fecha: "25/09/2026 10:00", clave: "c" });
    const d = item({ grupo: "precall", fecha: "24/09/2026 18:00", clave: "d" });
    expect(ordenar([a, b, c, d], "prioridad").map((i) => i.clave)).toEqual(["b", "d", "c", "a"]);
    expect(ordenar([a, b, c, d], "hora").map((i) => i.clave)).toEqual(["a", "b", "d", "c"]);
  });

  it("prioridad en No-show y Post-call: primero al día (fecha más vieja primero), después atrasadas (la más reciente primero); hora = solo fecha", () => {
    const ns = (clave: string, fecha: string, atrasado = false) => item({ grupo: "noShow", tipo: "NO_SHOW", fecha, atrasado, clave });
    const pc = (clave: string, fecha: string, atrasado = false) => item({ grupo: "postCall", tipo: "POST_CALL", fecha, atrasado, clave });
    const lista = [
      ns("ns-frio", "01/09/2026 10:00", true),
      pc("pc-tibio", "20/09/2026 10:00", true),
      ns("ns-hoy", "24/09/2026 10:00"),
      ns("ns-caliente", "21/09/2026 10:00", true),
      pc("pc-al-dia", "22/09/2026 10:00"),
      ns("ns-ayer", "23/09/2026 10:00"),
      pc("pc-frio", "05/09/2026 10:00", true),
      item({ grupo: "precall", fecha: "10/09/2026 10:00", atrasado: true, clave: "pre-viejo" }),
      item({ grupo: "precall", fecha: "20/09/2026 10:00", atrasado: true, clave: "pre-nuevo" }),
    ];
    expect(ordenar(lista, "prioridad").map((i) => i.clave)).toEqual([
      "pre-viejo", // Pre-call: la más vieja primero, como siempre
      "pre-nuevo",
      "ns-ayer",
      "ns-hoy",
      "ns-caliente",
      "ns-frio",
      "pc-al-dia",
      "pc-tibio",
      "pc-frio",
    ]);
    expect(ordenar(lista, "hora").map((i) => i.clave)).toEqual([
      "ns-frio",
      "pc-frio",
      "pre-viejo",
      "pc-tibio",
      "pre-nuevo",
      "ns-caliente",
      "pc-al-dia",
      "ns-ayer",
      "ns-hoy",
    ]);
  });

  it("contadores (sin grupo Limpiar: los atrasados cuentan en su grupo)", () => {
    const lista = [item({ grupo: "noShow", atrasado: true }), item({ grupo: "noShow" }), item({ grupo: "postCall", atrasado: true })];
    expect(contarPorGrupo(lista)).toEqual({ precall: 0, sePresento: 0, resultado: 0, noShow: 2, postCall: 1 });
    expect(contarAtrasados(lista)).toBe(2);
  });

  it("contadores por tarjeta: un lead con pre-call y no-show suma en las dos columnas", () => {
    const pre = item({ clave: "Closer 1:7", grupo: "precall", tipo: "PRE_CALL", atrasado: true, fecha: "20/09/2026 10:00" });
    const ns = item({ clave: "Closer 1:7", grupo: "noShow", tipo: "NO_SHOW", fecha: "20/09/2026 10:00" });
    expect(contarPorGrupo([pre, ns])).toMatchObject({ precall: 1, noShow: 1 });
    expect(contarAtrasados([pre, ns])).toBe(1);
    expect(pre.id).not.toBe(ns.id);
    // El orden por prioridad pone el pre-call antes que el no-show.
    expect(ordenar([ns, pre], "prioridad").map((i) => i.id)).toEqual([pre.id, ns.id]);
  });
});

describe("listo por hoy (decisión de Gero del 28/09/2026)", () => {
  // Pre-calls a los que hoy ya se les mandó una fase y la siguiente puede esperar a mañana.
  const listo = (clave: string, fecha: string, nombre = "Juan Pérez") => item({ clave, fecha, nombre, listoPorHoy: true });
  const preAtrasado = item({ clave: "pre-atrasado", fecha: "20/09/2026 10:00", atrasado: true });
  const noShow = item({ clave: "ns", grupo: "noShow", tipo: "NO_SHOW", fecha: "23/09/2026 10:00" });
  const listoLejos = listo("listo-29", "29/09/2026 10:00", "Ana Gómez");
  const listoCerca = listo("listo-27", "27/09/2026 10:00");
  const opciones = { filtro: "todo" as const, busqueda: "", ahora: AHORA, orden: "prioridad" as const };

  it("no son pendientes: no cuentan en pendientes, grupos ni atrasados", () => {
    const lista = [listoLejos, preAtrasado, noShow, listoCerca];
    expect(separarListos(lista)).toEqual({ pendientes: [preAtrasado, noShow], listos: [listoLejos, listoCerca] });
    expect(contarPendientes(lista)).toBe(2);
    expect(contarPorGrupo(lista)).toEqual({ precall: 1, sePresento: 0, resultado: 0, noShow: 1, postCall: 0 });
    expect(contarAtrasados(lista)).toBe(1);
    // Aunque viniera marcada atrasada (no pasa: el motor nunca las marca juntas), no suma.
    expect(contarAtrasados([item({ listoPorHoy: true, atrasado: true })])).toBe(0);
  });

  it("vistaDelDia: las pendientes arriba (contadores, lista) y las listas por hoy aparte, en el mismo orden", () => {
    const vista = vistaDelDia([listoLejos, preAtrasado, noShow, listoCerca], opciones);
    expect(vista.pendientes.map((i) => i.clave)).toEqual(["pre-atrasado", "ns"]);
    expect(vista.atrasados).toBe(1);
    expect(vista.totalFiltrado).toBe(2);
    expect(vista.conteo).toMatchObject({ precall: 1, noShow: 1 });
    expect(vista.lista.map((i) => i.clave)).toEqual(["pre-atrasado", "ns"]);
    // Pre-call: la call más próxima primero.
    expect(vista.listos.map((i) => i.clave)).toEqual(["listo-27", "listo-29"]);
  });

  it("solo listas por hoy: no queda nada pendiente (\"Todo al día\") y las listas siguen aparte", () => {
    const vista = vistaDelDia([listoLejos, listoCerca], opciones);
    expect(vista.pendientes).toEqual([]);
    expect(vista.atrasados).toBe(0);
    expect(vista.totalFiltrado).toBe(0);
    expect(vista.conteo).toEqual({ precall: 0, sePresento: 0, resultado: 0, noShow: 0, postCall: 0 });
    expect(vista.listos).toHaveLength(2);
    // La barra del día llega al final: lo hecho hoy sobre lo que había.
    const hecha: OperacionHecha = {
      idOperacion: "a1",
      hora: "10:00",
      fecha: "24/09/2026 10:00:00",
      closer: "Carlos",
      hoja: "Closer 1",
      fila: 7,
      lead: "Juan",
      motivo: "PRE_CALL · Enviado",
      cambios: [],
      deshecha: false,
    };
    expect(progresoDelDia(vista.pendientes.length, [hecha, { ...hecha, idOperacion: "a2" }], "Admin")).toEqual({
      hechas: 2,
      total: 2,
      porcentaje: 100,
    });
  });

  it("el filtro de fecha y la búsqueda valen para las dos, pero los contadores son solo de pendientes", () => {
    // Atrasados: una lista por hoy nunca está atrasada.
    const atrasados = vistaDelDia([listoLejos, preAtrasado, noShow, listoCerca], { ...opciones, filtro: "atrasados" });
    expect(atrasados.lista.map((i) => i.clave)).toEqual(["pre-atrasado"]);
    expect(atrasados.listos).toEqual([]);
    // Un rango que solo toma a la lista del 29: ninguna pendiente con el filtro, pero siguen las del día.
    const rango = vistaDelDia([listoLejos, preAtrasado, noShow, listoCerca], {
      ...opciones,
      filtro: "rango",
      rango: { desde: "2026-09-28", hasta: "" },
    });
    expect(rango.totalFiltrado).toBe(0);
    expect(rango.listos.map((i) => i.clave)).toEqual(["listo-29"]);
    expect(rango.pendientes).toHaveLength(2);
    // La búsqueda encuentra también a las listas por hoy.
    const ana = vistaDelDia([listoLejos, preAtrasado, noShow, listoCerca], { ...opciones, busqueda: "ana" });
    expect(ana.lista).toEqual([]);
    expect(ana.listos.map((i) => i.clave)).toEqual(["listo-29"]);
  });

  it("\"Hora\" ordena por fecha a las dos listas", () => {
    const vista = vistaDelDia([noShow, listoLejos, preAtrasado, listoCerca], { ...opciones, orden: "hora" });
    expect(vista.lista.map((i) => i.clave)).toEqual(["pre-atrasado", "ns"]);
    expect(vista.listos.map((i) => i.clave)).toEqual(["listo-27", "listo-29"]);
  });

  it("pantalla abierta pasada la medianoche: las listas de la lista de ayer vuelven a ser pendientes", () => {
    const lista = [listoLejos, preAtrasado, noShow, listoCerca];
    // Mismo día que la lista: como siempre.
    const hoy = vistaDelDia(lista, { ...opciones, diaDeLaLista: "2026-09-24" });
    expect([hoy.pendientes.length, hoy.listos.length]).toEqual([2, 2]);
    // La lista es del 24 y ya es el 25 a las 00:01 (Buenos Aires): "listo por hoy" era de ayer.
    const pasadaMedianoche = parsearFechaSheet("25/09/2026 00:01")!;
    const manana = vistaDelDia(lista, { ...opciones, ahora: pasadaMedianoche, diaDeLaLista: "2026-09-24" });
    expect(manana.pendientes.map((i) => i.clave)).toEqual(["listo-29", "pre-atrasado", "ns", "listo-27"]);
    expect(manana.listos).toEqual([]);
    expect(manana.conteo).toMatchObject({ precall: 3, noShow: 1 });
    expect(manana.lista.map((i) => i.accion.listoPorHoy)).toEqual([false, false, false, false]);
    // Las tarjetas del optimista y los errores van por `claveOculta`: no cambia.
    expect(manana.lista.map(claveOculta).sort()).toEqual(lista.map(claveOculta).sort());
    // Sin `diaDeLaLista` (o el mismo día) no se toca nada.
    expect(vistaDelDia(lista, { ...opciones, ahora: pasadaMedianoche }).listos).toHaveLength(2);
  });

  it("la sección \"Listo por hoy\": cerrada por defecto; abierta si el closer la abrió, si hay búsqueda o si una tarjeta volvió con error", () => {
    expect(seccionListosAbierta(false, "", false)).toBe(false);
    // Con Mañana, Esta semana o Rango se abre sola (ahí está lo coordinado para otro día)
    for (const f of ["manana", "semana", "rango"] as const) expect(seccionListosAbierta(false, "", false, f)).toBe(true);
    for (const f of ["todo", "hoy", "atrasados"] as const) expect(seccionListosAbierta(false, "", false, f)).toBe(false);
    expect(seccionListosAbierta(false, "   ", false)).toBe(false);
    expect(seccionListosAbierta(true, "", false)).toBe(true);
    expect(seccionListosAbierta(false, "Lista", false)).toBe(true);
    expect(seccionListosAbierta(false, "", true)).toBe(true);
  });
});

describe("calls de hoy", () => {
  const call = (nombre: string, fecha: string, extra: Partial<CallDelDia> = {}): CallDelDia => ({
    clave: `Closer 1:${nombre}`,
    nombre,
    hora: fecha.slice(11, 16),
    fechaISO: parsearFechaSheet(fecha)!.toISOString(),
    esReagenda: false,
    grupo: null,
    estado: "",
    ...extra,
  });

  it("todas las del día en orden, con la próxima marcada y los minutos que faltan", () => {
    const calls = tiraDeCalls(
      [call("Caro", "24/09/2026 18:00"), call("Ana", "24/09/2026 10:00"), call("Beto", "24/09/2026 15:45", { esReagenda: true })],
      AHORA,
    );
    expect(calls.map((c) => [c.nombre, c.minutosHasta, c.proxima, c.yaPaso])).toEqual([
      ["Ana", -300, false, true],
      ["Beto", 45, true, false],
      ["Caro", 180, false, false],
    ]);
    expect(calls[1].esReagenda).toBe(true);
  });

  it("una call que empezó hace menos de 5 minutos todavía es la próxima (\"ahora\")", () => {
    const calls = tiraDeCalls([call("Ana", "24/09/2026 14:57"), call("Beto", "24/09/2026 16:00")], AHORA);
    expect(calls.map((c) => c.proxima)).toEqual([true, false]);
    expect(textoEnCuanto(calls[0].minutosHasta)).toBe("ahora");
    expect(tiraDeCalls([call("Ana", "24/09/2026 10:00")], AHORA)[0].proxima).toBe(false);
  });

  it("textoEnCuanto", () => {
    expect(textoEnCuanto(45)).toBe("en 45 min");
    expect(textoEnCuanto(180)).toBe("en 3 h");
    expect(textoEnCuanto(2)).toBe("ahora");
    expect(textoEnCuanto(-300)).toBe("");
  });

  describe("desplazamiento hasta la próxima (R17)", () => {
    // Celular de 375 px: px-4, título de 120 px, píldoras de 130 px con gap-2 (8 px).
    const caja = { left: 0, right: 375 };
    const chip = (i: number) => ({ left: 144 + i * 138, right: 274 + i * 138 });

    it("si la próxima ya se ve entera, la tira no se mueve (el título sigue a la vista)", () => {
      expect(desplazamientoTira(caja, chip(0), false)).toBe(0);
      expect(desplazamientoTira(caja, { left: 40, right: 170 }, true)).toBe(0);
    });

    it("a la derecha: lo justo para que entre por ese lado, no hasta pegarla al borde izquierdo", () => {
      // Cuatro calls y la próxima en tercer lugar: antes se movía 404 px (chip.left - 16) y no quedaba
      // ni el título ni las anteriores; ahora 191 y la segunda sigue a la vista.
      const mover = desplazamientoTira(caja, chip(2), false);
      expect(mover).toBe(chip(2).right - caja.right + 16);
      expect(mover).toBe(191);
      expect(chip(1).right - mover).toBeGreaterThan(caja.left + 32 + 100);
    });

    it("corrida y la próxima bajo el degradé de la izquierda (o más allá): se trae hasta salir de él", () => {
      expect(desplazamientoTira(caja, { left: 10, right: 140 }, true)).toBe(10 - 32);
      expect(desplazamientoTira(caja, { left: -200, right: -70 }, true)).toBe(-232);
    });

    it("más ancha que la tira: se alinea su comienzo (la hora y el nombre)", () => {
      expect(desplazamientoTira(caja, { left: 300, right: 800 }, false)).toBe(300 - 32);
    });
  });
});

describe("tarjetas ocultas", () => {
  const conAccion = (clave: string, tipo: ItemCliente["accion"]["tipo"], titulo: string) => {
    const i = item({ clave });
    return { ...i, accion: { ...i.accion, tipo, titulo } };
  };

  it("la clave es lead + tipo + título + fecha: la acción siguiente del mismo lead no queda oculta", () => {
    const s1 = conAccion("Closer 1:7", "NO_SHOW", "Enviar S1");
    const s2 = conAccion("Closer 1:7", "NO_SHOW", "Enviar S2");
    expect(claveOculta(s1)).not.toBe(claveOculta(s2));
    // "No se presentó" → reagendar de nuevo con una fecha que ya pasó: la misma acción, sobre la reunión nueva.
    const reunion = conAccion("Closer 1:7", "RESULTADO_REAGENDA", "Reunión reagendada: cargar el resultado");
    const otraReunion = { ...reunion, accion: { ...reunion.accion, fecha: parsearFechaSheet("23/09/2026 10:00")!.toISOString() } };
    expect(claveOculta(reunion)).not.toBe(claveOculta(otraReunion));
    expect(claveOculta(reunion)).toBe(claveOculta({ ...reunion }));
  });

  it("al llegar la lista nueva se olvidan las que el servidor ya no muestra", () => {
    const a = conAccion("Closer 1:7", "SE_PRESENTO", "¿Se presentó a la call?");
    const b = conAccion("Closer 1:8", "PRE_CALL", "Enviar fase: DOLORES");
    const ocultas = new Set([claveOculta(a), claveOculta(b)]);
    // La lectura salió antes de terminar la escritura de `a`: sigue oculta.
    expect(podarOcultas(ocultas, [a])).toEqual(new Set([claveOculta(a)]));
    expect(podarOcultas(ocultas, [a, b])).toBe(ocultas);
    expect(podarOcultas(ocultas, [])).toEqual(new Set());
  });

  it("las dos tarjetas de un lead (pre-call y principal) se ocultan por separado", () => {
    const pre = { ...conAccion("Closer 1:7", "PRE_CALL", "Enviar fase: VIDEOS CONF"), id: "Closer 1:7|PRE_CALL" };
    const ns = { ...conAccion("Closer 1:7", "NO_SHOW", "Enviar S2"), id: "Closer 1:7|NO_SHOW" };
    expect(claveOculta(pre)).not.toBe(claveOculta(ns));
    // Enviado en el pre-call: esa se oculta; la de no-show sigue. Vuelve la fase siguiente (otra clave).
    const ocultas = new Set([claveOculta(pre)]);
    const siguiente = { ...pre, accion: { ...pre.accion, titulo: "Enviar fase: DOLORES" } };
    expect(ocultas.has(claveOculta(ns))).toBe(false);
    expect(ocultas.has(claveOculta(siguiente))).toBe(false);
    expect(podarOcultas(ocultas, [siguiente, ns])).toEqual(new Set());
  });

  it("deshacer desde \"Hechas hoy\" vuelve a mostrar solo la tarjeta de esa operación", () => {
    const pre = { ...conAccion("Closer 1:7", "PRE_CALL", "Enviar fase: DOLORES"), id: "Closer 1:7|PRE_CALL" };
    const ns = { ...conAccion("Closer 1:7", "NO_SHOW", "Enviar S2"), id: "Closer 1:7|NO_SHOW" };
    // Hoy se mandó una fase (solo F) y el S2 (S y AG): las dos ocultas. Llega una lista vieja (la
    // caché de otra instancia) que todavía trae la de no-show: sigue oculta.
    const ocultas = podarOcultas(new Set([claveOculta(pre), claveOculta(ns)]), [pre, ns]);
    expect(ocultas.size).toBe(2);
    // Se deshace la fase: vuelve el pre-call, pero el S2 (que no se deshizo) sigue oculto.
    const tras = mostrarLead(ocultas, "Closer 1:7", tipoDelMotivo("PRE_CALL · Enviado"));
    expect(tras).toEqual(new Set([claveOculta(ns)]));
    expect([pre, ns].filter((i) => !tras.has(claveOculta(i)))).toEqual([pre]);
    // Y al revés.
    expect(mostrarLead(ocultas, "Closer 1:7", tipoDelMotivo("NO_SHOW · Enviado"))).toEqual(new Set([claveOculta(pre)]));
    // Motivos de antes del 28/09/2026 (LIMPIAR): cuentan como la tarjeta de hoy (No-show / Post-call).
    expect(tipoDelMotivo("LIMPIAR_NO_SHOW · Seguir: enviado S3")).toBe("NO_SHOW");
    expect(tipoDelMotivo("LIMPIAR_POST_CALL · No hacer")).toBe("POST_CALL");
    expect(mostrarLead(ocultas, "Closer 1:7", tipoDelMotivo("LIMPIAR_NO_SHOW · Seguir: enviado S3"))).toEqual(new Set([claveOculta(pre)]));
    // Sin un tipo conocido (un guardado de la ficha), vuelven todas las del lead.
    expect(tipoDelMotivo("OTRO_TIPO · Enviado")).toBeNull();
    expect(mostrarLead(ocultas, "Closer 1:7", tipoDelMotivo("FICHA · datos de cierre"))).toEqual(new Set());
    expect(mostrarLead(ocultas, "Closer 1:7")).toEqual(new Set());
  });

  it("mostrarLead no toca otros leads (Closer 1:7 no es Closer 1:70)", () => {
    const ocultas = new Set(["Closer 1:7|NO_SHOW|Enviar S1", "Closer 1:70|PRE_CALL|Enviar fase: DOLORES"]);
    expect(mostrarLead(ocultas, "Closer 1:7")).toEqual(new Set(["Closer 1:70|PRE_CALL|Enviar fase: DOLORES"]));
    expect(mostrarLead(ocultas, "Closer 1:7", "PRE_CALL")).toBe(ocultas);
    expect(mostrarLead(ocultas, "Closer 2:7")).toBe(ocultas);
  });

  it("tipoDelMotivo: el tipo de tarjeta al principio del motivo del log", () => {
    expect(tipoDelMotivo("PRE_CALL · Enviado")).toBe("PRE_CALL");
    expect(tipoDelMotivo("RESULTADO_REAGENDA · Cargar resultado: No se presentó · No hacer")).toBe("RESULTADO_REAGENDA");
    expect(tipoDelMotivo(motivoDe("CERRAR_NO_SHOW", { id: "olvidar", etiqueta: "Olvidar", cambios: {} }))).toBe("CERRAR_NO_SHOW");
    expect(tipoDelMotivo("FICHA · datos de cierre")).toBeNull();
    expect(tipoDelMotivo("Acción desde la app")).toBeNull();
    expect(tipoDelMotivo("")).toBeNull();
  });
});

describe("progreso y hechas hoy", () => {
  const op = (extra: Partial<OperacionHecha>): OperacionHecha => ({
    idOperacion: "abcd1234",
    hora: "10:00",
    fecha: "24/09/2026 10:00:00",
    closer: "Carlos",
    hoja: "Closer 1",
    fila: 7,
    lead: "Juan",
    motivo: "NO_SHOW · Enviado",
    cambios: [],
    deshecha: false,
    ...extra,
  });

  it("N = hechas hoy sin las deshechas ni las del admin; M = pendientes + N", () => {
    const hechas = [op({}), op({ deshecha: true }), op({ closer: "Admin" }), op({})];
    expect(progresoDelDia(6, hechas, "Admin")).toEqual({ hechas: 2, total: 8, porcentaje: 25 });
    expect(progresoDelDia(0, [], "Admin")).toEqual({ hechas: 0, total: 0, porcentaje: 0 });
    // Una tarjeta recién tocada (oculta) cuenta como hecha antes de que llegue el log nuevo.
    expect(progresoDelDia(5, hechas, "Admin", 1)).toEqual({ hechas: 3, total: 8, porcentaje: 38 });
  });

  it("los guardados de la ficha no suman en N ni en M (no resuelven ninguna tarjeta); los motivos viejos sí", () => {
    const tarjetas = [op({}), op({ motivo: "RESULTADO · Cargar resultado: Fee · Hacer" })];
    const conFicha = [
      ...tarjetas,
      op({ motivo: "FICHA · notas de reagenda" }),
      op({ motivo: "FICHA · notas de reagenda" }),
      op({ motivo: "FICHA · datos de cierre" }),
    ];
    expect(progresoDelDia(6, conFicha, "Admin")).toEqual(progresoDelDia(6, tarjetas, "Admin"));
    expect(progresoDelDia(6, conFicha, "Admin")).toEqual({ hechas: 2, total: 8, porcentaje: 25 });
    // Hasta el 28/09/2026 un seguimiento atrasado era LIMPIAR_NO_SHOW: sigue siendo de una tarjeta.
    expect(progresoDelDia(0, [op({ motivo: "LIMPIAR_NO_SHOW · Seguir: enviado S3" })], "Admin")).toEqual({ hechas: 1, total: 1, porcentaje: 100 });
    expect(esDeTarjeta("CERRAR_NO_SHOW · Olvidar")).toBe(true);
    expect(esDeTarjeta("FICHA · notas de reagenda")).toBe(false);
    expect(esDeTarjeta("Acción desde la app")).toBe(false);
  });

  it("la lista marca como \"no suma\" exactamente lo que separa al chip de la barra (ficha y admin)", () => {
    const hechas = [
      op({}),
      op({ motivo: "FICHA · notas de reagenda" }),
      op({ closer: "Admin" }), // una tarjeta resuelta por el admin: sale de una tarjeta, pero no suma
      op({ closer: "Admin", motivo: "FICHA · datos de cierre" }),
      op({ deshecha: true }),
    ];
    expect(sumaEnProgreso(op({}), "Admin")).toBe(true);
    expect(sumaEnProgreso(op({ closer: "Admin" }), "Admin")).toBe(false);
    expect(sumaEnProgreso(op({ motivo: "FICHA · notas de reagenda" }), "Admin")).toBe(false);
    // Sin nadie a excluir, lo del admin suma como cualquier tarjeta.
    expect(sumaEnProgreso(op({ closer: "Admin" }))).toBe(true);
    const chip = hechas.filter((h) => !h.deshecha).length;
    const marcadas = hechas.filter((h) => !h.deshecha && !sumaEnProgreso(h, "Admin")).length;
    expect(progresoDelDia(0, hechas, "Admin").hechas).toBe(chip - marcadas);
    expect(marcadas).toBe(3);
  });

  it("solo se puede deshacer la más nueva de cada lead (si comparten columnas, AG incluida)", () => {
    const ag = (antes: string, despues: string) => ({ columna: "AG", campo: "ultimoToque", antes, despues });
    // La más nueva primero, como `operacionesDeHoy`.
    const s1 = op({ idOperacion: "00000002", fecha: "24/09/2026 10:01:00", cambios: [{ columna: "S", campo: "fupsNoShow", antes: "", despues: "S1" }, ag("24/09/2026 10:00:00", "24/09/2026 10:01:00")] });
    const no = op({ idOperacion: "00000001", fecha: "24/09/2026 10:00:00", cambios: [{ columna: "R", campo: "presentoAgenda1", antes: "", despues: "No" }, ag("", "24/09/2026 10:00:00")] });
    const otroLead = op({ idOperacion: "00000003", fila: 9, fecha: "24/09/2026 10:02:00", cambios: [ag("", "24/09/2026 10:02:00")] });
    expect([...hechasBloqueadas([otroLead, s1, no])]).toEqual([claveHecha(no)]);
    // Deshecha la nueva, la vieja se puede deshacer.
    expect(hechasBloqueadas([otroLead, { ...s1, deshecha: true }, no]).size).toBe(0);
    // Un guardado de la ficha (Y, sin AG) no bloquea a una acción de tarjeta anterior.
    const ficha = op({ idOperacion: "00000004", fecha: "24/09/2026 10:05:00", cambios: [{ columna: "Y", campo: "cashDia1", antes: "", despues: "500" }] });
    expect(hechasBloqueadas([ficha, no]).size).toBe(0);
  });

  it("el Enviado del pre-call (solo F, sin AG) no se bloquea con un S2 del mismo lead, ni al revés", () => {
    const ag = (antes: string, despues: string) => ({ columna: "AG", campo: "ultimoToque", antes, despues });
    const fase = (id: string, hora: string, antes: string, despues: string) =>
      op({ idOperacion: id, fecha: `24/09/2026 ${hora}:00`, motivo: "PRE_CALL · Enviado", cambios: [{ columna: "F", campo: "precall", antes, despues }] });
    const pre = fase("00000001", "10:00", "", "CONF + DECISORES");
    const s2 = op({ idOperacion: "00000002", fecha: "24/09/2026 10:05:00", cambios: [{ columna: "S", campo: "fupsNoShow", antes: "S1", despues: "S2" }, ag("", "24/09/2026 10:05:00")] });
    expect(hechasBloqueadas([s2, pre]).size).toBe(0);
    // Otra fase después sí bloquea a la primera (las dos tocan F).
    const pre2 = fase("00000003", "10:10", "CONF + DECISORES", "VIDEOS CONF");
    expect([...hechasBloqueadas([pre2, s2, pre])]).toEqual([claveHecha(pre)]);
  });

  it("motivo sin el tipo técnico", () => {
    expect(motivoLegible("NO_SHOW · Enviado")).toBe("Enviado");
    expect(motivoLegible("RESULTADO · Cargar resultado: Broke · Hacer")).toBe("Cargar resultado: Broke · Hacer");
    expect(motivoLegible("FICHA · datos de cierre")).toBe("Datos de cierre");
    expect(motivoLegible("")).toBe("");
  });

  it("los cambios se muestran sin el último toque, con nombres legibles", () => {
    const cambios = [
      { columna: "S", campo: "fupsNoShow", antes: "S1", despues: "S2" },
      { columna: "AG", campo: "ultimoToque", antes: "", despues: "24/09/2026 10:00:00" },
    ];
    expect(cambiosVisibles(cambios).map(textoCambio)).toEqual(["Seguimientos no-show: S1 → S2"]);
    expect(cambiosVisibles([cambios[1]])).toHaveLength(1);
    expect(textoCambio({ columna: "V", campo: "situacion", antes: "", despues: "Broke" })).toBe("Situación: — → Broke");
  });
});

describe("formularios", () => {
  const botonResultado: Boton = { id: "resultado", etiqueta: "Cargar resultado", cambios: {}, pide: "situacion", principal: true };
  const botonCerro: Boton = { id: "cerro", etiqueta: "Cerró", cambios: { situacion: "Cerrado en seguimiento" }, pide: "cierre" };
  const botonReagendo: Boton = { id: "reagendo", etiqueta: "Reagendó", cambios: {}, pide: "reagenda" };
  // Resultado de la call (RESULTADO) y de una reunión reagendada (RESULTADO_REAGENDA).
  const W = { datosReagenda: "" } as const;
  const R = { datosReagenda: "notas viejas", reagendada: true } as const;
  const sinReagenda = { fechaHora: "", datos: "" };
  const datos = (situacion: string, extra: Partial<Parameters<typeof formularioSituacion>[2]> = {}) => ({
    situacion,
    hacerSeguimiento: null,
    montos: {},
    reagenda: sinReagenda,
    ...extra,
  });

  it("Reagendó con fecha acordada: con Hacer la conserva (sigue la secuencia); con No hacer o cerrado la borra", () => {
    const reagendoConFecha: Boton = { id: "reagendo", etiqueta: "Reagendó", cambios: { situacion: "Reagendó", proximoSeguimiento: "" }, pide: "situacion" };
    const enCurso = { datosReagenda: "", seguimientoActual: "S2" };
    expect(formularioSituacion(reagendoConFecha, enCurso, datos("Reagendó", { hacerSeguimiento: true }))).toEqual({ ok: true, cambios: { situacion: "Reagendó" }, detalle: "Reagendó · Hacer (sigue en S2)" });
    expect(formularioSituacion(reagendoConFecha, { datosReagenda: "" }, datos("Reagendó", { hacerSeguimiento: true }))).toMatchObject({ ok: true, cambios: { situacion: "Reagendó", seguimientoPost1: "Hacer" } });
    expect(formularioSituacion(reagendoConFecha, { datosReagenda: "" }, datos("Reagendó", { hacerSeguimiento: true })).ok && "proximoSeguimiento" in (formularioSituacion(reagendoConFecha, { datosReagenda: "" }, datos("Reagendó", { hacerSeguimiento: true })) as { cambios: object }).cambios).toBe(false);
    expect(formularioSituacion(reagendoConFecha, enCurso, datos("Reagendó", { hacerSeguimiento: false }))).toMatchObject({ ok: true, cambios: { situacion: "Reagendó", seguimientoPost1: "No hacer", proximoSeguimiento: "" } });
  });

  it("motivo para el log, con detalle y recortado a 200", () => {
    expect(motivoDe("NO_SHOW", { id: "enviado", etiqueta: "Enviado", cambios: {} })).toBe("NO_SHOW · Enviado");
    expect(motivoDe("RESULTADO", botonResultado, "Quiere pensarlo · Hacer")).toBe(
      "RESULTADO · Cargar resultado: Quiere pensarlo · Hacer",
    );
    expect(motivoDe("RESULTADO", botonResultado, "x".repeat(300))).toHaveLength(200);
  });

  it("el formulario de resultado es de una reunión reagendada solo en RESULTADO_REAGENDA", () => {
    const conTipo = (tipo: ItemCliente["accion"]["tipo"]) => {
      const i = item({ grupo: "resultado" });
      return { ...i, accion: { ...i.accion, tipo } };
    };
    expect(esResultadoReagenda(conTipo("RESULTADO_REAGENDA"))).toBe(true);
    expect(esResultadoReagenda(conTipo("RESULTADO"))).toBe(false);
    expect(esResultadoReagenda(conTipo("FALTA_FECHA_REAGENDA"))).toBe(false);
  });

  it("títulos de la hoja inferior", () => {
    expect(tituloFormulario("situacion")).toBe("Resultado de la call");
    expect(tituloFormulario("situacion", true)).toBe("Resultado de la reunión reagendada");
    expect(tituloFormulario("reagenda")).toBe("Reagendó: nueva fecha");
    expect(tituloFormulario("cierre")).toBe("Cerró: datos del cierre");
  });

  it("montos: solo los cargados, y rechaza lo que no es número", () => {
    expect(leerMontos({ cashDia1: " 1500 ", valorServicio: "", cashTratoCerrado: "0" })).toEqual({
      ok: true,
      montos: { cashDia1: "1500", cashTratoCerrado: "0" },
    });
    expect(leerMontos({ valorServicio: "mil" })).toMatchObject({ ok: false });
    expect(leerMontos({ valorServicio: "-5" })).toMatchObject({ ok: false });
  });

  it("montos: con separador de miles se piden de nuevo (\"1.500\" se escribiría como 1,5)", () => {
    expect(leerMontos({ cashDia1: "1500,50", valorServicio: "3000.5" })).toEqual({
      ok: true,
      montos: { cashDia1: "1500,50", valorServicio: "3000.5" },
    });
    for (const valor of ["1.500", "3,000", "1.500.000", "1.500,50"]) {
      expect(leerMontos({ valorServicio: valor })).toEqual({
        ok: false,
        error: `Valor del servicio: "${valor}": escribilo sin puntos ni comas de miles (p. ej. 1500 o 1500,50).`,
        campo: "valorServicio",
      });
    }
    expect(formularioCierre(botonCerro, { cashDia1: "1.500", valorServicio: "3.000" })).toMatchObject({ ok: false });
    expect(formularioSituacion(botonResultado, W, datos("Cerrado en llamada", { montos: { cashDia1: "1.500", valorServicio: "3000" } }))).toMatchObject({
      ok: false,
    });
  });

  it("los dos cerrados: V + Y + AA (+ Z), sin tocar W/X", () => {
    expect(esCerrado("cerrado en SEGUIMIENTO")).toBe(true);
    expect(esCerrado("Quiere pensarlo")).toBe(false);
    expect(formularioSituacion(botonResultado, W, datos(""))).toMatchObject({ ok: false });
    expect(formularioSituacion(botonResultado, W, datos("Cerrado en llamada", { montos: { cashDia1: "1000" } }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("valor"),
    });
    expect(formularioSituacion(botonResultado, W, datos("Cerrado en llamada", { montos: { valorServicio: "3000" } }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("día 1"),
    });
    expect(
      formularioSituacion(
        botonResultado,
        W,
        datos("Cerrado en llamada", { hacerSeguimiento: true, montos: { cashDia1: "1000", valorServicio: "3000", cashTratoCerrado: "0" } }),
      ),
    ).toEqual({
      ok: true,
      cambios: { situacion: "Cerrado en llamada", cashDia1: "1000", valorServicio: "3000", cashTratoCerrado: "0" },
      detalle: "Cerrado en llamada",
    });
    expect(
      formularioSituacion(botonResultado, R, datos("Cerrado en seguimiento", { montos: { cashDia1: "500", valorServicio: "3000", cashTratoCerrado: "2500" } })),
    ).toEqual({
      ok: true,
      cambios: { situacion: "Cerrado en seguimiento", cashDia1: "500", valorServicio: "3000", cashTratoCerrado: "2500" },
      detalle: "Cerrado en seguimiento",
    });
  });

  it("otra situación: V + Hacer / No hacer, siempre en W", () => {
    expect(formularioSituacion(botonResultado, W, datos("Quiere pensarlo"))).toMatchObject({ ok: false });
    expect(formularioSituacion(botonResultado, W, datos("Quiere pensarlo", { hacerSeguimiento: true }))).toEqual({
      ok: true,
      cambios: { situacion: "Quiere pensarlo", seguimientoPost1: "Hacer" },
      detalle: "Quiere pensarlo · Hacer",
    });
    expect(formularioSituacion(botonResultado, R, datos("Broke", { hacerSeguimiento: false, montos: { cashDia1: "9" } }))).toEqual({
      ok: true,
      cambios: { situacion: "Broke", seguimientoPost1: "No hacer" },
      detalle: "Broke · No hacer",
    });
  });

  it("resultado de la call con W ya en S1…S5: Hacer conserva el avance; No hacer y la reunión reagendada sí escriben", () => {
    const conS2 = { ...W, seguimientoActual: "S2" };
    expect(formularioSituacion(botonResultado, conS2, datos("Quiere pensarlo", { hacerSeguimiento: true }))).toEqual({
      ok: true,
      cambios: { situacion: "Quiere pensarlo" },
      detalle: "Quiere pensarlo · Hacer (sigue en S2)",
    });
    expect(formularioSituacion(botonResultado, conS2, datos("Broke", { hacerSeguimiento: false }))).toMatchObject({
      ok: true,
      cambios: { situacion: "Broke", seguimientoPost1: "No hacer" },
    });
    // W con "Hacer" o vacío: se escribe Hacer como siempre.
    expect(
      formularioSituacion(botonResultado, { ...W, seguimientoActual: "Hacer" }, datos("Fee", { hacerSeguimiento: true })),
    ).toMatchObject({ cambios: { situacion: "Fee", seguimientoPost1: "Hacer" } });
    // Resultado de una reunión reagendada: W se reinicia aunque tenga los S de antes (es una reunión nueva).
    expect(formularioSituacion(botonResultado, { ...R, seguimientoActual: "S3" }, datos("Fee", { hacerSeguimiento: true }))).toEqual({
      ok: true,
      cambios: { situacion: "Fee", seguimientoPost1: "Hacer" },
      detalle: "Fee · Hacer",
    });
  });

  it("\"No se presentó\" (solo en la reunión reagendada): reagendar de nuevo (AC, AB opcional) o dejarlo (W = No hacer)", () => {
    const noVino = (salida: "reagendar" | "dejar" | null, reagenda = { fechaHora: "", datos: "notas viejas" }) =>
      datos("", { noSePresento: { salida }, reagenda });
    expect(formularioSituacion(botonResultado, R, noVino(null))).toEqual({ ok: false, error: "Elegí si lo reagendás de nuevo o lo dejás." });
    expect(formularioSituacion(botonResultado, R, noVino("reagendar"))).toMatchObject({ ok: false, error: expect.stringContaining("fecha") });
    // V no se toca (sigue Reagendó); AB solo si cambió.
    expect(formularioSituacion(botonResultado, R, noVino("reagendar", { fechaHora: "2026-10-01T09:00", datos: "notas viejas" }))).toEqual({
      ok: true,
      cambios: { fechaReagenda: "01/10/2026 09:00:00" },
      detalle: "No se presentó · reagendó 01/10/2026 09:00",
    });
    expect(formularioSituacion(botonResultado, R, noVino("reagendar", { fechaHora: "2026-10-01T09:00", datos: "pidió el jueves" }))).toMatchObject({
      ok: true,
      cambios: { fechaReagenda: "01/10/2026 09:00:00", datosReagenda: "pidió el jueves" },
    });
    expect(formularioSituacion(botonResultado, R, noVino("dejar"))).toEqual({
      ok: true,
      cambios: { seguimientoPost1: "No hacer" },
      detalle: "No se presentó · No hacer",
    });
    // Sin elegir nada: pide cómo terminó la reunión.
    expect(formularioSituacion(botonResultado, R, datos(""))).toEqual({ ok: false, error: "Elegí cómo terminó la reunión." });
    // En el resultado de la call no existe esa opción: pide la situación.
    expect(formularioSituacion(botonResultado, W, noVino("dejar"))).toEqual({ ok: false, error: "Elegí el resultado de la call." });
  });

  it("Reagendó es un resultado sin fecha obligatoria, con decisión de seguimiento", () => {
    expect(formularioSituacion(botonResultado, W, datos("Reagendó", {hacerSeguimiento:true}))).toMatchObject({ok:true, cambios:{situacion:"Reagendó", seguimientoPost1:"Hacer"}});
    expect(formularioSituacion(botonResultado, W, datos("Reagendó", {hacerSeguimiento:false}))).toMatchObject({ok:true, cambios:{situacion:"Reagendó", seguimientoPost1:"No hacer"}});
  });

  it("el error de un monto dice de cuál habla (la hoja inferior lleva el foco a ese campo)", () => {
    // Falta uno: el campo es el del mensaje, no el primero vacío en pantalla (Cash trato cerrado).
    expect(formularioCierre(botonCerro, { cashDia1: "1500" })).toEqual({ ok: false, error: "Cargá el valor del servicio.", campo: "valorServicio" });
    expect(formularioCierre(botonCerro, { cashDia1: "1500", valorServicio: "3000" })).toMatchObject({ ok: false, campo: "cashTratoCerrado" });
    expect(formularioCierre(botonCerro, { valorServicio: "3000" })).toMatchObject({ ok: false, campo: "cashDia1" });
    // Mal escrito (no vacío): el campo es ese, aunque haya otro obligatorio vacío.
    expect(formularioCierre(botonCerro, { cashDia1: "1.500" })).toMatchObject({ ok: false, error: expect.stringContaining("día 1"), campo: "cashDia1" });
    expect(formularioCierre(botonCerro, { cashDia1: "1500", valorServicio: "3000", cashTratoCerrado: "mil" })).toMatchObject({
      ok: false,
      campo: "cashTratoCerrado",
    });
    expect(formularioSituacion(botonResultado, W, datos("Cerrado en llamada", { montos: { cashDia1: "1000" } }))).toMatchObject({
      ok: false,
      campo: "valorServicio",
    });
    // Los errores que no son de un monto no traen campo.
    expect(formularioSituacion(botonResultado, W, datos("Quiere pensarlo"))).not.toHaveProperty("campo");
  });

  it("cierre: conserva lo que trae el botón y exige Y, Z y AA", () => {
    expect(formularioCierre(botonCerro, { valorServicio: "3000" })).toMatchObject({ ok: false, error: expect.stringContaining("día 1") });
    expect(formularioCierre(botonCerro, { cashTratoCerrado: "1500", valorServicio: "3000" })).toMatchObject({ ok: false });
    expect(formularioCierre(botonCerro, { cashDia1: "1500" })).toMatchObject({ ok: false, error: expect.stringContaining("valor") });
    expect(formularioCierre(botonCerro, { cashDia1: "1500", valorServicio: "3000" })).toMatchObject({ ok: false, error: expect.stringContaining("trato") });
    expect(formularioCierre(botonCerro, { cashDia1: "1500", valorServicio: "3000", cashTratoCerrado: "1500" })).toMatchObject({
      ok: true,
      cambios: { cashTratoCerrado: "1500" },
    });
  });

  it("reagenda: datetime-local a texto de planilla, AB solo si hay algo", () => {
    expect(textoSheetDesdeDatetimeLocal("2026-09-30T15:00")).toBe("30/09/2026 15:00:00");
    expect(textoSheetDesdeDatetimeLocal("2026-02-31T15:00")).toBeNull();
    expect(textoSheetDesdeDatetimeLocal("")).toBeNull();
    expect(formularioReagenda(botonReagendo, { fechaHora: "", datos: "" })).toMatchObject({ ok: false });
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: "  " })).toEqual({
      ok: true,
      cambios: { fechaReagenda: "30/09/2026 15:00:00" },
      detalle: "30/09/2026 15:00",
    });
    expect(
      formularioReagenda({ ...botonReagendo, cambios: { situacion: "Reagendó" } }, { fechaHora: "2026-09-30T15:00", datos: "por Meet" }),
    ).toEqual({
      ok: true,
      cambios: { situacion: "Reagendó", fechaReagenda: "30/09/2026 15:00:00", datosReagenda: "por Meet" },
      detalle: "30/09/2026 15:00",
    });
  });

  it("reagenda: AB arranca con lo que hay y solo se escribe si cambió", () => {
    const sinTocar = formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: " notas viejas " }, "notas viejas");
    expect(sinTocar).toEqual({ ok: true, cambios: { fechaReagenda: "30/09/2026 15:00:00" }, detalle: "30/09/2026 15:00" });
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: "notas viejas + Meet" }, "notas viejas")).toMatchObject({
      ok: true,
      cambios: { datosReagenda: "notas viejas + Meet" },
    });
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: "x".repeat(50_001) })).toMatchObject({ ok: false });
  });

  it("reagenda: los datos no pueden empezar con = ni + (la escritura los rechazaría después de cerrar la hoja)", () => {
    const tel = formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: " +54 9 11 5555-1234 llamar 14 h" });
    expect(tel).toMatchObject({ ok: false, error: expect.stringContaining('"=" ni "+"') });
    expect(tel).toMatchObject({ error: expect.stringContaining("Tel: +54") });
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: "=HOY()" })).toMatchObject({ ok: false });
    // Con algo antes, pasa.
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: "Tel: +54 9 11 5555-1234" })).toMatchObject({
      ok: true,
      cambios: { datosReagenda: "Tel: +54 9 11 5555-1234" },
    });
    // Una AB vieja que ya empezaba con "+" y no se tocó no se escribe: no frena la reagenda.
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: "+54 viejo" }, "+54 viejo")).toEqual({
      ok: true,
      cambios: { fechaReagenda: "30/09/2026 15:00:00" },
      detalle: "30/09/2026 15:00",
    });
    // Lo mismo en "No se presentó → Reagendar de nuevo".
    expect(
      formularioSituacion(botonResultado, R, datos("", { noSePresento: { salida: "reagendar" }, reagenda: { fechaHora: "2026-10-01T09:00", datos: "+54 9 11" } })),
    ).toMatchObject({ ok: false });
  });

  it("reagenda: una AB de más de 500 caracteres sin tocar no frena la reagenda; editada se manda entera", () => {
    const notaVieja = "llamó el lunes, pidió otra fecha. ".repeat(30).trim(); // ~1000 caracteres
    expect(notaVieja.length).toBeGreaterThan(500);
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: notaVieja }, notaVieja)).toEqual({
      ok: true,
      cambios: { fechaReagenda: "30/09/2026 15:00:00" },
      detalle: "30/09/2026 15:00",
    });
    const editada = `${notaVieja} · 30/09 por Meet`;
    expect(formularioReagenda(botonReagendo, { fechaHora: "2026-09-30T15:00", datos: editada }, notaVieja)).toEqual({
      ok: true,
      cambios: { fechaReagenda: "30/09/2026 15:00:00", datosReagenda: editada },
      detalle: "30/09/2026 15:00",
    });
    // Lo mismo eligiendo "Reagendó" en el formulario de resultado.
    expect(
      formularioSituacion(botonResultado, { ...W, datosReagenda: notaVieja }, datos("Reagendó", { hacerSeguimiento: false, reagenda: { fechaHora: "2026-09-30T15:00", datos: notaVieja } })),
    ).toEqual({
      ok: true,
      cambios: { situacion: "Reagendó", seguimientoPost1: "No hacer" },
      detalle: "Reagendó · No hacer",
    });
  });
});

describe("esperadoPara", () => {
  it("lo que tenía cada celda de `cambios` al armar la tarjeta (mismas claves)", () => {
    const valores = { fupsNoShow: "S1", presentoReagenda: "No", situacion: "" } as Partial<ItemCliente["valores"]>;
    expect(esperadoPara(valores, { fupsNoShow: "S2" })).toEqual({ fupsNoShow: "S1" });
    expect(esperadoPara(valores, { presentoReagenda: "", fechaReagenda: "30/09/2026 10:00:00", datosReagenda: "x" })).toEqual({
      presentoReagenda: "No",
      fechaReagenda: "",
      datosReagenda: "",
    });
    expect(esperadoPara(valores, {})).toEqual({});
  });
});

describe("hrefFicha", () => {
  it("codifica la hoja y la página la recupera igual (espacios, guiones, tildes)", () => {
    for (const hoja of ["Closer 1", "Gero-Xavi Rejunte", "Añá / 100%"]) {
      const url = hrefFicha({ hoja, numeroFila: 541 });
      const [, , lead, hojaEnUrl, fila] = url.split("/");
      expect(lead).toBe("lead");
      expect(hojaEnUrl).not.toMatch(/[ /%](?![0-9A-F]{2})/);
      // Next 16 le pasa a la página el segmento codificado, igual que está en la URL.
      expect(decodificarParam(hojaEnUrl)).toBe(hoja);
      expect(leerFilaParam(fila)).toBe(541);
    }
    expect(hrefFicha({ hoja: "Gero-Xavi Rejunte", numeroFila: 5 })).toBe("/ventas/lead/Gero-Xavi%20Rejunte/5");
  });
});

// Coordinar fecha del próximo seguimiento (pedido de Tomás, 11/10/2026)
describe("formularioSeguimiento y tarjetas con fecha acordada", () => {
  const coordinar: Boton = { id: "coordinar", etiqueta: "Coordinar fecha", cambios: {}, pide: "seguimiento" };
  it("desde mañana y hasta 6 meses; escribe AH con el formato de la planilla", () => {
    expect(mananaInput(AHORA)).toBe("2026-09-25");
    expect(formularioSeguimiento(coordinar, "2026-10-15", AHORA)).toEqual({ ok: true, cambios: { proximoSeguimiento: "15/10/2026 00:00:00" }, detalle: "seguimiento el 15/10" });
    expect(formularioSeguimiento(coordinar, "2026-09-25", AHORA).ok).toBe(true);
    for (const malo of ["", "2026-09-24", "2026-09-20", "2026-02-31", "15/10/2026"]) expect(formularioSeguimiento(coordinar, malo, AHORA).ok).toBe(false);
    const limite = new Date(AHORA.getTime() + (MAX_DIAS_SEGUIMIENTO + 1) * 86_400_000);
    expect(formularioSeguimiento(coordinar, mananaInput(new Date(limite.getTime() - 86_400_000)), AHORA).ok).toBe(false);
    // Conserva lo que traiga el botón
    expect(formularioSeguimiento({ ...coordinar, cambios: { fupsNoShow: "S2" } }, "2026-10-01", AHORA)).toMatchObject({ ok: true, cambios: { fupsNoShow: "S2", proximoSeguimiento: "01/10/2026 00:00:00" } });
  });
  const opciones = { filtro: "todo" as const, busqueda: "", ahora: AHORA, orden: "prioridad" as const };
  const acordado = item({ clave: "acordado", grupo: "postCall", tipo: "POST_CALL", fecha: "30/09/2026 00:00", listoPorHoy: true });
  const pendiente = item({ clave: "pend", grupo: "noShow", tipo: "NO_SHOW", fecha: "23/09/2026 10:00" });
  it("hasta la fecha no es pendiente; aparece con los filtros de fecha (Esta semana, Rango)", () => {
    const v = vistaDelDia([acordado, pendiente], opciones);
    expect(v.pendientes.map((i) => i.clave)).toEqual(["pend"]);
    expect(v.listos.map((i) => i.clave)).toEqual(["acordado"]);
    const rango = vistaDelDia([acordado, pendiente], { ...opciones, filtro: "rango", rango: { desde: "2026-09-30", hasta: "2026-09-30" } });
    expect(rango.listos.map((i) => i.clave)).toEqual(["acordado"]);
    expect(vistaDelDia([acordado], { ...opciones, filtro: "hoy" }).listos).toEqual([]);
  });
  it("pasada la medianoche con la lista de ayer, una fecha acordada que todavía no llegó sigue esperando", () => {
    const pasadaMedianoche = parsearFechaSheet("25/09/2026 00:01")!;
    const v = vistaDelDia([acordado, pendiente], { ...opciones, ahora: pasadaMedianoche, diaDeLaLista: "2026-09-24" });
    expect(v.listos.map((i) => i.clave)).toEqual(["acordado"]);
    // El día acordado, ya no
    const ese = parsearFechaSheet("30/09/2026 00:01")!;
    expect(vistaDelDia([acordado], { ...opciones, ahora: ese, diaDeLaLista: "2026-09-29" }).pendientes.map((i) => i.clave)).toEqual(["acordado"]);
  });
});
