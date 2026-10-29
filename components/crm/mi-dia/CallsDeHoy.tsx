"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CallDelDia, Identidad } from "@/lib/crm/contratos";
import { desplazamientoTira, hrefFicha, textoEnCuanto, tiraDeCalls } from "@/lib/crm/pantalla";
import { clickAbrePanel } from "./Tarjeta";

type Props = {
  /** Todas las calls de hoy de la hoja (`callsDeHoy`), tengan o no acción pendiente. */
  calls: readonly CallDelDia[];
  ahora: Date;
  /** En la computadora, tocar una call abre la ficha como panel lateral. */
  onAbrirFicha: (identidad: Pick<Identidad, "hoja" | "numeroFila">) => void;
};

/** "hoja:fila" → identidad mínima para la ficha. La hoja puede tener ":" en el nombre. */
function desdeClave(clave: string): Pick<Identidad, "hoja" | "numeroFila"> {
  const corte = clave.lastIndexOf(":");
  return { hoja: clave.slice(0, corte), numeroFila: Number(clave.slice(corte + 1)) };
}

/**
 * Tira "Calls de hoy" (docs/diseno.md): todas las del día en orden, con la hora y el nombre; la
 * próxima en dorado con "en 45 min". Cada una abre la ficha del lead. Al cargar (y cuando cambia la
 * próxima) la tira se desliza hasta la próxima si no se ve entera: con muchas calls quedaba fuera de
 * la pantalla. Se mueve lo justo para que entre por la derecha (`desplazamientoTira`), así sigue a la
 * vista todo lo que entre del título y de las anteriores; y si la tira quedó corrida, el borde
 * izquierdo se desvanece para que se note que hay más de ese lado (la barra de scroll está oculta).
 */
export function CallsDeHoy({ calls, ahora, onAbrirFicha }: Props) {
  const tira = useMemo(() => tiraDeCalls(calls, ahora), [calls, ahora]);
  const refTira = useRef<HTMLDivElement>(null);
  const proxima = tira.find((c) => c.proxima)?.clave;
  // La tira está corrida: hay calls (o el título) escondidos a la izquierda. Lo actualiza el evento
  // scroll, también cuando la mueve el efecto de abajo.
  const [corrida, setCorrida] = useState(false);

  // scrollLeft y no scrollIntoView: no mueve la página en vertical. Solo cuando cambia la próxima
  // (no cada minuto con el reloj), así no le saca la tira de la mano al closer.
  useEffect(() => {
    const cont = refTira.current;
    const el = cont?.querySelector<HTMLElement>("[data-proxima]");
    if (!cont || !el) return;
    const mover = desplazamientoTira(cont.getBoundingClientRect(), el.getBoundingClientRect(), cont.scrollLeft > 1);
    if (mover !== 0) cont.scrollLeft += mover;
  }, [proxima]);

  if (tira.length === 0) return null;

  return (
    <nav aria-label="Calls de hoy" className="border-b border-gris-linea bg-blanco">
      <div
        ref={refTira}
        onScroll={(e) => setCorrida(e.currentTarget.scrollLeft > 1)}
        className={`sin-barra flex items-center gap-2 overflow-x-auto px-4 py-2 ${
          corrida ? "[mask-image:linear-gradient(to_right,transparent,#000_2rem)]" : ""
        }`}
      >
        <h2 className="shrink-0 text-xs font-bold uppercase tracking-wide text-gris-texto">
          Calls de hoy <span className="tabular">({tira.length})</span>
        </h2>
        <ul className="flex gap-2">
          {tira.map((c) => {
            const identidad = desdeClave(c.clave);
            const enCuanto = c.proxima ? textoEnCuanto(c.minutosHasta) : "";
            return (
              <li key={c.clave} className="shrink-0" data-proxima={c.proxima || undefined}>
                <Link
                  href={hrefFicha(identidad)}
                  onClick={(e) => clickAbrePanel(e, () => onAbrirFicha(identidad))}
                  className={`relative tabular flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm ${
                    c.proxima
                      ? "bg-dorado font-bold text-negro"
                      : c.yaPaso
                        ? "bg-gris-fondo text-gris-texto hover:text-negro"
                        : "border border-gris-borde bg-blanco text-negro hover:border-negro"
                  }`}
                >
                  <span>{c.hora}</span>
                  <span className="max-w-40 truncate">{c.nombre}</span>
                  {c.esReagenda && <span className="text-xs font-semibold uppercase">· reagenda</span>}
                  {enCuanto && <span className="font-semibold">· {enCuanto}</span>}
                  <span className="sr-only">
                    {c.proxima ? ", la próxima" : ""}, {c.estado}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
