import { clasesFuentes } from '@/app/(shell)/fuentes'
import { EntradaCliente } from './EntradaCliente'
import { ESCUDO_TRAZOS } from './escudoTrazos'
import { SCRIPT_ENTRADA } from './entradaLogica'
import './entrada.css'

/**
 * Entrada animada del Despacho (13/11/2026, maqueta aprobada por Tomás): solo en el PRIMER ingreso de la sesión del navegador.
 * Telón verde, el escudo se construye trazo por trazo, viaja al logo de la barra mientras la página se abre en círculo,
 * aparecen los íconos, el contenido, las cifras cuentan y los botones se arman. Unos 6 s; se salta con un clic o una tecla.
 *
 * Cómo se evita el parpadeo sin frenar al servidor: el telón viene en el HTML OCULTO (entrada.css) y el script en línea que
 * va justo detrás corre antes de que se pinte el resto del marco. Solo si es la primera vez le pone data-fase="anda", y con
 * eso el CSS esconde la página y arranca la secuencia; si no, no hace nada y la página se pinta como siempre. Lo único que el
 * script toca antes de React es el atributo del telón (por eso lleva suppressHydrationWarning); el resto lo maneja
 * EntradaCliente después de hidratar. Va FUERA de .cj-raiz (hermano anterior) para que la apertura en círculo, que recorta
 * .cj-raiz, no recorte también al escudo. Las navegaciones internas no vuelven a montar el layout, así que no se repite.
 */
export function Entrada() {
  return (
    <>
      <div id="cj-telon" className={`cj-telon ${clasesFuentes}`} aria-hidden="true" suppressHydrationWarning>
        <div className="cj-telon__fondo" />
        <div className="cj-telon__marca">
          <div className="cj-telon__nombre">Capital Jurídico</div>
          <div className="cj-telon__linea">
            <i />
          </div>
        </div>
        <div className="cj-telon__escudo" dangerouslySetInnerHTML={{ __html: ESCUDO_TRAZOS }} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_ENTRADA }} />
      <EntradaCliente />
    </>
  )
}
