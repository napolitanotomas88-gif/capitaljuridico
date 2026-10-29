"use client";

import type { ReactNode } from "react";
import { FILTROS_FECHA, type FiltroFecha, type Orden, type Rango } from "@/lib/crm/pantalla";

type Props = {
  busqueda: string;
  onBusqueda: (texto: string) => void;
  filtro: FiltroFecha;
  onFiltro: (filtro: FiltroFecha) => void;
  rango: Rango;
  onRango: (rango: Rango) => void;
  orden: Orden;
  onOrden: (orden: Orden) => void;
  /** Progreso del día y "Hechas hoy": al final (en la computadora, a la derecha de la misma barra). */
  children?: ReactNode;
};

const CHIP = "flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm font-semibold";
const CHIP_ACTIVO = "border-negro bg-negro text-blanco";
const CHIP_INACTIVO = "border-gris-borde bg-blanco text-gris-texto hover:border-negro hover:text-negro";

/** Barra blanca de herramientas (docs/diseno.md): buscador, orden, filtro por fecha, rango y progreso. */
export function Herramientas({ busqueda, onBusqueda, filtro, onFiltro, rango, onRango, orden, onOrden, children }: Props) {
  return (
    <div className="border-b border-gris-linea bg-blanco">
      <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
        <div className="flex gap-2 lg:w-[22rem]">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Buscar por nombre o teléfono</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              placeholder="Nombre o teléfono"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-gris-borde bg-gris-fondo px-3 text-base focus:border-dorado"
            />
          </label>
          {/* Solo en el celular: el tablero ya separa por tipo y ordena siempre por Prioridad. */}
          <div role="group" aria-label="Orden" className="flex shrink-0 overflow-hidden rounded-xl border border-gris-borde lg:hidden">
            {(
              [
                ["prioridad", "Prioridad"],
                ["hora", "Hora"],
              ] as const
            ).map(([id, etiqueta]) => (
              <button
                key={id}
                type="button"
                aria-pressed={orden === id}
                onClick={() => onOrden(id)}
                className={`h-11 px-3 text-sm font-semibold ${orden === id ? "bg-negro text-blanco" : "bg-blanco text-gris-texto hover:text-negro"}`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>

        {/* En el celular, los chips que no entran se desvanecen a la derecha: se ve que hay más. El
            scroll-padding deja el chip elegido (o enfocado con Tab) fuera del degradé. */}
        <div
          className="sin-barra -mx-4 flex gap-2 overflow-x-auto pl-4 pr-8 max-lg:scroll-pr-8 max-lg:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)] lg:mx-0 lg:px-0"
          role="group"
          aria-label="Filtro por fecha"
        >
          {FILTROS_FECHA.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={(e) => {
                e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" });
                onFiltro(f.id);
              }}
              className={`${CHIP} ${filtro === f.id ? CHIP_ACTIVO : CHIP_INACTIVO}`}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>

        {filtro === "rango" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex min-w-[9.5rem] flex-1 items-center gap-2">
              <span className="text-gris-texto">Desde</span>
              <input
                type="date"
                value={rango.desde}
                onChange={(e) => onRango({ ...rango, desde: e.target.value })}
                className="h-11 min-w-0 flex-1 rounded-lg border border-gris-borde bg-blanco px-2"
              />
            </label>
            <label className="flex min-w-[9.5rem] flex-1 items-center gap-2">
              <span className="text-gris-texto">Hasta</span>
              <input
                type="date"
                value={rango.hasta}
                onChange={(e) => onRango({ ...rango, hasta: e.target.value })}
                className="h-11 min-w-0 flex-1 rounded-lg border border-gris-borde bg-blanco px-2"
              />
            </label>
          </div>
        )}

        {children && <div className="lg:ml-auto">{children}</div>}
      </div>
    </div>
  );
}
