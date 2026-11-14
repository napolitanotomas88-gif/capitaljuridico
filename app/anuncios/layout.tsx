import type { Metadata, Viewport } from 'next'
import { MarcoOpcional } from '@/components/shell/MarcoOpcional'
import { VIEWPORT_APP } from '@/components/shell/pwa'

// 7/10/2026: el tablero pasa a verde y a la tipografía del CRM (Source Serif 4), dentro del marco del dashboard cuando hay
// sesión de Google. Los nombres de las variables (--tinta, --sala, --laton…) se conservan para no reescribir el tablero:
// "tinta" es ahora el fondo verde, "sala" el verde claro del OK, "laton" el dorado y "hueso" el marfil del texto.
// El acceso no cambió: clave propia (ANUNCIOS_PASSWORD), también para quien no tiene login de Google (el media buyer).
// 25/10/2026: Anuncios es una pestaña de Clientes, pero la ruta sigue en /anuncios (la clave y los links de Discord no cambian).
// Con sesión de Google arriba van las pestañas del hub (hubClientes); con la clave sola, nada más que el tablero.
export const viewport: Viewport = VIEWPORT_APP

export const metadata: Metadata = {
  title: 'Anuncios de clientes',
  description: 'Tablero de anuncios de Meta de los clientes de Capital Jurídico',
  robots: { index: false, follow: false },
}

const ESTILOS = `
html:not(:has(.cj-cristal)):has(.skw), html:not(:has(.cj-cristal)):has(.skw) body { background: #021b16; }
/* Tokens del tablero (13/11/2026, tanda visual 3a: los del Despacho, components/shell/cristal.css). --tinta es el fondo verde,
   --sala el verde del semáforo, --laton el oro de texto y --hueso el marfil. --info (salvia: verde Toga con marfil) reemplaza
   al azul que estaba fuera de la paleta: marca lo nuevo y lo que hay que revisar (lanzamientos, error de pago nuevo). */
.skw {
  --tinta: #05291f; --sala: #1d6a52; --borgona: #7f202c; --laton: #eed6a8; --info: #b9cbc1; --hueso: #f2eadc; --humo: #e3dac8;
  --filete: rgba(255, 255, 255, 0.13); --filete-fuerte: rgba(255, 255, 255, 0.28); --control: rgba(255, 255, 255, 0.46);
  --anu-panel-liso: rgba(3, 18, 14, 0.9);
  --anu-panel: var(--cjc-panel, linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.016) 40%, rgba(190, 143, 73, 0.032) 100%), var(--anu-panel-liso));
  --anu-sombra: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(255, 255, 255, 0.05), 0 18px 44px -22px rgba(0, 0, 0, 0.6);
  position: relative; isolation: isolate;
  background: #021b16; color: var(--hueso);
  font-family: var(--font-source-serif), Georgia, serif;
  font-size: 15px; line-height: 1.5;
  -webkit-font-smoothing: antialiased; min-height: 100vh; min-height: 100dvh; flex: 1;
}
/* Sin el marco (la clave sola): el fondo del Despacho, verde casi plano con una luz arriba y el logo en oro plano. Con el
   marco lo pone el Despacho. El predeterminado es el nocturno, como en el Despacho; con el sistema en claro, el normal */
.skw::before, .skw::after { content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none; }
.skw::before { background: radial-gradient(80vmax 46vmax at 50% -8%, rgba(120, 160, 140, 0.2), transparent 64%), #05291f; filter: brightness(0.44) saturate(0.85); }
.skw::after {
  inset: auto; left: 50%; top: 50%; width: min(80vw, 1120px); aspect-ratio: 927.41 / 446.75; translate: -50% -52%;
  background: #be8f49; opacity: 0.14;
  -webkit-mask: url('/marca/logo-claro.svg') center / contain no-repeat; mask: url('/marca/logo-claro.svg') center / contain no-repeat;
}
@media (prefers-color-scheme: light) {
  html:not(:has(.cj-cristal)):has(.skw), html:not(:has(.cj-cristal)):has(.skw) body, .skw { background: #03221c; }
  .skw { --anu-panel-liso: rgba(8, 36, 30, 0.82); }
  .skw::before { filter: none; }
  .skw::after { opacity: 0.2; }
}
.cj-cristal .skw::before, .cj-cristal .skw::after { display: none; }
.skw .serif { font-family: 'Sitka Display', 'Sitka Heading', 'Sitka', var(--font-source-serif), Georgia, serif; font-weight: 400; letter-spacing: -0.01em; }
.skw .etq { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--humo); font-weight: 600; }
.skw .etq-laton { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--laton); font-weight: 600; }
.skw a { color: inherit; }
/* Enlaces de acción en el texto: 12 px y un área de toque de 44 px alrededor sin mover nada */
.skw .enlace { position: relative; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--laton); text-decoration: none; border-bottom: 1px solid rgba(238, 214, 168, 0.4); padding-bottom: 1px; white-space: nowrap; }
.skw .enlace::after { content: ''; position: absolute; inset: -13px -6px; }
.skw .enlace:hover { border-bottom-color: var(--laton); }
.skw button.enlace { background: none; border-top: 0; border-left: 0; border-right: 0; padding: 0 0 1px; cursor: pointer; font-family: inherit; }
.skw .chip { position: relative; min-height: 36px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 0 14px; border: 1px solid var(--filete-fuerte); border-radius: 999px; color: var(--humo); background: transparent; cursor: pointer; white-space: nowrap; transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
.skw .chip::after { content: ''; position: absolute; inset: -4px 0; }
.skw .chip:hover { color: var(--hueso); border-color: rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.06); }
.skw .chip[aria-pressed="true"] { color: #0b2c25; background: var(--hueso); border-color: var(--hueso); }
.skw :is(.chip, input, select, button, a, summary):focus-visible { outline: 2px solid var(--laton); outline-offset: 2px; }
/* Campos: los del Despacho (velo blanco, borde de control, radio 10, 44 px) */
.skw :is(input.buscar, select.buscar) { min-height: 44px; padding: 0 12px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.34); border-radius: 10px; color: var(--hueso); font-size: 15px; color-scheme: dark; }
.skw :is(input.buscar, select.buscar):hover { border-color: rgba(255, 255, 255, 0.6); }
.skw :is(input.buscar, select.buscar):focus-visible { outline: 2px solid var(--laton); outline-offset: 1px; border-color: var(--laton); }
.skw input.buscar::placeholder { color: #d3c9b6; }
.skw select.buscar option { background: #0d2f28; color: #f4efe6; }
/* Botones: los del Despacho. Secundario = velo blanco con borde de control; primario = marfil */
.skw .boton { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border: 1px solid var(--control); border-radius: 12px; background: rgba(255, 255, 255, 0.06); color: var(--hueso); font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: background-color 0.15s ease, border-color 0.15s ease; }
.skw .boton:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.7); }
.skw .boton--primario { background: var(--hueso); border-color: var(--hueso); color: #0b2c25; }
.skw .boton--primario:hover:not(:disabled) { background: #fff; border-color: #fff; }
.skw .boton:disabled { opacity: 0.5; cursor: not-allowed; }
.skw .tabla { width: 100%; border-collapse: collapse; }
.skw .tabla th { text-align: left; font-weight: 600; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--humo); padding: 10px 10px; border-bottom: 1px solid var(--filete-fuerte); white-space: nowrap; }
.skw .tabla td { padding: 14px 10px; border-bottom: 1px solid var(--filete); vertical-align: top; }
.skw .num { font-variant-numeric: tabular-nums; }
.skw details > summary { cursor: pointer; list-style: none; }
.skw details > summary::-webkit-details-marker { display: none; }
/* Solapas del tablero (A revisar, Lanzamientos, Notas, Presupuesto, Por lanzar…): paneles sólidos como los del Despacho, sin
   la franja de color de adorno que tenían a la izquierda */
.skw .anu-solapa { margin-top: 24px; padding: 16px 24px; background: var(--anu-panel); border: 1px solid var(--filete); border-top-color: rgba(255, 255, 255, 0.3); border-radius: 18px; box-shadow: var(--anu-sombra); }
.skw .anu-solapa > summary { display: flex; align-items: center; min-height: 44px; margin: -8px 0; }
.skw .anu-solapa[open] > summary { margin-bottom: 4px; }
/* Textos chicos y colores sueltos que el tablero repetía en línea */
.skw .anu-nota { font-size: 13px; color: var(--humo); }
.skw .anu-chico { font-size: 12px; color: var(--humo); }
.skw .anu-hueso { color: var(--hueso); }
.skw .anu-humo { color: var(--humo); }
.skw .anu-laton { color: var(--laton); }
.skw .anu-info { color: var(--info); }
/* Avisos de error: la franja bordó indica estado y se queda */
.skw .anu-aviso { border-left: 2px solid #f0b1b8; padding-left: 12px; color: var(--hueso); }
/* Chapas de la fila (en aumento, sin acceso, lanzada): 12 px, radio de píldora */
.skw .anu-chapa { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; line-height: 1.5; padding: 0 8px; margin-left: 4px; vertical-align: 1px; white-space: nowrap; border: 1px solid transparent; border-radius: 999px; }
.skw .anu-estado { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1.4; padding: 4px 10px; white-space: nowrap; border: 1px solid transparent; border-radius: 999px; }
.skw .anu-acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.skw .anu-acciones--derecha { justify-content: flex-end; }
.skw .anu-boton-texto { position: relative; background: none; border: 0; color: var(--humo); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
.skw .anu-boton-texto::after { content: ''; position: absolute; inset: -13px -6px; }
/* Resumen en tarjetas (25/10/2026): paneles sólidos del Despacho; el número filtra la lista */
.skw .anu-resumen { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 12px; }
.skw .anu-tarjeta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; padding: 16px; min-height: 44px; background: var(--anu-panel); border: 1px solid var(--filete); border-top-color: rgba(255, 255, 255, 0.3); border-radius: 16px; box-shadow: var(--anu-sombra); color: var(--hueso); cursor: pointer; text-decoration: none; font: inherit; transition: border-color 0.15s ease, background-color 0.15s ease; }
.skw .anu-tarjeta:hover { border-color: rgba(255, 255, 255, 0.5); }
.skw .anu-tarjeta[aria-pressed="true"] { border-color: var(--hueso); }
.skw .anu-tarjeta__rotulo { display: flex; align-items: center; gap: 8px; font-size: 14.5px; line-height: 1.3; color: var(--hueso); }
.skw .anu-tarjeta__valor { font-size: clamp(34px, 3vw, 44px); line-height: 1; }
.skw .anu-tarjeta__accion, .skw .anu-tarjeta__contexto { font-size: 13px; line-height: 1.4; color: var(--humo); }
.skw .anu-tarjeta--info .anu-tarjeta__valor { color: var(--info); }
.skw .anu-tarjeta--laton .anu-tarjeta__valor { color: var(--laton); }
.skw .anu-resumen__linea { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 8px 0 0; padding: 0; list-style: none; font-size: 15px; line-height: 1.6; color: var(--humo); }
.skw .anu-resumen__linea b { color: var(--hueso); font-weight: 600; }
@media (max-width: 768px) {
  .skw .anu-resumen { grid-template-columns: 1fr; gap: 8px; }
  .skw .anu-tarjeta { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 12px 16px; }
  .skw .anu-tarjeta__valor { grid-row: 1 / span 2; grid-column: 2; font-size: 30px; }
  .skw .anu-solapa { padding: 12px 16px; }
}
/* Letra un 10 % más grande en escritorio, como el Despacho. Con el marco ya lo hace el Despacho (zoom de .cj-contenido); sin
   el marco se agranda el contenido del tablero y no la pantalla de la clave, que usa 100vh */
@media screen and (min-width: 900px) {
  :root:not(:has(.cj-cristal)) .skw > :not(style):not(.anu-login) { zoom: 1.1; }
}
@media (prefers-reduced-motion: reduce) { .skw :is(.anu-tarjeta, .chip, .boton) { transition: none; } }
`

export default function AnunciosLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarcoOpcional seccion="anuncios" hubClientes>
      <div className="skw anu-verde">
        <style>{ESTILOS}</style>
        {children}
      </div>
    </MarcoOpcional>
  )
}
