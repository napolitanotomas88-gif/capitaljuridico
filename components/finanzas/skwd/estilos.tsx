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

/* Pagos del equipo (1/11/2026, pedido de Tomás: «está muy feo y no ocupa toda la pantalla»). Prefijo pe-.
   Todo el ancho, formulario en grupos (Persona y período · Montos · Pago) con el total fijo a la derecha,
   rejilla de 12 columnas en escritorio y una sola en celular, botones del Despacho (Boton) y estados con ChipSemaforo. */
.fin-pagina.fin-pagina--ancha { max-width: none; }
@media (min-width: 1024px) { .fin-pagina.fin-pagina--ancha { padding-left: 32px; padding-right: 32px; } }
.fin-skwd .sr-solo { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.fin-skwd .pe { display: flex; flex-direction: column; gap: 18px; }
.fin-skwd .pe > p { margin: 0; }

/* Boton del Despacho dentro de .fin-skwd (le gana a la regla general de botones de esta sección) */
.fin-skwd button.cj-boton { min-height: 44px; padding: 0 20px; font-size: 12px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; border-radius: var(--cj-radio); filter: none; }
.fin-skwd button.cj-boton--marca { background: var(--cj-borgona); color: #f2eadc; border-color: var(--cj-borgona); }
.fin-skwd button.cj-boton--marca:hover:not(:disabled) { background: #6a1a25; border-color: #6a1a25; }
.fin-skwd button.cj-boton--secundario { background: transparent; color: var(--cj-hueso); border-color: var(--cj-control); }
.fin-skwd button.cj-boton--secundario:hover:not(:disabled) { border-color: var(--cj-hueso); background: rgba(29,29,27,0.03); }
.fin-skwd button.cj-boton:disabled { opacity: 1; background: transparent; color: var(--cj-texto-2); border-color: var(--cj-filete-fuerte); }

/* Barra: vista (Líneas / Cierre de mes) + Nueva línea */
.fin-skwd .pe-barra { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.fin-skwd .pe-segmento { display: inline-flex; border: 1px solid var(--cj-control); border-radius: var(--cj-radio); overflow: hidden; background: var(--card); }
.fin-skwd .pe-segmento button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 0; background: transparent; color: var(--text-muted); font-size: 14px; font-weight: 500; }
.fin-skwd .pe-segmento button + button { border-left: 1px solid var(--cj-control); }
.fin-skwd .pe-segmento button:hover:not([aria-pressed='true']) { color: var(--text); background: rgba(29,29,27,0.04); filter: none; }
.fin-skwd .pe-segmento button[aria-pressed='true'] { background: var(--cj-hueso); color: var(--cj-tinta); }
.fin-skwd .pe-segmento button:focus-visible { outline-offset: -4px; } /* el contenedor recorta (overflow hidden): el foco va por dentro */

/* Formulario de carga */
.fin-skwd .pe-carga { background: var(--card); border: 1px solid var(--border); border-top: 3px solid var(--cj-laton); border-radius: var(--cj-radio-l, 14px); padding: 20px 24px 24px; box-shadow: var(--cj-sombra-1, none); }
.fin-skwd .pe-carga__cab { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 6px 24px; padding-bottom: 14px; margin-bottom: 20px; border-bottom: 1px solid var(--cj-filete); }
.fin-skwd .pe-carga__cab h3 { margin: 4px 0 0; font-size: 24px; }
.fin-skwd .pe-form { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 24px; align-items: start; }
.fin-skwd .pe-form__cuerpo { grid-column: span 8; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.fin-skwd .pe-form__resumen { grid-column: span 4; position: sticky; top: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.fin-skwd .pe-grupo { margin: 0; min-width: 0; padding: 16px 18px 18px; border: 1px solid var(--cj-filete); border-radius: var(--cj-radio-m, 10px); background: rgba(242,234,220,0.38); display: flex; flex-direction: column; gap: 14px; }
.fin-skwd .pe-grupo legend { float: left; width: 100%; padding: 0; margin: 0 0 2px; font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--cj-laton); }
.fin-skwd .pe-grupo legend + * { clear: both; }
.fin-skwd .pe-rejilla { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px 16px; }
.fin-skwd .pe-c3 { grid-column: span 3; } .fin-skwd .pe-c4 { grid-column: span 4; } .fin-skwd .pe-c6 { grid-column: span 6; }
.fin-skwd .pe-c8 { grid-column: span 8; } .fin-skwd .pe-c12 { grid-column: 1 / -1; }
.fin-skwd .pe-c12 .sop-puesto { margin: 0; }
.fin-skwd .pe-rejilla > :empty { display: none; } /* SOP sin enlaces: no deja un hueco en la rejilla */
.fin-skwd .pe-campo { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.fin-skwd .pe-campo label { font-size: 13px; font-weight: 600; color: var(--text); }
.fin-skwd .pe-campo input:not([type='checkbox']), .fin-skwd .pe-campo select { width: 100%; min-height: 44px; padding: 8px 12px; font-size: 15px; background: var(--card); border: 1px solid var(--cj-control); border-radius: var(--cj-radio); }
.fin-skwd .pe-campo input:hover:not(:focus), .fin-skwd .pe-campo select:hover:not(:focus) { border-color: var(--cj-hueso); }
.fin-skwd .pe-campo--error input, .fin-skwd .pe-campo--error select { border-color: var(--cj-borgona); box-shadow: inset 3px 0 0 var(--cj-borgona); }
.fin-skwd .pe-obligatorio { color: var(--cj-borgona); font-weight: 700; }
.fin-skwd .pe-ayuda { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-muted); }
.fin-skwd .pe-error { margin: 0; font-size: 13px; line-height: 1.4; font-weight: 600; color: var(--cj-borgona); }
.fin-skwd .pe-error--caja { padding: 8px 12px; background: var(--fin-mal-bg); border-left: 3px solid var(--cj-borgona); border-radius: var(--cj-radio); }
.fin-skwd .pe-aviso--error { border-color: var(--cj-borgona); }
.fin-skwd .pe-monto { position: relative; }
.fin-skwd .pe-monto span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 11px; letter-spacing: .12em; color: var(--text-muted); pointer-events: none; }
.fin-skwd .pe-monto input { padding-left: 50px !important; text-align: right; font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .pe-check { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; color: var(--text); cursor: pointer; }
.fin-skwd .pe-check input { width: 18px; height: 18px; flex: none; }
.fin-skwd .pe-linea-accion { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.fin-skwd .pe button.cj-boton { max-width: 100%; white-space: normal; line-height: 1.3; text-align: center; padding-top: 8px; padding-bottom: 8px; }

/* Propuesta automática de comisión */
.fin-skwd .pe-propuesta { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: var(--card); border: 1px solid var(--border); border-left: 3px solid var(--cj-laton); border-radius: var(--cj-radio-m, 10px); }
.fin-skwd .pe-propuesta__cab { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 16px; }
.fin-skwd .pe-propuesta__cab h4 { margin: 2px 0 0; font-size: 17px; color: var(--text); }
.fin-skwd .pe-propuesta__cuerpo { display: flex; flex-direction: column; gap: 10px; }
.fin-skwd .pe-propuesta__tablas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 12px; align-items: start; }
.fin-skwd .pe-propuesta__tablas td:first-child { min-width: 180px; }
.fin-skwd .pe-propuesta p { margin: 0; }
.fin-skwd .pe-vacio { margin: 0; padding: 12px 14px; font-size: 14px; color: var(--text-muted); border: 1px dashed var(--cj-filete-fuerte); border-radius: var(--cj-radio); }
.fin-skwd .pe-nota-ok { font-size: 13px; color: var(--cj-ok); }
.fin-skwd .pe-nota-aviso { font-size: 13px; color: var(--cj-atencion, #8f4c1c); }
.fin-skwd .pe-detalle summary { cursor: pointer; font-size: 14px; font-weight: 600; color: var(--text); min-height: 32px; display: flex; align-items: center; }
.fin-skwd .pe-detalle .tabla-scroll { margin-top: 8px; }

/* Total de la línea (columna derecha, fija al desplazar) */
.fin-skwd .pe-total { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; background: var(--card); border: 1px solid var(--border); border-left: 4px solid var(--cj-laton); border-radius: var(--cj-radio-m, 10px); }
.fin-skwd .pe-total__valor { font-family: 'Sitka Display', 'Sitka', var(--font-source-serif), Georgia, serif; font-size: clamp(34px, 3vw, 46px); font-weight: 400; line-height: 1.1; color: var(--text); font-variant-numeric: lining-nums tabular-nums; overflow-wrap: anywhere; }
.fin-skwd .pe-total__estado { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px solid var(--cj-filete); }
.fin-skwd .pe-desglose { display: grid; gap: 6px; margin: 6px 0 0; padding-top: 10px; border-top: 1px solid var(--cj-filete); font-size: 14px; }
.fin-skwd .pe-desglose div { display: flex; justify-content: space-between; gap: 12px; }
.fin-skwd .pe-desglose dt { color: var(--text-muted); }
.fin-skwd .pe-desglose dd { margin: 0; color: var(--text); font-variant-numeric: lining-nums tabular-nums; text-align: right; }
.fin-skwd .pe-acciones { display: flex; flex-wrap: wrap; gap: 8px; }
.fin-skwd .pe-acciones .cj-boton { flex: 1 1 140px; }
.fin-skwd .pe-estado { padding: 3px 10px; border-radius: 999px; letter-spacing: .08em; background: rgba(128,92,41,0.10); }
.fin-skwd .pe-estado.cj-semaforo--verde { background: var(--fin-bien-bg); }

/* Filtros, cifras y tablas */
.fin-skwd .pe-filtros { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 14px; padding: 14px 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--cj-radio-m, 10px); }
.fin-skwd .pe-filtros .pe-campo { flex: 1 1 180px; }
.fin-skwd .pe-filtros .pe-campo--ancho { flex: 2 1 240px; }
.fin-skwd .pe-filtros .pe-ayuda { flex: 3 1 320px; align-self: center; }
.fin-skwd .pe-seccion { display: flex; flex-direction: column; gap: 16px; }
.fin-skwd .pe-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px; }
.fin-skwd .pe-kpi { display: flex; flex-direction: column; gap: 4px; padding: 14px 18px; background: var(--card); border: 1px solid var(--border); border-radius: var(--cj-radio-m, 10px); }
.fin-skwd .pe-kpi strong { font-family: 'Sitka Display', 'Sitka', var(--font-source-serif), Georgia, serif; font-size: 30px; font-weight: 400; line-height: 1.15; color: var(--text); font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .pe-kpi small { font-size: 12px; color: var(--text-muted); }
.fin-skwd .pe-kpi--destacada { border-left: 4px solid var(--cj-laton); }
.fin-skwd .pe-dos { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; }
.fin-skwd .pe-tarjeta { min-width: 0; padding: 14px 18px; background: var(--card); border: 1px solid var(--border); border-radius: var(--cj-radio-m, 10px); }
.fin-skwd .pe-tarjeta h3 { margin: 0 0 10px; font-size: 16px; }
.fin-skwd .pe-desglose--fila { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px 18px; margin: 0; padding: 0; border: 0; }
.fin-skwd .pe-desglose--fila div { flex-direction: column; justify-content: flex-start; gap: 2px; }
.fin-skwd .pe-desglose--fila dd { text-align: left; font-family: 'Sitka Display', 'Sitka', var(--font-source-serif), Georgia, serif; font-size: 22px; }
.fin-skwd .pe-tabla { font-size: 13.5px; }
.fin-skwd .pe-tabla th, .fin-skwd .pe-tabla td { padding: 10px 8px; vertical-align: middle; }
.fin-skwd .pe-tabla th.num, .fin-skwd .pe-tabla td.num { text-align: right; white-space: nowrap; font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .pe-tabla--compacta td { padding: 7px 0; }
.fin-skwd .pe-tabla--compacta tr:last-child td { border-bottom: 0; }
.fin-skwd .pe-tabla select { min-height: 36px; padding: 4px 8px; font-size: 13px; }
.fin-skwd .pe-pagado { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; white-space: nowrap; }
.fin-skwd .pe-pagado input { width: 18px; height: 18px; }
.fin-skwd .pe-sin-linea button { margin: 4px 6px 0 0; background: var(--card); color: var(--text); border: 1px solid var(--cj-control); font-weight: 500; }

/* «Pagado por» repartido (1/11/2026): filas Quién / % / = USD, chips en tablas y cierre */
.fin-skwd .pe-reparto { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fin-skwd .pe-reparto__cab { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.fin-skwd .pe-reparto__titulo { font-size: 13px; font-weight: 600; color: var(--text); }
.fin-skwd .pe-reparto__atajos, .fin-skwd .pe-reparto__pie { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.fin-skwd .pe-reparto__pie { justify-content: space-between; }
.fin-skwd .pe-reparto button { min-height: 36px; padding: 4px 12px; font-size: 13px; background: var(--card); color: var(--text); border: 1px solid var(--cj-control); border-radius: var(--cj-radio); font-weight: 500; cursor: pointer; }
.fin-skwd .pe-reparto button:disabled { opacity: .5; cursor: default; }
.fin-skwd .pe-reparto__filas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.fin-skwd .pe-reparto__fila { display: grid; grid-template-columns: minmax(120px, 1.3fr) minmax(90px, .8fr) minmax(110px, 1fr) auto; align-items: center; gap: 8px; }
.fin-skwd .pe-reparto select, .fin-skwd .pe-reparto input { width: 100%; min-height: 40px; padding: 6px 10px; font-size: 15px; background: var(--card); border: 1px solid var(--cj-control); border-radius: var(--cj-radio); }
.fin-skwd .pe-reparto__pct { position: relative; }
.fin-skwd .pe-reparto__pct input { padding-right: 26px; text-align: right; font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .pe-reparto__pct span { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; color: var(--text-muted); pointer-events: none; }
.fin-skwd .pe-reparto__usd { font-size: 14px; color: var(--text); white-space: nowrap; font-variant-numeric: lining-nums tabular-nums; }
.fin-skwd .pe-reparto__suma { font-size: 13px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.fin-skwd .pe-reparto__suma--mal { color: var(--cj-borgona); font-weight: 600; }
.fin-skwd .pe-reparto.pe-campo--error select, .fin-skwd .pe-reparto.pe-campo--error input { border-color: var(--cj-borgona); box-shadow: inset 3px 0 0 var(--cj-borgona); }
.fin-skwd .pe-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; vertical-align: middle; }
.fin-skwd .pe-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; white-space: nowrap; color: var(--text); background: rgba(128,92,41,0.10); border: 1px solid var(--cj-filete); }
.fin-skwd .pe-celda-pagadores { white-space: nowrap; }
.fin-skwd .pe-celda-pagadores .pe-chips { flex-wrap: nowrap; }
.fin-skwd .pe-celda-pagadores > button { margin-left: 4px; }
.fin-skwd .pe-fila-reparto > td { background: rgba(242,234,220,0.38); }
.fin-skwd .pe-reparto-linea { position: sticky; left: 8px; display: flex; flex-direction: column; gap: 10px; max-width: min(640px, calc(100vw - 64px)); padding: 4px 0; } /* sticky: se ve aunque la tabla esté desplazada a la derecha (donde está el ✎) */
@media (max-width: 767px) {
  .fin-skwd .pe-reparto__fila { grid-template-columns: minmax(0, 1fr) 96px auto; }
  .fin-skwd .pe-reparto__usd { grid-column: 1 / -2; grid-row: 2; font-size: 13px; color: var(--text-muted); }
}

@media (max-width: 1023px) {
  .fin-skwd .pe-form__cuerpo, .fin-skwd .pe-form__resumen { grid-column: 1 / -1; }
  .fin-skwd .pe-form__resumen { position: static; }
  .fin-skwd .pe-c3 { grid-column: span 6; } .fin-skwd .pe-c4 { grid-column: span 6; }
  .fin-skwd .pe-dos > * { grid-column: 1 / -1; }
}
@media (max-width: 767px) {
  .fin-skwd .pe-carga { padding: 16px 14px 18px; border-radius: var(--cj-radio-m, 10px); }
  .fin-skwd .pe-carga__cab h3 { font-size: 20px; }
  .fin-skwd .pe-grupo { padding: 14px 12px 16px; }
  .fin-skwd .pe-rejilla > * { grid-column: 1 / -1; }
  .fin-skwd .pe-rejilla > .pe-c3 { grid-column: span 6; }
  .fin-skwd .pe-campo input:not([type='checkbox']), .fin-skwd .pe-campo select { font-size: 16px; }
  .fin-skwd .pe-barra .cj-boton { flex: 1 1 auto; }
  .fin-skwd .pe-acciones .cj-boton { flex: 1 1 100%; }
  .fin-skwd .pe-segmento { flex: 1 1 100%; } .fin-skwd .pe-segmento button { flex: 1; }
  .fin-skwd .pe-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .fin-skwd .pe-kpi { padding: 12px 14px; }
  .fin-skwd .pe-kpi:first-child:nth-last-child(odd) { grid-column: 1 / -1; } /* cantidad impar: la primera (la destacada) va entera y no queda una suelta */
  .fin-skwd .pe-kpi strong { font-size: 21px; overflow-wrap: anywhere; }
  .fin-skwd .pe-desglose--fila { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fin-skwd .pe-desglose--fila dd { font-size: 18px; }
}

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
