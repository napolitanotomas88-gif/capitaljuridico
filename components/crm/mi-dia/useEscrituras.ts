"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelarReunion, deshacerAccion, deshacerOperacion, ejecutarAccion } from "@/lib/crm/acciones";
import type { Cambios, ItemCliente, OperacionHecha, Resultado } from "@/lib/crm/contratos";
import type { Boton, Pedido } from "@/lib/crm/motor/proxima-accion";
import { VALORES } from "@/lib/crm/config/crm";
import { claveOculta, esperadoPara, motivoDe, mostrarLead, podarOcultas, tipoDelMotivo } from "@/lib/crm/pantalla";
import type { EstadoToast } from "./Toast";

// El comportamiento optimista de los botones de una tarjeta (docs/arquitectura.md §Pantalla),
// compartido por "Mi día", el panel de la ficha y la página de la ficha: al tocar, la tarjeta
// desaparece al instante, un toast ofrece Deshacer 5 s y, si la escritura falla, vuelve con el
// error. Los botones con `pide` abren la hoja inferior (el `modal`) y confirman desde ahí.

export type Modal = { item: ItemCliente; boton: Boton & { pide: Pedido } } | null;
export type ToastOk = Extract<EstadoToast, { tipo: "ok" }>;

const DURACION_TOAST_MS = 5_000;
const DURACION_ERROR_MS = 8_000;
/**
 * Después de confirmar, los botones de las tarjetas no responden por un momento: la tarjeta
 * hecha desaparece y la de abajo sube justo donde estaba el dedo; un doble toque no la ejecuta.
 */
export const BLOQUEO_DOBLE_TOQUE_MS = 600;

export const TEXTO_SIN_CONEXION = "No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.";
export const TEXTO_FILA_CAMBIADA = "Alguien cambió esta fila; actualicé la lista.";

/** Una server action que falla por red (o por cualquier cosa que no devuelva `Resultado`) no rompe la pantalla. */
async function llamar<T>(accion: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await accion();
  } catch (e) {
    console.error("[mi-día] la server action falló:", e);
    return { ok: false, error: TEXTO_SIN_CONEXION, codigo: "api" };
  }
}

function conjunto(previo: ReadonlySet<string>, clave: string, agregar: boolean): ReadonlySet<string> {
  if (previo.has(clave) === agregar) return previo;
  const nuevo = new Set(previo);
  if (agregar) nuevo.add(clave);
  else nuevo.delete(clave);
  return nuevo;
}

export type Escrituras = {
  /** true si esa acción ya se hizo (optimista) y no hay que mostrarla. */
  estaOculto: (item: ItemCliente) => boolean;
  /**
   * Claves de leads (`hoja:fila`) con una escritura en curso: se deshabilitan los botones de todas
   * sus tarjetas (un lead puede tener dos, pre-call y principal; la fila está cambiando).
   */
  enCurso: ReadonlySet<string>;
  /** Error de la última escritura de esa tarjeta (volvió con el error). */
  errorDe: (item: ItemCliente) => string | undefined;
  toast: EstadoToast | null;
  modal: Modal;
  /** Un botón de la tarjeta: directo si escribe solo, o abre la hoja inferior si `pide` datos. */
  alTocarBoton: (item: ItemCliente, boton: Boton) => void;
  /** Escribe `cambios` (lo llama la hoja inferior con el formulario ya validado). */
  confirmar: (item: ItemCliente, boton: Boton, cambios: Cambios, detalle?: string) => Promise<void>;
  /** Deshacer del toast (5 s): restaura `antes` si la fila todavía tiene `despues`. */
  deshacer: (estado: ToastOk) => Promise<void>;
  /** Deshacer desde "Hechas hoy": busca la operación en "Log App" por su id. */
  deshacerHecha: (op: OperacionHecha) => Promise<void>;
  cerrarModal: () => void;
  /**
   * Bandera roja (circulito de la esquina de las tarjetas de Pre-call): la prende o la apaga sin sacar la tarjeta de la lista
   * ni mostrar el toast. true si se guardó; si no, avisa el error y la tarjeta vuelve a como estaba.
   */
  alternarBandera: (item: ItemCliente, marcar: boolean) => Promise<boolean>;
};

/**
 * `items`: la lista que vino del servidor. Cuando llega una nueva (después de escribir, al
 * actualizar o al volver a la pestaña), las tarjetas ocultas que el servidor ya no muestra se
 * olvidan (`podarOcultas`), así el set no crece ni esconde una acción de otro día.
 */
export function useEscrituras(items?: readonly ItemCliente[]): Escrituras {
  const router = useRouter();
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(() => new Set());
  const [enCurso, setEnCurso] = useState<ReadonlySet<string>>(() => new Set());
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<EstadoToast | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Síncronos (el estado tarda un render): dos toques seguidos no mandan dos escrituras.
  const ocupados = useRef(new Set<string>());
  const bloqueoHasta = useRef(0);

  const [itemsPrevios, setItemsPrevios] = useState(items);
  if (items !== itemsPrevios) {
    setItemsPrevios(items);
    if (items) setOcultas((p) => podarOcultas(p, items));
  }

  // El toast se va solo: 5 s si salió bien, un poco más si es un error o si fue un Olvidar (saca al
  // lead de la lista: más tiempo para deshacerlo).
  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (!toast || toast.tipo === "guardando" || toast.tipo === "deshaciendo") return;
    const largo = toast.tipo === "error" || (toast.tipo === "ok" && toast.motivo.endsWith("· Olvidar"));
    temporizador.current = setTimeout(() => setToast(null), largo ? DURACION_ERROR_MS : DURACION_TOAST_MS);
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [toast]);

  const ocupar = useCallback((clave: string, si: boolean) => {
    if (si) ocupados.current.add(clave);
    else ocupados.current.delete(clave);
    setEnCurso((p) => conjunto(p, clave, si));
  }, []);

  /**
   * Errores comunes a todas las escrituras: sin sesión al login; fila cambiada, lista nueva. Al
   * deshacer (`delServidor`) se muestra el texto del servidor ("El lead cambió después de la
   * acción…"), que dice qué columna cambió en vez de culpar a "alguien".
   */
  const avisarError = useCallback(
    (resultado: Extract<Resultado<unknown>, { ok: false }>, delServidor = false) => {
      const texto = resultado.codigo === "fila_cambiada" && !delServidor ? TEXTO_FILA_CAMBIADA : resultado.error;
      setToast({ tipo: "error", texto });
      if (resultado.codigo === "sin_sesion") router.push("/entrar");
      if (resultado.codigo === "fila_cambiada") router.refresh();
    },
    [router],
  );

  const confirmar = useCallback(
    async (item: ItemCliente, boton: Boton, cambios: Cambios, detalle?: string) => {
      const clave = item.clave;
      const oculta = claveOculta(item);
      if (ocupados.current.has(clave)) return;
      bloqueoHasta.current = Date.now() + BLOQUEO_DOBLE_TOQUE_MS;
      const motivo = motivoDe(item.accion.tipo, boton, detalle);
      const nombre = item.identidad.nombre.trim();

      setModal(null);
      ocupar(clave, true);
      setOcultas((p) => conjunto(p, oculta, true));
      setErrores((e) => {
        const { [oculta]: borrado, ...resto } = e;
        return borrado === undefined ? e : resto;
      });
      setToast({ tipo: "guardando", texto: nombre });

      // `esperado`: lo que tenían esas celdas al armar la tarjeta. Si alguien las cambió, no se pisa.
      const esperado = esperadoPara(item.valores, cambios);
      // "Cancelar reunión" cancela además en Calendly (otra server action)
      const cancela = boton.pide === "cancelacion";
      const resultado = await llamar(() => (cancela ? cancelarReunion : ejecutarAccion)({ ...item.identidad, cambios, esperado, motivo }));
      ocupar(clave, false);

      if (!resultado.ok) {
        // La tarjeta vuelve con el error.
        setOcultas((p) => conjunto(p, oculta, false));
        setErrores((e) => ({ ...e, [oculta]: resultado.error }));
        avisarError(resultado);
        return;
      }

      // Sin Deshacer: volver la fila atrás no devolvería la reunión en Calendly.
      if (cancela) {
        setToast({ tipo: "info", texto: `Reunión cancelada · ${nombre}` });
        router.refresh();
        return;
      }

      // Qué se hizo y a quién: "Listo · Juan · Olvidar".
      const listo = ["Listo", nombre, boton.etiqueta].filter(Boolean).join(" · ");
      setToast({
        tipo: "ok",
        texto: resultado.datos.logFallo ? `${listo} (sin registro en el log)` : listo,
        item,
        operacion: resultado.datos,
        motivo,
      });
      // En segundo plano, para que aparezca la siguiente acción del mismo lead si la hay
      // (p. ej. "¿Se presentó? Sí" → "Cargar resultado"). La tarjeta ya no está.
      router.refresh();
    },
    [ocupar, avisarError, router],
  );

  const deshacer = useCallback(
    async (estado: ToastOk) => {
      const { item, operacion, motivo } = estado;
      if (ocupados.current.has(item.clave)) return;
      ocupar(item.clave, true);
      setToast({ tipo: "deshaciendo" });

      const resultado = await llamar(() =>
        deshacerAccion({ ...item.identidad, restaurar: operacion.antes, esperado: operacion.despues, motivo, firma: operacion.firma ?? "" }),
      );
      ocupar(item.clave, false);

      if (!resultado.ok) {
        avisarError(resultado, true);
        return;
      }
      setOcultas((p) => conjunto(p, claveOculta(item), false));
      setToast({ tipo: "info", texto: `Deshecho · ${item.identidad.nombre.trim()}` });
      router.refresh();
    },
    [ocupar, avisarError, router],
  );

  const deshacerHecha = useCallback(
    async (op: OperacionHecha) => {
      const clave = `${op.hoja}:${op.fila}`;
      if (ocupados.current.has(clave)) return;
      ocupar(clave, true);
      setToast({ tipo: "deshaciendo" });

      const resultado = await llamar(() => deshacerOperacion(op.idOperacion));
      ocupar(clave, false);

      if (!resultado.ok) {
        avisarError(resultado, true);
        return;
      }
      // Vuelve la tarjeta de esa operación (su tipo sale del motivo del log). La otra tarjeta del
      // lead no se deshizo: sigue oculta hasta que la lista nueva la saque.
      setOcultas((p) => mostrarLead(p, clave, tipoDelMotivo(op.motivo)));
      setToast({ tipo: "info", texto: `Deshecho · ${op.lead.trim() || `Fila ${op.fila}`}` });
      router.refresh();
    },
    [ocupar, avisarError, router],
  );

  const alTocarBoton = useCallback(
    (item: ItemCliente, boton: Boton) => {
      if (Date.now() < bloqueoHasta.current) return;
      if (boton.pide) setModal({ item, boton: boton as Boton & { pide: Pedido } });
      else void confirmar(item, boton, boton.cambios);
    },
    [confirmar],
  );

  const alternarBandera = useCallback(
    async (item: ItemCliente, marcar: boolean) => {
      // `esperado` es el estado que mostraba el circulito (no `item.valores`, que puede ser de antes del último toque)
      const cambios: Cambios = { banderaRoja: marcar ? VALORES.si : "" };
      const esperado: Cambios = { banderaRoja: marcar ? "" : VALORES.si };
      // "BANDERA · …" no es un tipo de acción: no suma en el progreso del día (`sumaEnProgreso`)
      const motivo = marcar ? "BANDERA · Marcar bandera roja" : "BANDERA · Quitar bandera roja";
      const resultado = await llamar(() => ejecutarAccion({ ...item.identidad, cambios, esperado, motivo }));
      if (!resultado.ok) {
        avisarError(resultado);
        return false;
      }
      router.refresh();
      return true;
    },
    [avisarError, router],
  );

  const cerrarModal = useCallback(() => setModal(null), []);
  const estaOculto = useCallback((item: ItemCliente) => ocultas.has(claveOculta(item)), [ocultas]);
  const errorDe = useCallback((item: ItemCliente) => errores[claveOculta(item)], [errores]);

  return { estaOculto, enCurso, errorDe, toast, modal, alTocarBoton, confirmar, deshacer, deshacerHecha, cerrarModal, alternarBandera };
}
