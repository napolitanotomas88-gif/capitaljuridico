// Tema de Finanzas: verde (7/10/2026, pedido de Tomás). Es siempre el mismo, sin interruptor claro/oscuro, y vive
// SOLO adentro de .fin-verde (no toca <html>), así que el resto del dashboard no se entera. El wrapper lleva
// data-theme="dark" para heredar las variantes oscuras de las tarjetas de cristal de globals.css; las variables de
// color de abajo las pisan con el verde. Las variables --fin-* son las que usan Secciones.tsx y ui.tsx.

export const ESTILOS_FINANZAS = `
html:has(.fin-verde), body:has(.fin-verde) { background: #08382f; }
.fin-verde {
  font-family: var(--font-source-serif), Georgia, serif; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased;
  --bg: #08382f; --card: #0f4639; --text: #f2eadc; --text-muted: #cbbfa8; --border: rgba(242,234,220,0.2);
  --brand-orange: #be8f49; --brand-red: #e0897b; --brand-yellow: #d9b574;
  --fin-bien: #9fe3c1; --fin-bien-bg: rgba(127,214,171,0.14);
  --fin-mal: #ffb5a9;  --fin-mal-bg: rgba(255,157,143,0.14);
  --fin-aviso: #f0cf86; --fin-aviso-bg: rgba(231,192,106,0.14);
  --fin-borde-control: rgba(242,234,220,0.55); --fin-foco: #d0a45a;
  --fin-pista: rgba(242,234,220,0.14);
  --fin-sobre-dorado: #1d1d1b;
  color-scheme: dark;
}
.fin-fondo { background: var(--bg); min-height: 100vh; min-height: 100dvh; color: var(--text); }
.fin-tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
.fin-tabla th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.fin-tabla td { padding: 7px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); color: var(--text); vertical-align: top; }
.fin-tabla td.num, .fin-tabla th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fin-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.fin-clave-centro { min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.fin-clave { width: 100%; max-width: 380px; padding: 28px; }
.fin-entrada { background: var(--card); color: var(--text); border: 1.5px solid var(--fin-borde-control); outline: none; min-height: 44px; }
.fin-entrada:focus-visible { border-color: var(--fin-foco); outline: 2px solid var(--fin-foco); outline-offset: 2px; }
.fin-boton { background: var(--brand-orange); color: var(--fin-sobre-dorado); border: none; cursor: pointer; min-height: 44px; }
.fin-boton:hover { filter: brightness(1.08); }
.fin-boton:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.fin-sec { border: 1.5px solid var(--fin-borde-control); background: var(--card); color: var(--text-muted); cursor: pointer; }
.fin-sec:hover { color: var(--text); }
.fin-sec:focus-visible { outline: 2px solid var(--fin-foco); outline-offset: 2px; }
/* Todo lo que no tiene foco propio (botones de los meses, enlaces) usa el dorado claro: el anillo heredado del marco es oscuro */
.fin-verde.fin-fondo :focus-visible { outline: 2px solid var(--fin-foco); outline-offset: 2px; }
/* Barra de scroll de las tablas visible sobre el verde */
.fin-verde[data-theme="dark"] ::-webkit-scrollbar-thumb { background: rgba(242,234,220,0.45); }
.fin-scroll { scrollbar-color: rgba(242,234,220,0.45) transparent; }
@media print {
  .no-print { display: none !important; }
  /* Impreso o en PDF sale en claro, como antes (el verde es solo para la pantalla) */
  .fin-verde { --bg: #fff; --card: #fff; --text: #1d1d1b; --text-muted: #605747; --border: #d6cbb8; --brand-orange: #805c29; --brand-red: #7f202c; --brand-yellow: #805c29;
    --fin-bien: #1E7F4F; --fin-bien-bg: rgba(30,127,79,0.12); --fin-mal: #C0392B; --fin-mal-bg: rgba(192,57,43,0.10);
    --fin-aviso: #A15C00; --fin-aviso-bg: rgba(243,146,0,0.14); --fin-pista: rgba(100,100,100,0.14); --fin-sobre-dorado: #fff; color-scheme: light; }
  .fin-fondo, html:has(.fin-verde), body:has(.fin-verde), .cj-contenido:has(.fin-verde) { background: #fff !important; }
}
`

export function EstilosFinanzas() {
  return <style dangerouslySetInnerHTML={{ __html: ESTILOS_FINANZAS }} />
}
