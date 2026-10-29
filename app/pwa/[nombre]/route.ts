import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { ImageResponse } from 'next/og'

// Íconos de la app instalable "Capital Jurídico" (pedido de Tomás, 25/10/2026): el isotipo dorado del Manual de Marca
// (public/marca/isotipo-dorado.svg, LATÓN) centrado sobre TINTA. Antes era un wordmark de texto porque el logo no existía.
// Se generan una vez al compilar (generateStaticParams) leyendo el SVG del repo: sin binarios ni dependencias nuevas.
// Público (lib/auth/rutas.ts: /pwa/*): iOS y el navegador piden estos archivos sin cookie. No llevan ningún dato.
// maskable: el sistema recorta el ícono (círculo, cuadrado redondeado), así que el isotipo va dentro de la zona segura central.
const TINTA = '#012d25'

// `alto`: qué parte del lado ocupa el isotipo (es más alto que ancho: 555 × 817)
const ICONOS = {
  'icon-192.png': { lado: 192, alto: 0.72 },
  'icon-512.png': { lado: 512, alto: 0.72 },
  'icon-maskable-512.png': { lado: 512, alto: 0.54 },
  'apple-touch-icon.png': { lado: 180, alto: 0.7 },
} as const
const PROPORCION = 555.02 / 816.96

type Nombre = keyof typeof ICONOS

export const dynamicParams = false

export function generateStaticParams() {
  return (Object.keys(ICONOS) as Nombre[]).map((nombre) => ({ nombre }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ nombre: string }> }) {
  const { nombre } = await params
  if (!Object.prototype.hasOwnProperty.call(ICONOS, nombre)) return new Response('No encontrado', { status: 404 })
  const { lado, alto } = ICONOS[nombre as Nombre]

  const svg = await readFile(path.join(process.cwd(), 'public', 'marca', 'isotipo-dorado.svg'))
  const h = Math.round(lado * alto)
  const w = Math.round(h * PROPORCION)
  const imagen = createElement(
    'div',
    { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: TINTA } },
    createElement('img', { src: `data:image/svg+xml;base64,${svg.toString('base64')}`, width: w, height: h, alt: '' }),
  )

  const res = new ImageResponse(imagen, { width: lado, height: lado })
  res.headers.set('Cache-Control', 'public, max-age=86400')
  return res
}
