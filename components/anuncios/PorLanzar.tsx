'use client'

// ── Por lanzar: clientes ACTIVO del CRM sin fila en el tablero (todavía no gastaron) ─────────────────────────────────────
// Desde el 24/10/2026, con la FICHA DE KICKOFF del Despacho (lib/anuncios/porLanzar.ts): por cliente, lo que el media
// buyer necesita para armar la campaña sin abrir la ficha (cuenta con moneda y horario, presupuesto, lanzamiento, rama,
// avatar, zona con el mapa y lo del portfolio que lo frena), con el link a la ficha y a la grabación. Los grupos los arma
// porLanzar.ts (grupoPorLanzar): listos para armar (ficha + acceso a SU cuenta + nada que frene ni que confirmar), con
// ficha a revisar, con ficha sin acceso y con ficha que ya gastan con otro nombre. Los que no tienen ficha se ven como
// antes (acceso a Meta y etapa de ClickUp) con la marca "sin ficha de kickoff"; si la base no se pudo leer, sin la marca
// (no se sabe). La ficha del Despacho y la grabación de Fathom piden su propio login: el tablero se entra con la clave de
// Anuncios, así que acá va todo lo necesario para lanzar. Mismo estilo que el resto del tablero: filetes finos, sin
// sombras, latón = falta, salvia (--info) = listo.
// Desde el 26/10 (regla de Tomás) solo están los que ya tienen videos en «Editados - X» (lib/anuncios/editadosPorLanzar.ts):
// cada uno lleva el link a su carpeta. Los que todavía no tienen videos (antes, una línea al pie) van desde el 3/11 en su
// propio bloque, cada uno con la etapa donde está trabado y quién lo destraba (lib/anuncios/trabados.ts).
// También desde el 3/11: el estado de cada uno en el Doc «Organización de ADS - Orgánico» (LISTO · N videos, o la nota tal
// cual) y el botón «Leer el Doc de ADS ahora» (/api/anuncios/doc-ads: arma en pausa a los LISTOS y avisa a Valen).
// Y desde el 3/11 a la noche (línea de base, lib/bot/anuncios/docAdsBase.ts): «Por lanzar» muestra solo lo NUEVO. Los
// clientes cuyo bloque del Doc ya estaba el día de la línea de base (ya lanzados que quedaron en el Doc) se esconden; el
// filtro «Ver también lo histórico del Doc» los muestra, marcados como históricos.
import { useState, type ReactNode } from 'react'
import { NOMBRE_ETAPA_TRABA } from '@/lib/anuncios/trabados'
import type { PorLanzar } from '@/lib/anuncios/tablero'
import type { EstadoMapaLanzar, GrupoPorLanzar, KickoffPorLanzar } from '@/lib/anuncios/porLanzar'

type ConFicha = PorLanzar & { kickoff: KickoffPorLanzar }
const ROJO_SUAVE = '#c98085'   // el borgoña legible sobre el verde (el mismo de "Se están pasando" en presupuesto)
const COLOR_MAPA: Record<EstadoMapaLanzar, string> = { leido: 'var(--hueso)', anotado: 'var(--hueso)', revisar: 'var(--laton)', leyendo: 'var(--info)', pendiente: 'var(--laton)' }
const TITULO_FATHOM = 'Abre la grabación en Fathom (pide acceso a la grabación)'

const etapaTexto = (e: string | null) => (e ? e[0].toUpperCase() + e.slice(1) : 'Sin tarea en Seguimiento')
const cuentaCorta = (c: { id: string; nombre: string }) => `${c.nombre} (${c.id.replace('act_', '')})`

// Los videos editados de su carpeta de Drive (null = no se encontró la carpeta o Drive no respondió)
function Editados({ p }: { p: PorLanzar }) {
  const e = p.editados
  if (!e) return <span style={{ color: 'var(--humo)', fontSize: 13 }}>Carpeta de editados no encontrada</span>
  const t = `${e.cantidad} ${e.cantidad === 1 ? 'editado' : 'editados'}${e.ultimo ? `, último ${e.ultimo.slice(8, 10)}/${e.ultimo.slice(5, 7)}` : ''}`
  return e.url ? <a className="enlace" href={e.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>{t}</a> : <span style={{ fontSize: 13 }}>{t}</span>
}

// Su estado en el Doc de ADS (el bloque más nuevo): salvia (--info) = LISTO para lanzar; latón = otra nota o cruce dudoso
function DocAds({ p }: { p: PorLanzar }) {
  const d = p.docAds
  if (!d) return null
  if (d.historico) return <span style={{ fontSize: 13, color: 'var(--humo)' }} title={`Doc «Organización de ADS - Orgánico»: «${d.titulo}». Ya estaba en el Doc el día de la línea de base: el bot no hace nada con este bloque.`}>Doc de ADS (histórico): {d.texto}</span>
  return <span style={{ fontSize: 13, color: d.listo && d.firme ? 'var(--info)' : 'var(--laton)' }} title={`Doc «Organización de ADS - Orgánico»: «${d.titulo}»`}>Doc de ADS{d.nuevos ? ` (nuevo, ${d.nuevos} ${d.nuevos === 1 ? 'video nuevo' : 'videos nuevos'})` : ''}: {d.texto}</span>
}

const ACCION_DOC: Record<string, string> = {
  armado: 'armado en pausa', seco: 'prueba en seco', plan: 'para armar', ya_salio: 'ya armado o avisado', ya_tiene_campana: 'ya tiene campaña',
  falta_ficha: 'falta la ficha', falta_cuenta: 'falta la cuenta', sin_acceso: 'sin acceso del token', borrador_apagado: 'armado automático apagado',
  sin_videos_legibles: 'no puedo leer los videos', sin_copy: 'sin copy', error: 'error', solo_estado: 'no está LISTO', sin_tiempo: 'sigue en la próxima corrida',
  videos_nuevos: 'videos nuevos para sumar/rotar (avisado a Valen)', historico: 'histórico del Doc (no se toca)',
}
type RespDoc = { leido?: boolean; apagado?: boolean; lineaBase?: string; clientes?: { cliente: string; accion: string; detalle: string | null; doc: string; enviado?: boolean }[]; errores?: string[]; error?: string }

// El botón para el equipo: la misma corrida de las 9:05 (arma en pausa los LISTOS, avisa a Valen). Nada se prende en Meta.
function BotonDocAds() {
  const [estado, setEstado] = useState<'quieto' | 'leyendo'>('quieto')
  const [r, setR] = useState<RespDoc | null>(null)
  const leer = async () => {
    setEstado('leyendo'); setR(null)
    try {
      const x = await fetch('/api/anuncios/doc-ads', { method: 'POST' })
      setR(await x.json().catch(() => ({ error: `respuesta ${x.status}` })))
    } catch (e) { setR({ error: (e as Error).message }) }
    setEstado('quieto')
  }
  const listos = (r?.clientes ?? []).filter(c => c.accion !== 'solo_estado' && c.accion !== 'historico')
  return <div className="mt-3">
    <button type="button" className="enlace" onClick={leer} disabled={estado === 'leyendo'} style={{ fontSize: 13 }}>
      {estado === 'leyendo' ? 'Leyendo el Doc de ADS… (puede tardar un par de minutos si arma campañas)' : 'Leer el Doc de ADS ahora'}
    </button>
    {r && <div className="mt-2" style={{ fontSize: 12, color: 'var(--humo)' }}>
      {r.error ? <span style={{ color: 'var(--laton)' }}>No se pudo: {r.error}</span>
        : r.apagado ? <span style={{ color: 'var(--laton)' }}>La lectura del Doc está apagada (ANUNCIOS_DOC_ADS=0).</span>
          : r.lineaBase === 'creada' ? <span>Leído: se guardó la línea de base del Doc (todo lo que hay hoy queda como histórico). Desde ahora, solo lo nuevo.</span>
          : !listos.length ? <span>Leído: nada nuevo en el Doc (lo que ya estaba no se toca).</span>
            : <ul>{listos.map(c => <li key={c.cliente}>{c.cliente}: {ACCION_DOC[c.accion] ?? c.accion}{c.detalle ? ` · ${c.detalle}` : ''}{c.enviado ? ' · avisado en #📣-ads' : ''}</li>)}</ul>}
      {!!r.errores?.length && <div style={{ color: 'var(--laton)' }}>{r.errores.join(' · ')}</div>}
    </div>}
  </div>
}

function EtapaClickUp({ p }: { p: PorLanzar }) {
  return p.clickup ? <a className="enlace" href={p.clickup.url} target="_blank" rel="noopener noreferrer">{etapaTexto(p.etapa)}</a> : <>{etapaTexto(p.etapa)}</>
}

// Como antes del 24/10: nombre, etapa de ClickUp y cuentas visibles (o "pedir el portfolio"); con la marca si se sabe que no tiene ficha
function FilaSinFicha({ p }: { p: PorLanzar }) {
  return <li className="flex flex-col md:flex-row md:items-baseline gap-x-4 gap-y-0.5" style={{ padding: '8px 0', borderBottom: '1px solid var(--filete)' }}>
    <span style={{ fontWeight: 500, minWidth: 240 }}>
      {p.cliente}
      {p.sinFicha && <span className="etq" title="No hay una ficha de kickoff lista de este cliente en el Despacho" style={{ display: 'inline-block', marginLeft: 10, fontSize: 12, padding: '2px 6px', border: '1px solid var(--filete-fuerte)' }}>Sin ficha de kickoff</span>}
    </span>
    <span style={{ color: 'var(--humo)', fontSize: 14, minWidth: 190 }}><EtapaClickUp p={p} /></span>
    <Editados p={p} />
    <DocAds p={p} />
    <span style={{ fontSize: 14, flex: 1, color: p.acceso === 'si' ? 'var(--hueso)' : 'var(--laton)' }}>
      {p.acceso === 'si' ? p.cuentas.map(c => `Cuenta visible: ${cuentaCorta(c)}${c.estado === 1 ? '' : ' · con problema de estado'}`).join(' · ') : 'Sin acceso: pedir el portfolio'}
    </span>
  </li>
}

// Un cliente sin editados todavía: la etapa donde está trabado, el motivo, quién lo destraba y la fecha de su kickoff
function FilaEsperando({ p }: { p: PorLanzar }) {
  const t = p.traba
  const k = p.kickoff?.fechaIso ? new Date(p.kickoff.fechaIso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' }) : null
  return <li className="flex flex-col md:flex-row md:items-baseline gap-x-4 gap-y-0.5" style={{ padding: '8px 0', borderBottom: '1px solid var(--filete)' }}>
    <span style={{ fontWeight: 500, minWidth: 240 }}>{p.cliente}</span>
    <span style={{ fontSize: 14, minWidth: 190, color: 'var(--laton)' }}>{t ? NOMBRE_ETAPA_TRABA[t.etapa] : 'Etapa sin dato'}</span>
    <span style={{ fontSize: 14, flex: 1 }}>
      {t ? <>{t.motivo} → <b style={{ fontWeight: 500 }}>{t.responsable}</b></> : '—'}
      {!!t?.ademas.length && <span className="anu-laton">. Además: {t.ademas.join('; ')}</span>}
    </span>
    <span style={{ color: 'var(--humo)', fontSize: 13 }}>{k ? `Kickoff ${k}` : p.sinFicha ? 'Sin ficha de kickoff' : ''}</span>
  </li>
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return <div>
    <dt className="anu-chico" style={{ marginBottom: 4 }}>{etiqueta}</dt>
    <dd style={{ margin: 0, fontSize: 14 }}>{children}</dd>
  </div>
}
const Nota = ({ children, color = 'var(--humo)' }: { children: ReactNode; color?: string }) => <div style={{ marginTop: 3, fontSize: 12, color }}>{children}</div>

/** Qué pasa en el tablero con la cuenta que revisó la ficha (el acceso es el de ESA cuenta). */
function LineaCuentaFicha({ p }: { p: PorLanzar }) {
  const cf = p.cuentaFicha
  if (!cf) return null
  if (cf.estado === 'visible') return <Nota color="var(--info)">El tablero ya la ve{cf.cuenta.estado !== 1 ? ' · con problema de estado' : ''}</Nota>
  if (cf.estado === 'con_fila') return <Nota color="var(--hueso)">Ya gasta en el tablero como «{cf.cliente}»: el nombre de esa fila no es el del CRM (revisar «Cuentas Meta»)</Nota>
  if (cf.estado === 'excluida') return <Nota color="var(--laton)">El tablero no sigue esta cuenta ({cf.motivo}): revisar antes de armar</Nota>
  if (cf.estado === 'sin_dato') return <Nota>No se pudieron listar las cuentas de Meta: no se sabe si el tablero la ve</Nota>
  return <Nota color="var(--laton)">El tablero todavía no la ve: revisar el acceso</Nota>
}

function Cuenta({ p, k }: { p: PorLanzar; k: KickoffPorLanzar }) {
  const otras = p.cuentas.filter(c => c.id !== k.cuenta?.id)
  if (!k.cuenta) return <>
    <span style={{ color: 'var(--laton)' }}>La ficha no identificó la cuenta</span>
    {k.cuentaAviso && <Nota>{k.cuentaAviso}</Nota>}
    <Nota color={p.acceso === 'si' ? 'var(--hueso)' : 'var(--laton)'}>{p.acceso === 'si' ? `Visibles en el tablero (por el nombre): ${p.cuentas.map(cuentaCorta).join(' · ')}` : 'Sin acceso: pedir el portfolio'}</Nota>
  </>
  return <>
    <span className="num">{k.cuenta.id}</span>
    {k.cuenta.nombre && <Nota color="var(--hueso)">«{k.cuenta.nombre}»</Nota>}
    {k.cuenta.monedaHora && <Nota>{k.cuenta.monedaHora[0].toUpperCase() + k.cuenta.monedaHora.slice(1)}</Nota>}
    <LineaCuentaFicha p={p} />
    {k.cuentaAviso && <Nota color="var(--laton)">{k.cuentaAviso}</Nota>}
    {otras.length > 0 && <Nota>{p.cuentaFicha?.estado === 'visible' ? 'También visibles' : 'Otras visibles por el nombre (no son la de la ficha)'}: {otras.map(cuentaCorta).join(' · ')}</Nota>}
  </>
}

function Zona({ k }: { k: KickoffPorLanzar }) {
  const z = k.zona
  const donde = [z.lugares.length ? z.lugares.join(' · ') : z.descripcion, z.radioKm != null ? `radio ${z.radioKm} km` : ''].filter(Boolean).join(' · ')
  return <>
    <span>{donde || 'Sin definir'}</span>
    {z.presentarse && <Nota color="var(--hueso)">Se presenta como «{z.presentarse.texto}»{z.presentarse.cuando ? <span style={{ color: 'var(--humo)' }}> ({z.presentarse.cuando})</span> : null}</Nota>}
    {z.mapa && <Nota color={COLOR_MAPA[z.mapa.estado]}>
      {z.mapa.texto}
      {z.mapa.momento && <> · <a className="enlace" href={z.mapa.momento.href} target="_blank" rel="noopener noreferrer" title={`${TITULO_FATHOM}, en ese minuto`}>▶ {z.mapa.momento.etiqueta}</a></>}
    </Nota>}
  </>
}

// La etiqueta de la cabecera de la tarjeta: el acceso, salvo que ya gaste con otro nombre o la cuenta esté fuera del tablero
function EtiquetaAcceso({ p }: { p: PorLanzar }) {
  const [texto, color] = p.grupo === 'ya_gasta' ? ['Ya gasta en el tablero', 'var(--hueso)']
    : p.cuentaFicha?.estado === 'excluida' ? ['Cuenta fuera del tablero', 'var(--laton)']
      : p.acceso === 'si' ? ['Con acceso a Meta', 'var(--info)'] : ['Sin acceso a Meta', 'var(--laton)']
  return <span className="etq" style={{ color }}>{texto}</span>
}

function TarjetaKickoff({ p }: { p: ConFicha }) {
  const k = p.kickoff
  const frenan = k.frenos.filter(f => f.frena), tildar = k.frenos.filter(f => !f.frena)
  const lanzamiento = k.lanzamiento.texto.replace(/^Lanzamiento:\s*/, '')
  return <li style={{ padding: '14px 0', borderBottom: '1px solid var(--filete)' }}>
    <div className="flex flex-col md:flex-row md:flex-wrap md:items-baseline gap-x-4 gap-y-1">
      <span style={{ fontWeight: 500, fontSize: 16 }}>{p.cliente}</span>
      <Editados p={p} />
      <DocAds p={p} />
      <span style={{ color: 'var(--humo)', fontSize: 13 }}>Kickoff {k.fecha ?? 'sin fecha'}{k.quien ? ` · Fathom de ${k.quien}` : ''}</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {k.link && <a className="enlace" href={k.link} target="_blank" rel="noopener noreferrer" title="La ficha completa en el Despacho: pide login de Google con acceso a Clientes (la clave de Anuncios no alcanza)">Ficha en el Despacho (login de Google)</a>}
        {k.fathom && <a className="enlace" href={k.fathom} target="_blank" rel="noopener noreferrer" title={TITULO_FATHOM}>Grabación en Fathom</a>}
      </span>
      <EtiquetaAcceso p={p} />
    </div>
    {p.confirmar && <p className="mt-2" style={{ fontSize: 13, color: 'var(--laton)' }}>{p.confirmar}</p>}
    <dl className="mt-3 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
      <Dato etiqueta="Cuenta publicitaria"><Cuenta p={p} k={k} /></Dato>
      <Dato etiqueta="Presupuesto">
        <span className="num">{k.presupuesto.texto}</span>
        {k.presupuesto.aConfirmar && <Nota color="var(--laton)">A confirmar</Nota>}
      </Dato>
      <Dato etiqueta="Lanzamiento">
        {k.lanzamiento.fecha ? <><span>Fecha estimada: {k.lanzamiento.fecha}</span><Nota>{lanzamiento}</Nota></> : <span style={{ color: 'var(--laton)' }}>{lanzamiento}</span>}
        {k.whatsapp && <Nota color="var(--hueso)">WhatsApp de destino: {k.whatsapp}</Nota>}
      </Dato>
      <Dato etiqueta="Rama">
        <span>{k.rama.nombre ?? (k.rama.texto || 'Sin definir')}</span>
        {k.rama.subramas.length > 0 && <Nota color="var(--hueso)">Subramas: {k.rama.subramas.join(' · ')}</Nota>}
      </Dato>
      <Dato etiqueta="Avatar">
        {k.avatar.incluye.length > 0 ? <span>{k.avatar.incluye.join(' · ')}</span> : <span style={{ color: 'var(--humo)' }}>Sin filtros de quién sí</span>}
        {k.avatar.excluye.length > 0 && <Nota>Afuera: {k.avatar.excluye.join(' · ')}</Nota>}
      </Dato>
      <Dato etiqueta="Zona"><Zona k={k} /></Dato>
    </dl>
    {frenan.length > 0 && <p className="mt-3" style={{ fontSize: 13, color: ROJO_SUAVE }}>
      <b style={{ fontWeight: 500 }}>Frena el lanzamiento:</b> {frenan.map(f => `${f.nombre} (${f.estado}${f.detalle ? `: ${f.detalle}` : ''})`).join(' · ')}
    </p>}
    {tildar.length > 0 && <p className="mt-2" style={{ fontSize: 13, color: 'var(--laton)' }}>
      Portfolio para revisar a mano (ni Meta ni la llamada lo confirmaron): {tildar.map((f, i) => <span key={f.item} title={f.detalle}>{i ? ' · ' : ''}{f.nombre}</span>)}
    </p>}
    {k.ojos.length > 0 && <p className="mt-2" style={{ fontSize: 13, color: 'var(--laton)' }}>
      Ojo, Meta y la llamada no coinciden (no frena, revisar): {k.ojos.join(' · ')}
    </p>}
    {k.otrosFaltantes.length > 0 && <p className="mt-2" style={{ fontSize: 12, color: 'var(--humo)' }}>También falta en la ficha: {k.otrosFaltantes.join(' · ')}</p>}
    <p className="mt-2" style={{ fontSize: 12, color: 'var(--humo)' }}>
      Ideas de guiones: {k.ideas} · ClickUp (mientras conviva): <EtapaClickUp p={p} />
    </p>
  </li>
}

// Los grupos con ficha, en el orden de porLanzar.ts
const GRUPOS_FICHA: { grupo: GrupoPorLanzar; titulo: string; info?: boolean }[] = [
  { grupo: 'listo', titulo: 'Listos para armar · ficha de kickoff, acceso a su cuenta y nada que frene', info: true },
  { grupo: 'revisar', titulo: 'Con ficha de kickoff, revisar antes de armar' },
  { grupo: 'sin_acceso', titulo: 'Con ficha de kickoff, falta el acceso a Meta' },
  { grupo: 'ya_gasta', titulo: 'Con ficha de kickoff, ya gastan en el tablero con otro nombre' },
]

export function PanelPorLanzar({ items: todosItems, avisos = [], sinEditados = [], esperando: todosEsperando = [] }: { items: PorLanzar[]; avisos?: string[]; sinEditados?: string[]; esperando?: PorLanzar[] }) {
  // Solo lo nuevo: los de bloque histórico en el Doc (ya lanzados) se esconden, salvo con el filtro
  const [verHistorico, setVerHistorico] = useState(false)
  const historicos = [...todosItems, ...todosEsperando].filter(p => p.docAds?.historico).length
  const items = verHistorico ? todosItems : todosItems.filter(p => !p.docAds?.historico)
  const esperando = verHistorico ? todosEsperando : todosEsperando.filter(p => !p.docAds?.historico)
  if (!todosItems.length && !avisos.length && !sinEditados.length && !todosEsperando.length) return null
  const conFicha = items.filter((p): p is ConFicha => !!p.kickoff)
  const resto = items.filter(p => !p.kickoff)
  const sin = resto.filter(p => p.acceso === 'no'), con = resto.filter(p => p.acceso === 'si')
  const seLeyoLaBase = items.some(p => p.kickoff || p.sinFicha)
  const sinAccesoTotal = items.filter(p => p.acceso === 'no').length
  // Sin la base, los dos grupos de antes, tal cual; con la base, dentro de "Sin ficha de kickoff"
  const T = seLeyoLaBase ? 'h4' : 'h3'
  const gruposSinFicha = <>
    {!!sin.length && <section aria-label="Sin acceso" className="mt-4"><T className="etq-laton">Sin acceso a Meta · {sin.length}</T><ul>{sin.map(p => <FilaSinFicha key={p.cliente} p={p} />)}</ul></section>}
    {!!con.length && <section aria-label="Con acceso" className="mt-6"><T className="etq anu-info">Con acceso, esperando lanzar · {con.length}</T><ul>{con.map(p => <FilaSinFicha key={p.cliente} p={p} />)}</ul></section>}
  </>
  return <details id="por-lanzar" aria-label="Por lanzar" className="anu-solapa">
    <summary className="etq-laton">Por lanzar: {items.length}{seLeyoLaBase ? `, con ficha ${conFicha.length}` : ''}, sin acceso {sinAccesoTotal}{avisos.length ? ', con avisos' : ''}</summary>
    {avisos.length > 0 && <ul className="mt-3" aria-label="Avisos de Por lanzar" style={{ fontSize: 13, color: 'var(--laton)' }}>
      {avisos.map(a => <li key={a} style={{ marginTop: 4 }}>{a}</li>)}
    </ul>}
    <p className="mt-3 anu-nota">
      Clientes activos del CRM que todavía no gastaron (no tienen fila en el tablero) y ya tienen videos editados para lanzar. Aparecen solos en el tablero cuando empiezan a gastar.
      {seLeyoLaBase ? ' Con ficha de kickoff: lo que hace falta para armar la campaña, sacado de la ficha del Despacho; el acceso es el de la cuenta que revisó la ficha. Sin ficha: como antes, con la etapa de ClickUp.' : ''}
      {' '}«Cuenta visible» = el tablero ya puede leer su cuenta de Meta; si no, falta el acceso al portfolio.
      {' '}«Doc de ADS» = su estado en «Organización de ADS - Orgánico»: los LISTOS los arma el bot en pausa a las 9:05 y avisa a Valen.
    </p>
    <BotonDocAds />
    {historicos > 0 && <label className="mt-2 flex items-center gap-2" style={{ fontSize: 13, color: 'var(--humo)', cursor: 'pointer' }}>
      <input type="checkbox" checked={verHistorico} onChange={e => setVerHistorico(e.target.checked)} />
      Ver también lo histórico del Doc ({historicos} {historicos === 1 ? 'cliente' : 'clientes'} que ya estaban en el Doc el día de la línea de base: el bot no los toca)
    </label>}
    {GRUPOS_FICHA.map(({ grupo, titulo, info }) => {
      const xs = conFicha.filter(p => p.grupo === grupo)
      return xs.length > 0 && <section key={grupo} aria-label={titulo} className="mt-6">
        <h3 className={info ? 'etq anu-info' : 'etq-laton'}>{titulo} · {xs.length}</h3>
        <ul>{xs.map(p => <TarjetaKickoff key={p.cliente} p={p} />)}</ul>
      </section>
    })}
    {!!resto.length && (seLeyoLaBase
      ? <section aria-label="Sin ficha de kickoff" className="mt-6"><h3 className="etq">Sin ficha de kickoff · {resto.length}</h3>{gruposSinFicha}</section>
      : gruposSinFicha)}
    {esperando.length > 0
      ? <section aria-label="Todavía sin videos editados" className="mt-6">
        <h3 className="etq-laton">Todavía sin videos en «Editados» · {esperando.length} · dónde está trabado cada uno</h3>
        <ul>{esperando.map(p => <FilaEsperando key={p.cliente} p={p} />)}</ul>
      </section>
      : !!sinEditados.length && <p className="mt-6" style={{ color: 'var(--humo)', fontSize: 13 }}>
        Todavía sin videos editados ({sinEditados.length}): {sinEditados.join(' · ')}. Aparecen arriba cuando René sube los primeros.
      </p>}
  </details>
}
