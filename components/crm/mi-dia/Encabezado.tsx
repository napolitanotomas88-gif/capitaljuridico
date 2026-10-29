"use client";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { BotonGuia } from "@/components/crm/BotonGuia";
import { BotonMensajes } from "@/components/crm/BotonMensajes";

export type CloserCliente = { id: string; nombre: string; hoja: string };

type Props = {
  closer: CloserCliente;
  fechaLarga: string;
  pendientes: number;
  atrasados: number;
  esAdmin: boolean;
  closers: { id: string; nombre: string }[];
  /** Vuelve a leer la planilla (`router.refresh()`). */
  onActualizar: () => void;
  actualizando: boolean;
};

/**
 * Barra negra fija: quién, la fecha, los contadores, Actualizar, Mensajes (el doc con la guía de
 * mensajes, en otra pestaña) y Salir. El admin además elige closer. Publica su alto en
 * `--alto-encabezado` para que los chips de grupo se peguen justo debajo.
 */
export function Encabezado({ closer, fechaLarga, pendientes, atrasados, esAdmin, closers, onActualizar, actualizando }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publicar = () => document.documentElement.style.setProperty("--alto-encabezado", `${el.offsetHeight}px`);
    publicar();
    const observador = new ResizeObserver(publicar);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  return (
    <header ref={ref} className="marca-barra sticky top-0 z-30 bg-negro text-blanco" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:flex-nowrap lg:gap-4">
        <div className="min-w-0">
          {esAdmin || closers.length > 1 ? (
            <div className="flex flex-wrap items-center gap-x-2">
              <label htmlFor="selector-closer" className="sr-only">
                Closer
              </label>
              <select
                id="selector-closer"
                value={closer.id}
                onChange={(e) => router.push(`/ventas/closer/${encodeURIComponent(e.target.value)}`)}
                className="h-11 max-w-[45vw] rounded-lg border border-white/60 bg-negro px-2 font-bold"
              >
                {closers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
              {/* El tablero del equipo es solo del socio; quien trabaja en varias hojas (pre-caller) cambia de hoja con el selector */}
              {esAdmin && (
                <Link
                  href="/ventas/admin"
                  className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-dorado underline-offset-2 hover:underline"
                >
                  Tablero
                </Link>
              )}
            </div>
          ) : (
            <h1 className="truncate text-lg font-bold leading-tight">{closer.nombre}</h1>
          )}
          <p className="text-sm leading-snug text-white/80 first-letter:uppercase">{fechaLarga}</p>
        </div>

        {/* En el celular (< 640 px) los contadores van en una línea debajo de los botones: con
            Actualizar, Mensajes y Salir en la misma fila no le quedaba lugar al nombre y a la fecha
            a 375 px. Desde 640 px, todo en una fila como siempre. */}
        <div className="flex shrink-0 flex-col-reverse items-end gap-1 sm:flex-row sm:items-center sm:gap-2 lg:gap-3">
          <div className="tabular flex items-center gap-3 text-right">
            <div className="flex items-baseline gap-1 sm:block">
              <p className="font-titulo text-xl font-bold leading-none text-dorado">{pendientes}</p>
              <p className="text-xs uppercase tracking-wide text-white/75">
                <span className="sm:hidden">pend.</span>
                <span className="hidden sm:inline">pendientes</span>
              </p>
            </div>
            <div className="flex items-baseline gap-1 sm:block">
              <p className={`font-titulo text-xl font-bold leading-none ${atrasados > 0 ? "text-dorado" : "text-white/75"}`}>{atrasados}</p>
              <p className="text-xs uppercase tracking-wide text-white/75">
                <span className="sm:hidden">atras.</span>
                <span className="hidden sm:inline">atrasados</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            <button
              type="button"
              onClick={onActualizar}
              disabled={actualizando}
              aria-label={actualizando ? "Actualizando la lista" : "Actualizar la lista"}
              title="Actualizar"
              className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-white/60 px-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-60 lg:px-3"
            >
              <IconoActualizar girando={actualizando} />
              <span className="hidden lg:inline">{actualizando ? "Actualizando…" : "Actualizar"}</span>
            </button>
            <BotonMensajes />
            <BotonGuia />
          </div>
        </div>
      </div>
    </header>
  );
}

/** Las dos flechas de "Actualizar" (también en el tablero de admin). */
export function IconoActualizar({ girando }: { girando: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={girando ? "motion-safe:animate-spin" : undefined}
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}
