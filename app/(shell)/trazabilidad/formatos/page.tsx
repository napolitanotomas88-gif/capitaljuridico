import type { Metadata } from 'next'
import Link from 'next/link'
import { exigirAcceso } from '@/lib/auth/sesion'
import { Cifra, SeccionTitulo, Tabla, Vacio, type Columna } from '@/components/ui'
import { hoyYMD, sumarDias } from '@/lib/eodSetter'
import { leerCierres } from '@/lib/trazabilidad/cierres'
import { listarAngulos, listarConceptos } from '@/lib/trazabilidad/db'
import { agruparFormatos, conceptoDeVideo, type ConceptoMin, type FilaGrupo } from '@/lib/trazabilidad/formatosCalc'
import { META_N } from '@/lib/trazabilidad/modelo'
import { Barra, SubNav, fechaCorta, nombreMes, pctTxt, usd } from '../_componentes/comunes'

export const metadata: Metadata = { title: 'Formatos · Trazabilidad' }
export const dynamic = 'force-dynamic'

const FORMATO: Record<string, string> = {
  acting: 'Acting', pizarra: 'Pizarra', testimonio_directo: 'Testimonio directo', caso_contado: 'Caso contado', directo_a_camara: 'Directo a cámara',
  oferta_directa: 'Oferta directa', comentario_respuesta: 'Respuesta a comentario', entrevista_podcast: 'Entrevista / podcast', texto_broll: 'Texto sobre imágenes', otro: 'Otro',
}

// Qué FORMATO y qué ÁNGULO de anuncio traen agendas y pagadores (cobró ≥ 1ª cuota). Cada agenda se atribuye por la columna
// Video del CRM. Solo descripción: con menos de 120 pagadores, direccional. Lo que llega por DM o bio no tiene anuncio y
// queda fuera de esta vista (es la mayoría de los que pagan: ver Reporte mensual).
export default async function FormatosPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await exigirAcceso('trazabilidad')
  const { p } = await searchParams
  const [{ agendas: todas }, { conceptos, anuncios }, angulos] = await Promise.all([leerCierres(), listarConceptos(), listarAngulos()])
  const hoy = hoyYMD()
  const periodo = p === 'todo' || (p && /^\d{4}-\d{2}$/.test(p)) ? p : '3m'
  const desde = periodo === 'todo' ? '2026-01-01' : periodo === '3m' ? sumarDias(hoy, -90) : `${periodo}-01`
  const hasta = periodo === 'todo' || periodo === '3m' ? hoy : `${periodo}-31`
  const agendas = todas.filter((a) => a.fecha >= desde && a.fecha <= hasta)
  const conGasto = periodo === 'todo'
  const nombreAngulo = new Map(angulos.map((a) => [a.id, a.nombre]))
  const min: ConceptoMin[] = conceptos.map((c) => ({ clave: c.clave, formato: c.formato, angulo: c.angulo, gasto: c.gasto }))
  const porFormato = agruparFormatos(agendas, min, anuncios, (c) => FORMATO[c.formato] ?? c.formato, conGasto)
  const porAngulo = agruparFormatos(agendas, min, anuncios, (c) => (c.angulo ? nombreAngulo.get(c.angulo) ?? c.angulo : null), conGasto)
  const cruce = agruparFormatos(agendas, min, anuncios, (c) => (c.angulo ? `${FORMATO[c.formato] ?? c.formato} · ${nombreAngulo.get(c.angulo) ?? c.angulo}` : null), conGasto)
  const porConcepto = agruparFormatos(agendas, min, anuncios, (c) => c.clave, conGasto)
  const info = new Map(conceptos.map((c) => [c.clave, c]))
  const pagadores = agendas.filter((a) => a.grupo === 'muestra')
  const pagConAnuncio = pagadores.filter((a) => conceptoDeVideo(a.video, anuncios)).length
  const gastoAl = conceptos.find((c) => c.gastoAl)?.gastoAl ?? null
  const meses = [...new Set(todas.filter((a) => a.fecha >= '2026-01-01').map((a) => a.fecha.slice(0, 7)))].sort().reverse()
  const chip = (v: string, t: string) => <Link key={v} className="cj-chip" aria-current={periodo === v ? 'page' : undefined} href={`/trazabilidad/formatos?p=${v}`}>{t}</Link>

  const columnas = (titulo: string): Columna<FilaGrupo>[] => [
    { clave: 'grupo', titulo, largo: true },
    { clave: 'conceptos', titulo: 'Videos', numerica: true },
    ...(conGasto ? [{ clave: 'gasto', titulo: 'Gasto VSL/RTG/UY', numerica: true, celda: (f: FilaGrupo) => usd(f.gasto) }] : []),
    { clave: 'agendas', titulo: 'Agendas', numerica: true },
    { clave: 'pagadores', titulo: 'Pagadores', numerica: true, celda: (f) => `${f.pagadores} de ${f.ventas}` },
    { clave: 'cash', titulo: 'Cash / agenda', celda: (f) => <Barra laton valor={Math.min(1, f.cashPorAgenda / 600)} texto={usd(f.cashPorAgenda)} /> },
    ...(conGasto ? [{ clave: 'dolar', titulo: 'Cash por dólar', numerica: true, celda: (f: FilaGrupo) => (f.cashPorDolar == null ? '—' : f.cashPorDolar.toFixed(2).replace('.', ',')) }] : []),
    { clave: 'piso', titulo: 'Piso pagadores', numerica: true, celda: (f) => pctTxt(f.pisoPagadores) },
  ]
  const conAgendas = (fs: FilaGrupo[], minimo = 1) => fs.filter((f) => f.agendas >= minimo)

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Trazabilidad · Formatos" titulo="Qué tipo de video trae a los que pagan" />
      <SubNav actual="/trazabilidad/formatos" />
      <div className="cj-fila" role="group" aria-label="Período">
        {chip('3m', 'Últimos 90 días')}
        {chip('todo', 'Todo 2026 (con gasto)')}
        {meses.map((m) => chip(m, nombreMes(m)))}
      </div>
      {!conceptos.length && <p className="traz-error" role="alert">Todavía no hay conceptos clasificados (tabla cj_traz_conceptos vacía).</p>}

      <div className="cj-rejilla">
        <Cifra etiqueta="Agendas con anuncio" valor={`${agendas.length - porFormato.sinAnuncio}/${agendas.length}`} contexto={`${pctTxt((agendas.length - porFormato.sinAnuncio) / Math.max(1, agendas.length))} se puede atribuir a un video`} />
        <Cifra etiqueta="Pagadores con anuncio" valor={`${pagConAnuncio}/${pagadores.length}`} contexto="el resto llegó por DM, bio u otro" />
        <Cifra etiqueta="Videos clasificados" valor={conceptos.length} contexto={`formato y ángulo por mayoría de 3${gastoAl ? ` · gasto al ${fechaCorta(gastoAl)}` : ''}`} />
      </div>
      <p className="traz-texto traz-direccional">
        <strong>{pagConAnuncio} pagadores con anuncio en este período.</strong> Con menos de {META_N} todo es <strong>direccional</strong>. «Piso pagadores» es el
        mínimo creíble de la tasa de pagadores por agenda (castiga las muestras chicas). El cash por dólar solo se muestra en «Todo 2026», porque el gasto es acumulado, y cuenta solo VSL, RTG y UY: Follow Me Ads lleva al perfil y sus agendas llegan por DM, sin video.
        {porFormato.sinClasificar > 0 && ` ${porFormato.sinClasificar} agendas vienen de videos todavía sin clasificar.`}
      </p>

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Formato" titulo="Por formato" />
        <Tabla descripcion="Agendas y pagadores por formato de video" columnas={columnas('Formato')} filas={conAgendas(porFormato.filas)} claveFila={(f) => f.grupo} vacio={<Vacio frase="Sin agendas atribuidas en este período." />} />
      </section>
      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Ángulo" titulo="Por ángulo del video" />
        <Tabla descripcion="Agendas y pagadores por ángulo" columnas={columnas('Ángulo')} filas={conAgendas(porAngulo.filas)} claveFila={(f) => f.grupo} vacio={<Vacio frase="Sin agendas atribuidas en este período." />} />
      </section>
      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Combinación" titulo="Formato × ángulo (5 agendas o más)" />
        <Tabla descripcion="Combinaciones de formato y ángulo" columnas={columnas('Formato · ángulo')} filas={conAgendas(cruce.filas, 5)} claveFila={(f) => f.grupo} vacio={<Vacio frase="Ninguna combinación llega a 5 agendas en este período." />} />
      </section>
      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Videos" titulo="Videos con pagadores o con más agendas" />
        <Tabla
          descripcion="Videos individuales"
          filas={porConcepto.filas.filter((f) => f.agendas > 0).sort((a, b) => b.pagadores - a.pagadores || b.cash - a.cash || b.agendas - a.agendas).slice(0, 30)}
          claveFila={(f) => f.grupo}
          vacio={<Vacio frase="Sin agendas atribuidas en este período." />}
          columnas={[
            { clave: 'grupo', titulo: 'Video', largo: true, celda: (f) => <>{f.grupo}<br /><span className="traz-nota">{info.get(f.grupo)?.gancho}</span></> },
            { clave: 'formato', titulo: 'Formato · ángulo', largo: true, celda: (f) => { const c = info.get(f.grupo); return c ? `${FORMATO[c.formato] ?? c.formato} · ${c.angulo ? nombreAngulo.get(c.angulo) ?? c.angulo : '—'}${c.acuerdo < 2 ? ' (dudoso)' : ''}` : '—' } },
            { clave: 'agendas', titulo: 'Agendas', numerica: true },
            { clave: 'pagadores', titulo: 'Pagadores', numerica: true, celda: (f) => `${f.pagadores} de ${f.ventas}` },
            { clave: 'cash', titulo: 'Cash', numerica: true, celda: (f) => usd(f.cash) },
            ...(conGasto ? [{ clave: 'dolar', titulo: 'Cash por dólar', numerica: true, celda: (f: FilaGrupo) => (f.cashPorDolar == null ? '—' : f.cashPorDolar.toFixed(2).replace('.', ',')) }] : []),
          ]}
        />
      </section>
    </div>
  )
}
