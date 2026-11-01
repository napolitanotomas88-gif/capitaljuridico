// Tema de Finanzas. Hasta el 1/11/2026 era verde oscuro propio; desde ese día usa la estética del resto del Despacho
// (pedido de Tomás: «quedó anticuado, que quede como está todo el resto»): los tokens de app/(shell)/cj.css (marfil,
// blanco cálido, negro, latón y bordó para los botones). Las variables --bg/--card/--text/--fin-* siguen existiendo para
// Secciones.tsx, ui.tsx y las pantallas de Finanzas SKWD, pero ahora apuntan a esos tokens.
import '@/app/(shell)/cj.css'
import '@/app/(shell)/pantallas.css'
import '@/components/ui/tarjetas.css'

export const ESTILOS_FINANZAS = `
.fin-verde {
  font-family: var(--font-source-serif), Georgia, serif; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased;
  --bg: var(--cj-tinta); --card: var(--cj-sala); --text: var(--cj-hueso); --text-muted: var(--cj-humo); --border: var(--cj-filete-fuerte);
  --brand-orange: var(--cj-laton); --brand-red: var(--cj-borgona); --brand-yellow: var(--cj-laton);
  --fin-bien: var(--cj-ok); --fin-bien-bg: rgba(31,107,82,0.10);
  --fin-mal: var(--cj-borgona);  --fin-mal-bg: rgba(127,32,44,0.08);
  --fin-aviso: #6e4f22; --fin-aviso-bg: rgba(190,143,73,0.14);
  --fin-borde-control: var(--cj-control); --fin-foco: var(--cj-laton);
  --fin-pista: rgba(96,87,71,0.12);
  --fin-sobre-dorado: var(--cj-sala);
  --fin-boton: var(--cj-borgona);
  color: var(--text);
}
.fin-fondo { background: var(--bg); min-height: 100vh; min-height: 100dvh; color: var(--text); }
.fin-pagina { max-width: 1180px; margin: 0 auto; padding: 28px max(16px, env(safe-area-inset-right, 0px)) 56px max(16px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 24px; }
.fin-acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.fin-meses { display: flex; flex-wrap: wrap; gap: 6px; }
.fin-verde h2, .fin-verde h3 { font-family: 'Sitka Heading', 'Sitka Display', 'Sitka', var(--font-source-serif), Georgia, serif; }
.fin-tabla { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.fin-tabla th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--text-muted); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.fin-tabla td { padding: 9px 10px; border-bottom: 1px solid var(--cj-filete); color: var(--text); vertical-align: top; }
.fin-tabla td.num, .fin-tabla th.num { text-align: right; font-variant-numeric: lining-nums tabular-nums; white-space: nowrap; }
.fin-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.fin-clave-centro { min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.fin-clave { width: 100%; max-width: 380px; padding: 28px; }
.fin-entrada { background: var(--card); color: var(--text); border: 1px solid var(--fin-borde-control); border-radius: var(--cj-radio); outline: none; min-height: 44px; }
.fin-entrada:focus-visible { border-color: var(--fin-foco); outline: 2px solid var(--fin-foco); outline-offset: 2px; }
.fin-boton { background: var(--fin-boton); color: var(--cj-sala); border: none; border-radius: var(--cj-radio); cursor: pointer; min-height: 44px; }
.fin-boton:hover { filter: brightness(1.08); }
.fin-boton:focus-visible { outline: 2px solid var(--fin-foco); outline-offset: 2px; }
.fin-sec { border: 1px solid var(--fin-borde-control); background: var(--card); color: var(--text); border-radius: var(--cj-radio); cursor: pointer; }
.fin-sec:hover { border-color: var(--fin-foco); }
.fin-verde :focus-visible { outline: 2px solid var(--fin-foco); outline-offset: 2px; }
@media print { .no-print { display: none !important; } }
`

export function EstilosFinanzas() {
  return <style dangerouslySetInnerHTML={{ __html: ESTILOS_FINANZAS }} />
}
