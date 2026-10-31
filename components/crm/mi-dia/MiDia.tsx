"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import type { CallDelDia, Identidad, ItemCliente, OperacionHecha } from "@/lib/crm/contratos";
import { formatearFechaLarga } from "@/lib/crm/fechas";
import type { Grupo } from "@/lib/crm/motor/proxima-accion";
import {
  COLUMNAS_TABLERO,
  ETIQUETA_GRUPO,
  GRUPOS_CHIPS,
  claveDia,
  claveOculta,
  progresoDelDia,
  seccionListosAbierta,
  vistaDelDia,
  type FiltroFecha,
  type Orden,
  type Rango,
} from "@/lib/crm/pantalla";
import { CallsDeHoy } from "./CallsDeHoy";
import { Encabezado, type CloserCliente } from "./Encabezado";
import { ListaHechas, ProgresoDelDia } from "./HechasHoy";
import { Herramientas } from "./Herramientas";
import { HojaYToast } from "./HojaYToast";
import { ListoPorHoy } from "./ListoPorHoy";
import { PanelFicha } from "./PanelFicha";
import { Tarjeta } from "./Tarjeta";
import { useEscrituras } from "./useEscrituras";
import { useRefresco } from "./useRefresco";

type Props = {
  items: ItemCliente[];
  /** Todas las calls de hoy de la hoja, con o sin acción (tira "Calls de hoy"). */
  calls: CallDelDia[];
  /** Operaciones de hoy en la hoja según "Log App" (progreso y "Hechas hoy"). */
  hechas: OperacionHecha[];
  /** La hora del servidor al armar la lista (Buenos Aires se calcula con fechas.ts). */
  ahoraISO: string;
  closer: CloserCliente;
  /** Lista real de V de la hoja, para el formulario de resultado. */
  situaciones: string[];
  esAdmin: boolean;
  closers: { id: string; nombre: string }[];
  /** Quién no cuenta en el progreso del closer (el admin), como en "hechas hoy" del tablero de admin. */
  excluirDelProgreso: string;
};

// Los dos layouts (lista en el celular, tablero en la computadora) se eligen con CSS (`lg:`),
// pero después de montar se renderiza uno solo para no duplicar las tarjetas en el DOM.
const CONSULTA_ESCRITORIO = "(min-width: 1024px)";
const suscribirEscritorio = (avisar: () => void) => {
  const mq = window.matchMedia(CONSULTA_ESCRITORIO);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
};
/** true/false en el cliente; null en el servidor y durante la hidratación (se renderizan los dos). */
function useEsEscritorio(): boolean | null {
  return useSyncExternalStore(
    suscribirEscritorio,
    () => window.matchMedia(CONSULTA_ESCRITORIO).matches,
    () => null,
  );
}

type LeadAbierto = Pick<Identidad, "hoja" | "numeroFila">;

/**
 * Pantalla "Mi día" (docs/arquitectura.md §Pantalla, docs/diseno.md). Todo el filtrado es en el
 * cliente sobre `items`; las escrituras van por las server actions y son optimistas (ver
 * `useEscrituras`): la tarjeta desaparece al instante, un toast ofrece Deshacer 5 s y, si la
 * escritura falla, vuelve con el error. "Hechas hoy" deja deshacer cualquier acción del día.
 * Los pre-calls "listos por hoy" (`accion.listoPorHoy`) no son pendientes: no cuentan en ningún
 * contador y van plegados al pie ("Listo por hoy"), así el día termina con todo en "Todo al día".
 * Si el closer abrió la sección, queda abierta (`listosAbiertos`) aunque se desmonte y se vuelva a montar.
 */
export function MiDia({ items, calls, hechas, ahoraISO, closer, situaciones, esAdmin, closers, excluirDelProgreso }: Props) {
  const escritorio = useEsEscritorio();
  const [ahora, setAhora] = useState(() => new Date(ahoraISO));
  const [grupo, setGrupo] = useState<Grupo | "todo">("todo");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<FiltroFecha>("todo");
  const [rango, setRango] = useState<Rango>({ desde: "", hasta: "" });
  const [orden, setOrden] = useState<Orden>("prioridad");
  const [verHechas, setVerHechas] = useState(false);
  // "Listo por hoy" abierta o cerrada (cerrada por defecto): acá y no en el `<details>`, porque la
  // sección se desmonta (tablero ↔ "Todo al día", chips del celular, su única tarjeta oculta).
  const [listosAbiertos, setListosAbiertos] = useState(false);
  const [lead, setLead] = useState<LeadAbierto | null>(null);
  const idHechas = useId();
  const refChipTodo = useRef<HTMLButtonElement>(null);

  const escrituras = useEscrituras(items);
  const { estaOculto, enCurso, errorDe, alTocarBoton, alternarBandera, cambiarRecordatorio } = escrituras;
  const { actualizar, actualizando } = useRefresco(items);

  // Cada lista nueva del servidor es una versión nueva: el panel de la ficha se vuelve a leer.
  const [version, setVersion] = useState(0);
  const [itemsPrevios, setItemsPrevios] = useState(items);
  if (items !== itemsPrevios) {
    setItemsPrevios(items);
    setVersion((v) => v + 1);
  }

  // El día (Buenos Aires) en que el servidor armó la lista: "listo por hoy" vale solo para ese día.
  const diaDeLaLista = claveDia(new Date(ahoraISO));

  // El reloj avanza cada minuto para "en 45 min" y para que "hoy" no quede pegado a la carga. Si pasa
  // la medianoche con la pantalla abierta (sin volver a la pestaña, que ya refresca), se pide la lista
  // nueva una sola vez: el servidor recalcula "listo por hoy" (y el resto) para el día nuevo. Cuando
  // llega, `diaDeLaLista` cambia y el reloj vuelve a empezar. Mientras tanto `vistaDelDia` ya cuenta
  // como pendientes a las listas de ayer.
  useEffect(() => {
    let pedida = false;
    const id = setInterval(() => {
      const nuevo = new Date();
      setAhora(nuevo);
      if (!pedida && claveDia(nuevo) !== diaDeLaLista) {
        pedida = true;
        actualizar();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [diaDeLaLista, actualizar]);

  const abrirFicha = useCallback((l: LeadAbierto) => setLead({ hoja: l.hoja, numeroFila: l.numeroFila }), []);
  const cerrarFicha = useCallback(() => setLead(null), []);

  // --- Lista visible ---------------------------------------------------------------------

  const visibles = useMemo(() => items.filter((i) => !estaOculto(i)), [items, estaOculto]);
  // Pendientes y listas por hoy por separado; los contadores y "Todo al día" miran solo las pendientes.
  // El tablero (computadora) va siempre por Prioridad: el selector de orden es solo del celular y, en
  // No-show y Post-call, "Hora" mezclaría lo atrasado con lo que está al día.
  const vista = useMemo(
    () => vistaDelDia(visibles, { filtro, rango, busqueda, ahora, orden: escritorio === true ? "prioridad" : orden, diaDeLaLista }),
    [visibles, filtro, rango, busqueda, ahora, orden, escritorio, diaDeLaLista],
  );
  const { pendientes, conteo, listos } = vista;
  const lista = grupo === "todo" ? vista.lista : vista.lista.filter((i) => i.accion.grupo === grupo);
  // Celular: la sección "Listo por hoy" va al pie con el chip "Todo" y con el de su grupo (pre-calls listos por hoy y
  // No-show / Post-call con el seguimiento acordado para otro día).
  const listosDelChip = grupo === "todo" ? listos : listos.filter((i) => i.accion.grupo === grupo);
  const progreso = progresoDelDia(pendientes.length, hechas, excluirDelProgreso, items.length - visibles.length);
  // El chip cuenta lo que despliega: todas las vigentes de la lista, también los guardados de la
  // ficha (se deshacen desde ahí) y lo que hizo el admin. La barra no los suma (`sumaEnProgreso`): la
  // lista los marca como "no suma en el progreso".
  const hechasVigentes = hechas.filter((h) => !h.deshecha).length;
  const panelAbierto = lead !== null && escritorio === true;

  // --- Render ----------------------------------------------------------------------------

  const tarjeta = (item: ItemCliente, mostrarGrupo: boolean, tenue = false) => (
    <Tarjeta
      // Lead + acción (+ título y fecha): la misma clave que las tarjetas ocultas y los errores.
      key={claveOculta(item)}
      item={item}
      enCurso={enCurso.has(item.clave)}
      error={errorDe(item)}
      onBoton={alTocarBoton}
      onBandera={alternarBandera}
      onRecordatorio={cambiarRecordatorio}
      onAbrirFicha={abrirFicha}
      mostrarGrupo={mostrarGrupo}
      tenue={tenue}
    />
  );

  // Abierta si el closer la abrió, si hay una búsqueda (lo encontrado no queda escondido) o si una
  // tarjeta de adentro volvió con un error (la escritura falló).
  const seccionListos = (deLaSeccion: readonly ItemCliente[], mostrarGrupo: boolean) =>
    deLaSeccion.length > 0 && (
      <ListoPorHoy
        cantidad={deLaSeccion.length}
        abierta={seccionListosAbierta(listosAbiertos, busqueda, deLaSeccion.some((i) => errorDe(i) !== undefined), filtro)}
        onCambiar={setListosAbiertos}
        tipos={{
          precall: deLaSeccion.some((i) => i.accion.grupo === "precall"),
          coordinados: deLaSeccion.some((i) => i.accion.grupo !== "precall"),
        }}
      >
        {deLaSeccion.map((item) => tarjeta(item, mostrarGrupo, true))}
      </ListoPorHoy>
    );

  const hayFiltros = busqueda.trim() !== "" || filtro !== "todo" || grupo !== "todo";
  const limpiarFiltros = () => {
    // "Ver todo" desaparece junto con los filtros (vuelven las tarjetas): el foco pasa al chip "Todo",
    // que queda elegido, y no se pierde en la página (teclado, lector de pantalla).
    refChipTodo.current?.focus();
    setBusqueda("");
    setFiltro("todo");
    setRango({ desde: "", hasta: "" });
    setGrupo("todo");
  };

  return (
    <div className={`flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden ${panelAbierto ? "lg:pr-[420px]" : ""}`}>
      <Encabezado
        closer={closer}
        fechaLarga={formatearFechaLarga(ahora)}
        pendientes={pendientes.length}
        atrasados={vista.atrasados}
        esAdmin={esAdmin}
        closers={closers}
        onActualizar={actualizar}
        actualizando={actualizando}
      />
      <Herramientas
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        filtro={filtro}
        onFiltro={setFiltro}
        rango={rango}
        onRango={setRango}
        orden={orden}
        onOrden={setOrden}
      >
        <ProgresoDelDia
          progreso={progreso}
          cantidadHechas={hechasVigentes}
          abierto={verHechas}
          onAlternar={() => setVerHechas((v) => !v)}
          idLista={idHechas}
        />
      </Herramientas>
      {verHechas && (
        <ListaHechas
          id={idHechas}
          hechas={hechas}
          closer={closer.nombre}
          excluirDelProgreso={excluirDelProgreso}
          ocupados={enCurso}
          onDeshacer={(op) => void escrituras.deshacerHecha(op)}
        />
      )}
      <CallsDeHoy calls={calls} ahora={ahora} onAbrirFicha={abrirFicha} />

      {/* Celular: chips de grupo + una sola columna */}
      {escritorio !== true && (
        <div className="lg:hidden">
          <div className="sticky z-20 bg-gris-fondo" style={{ top: "var(--alto-encabezado, 5rem)" }}>
            {/* Los chips que no entran se desvanecen a la derecha: se ve que hay más deslizando. La
                máscara va en la fila de adentro: el fondo de la barra fija sigue tapando las tarjetas.
                El scroll-padding deja el chip elegido (o enfocado con Tab) fuera del degradé. */}
            <div
              className="sin-barra flex gap-2 overflow-x-auto scroll-pr-8 py-2 pl-4 pr-8 [mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]"
              role="group"
              aria-label="Grupo"
            >
              <Chip ref={refChipTodo} activo={grupo === "todo"} onClick={() => setGrupo("todo")} etiqueta="Todo" cantidad={vista.totalFiltrado} />
              {GRUPOS_CHIPS.map((g) => (
                <Chip key={g} activo={grupo === g} onClick={() => setGrupo(g)} etiqueta={ETIQUETA_GRUPO[g]} cantidad={conteo[g]} />
              ))}
            </div>
          </div>
          {/* pb-28: la barra de secciones del celular (fija abajo) no tapa la última tarjeta. */}
          <div className="space-y-3 px-4 pb-28 pt-1">
            {pendientes.length === 0 ? (
              <TodoAlDia hayListos={listos.length > 0} />
            ) : lista.length === 0 ? (
              <SinResultados hayFiltros={hayFiltros} hayListos={listosDelChip.length > 0} onLimpiar={limpiarFiltros} />
            ) : (
              lista.map((item) => tarjeta(item, grupo === "todo"))
            )}
            {seccionListos(listosDelChip, grupo === "todo")}
          </div>
        </div>
      )}

      {/* Computadora: tablero de 5 columnas a todo el ancho, cada una con su propio scroll. Mínimo de
          264 px por columna: 5 × 264 + 4 × 12 (separación) + 32 (márgenes) = 1400 px, así en 1440 px
          entran sin scroll horizontal (con lugar para una barra de scroll de 17 px); más angosto,
          el tablero se desliza de costado. Las listas por hoy van plegadas al pie de su columna
          (Pre-call); sin pendientes, "Todo al día" con la sección plegada abajo. */}
      {escritorio !== false && (
        <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
          {pendientes.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
              <TodoAlDia hayListos={listos.length > 0} />
              {listos.length > 0 && <div className="mx-auto w-full max-w-md px-4">{seccionListos(listos, true)}</div>}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[repeat(5,minmax(264px,1fr))] grid-rows-[minmax(0,1fr)] gap-3 overflow-x-auto px-4 pt-3">
              {COLUMNAS_TABLERO.map((col) => {
                const deLaColumna = vista.lista.filter((i) => col.grupos.includes(i.accion.grupo));
                const listosDeLaColumna = listos.filter((i) => col.grupos.includes(i.accion.grupo));
                // Solo las pendientes: las listas por hoy no suman en el contador de la columna.
                const cantidad = col.grupos.reduce((n, g) => n + conteo[g], 0);
                return (
                  <section key={col.titulo} className="flex min-h-0 flex-col" aria-label={col.titulo}>
                    <h2 data-grupo={col.grupos[0]} className="marca-columna mb-2 flex items-center justify-between gap-2 rounded-lg bg-negro px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-blanco">
                      <span>{col.titulo}</span>
                      <span className="tabular rounded-full bg-dorado px-2 py-0.5 text-negro">{cantidad}</span>
                    </h2>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-24 pr-1">
                      {deLaColumna.length === 0 ? (
                        <p className="px-2 py-4 text-center text-sm text-gris-texto">
                          {busqueda.trim() || filtro !== "todo" ? "Nada con este filtro" : "Nada por acá"}
                        </p>
                      ) : (
                        deLaColumna.map((item) => tarjeta(item, false))
                      )}
                      {seccionListos(listosDeLaColumna, false)}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}

      {lead && panelAbierto && (
        <PanelFicha
          key={`${lead.hoja}:${lead.numeroFila}`}
          lead={lead}
          version={version}
          escrituras={escrituras}
          modalAbierto={escrituras.modal !== null}
          onCerrar={cerrarFicha}
        />
      )}

      <HojaYToast escrituras={escrituras} situaciones={situaciones} ahora={ahora} />
    </div>
  );
}

function Chip({
  ref,
  activo,
  onClick,
  etiqueta,
  cantidad,
}: {
  ref?: Ref<HTMLButtonElement>;
  activo: boolean;
  onClick: () => void;
  etiqueta: string;
  cantidad: number;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={activo}
      onClick={(e) => {
        // El chip elegido queda entero a la vista (puede estar medio cortado al borde).
        e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" });
        onClick();
      }}
      className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${
        activo ? "border-negro bg-negro text-blanco" : "border-gris-borde bg-blanco text-gris-texto"
      }`}
    >
      {etiqueta}
      <span className={`tabular rounded-full px-1.5 text-xs ${activo ? "bg-dorado text-negro" : "bg-gris-fondo"}`}>{cantidad}</span>
    </button>
  );
}

/** Sin pendientes. Con pre-calls listos por hoy, lo dice: están plegados abajo y siguen mañana. */
function TodoAlDia({ hayListos }: { hayListos: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-dorado text-3xl font-bold text-negro" aria-hidden="true">
        ✓
      </div>
      <h2 className="mt-4 text-2xl font-bold">Todo al día</h2>
      <p className="mt-1 text-sm text-gris-texto">
        {hayListos
          ? "No te queda nada pendiente por hoy. Lo que espera a otro día está abajo, en Listo por hoy."
          : "No te queda nada pendiente por ahora."}
      </p>
    </div>
  );
}

/**
 * Celular: quedan pendientes, pero ninguna con este filtro. Si lo que coincide está en "Listo por hoy"
 * (abajo), lo dice en vez de "Nada con este filtro": la búsqueda sí lo encontró. Con filtros, "Ver
 * todo" los saca de una (búsqueda, fecha, rango y grupo).
 */
export function SinResultados({ hayFiltros, hayListos, onLimpiar }: { hayFiltros: boolean; hayListos: boolean; onLimpiar?: () => void }) {
  const verTodo = hayFiltros && onLimpiar && (
    <button
      type="button"
      onClick={onLimpiar}
      className="mt-3 min-h-11 rounded-xl border border-negro bg-blanco px-4 text-sm font-bold hover:bg-negro hover:text-blanco"
    >
      Ver todo
    </button>
  );
  if (hayListos) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="font-semibold">Nada pendiente con este filtro</p>
        <p className="mt-1 text-sm text-gris-texto">Lo que coincide está abajo, en &ldquo;Listo por hoy&rdquo;.</p>
        {verTodo}
      </div>
    );
  }
  return (
    <div className="px-4 py-12 text-center">
      <p className="font-semibold">Nada con este filtro</p>
      {hayFiltros && <p className="mt-1 text-sm text-gris-texto">Probá con &ldquo;Todo&rdquo; o borrá la búsqueda.</p>}
      {verTodo}
    </div>
  );
}
