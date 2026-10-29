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
html:has(.skw), body:has(.skw) { background: #08382f; }
.skw {
  --tinta: #08382f; --sala: #1d6a52; --borgona: #7f202c; --laton: #d0a45a; --azul: #8fb0d6; --hueso: #f2eadc; --humo: #cbbfa8;
  --filete: rgba(242, 234, 220, 0.16); --filete-fuerte: rgba(242, 234, 220, 0.3);
  background: var(--tinta); color: var(--hueso);
  font-family: var(--font-source-serif), Georgia, serif; font-size: 15px; line-height: 1.5;
  -webkit-font-smoothing: antialiased; min-height: 100vh; min-height: 100dvh; flex: 1;
}
.skw .serif { font-family: 'Sitka Display', 'Sitka Heading', 'Sitka', var(--font-source-serif), Georgia, serif; font-weight: 400; letter-spacing: -0.01em; }
.skw .etq { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--humo); font-weight: 500; }
.skw .etq-laton { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--laton); font-weight: 500; }
.skw a { color: inherit; }
.skw .enlace { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--laton); text-decoration: none; border-bottom: 1px solid rgba(208, 164, 90, 0.4); padding-bottom: 1px; white-space: nowrap; }
.skw .enlace:hover { border-bottom-color: var(--laton); }
.skw .chip { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; padding: 6px 12px; border: 1px solid var(--filete-fuerte); color: var(--humo); background: transparent; cursor: pointer; white-space: nowrap; border-radius: 0; }
.skw .chip[aria-pressed="true"] { color: var(--tinta); background: var(--hueso); border-color: var(--hueso); }
.skw .chip:focus-visible, .skw input:focus-visible, .skw button:focus-visible, .skw a:focus-visible, .skw summary:focus-visible { outline: 1px solid var(--laton); outline-offset: 2px; }
.skw input.buscar { background: transparent; border: 0; border-bottom: 1px solid var(--filete-fuerte); color: var(--hueso); padding: 6px 2px; font-size: 15px; outline: none; border-radius: 0; }
.skw input.buscar:focus-visible { outline: 1px solid var(--laton); outline-offset: 2px; }
.skw input.buscar::placeholder { color: var(--humo); }
.skw .boton { min-height: 44px; padding: 10px 18px; border: 1px solid var(--laton); background: transparent; color: var(--hueso); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; transition: background-color 0.15s ease; }
.skw .boton:hover:not(:disabled) { background: rgba(208, 164, 90, 0.16); }
.skw .boton:disabled { opacity: 0.5; cursor: not-allowed; }
.skw .tabla { width: 100%; border-collapse: collapse; }
.skw .tabla th { text-align: left; font-weight: 500; font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--humo); padding: 10px 10px; border-bottom: 1px solid var(--filete-fuerte); white-space: nowrap; }
.skw .tabla td { padding: 14px 10px; border-bottom: 1px solid var(--filete); vertical-align: top; }
.skw .num { font-variant-numeric: tabular-nums; }
.skw details > summary { cursor: pointer; list-style: none; }
.skw details > summary::-webkit-details-marker { display: none; }
/* Resumen en tarjetas (25/10/2026): mismos colores del tablero, superficie apenas más clara que el verde, sin brillos */
.skw .anu-resumen { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 12px; }
.skw .anu-tarjeta { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; padding: 16px 18px; min-height: 44px; background: rgba(242, 234, 220, 0.04); border: 1px solid var(--filete); border-radius: 10px; color: var(--hueso); cursor: pointer; text-decoration: none; font: inherit; transition: border-color 0.15s ease, background-color 0.15s ease; }
.skw .anu-tarjeta:hover { border-color: var(--filete-fuerte); background: rgba(242, 234, 220, 0.07); }
.skw .anu-tarjeta[aria-pressed="true"] { border-color: var(--hueso); background: rgba(242, 234, 220, 0.1); }
.skw .anu-tarjeta__rotulo { display: flex; align-items: center; gap: 8px; font-size: 14.5px; line-height: 1.3; color: var(--hueso); }
.skw .anu-tarjeta__valor { font-size: clamp(34px, 3vw, 44px); line-height: 1; }
.skw .anu-tarjeta__accion, .skw .anu-tarjeta__contexto { font-size: 13px; line-height: 1.4; color: var(--humo); }
.skw .anu-tarjeta--azul { border-color: rgba(143, 176, 214, 0.4); }
.skw .anu-tarjeta--azul .anu-tarjeta__valor { color: var(--azul); }
.skw .anu-tarjeta--laton { border-color: rgba(190, 143, 73, 0.45); }
.skw .anu-tarjeta--laton .anu-tarjeta__valor { color: #be8f49; }
.skw .anu-resumen__linea { grid-column: 1 / -1; margin: 6px 0 0; font-size: 15px; line-height: 1.6; color: var(--humo); max-width: 90ch; }
@media (max-width: 768px) {
  .skw .anu-resumen { grid-template-columns: 1fr; gap: 8px; }
  .skw .anu-tarjeta { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 12px; padding: 12px 16px; }
  .skw .anu-tarjeta__valor { grid-row: 1 / span 2; grid-column: 2; font-size: 30px; }
}
@media (prefers-reduced-motion: reduce) { .skw .anu-tarjeta { transition: none; } }
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
