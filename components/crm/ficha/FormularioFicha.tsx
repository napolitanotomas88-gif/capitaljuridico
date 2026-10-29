"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { guardarFicha } from "@/lib/crm/acciones";
import { TEXTO_SIN_CONEXION } from "@/components/crm/mi-dia/useEscrituras";
import type { CampoFicha, Identidad } from "@/lib/crm/contratos";
import {
  CAMPOS_GRABACION,
  CAMPOS_MONTO_FICHA,
  ETIQUETA_CAMPO,
  firmaDatosFicha,
  formularioFicha,
  fusionarFicha,
  type DatosFicha,
} from "@/lib/crm/ficha";
import { claveIdentidad } from "@/lib/crm/pantalla";
import { AvisoFilaCambiada } from "./AvisoFilaCambiada";
import {
  cambiosSinGuardar,
  claveCierreSinGuardar,
  escribirCierreSinGuardar,
  leerCierreDeOtroLead,
  type CierreSinGuardar,
} from "./cierreSinGuardar";

type Props = {
  identidad: Identidad;
  /** Lo que hoy tiene la planilla en Y, Z, AA, AD, AE, AF. */
  original: DatosFicha;
};

type Mensaje = { tipo: "ok" | "error" | "aviso"; texto: string };

/** Los campos de este formulario (AB tiene su propio bloque, `NotasReagenda`). */
const CAMPOS_FORMULARIO: readonly CampoFicha[] = [...CAMPOS_MONTO_FICHA, ...CAMPOS_GRABACION];

/** La firma de lo que edita este formulario: sin AB, así guardar las notas no lo toca. */
const firmaFormulario = (datos: DatosFicha) => firmaDatosFicha({ ...datos, datosReagenda: "" });

const CLASE_MENSAJE: Record<Mensaje["tipo"], string> = {
  error: "bg-rojo-fondo text-rojo",
  aviso: "bg-ambar-fondo text-ambar",
  ok: "border border-verde/40 bg-blanco text-verde",
};

const sinSuscripcion = () => () => {};

/**
 * Formulario de cierre de la ficha (docs/arquitectura.md §Ficha): cash día 1, cash del trato,
 * valor del servicio y las tres grabaciones. Manda solo lo que cambió a `guardarFicha` y muestra
 * el resultado. Si la planilla cambia por otro lado (p. ej. un "Cerró" desde la tarjeta de arriba),
 * los campos que no se tocaron toman los valores nuevos; lo que el closer estaba editando se
 * conserva y, si además lo cambió otro, se avisa (`fusionarFicha`).
 *
 * Lo cargado y sin guardar queda anotado en la pestaña (`cierreSinGuardar.ts`), sin volver a ponerlo
 * en los campos: si la fila pasa a ser de otro lead (planilla ordenada, nombre o teléfono corregido),
 * el formulario se monta de cero con lo suyo y avisa qué no se guardó del anterior, para cargarlo
 * donde corresponda.
 */
export function FormularioFicha({ identidad, original }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [datos, setDatos] = useState<DatosFicha>(original);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  // Lo que se guardó desde acá y todavía no volvió de la planilla (en el panel la ficha se vuelve a
  // leer un rato después): mientras tanto cuenta como lo que hay, para comparar y como `esperado`.
  const [enviado, setEnviado] = useState<Partial<DatosFicha> | null>(null);
  const base: DatosFicha = enviado ? { ...original, ...enviado } : original;
  const clave = claveCierreSinGuardar(identidad);
  const lead = claveIdentidad(identidad);
  // Lo que quedó sin guardar para el lead que estaba antes en esta fila.
  const [perdido, setPerdido] = useState<CierreSinGuardar | null>(null);

  // Si cambió lo que hay en la planilla, lo no editado toma lo nuevo y lo editado se conserva. Siempre
  // del mismo lead: si en la fila aparece otro (planilla ordenada), el `key` de ContenidoFicha
  // (`claveIdentidad`) monta un formulario nuevo con lo suyo: lo escrito para el anterior no pasa a
  // los campos del nuevo y, si quedó algo sin guardar, se avisa (`perdido`).
  const firma = firmaFormulario(original);
  const [previo, setPrevio] = useState(original);
  if (firma !== firmaFormulario(previo)) {
    const fusion = fusionarFicha(datos, enviado ? { ...previo, ...enviado } : previo, original, CAMPOS_FORMULARIO);
    setPrevio(original);
    setEnviado(null);
    setDatos(fusion.datos);
    if (fusion.conflictos.length > 0) {
      const campos = fusion.conflictos.map((c) => ETIQUETA_CAMPO[c]).join(", ");
      setMensaje({
        tipo: "aviso",
        texto: `La planilla cambió mientras editabas (${campos}): lo tuyo sigue acá. Si lo guardás, reemplaza al de la planilla; Descartar trae el de la planilla.`,
      });
    }
  }

  // Lo anotado en la pestaña se mira una sola vez, ya en el cliente (en el servidor y al hidratar no
  // hay sessionStorage).
  const enCliente = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  const [revisado, setRevisado] = useState(false);
  if (enCliente && !revisado) {
    setRevisado(true);
    setPerdido(leerCierreDeOtroLead(clave, lead));
  }

  // Se anota lo que difiere de la planilla (o de lo recién guardado); sin diferencias no queda nada.
  // Lo del lead anterior no se borra mientras está su aviso: si se recarga sin cargar nada, se vuelve a avisar.
  const sinGuardar = cambiosSinGuardar(datos, base, CAMPOS_FORMULARIO);
  const anotar = sinGuardar ? JSON.stringify(sinGuardar) : "";
  const hayPerdido = perdido !== null;
  const nombre = identidad.nombre;
  useEffect(() => {
    if (!revisado) return;
    if (anotar) escribirCierreSinGuardar(clave, { lead, nombre, cambios: JSON.parse(anotar) });
    else if (!hayPerdido) escribirCierreSinGuardar(clave, null);
  }, [revisado, anotar, hayPerdido, clave, lead, nombre]);

  const cambiar = (campo: CampoFicha) => (valor: string) => setDatos((d) => ({ ...d, [campo]: valor }));

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendiente) return;
    const resultado = formularioFicha(base, { ...datos, datosReagenda: base.datosReagenda });
    if (!resultado.ok) {
      setMensaje({ tipo: "error", texto: resultado.error });
      return;
    }
    setMensaje(null);
    iniciar(async () => {
      // `esperado`: lo que había en esos campos (al abrir o lo último guardado): si cambió, no se pisa.
      const esperado = Object.fromEntries(Object.keys(resultado.cambios).map((c) => [c, base[c as CampoFicha]]));
      let res: Awaited<ReturnType<typeof guardarFicha>>;
      try {
        res = await guardarFicha({ ...identidad, cambios: resultado.cambios, esperado });
      } catch (e) {
        // Sin conexión o la acción ya no existe (deploy nuevo): un error dentro de la transición
        // iría al error boundary y se llevaría la pantalla entera (y lo escrito). Se avisa acá.
        console.error("[ficha] guardarFicha falló:", e);
        setMensaje({ tipo: "error", texto: TEXTO_SIN_CONEXION });
        return;
      }
      if (!res.ok) {
        setMensaje({ tipo: "error", texto: res.error });
        if (res.codigo === "sin_sesion") router.push("/entrar");
        // Si en la fila ahora hay otro lead, ContenidoFicha monta un formulario nuevo (`key`) y este
        // mensaje se va con él: el nuevo avisa con lo anotado en la pestaña.
        if (res.codigo === "fila_cambiada") router.refresh();
        return;
      }
      setEnviado((previos) => ({ ...previos, ...resultado.cambios }));
      setMensaje({ tipo: "ok", texto: res.datos.logFallo ? "Guardado (sin registro en el log)." : "Guardado en la planilla." });
      router.refresh();
    });
  }

  const hayCambios = firmaFormulario(datos) !== firmaFormulario(base);

  return (
    // Columnas según el ancho del formulario y no de la ventana: en el panel de 420 px van apiladas.
    <form onSubmit={enviar} className="@container space-y-4" aria-busy={pendiente}>
      {perdido && (
        <AvisoFilaCambiada
          actual={identidad.nombre}
          anterior={perdido.nombre}
          que="lo que cargaste en el cierre"
          ayuda="Si es el mismo lead (le corrigieron el nombre o el teléfono), volvé a cargarlo acá y guardalo; si no, cargalo en su ficha."
          resumen="Ver lo que cargaste"
          onCerrar={() => setPerdido(null)}
        >
          <dl>
            {CAMPOS_FORMULARIO.filter((c) => c in perdido.cambios).map((c) => (
              <div key={c} className="py-0.5">
                <dt className="inline font-semibold">{ETIQUETA_CAMPO[c]}: </dt>
                <dd className="inline select-all wrap-anywhere">{perdido.cambios[c]?.trim() || "(lo dejaste vacío)"}</dd>
              </div>
            ))}
          </dl>
        </AvisoFilaCambiada>
      )}

      <fieldset className="grid grid-cols-1 gap-3 @md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Cierre</legend>
        {CAMPOS_MONTO_FICHA.map((campo) => (
          <label key={campo} className="block">
            <span className="mb-1 block text-sm text-gris-texto">{ETIQUETA_CAMPO[campo]}</span>
            {/* Texto y no number: muestra lo que hay en la celda aunque no sea un número y no
                convierte "1.500" en 1,5 (lo valida `formularioFicha`). */}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={datos[campo]}
              onChange={(e) => cambiar(campo)(e.target.value)}
              placeholder="—"
              className="tabular h-12 w-full rounded-xl border-2 border-gris-borde bg-blanco px-3 text-base focus:border-dorado"
            />
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">Grabaciones</legend>
        {CAMPOS_GRABACION.map((campo) => (
          <label key={campo} className="block">
            <span className="mb-1 block text-sm text-gris-texto">{ETIQUETA_CAMPO[campo]}</span>
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              maxLength={500}
              value={datos[campo]}
              onChange={(e) => cambiar(campo)(e.target.value)}
              placeholder="https://…"
              className="h-12 w-full rounded-xl border-2 border-gris-borde bg-blanco px-3 text-base focus:border-dorado"
            />
          </label>
        ))}
      </fieldset>

      {mensaje && (
        <p role={mensaje.tipo === "ok" ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm font-medium ${CLASE_MENSAJE[mensaje.tipo]}`}>
          {mensaje.tipo === "ok" && <span aria-hidden="true">✓ </span>}
          {mensaje.tipo === "aviso" && <span aria-hidden="true">⚠ </span>}
          {mensaje.texto}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setDatos(base);
            setMensaje(null);
          }}
          disabled={pendiente || !hayCambios}
          className="min-h-12 flex-1 rounded-xl border border-negro bg-blanco text-sm font-bold hover:bg-gris-fondo disabled:cursor-not-allowed disabled:opacity-40"
        >
          Descartar
        </button>
        <button
          type="submit"
          disabled={pendiente || !hayCambios}
          className="min-h-12 flex-[2] rounded-xl bg-dorado text-sm font-bold text-negro hover:bg-dorado-oscuro hover:text-blanco disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendiente ? "Guardando…" : "Guardar en la planilla"}
        </button>
      </div>
    </form>
  );
}
