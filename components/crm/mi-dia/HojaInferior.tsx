"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import type { Cambios, ItemCliente } from "@/lib/crm/contratos";
import type { Boton, Pedido } from "@/lib/crm/motor/proxima-accion";
import {
  ETIQUETA_MONTO,
  MAX_TEXTO_REAGENDA,
  datetimeLocalDesde,
  esCerrado,
  esResultadoReagenda,
  formularioCierre,
  formularioReagenda,
  formularioSeguimiento,
  formularioSituacion,
  mananaInput,
  tituloFormulario,
  type CampoMonto,
  type DatosReagenda,
  type Montos,
  type ResultadoFormulario,
  type SalidaNoVino,
} from "@/lib/crm/pantalla";
import { atraparTab, devolverFoco, enfocables, focoActual } from "./foco";

type Props = {
  item: ItemCliente;
  /** Un botón con `pide`: el formulario arma los cambios finales a partir de `boton.cambios`. */
  boton: Boton & { pide: Pedido };
  /** Lista real de V (columna Situación) de la hoja. */
  situaciones: string[];
  ahora: Date;
  enCurso: boolean;
  onConfirmar: (cambios: Cambios, detalle: string) => void;
  onCerrar: () => void;
};

// La parte visible de la pantalla (sin el teclado). En iOS el teclado no achica la ventana: la
// hoja se ubica sobre `visualViewport` para que el pie con Confirmar quede siempre a la vista.
const suscribirVisible = (avisar: () => void) => {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", avisar);
  vv.addEventListener("scroll", avisar);
  return () => {
    vv.removeEventListener("resize", avisar);
    vv.removeEventListener("scroll", avisar);
  };
};
const leerVisible = () => {
  const vv = window.visualViewport;
  return vv ? `${Math.round(vv.height)}|${Math.round(vv.offsetTop)}` : "";
};
function useZonaVisible(): { alto: number; arriba: number } | null {
  const texto = useSyncExternalStore(suscribirVisible, leerVisible, () => "");
  if (!texto) return null;
  const [alto, arriba] = texto.split("|").map(Number);
  return { alto, arriba };
}

/**
 * Hoja inferior en el celular, panel lateral de 420 px en la computadora (docs/diseno.md).
 * Formularios: resultado (V + cash, fecha de la reunión nueva o seguimiento en W; en el de una
 * reunión reagendada, además "No se presentó": reagendar de nuevo o dejarlo), cierre (Y, AA, Z) y
 * reagenda (AC, AB). Diálogo modal: enfoca el primer control, Tab no se escapa, Escape cierra
 * y al cerrar el foco vuelve al botón que la abrió. Con algo cargado, Escape y el toque en el fondo
 * piden confirmación (en plena call un toque de más no se lleva los montos ni la fecha); Cancelar
 * y × cierran directo. Cada paso que aparece (No se presentó, la reagenda, el seguimiento) se trae
 * a la vista.
 */
export function HojaInferior({ item, boton, situaciones, ahora, enCurso, onConfirmar, onCerrar }: Props) {
  const idTitulo = useId();
  const refDialogo = useRef<HTMLDivElement>(null);
  const refCuerpo = useRef<HTMLDivElement>(null);
  const zona = useZonaVisible();
  const [error, setError] = useState<string | null>(null);

  // Resultado de una reunión reagendada (V = Reagendó y la fecha ya pasó): ofrece "No se presentó".
  const reagendada = esResultadoReagenda(item);
  const [situacion, setSituacion] = useState(boton.cambios.situacion ?? "");
  // Solo en el resultado de una reunión reagendada: "No se presentó" y qué hacer (null = no eligió).
  const [noVino, setNoVino] = useState(false);
  const [salidaNoVino, setSalidaNoVino] = useState<SalidaNoVino | null>(null);
  const [hacerSeguimiento, setHacerSeguimiento] = useState<boolean | null>(null);
  const [montos, setMontos] = useState<Montos>({});
  // AB arranca con lo que ya tiene la celda: se edita en vez de pisarla sin verla.
  const [reagenda, setReagenda] = useState<DatosReagenda>({ fechaHora: "", datos: item.valores.datosReagenda.trim() });
  // Coordinar fecha: el día acordado para el próximo seguimiento ("AAAA-MM-DD" del input de tipo date)
  const [fechaSeguimiento, setFechaSeguimiento] = useState("");
  const refNoVino = useRef<HTMLFieldSetElement>(null);
  const refNuevaReunion = useRef<HTMLFieldSetElement>(null);
  const refSeguimiento = useRef<HTMLFieldSetElement>(null);

  // Hay algo cargado que se perdería al cerrar. En el "Reagendó" la situación ya viene puesta: lo único
  // que se elige es el seguimiento, que también cuenta.
  const sucio =
    situacion !== (boton.cambios.situacion ?? "") ||
    noVino ||
    hacerSeguimiento !== null ||
    Object.values(montos).some((v) => v?.trim()) ||
    reagenda.fechaHora !== "" ||
    fechaSeguimiento !== "" ||
    reagenda.datos.trim() !== item.valores.datosReagenda.trim();
  const refSucio = useRef(sucio);
  useEffect(() => {
    refSucio.current = sucio;
  });
  const pedirCerrar = useCallback(() => {
    if (!refSucio.current || window.confirm("¿Descartar lo que cargaste?")) onCerrar();
  }, [onCerrar]);

  // Al abrir: foco en el primer control del formulario; al cerrar, de vuelta al botón que la abrió.
  // Mientras está abierta, la página de atrás no hace scroll.
  useEffect(() => {
    const abridor = focoActual();
    (enfocables(refCuerpo.current)[0] ?? enfocables(refDialogo.current)[0])?.focus();
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
      devolverFoco(abridor);
    };
  }, []);

  // Escape cierra aunque el foco haya quedado afuera (p. ej. después de tocar el fondo).
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") pedirCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [pedirCerrar]);

  // El paso que acaba de aparecer, a la vista (en el celular queda abajo del pliegue). No al abrir.
  const paso = `${situacion}|${noVino}|${salidaNoVino}`;
  const refPaso = useRef(paso);
  useEffect(() => {
    if (refPaso.current === paso) return;
    refPaso.current = paso;
    const destino = noVino ? (salidaNoVino === "reagendar" ? refNuevaReunion : refNoVino) : refSeguimiento;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    destino.current?.scrollIntoView({ block: "nearest", behavior: quieto ? "auto" : "smooth" });
  }, [paso, noVino, salidaNoVino]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (enCurso) return;
    let resultado: ResultadoFormulario;
    switch (boton.pide) {
      case "situacion":
        resultado = formularioSituacion(
          boton,
          { datosReagenda: item.valores.datosReagenda, reagendada, seguimientoActual: item.valores.seguimientoPost1 },
          { situacion, noSePresento: noVino ? { salida: salidaNoVino } : undefined, hacerSeguimiento, montos, reagenda },
        );
        break;
      case "cierre":
        resultado = formularioCierre(boton, montos);
        break;
      case "reagenda":
        resultado = formularioReagenda(boton, reagenda, item.valores.datosReagenda);
        break;
      case "seguimiento":
        resultado = formularioSeguimiento(boton, fechaSeguimiento, ahora);
        break;
      case "cancelacion":
        resultado = { ok: true, cambios: boton.cambios, detalle: "Cancelada en Calendly" };
        break;
    }
    if (!resultado.ok) {
      setError(resultado.error);
      // Si el error es de un monto (falta o está mal escrito), el foco va a ese campo.
      if (resultado.campo) refCuerpo.current?.querySelector<HTMLInputElement>(`input[name="${resultado.campo}"]`)?.focus();
      return;
    }
    setError(null);
    onConfirmar(resultado.cambios, resultado.detalle);
  }

  const cambiarMonto = (campo: CampoMonto) => (valor: string) => setMontos((m) => ({ ...m, [campo]: valor }));
  const cerrado = esCerrado(situacion);
  const ahoraLocal = datetimeLocalDesde(ahora);
  const elegirSituacion = (s: string) => {
    setSituacion(s);
    setNoVino(false);
    setError(null);
  };
  const elegirSalida = (salida: SalidaNoVino) => {
    setSalidaNoVino(salida);
    setError(null);
  };

  const camposMontos = (primeroConFoco: boolean) => (
    <>
      <CampoNumero campo="cashDia1" valor={montos.cashDia1 ?? ""} onChange={cambiarMonto("cashDia1")} autoFocus={primeroConFoco} />
      <CampoNumero campo="cashTratoCerrado" valor={montos.cashTratoCerrado ?? ""} onChange={cambiarMonto("cashTratoCerrado")} />
      <CampoNumero campo="valorServicio" valor={montos.valorServicio ?? ""} onChange={cambiarMonto("valorServicio")} />
    </>
  );

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 flex h-dvh items-end justify-center bg-negro/50 lg:items-stretch lg:justify-end"
      // A los costados, la safe-area (iPhone en horizontal): la hoja no queda bajo el notch.
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        ...(zona ? { top: zona.arriba, height: zona.alto } : {}),
      }}
      onClick={pedirCerrar}
    >
      <div
        ref={refDialogo}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => atraparTab(e, refDialogo.current)}
        className="hoja-inferior flex max-h-[92%] w-full flex-col rounded-t-2xl bg-blanco shadow-2xl lg:h-full lg:max-h-none lg:w-[420px] lg:rounded-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gris-linea px-4 py-3">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-lg font-bold leading-tight">
              {tituloFormulario(boton.pide, reagendada)}
            </h2>
            <p className="truncate text-sm text-gris-texto">
              {item.identidad.nombre.trim()} · {item.horaCall}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none hover:bg-gris-fondo"
          >
            ×
          </button>
        </div>

        <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
          <div ref={refCuerpo} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            {boton.pide === "situacion" && (
              <>
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold">
                    {reagendada ? "¿Cómo terminó la reunión?" : "¿Cómo terminó la call?"}
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {reagendada && (
                      <Opcion
                        elegida={noVino}
                        ancha
                        onClick={() => {
                          setNoVino(true);
                          setSituacion("");
                          setError(null);
                        }}
                      >
                        No se presentó
                      </Opcion>
                    )}
                    {situaciones.map((s) => (
                      <Opcion key={s} elegida={!noVino && s === situacion} onClick={() => elegirSituacion(s)}>
                        {s}
                      </Opcion>
                    ))}
                  </div>
                </fieldset>

                {noVino && (
                  <fieldset ref={refNoVino}>
                    <legend className="mb-2 text-sm font-semibold">No se presentó: ¿qué hacés?</legend>
                    <div className="grid grid-cols-2 gap-2">
                      <Opcion elegida={salidaNoVino === "reagendar"} onClick={() => elegirSalida("reagendar")}>
                        Reagendar de nuevo
                      </Opcion>
                      <Opcion elegida={salidaNoVino === "dejar"} onClick={() => elegirSalida("dejar")}>
                        Dejarlo
                      </Opcion>
                    </div>
                    {salidaNoVino === "dejar" && (
                      <p className="mt-2 text-sm text-gris-texto">Se escribe Seguimientos post-call 1 = No hacer.</p>
                    )}
                  </fieldset>
                )}

                {noVino && salidaNoVino === "reagendar" && (
                  <fieldset ref={refNuevaReunion} className="space-y-3">
                    <legend className="text-sm font-semibold">¿Cuándo es la nueva reunión?</legend>
                    <CamposReagenda datos={reagenda} onChange={setReagenda} ahoraLocal={ahoraLocal} etiqueta="Fecha y hora de la nueva reunión" />
                  </fieldset>
                )}

                {situacion && cerrado && (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">¡Cerrado! Cargá los montos</legend>
                    {camposMontos(true)}
                  </fieldset>
                )}

                {situacion && !cerrado && (
                  <fieldset ref={refSeguimiento}>
                    <legend className="mb-2 text-sm font-semibold">¿Hacer seguimiento?</legend>
                    <div className="grid grid-cols-2 gap-2">
                      <Opcion elegida={hacerSeguimiento === true} onClick={() => setHacerSeguimiento(true)}>
                        Hacer
                      </Opcion>
                      <Opcion elegida={hacerSeguimiento === false} onClick={() => setHacerSeguimiento(false)}>
                        No hacer
                      </Opcion>
                    </div>
                  </fieldset>
                )}
              </>
            )}

            {boton.pide === "cierre" && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Se escribe Situación = Cerrado en seguimiento</legend>
                {camposMontos(false)}
              </fieldset>
            )}

            {boton.pide === "seguimiento" && (
              <fieldset className="space-y-2">
                <legend className="sr-only">Próximo seguimiento</legend>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">Día del próximo seguimiento</span>
                  <input
                    type="date"
                    name="proximoSeguimiento"
                    required
                    min={mananaInput(ahora)}
                    value={fechaSeguimiento}
                    onChange={(e) => {
                      setFechaSeguimiento(e.target.value);
                      setError(null);
                    }}
                    // Con "!": la regla vieja input[type="date"] de app/globals.css (sin capa) les gana a las utilidades
                    className="h-12 w-full rounded-xl! border-2! border-gris-borde! bg-blanco! px-3! text-base! text-negro! focus:border-dorado!"
                  />
                </label>
                <p className="text-sm text-gris-texto">
                  Desde mañana (si es para hoy, mandalo y tocá Enviado). Hasta ese día la tarjeta espera en &ldquo;Listo por
                  hoy&rdquo; y no cuenta como pendiente; ese día vuelve a su columna y, después de mandarlo, el siguiente
                  sigue al otro día. Si hoy ya le escribiste, después de coordinar tocá Enviado en la tarjeta: la fecha se
                  mantiene.
                </p>
              </fieldset>
            )}

            {boton.pide === "cancelacion" && (
              <div className="space-y-3 text-sm">
                <p>
                  Se cancela en Calendly la reunión del <strong>{item.horaCall}</strong>: se libera el horario y sale del
                  calendario del closer. Calendly le avisa al lead por mail.
                </p>
                <p>
                  En el CRM queda como que no se presentó, con el Pre-call en Olvidar y sin seguimiento de no-show, así no
                  aparece en ninguna lista. Se anota en Datos de la reagenda.
                </p>
                <p className="rounded-lg bg-ambar-fondo px-3 py-2 font-semibold text-ambar">
                  La cancelación en Calendly no se puede deshacer. Si el lead quiere otro horario, usá &ldquo;Reagendar en
                  Calendly&rdquo;.
                </p>
              </div>
            )}

            {boton.pide === "reagenda" && (
              <fieldset className="space-y-3">
                <legend className="sr-only">Reagenda</legend>
                <CamposReagenda datos={reagenda} onChange={setReagenda} ahoraLocal={ahoraLocal} etiqueta="Fecha y hora de la reagenda" />
              </fieldset>
            )}
          </div>

          {/* Pie fijo: el error de validación y Confirmar siempre a la vista (también con el teclado abierto). */}
          <div className="shrink-0 border-t border-gris-linea bg-blanco px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {error && (
              <p role="alert" className="mb-2 break-words rounded-lg bg-rojo-fondo px-3 py-2 text-sm font-medium text-rojo">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCerrar}
                className="min-h-12 flex-1 rounded-xl border border-negro bg-blanco text-sm font-bold hover:bg-gris-fondo"
              >
                {/* En "¿Cancelar la reunión?" un "Cancelar" al lado de "Sí, cancelar" se confunde */}
                {boton.pide === "cancelacion" ? "No, volver" : "Cancelar"}
              </button>
              <button
                type="submit"
                disabled={enCurso}
                className={`min-h-12 flex-[2] rounded-xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                  boton.pide === "cancelacion"
                    ? "bg-bordo text-blanco hover:brightness-110"
                    : "bg-dorado text-negro hover:bg-dorado-oscuro hover:text-blanco"
                }`}
              >
                {enCurso ? "Guardando…" : boton.pide === "cancelacion" ? "Sí, cancelar la reunión" : "Confirmar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Opcion({
  elegida,
  onClick,
  ancha,
  children,
}: {
  elegida: boolean;
  onClick: () => void;
  /** Ocupa las dos columnas de la grilla (p. ej. "No se presentó" arriba de las situaciones). */
  ancha?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={elegida}
      // Elegida: borde negro y ✓, no solo el relleno dorado (que contra el blanco no llega a 3:1).
      className={`min-h-11 rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition-colors ${ancha ? "sm:col-span-2" : ""} ${
        elegida ? "border-negro bg-dorado text-negro" : "border-gris-borde bg-blanco hover:border-negro"
      }`}
    >
      {elegida && <span aria-hidden="true">✓ </span>}
      {children}
    </button>
  );
}

const CLASE_CAMPO = "h-12 w-full rounded-xl border-2 border-gris-borde bg-blanco px-3 text-base focus:border-dorado";

/**
 * Fecha y hora (AC) y datos (AB). Sin `min`: una reunión que ya pasó (p. ej. "Reagendó sin fecha"
 * en datos viejos) o una reagenda cargada tarde también se guardan; el motor después pregunta si
 * se presentó o pide su resultado. Solo se avisa.
 */
function CamposReagenda({
  datos,
  onChange,
  ahoraLocal,
  etiqueta,
}: {
  datos: DatosReagenda;
  onChange: (datos: DatosReagenda) => void;
  /** Ahora como "yyyy-mm-ddTHH:mm" (Buenos Aires): se compara como texto con el valor del input. */
  ahoraLocal: string;
  etiqueta: string;
}) {
  const yaPaso = datos.fechaHora !== "" && datos.fechaHora < ahoraLocal;
  return (
    <>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">{etiqueta}</span>
        <input
          type="datetime-local"
          value={datos.fechaHora}
          onChange={(e) => onChange({ ...datos, fechaHora: e.target.value })}
          required
          className={CLASE_CAMPO}
        />
        {yaPaso && (
          <span className="mt-1 block rounded-lg bg-ambar-fondo px-3 py-2 text-sm text-ambar">
            Esa fecha ya pasó: después la app te va a preguntar si se presentó y cómo terminó.
          </span>
        )}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">
          Datos de la reagenda <span className="font-normal text-gris-texto">(opcional)</span>
        </span>
        <textarea
          value={datos.datos}
          onChange={(e) => onChange({ ...datos, datos: e.target.value })}
          maxLength={MAX_TEXTO_REAGENDA}
          rows={3}
          placeholder="p. ej. pidió que le mande el link a las 14"
          className="w-full rounded-xl border-2 border-gris-borde bg-blanco px-3 py-2 text-base focus:border-dorado"
        />
      </label>
    </>
  );
}

function CampoNumero({
  campo,
  valor,
  onChange,
  opcional,
  autoFocus,
}: {
  campo: CampoMonto;
  valor: string;
  onChange: (valor: string) => void;
  opcional?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">
        {ETIQUETA_MONTO[campo]}
        {opcional ? (
          <span className="font-normal text-gris-texto"> (opcional)</span>
        ) : (
          <span aria-hidden="true" className="text-bordo">
            {" "}
            *
          </span>
        )}
      </span>
      {/* Texto y no number: el navegador no "sanea" lo que se escribe (con type=number "1.500"
          llegaba como 1,5 y "1.500.000" como "1.500000"); lo valida `leerMontos`. */}
      <input
        type="text"
        name={campo}
        inputMode="decimal"
        autoComplete="off"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        aria-required={!opcional}
        placeholder="p. ej. 1500"
        className={`tabular ${CLASE_CAMPO}`}
      />
    </label>
  );
}
