"use client";

// Tablero de práctica del pre-caller (`/ventas/demo-precaller`). Leads de mentira que corren por el motor real
// (`accionesDeFila`), con las 4 columnas del pre-caller. Cada botón aplica sus cambios SOLO a la fila en memoria y dice lo
// que pasaría de verdad. Sin server actions, sin fetch, sin links a la ficha, a WhatsApp ni a Calendly.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ItemCliente } from "@/lib/crm/contratos";
import { PRECALLER } from "@/lib/crm/config/precallV2";
import { accionesDeFila, type Boton } from "@/lib/crm/motor/proxima-accion";
import { columnasDeVista } from "@/lib/crm/pantalla";
import { armarItem } from "@/lib/crm/presentacion";
import type { Campo } from "@/lib/crm/sheets/columnas";
import { HORA, leadsIniciales } from "@/lib/crm/demoPrecaller";
import { Tarjeta } from "./Tarjeta";

/** Lo que haría el botón en el Despacho de verdad (la demo no lo hace). */
function queHariaDeVerdad(b: Boton): string {
  switch (b.id) {
    case "llamadaEfectiva":
      return "se abre el formulario del pase, el lead pasa al closer y a los 3 minutos sale el WhatsApp del closer (video + cita + link).";
    case "pasarAlCloser":
      return "se abre el formulario del pase y el lead pasa al closer: primero sale desde tu WhatsApp el mensaje con las recomendaciones y quién le va a escribir, y al minuto el WhatsApp del closer.";
    case "decisores":
      return "queda marcado que le preguntaste por los decisores; la respuesta se carga en el formulario del pase.";
    case "llamadaNoEfectiva":
      return "sale solo el WhatsApp del pre-caller («Hace unos minutos te llamé… Confirmamos tu asistencia?») y el lead pasa a Pre-call por chat.";
    case "seguimiento":
      return "queda anotado el follow-up que mandaste a mano por chat (con «Ultimátum», la tarjeta pasa a Reagendar o cancelar).";
    case "seguimientoReagenda":
      return "queda anotado el seguimiento para reagendar que mandaste a mano (Seguimiento 1, 2 o 3); la tarjeta sigue en Reagendar o cancelar.";
    case "noHacerReagenda":
      return "no se le hace más seguimiento: el lead sale del tablero (queda Liberado).";
    case "cancelarReunion":
      return "pide confirmación, cancela la reunión en Calendly (le llega un mail al lead) y el lead sale de la lista.";
    case "demoReagendar":
      return "abre el link de Calendly del lead para moverla; el CRM se actualiza solo con la fecha nueva.";
    case "liberar":
      return "libera el lead: no pasa al closer y sale de la lista.";
    default:
      return "se guarda en la planilla y la tarjeta pasa a su paso siguiente.";
  }
}

export function DemoPrecaller({ ahoraISO }: { ahoraISO: string }) {
  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);
  const [filas, setFilas] = useState(() => leadsIniciales(ahora));
  const [registro, setRegistro] = useState<string[]>([]);
  const columnas = useMemo(() => columnasDeVista(true), []);
  // Con la reunión desde hace una semana: todos estos leads son del flujo nuevo
  const dia = useMemo(() => ({ precallV2: true, precallV2Desde: new Date(ahora.getTime() - 7 * 24 * HORA) }), [ahora]);

  const items: ItemCliente[] = filas.flatMap((fila) =>
    accionesDeFila(fila, ahora, dia)
      .filter((a) => a.tipo === "PRE_CALLER")
      .map((a) => armarItem(fila, a, ahora)),
  );
  // Los que ya no tienen tarjeta del pre-caller (pasados al closer, liberados o cancelados)
  const fuera = filas.filter((f) => !items.some((i) => i.identidad.numeroFila === f.numeroFila));

  const alTocar = (item: ItemCliente, b: Boton) => {
    setFilas((actuales) =>
      actuales.map((f) =>
        f.numeroFila === item.identidad.numeroFila ? { ...f, valores: { ...f.valores, ...(b.cambios as Partial<Record<Campo, string>>) } } : f,
      ),
    );
    setRegistro((r) => [`${item.identidad.nombre} · «${b.etiqueta}»: en el Despacho de verdad ${queHariaDeVerdad(b)}`, ...r].slice(0, 12));
  };
  const alBandera = async (item: ItemCliente, marcar: boolean) => {
    alTocar(item, { id: "bandera", etiqueta: marcar ? "🚩 Bandera roja" : "Quitar 🚩", cambios: { banderaRoja: marcar ? "Si" : "" } });
    return true;
  };
  const reiniciar = () => {
    setFilas(leadsIniciales(ahora));
    setRegistro([]);
  };

  return (
    <div className="flex min-h-dvh flex-col pb-28 lg:pb-6">
      <header className="marca-barra sticky top-0 z-30 bg-negro text-blanco" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center lg:px-6">
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">Pre-caller · práctica</h1>
            <p className="text-sm text-white/80">Leads de mentira: no se guarda nada ni sale ningún mensaje. Al recargar, vuelve a empezar.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={reiniciar} className="flex h-11 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold hover:bg-white/10">
              Volver a empezar
            </button>
            <Link href="/ventas/closer/pre-caller" className="flex h-11 items-center rounded-lg bg-dorado px-3 text-sm font-bold text-negro hover:bg-dorado-oscuro hover:text-blanco">
              Ir al tablero real
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-3 overflow-x-auto px-4 pt-3 lg:px-6" style={{ gridTemplateColumns: `repeat(${columnas.length},minmax(264px,1fr))` }}>
        {columnas.map((col) => {
          const deLaColumna = items.filter(col.incluye);
          return (
            <section key={col.clave} aria-label={col.titulo} className="flex flex-col">
              <h2 data-grupo={col.grupo} className="marca-columna mb-2 flex items-center justify-between gap-2 rounded-lg bg-negro px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-blanco">
                <span>{col.titulo}</span>
                <span className="tabular rounded-full bg-dorado px-2 py-0.5 text-negro">{deLaColumna.length}</span>
              </h2>
              <div className="space-y-3">
                {deLaColumna.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-gris-texto">Nada por acá</p>
                ) : (
                  deLaColumna.map((item) => (
                    <Tarjeta key={item.id} item={item} enCurso={false} onBoton={alTocar} onBandera={alBandera} mostrarGrupo={false} demo />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-3 px-4 pt-6 lg:grid-cols-2 lg:px-6">
        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gris-texto">Lo que habría pasado de verdad</h2>
          {registro.length === 0 ? (
            <p className="text-sm text-gris-texto">Tocá un botón de cualquier tarjeta.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {registro.map((r, i) => (
                <li key={`${i}-${r}`}>{r}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gris-texto">Ya no están en el tablero del pre-caller</h2>
          {fuera.length === 0 ? (
            <p className="text-sm text-gris-texto">Ninguno todavía.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {fuera.map((f) => (
                <li key={f.numeroFila}>
                  <span className="font-semibold">{f.valores.nombre}</span> ·{" "}
                  {f.valores.estadoPrecaller === PRECALLER.pasado
                    ? "pasado al closer (en el Despacho real, ahora lo ve el closer con sus recordatorios)"
                    : f.valores.estadoPrecaller === PRECALLER.liberado
                      ? "liberado"
                      : "reunión cancelada"}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
