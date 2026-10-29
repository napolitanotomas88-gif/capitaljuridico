import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icono } from '@/components/shell/iconos'
import { clases } from './clases'
import './tarjetas.css'

// Tarjetas del hub Clientes (25/10/2026, segunda pasada de diseño). Sobrias: superficie blanca cálida, filete fino, radio
// chico y sombra seca de 1 px; oro mate solo en el ícono y en el filete de la tarjeta destacada. Sin brillos.
// Lineamientos de texto: los rótulos van en minúscula normal (las mayúsculas espaciadas quedan para rótulos de una o dos
// palabras: .cj-etiqueta); el dato grande en Sitka; el contexto en una línea corta.
// Los estados siempre llevan ícono Y texto: el color solo acompaña (WCAG 1.4.1).

export type Tono = 'ok' | 'atencion' | 'alerta' | 'pausa' | 'neutro'

const ICONO_TONO: Record<Tono, string> = { ok: 'ok', atencion: 'atencion', alerta: 'alerta', pausa: 'pausa', neutro: 'neutro' }

/** Estado con ícono y texto ("Al día", "Revisar", "Vencido"). */
export function Estado({ tono, children, className }: { tono: Tono; children: ReactNode; className?: string }) {
  return (
    <span className={clases('cj-estado', `cj-estado--${tono}`, className)}>
      <Icono nombre={ICONO_TONO[tono]} />
      <span>{children}</span>
    </span>
  )
}

export type DatoResumen = {
  /** Rótulo corto, en minúscula normal: "Activos", "Vencen en 30 días" */
  etiqueta: string
  /** El número (o texto corto) grande */
  valor: ReactNode
  /** Una línea de contexto: período, fecha de corte, de dónde sale */
  contexto?: ReactNode
  icono?: string
  estado?: { tono: Tono; texto: string }
  /** Con href, la tarjeta entera es el enlace (un clic) y abajo dice qué hace */
  href?: string
  accion?: string
  /** Filete oro mate arriba: el número que más importa de la fila */
  destacado?: boolean
}

function CuerpoDato({ d }: { d: DatoResumen }) {
  return (
    <>
      <div className="cj-dato__cab">
        {d.icono && (
          <span className="cj-dato__icono" aria-hidden="true">
            <Icono nombre={d.icono} />
          </span>
        )}
        <span className="cj-dato__etiqueta">{d.etiqueta}</span>
      </div>
      <span className="cj-dato__valor cj-num">{d.valor}</span>
      {d.contexto != null && <span className="cj-dato__contexto">{d.contexto}</span>}
      {(d.estado || (d.href && d.accion)) && (
        <span className="cj-dato__pie">
          {d.estado && <Estado tono={d.estado.tono}>{d.estado.texto}</Estado>}
          {d.href && d.accion && (
            <span className="cj-dato__accion">
              {d.accion}
              <Icono nombre="flecha" />
            </span>
          )}
        </span>
      )}
    </>
  )
}

/** Fila de tarjetas-resumen arriba de cada pestaña: los números clave, como un mini panel. */
export function Resumen({ titulo, datos, className }: { titulo: string; datos: DatoResumen[]; className?: string }) {
  if (datos.length === 0) return null
  return (
    <section aria-label={titulo} className={clases('cj-resumen', className)}>
      <ul className="cj-resumen__lista" data-cantidad={datos.length}>
        {datos.map((d) => (
          <li key={d.etiqueta} className={clases('cj-dato', d.destacado && 'cj-dato--destacado', d.href && 'cj-dato--enlace', d.estado && `cj-dato--${d.estado.tono}`)}>
            {d.href ? (
              <Link href={d.href} prefetch={false} className="cj-dato__cuerpo">
                <CuerpoDato d={d} />
              </Link>
            ) : (
              <div className="cj-dato__cuerpo">
                <CuerpoDato d={d} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Tarjeta de contenido: título (h2 o h3), estado opcional, el contenido y una acción principal visible al pie.
 * `id` le da un ancla (los resúmenes pueden saltar a ella).
 */
export function Bloque({
  titulo, etiqueta, estado, accion, nivel = 2, id, children, className, sinRelleno = false,
}: {
  titulo: string
  etiqueta?: string
  estado?: { tono: Tono; texto: string }
  accion?: ReactNode
  nivel?: 2 | 3
  id?: string
  children: ReactNode
  className?: string
  sinRelleno?: boolean
}) {
  const H = nivel === 2 ? 'h2' : 'h3'
  const idTitulo = id ? `${id}-t` : undefined
  return (
    <section id={id} aria-labelledby={idTitulo} aria-label={idTitulo ? undefined : titulo} className={clases('cj-bloque', sinRelleno && 'cj-bloque--sin-relleno', className)}>
      <header className="cj-bloque__cab">
        <div className="cj-bloque__titulos">
          {etiqueta && <span className="cj-etiqueta cj-etiqueta--laton">{etiqueta}</span>}
          <H id={idTitulo} className="cj-bloque__titulo">{titulo}</H>
        </div>
        {estado && <Estado tono={estado.tono}>{estado.texto}</Estado>}
      </header>
      <div className="cj-bloque__cuerpo">{children}</div>
      {accion && <footer className="cj-bloque__pie">{accion}</footer>}
    </section>
  )
}

/** Estado vacío que explica qué pasa y qué hacer, con la acción a un clic. */
export function VacioGuiado({ titulo, texto, accion, icono = 'neutro' }: { titulo: string; texto: ReactNode; accion?: ReactNode; icono?: string }) {
  return (
    <div className="cj-vacio-guiado" role="status">
      <span className="cj-vacio-guiado__icono" aria-hidden="true">
        <Icono nombre={icono} />
      </span>
      <div className="cj-vacio-guiado__texto">
        <p className="cj-vacio-guiado__titulo">{titulo}</p>
        <p>{texto}</p>
        {accion && <div className="cj-fila">{accion}</div>}
      </div>
    </div>
  )
}
