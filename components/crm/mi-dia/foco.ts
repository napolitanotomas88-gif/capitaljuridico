"use client";

// Foco para la hoja inferior y el panel de la ficha (docs/diseno.md, accesibilidad): primer
// control al abrir, Tab que no se escapa del diálogo y volver al botón que lo abrió al cerrar.

const ENFOCABLES = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Los controles enfocables y visibles de un contenedor, en orden de tabulación del DOM. */
export function enfocables(contenedor: HTMLElement | null): HTMLElement[] {
  if (!contenedor) return [];
  return [...contenedor.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((el) => el.getClientRects().length > 0);
}

/** Tab / Shift+Tab dan la vuelta dentro de `contenedor` (para un diálogo modal). */
export function atraparTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, contenedor: HTMLElement | null) {
  if (e.key !== "Tab") return;
  const lista = enfocables(contenedor);
  if (lista.length === 0) return;
  const primero = lista[0];
  const ultimo = lista[lista.length - 1];
  const activo = document.activeElement;
  if (e.shiftKey && (activo === primero || !contenedor?.contains(activo))) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && (activo === ultimo || !contenedor?.contains(activo))) {
    e.preventDefault();
    primero.focus();
  }
}

/** El elemento con foco ahora (para devolverle el foco al cerrar). */
export function focoActual(): HTMLElement | null {
  const activo = document.activeElement;
  return activo instanceof HTMLElement && activo !== document.body ? activo : null;
}

/** Devuelve el foco a `el` si sigue en la página (la tarjeta que lo abrió puede haberse ido). */
export function devolverFoco(el: HTMLElement | null) {
  if (el?.isConnected) el.focus();
}
