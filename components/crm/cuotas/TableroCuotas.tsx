"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ESTILO_WHATSAPP } from "@/components/crm/estilosWhatsApp";
import { telefonoWhatsApp } from "@/components/tablero";
import { actualizarPlan, nuevoPlan } from "@/lib/crm/cuotas/acciones";
import {
  cobrado,
  cobradoFilaPagado,
  diaSemana,
  dolares,
  fechaCorta,
  porCobrar,
  saldo,
  sumarMes,
  tarea,
  type Cambio,
  type Cuota,
  type EntradaPlan,
  type Grupo,
  type Plan,
  type RegistroPlan,
  CONCEPTOS_CUOTA,
  ETIQUETA_CONCEPTO_CUOTA,
  cuotasAPagar,
  numeroDeCuota,
  textoPlan,
  leerPlan,
  avisoPagoInicialAnulado,
  cuotaConHistorial,
  type ConceptoCuota,
  sinDomingo,
} from "@/lib/crm/cuotas/modelo";
/** La próxima gestión nunca se muestra en el pasado: el domingo tarea() puede devolver el sábado (sin envíos ese día) */
const proximaGestion = (proxima: string, hoy: string) => (proxima < hoy ? sinDomingo(hoy) : proxima);
const BOTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gris-linea px-3 py-2 text-sm font-bold disabled:opacity-50";
// Botones neutros: blanco, marfil al pasar el mouse y un tono más al tocar (el "gris-claro" de antes no existe en la paleta)
const SECUNDARIO = `${BOTON} bg-blanco hover:bg-marfil active:bg-gris-linea`;
// Lo que pisa algo de BOTON lleva "!": con dos utilidades de la misma propiedad no gana la última de la clase sino la que
// Tailwind escribe después en el CSS (border-gris-linea le ganaba a border-dorado y justify-center a justify-between)
const PRIMARIO = `${BOTON} border-dorado! bg-dorado text-negro hover:bg-dorado-oscuro hover:text-blanco active:bg-dorado-oscuro active:text-blanco`;
// 16 px: con menos, el iPhone hace zoom al enfocar el campo
const INPUT =
  "min-h-11 w-full rounded-lg border border-gris-borde bg-blanco px-3 py-2 text-base";
// Las fechas llevan "!": la regla sin capa input[type="date"] de globals.css (12 px, borde claro) les gana a las utilidades
const FECHA = `${INPUT} rounded-lg! border! border-gris-borde! px-3! py-2! text-base!`;
// Importe como lo acepta el servidor (montoCentavos): sin puntos de miles y hasta 2 decimales. Vacío no se valida.
const PATRON_MONTO = "\\s*\\d{1,8}([.,]\\d{1,2})?\\s*";
const AYUDA_MONTO =
  "Solo números, sin puntos de miles; hasta 2 decimales (ej.: 1500 o 1500,50)";
type Props = {
  registros: RegistroPlan[];
  responsables: { id: string; nombre: string }[];
  esAdmin: boolean;
  responsable: string;
  hoy: string;
  ahora: string;
  prefill?: { nombre: string; telefono: string; responsable: string };
};
// "desde": se abrió desde el detalle del plan (muestra "← Volver al plan"). "version": la del plan al abrir "Editar plan".
type Modal =
  | { tipo: "nuevo" }
  | { tipo: "detalle"; id: string }
  | { tipo: "editar"; id: string; version: number; desde?: "detalle" }
  | { tipo: "abandono"; id: string; desde?: "detalle" }
  | { tipo: "pago" | "promesa"; id: string; cuota: string; desde?: "detalle" };
export function TableroCuotas({
  registros,
  responsables,
  esAdmin,
  responsable,
  hoy,
  ahora,
  prefill,
}: Props) {
  const router = useRouter();
  const [filtro, setFiltro] = useState(esAdmin ? "todos" : responsable);
  const [busqueda, setBusqueda] = useState("");
  const [vista, setVista] = useState<"pendientes" | "historial" | "abandonos">(
    "pendientes",
  );
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [modal, setModal] = useState<Modal | null>(
    prefill ? { tipo: "nuevo" } : null,
  );
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, start] = useTransition();
  // Qué cuota o plan se está guardando: solo esa tarjeta dice "Guardando…"
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const reintentos = useRef(new Map<string, string>());
  // El formulario de plan tiene cambios sin guardar: cerrarlo pide confirmación
  const sucio = useRef(false);
  const refError = useRef<HTMLParagraphElement>(null);
  const refActualizar = useRef<HTMLButtonElement>(null);
  const ayudaPago = useId();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    const enfocar = () => router.refresh();
    window.addEventListener("focus", enfocar);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", enfocar);
    };
  }, [router]);
  // El aviso de éxito se va solo a los 5 s; los errores quedan hasta cerrarlos
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 5000);
    return () => clearTimeout(t);
  }, [aviso]);
  // Si el servidor rechaza algo con el diálogo abierto, el mensaje se trae a la vista aunque se haya bajado
  useEffect(() => {
    if (!error || !modal) return;
    refError.current?.scrollIntoView({ block: "nearest" });
    refError.current?.focus({ preventScroll: true });
  }, [error, modal]);
  const nombreResponsable = (id: string) =>
    responsables.find((r) => r.id === id)?.nombre ?? "Responsable anterior";
  const hayFiltros = !!(busqueda || desde || hasta);
  // Rango "Fecha de pago desde/hasta": cuenta la fecha coordinada si la hay
  const enRango = (c: Cuota) => {
    const f = c.promesa || c.vencimiento;
    return (!desde || f >= desde) && (!hasta || f <= hasta);
  };
  const porCobrarPlan = (p: Plan) =>
    p.cuotas.reduce((n, c) => n + porCobrar(c), 0);
  const visibles = registros.filter(
    ({ plan: p }) =>
      (filtro === "todos" || p.responsable === filtro) &&
      `${p.nombre} ${p.telefono}`
        .toLowerCase()
        .includes(busqueda.toLowerCase()),
  );
  const activas = visibles.filter((r) => !r.plan.abandonado);
  // La fila "Pagado" no entra nunca en las columnas de cobro (porCobrar = 0)
  const abiertas = activas
    .flatMap((r) => r.plan.cuotas.map((c) => ({ r, c })))
    .filter(({ c }) => porCobrar(c) > 0 && enRango(c));
  const pendientes = abiertas.filter(
    ({ c }) => tarea(c, new Date(ahora))?.lista,
  );
  const proximas = abiertas.filter(
    ({ c }) => !tarea(c, new Date(ahora))?.lista,
  );
  const historial = visibles.filter((r) => r.plan.cuotas.some(enRango));
  const abandonados = visibles.filter((r) => r.plan.abandonado);
  const seleccionar = (m: Modal) => {
    setError("");
    setAviso("");
    sucio.current = false;
    setModal(m);
  };
  // Cerrar (✕ o Esc) o volver al plan con el formulario a medio cargar pide confirmación. En "Editar plan" el plan ya está
  // guardado: lo que se pierde son los cambios, no el plan
  const puedeDescartar = () =>
    !sucio.current ||
    window.confirm(
      modal?.tipo === "editar"
        ? "¿Descartar los cambios sin guardar?"
        : "¿Descartar el plan sin guardar?",
    );
  // Texto del aviso al guardar: qué se registró y en qué plan. Recibe el plan ya guardado (el que devuelve el servidor):
  // si en "Editar plan" se corrigió el nombre del cliente, el aviso dice el nuevo
  const exito = (r: RegistroPlan, c: Cambio): string => {
    const q =
      "cuota" in c ? r.plan.cuotas.find((x) => x.id === c.cuota) : undefined;
    // La fila "Pagado" no se numera (solo se le anula un pago de más, de datos viejos)
    const de = `${r.plan.nombre}${q ? ` (${q.inicial ? "Pagado" : `Cuota ${numeroDeCuota(r.plan, q)}`})` : ""}`;
    switch (c.tipo) {
      case "gestion":
        return `Aviso registrado · ${de}`;
      case "pago":
        return `Pago registrado · ${de}`;
      case "anular":
        return `Pago anulado · ${de}`;
      case "promesa":
        return c.fecha
          ? `Pago coordinado para ${fechaCorta(c.fecha)} · ${de}`
          : `Fecha prometida retirada · ${de}`;
      case "abandono":
        return `Plan marcado como abandonado · ${de}`;
      case "reactivar":
        return `Plan reactivado · ${de}`;
      case "editar":
        return `Plan actualizado · ${de}`;
    }
  };
  const ejecutar = (r: RegistroPlan, c: Cambio) => {
    setError("");
    setAviso("");
    const clave = `${r.plan.id}|${r.version}|${JSON.stringify(c)}`;
    const operacion = reintentos.current.get(clave) ?? crypto.randomUUID();
    reintentos.current.set(clave, operacion);
    setEnCurso("cuota" in c ? c.cuota : r.plan.id);
    start(async () => {
      const resultado = await actualizarPlan(
        r.plan.id,
        r.version,
        operacion,
        c,
      );
      setEnCurso(null);
      if (!resultado.ok) {
        setError(resultado.error);
        // "Este plan cambió en otra pantalla… Actualizá": se traen los datos nuevos (el formulario de edición ofrece recargarlos)
        if (/Actualizá/.test(resultado.error)) router.refresh();
        return;
      }
      sucio.current = false;
      setModal(null);
      setAviso(exito(resultado.registro, c));
      router.refresh();
    });
  };
  // Cierra el diálogo y deja el tablero limpio: sin borrador pendiente ni error viejo
  const cerrarDialogo = () => {
    sucio.current = false;
    setModal(null);
    setError("");
    // Si llegó con datos de una venta (?nuevo=si&nombre=…), se sacan de la URL: si no, vuelven en el próximo plan
    if (prefill) router.replace("/cuotas");
  };
  const actual =
    modal && "id" in modal
      ? registros.find((r) => r.plan.id === modal.id)
      : undefined;
  // El plan abierto ya no está en la lista (el socio lo pasó a otro responsable): no se escribe nada sobre él
  const perdido = !!modal && "id" in modal && !actual;
  const cuota =
    modal && "cuota" in modal
      ? actual?.plan.cuotas.find((c) => c.id === modal.cuota)
      : undefined;
  const volverAlPlan =
    modal && "desde" in modal && modal.desde === "detalle"
      ? modal.id
      : undefined;
  return (
    <div className="w-full flex-1 space-y-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-dorado-oscuro">
            Capital Jurídico · Cobros
          </p>
          <h2 className="mt-1 text-3xl font-bold">Tu tablero de cuotas</h2>
          <p className="mt-1 text-gris-texto">
            Primero hacé la gestión; después registrala.
          </p>
        </div>
        <button
          className={PRIMARIO}
          onClick={() => seleccionar({ tipo: "nuevo" })}
        >
          + Nuevo plan de pago
        </button>
      </div>
      {esAdmin && (
        <div
          role="group"
          aria-label="Responsable de cuotas"
          className="flex flex-wrap gap-2"
        >
          {[{ id: "todos", nombre: "Todo el equipo" }, ...responsables].map(
            (r) => (
              <button
                key={r.id}
                aria-pressed={filtro === r.id}
                onClick={() => setFiltro(r.id)}
                className={
                  filtro === r.id ? `${BOTON} bg-negro text-blanco` : SECUNDARIO
                }
              >
                {r.nombre}
              </button>
            ),
          )}
        </div>
      )}
      <section
        aria-label="Resumen de cuotas"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {[
          ["Gestiones de hoy", String(pendientes.length)],
          [
            "Saldo pendiente",
            dolares(activas.reduce((s, r) => s + porCobrarPlan(r.plan), 0)),
          ],
          [
            // Vencido según la fecha vigente (la coordinada, si hay): coincide con la columna Vencidas
            "Saldo vencido",
            dolares(
              activas.reduce(
                (s, r) =>
                  s +
                  r.plan.cuotas
                    .filter((c) => (c.promesa || c.vencimiento) < hoy)
                    .reduce((n, c) => n + porCobrar(c), 0),
                0,
              ),
            ),
          ],
          [
            "Cobrado",
            dolares(
              visibles.reduce(
                (s, r) => s + r.plan.cuotas.reduce((n, c) => n + cobrado(c), 0),
                0,
              ),
            ),
          ],
        ].map(([etiqueta, valor]) => (
          <div
            key={etiqueta}
            className="rounded-xl border border-gris-linea bg-blanco p-4"
          >
            <p className="text-xs font-bold uppercase text-gris-texto">
              {etiqueta}
            </p>
            {/* Espacio común entre "USD" y la cifra: si no entra, corta ahí y no en medio del número */}
            <p className="mt-2 text-xl font-bold tabular-nums text-dorado-oscuro sm:text-2xl">
              {valor.replace(/ /g, " ")}
            </p>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap items-end gap-3">
        <div
          role="group"
          aria-label="Vista de cuotas"
          className="flex flex-wrap gap-2"
        >
          {(
            [
              ["pendientes", "Pendientes"],
              ["historial", "Historial"],
              ["abandonos", "Abandonos"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={
                vista === id ? `${BOTON} bg-negro text-blanco` : SECUNDARIO
              }
              aria-pressed={vista === id}
              onClick={() => setVista(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Base de 14rem: si no entra con las fechas, la fila se parte en vez de aplastar el buscador */}
        <label className="min-w-0 grow basis-56 text-sm">
          Buscar cliente
          <input
            className={INPUT}
            type="search"
            enterKeyHint="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o teléfono"
          />
        </label>
        <label className="text-sm">
          Fecha de pago desde
          <input
            aria-label="Fecha de pago desde"
            className={FECHA}
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Hasta
          <input
            aria-label="Fecha de pago hasta"
            className={FECHA}
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>
        <button
          ref={refActualizar}
          className={SECUNDARIO}
          disabled={ocupado}
          onClick={() => start(() => router.refresh())}
        >
          {ocupado && !enCurso ? "Actualizando…" : "Actualizar"}
        </button>
        {hayFiltros && (
          <button
            className={SECUNDARIO}
            onClick={() => {
              setBusqueda("");
              setDesde("");
              setHasta("");
              // El botón desaparece al limpiar: el foco pasa al de al lado ("Actualizar") y no se pierde en la página. Al
              // buscador no: en el celular levantaría el teclado
              refActualizar.current?.focus();
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>
      {vista === "pendientes" && (
        <>
          {diaSemana(hoy) === 0 && (
            <p className="rounded-xl border border-dorado bg-blanco p-4">
              Hoy es domingo: los envíos se retoman el lunes. Podés registrar
              pagos y crear planes.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {(
              [
                ["avisar", "Avisar"],
                ["hoy", "Cobrar hoy"],
                ["vencidas", "Vencidas"],
              ] as [Grupo, string][]
            ).map(([grupo, titulo]) => {
              const filas = pendientes
                .filter(({ c }) => tarea(c, new Date(ahora))?.grupo === grupo)
                .sort((a, b) => a.c.vencimiento.localeCompare(b.c.vencimiento));
              return (
                <section
                  key={grupo}
                  className="min-w-0 rounded-xl border border-gris-linea"
                >
                  <div
                    className={`flex justify-between rounded-t-xl border-t-2 border-dorado p-4 text-blanco ${grupo === "vencidas" ? "bg-rojo" : "bg-negro"}`}
                  >
                    <h3 className="text-xl font-bold">{titulo}</h3>
                    <span>{filas.length}</span>
                  </div>
                  <div className="space-y-3 p-3">
                    {filas.length ? (
                      filas.map(({ r, c }) => (
                        <Tarjeta
                          key={c.id}
                          plan={r.plan}
                          cuota={c}
                          numero={numeroDeCuota(r.plan, c)}
                          responsable={nombreResponsable(r.plan.responsable)}
                          texto={tarea(c, new Date(ahora))!.texto}
                          ocupado={ocupado}
                          guardando={ocupado && enCurso === c.id}
                          onDetalle={() =>
                            seleccionar({ tipo: "detalle", id: r.plan.id })
                          }
                          onGestion={grupo === "avisar" ? () => ejecutar(r, { tipo: "gestion", cuota: c.id }) : undefined}
                          onPago={grupo !== "avisar" ? () => seleccionar({ tipo: "pago", id: r.plan.id, cuota: c.id }) : undefined}
                          onPromesa={() =>
                            seleccionar({
                              tipo: "promesa",
                              id: r.plan.id,
                              cuota: c.id,
                            })
                          }
                        />
                      ))
                    ) : (
                      <p className="p-4 text-center text-gris-texto">
                        {hayFiltros
                          ? "Sin resultados con estos filtros."
                          : "Todo al día en esta columna."}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <details
            className="rounded-xl border border-gris-linea bg-blanco p-4"
            open={hayFiltros}
          >
            <summary className="min-h-11 cursor-pointer text-lg font-bold">
              Próximas y listas por hoy ({proximas.length})
            </summary>
            <p className="mb-3 text-sm text-gris-texto">
              Incluye futuras, pagos coordinados y cuotas cuya gestión de hoy ya
              registraste.
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {proximas
                .sort((a, b) => a.c.vencimiento.localeCompare(b.c.vencimiento))
                .map(({ r, c }) => (
                  <Tarjeta
                    key={c.id}
                    plan={r.plan}
                    cuota={c}
                    numero={numeroDeCuota(r.plan, c)}
                    responsable={nombreResponsable(r.plan.responsable)}
                    // Un domingo la próxima gestión puede quedar en el pasado (el sábado anterior): se muestra la de hoy corrida al lunes
                    texto={`Próxima gestión: ${fechaCorta(proximaGestion(tarea(c, new Date(ahora))!.proxima, hoy))}`}
                    ocupado={ocupado}
                    guardando={ocupado && enCurso === c.id}
                    onDetalle={() =>
                      seleccionar({ tipo: "detalle", id: r.plan.id })
                    }
                    onPago={tarea(c, new Date(ahora))?.grupo !== "avisar" ? () => seleccionar({ tipo: "pago", id: r.plan.id, cuota: c.id }) : undefined}
                    onPromesa={() =>
                      seleccionar({
                        tipo: "promesa",
                        id: r.plan.id,
                        cuota: c.id,
                      })
                    }
                  />
                ))}
            </div>
          </details>
        </>
      )}
      {vista === "historial" && (
        <section className="space-y-3">
          <h3 className="text-xl font-bold">Planes y pagos registrados</h3>
          <p className="text-gris-texto">
            Abrí un plan para ver sus pagos y corregir un cobro cargado por
            error.
          </p>
          {historial.map((r) => (
            <div key={r.plan.id} className="flex flex-wrap items-stretch gap-2">
              <button
                onClick={() => seleccionar({ tipo: "detalle", id: r.plan.id })}
                className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-xl border border-gris-linea bg-blanco p-4 text-left"
              >
                <span>
                  <strong>{r.plan.nombre}</strong>
                  <span className="block text-sm text-gris-texto">
                    {nombreResponsable(r.plan.responsable)} ·{" "}
                    {r.plan.concepto === "venta"
                      ? "Venta inicial"
                      : "Renovación"}
                    {r.plan.abandonado ? " · Abandonado" : ""}
                  </span>
                </span>
                <span className="tabular-nums">
                  {dolares(r.plan.cuotas.reduce((n, c) => n + cobrado(c), 0))}{" "}
                  cobrado · {dolares(porCobrarPlan(r.plan))} saldo
                </span>
              </button>
              <BotonCopiar
                nombre={r.plan.nombre}
                texto={() => textoPlan(r.plan, nombreResponsable(r.plan.responsable))}
              />
            </div>
          ))}
          {!historial.length && <p>No hay planes con estos filtros.</p>}
        </section>
      )}
      {vista === "abandonos" && (
        <section className="space-y-3">
          <h3 className="text-xl font-bold">Planes abandonados</h3>
          {abandonados.map((r) => (
            <button
              key={r.plan.id}
              className={`${SECUNDARIO} w-full justify-between!`}
              onClick={() => seleccionar({ tipo: "detalle", id: r.plan.id })}
            >
              <span>{r.plan.nombre}</span>
              <span className="tabular-nums">
                {dolares(porCobrarPlan(r.plan))} sin cobrar
              </span>
            </button>
          ))}
          {/* Abandonos no se filtra por fecha: solo la búsqueda puede dejar la lista vacía */}
          {!abandonados.length && (
            <p>
              {busqueda
                ? "No hay planes abandonados con esta búsqueda."
                : "No hay planes abandonados."}
            </p>
          )}
        </section>
      )}
      {modal && (
        <Dialogo
          titulo={
            modal.tipo === "nuevo"
              ? "Nuevo plan de pago"
              : modal.tipo === "editar"
                ? "Editar plan"
                : modal.tipo === "pago"
                  ? "Registrar pago"
                  : modal.tipo === "promesa"
                    ? "Coordinar pago"
                    : modal.tipo === "abandono"
                      ? "Marcar abandono"
                      : (actual?.plan.nombre ?? "Plan")
          }
          // En "Editar plan" va la versión: con "Recargar datos del plan" desaparece el aviso con ese botón y el foco se vuelve a
          // ubicar como al abrir el formulario (sin ir a un campo: en el celular levantaría el teclado)
          vista={`${modal.tipo}|${"cuota" in modal ? modal.cuota : modal.tipo === "editar" ? modal.version : ""}`}
          onCerrar={() => {
            if (ocupado || !puedeDescartar()) return;
            cerrarDialogo();
          }}
          // El navegador ya lo cerró por su cuenta (no deja frenar un segundo Esc o "volver" seguido): solo se acompaña.
          // Si había un guardado en curso, su resultado sale igual en los avisos de abajo
          onCerradoPorNavegador={cerrarDialogo}
        >
          {volverAlPlan && (
            <button
              type="button"
              className={`${SECUNDARIO} mb-4`}
              disabled={ocupado}
              onClick={() => {
                if (puedeDescartar())
                  seleccionar({ tipo: "detalle", id: volverAlPlan });
              }}
            >
              ← Volver al plan
            </button>
          )}
          {perdido && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-rojo-fondo p-3 font-bold text-rojo"
            >
              Este plan ya no está en tu tablero: lo pasaron a otro responsable.
              {modal.tipo === "editar"
                ? " No se puede guardar; si necesitás lo que cargaste, usá «Copiar plan» antes de cerrar."
                : " Cerrá esta ventana."}
            </p>
          )}
          {/* Sin role="alert": al aparecer recibe el foco (efecto de arriba) y con eso el lector lo lee una sola vez */}
          {error && (
            <p
              ref={refError}
              id="error-dialogo"
              tabIndex={-1}
              className="mb-4 scroll-mt-24 font-bold text-rojo"
            >
              {error}
            </p>
          )}
          {modal.tipo === "editar" &&
            actual &&
            actual.version !== modal.version && (
              <div
                role="status"
                className="mb-4 rounded-lg border border-dorado bg-marfil p-3"
              >
                <p>
                  Otra pantalla cambió este plan mientras lo editabas. Para no
                  pisar esos cambios, recargá los datos (se pierde lo que
                  cargaste acá).
                </p>
                <button
                  type="button"
                  className={`${SECUNDARIO} mt-2`}
                  disabled={ocupado}
                  onClick={() => {
                    sucio.current = false;
                    setError("");
                    setModal({ ...modal, version: actual.version });
                  }}
                >
                  Recargar datos del plan
                </button>
              </div>
            )}
          {(modal.tipo === "nuevo" || modal.tipo === "editar") && (
            <Editor
              key={
                modal.tipo === "nuevo"
                  ? "nuevo"
                  : `${modal.id}|${modal.version}`
              }
              plan={actual?.plan}
              prefill={prefill}
              responsables={responsables}
              responsable={responsable}
              esAdmin={esAdmin}
              hoy={hoy}
              ocupado={ocupado}
              bloqueado={perdido}
              conError={!!error}
              onSucio={() => {
                sucio.current = true;
              }}
              onGuardar={(datos) => {
                setError("");
                if (modal.tipo === "editar") {
                  // Contra la versión con la que se abrió el formulario: si otra pantalla lo cambió, el servidor lo rechaza
                  if (actual)
                    ejecutar(
                      { ...actual, version: modal.version },
                      { tipo: "editar", datos },
                    );
                  return;
                }
                setEnCurso("nuevo");
                start(async () => {
                  const r = await nuevoPlan(datos);
                  setEnCurso(null);
                  if (!r.ok) {
                    setError(r.error);
                    return;
                  }
                  sucio.current = false;
                  setModal(null);
                  setAviso("Plan creado. Sus cuotas ya están en el tablero.");
                  router.replace("/cuotas");
                  router.refresh();
                });
              }}
            />
          )}
          {actual && cuota && modal.tipo === "pago" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                ejecutar(actual, {
                  tipo: "pago",
                  cuota: cuota.id,
                  monto: String(f.get("monto")),
                  fecha: String(f.get("fecha")),
                });
              }}
              className="space-y-4"
            >
              <p>
                {actual.plan.nombre} · Saldo de esta cuota:{" "}
                <strong>{dolares(saldo(cuota))}</strong>
              </p>
              <label className="block">
                Recibido en USD
                <input
                  name="monto"
                  data-autofocus
                  required
                  inputMode="decimal"
                  pattern={PATRON_MONTO}
                  title={AYUDA_MONTO}
                  aria-describedby={ayudaPago}
                  className={INPUT}
                  placeholder="Ej.: 100"
                />
              </label>
              <label className="block">
                Fecha del pago
                <input
                  name="fecha"
                  type="date"
                  required
                  defaultValue={hoy}
                  max={hoy}
                  className={FECHA}
                />
              </label>
              <p id={ayudaPago} className="text-sm text-gris-texto">
                Si el pago es parcial, el saldo seguirá pendiente. Registrá solo
                lo que efectivamente recibiste.
              </p>
              <button
                disabled={ocupado}
                aria-describedby={error ? "error-dialogo" : undefined}
                className={PRIMARIO}
              >
                {ocupado ? "Guardando…" : "Confirmar pago recibido"}
              </button>
            </form>
          )}
          {actual && cuota && modal.tipo === "promesa" && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                ejecutar(actual, {
                  tipo: "promesa",
                  cuota: cuota.id,
                  fecha: String(new FormData(e.currentTarget).get("fecha")),
                });
              }}
            >
              <p>
                El vencimiento original ({fechaCorta(cuota.vencimiento)}) se
                conserva. Los recordatorios se pausan hasta la fecha acordada.
              </p>
              <label className="block">
                Fecha prometida
                <input
                  required
                  data-autofocus
                  name="fecha"
                  type="date"
                  min={hoy}
                  defaultValue={cuota.promesa ?? hoy}
                  className={FECHA}
                />
              </label>
              <button
                disabled={ocupado}
                aria-describedby={error ? "error-dialogo" : undefined}
                className={PRIMARIO}
              >
                Guardar fecha
              </button>
              {cuota.promesa && (
                <button
                  type="button"
                  disabled={ocupado}
                  className={SECUNDARIO}
                  onClick={() =>
                    ejecutar(actual, {
                      tipo: "promesa",
                      cuota: cuota.id,
                      fecha: "",
                    })
                  }
                >
                  Quitar fecha prometida
                </button>
              )}
            </form>
          )}
          {actual && modal.tipo === "abandono" && (
            <div className="space-y-4">
              <p>
                Vas a detener el reclamo de{" "}
                <strong>
                  todas las cuotas pendientes de {actual.plan.nombre}
                </strong>
                . No se marcarán como pagadas y conservarán su historial.
              </p>
              <p>Podés reactivar el plan desde Abandonos.</p>
              <button
                disabled={ocupado}
                className={`${BOTON} bg-rojo text-blanco`}
                onClick={() => ejecutar(actual, { tipo: "abandono" })}
              >
                Confirmar abandono del servicio
              </button>
            </div>
          )}
          {actual && modal.tipo === "detalle" && (
            <div className="space-y-5">
              <p>
                {nombreResponsable(actual.plan.responsable)} ·{" "}
                {actual.plan.concepto === "venta"
                  ? "Venta inicial"
                  : "Renovación"}
                {actual.plan.abandonado ? " · Abandonado" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={SECUNDARIO}
                  disabled={ocupado}
                  onClick={() =>
                    seleccionar({
                      tipo: "editar",
                      id: actual.plan.id,
                      version: actual.version,
                      desde: "detalle",
                    })
                  }
                >
                  Editar plan
                </button>
                <BotonCopiar texto={() => textoPlan(actual.plan, nombreResponsable(actual.plan.responsable))} />
                {actual.plan.abandonado ? (
                  <button
                    className={PRIMARIO}
                    disabled={ocupado}
                    onClick={() => ejecutar(actual, { tipo: "reactivar" })}
                  >
                    Reactivar plan
                  </button>
                ) : (
                  <button
                    className={`${SECUNDARIO} text-rojo`}
                    disabled={ocupado}
                    onClick={() =>
                      seleccionar({
                        tipo: "abandono",
                        id: actual.plan.id,
                        desde: "detalle",
                      })
                    }
                  >
                    Marcar abandono
                  </button>
                )}
              </div>
              {actual.plan.notas && (
                <p className="whitespace-pre-wrap rounded-lg bg-marfil p-3">
                  {actual.plan.notas}
                </p>
              )}
              {actual.plan.cuotas.map((c) => {
                // Una cuota ya pagada no muestra la fecha coordinada (la promesa queda guardada por si se anula el pago)
                const coordinada =
                  !c.inicial && saldo(c) > 0 ? c.promesa : undefined;
                return (
                  <section
                    key={c.id}
                    className="rounded-xl border border-gris-linea p-4"
                  >
                    <h4 className="text-lg font-bold">
                      {c.inicial ? "Pagado" : `Cuota ${numeroDeCuota(actual.plan, c)} de ${cuotasAPagar(actual.plan)}`} ·{" "}
                      {dolares(c.inicial ? cobrado(c) : c.centavos)}{" "}
                      <span className="text-sm font-normal text-gris-texto">
                        · {ETIQUETA_CONCEPTO_CUOTA[c.concepto ?? (c.inicial ? "reserva" : "cuota")]}
                      </span>
                    </h4>
                    {c.inicial ? (
                      <p>Pagado el {fechaCorta(c.vencimiento)}</p>
                    ) : (
                      <p>
                        {coordinada ? "Fecha de pago original:" : "Fecha de pago:"} {fechaCorta(c.vencimiento)} ·{" "}
                        {saldo(c) > 0 ? (
                          <>Saldo {dolares(saldo(c))}</>
                        ) : (
                          <strong>Pagada</strong>
                        )}
                      </p>
                    )}
                    {coordinada && (
                      <p>Pago coordinado para {fechaCorta(coordinada)}</p>
                    )}
                    {!c.inicial && !actual.plan.abandonado && saldo(c) > 0 && (
                      <button
                        className={`${PRIMARIO} mt-2`}
                        disabled={ocupado}
                        onClick={() =>
                          seleccionar({
                            tipo: "pago",
                            id: actual.plan.id,
                            cuota: c.id,
                            desde: "detalle",
                          })
                        }
                      >
                        Registrar pago
                      </button>
                    )}
                    {c.pagos.map((p) => (
                      <div
                        key={p.id}
                        className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gris-linea pt-2 text-sm"
                      >
                        <span>
                          {fechaCorta(p.fecha)} · {dolares(p.centavos)} ·{" "}
                          {p.anulado ? "Anulado" : `Recibido por ${p.actor}`}
                        </span>
                        {/* Lo ya pagado (el pago inicial de la fila Pagado) no se anula: se corrige (o se vacía) en Editar plan.
                            Un pago de más sobre esa fila (datos de antes del 10/10) sí: es la salida si cobra de más */}
                        {c.inicial && p.id === c.id
                          ? !p.anulado && (
                              <span className="text-gris-texto">
                                Se corrige con Editar plan
                              </span>
                            )
                          : !p.anulado &&
                            (actual.plan.abandonado ? (
                              // Un pago de más que deja la fila Pagado cobrada por encima del importe traba cualquier
                              // guardado del plan, y con el plan abandonado no se anula: hay que reactivarlo primero
                              c.inicial &&
                              saldo(c) < 0 && (
                                <span className="text-gris-texto">
                                  Para anularlo, reactivá el plan
                                </span>
                              )
                            ) : (
                              <button
                                className={SECUNDARIO}
                                disabled={ocupado}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      c.inicial
                                        ? "¿Anular este registro de pago? Deja de contar como pagado y la corrección quedará en el historial."
                                        : "¿Anular este registro de pago? El saldo volverá a quedar pendiente y la corrección quedará en el historial.",
                                    )
                                  )
                                    ejecutar(actual, {
                                      tipo: "anular",
                                      cuota: c.id,
                                      pago: p.id,
                                    });
                                }}
                              >
                                Anular registro
                              </button>
                            ))}
                      </div>
                    ))}
                  </section>
                );
              })}
              <section>
                <h4 className="text-lg font-bold">
                  Historial de gestiones y cambios
                </h4>
                <ol className="mt-3 space-y-3">
                  {[...actual.plan.eventos].reverse().map((e) => (
                    <li key={e.id} className="border-l-2 border-dorado pl-3">
                      <p>{e.texto}</p>
                      <p className="text-sm text-gris-texto">
                        {new Date(e.fecha).toLocaleString("es-AR", {
                          timeZone: "America/Argentina/Buenos_Aires",
                        })}{" "}
                        · {e.actor}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </Dialogo>
      )}
      {/* Avisos y errores del tablero (sin diálogo abierto): abajo y a la vista, aunque la columna haya quedado lejos.
          En el celular, por encima de la barra de pestañas. Una región viva por mensaje, solo en el texto (los botones quedan
          afuera y no se leen) y siempre montada: vacía no ocupa lugar y el lector anuncia cada mensaje una vez */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--cj-alto-tabbar)_+_env(safe-area-inset-bottom)_+_12px)] z-40 min-[769px]:inset-x-auto min-[769px]:bottom-6 min-[769px]:right-6 min-[769px]:max-w-sm">
        <div
          className={
            !modal && error
              ? "pointer-events-auto mt-2 flex flex-wrap items-start gap-2 rounded-lg border border-rojo bg-rojo-fondo p-3 font-bold text-rojo shadow-lg"
              : undefined
          }
        >
          <p role="alert" className="min-w-0 flex-1 self-center">
            {!modal ? error : ""}
          </p>
          {!modal && error && /Actualizá/.test(error) && (
            <button
              className={SECUNDARIO}
              disabled={ocupado}
              onClick={() => {
                setError("");
                start(() => router.refresh());
              }}
            >
              Actualizar
            </button>
          )}
          {!modal && error && (
            <button
              className={SECUNDARIO}
              aria-label="Cerrar aviso"
              onClick={() => setError("")}
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
        <div
          className={
            aviso
              ? "pointer-events-auto mt-2 flex items-start gap-2 rounded-lg border border-gris-linea bg-blanco p-3 shadow-lg"
              : undefined
          }
        >
          <p role="status" className="min-w-0 flex-1 self-center">
            {aviso}
          </p>
          {aviso && (
            <button
              className={SECUNDARIO}
              aria-label="Cerrar aviso"
              onClick={() => setAviso("")}
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function Tarjeta({
  plan,
  cuota,
  numero,
  responsable,
  texto,
  ocupado,
  guardando,
  onDetalle,
  onGestion,
  onPago,
  onPromesa,
}: {
  plan: Plan;
  cuota: Cuota;
  numero: number;
  responsable: string;
  texto: string;
  ocupado: boolean;
  guardando: boolean;
  onDetalle: () => void;
  onGestion?: () => void;
  onPago?: () => void;
  onPromesa: () => void;
}) {
  // Mismo armado que el resto del dashboard: un celular argentino cargado sin el 9 ("+54 11 …") se completa a 549…; si no se
  // reconoce el formato, se usan los dígitos tal cual (como antes)
  const telefono = telefonoWhatsApp(plan.telefono) ?? plan.telefono.replace(/\D/g, "");
  return (
    <article
      aria-busy={guardando}
      className="rounded-xl border border-gris-linea border-l-4 border-l-dorado bg-blanco p-4"
    >
      <button
        onClick={onDetalle}
        className="min-h-11 text-left text-xl font-bold underline-offset-4 hover:underline"
      >
        {plan.nombre}
      </button>
      <p className="text-xs text-gris-texto">
        {responsable} · {plan.concepto === "venta" ? "Venta" : "Renovación"} ·
        Cuota {numero} de {cuotasAPagar(plan)} · {ETIQUETA_CONCEPTO_CUOTA[cuota.concepto ?? "cuota"]}
      </p>
      <p className="mt-3 text-2xl font-bold tabular-nums">{dolares(saldo(cuota))}</p>
      <p className="text-sm">
        {cuota.promesa ? "Fecha de pago original:" : "Fecha de pago:"} {fechaCorta(cuota.vencimiento)}
        {cobrado(cuota) > 0 ? ` · ${dolares(cobrado(cuota))} recibido` : ""}
      </p>
      {cuota.promesa && (
        <p className="text-sm text-dorado-oscuro">
          Pago coordinado para: {fechaCorta(cuota.promesa)}
        </p>
      )}
      <p className="my-3 font-bold">{texto}</p>
      <div className="flex flex-wrap gap-2">
        {(
          <a
            href={telefono ? `https://web.whatsapp.com/send?phone=${telefono}` : "https://web.whatsapp.com/"}
            title={telefono ? "Abrir chat del cliente" : "Sin teléfono cargado: abrir WhatsApp"}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BOTON} ${ESTILO_WHATSAPP}`}
          >
            WhatsApp <span aria-hidden>↗</span>
            <span className="sr-only"> (abre otra pestaña)</span>
          </a>
        )}
        {onGestion && (
          <button className={SECUNDARIO} disabled={ocupado} onClick={onGestion}>
            {guardando ? "Guardando…" : "Avisado"}
          </button>
        )}
        {onPago && <button className={PRIMARIO} disabled={ocupado} onClick={onPago}>
          Registrar pago
        </button>}
        <button className={SECUNDARIO} disabled={ocupado} onClick={onPromesa}>
          Coordinar fecha
        </button>
      </div>
    </article>
  );
}
function Dialogo({
  titulo,
  vista,
  onCerrar,
  onCerradoPorNavegador,
  children,
}: {
  titulo: string;
  vista: string;
  onCerrar: () => void;
  onCerradoPorNavegador: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // El listener de "close" se registra una sola vez: llama siempre a la última versión del aviso al tablero
  const cerradoPorNavegador = useRef(onCerradoPorNavegador);
  useLayoutEffect(() => {
    cerradoPorNavegador.current = onCerradoPorNavegador;
  });
  // Layout effect: showModal() corre con el contenido ya montado y close() antes de sacar el nodo, así el navegador
  // devuelve el foco al botón que abrió el diálogo
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.showModal();
    // Chrome no deja frenar dos cierres seguidos (Esc o "volver" de Android) sin un toque o tecla en el medio: el segundo
    // llega con cancelable = false y cierra el <dialog> igual. Si se cerró sin que lo pidiera el tablero, se le avisa;
    // si no, el tablero queda con el diálogo "abierto" sin verse y los botones que abren otro no hacen nada
    const alCerrarse = () => {
      if (!d.open) cerradoPorNavegador.current();
    };
    d.addEventListener("close", alCerrarse);
    return () => {
      // Primero se saca el listener: el cierre que pide el tablero (o el desmontaje de prueba de React en desarrollo) no cuenta
      d.removeEventListener("close", alCerrarse);
      d.close();
    };
  }, []);
  // Foco inicial (al abrir y al pasar, por ejemplo, del detalle a "Registrar pago"): el campo con data-autofocus
  // (React no escribe el atributo autofocus y su focus() corría antes de showModal); si no hay, el primer botón
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    const campo = d.querySelector<HTMLElement>("[data-autofocus]");
    if (campo) campo.focus();
    else if (!d.contains(document.activeElement))
      d.querySelector<HTMLElement>("button")?.focus();
  }, [vista]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Cierre que el navegador no deja frenar: no se pregunta nada (el "Cancelar" del confirm no serviría);
        // se cierra igual y el listener de "close" pone al tablero al día
        if (!e.cancelable) return;
        e.preventDefault();
        onCerrar();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-gris-linea bg-blanco p-0 text-negro shadow-2xl backdrop:bg-black/50"
    >
      {/* Título y ✕ fijos arriba: no se pierden al bajar en un plan largo. El margen va adentro y no en el <dialog>:
          con padding en el contenedor que scrollea, el sticky se pega 20 px más abajo y el contenido se ve pasar por encima */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gris-linea bg-blanco px-5 pb-3 pt-5">
        <h3 id={titleId} className="text-2xl font-bold">
          {titulo}
        </h3>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onCerrar}
          className={SECUNDARIO}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
type Fila = {
  id: string;
  fecha: string;
  monto: string;
  concepto: ConceptoCuota;
  pagado: boolean;
  conHistorial: boolean;
};
const filaVacia = (fecha: string, pagado = false): Fila => ({
  id: crypto.randomUUID(),
  fecha,
  monto: "",
  concepto: pagado ? "reserva" : "cuota",
  pagado,
  conHistorial: false,
});
const centavosDe = (monto: string) =>
  Math.round((Number(monto.replace(",", ".")) || 0) * 100);
async function copiarTexto(texto: string, origen?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(texto);
    return;
  } catch {
    // Sin permiso de portapapeles: copia a la vieja usanza. El textarea va dentro del <dialog> del botón, si lo hay:
    // con showModal() todo lo de afuera queda inerte y no se puede enfocar ni seleccionar
    const t = document.createElement("textarea");
    t.value = texto;
    t.setAttribute("readonly", "");
    t.style.position = "fixed";
    t.style.opacity = "0";
    (origen?.closest("dialog") ?? document.body).appendChild(t);
    t.focus({ preventScroll: true });
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    origen?.focus({ preventScroll: true });
    if (!ok) throw new Error("No se pudo copiar.");
  }
}
function BotonCopiar({
  texto,
  nombre,
  className = SECUNDARIO,
}: {
  texto: () => string;
  // En una lista (Historial), el cliente: el lector dice "Copiar plan de …" y no N veces "Copiar plan"
  nombre?: string;
  className?: string;
}) {
  const [estado, setEstado] = useState<"" | "ok" | string>("");
  useEffect(() => {
    if (!estado) return;
    const t = setTimeout(() => setEstado(""), 5000);
    return () => clearTimeout(t);
  }, [estado]);
  const error = estado !== "ok" ? estado : "";
  return (
    <>
      <button
        type="button"
        className={className}
        title="Copiar todo el plan (sin las notas)"
        onClick={async (e) => {
          const boton = e.currentTarget;
          try {
            await copiarTexto(texto(), boton);
            setEstado("ok");
          } catch (err) {
            setEstado(err instanceof Error ? err.message : "No se pudo copiar.");
          }
        }}
      >
        <span aria-live="polite">
          {estado === "ok" ? "✓ Copiado" : "Copiar plan"}
        </span>
        {/* Fuera de la región viva y sin aria-label en el botón: así "✓ Copiado" se sigue anunciando */}
        {nombre && estado !== "ok" && (
          <span className="sr-only"> de {nombre}</span>
        )}
      </button>
      {/* El motivo va debajo (en una fila propia si el botón está en una fila de botones), no adentro del botón */}
      {error && (
        <p role="alert" className="mt-1 basis-full text-sm font-bold text-rojo">
          {error}
        </p>
      )}
    </>
  );
}
function Editor({
  plan: planAbierto,
  prefill,
  responsables,
  responsable,
  esAdmin,
  hoy,
  ocupado,
  bloqueado,
  conError,
  onSucio,
  onGuardar,
}: {
  plan?: Plan;
  prefill?: Props["prefill"];
  responsables: Props["responsables"];
  responsable: string;
  esAdmin: boolean;
  hoy: string;
  ocupado: boolean;
  bloqueado: boolean;
  conError: boolean;
  onSucio: () => void;
  onGuardar: (d: EntradaPlan) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  // El plan tal como estaba al abrir el formulario: el refresco del tablero (cada 60 s o al volver a la ventana)
  // no cambia lo que se está editando ni vacía los campos si el plan desaparece de la lista
  const [plan] = useState(planAbierto);
  const [id] = useState(() => plan?.id ?? crypto.randomUUID());
  const [filas, setFilas] = useState<Fila[]>(() => {
    if (!plan) return [filaVacia(hoy, true), filaVacia(hoy)];
    const actuales: Fila[] = plan.cuotas.map((c) => ({
      id: c.id,
      fecha: c.vencimiento,
      monto: (c.centavos / 100).toFixed(2),
      concepto: c.concepto ?? (c.inicial ? "reserva" : "cuota"),
      pagado: !!c.inicial,
      // Igual que leerPlan: con pagos o gestiones no se quita (la fila Pagado no tiene ✕)
      conHistorial: cuotaConHistorial(c),
    }));
    // La fila "Pagado" siempre está arriba, aunque el plan no la tenga
    return actuales[0]?.pagado ? actuales : [filaVacia(hoy, true), ...actuales];
  });
  const cambiar = (idFila: string, cambio: Partial<Fila>) =>
    setFilas((f) => f.map((x) => (x.id === idFila ? { ...x, ...cambio } : x)));
  const datos = (f: FormData): EntradaPlan => ({
    id,
    nombre: String(f.get("nombre") ?? ""),
    telefono: String(f.get("telefono") ?? ""),
    responsable: String(f.get("responsable") ?? ""),
    concepto: String(f.get("concepto") ?? ""),
    notas: String(f.get("notas") ?? ""),
    cuotas: filas.map(({ id, fecha, monto, concepto, pagado }) => ({
      id,
      fecha,
      monto,
      concepto,
      pagado,
    })),
  });
  // "Ya pagado" es lo que de verdad queda cobrado en la fila Pagado al guardar: si su pago inicial quedó anulado (datos de
  // antes del 10/10), editar no lo revive y el importe no cuenta. El total suma eso, como "Copiar plan"
  const filaPagada = (f: Fila) => plan?.cuotas.find((c) => c.id === f.id);
  const pagado = filas
    .filter((c) => c.pagado)
    .reduce((s, c) => s + cobradoFilaPagado(centavosDe(c.monto), filaPagada(c)), 0);
  const total =
    filas.filter((c) => !c.pagado).reduce((s, c) => s + centavosDe(c.monto), 0) +
    pagado;
  // Si el pago inicial de la fila Pagado guardada quedó anulado, el aviso dice qué hacer según si la fila se puede quitar
  const pagadaGuardada = filas.filter((c) => c.pagado).map(filaPagada).find(Boolean);
  const avisoAnulado = pagadaGuardada
    ? avisoPagoInicialAnulado(pagadaGuardada, plan?.abandonado)
    : null;
  let numero = 0;
  return (
    <form
      ref={form}
      className="space-y-4"
      onChange={onSucio}
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar(datos(new FormData(e.currentTarget)));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Nombre del cliente
          <input
            name="nombre"
            data-autofocus={plan ? undefined : true}
            required
            maxLength={150}
            defaultValue={plan?.nombre ?? prefill?.nombre ?? ""}
            className={INPUT}
          />
        </label>
        <label>
          WhatsApp (con código de país)
          <input
            name="telefono"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="Ej.: 54 9 11 1234 5678"
            maxLength={50}
            defaultValue={plan?.telefono ?? prefill?.telefono ?? ""}
            className={INPUT}
          />
        </label>
        <label>
          Responsable
          <select
            name="responsable"
            className={INPUT}
            defaultValue={
              plan?.responsable ??
              (esAdmin &&
              responsables.some((r) => r.id === prefill?.responsable)
                ? prefill!.responsable
                : responsable)
            }
          >
            {responsables
              .filter((r) => esAdmin || r.id === responsable)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
          </select>
        </label>
        <label>
          Tipo de plan
          <select
            name="concepto"
            defaultValue={
              plan?.concepto ??
              // Desde "Crear plan de cuotas" de una venta cerrada (prefill) es venta, aunque lo abra el socio
              (prefill || responsable !== "admin" ? "venta" : "renovacion")
            }
            className={INPUT}
          >
            <option value="venta">Venta inicial</option>
            <option value="renovacion">Renovación</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-lg font-bold">Cuotas en USD</legend>
        <p className="text-sm text-gris-texto">
          Arriba anotá lo que el cliente <b>ya pagó</b>. Abajo, las cuotas que
          faltan cobrar con su importe y fecha de vencimiento.
        </p>
        <div
          aria-hidden
          className="hidden grid-cols-[5.5rem_1fr_1fr_1fr_2.75rem] gap-2 px-1 text-xs font-bold uppercase tracking-wide text-gris-texto sm:grid"
        >
          <span>Cuota</span>
          <span>Monto USD</span>
          <span>Fecha</span>
          <span>Concepto</span>
          <span />
        </div>
        {filas.map((c) => {
          const nombre = c.pagado ? "Pagado" : `Cuota ${++numero}`;
          return (
            <div
              key={c.id}
              className={`grid grid-cols-2 items-end gap-2 rounded-lg sm:grid-cols-[5.5rem_1fr_1fr_1fr_2.75rem] ${
                c.pagado ? "border border-gris-linea bg-marfil p-2" : "border border-transparent p-2"
              }`}
            >
              <span className="col-span-2 self-center text-sm font-bold sm:col-span-1">
                {nombre}
              </span>
              <label className="min-w-0 text-sm">
                <span className="sm:sr-only">Monto USD</span>
                <input
                  className={INPUT}
                  required={!c.pagado}
                  inputMode="decimal"
                  pattern={PATRON_MONTO}
                  title={AYUDA_MONTO}
                  aria-label={`${nombre}: monto en USD`}
                  value={c.monto}
                  onChange={(e) => cambiar(c.id, { monto: e.target.value })}
                />
              </label>
              <label className="min-w-0 text-sm">
                <span className="sm:sr-only">
                  {c.pagado ? "Fecha de pago" : "Vencimiento"}
                </span>
                <input
                  className={FECHA}
                  type="date"
                  required={!c.pagado || !!c.monto.trim()}
                  max={c.pagado ? hoy : undefined}
                  aria-label={`${nombre}: ${c.pagado ? "fecha de pago" : "vencimiento"}`}
                  value={c.fecha}
                  onChange={(e) => cambiar(c.id, { fecha: e.target.value })}
                />
              </label>
              <label className="min-w-0 text-sm">
                <span className="sm:sr-only">Concepto</span>
                <select
                  className={INPUT}
                  aria-label={`${nombre}: concepto`}
                  value={c.concepto}
                  onChange={(e) =>
                    cambiar(c.id, { concepto: e.target.value as ConceptoCuota })
                  }
                >
                  {CONCEPTOS_CUOTA.map((k) => (
                    <option key={k} value={k}>
                      {ETIQUETA_CONCEPTO_CUOTA[k]}
                    </option>
                  ))}
                </select>
              </label>
              {c.pagado ? (
                <span className="hidden sm:block" />
              ) : (
                <button
                  className={SECUNDARIO}
                  type="button"
                  aria-label={`Quitar ${nombre.toLowerCase()}`}
                  title={
                    c.conHistorial
                      ? "Tiene historial: no se puede quitar"
                      : "Quitar cuota"
                  }
                  disabled={c.conHistorial}
                  onClick={() => {
                    onSucio();
                    setFilas((f) => f.filter((x) => x.id !== c.id));
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className={SECUNDARIO}
          disabled={filas.length >= 60}
          onClick={() => {
            onSucio();
            // Propone el mes siguiente a la última cuota (después de la fila Pagado, hoy)
            setFilas((f) => {
              const ultima = f.at(-1);
              return [
                ...f,
                filaVacia(
                  !ultima || ultima.pagado ? hoy : sumarMes(ultima.fecha || hoy),
                ),
              ];
            });
          }}
        >
          + Agregar cuota
        </button>
        <p className="font-bold tabular-nums">
          Total del plan: {dolares(total)}
          <span className="font-normal text-gris-texto">
            {" "}
            · Ya pagado {dolares(pagado)} · A cobrar {dolares(total - pagado)}
          </span>
        </p>
        {avisoAnulado && (
          <p className="text-sm text-gris-texto">{avisoAnulado}</p>
        )}
      </fieldset>
      <label className="block">
        Notas (opcional)
        <textarea
          name="notas"
          rows={3}
          maxLength={2000}
          defaultValue={plan?.notas ?? ""}
          className={INPUT}
        />
      </label>
      <BotonCopiar
        className={`${SECUNDARIO} w-full`}
        texto={() => {
          const d = datos(new FormData(form.current ?? undefined));
          const borrador = leerPlan(d, plan);
          return textoPlan(
            borrador,
            responsables.find((r) => r.id === d.responsable)?.nombre ??
              d.responsable,
          );
        }}
      />
      <button
        disabled={ocupado || bloqueado}
        aria-describedby={conError ? "error-dialogo" : undefined}
        className={`${PRIMARIO} w-full`}
      >
        {ocupado
          ? "Guardando…"
          : plan
            ? "Guardar cambios"
            : "Crear plan de pago"}
      </button>
    </form>
  );
}
