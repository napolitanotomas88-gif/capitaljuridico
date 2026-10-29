'use client'

import { useSyncExternalStore } from 'react'
import { ChipSemaforo, Tabla, type Columna } from '@/components/ui'
import { aHex, componerSobre, parsearColor, razonContraste, type RGB } from './contraste'

// Lee los tokens REALES de cj.css en el navegador (getComputedStyle), así lo que se muestra
// no puede quedar desactualizado respecto del CSS. Antes de hidratar muestra guiones.

const TOKENS = [
  { token: '--cj-tinta', nombre: 'Tinta', uso: 'Fondo de todo el viewport', proporcion: '~70%' },
  { token: '--cj-sala', nombre: 'Sala', uso: 'Superficies (paneles)', proporcion: '~15%' },
  { token: '--cj-hueso', nombre: 'Hueso', uso: 'Texto principal, botón primario', proporcion: '~8%' },
  { token: '--cj-laton', nombre: 'Latón', uso: 'Etiquetas de sección, enlaces, foco. Mate y escaso', proporcion: '<5%' },
  { token: '--cj-borgona', nombre: 'Borgoña', uso: 'Alertas (superficie, nunca texto)', proporcion: '<2%' },
  { token: '--cj-humo', nombre: 'Humo', uso: 'Texto secundario sobre Tinta, borde de controles', proporcion: 'texto' },
  { token: '--cj-humo-claro', nombre: 'Humo claro', uso: 'Texto secundario sobre Sala (Humo + 10% Hueso)', proporcion: 'texto' },
  { token: '--cj-ok', nombre: 'Verde (semáforo)', uso: 'Tinte claro de Sala', proporcion: 'estado' },
  { token: '--cj-error', nombre: 'Rojo (semáforo)', uso: 'Tinte claro de Borgoña', proporcion: 'estado' },
] as const

// Tokens que no son muestras de la paleta pero entran en los pares de contraste
const AUXILIARES: Record<string, string> = {
  '--cj-control': 'Borde de control',
  '--cj-filete': 'Filete',
  '--cj-filete-fuerte': 'Filete fuerte',
}
const NOMBRES: string[] = [...TOKENS.map((t) => t.token), ...Object.keys(AUXILIARES)]

type Par = { fg: string; bg: string; uso: string; tipo: 'texto' | 'grafico' | 'decorativo' }

// Cada par que usa el sistema, con su mínimo: 4.5:1 texto, 3:1 elementos gráficos
const PARES: Par[] = [
  { fg: '--cj-hueso', bg: '--cj-tinta', uso: 'Texto principal', tipo: 'texto' },
  { fg: '--cj-hueso', bg: '--cj-sala', uso: 'Texto en panel', tipo: 'texto' },
  { fg: '--cj-humo', bg: '--cj-tinta', uso: 'Texto secundario', tipo: 'texto' },
  { fg: '--cj-humo-claro', bg: '--cj-sala', uso: 'Texto secundario en panel', tipo: 'texto' },
  { fg: '--cj-humo', bg: '--cj-sala', uso: 'Humo puro en panel (no se usa)', tipo: 'texto' },
  { fg: '--cj-laton', bg: '--cj-tinta', uso: 'Etiquetas y enlaces', tipo: 'texto' },
  { fg: '--cj-laton', bg: '--cj-sala', uso: 'Etiquetas en panel', tipo: 'texto' },
  { fg: '--cj-ok', bg: '--cj-tinta', uso: 'Semáforo verde, palabra', tipo: 'texto' },
  { fg: '--cj-ok', bg: '--cj-sala', uso: 'Semáforo verde en panel', tipo: 'texto' },
  { fg: '--cj-error', bg: '--cj-tinta', uso: 'Semáforo rojo, palabra', tipo: 'texto' },
  { fg: '--cj-error', bg: '--cj-sala', uso: 'Semáforo rojo en panel', tipo: 'texto' },
  { fg: '--cj-tinta', bg: '--cj-hueso', uso: 'Botón primario, chip activo', tipo: 'texto' },
  { fg: '--cj-hueso', bg: '--cj-borgona', uso: 'Aviso sobre Borgoña', tipo: 'texto' },
  { fg: '--cj-humo', bg: '--cj-borgona', uso: 'Humo sobre Borgoña (no se usa)', tipo: 'texto' },
  { fg: '--cj-control', bg: '--cj-tinta', uso: 'Borde de botón, chip y campo', tipo: 'grafico' },
  { fg: '--cj-control', bg: '--cj-sala', uso: 'Borde de control en panel', tipo: 'grafico' },
  { fg: '--cj-laton', bg: '--cj-tinta', uso: 'Foco, estado activo de la nav', tipo: 'grafico' },
  { fg: '--cj-laton', bg: '--cj-sala', uso: 'Foco en panel', tipo: 'grafico' },
  { fg: '--cj-ok', bg: '--cj-sala', uso: 'Cuadradito verde', tipo: 'grafico' },
  { fg: '--cj-error', bg: '--cj-sala', uso: 'Cuadradito rojo', tipo: 'grafico' },
  { fg: '--cj-filete-fuerte', bg: '--cj-tinta', uso: 'Filete de tabla y separadores', tipo: 'decorativo' },
  { fg: '--cj-filete', bg: '--cj-tinta', uso: 'Filete entre filas', tipo: 'decorativo' },
]

const MINIMO = { texto: 4.5, grafico: 3, decorativo: 0 }

function suscribir() {
  return () => {}
}
function leerTokens(): string {
  const raiz = document.querySelector('.cj-raiz')
  if (!raiz) return ''
  const estilo = getComputedStyle(raiz)
  return JSON.stringify(Object.fromEntries(NOMBRES.map((n) => [n, estilo.getPropertyValue(n).trim()])))
}

type FilaContraste = { clave: string; par: string; uso: string; tipo: Par['tipo']; razon: number | null; minimo: number }

export function PaletaYContrastes() {
  const crudo = useSyncExternalStore(suscribir, leerTokens, () => '')
  const valores: Record<string, string> = crudo ? JSON.parse(crudo) : {}

  const fondoRgb = (token: string): RGB | null => {
    const c = parsearColor(valores[token] ?? '')
    return c ? c.rgb : null
  }
  const nombreCorto = (t: string) => (TOKENS.find((x) => x.token === t)?.nombre ?? AUXILIARES[t] ?? t).toUpperCase()

  const filas: FilaContraste[] = PARES.map((p) => {
    const fg = parsearColor(valores[p.fg] ?? '')
    const bg = fondoRgb(p.bg)
    const razon = fg && bg ? razonContraste(componerSobre(fg, bg), bg) : null
    return { clave: `${p.fg}|${p.bg}|${p.uso}`, par: `${nombreCorto(p.fg)} sobre ${nombreCorto(p.bg)}`, uso: p.uso, tipo: p.tipo, razon, minimo: MINIMO[p.tipo] }
  })

  const columnas: Columna<FilaContraste>[] = [
    { clave: 'par', titulo: 'Par' },
    { clave: 'uso', titulo: 'Uso' },
    { clave: 'tipo', titulo: 'Tipo', celda: (f) => (f.tipo === 'texto' ? 'Texto' : f.tipo === 'grafico' ? 'Gráfico' : 'Decorativo') },
    { clave: 'razon', titulo: 'Contraste', numerica: true, celda: (f) => (f.razon === null ? '—' : `${f.razon.toFixed(2)}:1`) },
    { clave: 'minimo', titulo: 'Mínimo', numerica: true, celda: (f) => (f.minimo ? `${f.minimo}:1` : '—') },
    {
      clave: 'resultado',
      titulo: 'Resultado',
      celda: (f) => {
        if (f.razon === null) return <ChipSemaforo estado="gris">Calculando</ChipSemaforo>
        if (f.tipo === 'decorativo') return <ChipSemaforo estado="gris">Exento</ChipSemaforo>
        return f.razon >= f.minimo ? <ChipSemaforo estado="verde">Cumple</ChipSemaforo> : <ChipSemaforo estado="rojo">No cumple</ChipSemaforo>
      },
    },
  ]

  return (
    <div className="cj-pila">
      <div className="cj-muestras">
        {TOKENS.map((t) => {
          const c = parsearColor(valores[t.token] ?? '')
          return (
            <div key={t.token} className="cj-muestra">
              <div className="cj-muestra__color" style={{ background: `var(${t.token})` }} />
              <span className="cj-etiqueta cj-etiqueta--laton">{t.nombre}</span>
              <span className="cj-num">
                {c ? aHex(c.rgb) : '—'} · {t.proporcion}
              </span>
              <span className="cj-texto-2 cj-muestra__uso">{t.uso}</span>
            </div>
          )
        })}
      </div>
      <Tabla descripcion="Contrastes WCAG calculados" columnas={columnas} filas={filas} claveFila={(f) => f.clave} />
    </div>
  )
}
