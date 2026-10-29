import { ChipSemaforo, Etiqueta } from '@/components/ui'
import type { VistaKickoff } from '@/lib/bot/kickoff/vista'
import { SeccionFicha } from '../../_componentes/SeccionFicha'
import { Dato, Evidencia, ListaDatos, Momento } from './Dato'
import { RefrescoMapa } from './RefrescoMapa'

// Lo que define la campaña (c02 a c04 del doc "Sistema de tareas - C.J"): rama con subramas, descartadas y a futuro; avatar
// (filtros que incluye y excluye, y aparte el contexto del mercado, que no es un filtro); zona; presupuesto (con cuánto se
// arranca). Cada dato con su ▶ minuto de Fathom.
// La zona va en este orden: lo que SE DIJO en la llamada (la descripción, los lugares que se nombraron, cómo se presenta),
// después lo que SE VE en el video (el mapa leído, con chips de otro estilo: punteados) y al final las diferencias. Antes el
// bloque del video iba arriba con los mismos chips que lo dicho y la descripción lo contradecía sin decir de dónde salía.
// Mientras el bot lee el mapa (pedido o leyendo) no se pide anotarlo a mano: se dice que lo está leyendo y la página se
// recarga sola (RefrescoMapa) hasta que llega.

export function Rama({ r }: { r: VistaKickoff['rama'] }) {
  return (
    <SeccionFicha etiqueta="Rama" titulo={r.principal ?? 'Rama sin definir'}>
      {r.texto && <Dato d={r.dato} />}
      <div className="ko-grupos">
        <div className="ko-grupo">
          <Etiqueta como="h3">Subramas</Etiqueta>
          <ListaDatos datos={r.subramas} vacio="Sin subramas." />
        </div>
        <div className="ko-grupo">
          <Etiqueta como="h3">Descartadas</Etiqueta>
          <ListaDatos datos={r.descartadas} vacio="Ninguna." extra={d => d.motivo || undefined} />
        </div>
        <div className="ko-grupo">
          <Etiqueta como="h3">A futuro</Etiqueta>
          <ListaDatos datos={r.aFuturo} vacio="Nada." />
        </div>
      </div>
    </SeccionFicha>
  )
}

export function Avatar({ a }: { a: VistaKickoff['avatar'] }) {
  return (
    <SeccionFicha etiqueta="Avatar" titulo="A quién busca">
      <div className="ko-grupos">
        <div className="ko-grupo">
          <Etiqueta como="h3">Incluye</Etiqueta>
          <ListaDatos datos={a.incluye} vacio="Sin filtros." />
        </div>
        <div className="ko-grupo">
          <Etiqueta como="h3">Excluye</Etiqueta>
          <ListaDatos datos={a.excluye} vacio="Sin exclusiones." />
        </div>
        {a.contexto.length > 0 && (
          <div className="ko-grupo">
            <Etiqueta como="h3">Contexto (no es filtro)</Etiqueta>
            <ListaDatos datos={a.contexto} vacio="" />
          </div>
        )}
      </div>
    </SeccionFicha>
  )
}

/** Una lista corta con su título (dentro del bloque del mapa), o nada si está vacía. */
function Lista({ titulo, xs, ojo, video }: { titulo: string; xs: string[]; ojo?: boolean; video?: boolean }) {
  if (!xs.length) return null
  return (
    <div className="ko-grupo ko-mapa__grupo">
      <Etiqueta como="h4">{titulo}</Etiqueta>
      <ul className={ojo ? 'ko-mapa__ojos' : video ? 'ko-lugares ko-lugares--video' : 'ko-lugares'}>{xs.map(x => <li key={x}>{x}</li>)}</ul>
    </div>
  )
}

type Mapa = NonNullable<VistaKickoff['zona']['video']>

/** El mapa leído del video (tarea c03): lo marcado (con ✓ lo que se dijo), límites, radio y lo que no coincide con lo dicho. */
function MapaVideo({ m }: { m: Mapa }) {
  return (
    <div className="ko-mapa" role="group" aria-label="Mapa de la zona según el video">
      <p className="ko-mapa__cabecera">
        <ChipSemaforo estado={m.tono}>{m.texto}</ChipSemaforo>
        {m.fuente && <span className="cj-texto-2">{m.fuente}</span>}
        {m.momento && <span>Según el video: <Momento m={m.momento} que="el mapa de la zona" /></span>}
      </p>
      {m.leyendo && <RefrescoMapa />}
      {m.estado === 'ok' && (
        <>
          <Lista titulo={m.conPin ? 'Ubicación marcada' : 'Marcado en el mapa'} xs={m.marcados.map(x => `${x.nombre}${x.dicho ? ' ✓ se dijo' : ''}`)} video />
          {(m.limites || m.radio) && (
            <p className="ko-dato__texto">{[m.limites, m.radio ? `Radio: ${m.radio}` : ''].filter(Boolean).join(' · ')}</p>
          )}
          <Lista titulo="Dentro del círculo se lee" xs={m.dentroCirculo} video />
          <Lista titulo="Excluidas" xs={m.excluidas} video />
          <Lista titulo="Se leen sin saber si quedan dentro" xs={m.sinPosicion} video />
          <Lista titulo="No coincide con lo dicho" xs={m.ojos} ojo />
          <Lista titulo="Para revisar (parecido)" xs={m.revisar} ojo />
          <Lista titulo="El mapa no permite verificar" xs={m.noVerificables} />
          <Lista titulo="En el mapa, sin que se dijera" xs={m.tambien} video />
          {m.notas && <p className="ko-sub">{m.notas}</p>}
        </>
      )}
    </div>
  )
}

/** Lo que se dice del mapa cuando todavía no hay un recorte leído: lo está leyendo el bot, no estaba en esos minutos, o anotarlo. */
function NotaMapa({ z }: { z: VistaKickoff['zona'] }) {
  const v = z.video
  if (v?.leyendo) {
    return (
      <p className="ko-nota" role="note">
        El bot está leyendo el mapa del video (suele tardar unos minutos): la página se actualiza sola, o recargala en un rato. Si no
        coincide con lo dicho, aparece acá en rojo.
      </p>
    )
  }
  if (v?.estado === 'sin_mapa') {
    return (
      <p className="ko-nota" role="note">
        En los minutos en que se habló de la zona{v.rango ? ` (${v.rango}, los que miró el bot)` : ''} el video no muestra el mapa: puede
        haberse compartido en otro momento. Buscalo en la grabación
        {z.mapaMomento ? <> (se habló de la zona en el <Momento m={z.mapaMomento} que="cuando se habló de la zona" />)</> : null} y anotá el recorte en «Falta completar».
      </p>
    )
  }
  return (
    <p className="ko-nota" role="note">
      Se marcó en un mapa compartido en pantalla: el recorte exacto no está en la transcripción (ni en la cuenta, que todavía no tiene campañas).
      {' '}{z.mapaMomento ? <>Se ve en la grabación: <Momento m={z.mapaMomento} que="el mapa de la zona" />. </> : 'Se ve en la grabación. '}
      Anotalo en «Falta completar» (marcándolo como hecho, con la nota): le sirve a Valentino para cargar la zona.
    </p>
  )
}

export function Zona({ z }: { z: VistaKickoff['zona'] }) {
  const leida = z.video?.estado === 'ok' && z.video.util
  const hayMapa = z.mapa || !!z.video
  return (
    <SeccionFicha etiqueta="Zona" titulo="Dónde">
      <Etiqueta como="h3">Lo que se dijo en la llamada</Etiqueta>
      {z.descripcion.texto ? <Dato d={z.descripcion} /> : <p className="ko-vacio">Zona sin definir.</p>}
      {z.lugares.length > 0 && (
        <div className="ko-grupo">
          <Etiqueta como="h4">Lugares que se nombraron</Etiqueta>
          <ul className="ko-lugares">
            {z.lugares.map(l => <li key={l}>{l}</li>)}
          </ul>
        </div>
      )}
      <div className="ko-grupos">
        {z.presentarse && (
          <div className="ko-grupo">
            <Etiqueta como="h4">Se presenta como</Etiqueta>
            <Dato d={{ ...z.presentarse, texto: `«${z.presentarse.texto}»` }} extra={z.presentarse.cuando || undefined} />
          </div>
        )}
        {(z.radioKm !== null || z.pais) && (
          <div className="ko-grupo">
            <Etiqueta como="h4">Radio y país</Etiqueta>
            <p className="ko-dato__texto">
              {z.radioKm !== null ? `${z.radioKm} km` : 'Sin radio'}
              {z.pais ? ` · ${z.pais}` : ''}
            </p>
          </div>
        )}
      </div>
      {z.contexto.length > 0 && (
        <div className="ko-grupo">
          <Etiqueta como="h4">Contexto (no es límite de la zona)</Etiqueta>
          <ListaDatos datos={z.contexto} vacio="" />
        </div>
      )}
      {hayMapa && (
        <div className="ko-grupo">
          <Etiqueta como="h3">{z.video ? 'Lo que se ve en el video' : 'El mapa en pantalla'}</Etiqueta>
          {z.mapa && !leida && <NotaMapa z={z} />}
          {z.video && <MapaVideo m={z.video} />}
        </div>
      )}
    </SeccionFicha>
  )
}

export function Presupuesto({ p }: { p: VistaKickoff['presupuesto'] }) {
  return (
    <SeccionFicha etiqueta="Presupuesto" titulo="Cuánto por día">
      <div className="ko-dato">
        <p className="ko-cifra cj-num">{p.texto}</p>
        <p className="ko-sub">
          {p.certeza}
          {p.deducido ? ' · con montos deducidos: confirmarlos' : ''}
          {p.moneda && p.moneda !== 'USD' ? ` · se acordó en ${p.moneda}` : ''}
        </p>
        <Evidencia d={p.dato} />
      </div>
      {p.mes && (p.mes.momento || p.mes.cita) && <Dato d={p.mes} />}
      {p.acordado && (
        <div className="ko-grupo">
          <Etiqueta como="h3">Cómo se acordó</Etiqueta>
          <p className="ko-dato__texto">{p.acordado}</p>
        </div>
      )}
    </SeccionFicha>
  )
}
