import Image from 'next/image'
import Link from 'next/link'

// Logo oficial de Capital Jurídico (public/marca/*, el mismo del CRM de ventas). Sobre la barra verde se usa la versión
// clara; sobre el fondo marfil de /entrar (fondo="claro"), la oscura.
// Con href={null} es solo imagen: en /entrar no hay a dónde ir (un enlace a "/" vuelve al mismo login) y así el primer Tab cae en "Entrar con Google".
export function Wordmark({ href = '/', fondo = 'oscuro' }: { href?: string | null; fondo?: 'oscuro' | 'claro' }) {
  const imagen = (
    <Image
      src={fondo === 'oscuro' ? '/marca/logo-claro.svg' : '/marca/logo-oscuro.svg'}
      alt="Capital Jurídico"
      width={927}
      height={447}
      unoptimized
      priority
      className="cj-logo"
    />
  )
  // "Despacho": el nombre del sistema va debajo del logo (el logo es de la marca, Despacho es de la herramienta)
  const rotulo = <span className="cj-marca__rotulo">Despacho</span>
  // En la barra lateral chica (solo escritorio) se ve únicamente el escudo; cj.css decide cuál se muestra
  const iso = fondo === 'oscuro' ? <Image src="/marca/isotipo-dorado.svg" alt="" aria-hidden="true" className="cj-logo-iso" width={40} height={40} unoptimized /> : null
  if (href === null) return <span className="cj-marca">{imagen}{iso}{rotulo}</span>
  return (
    <Link href={href} className="cj-marca">
      {imagen}
      {iso}
      {rotulo}
    </Link>
  )
}
