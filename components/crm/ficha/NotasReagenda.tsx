"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { guardarFicha } from "@/lib/crm/acciones";
import { TEXTO_SIN_CONEXION } from "@/components/crm/mi-dia/useEscrituras";
import type { Identidad } from "@/lib/crm/contratos";
import { LARGO_MAXIMO_NOTAS, formularioFicha, fusionarValor, type DatosFicha } from "@/lib/crm/ficha";
import { claveIdentidad } from "@/lib/crm/pantalla";
import { AvisoFilaCambiada, CLASE_BOTON_AVISO } from "./AvisoFilaCambiada";
import { claveBorradorNotas, escribirBorradorNotas, leerBorradorNotas, textoAlPasar, type BorradorNotas } from "./borradorNotas";

type Props = {
  identidad: Identidad;
  /** Lo que hoy tiene la planilla en los campos de la ficha (se usa AB, "Datos de Reagenda"). */
  original: DatosFicha;
};

type Mensaje = { tipo: "ok" | "error" | "info"; texto: string };

const sinSuscripcion = () => () => {};

const CLASE_MENSAJE: Record<Mensaje["tipo"], string> = {
  error: "bg-rojo-fondo text-rojo",
  ok: "border border-verde/40 bg-blanco text-verde",
  info: "bg-gris-fondo text-negro",
};

/**
 * Espacio de notas de la ficha (pedido de Tomás, 10/10/2026): la columna AB "Datos de Reagenda"
 * se puede escribir, guardar y volver a editar cuantas veces haga falta. Guarda solo AB con
 * `guardarFicha` (sin tocar AG), con lo que había al abrir como `esperado`: si alguien la cambió
 * mientras tanto, no se pisa y se pide actualizar. Queda en el Log App.
 *
 * Lo escrito no se pierde: si la planilla cambia mientras hay un borrador (otro closer, otra pestaña,
 * el Reagendó de la tarjeta) se conserva y se avisa con lo que dice ahora; mientras se guarda el
 * textarea no se edita; y el borrador queda en la pestaña (sessionStorage) aunque se cierre el panel,
 * atado al lead (`borradorNotas.ts`). Si en esa fila ahora hay otro (planilla ordenada, nombre o
 * teléfono corregido), el borrador del anterior no se carga acá: se avisa con el texto para copiarlo
 * (o pasarlo a estas notas si es el mismo lead); de la pestaña se borra al cerrar el aviso o cuando
 * se escribe acá (hay un borrador por fila).
 */
export function NotasReagenda({ identidad, original }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const guardado = original.datosReagenda;
  const clave = claveBorradorNotas(identidad);
  const lead = claveIdentidad(identidad);
  const [texto, setTexto] = useState(guardado);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  // Lo que se guardó desde acá y todavía no volvió de la planilla (en el panel la ficha se vuelve a
  // leer un rato después): mientras tanto es lo que hay, para comparar y como `esperado`.
  const [enviado, setEnviado] = useState<string | null>(null);
  // Lo que dice la planilla cuando la cambió otro mientras había un borrador acá.
  const [ajena, setAjena] = useState<string | null>(null);
  // El borrador que quedó en la pestaña para el lead que estaba antes en esta fila (no se guardó).
  const [perdido, setPerdido] = useState<BorradorNotas | null>(null);
  const base = enviado ?? guardado;

  // Llegó otro valor de la planilla (se guardó o la cambió otro): sin borrador se toma lo nuevo; con
  // borrador se conserva y, si lo cambió otro, se avisa (`fusionarValor`). Siempre del mismo lead: si
  // en la fila aparece otro, el `key` de ContenidoFicha monta un componente nuevo.
  const [previo, setPrevio] = useState(guardado);
  if (guardado !== previo) {
    const { valor, conflicto } = fusionarValor(texto, enviado ?? previo, guardado);
    setPrevio(guardado);
    setEnviado(null);
    setTexto(valor);
    setAjena(conflicto ? guardado : null);
    if (conflicto) setMensaje(null);
  }

  // El borrador de la pestaña se busca una sola vez, ya en el cliente (en el servidor y al hidratar
  // no hay sessionStorage). Si es de este lead y distinto de la planilla, arranca con él. Si es del que
  // estaba antes en la fila, no se carga (no se puede guardar en este sin que el closer lo decida):
  // queda en el aviso, con el texto para copiarlo.
  const enCliente = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  const [revisado, setRevisado] = useState(false);
  if (enCliente && !revisado) {
    setRevisado(true);
    const lectura = leerBorradorNotas(clave, lead);
    if (lectura?.deOtroLead) {
      if (lectura.borrador.texto.trim()) setPerdido(lectura.borrador);
    } else if (lectura && lectura.borrador.texto.trim() !== guardado.trim()) {
      setTexto(lectura.borrador.texto);
      if (lectura.borrador.base.trim() !== guardado.trim()) setAjena(guardado);
      else setMensaje({ tipo: "info", texto: "Borrador sin guardar recuperado." });
    }
  }

  const hayCambios = texto.trim() !== base.trim();

  // Sin cambios (igual a la planilla o a lo recién guardado) no queda borrador en la pestaña. El del
  // lead anterior no se borra mientras está su aviso: si se recarga sin escribir nada, se vuelve a avisar.
  useEffect(() => {
    if (revisado && !hayCambios && !perdido) escribirBorradorNotas(clave, null);
  }, [revisado, hayCambios, perdido, clave]);

  /** El closer dice que es el mismo lead (le corrigieron el nombre o el teléfono): lo trae acá. */
  function pasarPerdido() {
    if (!perdido) return;
    const nuevo = textoAlPasar(perdido.texto, texto, base);
    setTexto(nuevo);
    setPerdido(null);
    setMensaje(null);
    // Si la planilla dice otra cosa que lo que había cuando se escribió, se avisa como con un borrador propio.
    setAjena(perdido.base.trim() !== base.trim() ? base : null);
    escribirBorradorNotas(clave, nuevo.trim() === base.trim() ? null : { texto: nuevo, base, lead, nombre: identidad.nombre });
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendiente) return;
    const resultado = formularioFicha({ ...original, datosReagenda: base }, { ...original, datosReagenda: texto });
    if (!resultado.ok) {
      setMensaje({ tipo: "error", texto: resultado.error });
      return;
    }
    const nueva = resultado.cambios.datosReagenda ?? "";
    setMensaje(null);
    iniciar(async () => {
      let res: Awaited<ReturnType<typeof guardarFicha>>;
      try {
        res = await guardarFicha({ ...identidad, cambios: resultado.cambios, esperado: { datosReagenda: base } });
      } catch (e) {
        console.error("[ficha] notas de reagenda:", e);
        setMensaje({ tipo: "error", texto: TEXTO_SIN_CONEXION });
        return;
      }
      if (!res.ok) {
        // Con fila_cambiada llega la AB nueva: si es el mismo lead, el borrador se conserva (arriba) y no
        // se pierde lo escrito; si en la fila ahora hay otro, ContenidoFicha vuelve a montar las notas
        // con las suyas (`key`): lo escrito para el anterior no se guarda en este y se avisa (el
        // borrador de la pestaña), con el texto para copiarlo.
        setMensaje({ tipo: "error", texto: res.error });
        if (res.codigo === "sin_sesion") router.push("/entrar");
        if (res.codigo === "fila_cambiada") router.refresh();
        return;
      }
      setEnviado(nueva);
      setAjena(null);
      escribirBorradorNotas(clave, null);
      setMensaje({ tipo: "ok", texto: res.datos.logFallo ? "Notas guardadas (sin registro en el log)." : "Notas guardadas en la planilla." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-3" aria-busy={pendiente}>
      {perdido && (
        <AvisoFilaCambiada
          actual={identidad.nombre}
          anterior={perdido.nombre}
          que="lo que escribiste en las notas"
          ayuda="Si es el mismo lead (le corrigieron el nombre o el teléfono), pasalo a estas notas y guardalo; si no, copialo y guardalo en su ficha."
          resumen="Ver lo que escribiste"
          acciones={
            <button type="button" onClick={pasarPerdido} disabled={pendiente} className={`${CLASE_BOTON_AVISO} disabled:cursor-not-allowed disabled:opacity-40`}>
              Pasarlo a estas notas
            </button>
          }
          onCerrar={() => setPerdido(null)}
        >
          <p className="whitespace-pre-wrap select-all wrap-anywhere">{perdido.texto}</p>
        </AvisoFilaCambiada>
      )}

      {ajena !== null && hayCambios && (
        <div role="alert" className="rounded-lg bg-ambar-fondo px-3 py-2 text-sm text-ambar">
          <p className="font-medium">
            ⚠ La nota cambió en la planilla mientras escribías. Tu texto sigue acá: si lo guardás, reemplaza al de la
            planilla; Descartar trae el de la planilla.
          </p>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-2">
              Ver lo que dice ahora la planilla
            </summary>
            <p className="whitespace-pre-wrap pb-1 text-negro wrap-anywhere">{ajena.trim() || "(vacía)"}</p>
          </details>
        </div>
      )}

      <label className="block">
        <span className="sr-only">Notas de la reagenda</span>
        <textarea
          value={texto}
          onChange={(e) => {
            const valor = e.target.value;
            setTexto(valor);
            if (mensaje && mensaje.tipo !== "error") setMensaje(null);
            escribirBorradorNotas(clave, valor.trim() === base.trim() ? null : { texto: valor, base, lead, nombre: identidad.nombre });
          }}
          // Mientras se guarda no se edita: lo que se escriba ahí no iría en este guardado.
          readOnly={pendiente}
          rows={Math.min(16, Math.max(6, Math.ceil(texto.length / 45) + texto.split("\n").length))}
          maxLength={LARGO_MAXIMO_NOTAS}
          placeholder="Escribí acá lo que haga falta: qué se habló, cuándo volver a llamar, lo que pidió…"
          className="w-full resize-y rounded-xl border-2 border-gris-borde bg-blanco px-3 py-2 text-base leading-relaxed focus:border-dorado read-only:bg-gris-fondo"
        />
      </label>

      {mensaje && (
        <p role={mensaje.tipo === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm font-medium ${CLASE_MENSAJE[mensaje.tipo]}`}>
          {mensaje.tipo === "ok" && <span aria-hidden="true">✓ </span>}
          {mensaje.texto}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setTexto(base);
            setMensaje(null);
            setAjena(null);
            escribirBorradorNotas(clave, null);
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
          {pendiente ? "Guardando…" : "Guardar notas"}
        </button>
      </div>
    </form>
  );
}
