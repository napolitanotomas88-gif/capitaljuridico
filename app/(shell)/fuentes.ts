// Fuente del dashboard unificado: Source Serif 4 (la del CRM de ventas, con licencia en ./fonts/LICENSE-source-serif.md).
// Una sola familia variable para títulos y texto, cargada una vez y compartida por el layout del shell y por /entrar
// (que vive fuera del shell, ver app/entrar/page.tsx).
//
// El archivo es un subconjunto latino en WOFF2 del TTF variable original (1,2 MB → 256 KB): mismos contornos, mismas
// métricas y los dos ejes (peso 200–900 y tamaño óptico), con todas las características OpenType (cifras tabulares, etc.).
// Quedan Latin básico y extendido A/B, puntuación, monedas, flechas, signos matemáticos y figuras; se fueron cirílico,
// griego (salvo Δ Σ Ω μ π) y vietnamita, que caen en Georgia. Lleva otro nombre interno porque la licencia OFL reserva
// «Source» para el original sin modificar. Para regenerarlo desde el TTF de Adobe (fonttools + brotli):
//   pyftsubset SourceSerif4Variable-Roman.ttf --flavor=woff2 --layout-features='*' --name-IDs='*' --notdef-outline \
//     --unicodes='U+0000-024F,U+02B0-02FF,U+0300-036F,U+0394,U+03A3,U+03A9,U+03BC,U+03C0,U+1E9E,U+2000-206F,U+2070-209F,U+20A0-20BF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+2700-27BF,U+FB00-FB06,U+FEFF,U+FFFD'
import localFont from 'next/font/local'

const serif = localFont({ src: './fonts/serif-cj.woff2', variable: '--font-source-serif', display: 'swap', weight: '200 900' })

/** className con la variable CSS de fuente (--font-source-serif) */
export const clasesFuentes = serif.variable
