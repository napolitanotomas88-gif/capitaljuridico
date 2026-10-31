"use client";

import Link from "next/link";
import { useEffect, useId, useState, type MouseEvent } from "react";
import type { Identidad, ItemCliente } from "@/lib/crm/contratos";
import type { Boton } from "@/lib/crm/motor/proxima-accion";
import { BOTON_CANCELAR_REUNION, ETIQUETA_GRUPO, hrefFicha, urgencia, type Urgencia } from "@/lib/crm/pantalla";
import { partesFecha } from "@/lib/crm/fechas";
import { ESTILO_WHATSAPP } from "@/components/crm/estilosWhatsApp";
import { recordatorioParaGuardar, recordatorioVisual, videosConfEnviados } from "@/lib/crm/recordatorio";
import { digitosWhatsApp } from "@/lib/crm/presentacion";

const FRANJA: Record<Urgencia, string> = {
  hoy: "border-l-dorado",
  normal: "border-l-verde",
  listo: "border-l-gris-borde",
};

/**
 * Un click "normal" en un link a la ficha: en la computadora abre el panel lateral en vez de
 * navegar. Con Ctrl/Cmd/Shift o la rueda sigue siendo un link común (otra pestaña o ventana).
 */
export function clickAbrePanel(e: MouseEvent<HTMLAnchorElement>, abrir: (() => void) | undefined): void {
  if (!abrir || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  e.preventDefault();
  abrir();
}

type Props = {
  item: ItemCliente;
  /** Hay una escritura en curso para este lead: se deshabilitan los botones. */
  enCurso: boolean;
  /** Error de la última escritura (la tarjeta volvió a la lista). */
  error?: string;
  onBoton: (item: ItemCliente, boton: Boton) => void;
  /** Bandera roja (solo Pre-call): prende o apaga el circulito de la esquina. true si se guardó. */
  onBandera?: (item: ItemCliente, marcar: boolean) => Promise<boolean>;
  onRecordatorio?: (item: ItemCliente, nuevo: string, anterior: string) => Promise<boolean>;
  /** false dentro de la ficha, donde el nombre no tiene adónde ir. */
  linkFicha?: boolean;
  /** En la computadora, el nombre abre la ficha como panel lateral (sin perder el tablero). */
  onAbrirFicha?: (identidad: Identidad) => void;
  /**
   * Etiqueta del grupo arriba de la tarjeta ("NO-SHOW"). Solo sirve cuando se mezclan grupos
   * (celular con el chip "Todo", ficha); en el tablero repite el título de la columna.
   */
  mostrarGrupo?: boolean;
  /**
   * Dentro de la sección plegada "Listo por hoy": más tenue (fondo gris, sin sombra) y sin la marca
   * "Listo por hoy", que ya está en el título de la sección.
   */
  tenue?: boolean;
};

/** "15/10" (Buenos Aires) de la fecha de la acción. */
function diaMesCorto(fecha: string | Date): string {
  const p = partesFecha(new Date(fecha));
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}`;
}

/**
 * El teléfono del lead debajo del nombre: un toque lo copia como lo busca WhatsApp ("+" y dígitos; en Argentina, con el 9)
 * para pegarlo en el buscador de WhatsApp o 2Chat (pedido de Tomás del 19/10/2026). Avisa "Copiado" un momento, también al lector de pantalla.
 */
function TelefonoCopiable({ telefono }: { telefono: string }) {
  const [copiado, setCopiado] = useState<"si" | "error" | null>(null);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(null), 2000);
    return () => clearTimeout(t);
  }, [copiado]);
  const texto = telefono.trim();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(`+${digitosWhatsApp(texto)}`);
      setCopiado("si");
    } catch {
      setCopiado("error");
    }
  };
  return (
    <p className="mt-0.5 flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={copiar}
        title="Copiar teléfono"
        aria-label={`Copiar teléfono ${texto}`}
        // Área táctil de 44 px sin sumar alto a la tarjeta (como el nombre).
        className="tabular -my-[13px] inline-flex items-center gap-1.5 py-[13px] font-semibold text-gris-texto hover:text-negro"
      >
        {texto}
        <IconoCopiar />
      </button>
      <span role="status" className={`text-xs font-bold ${copiado === "error" ? "text-rojo" : "text-verde"}`}>
        {copiado === "si" ? "Copiado ✓" : copiado === "error" ? "No se pudo copiar" : ""}
      </span>
    </p>
  );
}

/**
 * Una acción de un lead (docs/diseno.md §Tarjeta). La app no sugiere textos (decisión de Gero del
 * 28/09/2026): el botón de WhatsApp Web abre el chat sin texto y el closer escribe según su guía (el doc
 * del botón "Mensajes" de la barra). Un pre-call "listo por hoy" (`accion.listoPorHoy`) lleva la
 * franja gris y, fuera de su sección plegada (p. ej. en la ficha), la marca "Listo por hoy"; el
 * título y los botones son los de siempre.
 */
export function Tarjeta({ item, enCurso, error, onBoton, onBandera, onRecordatorio, linkFicha = true, onAbrirFicha, mostrarGrupo = true, tenue = false }: Props) {
  const { accion, identidad } = item;
  // La marca "Listo por hoy" sobra dentro de su sección; la del seguimiento coordinado ("Seguimiento el 15/10") no
  const marcaListo = accion.listoPorHoy && (!tenue || accion.grupo !== "precall");
  const tieneTelefono = /\d/.test(identidad.telefono);
  const nombre = identidad.nombre.trim() || "(sin nombre)";
  // El lector de pantalla nombra la tarjeta por el lead (el h3).
  const idNombre = useId();

  const recordatorioLeido = item.valores.recordatorioPrecall ?? "";
  const [recordatorio, setRecordatorio] = useState(recordatorioLeido);
  const [recordatorioPrevio, setRecordatorioPrevio] = useState(recordatorioLeido);
  if (recordatorioLeido !== recordatorioPrevio) {
    setRecordatorioPrevio(recordatorioLeido);
    setRecordatorio(recordatorioLeido);
  }
  const [guardandoRecordatorio, setGuardandoRecordatorio] = useState(false);
  const cambiarRecordatorio = async (nuevo: string) => {
    if (!onRecordatorio || guardandoRecordatorio || enCurso) return;
    const anterior = recordatorio;
    setRecordatorio(nuevo);
    setGuardandoRecordatorio(true);
    try {
      if (!await onRecordatorio(item, nuevo, anterior)) setRecordatorio(anterior);
    } catch {
      setRecordatorio(anterior);
    } finally {
      setGuardandoRecordatorio(false);
    }
  };

  // Bandera roja (pedido de Tomás del 25/10/2026): marca interna del equipo, solo en Pre-call. El circulito cambia al toque y
  // vuelve atrás si no se pudo guardar; cuando llega la lista nueva, manda lo de la planilla.
  const conBandera = item.valores.banderaRoja?.trim().toLowerCase() === "si";
  const [bandera, setBandera] = useState(conBandera);
  const [banderaPrevia, setBanderaPrevia] = useState(conBandera);
  if (conBandera !== banderaPrevia) {
    setBanderaPrevia(conBandera);
    setBandera(conBandera);
  }
  const [guardandoBandera, setGuardandoBandera] = useState(false);
  const alternarBandera = async () => {
    if (!onBandera || guardandoBandera) return;
    const nueva = !bandera;
    setBandera(nueva);
    setGuardandoBandera(true);
    const ok = await onBandera(item, nueva);
    setGuardandoBandera(false);
    if (!ok) setBandera(!nueva);
  };

  return (
    <article
      className={`relative min-w-0 rounded-2xl border border-l-4 border-gris-linea p-4 ${tenue ? "bg-gris-fondo" : "bg-blanco shadow-sm"} ${FRANJA[urgencia(accion)]} ${
        enCurso ? "opacity-60" : ""
      }`}
      aria-busy={enCurso}
      aria-labelledby={idNombre}
    >
      {/* Bandera roja: un circulito gris en la esquina; tocado, rojo. Área táctil de 24 px sin ocupar lugar en la tarjeta. */}
      {accion.grupo === "precall" && onBandera && (
        <button
          type="button"
          onClick={alternarBandera}
          disabled={guardandoBandera}
          aria-pressed={bandera}
          aria-label={bandera ? `Quitar la bandera roja de ${nombre}` : `Marcar a ${nombre} con bandera roja`}
          title={bandera ? "Bandera roja · tocá para quitarla" : "Marcar con bandera roja"}
          className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full disabled:cursor-wait"
        >
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-full border transition-colors ${bandera ? "border-rojo bg-rojo" : "border-gris-borde bg-gris-linea"}`}
          />
        </button>
      )}
      {(mostrarGrupo || accion.atrasado || marcaListo) && (
        <div className="flex items-start justify-between gap-2">
          {mostrarGrupo && (
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-gris-texto">{ETIQUETA_GRUPO[accion.grupo]}</p>
          )}
          {accion.atrasado && (
            <span className="ml-auto rounded-full bg-dorado px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-negro">
              Atrasado
            </span>
          )}
          {marcaListo && (
            <span className="ml-auto rounded-full border border-gris-borde bg-gris-fondo px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-gris-texto">
              {/* Un No-show o Post-call que espera: dice para qué día quedó acordado el seguimiento */}
              {accion.grupo === "precall" ? "Listo por hoy" : `Seguimiento el ${diaMesCorto(accion.fecha)}`}
            </span>
          )}
        </div>
      )}

      {/* Si el nombre y la hora no entran en una línea (columnas angostas), la hora baja abajo. */}
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id={idNombre} className="min-w-0 max-w-full text-lg font-bold leading-tight [overflow-wrap:anywhere]">
          {linkFicha ? (
            // El área táctil llega a 44 px sin cambiar el alto de la línea.
            <Link
              href={hrefFicha(identidad)}
              onClick={(e) => clickAbrePanel(e, onAbrirFicha && (() => onAbrirFicha(identidad)))}
              className="-my-[11px] inline-block py-[11px] hover:text-dorado-oscuro hover:underline"
            >
              {nombre}
            </Link>
          ) : (
            nombre
          )}
        </h3>
        <time className="tabular shrink-0 text-sm font-semibold text-gris-texto" dateTime={accion.fecha}>
          {item.horaCall}
        </time>
      </div>
      {tieneTelefono && <TelefonoCopiable telefono={identidad.telefono} />}

      <p className="mt-1 break-words text-sm text-gris-texto">{accion.estado}</p>
      <p className="mt-1 break-words text-base font-bold">{accion.titulo}</p>

      {accion.grupo === "precall" && videosConfEnviados(item.valores.precall) && onRecordatorio && (
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor={`${idNombre}-recordatorio`} className="text-xs font-semibold">Recordatorio</label>
          <select
            id={`${idNombre}-recordatorio`}
            value={recordatorioVisual(recordatorio)}
            onChange={(e) => void cambiarRecordatorio(recordatorioParaGuardar(e.target.value))}
            disabled={enCurso || guardandoRecordatorio}
            aria-busy={guardandoRecordatorio}
            className="min-h-8 w-14 rounded-md border border-gris-linea bg-blanco px-2 text-xs text-negro focus-visible:ring-2 focus-visible:ring-dorado"
          >
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
          {guardandoRecordatorio && <span role="status" className="text-xs text-gris-texto">Guardando…</span>}
        </div>
      )}

      {accion.avisos.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-ambar-fondo px-3 py-2 text-sm text-ambar">
          {accion.avisos.map((a) => (
            <li key={a} className="wrap-anywhere">
              ⚠ {a}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 break-words rounded-lg bg-rojo-fondo px-3 py-2 text-sm font-medium text-rojo">
          {error}
        </p>
      )}

      {/* Abre WhatsApp Web con el teléfono del lead y sin mensaje precargado. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {tieneTelefono && (
          <a
            href={item.urlChat}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`WhatsApp Web con ${nombre} (abre otra pestaña)`}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold ${ESTILO_WHATSAPP}`}
          >
            <IconoChat />
            WhatsApp Web
          </a>
        )}
        {accion.botones.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={enCurso}
            onClick={() => onBoton(item, b)}
            // Ancho natural (nunca parte una palabra); si no entran, bajan a otro renglón y se estiran.
            // Olvidar (saca al lead de la lista) va en bordó y no se estira: no se confunde con los
            // demás. Sin confirmación: se deshace desde el toast o "Hechas hoy". El orden lo da el motor.
            className={`min-h-11 rounded-xl px-3 py-2 text-sm font-bold leading-tight transition-colors disabled:cursor-not-allowed ${
              b.id === "olvidar"
                ? "flex-none border border-bordo bg-blanco text-bordo hover:bg-bordo hover:text-blanco"
                : b.principal
                  ? "flex-auto bg-dorado text-negro hover:bg-dorado-oscuro hover:text-blanco"
                  : "flex-auto border border-negro bg-blanco text-negro hover:bg-negro hover:text-blanco"
            }`}
          >
            {b.etiqueta}
            {b.pide ? "…" : ""}
          </button>
        ))}
        {/* Reagendar en Calendly (Pre-call y No-show): abre el link de reprogramación del lead en otra pestaña. Mover el
            evento en Google Calendar no lo mueve en Calendly; desde acá se libera el horario viejo y el CRM se actualiza solo. */}
        {(accion.grupo === "precall" || accion.grupo === "noShow") && (
          <a
            href={`/ventas/reagendar/${encodeURIComponent(identidad.hoja)}/${identidad.numeroFila}`}
            target="_blank"
            rel="noopener"
            className="flex min-h-11 flex-auto items-center justify-center rounded-xl border border-negro bg-blanco px-3 py-2 text-center text-sm font-bold leading-tight text-negro hover:bg-negro hover:text-blanco"
          >
            Reagendar en Calendly <span aria-hidden="true">&nbsp;↗</span>
            <span className="sr-only"> (abre otra pestaña)</span>
          </a>
        )}
        {/* Cancelar reunión (solo Pre-call de una reunión que todavía no empezó): pide confirmación en la hoja inferior */}
        {item.cancelable && (
          <button
            type="button"
            disabled={enCurso}
            onClick={() => onBoton(item, BOTON_CANCELAR_REUNION)}
            className="min-h-11 flex-none rounded-xl border border-bordo bg-blanco px-3 py-2 text-sm font-bold leading-tight text-bordo transition-colors hover:bg-bordo hover:text-blanco disabled:cursor-not-allowed"
          >
            Cancelar reunión…
          </button>
        )}
      </div>
    </article>
  );
}

function IconoChat() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function IconoCopiar() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
