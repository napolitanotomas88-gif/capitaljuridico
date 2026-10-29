import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BotonGuia } from "@/components/crm/BotonGuia";
import { BotonMensajes } from "@/components/crm/BotonMensajes";
import { BotonActualizar } from "@/components/crm/admin/BotonActualizar";
import {
  INDICADORES_CLOSER,
  PERIODOS,
  formatearMonto,
  leerPeriodo,
  sumarIndicadores,
  valorIndicador,
  type Indicador,
  type Metricas,
} from "@/lib/crm/admin";
import { requerirAdmin } from "@/lib/crm/auth";
import { spreadsheetId } from "@/lib/crm/config";
import { conDiagnostico } from "@/lib/crm/errores";
import { formatearFechaLarga } from "@/lib/crm/fechas";
import { ETIQUETA_CAMPO } from "@/lib/crm/ficha";
import { tableroAdmin, type ResumenCloser } from "@/lib/crm/mi-dia";
import { hrefFicha } from "@/lib/crm/pantalla";
import type { Campo } from "@/lib/crm/sheets/columnas";

export const metadata: Metadata = { title: "Admin" };

const TITULO_SECCION = "text-xs font-bold uppercase tracking-wide text-gris-texto";
const BOTON_VER_DIA =
  "inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-dorado px-3 text-sm font-bold text-negro hover:bg-dorado-oscuro hover:text-blanco";
const BOTON_BARRA = "flex h-11 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold hover:bg-white/10";

const hrefDia = (c: ResumenCloser) => `/ventas/closer/${encodeURIComponent(c.id)}`;

/** Clase del número de un indicador: dorado si hay algo que mirar, gris si es 0. */
function claseValor(destacar: boolean | undefined, valor: number): string {
  if (destacar && valor > 0) return "font-bold text-dorado-oscuro";
  return valor === 0 ? "text-gris-texto" : "";
}

/**
 * Tablero del admin (docs/diseno.md §Admin): totales del equipo, una fila por closer con los
 * conteos de hoy y "Ver su día" (tabla en la computadora, tarjetas en el celular), métricas de
 * 7 / 30 días (solo conteos y sumas, sin tasas; solo lectura de las hojas), la actividad reciente
 * del "Log App" y los links a la planilla y al doc de mensajes. A todo el ancho en la computadora.
 * Un solo batchGet para las cuatro hojas.
 */
export default async function PaginaAdmin({ searchParams }: PageProps<"/ventas/admin">) {
  await requerirAdmin();
  const dias = leerPeriodo((await searchParams).dias);
  const ahora = new Date();
  const { equipo, totales, metricasEquipo, actividad } = await conDiagnostico(tableroAdmin(ahora, dias));
  const totalesPorIndicador = sumarIndicadores(equipo);
  const urlPlanilla = `https://docs.google.com/spreadsheets/d/${spreadsheetId()}`;

  return (
    <div className="flex flex-1 flex-col">
      <header className="marca-barra sticky top-0 z-30 bg-negro text-blanco" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center lg:gap-4 lg:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight">Equipo</h1>
            <p className="text-sm leading-snug text-white/80 first-letter:uppercase">{formatearFechaLarga(ahora)}</p>
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 self-end sm:self-auto">
            <BotonActualizar generado={ahora.toISOString()} />
            <a href={urlPlanilla} target="_blank" rel="noopener noreferrer" className={BOTON_BARRA}>
              <span className="lg:hidden">Planilla</span>
              <span className="hidden lg:inline">Abrir la planilla ↗</span>
            </a>
            <BotonMensajes />
            <BotonGuia />
          </div>
        </div>
      </header>

      {/* div y no main: el main es el del shell. pb-28: en el celular la barra de secciones (fija abajo) no tapa el final. */}
      <div className="w-full flex-1 space-y-8 px-4 pb-28 pt-5 lg:px-6 lg:pb-5">
        <section aria-label="Totales del equipo hoy" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Total etiqueta="Pendientes" valor={totales.pendientes} />
          <Total etiqueta="Atrasados" valor={totales.atrasados} destacar />
          <Total etiqueta="Calls de hoy" valor={totales.callsHoy} />
          <Total etiqueta="Hechas hoy" valor={totales.hechasHoy} />
        </section>

        <section aria-labelledby="titulo-closers">
          <h2 id="titulo-closers" className={`mb-2 ${TITULO_SECCION}`}>
            Hoy, por closer
          </h2>

          {/* Computadora: una fila por closer. */}
          <div className="hidden overflow-x-auto rounded-2xl border border-gris-linea bg-blanco lg:block">
            <table className="w-full text-sm">
              <thead className="bg-negro text-xs text-blanco">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left align-bottom uppercase tracking-wide">
                    Closer
                  </th>
                  {INDICADORES_CLOSER.map((i) => (
                    <th key={i.id} scope="col" className="px-2 py-3 text-right align-bottom font-semibold leading-tight">
                      {i.etiqueta}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Ver su día</span>
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {equipo.map((c) => (
                  <tr key={c.id} className="border-t border-gris-linea hover:bg-gris-fondo/60">
                    <th scope="row" className="px-4 py-2 text-left font-semibold">
                      {c.nombre}
                      {c.hoja !== c.nombre && <span className="block text-xs font-normal text-gris-texto">{c.hoja}</span>}
                    </th>
                    {INDICADORES_CLOSER.map((i) => {
                      const valor = valorIndicador(c, i.id);
                      return (
                        <td key={i.id} className={`px-2 py-2 text-right text-base ${claseValor(i.destacar, valor)}`}>
                          {valor}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right">
                      <Link href={hrefDia(c)} className={BOTON_VER_DIA}>
                        Ver su día
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular">
                <tr className="border-t-2 border-negro bg-gris-fondo font-bold">
                  <th scope="row" className="px-4 py-3 text-left">
                    Equipo
                  </th>
                  {INDICADORES_CLOSER.map((i) => (
                    <td key={i.id} className="px-2 py-3 text-right text-base">
                      {totalesPorIndicador[i.id]}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Celular: una tarjeta por closer. */}
          <ul className="space-y-3 lg:hidden">
            {equipo.map((c) => (
              <li
                key={c.id}
                className={`rounded-2xl border border-l-4 border-gris-linea bg-blanco p-4 ${c.atrasados > 0 ? "border-l-dorado" : "border-l-negro"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold">{c.nombre}</h3>
                    <p className="tabular text-sm">
                      <span className="font-bold">{c.pendientes}</span> pendientes ·{" "}
                      <span className={claseValor(true, c.atrasados)}>{c.atrasados}</span> atrasados
                    </p>
                  </div>
                  <Link href={hrefDia(c)} className={BOTON_VER_DIA}>
                    Ver su día
                  </Link>
                </div>
                <IndicadoresCompactos c={c} />
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-gris-texto">
            Pendientes y cada grupo cuentan tarjetas de hoy (lo mismo que el closer ve en su tablero): los grupos suman los
            pendientes, y un lead puede sumar en Pre-call y en otra columna. Los seguimientos atrasados siguen en su grupo
            (no-shows y post-calls en curso) y suman en atrasados. Los pre-calls a los que hoy ya se les mandó una fase y
            cuya siguiente puede esperar a mañana (&ldquo;Listo por hoy&rdquo;) no cuentan como pendientes, igual que los no-shows y post-calls con el seguimiento coordinado para otro día. Hechas hoy:
            acciones de tarjetas desde la app en su hoja, sin las deshechas ni las del admin (los guardados de la ficha no cuentan).
          </p>
        </section>

        <section aria-labelledby="titulo-metricas">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 id="titulo-metricas" className={TITULO_SECCION}>
              Resultados de los últimos {dias} días
            </h2>
            <nav aria-label="Período" className="flex rounded-lg border border-gris-borde bg-blanco p-0.5">
              {PERIODOS.map((p) => (
                <Link
                  key={p}
                  href={p === 7 ? "/ventas/admin" : `/ventas/admin?dias=${p}`}
                  scroll={false}
                  aria-current={p === dias ? "page" : undefined}
                  className={`flex h-11 min-w-20 items-center justify-center rounded-md px-3 text-sm font-semibold ${
                    p === dias ? "bg-negro text-blanco" : "text-gris-texto hover:text-negro"
                  }`}
                >
                  {p} días
                </Link>
              ))}
            </nav>
          </div>

          <dl className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi etiqueta="Calls agendadas" valor={String(metricasEquipo.calls)} />
            <Kpi etiqueta="Se presentaron" valor={String(metricasEquipo.presentaron)} />
            <Kpi etiqueta="Cerrados" valor={String(metricasEquipo.cerrados)} />
            <Kpi etiqueta="Cash collected" valor={formatearMonto(metricasEquipo.cashCollected)} />
            <Kpi etiqueta="Valor del servicio" valor={formatearMonto(metricasEquipo.valorServicio)} />
          </dl>

          <div className="overflow-x-auto rounded-2xl border border-gris-linea bg-blanco">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Métricas por closer de los últimos {dias} días</caption>
              <thead className="bg-negro text-xs text-blanco">
                <tr>
                  <th scope="col" className="sticky left-0 bg-negro px-4 py-3 text-left uppercase tracking-wide">
                    Closer
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Calls agendadas</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Se presentaron</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Cerrados</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Cash collected</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Valor del servicio</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {equipo.map((c) => (
                  <FilaMetricas key={c.id} nombre={c.nombre} m={c.metricas} />
                ))}
                <FilaMetricas nombre="Equipo" m={metricasEquipo} total />
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gris-texto">
            Calls de la columna D del período que ya pasaron. Se presentaron: R o T = Si. Cerrados: &ldquo;Cerrado en
            llamada&rdquo; o &ldquo;Cerrado en seguimiento&rdquo;. Cash collected: Y + Z. Valor del servicio: AA.
          </p>
        </section>

        <section aria-labelledby="titulo-actividad">
          <h2 id="titulo-actividad" className={`mb-2 ${TITULO_SECCION}`}>
            Actividad reciente
          </h2>
          <div className="rounded-2xl border border-gris-linea bg-blanco">
            {actividad.length === 0 ? (
              <p className="px-4 py-5 text-sm text-gris-texto">Todavía no hay acciones registradas desde la app.</p>
            ) : (
              <ul className="divide-y divide-gris-linea text-sm">
                {actividad.map((e, i) => (
                  <li
                    key={`${e.operacion}-${e.columna}-${i}`}
                    className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 lg:grid-cols-[11rem_9rem_minmax(0,1fr)] lg:items-baseline"
                  >
                    <span className="tabular text-xs text-gris-texto">{e.fecha}</span>
                    <span className="font-semibold">{e.closer}</span>
                    <span className="min-w-0 wrap-anywhere">
                      {e.fichaVigente ? (
                        <Link
                          href={hrefFicha({ hoja: e.hoja, numeroFila: e.fila })}
                          className="-my-3 inline-block py-3 font-semibold text-dorado-oscuro underline underline-offset-2"
                        >
                          {e.lead || `${e.hoja} fila ${e.fila}`}
                        </Link>
                      ) : (
                        // El lead ya no está en esa fila (se insertaron u ordenaron filas): el link abriría otro.
                        <span className="font-semibold">
                          {e.lead || `${e.hoja} fila ${e.fila}`}{" "}
                          <span className="text-xs font-normal text-gris-texto">(ya no está en la fila {e.fila})</span>
                        </span>
                      )}{" "}
                      · {ETIQUETA_CAMPO[e.campo as Campo] ?? e.columna}: {e.antes || "—"} →{" "}
                      <span className="font-semibold">{e.despues || "—"}</span>
                      {e.motivo && <span className="block text-xs text-gris-texto">{e.motivo}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-gris-texto">Las últimas 30 celdas escritas desde la app (hoja &ldquo;Log App&rdquo;), la más nueva primero.</p>
        </section>
      </div>
    </div>
  );
}

function Total({ etiqueta, valor, destacar }: { etiqueta: string; valor: number; destacar?: boolean }) {
  const alerta = destacar && valor > 0;
  return (
    <div className={`rounded-2xl border border-l-4 border-gris-linea bg-blanco px-4 py-3 ${alerta ? "border-l-dorado" : "border-l-negro"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gris-texto">{etiqueta}</p>
      <p className={`font-titulo tabular text-3xl font-bold leading-tight ${alerta ? "text-dorado-oscuro" : ""}`}>{valor}</p>
    </div>
  );
}

function Kpi({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gris-linea bg-blanco px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gris-texto">{etiqueta}</dt>
      <dd className="font-titulo tabular text-2xl font-bold leading-tight">{valor}</dd>
    </div>
  );
}

/** En el celular: los grupos del día y "hechas hoy" en dos columnas (pendientes y atrasados van arriba). */
function IndicadoresCompactos({ c }: { c: ResumenCloser }) {
  const arriba: readonly Indicador[] = ["pendientes", "atrasados"];
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 text-sm">
      {INDICADORES_CLOSER.filter((i) => !arriba.includes(i.id)).map((i) => {
        const valor = valorIndicador(c, i.id);
        return (
          <div key={i.id} className="flex items-baseline justify-between gap-2 border-b border-gris-linea py-1.5">
            <dt className="text-gris-texto">{i.etiqueta}</dt>
            <dd className={`tabular text-base ${claseValor(i.destacar, valor) || "font-semibold"}`}>{valor}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function FilaMetricas({ nombre, m, total }: { nombre: string; m: Metricas; total?: boolean }) {
  const fondo = total ? "bg-gris-fondo" : "bg-blanco";
  return (
    <tr className={`border-t border-gris-linea ${total ? "border-t-2 border-t-negro font-bold" : ""}`}>
      <th scope="row" className={`sticky left-0 px-4 py-3 text-left font-semibold ${fondo}`}>
        {nombre}
      </th>
      <td className={`px-3 py-3 text-right ${fondo}`}>{m.calls}</td>
      <td className={`px-3 py-3 text-right ${fondo}`}>{m.presentaron}</td>
      <td className={`px-3 py-3 text-right ${fondo}`}>{m.cerrados}</td>
      <td className={`px-3 py-3 text-right ${fondo}`}>{formatearMonto(m.cashCollected)}</td>
      <td className={`px-3 py-3 text-right ${fondo}`}>{formatearMonto(m.valorServicio)}</td>
    </tr>
  );
}
