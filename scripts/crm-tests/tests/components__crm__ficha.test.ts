import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { FichaLead, Identidad } from "@/lib/crm/contratos";
import { claveIdentidad } from "@/lib/crm/pantalla";
import { COLUMNAS, type Campo, type FilaLead } from "@/lib/crm/sheets/columnas";
import { mismaIdentidad } from "@/lib/crm/sheets/verificacion";

// Los formularios de la ficha importan las server actions y el router de Next: acá solo se arma el
// árbol de ContenidoFicha (sin renderizar), así que alcanza con reemplazarlos.
vi.mock("@/lib/crm/acciones", () => ({ guardarFicha: vi.fn(), ejecutarAccion: vi.fn(), deshacerAccion: vi.fn(), deshacerOperacion: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { ContenidoFicha } = await import("@/components/crm/ficha/ContenidoFicha");
const { NotasReagenda } = await import("@/components/crm/ficha/NotasReagenda");
const { FormularioFicha } = await import("@/components/crm/ficha/FormularioFicha");
const { claveBorradorNotas, escribirBorradorNotas, leerBorradorNotas, textoAlPasar } = await import("@/components/crm/ficha/borradorNotas");
const { cambiosSinGuardar, claveCierreSinGuardar, escribirCierreSinGuardar, leerCierreDeOtroLead } = await import(
  "@/components/crm/ficha/cierreSinGuardar"
);
const { AvisoFilaCambiada } = await import("@/components/crm/ficha/AvisoFilaCambiada");
const { renderToStaticMarkup } = await import("react-dom/server");

function valores(extra: Partial<Record<Campo, string>> = {}): Record<Campo, string> {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  return { ...base, nombre: "Ana María Pérez", telefono: "+54 9 11 5555-1234", fechaCall: "20/09/2026 10:00:00", ...extra };
}

function ficha(extra: Partial<Record<Campo, string>> = {}, numeroFila = 10): FichaLead {
  const v = valores(extra);
  const identidad: Identidad = { hoja: "Closer 1", numeroFila, nombre: v.nombre, telefono: v.telefono, fechaCall: v.fechaCall };
  return { identidad, valores: v, items: [], historial: [] };
}

/** Las `key` con que ContenidoFicha monta las notas y el formulario de cierre. */
function keysDeFormularios(f: FichaLead): { notas: string | null; formulario: string | null } {
  const encontrados = new Map<unknown, string | null>();
  const recorrer = (nodo: ReactNode) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!isValidElement(nodo)) return;
    const el = nodo as ReactElement<{ children?: ReactNode }>;
    if (el.type === NotasReagenda || el.type === FormularioFicha) encontrados.set(el.type, el.key);
    recorrer(el.props.children);
  };
  recorrer(ContenidoFicha({ ficha: f, accion: null }));
  expect(encontrados.size).toBe(2);
  return { notas: encontrados.get(NotasReagenda) ?? null, formulario: encontrados.get(FormularioFicha) ?? null };
}

describe("ficha: notas y formulario atados al lead (fila movida)", () => {
  it("guardar (AB, montos, grabaciones) o un cambio de estado no los vuelve a montar", () => {
    const antes = keysDeFormularios(ficha());
    expect(antes.notas).toBeTruthy();
    expect(antes.formulario).toBe(antes.notas);
    const despues = keysDeFormularios(
      ficha({ datosReagenda: "Llamar el lunes", cashDia1: "500", grabacion1: "https://drive/a", situacion: "Reagendó", ultimoToque: "20/09/2026 11:00:00" }),
    );
    expect(despues).toEqual(antes);
  });

  it("si en la misma fila ahora hay otro lead (planilla ordenada), se montan de cero", () => {
    const deA = keysDeFormularios(ficha());
    const deB = keysDeFormularios(ficha({ nombre: "Bruno Gómez", telefono: "+54 9 11 4444-0000" }));
    expect(deB.notas).not.toBe(deA.notas);
    expect(deB.formulario).not.toBe(deA.formulario);
    // Mismo nombre con otro teléfono: también es otro lead.
    expect(keysDeFormularios(ficha({ telefono: "+54 9 11 5555-9999" })).notas).not.toBe(deA.notas);
  });
});

describe("claveIdentidad", () => {
  const identidad = (extra: Partial<Identidad> = {}): Identidad => ({
    hoja: "Closer 1",
    numeroFila: 10,
    nombre: "Ana María Pérez",
    telefono: "+54 9 11 5555-1234",
    fechaCall: "20/09/2026 10:00:00",
    ...extra,
  });
  const filaDe = (i: Identidad): FilaLead => ({
    hoja: i.hoja,
    numeroFila: i.numeroFila,
    valores: valores({ nombre: i.nombre, telefono: i.telefono, fechaCall: i.fechaCall }),
  });

  it("es la misma cuando `mismaIdentidad` del servidor diría que es el mismo lead, y distinta cuando no", () => {
    const base = identidad();
    const casos: Identidad[] = [
      identidad({ nombre: "  ana maria  perez " }),
      identidad({ telefono: "5491155551234" }),
      identidad({ fechaCall: "01/01/2026 10:00" }), // con teléfono, D no se mira
      identidad({ nombre: "Ana Pérez" }),
      identidad({ telefono: "+54 9 11 5555-1235" }),
    ];
    for (const otra of casos) {
      expect(claveIdentidad(otra) === claveIdentidad(base)).toBe(mismaIdentidad(filaDe(base), otra));
    }
  });

  it("sin teléfono, además la fecha de la call (D), con el mismo criterio de fechas", () => {
    const sinTel = identidad({ telefono: "" });
    expect(claveIdentidad(identidad({ telefono: "", fechaCall: "20/09/2026 10:00" }))).toBe(claveIdentidad(sinTel));
    expect(claveIdentidad(identidad({ telefono: "", fechaCall: "21/09/2026 10:00:00" }))).not.toBe(claveIdentidad(sinTel));
  });

  it("otra hoja u otra fila es otra clave", () => {
    expect(claveIdentidad(identidad({ numeroFila: 11 }))).not.toBe(claveIdentidad(identidad()));
    expect(claveIdentidad(identidad({ hoja: "Closer 2" }))).not.toBe(claveIdentidad(identidad()));
  });
});

describe("borrador de las notas en la pestaña", () => {
  let guardados: Map<string, string>;
  beforeEach(() => {
    guardados = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => guardados.get(k) ?? null,
      setItem: (k: string, v: string) => void guardados.set(k, v),
      removeItem: (k: string) => void guardados.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const a: Identidad = { hoja: "Closer 1", numeroFila: 10, nombre: "Ana María Pérez", telefono: "+54 9 11 5555-1234", fechaCall: "" };
  const b: Identidad = { ...a, nombre: "Bruno Gómez", telefono: "+54 9 11 4444-0000" };
  const clave = claveBorradorNotas(a);

  const deAna = { texto: "Notas de Ana", base: "", lead: claveIdentidad(a), nombre: a.nombre };

  it("se recupera solo para el lead que lo escribió (en la misma fila puede haber otro)", () => {
    escribirBorradorNotas(clave, deAna);
    expect(claveBorradorNotas(b)).toBe(clave);
    expect(leerBorradorNotas(clave, claveIdentidad({ ...a, nombre: " ana maria perez" }))).toEqual({ borrador: deAna, deOtroLead: false });
    escribirBorradorNotas(clave, null);
    expect(leerBorradorNotas(clave, claveIdentidad(a))).toBeNull();
  });

  it("si en la fila ahora hay otro lead, el de Ana vuelve marcado como de otro (para avisar, no para cargarlo)", () => {
    // R11: lo escrito para Ana no se carga en las notas de Bruno (no se podría guardar en su AB sin
    // que el closer lo decida), pero tampoco se pierde sin aviso: vuelve con el nombre de Ana.
    escribirBorradorNotas(clave, deAna);
    expect(leerBorradorNotas(clave, claveIdentidad(b))).toEqual({ borrador: deAna, deOtroLead: true });
    // Mismo lead con el nombre corregido por el admin: para la app es otro (no se puede distinguir),
    // así que también se avisa en vez de borrarlo.
    expect(leerBorradorNotas(clave, claveIdentidad({ ...a, nombre: "Ana María Pérez de Gómez" }))?.deOtroLead).toBe(true);
    // Leerlo no lo borra: se borra recién al cerrar el aviso.
    expect(guardados.has(clave)).toBe(true);
  });

  it("un borrador sin nombre (formato anterior) se lee con el nombre vacío", () => {
    guardados.set(clave, JSON.stringify({ texto: "x", base: "", lead: claveIdentidad(a) }));
    expect(leerBorradorNotas(clave, claveIdentidad(b))).toEqual({ borrador: { texto: "x", base: "", lead: claveIdentidad(a), nombre: "" }, deOtroLead: true });
  });

  it("pasar el del lead anterior a estas notas: lo reemplaza o, si ya había algo nuevo, va debajo", () => {
    expect(textoAlPasar("Notas de Ana", "Lo de la planilla", "Lo de la planilla")).toBe("Notas de Ana");
    expect(textoAlPasar("Notas de Ana", "  Lo de la planilla \n", "Lo de la planilla")).toBe("Notas de Ana");
    expect(textoAlPasar("Notas de Ana", "Algo nuevo  \n", "Lo de la planilla")).toBe("Algo nuevo\n\nNotas de Ana");
  });

  it("un borrador sin lead (formato anterior, solo con el nombre) o roto no se recupera", () => {
    guardados.set(clave, JSON.stringify({ texto: "x", base: "", nombre: "Ana María Pérez" }));
    expect(leerBorradorNotas(clave, claveIdentidad(a))).toBeNull();
    guardados.set(clave, "{no es json");
    expect(leerBorradorNotas(clave, claveIdentidad(a))).toBeNull();
    guardados.set(clave, "null");
    expect(leerBorradorNotas(clave, claveIdentidad(a))).toBeNull();
  });

  it("sin sessionStorage (modo privado, datos bloqueados) no rompe", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(() => escribirBorradorNotas(clave, deAna)).not.toThrow();
    expect(leerBorradorNotas(clave, claveIdentidad(a))).toBeNull();
    const claveCierre = claveCierreSinGuardar(a);
    expect(() => escribirCierreSinGuardar(claveCierre, { lead: claveIdentidad(a), nombre: a.nombre, cambios: { cashDia1: "500" } })).not.toThrow();
    expect(leerCierreDeOtroLead(claveCierre, claveIdentidad(b))).toBeNull();
  });
});

describe("cierre sin guardar en la pestaña (R12)", () => {
  let guardados: Map<string, string>;
  beforeEach(() => {
    guardados = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => guardados.get(k) ?? null,
      setItem: (k: string, v: string) => void guardados.set(k, v),
      removeItem: (k: string) => void guardados.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const a: Identidad = { hoja: "Closer 1", numeroFila: 10, nombre: "Ana María Pérez", telefono: "+54 9 11 5555-1234", fechaCall: "" };
  const b: Identidad = { ...a, nombre: "Bruno Gómez", telefono: "+54 9 11 4444-0000" };
  const clave = claveCierreSinGuardar(a);
  const campos = ["cashDia1", "cashTratoCerrado", "valorServicio", "grabacion1", "grabacion2", "grabacion3"] as const;
  const vacios = Object.fromEntries([...campos, "datosReagenda"].map((c) => [c, ""])) as Parameters<typeof cambiosSinGuardar>[0];

  it("anota solo lo que difiere de la base (sin contar espacios de los bordes)", () => {
    expect(cambiosSinGuardar(vacios, vacios, campos)).toBeNull();
    expect(cambiosSinGuardar({ ...vacios, cashDia1: "500", grabacion1: "  " }, vacios, campos)).toEqual({ cashDia1: "500" });
    // AB tiene su propio bloque: aunque difiera, no es del formulario.
    expect(cambiosSinGuardar({ ...vacios, datosReagenda: "nota" }, vacios, campos)).toBeNull();
    expect(cambiosSinGuardar({ ...vacios, valorServicio: "" }, { ...vacios, valorServicio: "3000" }, campos)).toEqual({ valorServicio: "" });
  });

  it("es una fila por hoja + fila: el mismo lugar para Ana y para Bruno", () => {
    expect(claveCierreSinGuardar(b)).toBe(clave);
    expect(claveCierreSinGuardar({ ...a, numeroFila: 11 })).not.toBe(clave);
    expect(clave).not.toBe(claveBorradorNotas(a));
  });

  it("si la fila ahora es de otro lead, devuelve lo que se cargó para el anterior (para avisar)", () => {
    const deAna = { lead: claveIdentidad(a), nombre: a.nombre, cambios: { cashDia1: "500", grabacion1: "https://drive/a" } };
    escribirCierreSinGuardar(clave, deAna);
    expect(leerCierreDeOtroLead(clave, claveIdentidad(b))).toEqual(deAna);
    // Del mismo lead no hay aviso (no se vuelve a cargar en los campos).
    expect(leerCierreDeOtroLead(clave, claveIdentidad(a))).toBeNull();
    // Leerlo no lo borra: se borra al cerrar el aviso o cuando se carga algo para el lead nuevo.
    expect(guardados.has(clave)).toBe(true);
    escribirCierreSinGuardar(clave, null);
    expect(leerCierreDeOtroLead(clave, claveIdentidad(b))).toBeNull();
  });

  it("roto, sin cambios o con valores que no son texto: no hay aviso", () => {
    guardados.set(clave, "{no es json");
    expect(leerCierreDeOtroLead(clave, claveIdentidad(b))).toBeNull();
    guardados.set(clave, JSON.stringify({ lead: claveIdentidad(a), nombre: a.nombre, cambios: {} }));
    expect(leerCierreDeOtroLead(clave, claveIdentidad(b))).toBeNull();
    guardados.set(clave, JSON.stringify({ lead: claveIdentidad(a), nombre: a.nombre, cambios: { cashDia1: 500, cashTratoCerrado: "900" } }));
    expect(leerCierreDeOtroLead(clave, claveIdentidad(b))).toEqual({ lead: claveIdentidad(a), nombre: a.nombre, cambios: { cashTratoCerrado: "900" } });
  });
});

describe("aviso de fila cambiada", () => {
  const html = (props: Partial<Parameters<typeof AvisoFilaCambiada>[0]> = {}) =>
    renderToStaticMarkup(
      AvisoFilaCambiada({
        actual: "Bruno Gómez",
        anterior: "Ana María Pérez",
        que: "lo que escribiste en las notas",
        ayuda: "Copialo.",
        resumen: "Ver lo que escribiste",
        children: "Llamar el lunes",
        onCerrar: () => {},
        ...props,
      }),
    );

  it("dice de quién es la fila ahora, para quién era lo escrito, y lo muestra para copiarlo", () => {
    const h = html();
    expect(h).toContain('role="alert"');
    expect(h).toContain("Esta fila ahora es de Bruno Gómez (cambió la planilla): lo que escribiste en las notas para Ana María Pérez no se guardó.");
    expect(h).toContain("Ver lo que escribiste");
    expect(h).toContain("Llamar el lunes");
    expect(h).toContain("Cerrar aviso");
  });

  it("sin nombres, no queda un hueco", () => {
    const h = html({ actual: " ", anterior: "" });
    expect(h).toContain("Esta fila ahora es de otro lead (cambió la planilla)");
    expect(h).toContain("para el lead anterior no se guardó.");
  });
});
