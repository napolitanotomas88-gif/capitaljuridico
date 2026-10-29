import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { clases } from './clases'

// Primario: hueso sobre tinta. Secundario: solo filete. Sin sombras ni relieve.
// 'marca' (25/10/2026): bordó del manual, para la acción principal de las tarjetas del hub Clientes (estilo en tarjetas.css)
export type VarianteBoton = 'primario' | 'secundario' | 'marca'

const claseBoton = (variante: VarianteBoton, className?: string) =>
  clases('cj-boton', `cj-boton--${variante}`, className)

type PropsBoton = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton }

export function Boton({ variante = 'primario', className, type = 'button', ...resto }: PropsBoton) {
  return <button type={type} className={claseBoton(variante, className)} {...resto} />
}

type PropsEnlace = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; variante?: VarianteBoton }

/** Mismo aspecto que Boton, pero navega (next/link) */
export function BotonEnlace({ variante = 'secundario', className, href, ...resto }: PropsEnlace) {
  return <Link href={href} className={claseBoton(variante, className)} {...resto} />
}
