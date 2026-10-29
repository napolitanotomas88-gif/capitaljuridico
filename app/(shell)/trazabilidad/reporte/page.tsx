import type { Metadata } from 'next'
import Link from 'next/link'
import { exigirAcceso } from '@/lib/auth/sesion'
import { Cifra, SeccionTitulo, Tabla, Vacio } from '@/components/ui'
import { ETIQUETA_ARQUETIPO, ETIQUETA_BOLSA } from '@/lib/trazabilidad/catalogo'
import { hoyYMD } from '@/lib/eodSetter'
import { cargarDatos } from '@/lib/trazabilidad/leads'
import { ETIQUETA_ORIGEN, mesDe } from '@/lib/trazabilidad/modelo'
import { armarReporte, type Reporte } from '@/lib/trazabilidad/reporte'
import { Barra, Capa, Direccional, SubNav, fechaCorta, nombreMes, pctTxt, rutaLead, usd } from '../_componentes/comunes'

export const metadata: Metadata = { title: 'Reporte · Trazabilidad' }
export const dynamic = 'force-dynamic'

// Reporte mensual de contenido: SOLO descripción de la muestra (cuentas y porcentajes calculados por código).
// Las conclusiones las saca el equipo, que conoce sus ángulos y su audiencia (regla de la clase).
export default async function ReportePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await exigirAcceso('trazabilidad')
  const { p } = await searchParams
  const datos = await cargarDatos()
  const meses = [...new Set(datos.leads.map((l) => mesDe(l.cierre)).filter((m): m is string => !!m))].sort().reverse()
  const hoy = hoyYMD().slice(0, 7)
  const tres = meses.filter((m) => m < hoy).slice(0, 3)
  const periodo = p === 'todo' || p === '3m' || (p && meses.includes(p)) ? p : '3m'
  const enPeriodo = (m: string | null) => !!m && (periodo === 'todo' || (periodo === '3m' ? tres.includes(m) : m === periodo))
  const leads = datos.leads.filter((l) => enPeriodo(mesDe(l.cierre)))
  const r: Reporte = armarReporte(leads, datos.angulos, datos.piezas)
  const nombre = new Map(datos.angulos.map((a) => [a.id, a.nombre]))
  const titulo = periodo === 'todo' ? 'Todos los meses' : periodo === '3m' ? `Últimos 3 meses cerrados (${tres.map(nombreMes).reverse().join(', ') || 'sin datos'})` : nombreMes(periodo)
  const chip = (valor: string, texto: string) => <Link key={valor} className="cj-chip" aria-current={periodo === valor ? 'page' : undefined} href={`/trazabilidad/reporte?p=${valor}`}>{texto}</Link>

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Trazabilidad · Reporte" titulo={titulo} />
      <SubNav actual="/trazabilidad/reporte" />
      <div className="cj-fila" role="group" aria-label="Período">
        {chip('3m', 'Últimos 3 meses')}
        {chip('todo', 'Todo')}
        {meses.map((m) => chip(m, nombreMes(m)))}
      </div>

      <div className="cj-rejilla">
        <Cifra etiqueta="Cierres en la muestra" valor={r.n} contexto={usd(r.cobradoTotal) + ' cobrados'} />
        <Cifra etiqueta="Con setting" valor={`${r.conSetting}/${r.n}`} contexto={`${r.conGatillo} con pieza gatillo identificada`} />
        <Cifra etiqueta="Con llamada" valor={`${r.conLlamada}/${r.n}`} contexto="analizadas de Fathom" />
        <Cifra etiqueta="Ciclo de agenda" valor={r.cicloMediana != null ? `${r.cicloMediana} d` : '—'} contexto="mediana, primera interacción → agenda" />
      </div>
      <Direccional n={r.n} meta={r.meta} />
      {r.conSetting < r.n && (
        <p className="traz-nota">{r.n - r.conSetting} cierres todavía no tienen el setting analizado: los porcentajes de contenido se calculan solo sobre los {r.conSetting} que sí.</p>
      )}

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Ángulos" titulo="Gatillo de agenda contra presencia en el recorrido" />
        <p className="traz-texto">
          <strong>Gatillo</strong> = el ángulo de la última pieza que consumió antes de agendar (sobre {r.conGatillo} leads con gatillo).
          {' '}<strong>Presencia</strong> = en cuántos recorridos aparece el ángulo, en cualquier momento (sobre {r.conSetting} leads con setting).
          {' '}Lectura fija: de cada 10 que lo consumieron, 5 o más lo tuvieron de gatillo = <em>Dispara</em>; 2 o menos y presente en el 15 % o más = <em>Atrae</em>.
        </p>
        <Tabla
          descripcion="Ángulos: gatillo y presencia"
          filas={r.angulos}
          claveFila={(f) => f.id}
          vacio={<Vacio frase="Todavía no hay setting analizado en este período." />}
          columnas={[
            { clave: 'nombre', titulo: 'Ángulo', largo: true, celda: (f) => <>{f.nombre}{f.descartado ? <span className="traz-nota"> · descartado</span> : null}</> },
            { clave: 'gatillo', titulo: 'Gatillo', celda: (f) => <Barra laton valor={f.pctGatillo} texto={`${f.gatillos} · ${pctTxt(f.pctGatillo)}`} /> },
            { clave: 'presencia', titulo: 'Presencia', celda: (f) => <Barra valor={f.pctPresencia} texto={`${f.presencia} · ${pctTxt(f.pctPresencia)}`} /> },
            { clave: 'dcd', titulo: 'Gatillo c/10', numerica: true, celda: (f) => (f.deCadaDiez ?? '—') },
            { clave: 'lectura', titulo: 'Lectura', celda: (f) => <span className={`traz-lectura traz-lectura--${f.lectura.toLowerCase()}`}>{f.lectura}</span> },
            { clave: 'bolsa', titulo: 'Bolsa', celda: (f) => (f.bolsa ? ETIQUETA_BOLSA[f.bolsa] : '—') },
          ]}
        />
        {(r.sinAngulo.gatillos > 0 || r.sinAngulo.presencia > 0) && (
          <p className="traz-nota">{r.sinAngulo.gatillos} gatillos y piezas de {r.sinAngulo.presencia} recorridos no tienen ángulo asignado: <Link className="traz-link" href="/trazabilidad/angulos">asignalos en Ángulos y piezas</Link>.</p>
        )}
      </section>

      <div className="traz-dos">
        <section className="cj-pila cj-pila--chica">
          <SeccionTitulo nivel={2} etiqueta="Piezas" titulo="Piezas gatillo" />
          <Tabla descripcion="Piezas que más veces fueron gatillo" filas={r.piezasGatillo} claveFila={(f) => f.etiqueta} vacio={<Vacio frase="Sin datos." />}
            columnas={[
              { clave: 'etiqueta', titulo: 'Pieza', largo: true },
              { clave: 'angulo', titulo: 'Ángulo', largo: true, celda: (f) => (f.angulo ? nombre.get(f.angulo) ?? f.angulo : '—') },
              { clave: 'leads', titulo: 'Leads', numerica: true },
            ]} />
        </section>
        <section className="cj-pila cj-pila--chica">
          <SeccionTitulo nivel={2} etiqueta="Bolsas" titulo="Gatillos por bolsa" />
          <Tabla descripcion="Gatillos por bolsa" filas={r.bolsas} claveFila={(f) => f.bolsa} vacio={<Vacio frase="Sin datos." />}
            columnas={[
              { clave: 'bolsa', titulo: 'Bolsa', celda: (f) => (f.bolsa === 'sin bolsa' ? 'Sin bolsa asignada' : ETIQUETA_BOLSA[f.bolsa]) },
              { clave: 'pct', titulo: 'Gatillos', celda: (f) => <Barra valor={f.pct} texto={`${f.gatillos} · ${pctTxt(f.pct)}`} /> },
            ]} />
          <SeccionTitulo nivel={2} etiqueta="Origen" titulo="De dónde vinieron" />
          <Tabla descripcion="Origen de los leads" filas={r.origenes} claveFila={(f) => f.origen} vacio={<Vacio frase="Sin datos." />}
            columnas={[
              { clave: 'origen', titulo: 'Origen', celda: (f) => ETIQUETA_ORIGEN[f.origen] },
              { clave: 'pct', titulo: 'Leads', celda: (f) => <Barra valor={f.pct} texto={`${f.leads} · ${pctTxt(f.pct)}`} /> },
            ]} />
        </section>
      </div>

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Ciclo de agenda" titulo="Cuánto tardaron en agendar" />
        <Tabla descripcion="Ciclo de agenda por tramo" filas={r.ciclo} claveFila={(f) => f.tramo}
          columnas={[
            { clave: 'tramo', titulo: 'Tramo' },
            { clave: 'pct', titulo: 'Leads', celda: (f) => <Barra valor={f.pct} texto={`${f.leads} · ${pctTxt(f.pct)}`} /> },
            { clave: 'angulo', titulo: 'Ángulo gatillo más repetido', largo: true, celda: (f) => (f.anguloTipico ? nombre.get(f.anguloTipico) ?? f.anguloTipico : '—') },
          ]} />
        <p className="traz-nota">
          Seguimientos del setter hasta agendar: mediana {r.seguimientos.mediana ?? '—'}, promedio {r.seguimientos.promedio != null ? r.seguimientos.promedio.toFixed(1).replace('.', ',') : '—'} ({r.seguimientos.conDato} leads con dato).
        </p>
      </section>

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Llamadas" titulo="Dolores que dijeron en la llamada" />
        <p className="traz-texto">Agrupados por ángulo del catálogo. Los que dicen <strong>NUEVO</strong> no corresponden a ningún ángulo: son candidatos a ángulos que todavía no se tocan en el contenido.</p>
        <Tabla descripcion="Dolores de las llamadas" filas={r.dolores.slice(0, 25)} claveFila={(f) => `${f.angulo ?? ''}${f.tema}`} vacio={<Vacio frase="Todavía no hay llamadas analizadas en este período." />}
          columnas={[
            { clave: 'tema', titulo: 'Dolor', largo: true, celda: (f) => <>{f.tema}{!f.angulo && <span className="traz-lectura traz-lectura--atrae"> · nuevo</span>}</> },
            { clave: 'leads', titulo: 'Leads', numerica: true },
            { clave: 'citas', titulo: 'Cómo lo dijeron', largo: true, celda: (f) => <span className="traz-cita">{f.citas.map((c) => `“${c}”`).join(' · ')}</span> },
          ]} />
        {r.arquetipos.length > 0 && (
          <p className="traz-nota">Arquetipos: {r.arquetipos.map((a) => `${ETIQUETA_ARQUETIPO[a.arquetipo]} ${a.leads} (${pctTxt(a.pct)})`).join(' · ')}</p>
        )}
      </section>

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Contraste" titulo="Gatillos: muestra contra pagos chicos" />
        <p className="traz-texto">Grupo de contraste = {r.contraste} cierres que cobraron menos de la 1ª cuota. Un ángulo que pesa mucho más en el contraste que en la muestra es candidato a evitar.</p>
        <Tabla descripcion="Gatillos en la muestra y en el contraste" filas={r.contrasteGatillos} claveFila={(f) => f.id} vacio={<Vacio frase="Sin gatillos identificados todavía." />}
          columnas={[
            { clave: 'nombre', titulo: 'Ángulo', largo: true },
            { clave: 'muestra', titulo: 'Muestra', celda: (f) => <Barra laton valor={f.pctMuestra} texto={`${f.muestra} · ${pctTxt(f.pctMuestra)}`} /> },
            { clave: 'contraste', titulo: 'Contraste', celda: (f) => <Barra valor={f.pctContraste} texto={`${f.contraste} · ${pctTxt(f.pctContraste)}`} /> },
          ]} />
      </section>

      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo nivel={2} etiqueta="Uno por uno" titulo="Análisis individual" />
        <Tabla descripcion="Cada cierre de la muestra" filas={r.individual} claveFila={(f) => f.clave}
          columnas={[
            { clave: 'nombre', titulo: 'Lead', celda: (f) => <Link className="traz-link" href={rutaLead(f.clave)}>{f.nombre}</Link> },
            { clave: 'fecha', titulo: 'Llamada', celda: (f) => fechaCorta(f.fecha) },
            { clave: 'cobrado', titulo: 'Cobrado', numerica: true, celda: (f) => usd(f.cobrado) },
            { clave: 'pieza', titulo: 'Pieza gatillo', largo: true, celda: (f) => f.pieza ?? '—' },
            { clave: 'angulo', titulo: 'Ángulo', largo: true, celda: (f) => (f.angulo ? nombre.get(f.angulo) ?? f.angulo : '—') },
            { clave: 'ciclo', titulo: 'Ciclo', numerica: true, celda: (f) => (f.ciclo != null ? `${f.ciclo} d` : '—') },
            { clave: 'segs', titulo: 'Seguim.', numerica: true, celda: (f) => f.seguimientos ?? '—' },
            { clave: 'capas', titulo: 'Capas', alinear: 'centro', celda: (f) => <><Capa estado={f.capas.setting ? 'si' : 'no'} titulo="Setting" /> <Capa estado={f.capas.llamada ? 'si' : 'no'} titulo="Llamada" /></> },
          ]} />
      </section>
    </div>
  )
}
