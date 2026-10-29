// Fuente del dashboard unificado: Source Serif 4 (la del CRM de ventas, con licencia en ./fonts/LICENSE-source-serif.md).
// Una sola familia variable para títulos y texto, cargada una vez y compartida por el layout del shell y por /entrar
// (que vive fuera del shell, ver app/entrar/page.tsx).
import localFont from 'next/font/local'

const serif = localFont({ src: './fonts/source-serif-4.ttf', variable: '--font-source-serif', display: 'swap', weight: '200 900' })

/** className con la variable CSS de fuente (--font-source-serif) */
export const clasesFuentes = serif.variable
