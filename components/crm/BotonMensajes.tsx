import { URL_DOC_MENSAJES } from "@/lib/crm/config/crm";

/**
 * "Mensajes" de la barra negra (Mi día, admin y ficha): abre en otra pestaña el doc "PROCESOS VENTAS -
 * SKWD" (`URL_DOC_MENSAJES`), la guía con la que el closer elige qué mandarle a cada lead. La app no
 * sugiere textos (decisión de Gero del 28/09/2026). 44 px de alto como los demás botones de la barra;
 * en el celular es solo el ícono (así no rompe la barra a 375 px) y en la computadora suma la
 * palabra. Sin hooks: lo usan el encabezado de Mi día (cliente) y las páginas del admin y la ficha
 * (servidor).
 */
export function BotonMensajes() {
  if (!URL_DOC_MENSAJES) return null;
  return (
    <a
      href={URL_DOC_MENSAJES}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Mensajes (PROCESOS VENTAS - SKWD)"
      title="Mensajes: PROCESOS VENTAS - SKWD (se abre en otra pestaña)"
      className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/60 px-2 text-sm font-semibold hover:bg-white/10 lg:px-3"
    >
      <IconoDocumento />
      <span className="hidden lg:inline">Mensajes ↗</span>
    </a>
  );
}

/** Una hoja con la esquina doblada y dos renglones (el doc de la guía de mensajes). */
function IconoDocumento() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
