// Contraste WCAG 2.x calculado desde los valores reales de cj.css (no a ojo).
//   canal lineal  c = v/255;  c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4
//   luminancia    L = 0.2126 R + 0.7152 G + 0.0722 B
//   contraste     (L_claro + 0.05) / (L_oscuro + 0.05)
// Un color con transparencia (los filetes) se compone primero sobre el fondo.
export type RGB = [number, number, number]
export type ColorA = { rgb: RGB; alfa: number }

export function parsearColor(valor: string): ColorA | null {
  const v = valor.trim()
  // El CSS minificado puede devolver #rrggbb o #rrggbbaa (los rgba() de los filetes se reescriben así)
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alfa: hex[2] ? parseInt(hex[2], 16) / 255 : 1 }
  }
  const rgba = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v)
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alfa: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  return null
}

export function componerSobre(fg: ColorA, fondo: RGB): RGB {
  return fg.rgb.map((c, i) => Math.round(c * fg.alfa + fondo[i] * (1 - fg.alfa))) as RGB
}

function luminancia([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function razonContraste(a: RGB, b: RGB): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function aHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}
