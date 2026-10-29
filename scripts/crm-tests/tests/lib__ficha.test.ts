import { describe, expect, it } from "vitest";
import { COLUMNAS_IGNORADAS } from "@/lib/crm/config/crm";
import { CAMPOS_FICHA } from "@/lib/crm/contratos";
import { COLUMNAS, type Campo } from "@/lib/crm/sheets/columnas";
import {
  CAMPOS_CONTEXTO,
  CAMPOS_ESTADO,
  ETIQUETA_CAMPO,
  datosFichaDesde,
  esLink,
  firmaDatosFicha,
  formularioFicha,
  fusionarFicha,
  fusionarValor,
} from "@/lib/crm//ficha";

function valores(extra: Partial<Record<Campo, string>> = {}): Record<Campo, string> {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  return { ...base, nombre: "Juan Pérez", telefono: "+54 9 11 5555-1234", ...extra };
}

describe("etiquetas y secciones", () => {
  it("toda columna tiene etiqueta", () => {
    for (const campo of Object.keys(COLUMNAS) as Campo[]) expect(ETIQUETA_CAMPO[campo]).toBeTruthy();
  });
  it("el estado muestra F, R, S, T, V, W, AC, AH y AG (sin U ni X; AB va en su bloque de notas)", () => {
    expect(CAMPOS_ESTADO.map((c) => COLUMNAS[c])).toEqual(["F", "R", "S", "T", "V", "W", "AC", "AH", "AG"]);
    expect(CAMPOS_FICHA).toContain("datosReagenda");
  });
  it("antes de la call: sin Obstáculo, Objetivo ni Inversión (N, O, P)", () => {
    expect(CAMPOS_CONTEXTO.map((c) => COLUMNAS[c])).toEqual(["J", "L", "M", "Q", "G", "H", "I", "K"]);
  });
  it("ninguna columna oculta que la app no usa (N, O, P, U, X) aparece en la ficha", () => {
    expect(COLUMNAS_IGNORADAS.map((c) => COLUMNAS[c])).toEqual(["N", "O", "P", "U", "X"]);
    for (const c of COLUMNAS_IGNORADAS) {
      expect(CAMPOS_ESTADO).not.toContain(c);
      expect(CAMPOS_CONTEXTO).not.toContain(c);
      expect(CAMPOS_FICHA).not.toContain(c);
    }
  });
});

describe("datosFichaDesde / firmaDatosFicha", () => {
  it("toma solo los campos editables, sin espacios alrededor", () => {
    const datos = datosFichaDesde(valores({ cashDia1: " 1500 ", grabacion1: "https://drive/x ", situacion: "Broke" }));
    expect(Object.keys(datos)).toEqual([...CAMPOS_FICHA]);
    expect(datos.cashDia1).toBe("1500");
    expect(datos.grabacion1).toBe("https://drive/x");
  });
  it("la firma cambia si cambia cualquier campo", () => {
    const a = datosFichaDesde(valores({ cashDia1: "100" }));
    const b = datosFichaDesde(valores({ cashDia1: "100", grabacion3: "x" }));
    expect(firmaDatosFicha(a)).not.toBe(firmaDatosFicha(b));
    expect(firmaDatosFicha(a)).toBe(firmaDatosFicha(datosFichaDesde(valores({ cashDia1: " 100" }))));
  });
});

describe("formularioFicha", () => {
  const original = valores({ cashDia1: "1500", valorServicio: "3000", grabacion1: "https://drive/a" });
  const sinCambios = datosFichaDesde(original);

  it("manda solo lo que cambió", () => {
    const r = formularioFicha(original, { ...sinCambios, cashTratoCerrado: "500", grabacion2: "https://drive/b" });
    expect(r).toEqual({ ok: true, cambios: { cashTratoCerrado: "500", grabacion2: "https://drive/b" } });
  });
  it("sin cambios, avisa", () => {
    expect(formularioFicha(original, sinCambios)).toEqual({ ok: false, error: "No cambiaste nada." });
  });
  it("el mismo número escrito distinto no es un cambio", () => {
    expect(formularioFicha(original, { ...sinCambios, cashDia1: "1500.0", valorServicio: "3000,00" })).toEqual({
      ok: false,
      error: "No cambiaste nada.",
    });
  });
  it("vaciar un campo es un cambio válido (borra la celda)", () => {
    const r = formularioFicha(original, { ...sinCambios, grabacion1: "", cashDia1: "" });
    expect(r).toEqual({ ok: true, cambios: { cashDia1: "", grabacion1: "" } });
  });
  it("rechaza montos que no son números", () => {
    const r = formularioFicha(original, { ...sinCambios, cashTratoCerrado: "mil" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("mil");
  });
  it("un monto que en la planilla es texto y no se tocó no frena el guardado (solo se valida lo que cambió)", () => {
    const conTexto = valores({ cashDia1: "USD 500", valorServicio: "-" });
    const r = formularioFicha(conTexto, { ...datosFichaDesde(conTexto), grabacion1: "https://drive/a" });
    expect(r).toEqual({ ok: true, cambios: { grabacion1: "https://drive/a" } });
    // Si lo edita, sí se valida.
    expect(formularioFicha(conTexto, { ...datosFichaDesde(conTexto), cashDia1: "USD 600" }).ok).toBe(false);
    expect(formularioFicha(conTexto, { ...datosFichaDesde(conTexto), cashDia1: "600" })).toEqual({ ok: true, cambios: { cashDia1: "600" } });
  });
  it("rechaza montos con separador de miles (\"1.500\" se escribiría como 1,5)", () => {
    const r = formularioFicha(original, { ...sinCambios, cashTratoCerrado: "1.500" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("sin puntos ni comas de miles");
  });
  it("rechaza grabaciones que parecen fórmulas o son larguísimas", () => {
    expect(formularioFicha(original, { ...sinCambios, grabacion2: "=HYPERLINK(...)" }).ok).toBe(false);
    expect(formularioFicha(original, { ...sinCambios, grabacion3: "x".repeat(501) }).ok).toBe(false);
    expect(formularioFicha(original, { ...sinCambios, grabacion3: "x".repeat(500) }).ok).toBe(true);
  });
});

describe("esLink", () => {
  it("solo http(s) sin espacios", () => {
    expect(esLink("https://drive.google.com/abc")).toBe(true);
    expect(esLink(" http://x.y ")).toBe(true);
    expect(esLink("pendiente")).toBe(false);
    expect(esLink("https://a b")).toBe(false);
  });
});

describe("notas de reagenda (AB)", () => {
  const vacio = Object.fromEntries(CAMPOS_FICHA.map((c) => [c, ""])) as Record<(typeof CAMPOS_FICHA)[number], string>;
  it("guarda solo AB, con texto largo y saltos de línea", () => {
    const notas = "Llamar el martes.\nPidió ver casos de familia. " + "x".repeat(2000);
    expect(formularioFicha(vacio, { ...vacio, datosReagenda: notas })).toEqual({ ok: true, cambios: { datosReagenda: notas } });
  });
  it("se puede editar y también vaciar", () => {
    const antes = { ...vacio, datosReagenda: "nota vieja" };
    expect(formularioFicha(antes, { ...antes, datosReagenda: "nota vieja + nueva" })).toEqual({ ok: true, cambios: { datosReagenda: "nota vieja + nueva" } });
    expect(formularioFicha(antes, { ...antes, datosReagenda: "" })).toEqual({ ok: true, cambios: { datosReagenda: "" } });
  });
  it("no acepta que empiece con = o + (el Sheet lo tomaría como fórmula)", () => {
    expect(formularioFicha(vacio, { ...vacio, datosReagenda: "=HOY()" }).ok).toBe(false);
    expect(formularioFicha(vacio, { ...vacio, datosReagenda: " +54 9 11" }).ok).toBe(false);
    // El error dice cómo seguir.
    expect(formularioFicha(vacio, { ...vacio, datosReagenda: "+54 9 11" })).toMatchObject({ error: expect.stringContaining("escribí algo antes") });
  });
});

describe("cuando la planilla cambia mientras se edita (fusionarValor / fusionarFicha)", () => {
  const vacio = Object.fromEntries(CAMPOS_FICHA.map((c) => [c, ""])) as Record<(typeof CAMPOS_FICHA)[number], string>;
  it("sin borrador se toma lo nuevo", () => {
    expect(fusionarValor("nota vieja", "nota vieja", "nota nueva")).toEqual({ valor: "nota nueva", conflicto: false });
    // Espacios de más no cuentan como edición.
    expect(fusionarValor(" nota vieja\n", "nota vieja", "nota nueva")).toEqual({ valor: "nota nueva", conflicto: false });
  });
  it("lo que se escribió mientras se guardaba no se pierde cuando vuelve lo guardado", () => {
    // Se guardó "Llamar el lunes" (antes = lo enviado) y siguió escribiendo.
    expect(fusionarValor("Llamar el lunes a las 15", "Llamar el lunes", "Llamar el lunes")).toEqual({
      valor: "Llamar el lunes a las 15",
      conflicto: false,
    });
  });
  it("si la cambió otro (fila_cambiada, el Reagendó de la tarjeta), el borrador se conserva y se avisa", () => {
    expect(fusionarValor("mi borrador", "vieja", "la de otro")).toEqual({ valor: "mi borrador", conflicto: true });
    // Si los dos escribieron lo mismo, no hay nada que avisar.
    expect(fusionarValor("igual", "vieja", "igual")).toEqual({ valor: "igual", conflicto: false });
  });
  it("campo por campo: lo no editado se actualiza, lo editado se conserva", () => {
    const antes = { ...vacio, cashDia1: "", grabacion1: "" };
    const ahora = { ...vacio, cashDia1: "1500", cashTratoCerrado: "1500", valorServicio: "3000" }; // un "Cerró" desde la tarjeta
    const local = { ...antes, grabacion1: "https://drive/x" };
    expect(fusionarFicha(local, antes, ahora)).toEqual({
      datos: { ...ahora, grabacion1: "https://drive/x" },
      conflictos: [],
    });
    // Editado acá y cambiado allá: queda lo de acá, en conflicto.
    expect(fusionarFicha({ ...antes, cashDia1: "2000" }, antes, ahora).conflictos).toEqual(["cashDia1"]);
    // Solo los campos pedidos: AB queda como estaba en `local`.
    expect(fusionarFicha({ ...antes, datosReagenda: "x" }, antes, { ...antes, datosReagenda: "y" }, ["cashDia1"]).datos.datosReagenda).toBe("x");
  });
});
