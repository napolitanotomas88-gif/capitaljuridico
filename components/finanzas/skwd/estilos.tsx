// Estilos de las pantallas de Finanzas SKWD dentro del Despacho (1/11/2026). Es el App.css de la app original pasado a
// la estética del Despacho (marfil, blanco cálido, latón y bordó para los botones) (components/finanzas/Tema.tsx: usa sus
// variables --bg, --card, --text, --text-muted, --border, --brand-orange y --fin-*) y encerrado en .fin-skwd, así no
// toca el resto del Despacho. Las clases son las mismas que usan los componentes (form, filtros, tabla-scroll, kpi, er-*…).
export const ESTILOS_SKWD = `
.fin-skwd { --sk-campo: var(--cj-sala); --sk-thead: var(--cj-sala); --sk-realce: rgba(29,29,27,0.04); --sk-texto-3: #6f6859;
  --sk-oro-suave: rgba(190,143,73,0.16); --sk-verde-suave: rgba(159,227,193,0.10); --sk-radio: 10px; }
.fin-skwd h2, .fin-skwd h3, .fin-skwd h4 { color: var(--text); font-weight: 400; font-family: 'Sitka Heading', 'Sitka Display', 'Sitka', var(--font-source-serif), Georgia, serif; line-height: 1.2; letter-spacing: -0.01em; }
.fin-skwd h2 { font-size: 24px; margin: 0 0 14px; }
.fin-skwd h2::after { content: ''; display: block; width: 52px; height: 2px; margin-top: 8px; background: var(--brand-orange); }
.fin-skwd .detalle h2::after, .fin-skwd .detalle-cab h2::after { display: none; }
.fin-skwd .detalle-cab h2, .fin-skwd .detalle-cab h3 { margin: 0; }
.fin-skwd h3 { font-size: 17px; margin: 18px 0 8px; }
.fin-skwd h4 { font-size: 14px; margin: 14px 0 6px; color: var(--text-muted); }
.fin-skwd p { margin: 0 0 8px; }
.fin-skwd a { color: var(--brand-orange); }
.fin-skwd code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; background: var(--sk-realce); border-radius: 4px; padding: 1px 6px; }
.fin-skwd .cabecera { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }

/* Formularios y botones (como .fin-entrada / .fin-boton / .fin-sec) */
.fin-skwd input, .fin-skwd select, .fin-skwd textarea { background: var(--sk-campo); color: var(--text); border: 1.5px solid var(--fin-borde-control); border-radius: 8px; font: inherit; }
.fin-skwd input:focus, .fin-skwd select:focus, .fin-skwd textarea:focus { outline: 2px solid var(--fin-foco); outline-offset: 1px; border-color: var(--fin-foco); }
.fin-skwd input[type='checkbox'], .fin-skwd input[type='radio'] { accent-color: var(--brand-orange); min-height: 0; }
.fin-skwd input:disabled, .fin-skwd select:disabled, .fin-skwd textarea:disabled { background: var(--sk-realce); color: var(--sk-texto-3); }
.fin-skwd input::placeholder, .fin-skwd textarea::placeholder { color: var(--sk-texto-3); }
.fin-skwd button { background: var(--fin-boton); color: var(--cj-sala); border: 1px solid var(--fin-boton); border-radius: var(--cj-radio);
  padding: 8px 14px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: filter .15s, background-color .15s, color .15s; }
.fin-skwd button:hover:not(:disabled) { filter: brightness(1.08); }
.fin-skwd button:disabled { opacity: .5; cursor: not-allowed; }
.fin-skwd .form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 14px; margin-bottom: 16px; }
.fin-skwd .form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.fin-skwd .form input, .fin-skwd .form select, .fin-skwd .form button { padding: 8px 10px; font-size: 14px; min-height: 40px; }
.fin-skwd .form .check, .fin-skwd .filtros .check { flex-direction: row; align-items: center; gap: 6px; font-size: 14px; font-weight: 400; color: var(--text); }
.fin-skwd .form .check input, .fin-skwd .filtros .check input { padding: 0; }
.fin-skwd .form .acciones { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
.fin-skwd .form .sop-puesto { grid-column: 1 / -1; margin: 0; }
.fin-skwd .filtros { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; align-items: center; }
.fin-skwd .filtros input, .fin-skwd .filtros select, .fin-skwd .filtros button { padding: 8px 10px; font-size: 14px; min-height: 40px; }
.fin-skwd .subtabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; }
.fin-skwd .subtabs button, .fin-skwd td button { background: var(--card); color: var(--text-muted); border-color: var(--fin-borde-control); }
.fin-skwd .subtabs button { padding: 6px 14px; font-size: 14px; }
.fin-skwd .subtabs button:hover:not(:disabled), .fin-skwd td button:hover:not(:disabled) { color: var(--text); filter: none; border-color: var(--brand-orange); }
.fin-skwd .subtabs button:disabled { opacity: 1; cursor: default; background: var(--cj-hueso); color: var(--cj-sala); border-color: var(--cj-hueso); }
.fin-skwd .acciones-fila { white-space: normal; }
.fin-skwd td button { margin: 1px 3px 1px 0; font-size: 12px; padding: 4px 9px; font-weight: 600; }

/* Mensajes */
.fin-skwd .error { color: var(--fin-mal); font-weight: 600; }
.fin-skwd .ok { color: var(--fin-bien); font-weight: 600; }
.fin-skwd .alta-rapida { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 4px; }
.fin-skwd .alta-rapida input { flex: 1 1 160px; min-width: 0; padding: 8px 10px; }
.fin-skwd .alta-rapida input:first-child { flex-basis: 220px; }
.fin-skwd .alta-rapida button.secundario { background: transparent; color: var(--text); border: 1.5px solid var(--fin-borde-control); }
.fin-skwd button.quitar { color: var(--cj-borgona); border-color: var(--cj-borgona); background: transparent; }
.fin-skwd .pos { color: var(--fin-bien); }
.fin-skwd .neg { color: var(--fin-mal); }
.fin-skwd .gris { color: var(--sk-texto-3); }
.fin-skwd .nowrap { white-space: nowrap; }
.fin-skwd .aviso { font-size: 12px; color: var(--sk-texto-3); font-weight: normal; }
.fin-skwd .nota { max-width: 260px; font-size: 13px; }
.fin-skwd .bloqueado { font-size: 14px; color: var(--text-muted); padding: 8px 0; }
.fin-skwd .aviso-box { background: var(--fin-aviso-bg); border: 1px solid var(--brand-orange); border-left-width: 4px; border-radius: 8px; padding: 8px 12px; margin: 8px 0; font-size: 14px; color: var(--text); }
.fin-skwd .aparte { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--text-muted); background: var(--sk-realce); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
.fin-skwd .corregido { background: var(--sk-oro-suave); border-radius: 4px; padding: 0 4px; }
.fin-skwd .tarjeta-alerta { background: var(--sk-oro-suave) !important; border-color: var(--brand-orange) !important; }

/* Tablas (como .fin-tabla) */
.fin-skwd .tabla-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; background: var(--card); border: 1px solid var(--border); border-radius: var(--sk-radio); scrollbar-color: rgba(29,29,27,0.3) transparent; }
.fin-skwd table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd th, .fin-skwd td { text-align: left; padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); color: var(--text); vertical-align: top; }
.fin-skwd thead th { background: var(--sk-thead); color: var(--text-muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; white-space: nowrap; border-bottom: 1px solid var(--border); }
.fin-skwd tbody tr:hover { background: rgba(190,143,73,0.08); }
.fin-skwd .fila-inactiva { color: var(--sk-texto-3); }
.fin-skwd .fila-abierta, .fin-skwd .fila-abierta:hover { background: var(--sk-verde-suave); }
.fin-skwd .fila-gris { color: var(--sk-texto-3); background: var(--sk-realce); }
.fin-skwd .fila-revisar { background: var(--sk-oro-suave); }
.fin-skwd .fila-total td { border-top: 2px solid var(--brand-orange); font-weight: 700; }

/* Etiquetas de estado */
.fin-skwd .et { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 8px; margin: 1px 3px 1px 0; white-space: nowrap; }
.fin-skwd .et-revisar { background: var(--fin-aviso-bg); color: var(--fin-aviso); }
.fin-skwd .et-gris { background: var(--sk-realce); color: var(--text-muted); }
.fin-skwd .et-naranja { background: var(--fin-mal-bg); color: var(--fin-mal); }
.fin-skwd .et-verde { background: var(--fin-bien-bg); color: var(--fin-bien); }
.fin-skwd .et-azul { background: var(--sk-verde-suave); color: var(--text); }

/* Resúmenes y tarjetas */
.fin-skwd .resumenes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 16px; }
.fin-skwd .resumenes h3 { margin: 8px 0 4px; font-size: 16px; }
.fin-skwd .resumen-principal { display: flex; flex-wrap: wrap; gap: 12px 28px; background: var(--card); border: 1px solid var(--border); border-left: 5px solid var(--brand-orange); border-radius: var(--sk-radio); padding: 12px 16px; margin: 8px 0 16px; }
.fin-skwd .resumen-principal div { display: flex; flex-direction: column; }
.fin-skwd .resumen-principal span, .fin-skwd .tarjetas span, .fin-skwd .kpi span { font-size: 12px; color: var(--text-muted); }
.fin-skwd .resumen-principal strong { font-size: 22px; font-weight: 800; color: var(--text); font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .tarjetas { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 8px 0 16px; }
.fin-skwd .tarjetas div { background: var(--card); border: 1px solid var(--border); border-radius: var(--sk-radio); padding: 8px 12px; display: flex; flex-direction: column; }
.fin-skwd .tarjetas strong { font-size: 17px; font-weight: 800; font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .tarjetas .destacada, .fin-skwd .kpi.destacada { background: var(--sk-oro-suave); border-color: var(--brand-orange); }
.fin-skwd .detalle { background: var(--card); border: 1px solid var(--border); border-top: 3px solid var(--brand-orange); border-radius: var(--sk-radio); padding: 14px 18px; margin-top: 16px; }
.fin-skwd .detalle-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.fin-skwd .detalle h3 { margin: 14px 0 6px; font-size: 16px; }
.fin-skwd .datos { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 14px; }
.fin-skwd .titulo-bloque { margin: 14px 0 4px; font-size: 16px; }
.fin-skwd .impacto { background: var(--sk-verde-suave); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; }
.fin-skwd .impacto table { width: 100%; margin-top: 4px; }
.fin-skwd .impacto td { border-bottom: 1px dotted var(--border); }

/* Tablero */
.fin-skwd .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin: 8px 0 18px; }
.fin-skwd .kpi { background: var(--card); border: 1px solid var(--border); border-radius: var(--sk-radio); padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
.fin-skwd .kpi.destacada { border-left-width: 5px; }
.fin-skwd .kpi strong { font-size: 28px; line-height: 1.15; font-weight: 400; font-family: 'Sitka Display', 'Sitka', var(--font-source-serif), Georgia, serif; color: var(--text); font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .kpi small { font-size: 11px; color: var(--sk-texto-3); }
.fin-skwd .delta { font-size: 12px; font-weight: 600; }
.fin-skwd .delta-pos { color: var(--fin-bien); }
.fin-skwd .delta-neg { color: var(--fin-mal); }
.fin-skwd .delta-nd { color: var(--sk-texto-3); font-weight: 400; }
.fin-skwd .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 16px; margin-bottom: 18px; }
.fin-skwd .dash-card { margin: 0; border: 1px solid var(--border); border-radius: var(--sk-radio); padding: 14px 16px; background: var(--card); }
.fin-skwd .dash-card figcaption { margin-bottom: 8px; font-size: 14px; font-weight: 700; color: var(--text); }
.fin-skwd .dash-tabla { margin-top: 6px; font-size: 12px; }
.fin-skwd .dash-tabla summary { cursor: pointer; color: var(--text-muted); }
.fin-skwd .dash-tooltip { background: var(--card); border: 1px solid var(--brand-orange); border-radius: 8px; padding: 6px 10px; font-size: 13px; color: var(--text); box-shadow: var(--cj-sombra-2); }
.fin-skwd .dash-seccion { margin: 22px 0; }
.fin-skwd .dash-seccion h3 { margin: 0 0 8px; }
.fin-skwd .dash-seccion h4 { margin: 14px 0 6px; font-size: 14px; }

/* Estado de resultados */
.fin-skwd .er-tabla table { font-size: 12px; white-space: nowrap; }
.fin-skwd .er-tabla th, .fin-skwd .er-tabla td { text-align: right; padding: 4px 8px; }
.fin-skwd .er-tabla th:first-child, .fin-skwd .er-tabla td:first-child { text-align: left; position: sticky; left: 0; z-index: 1; min-width: 260px; white-space: normal; }
.fin-skwd .er-tabla td:first-child { background: var(--card); }
.fin-skwd .er-tabla th:first-child { background: var(--sk-thead); }
.fin-skwd .er-seccion td { background: var(--sk-verde-suave) !important; color: var(--text); font-weight: 700; text-align: left !important; position: static !important; }
.fin-skwd .er-sub td { font-weight: 600; color: var(--text-muted); text-align: left !important; position: static !important; padding-top: 8px; }
.fin-skwd .er-fuerte td { font-weight: 700; }
.fin-skwd .er-destacada td, .fin-skwd .er-destacada td:first-child { background: var(--sk-oro-suave); }
.fin-skwd .er-subfila td { color: var(--sk-texto-3); font-size: 11px; }
.fin-skwd .er-sangria { padding-left: 22px !important; }
.fin-skwd .er-encurso, .fin-skwd .er-encurso td, .fin-skwd .er-tabla .er-encurso td:first-child { color: var(--sk-texto-3); background: var(--sk-realce); }
.fin-skwd .er-vacio { color: #9a9284; }
.fin-skwd .er-total { font-weight: 700; border-left: 2px solid var(--brand-orange); }
.fin-skwd .er-detalle { margin: 14px 0; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; }
.fin-skwd .er-detalle summary { cursor: pointer; font-weight: 600; color: var(--text); }
.fin-skwd .er-detalle ul { margin: 8px 0 0; padding-left: 20px; font-size: 14px; display: grid; gap: 4px; }

/* Inicio de sesión de la base de Finanzas (como la tarjeta de la contraseña de Finanzas) */
.fin-skwd .login { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 16px 0; }
.fin-skwd .login-tarjeta { width: 100%; max-width: 400px; padding: 28px; background: var(--card); border: 1px solid var(--border); border-top: 3px solid var(--brand-orange); border-radius: 14px; }
.fin-skwd .login-logo { display: block; width: 100%; max-width: 200px; height: auto; margin: 0 auto 12px; }
.fin-skwd .login h1 { margin: 0; text-align: center; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--text-muted); font-weight: 700; }
.fin-skwd .login h2 { margin: 16px 0 14px; font-size: 20px; text-align: center; }
.fin-skwd .login h2::after { margin: 8px auto 0; }
.fin-skwd .login-form { display: flex; flex-direction: column; gap: 14px; }
.fin-skwd .login-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.fin-skwd .login-form input, .fin-skwd .login-form button { padding: 11px 12px; font-size: 15px; min-height: 44px; }

/* Pestañas de Finanzas: como las del hub de Clientes (texto humo, la activa en negro con filete latón abajo) */
.fin-nav { display: flex; gap: 2px; overflow-x: auto; -webkit-overflow-scrolling: touch; border-bottom: 1px solid var(--cj-filete); scrollbar-width: none; }
.fin-nav::-webkit-scrollbar { display: none; }
.fin-nav a { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 46px; padding: 0 16px; margin-bottom: -1px; text-decoration: none; font-size: 15px; font-weight: 500; color: var(--cj-humo); border-bottom: 2px solid transparent; border-radius: var(--cj-radio) var(--cj-radio) 0 0; transition: color .15s ease, background-color .15s ease; }
.fin-nav a:hover { color: var(--cj-hueso); background: rgba(29,29,27,0.04); }
.fin-nav a[aria-current='page'] { color: var(--cj-hueso); border-bottom-color: var(--cj-laton); background: rgba(190,143,73,0.10); }
.fin-nav a:focus-visible { outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .fin-nav a { transition: none; } }

@media (max-width: 860px) {
  .fin-skwd h2 { font-size: 21px; }
  .fin-skwd .kpi strong { font-size: 22px; }
  .fin-skwd .form { grid-template-columns: 1fr; }
  .fin-skwd .dash-grid { grid-template-columns: 1fr; }
  .fin-skwd .er-tabla th:first-child, .fin-skwd .er-tabla td:first-child { min-width: 170px; }
}
`

export function EstilosSkwd() {
  return <style dangerouslySetInnerHTML={{ __html: ESTILOS_SKWD }} />
}
