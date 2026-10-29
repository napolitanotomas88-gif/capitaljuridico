"use client";

import type { OperacionHecha } from "@/lib/crm/contratos";
import { useMemo } from "react";
import { cambiosVisibles, claveHecha, hechasBloqueadas, motivoLegible, sumaEnProgreso, textoCambio, type Progreso } from "@/lib/crm/pantalla";

/**
 * "Progreso del día" (hechas N de M con barra dorado) y el botón que despliega "Hechas hoy"
 * (docs/diseno.md §Barra de herramientas).
 */
export function ProgresoDelDia({
  progreso,
  cantidadHechas,
  abierto,
  onAlternar,
  idLista,
}: {
  progreso: Progreso;
  /**
   * Operaciones de hoy en la lista (sin las deshechas), las mismas filas que despliega. Incluye los
   * guardados de la ficha y lo que hizo el admin, que la barra no suma (la lista los marca).
   */
  cantidadHechas: number;
  abierto: boolean;
  onAlternar: () => void;
  idLista: string;
}) {
  const { hechas, total, porcentaje } = progreso;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 lg:w-60 lg:flex-none">
        <p className="flex items-baseline justify-between gap-2 whitespace-nowrap text-sm">
          <span className="hidden font-semibold sm:inline">Progreso del día</span>
          <span className="tabular text-gris-texto">
            Hechas <strong className="font-titulo text-base text-negro">{hechas}</strong> de {total}
          </span>
        </p>
        <div
          role="progressbar"
          aria-label="Progreso del día"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={hechas}
          aria-valuetext={`${hechas} de ${total} hechas`}
          className="mt-1 h-2.5 overflow-hidden rounded-full bg-gris-linea"
        >
          <div className="h-full rounded-full bg-dorado transition-[width] duration-300" style={{ width: `${porcentaje}%` }} />
        </div>
      </div>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        aria-controls={idLista}
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-gris-borde bg-blanco px-3 text-sm font-semibold hover:border-negro"
      >
        Hechas hoy
        <span className="tabular rounded-full bg-gris-fondo px-1.5 text-xs font-bold">{cantidadHechas}</span>
        <span aria-hidden="true" className={`transition-transform ${abierto ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
    </div>
  );
}

/**
 * "Hechas hoy": las operaciones de hoy de la hoja (la más nueva primero) con Deshacer en cada
 * una. Sirve para corregir un toque equivocado aunque el toast de 5 s ya se haya ido. Las ya
 * deshechas quedan marcadas. Si el lead tuvo después otra acción que cambió lo mismo (las que
 * escriben AG entre sí; el Enviado del pre-call, sin AG, solo con otra que tocó F), primero se
 * deshace esa (`hechasBloqueadas`): la vieja queda con el botón deshabilitado y lo dice. Los
 * guardados de la ficha (sin tarjeta) y lo que hizo el admin se listan y se deshacen igual, pero dicen
 * que no suman en el progreso (`sumaEnProgreso`, la misma regla de la barra): así se entiende que la
 * barra cuente menos que el chip.
 */
export function ListaHechas({
  id,
  hechas,
  closer,
  excluirDelProgreso,
  ocupados,
  onDeshacer,
}: {
  id: string;
  hechas: readonly OperacionHecha[];
  /** Nombre del closer de la pantalla: las que hizo otro (el admin) dicen quién. */
  closer: string;
  /** Quién no suma en el progreso (el admin): lo mismo que recibe `progresoDelDia`. */
  excluirDelProgreso?: string;
  /** Leads (`hoja:fila`) con una escritura en curso. */
  ocupados: ReadonlySet<string>;
  onDeshacer: (op: OperacionHecha) => void;
}) {
  const bloqueadas = useMemo(() => hechasBloqueadas(hechas), [hechas]);
  return (
    <section id={id} aria-label="Hechas hoy" className="border-b border-gris-linea bg-blanco">
      {hechas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gris-texto">Todavía no hay acciones registradas hoy.</p>
      ) : (
        <ul className="max-h-[45vh] divide-y divide-gris-linea overflow-y-auto overscroll-contain px-4 lg:max-h-60">
          {hechas.map((op) => {
            const bloqueada = bloqueadas.has(claveHecha(op));
            return (
              <li key={claveHecha(op)} className="flex items-start gap-3 py-2">
                <span className="tabular w-11 shrink-0 pt-0.5 text-sm font-semibold text-gris-texto">{op.hora}</span>
                <div className={`min-w-0 flex-1 ${op.deshecha ? "text-gris-texto" : ""}`}>
                  <p className="break-words font-semibold">
                    {op.lead.trim() || `Fila ${op.fila}`}
                    {op.closer !== closer && <span className="text-sm font-normal text-gris-texto"> · por {op.closer}</span>}
                  </p>
                  <p className="break-words text-sm">
                    {motivoLegible(op.motivo)}
                    {!op.deshecha && !sumaEnProgreso(op, excluirDelProgreso) && (
                      <span className="text-gris-texto"> · no suma en el progreso</span>
                    )}
                  </p>
                  <p className={`wrap-anywhere text-sm text-gris-texto ${op.deshecha ? "line-through" : ""}`}>
                    {cambiosVisibles(op.cambios).map(textoCambio).join(" · ")}
                  </p>
                  {bloqueada && (
                    <p className="text-xs text-gris-texto">Para deshacer esta, primero deshacé la más nueva de este lead que cambió lo mismo.</p>
                  )}
                </div>
                {op.deshecha ? (
                  <span className="mt-1 shrink-0 rounded-full bg-gris-fondo px-2 py-1 text-xs font-bold uppercase tracking-wide text-gris-texto">
                    Deshecha
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDeshacer(op)}
                    disabled={bloqueada || ocupados.has(`${op.hoja}:${op.fila}`)}
                    aria-label={`Deshacer: ${op.lead.trim() || `Fila ${op.fila}`}, ${motivoLegible(op.motivo)}`}
                    className="min-h-11 shrink-0 rounded-xl border border-negro bg-blanco px-3 text-sm font-bold hover:bg-negro hover:text-blanco disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Deshacer
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
