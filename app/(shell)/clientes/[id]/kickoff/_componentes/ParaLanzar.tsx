import type { ClaveDato } from '@/lib/bot/kickoff/revision'
import type { VistaKickoff } from '@/lib/bot/kickoff/vista'
import { SeccionFicha } from '../../_componentes/SeccionFicha'
import { Momento } from './Dato'
import { MarcaFaltante } from './MarcaFaltante'

// "Para lanzar": lo que necesita Valentino para armar la campaña sin mirar la grabación (antes estaba en la tarjeta de
// ClickUp): cuenta act_… con su moneda y su hora, página, presupuesto de arranque, zona (con el ▶ del mapa y la nota del
// recorte, si ya se anotó; si no, el recorte leído del mapa en el video: con un pin de Meta, la ubicación con su radio),
// avatar, estado de las ideas y cuándo se lanza. Si el video dice otra cosa que lo dicho y nadie lo revisó, se avisa aunque
// haya una nota anotada antes; mientras el bot lo lee, eso. Abajo, los dos datos que Meta no deja leer y se cargan a mano:
// fecha estimada y WhatsApp de destino. Sin ganadores ni acuerdos: el mismo modelo (vista.lanzar) sirve para mostrarlo en
// /anuncios si Tomás decide que Valentino lo vea ahí.
const DATO: Record<ClaveDato, { placeholder: string; tipo: 'texto' | 'telefono' }> = {
  fecha_lanzamiento: { placeholder: 'Por ejemplo: lun 2/11 o primera semana de noviembre', tipo: 'texto' },
  whatsapp_destino: { placeholder: '+54 9 …', tipo: 'telefono' },
}

export function ParaLanzar({ l, idCliente, recordingId, demo }: { l: VistaKickoff['lanzar']; idCliente: string; recordingId: number; demo: boolean }) {
  return (
    <SeccionFicha etiqueta="Para lanzar" titulo="Lo que necesita Valentino">
      <dl className="ko-lanzar">
        <div>
          <dt className="cj-etiqueta">Cuenta publicitaria</dt>
          <dd>{l.cuenta ?? 'Sin identificar: cargarla en «Cuentas Meta» del CRM'}{l.monedaHora ? ` · ${l.monedaHora}` : ''}</dd>
        </div>
        {l.pagina && (
          <div>
            <dt className="cj-etiqueta">Página</dt>
            <dd>{l.pagina}</dd>
          </div>
        )}
        <div>
          <dt className="cj-etiqueta">Presupuesto</dt>
          <dd className="cj-num">{l.presupuesto}</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Zona</dt>
          <dd>
            {l.zona.texto}
            {l.zona.nota ? <><br /><span className="ko-sub">Recorte del mapa: {l.zona.nota}</span></>
              : l.zona.video ? <><br /><span className="ko-sub">Recorte según el video: {l.zona.video}{l.zona.momento && <> <Momento m={l.zona.momento} que="el mapa de la zona" /></>}</span></>
                : l.zona.momento ? <><br /><span className="ko-sub">Recorte en el mapa: <Momento m={l.zona.momento} que="el mapa de la zona" />{l.zona.leyendo ? ' (el bot lo está leyendo del video)' : ' (sin anotar todavía)'}</span></> : null}
            {l.zona.nota && l.zona.revisar && (
              <><br /><span className="ko-ojo">Ojo: el mapa del video dice otra cosa que lo dicho{l.zona.momento ? <> (<Momento m={l.zona.momento} que="el mapa de la zona" />)</> : null}: confirmarlo con Tomi antes de cargar.</span></>
            )}
          </dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Avatar</dt>
          <dd>{l.avatar}</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Ideas</dt>
          <dd>{l.ideas}</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Lanzamiento</dt>
          <dd>{l.lanzamiento.replace(/^Lanzamiento: /, '')}</dd>
        </div>
      </dl>
      <div className="ko-grupos">
        {l.datos.map(d => (
          <div key={d.clave} className="ko-grupo">
            <MarcaFaltante idCliente={idCliente} recordingId={recordingId} clave={d.clave} demo={demo}
              dato={{ nombre: d.nombre, ...DATO[d.clave] }}
              actual={d.marca ? { nota: d.marca.nota, quien: d.marca.quien, cuandoTexto: d.marca.cuandoTexto, cuando: d.marca.cuando } : null} />
          </div>
        ))}
      </div>
    </SeccionFicha>
  )
}
