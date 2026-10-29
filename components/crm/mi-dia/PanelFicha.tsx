"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { obtenerFicha } from "@/lib/crm/acciones";
import { ContenidoFicha } from "@/components/crm/ficha/ContenidoFicha";
import { ListaAccionesDeHoy } from "@/components/crm/ficha/ListaAccionesDeHoy";
import type { Identidad, PanelFicha as DatosPanel, Resultado } from "@/lib/crm/contratos";
import { hrefFicha } from "@/lib/crm/pantalla";
import { devolverFoco, focoActual } from "./foco";
import { TEXTO_SIN_CONEXION, type Escrituras } from "./useEscrituras";

type Props = {
  lead: Pick<Identidad, "hoja" | "numeroFila">;
  /** Sube cada vez que llega una lista nueva del servidor: la ficha se vuelve a pedir. */
  version: number;
  /** Las escrituras del tablero: las tarjetas de acá y las del tablero se ocultan juntas. */
  escrituras: Escrituras;
  /** Hay una hoja inferior abierta: Escape la cierra a ella, no al panel. */
  modalAbierto: boolean;
  onCerrar: () => void;
};

type Pedido = { clave: string; version: number; resultado: Resultado<DatosPanel> };

/** El foco está en un campo de texto: ahí Escape primero sale del campo (no cierra el panel). */
const CAMPOS = "textarea, input, select, [contenteditable='true']";

/**
 * La ficha del lead como panel lateral derecho de 420 px en la computadora (docs/diseno.md), sin
 * perder el tablero. Lee con `obtenerFicha` (lo mismo que la página) y se vuelve a leer cuando
 * el tablero recibe datos nuevos (después de escribir, actualizar o volver a la pestaña). Si una
 * relectura falla, la ficha que ya estaba sigue montada (con lo que se estaba escribiendo) y el
 * error va arriba, con "Reintentar".
 */
export function PanelFicha({ lead, version, escrituras, modalAbierto, onCerrar }: Props) {
  const router = useRouter();
  const idTitulo = useId();
  const refPanel = useRef<HTMLElement>(null);
  const refCerrar = useRef<HTMLButtonElement>(null);
  const clave = `${lead.hoja}:${lead.numeroFila}`;
  // El último pedido (puede ser un error) y el último que salió bien (lo que se muestra).
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [ultimoOk, setUltimoOk] = useState<Pedido | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    obtenerFicha(lead.hoja, lead.numeroFila)
      .catch((): Resultado<DatosPanel> => ({ ok: false, error: TEXTO_SIN_CONEXION, codigo: "api" }))
      .then((resultado) => {
        if (!vigente) return;
        const nuevo = { clave, version, resultado };
        setPedido(nuevo);
        if (resultado.ok) setUltimoOk(nuevo);
        if (!resultado.ok && resultado.codigo === "sin_sesion") router.push("/entrar");
      });
    return () => {
      vigente = false;
    };
  }, [lead.hoja, lead.numeroFila, clave, version, intento, router]);

  // Al abrir, el foco va al panel; al cerrar, vuelve al nombre (o la call) que lo abrió.
  useEffect(() => {
    const abridor = focoActual();
    refCerrar.current?.focus();
    return () => devolverFoco(abridor);
  }, []);

  // Escape cierra el panel, salvo con una hoja inferior abierta (la cierra ella) o con el foco en un
  // campo: ahí el primer Escape solo sale del campo (dentro del panel el foco va al ×) y no se
  // pierde lo escrito; el segundo cierra.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || modalAbierto || e.isComposing || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest(CAMPOS)) {
        if (refPanel.current?.contains(t)) refCerrar.current?.focus();
        else t.blur();
        return;
      }
      onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [modalAbierto, onCerrar]);

  // Datos de este lead: los del último pedido que salió bien (quizás de una versión anterior
  // mientras llega la nueva, o si la relectura falló).
  const delLead = pedido?.clave === clave ? pedido : null;
  const conDatos = ultimoOk?.clave === clave ? ultimoOk : null;
  const datos = conDatos?.resultado.ok ? conDatos.resultado.datos : null;
  const error = delLead && !delLead.resultado.ok ? delLead.resultado.error : null;
  const alDia = delLead?.version === version && delLead.resultado.ok;
  const reintentar = () => {
    // El aviso (con este botón, que tiene el foco) se desmonta mientras se vuelve a leer: el foco pasa
    // al × del panel, como al abrirlo, y no se pierde en la página. Si vuelve a fallar, el aviso nuevo
    // se anuncia solo (role="alert").
    refCerrar.current?.focus();
    setPedido(null);
    setIntento((n) => n + 1);
  };

  return (
    <aside
      ref={refPanel}
      aria-labelledby={idTitulo}
      className="panel-lateral fixed inset-y-0 right-0 z-30 flex w-[420px] flex-col border-l border-gris-linea bg-gris-fondo shadow-2xl"
    >
      <div className="flex items-start gap-2 bg-negro px-4 py-3 text-blanco" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-dorado">Ficha{datos ? ` · ${datos.closer}` : ""}</p>
          <h2 id={idTitulo} className="truncate text-lg font-bold leading-tight">
            {datos?.ficha.identidad.nombre.trim() || "Ficha del lead"}
          </h2>
          <Link
            href={hrefFicha(lead)}
            className="-mb-2 inline-flex min-h-11 items-center text-sm font-semibold text-dorado underline underline-offset-2"
          >
            Abrir en página
          </Link>
        </div>
        <button
          ref={refCerrar}
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la ficha"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none hover:bg-white/10"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" aria-busy={!alDia && !error}>
        {error && (
          <div role="alert" className={`rounded-lg bg-rojo-fondo px-3 py-2 text-sm font-medium text-rojo ${datos ? "mb-4" : ""}`}>
            <p>{datos ? `No se pudo actualizar la ficha: ${error}` : error}</p>
            <button
              type="button"
              onClick={reintentar}
              className="mt-2 min-h-11 rounded-xl border border-negro bg-blanco px-4 text-sm font-bold text-negro hover:bg-negro hover:text-blanco"
            >
              Reintentar
            </button>
          </div>
        )}
        {datos ? (
          <ContenidoFicha
            ficha={datos.ficha}
            accion={
              alDia ? (
                <ListaAccionesDeHoy items={datos.ficha.items} escrituras={escrituras} />
              ) : (
                // Las tarjetas de una lectura vieja (o fallida) podrían no estar al día: se esperan.
                <p className="rounded-2xl border border-dashed border-gris-borde bg-blanco px-4 py-5 text-center text-sm text-gris-texto">
                  {error ? "Sin actualizar: reintentá arriba." : "Actualizando…"}
                </p>
              )
            }
          />
        ) : (
          !error && <p className="py-10 text-center text-sm text-gris-texto">Leyendo la ficha…</p>
        )}
      </div>
    </aside>
  );
}
