import type { Metadata } from 'next'
import Link from 'next/link'
import { exigirAcceso } from '@/lib/auth/sesion'
import { Cifra, SeccionTitulo, Tabla, Vacio } from '@/components/ui'
import { hoyYMD, sumarDias } from '@/lib/eodSetter'
import { listarAngulos, listarPiezas, listarSetting } from '@/lib/trazabilidad/db'
import { ETIQUETA_ORIGEN, tramoCiclo } from '@/lib/trazabilidad/modelo'
import { anguloDePieza } from '@/lib/trazabilidad/reporte'
import { diasEOD, domingoDe, enviosDelRango, resumenEnvios, type DiaSemana } from '@/lib/trazabilidad/semanal'
import { SubNav, fechaCorta, pctTxt } from '../_componentes/comunes'

export const metadata: Metadata = { title: 'Semanal · Trazabilidad' }
export const dynamic = 'force-dynamic'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const suma = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null)
const tasa = (a: number | null, b: number | null) => (a != null && b ? pctTxt(a / b) : '—')

// Semana de domingo a sábado (se presenta el lunes). EOD de la setter día por día + agendas que pasaron por la botonera.
export default async function SemanalPage({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  await exigirAcceso('trazabilidad')
  const { semana } = await searchParams
  const hoy = hoyYMD()
  const ref = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : sumarDias(hoy, -7)
  const domingo = domingoDe(ref), sabado = sumarDias(domingo, 6)
  const [{ dias, aviso }, envios, angulos, piezas] = await Promise.all([diasEOD(domingo), listarSetting(), listarAngulos(), listarPiezas()])
  const tot = {
    agendas: suma(dias.map((d) => d.agendas)), calendarios: suma(dias.map((d) => d.calendarios)),
    outbound: suma(dias.map((d) => d.outbound)), recursos: suma(dias.map((d) => d.recursos)),
  }
  const semanaEnvios = enviosDelRango(envios, domingo, sabado)
  const res = resumenEnvios(semanaEnvios)
  // Bola de nieve: gatillos de los últimos 14 días hasta el sábado
  const nombre = new Map(angulos.map((a) => [a.id, a.nombre]))
  const conteo = new Map<string, number>()
  const bola = enviosDelRango(envios, sumarDias(sabado, -13), sabado).filter((e) => e.analisis?.pieza_gatillo)
  for (const e of bola) {
    const a = e.analisis!
    const id = anguloDePieza(a.pieza_gatillo!, a.piezas.find((p) => p.etiqueta === a.pieza_gatillo)?.angulo ?? null, piezas) ?? 'sin ángulo'
    conteo.set(id, (conteo.get(id) ?? 0) + 1)
  }
  const gatillos = [...conteo].sort((a, b) => b[1] - a[1])
  const nav = (d: number) => `/trazabilidad/semanal?semana=${sumarDias(domingo, d)}`

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Trazabilidad · Semanal de setting" titulo={`${fechaCorta(domingo)} al ${fechaCorta(sabado)}`}
        acciones={<div className="cj-fila"><Link className="cj-chip" href={nav(-7)}>← Semana anterior</Link>{sabado < hoy && <Link className="cj-chip" href={nav(7)}>Semana siguiente →</Link>}</div>} />
      <SubNav actual="/trazabilidad/semanal" />
      <p className="traz-texto">Para el día a día: qué cambió entre un día y otro (contenido subido, abridor, historia). Con estos números no se cambian ángulos: eso sale del reporte mensual.</p>
      {aviso && <p className="traz-error" role="alert">{aviso}</p>}

      <div className="cj-rejilla">
        <Cifra etiqueta="Agendas" valor={tot.agendas ?? '—'} contexto={`${tot.calendarios ?? '—'} calendarios enviados · ${tasa(tot.agendas, tot.calendarios)}`} />
        <Cifra etiqueta="Outbound a historias" valor={tot.outbound ?? '—'} contexto={`${tot.recursos ?? '—'} recursos enviados · respuesta ${tasa(tot.recursos, tot.outbound)}`} />
        <Cifra etiqueta="Por la botonera" valor={res.total} contexto={`${res.analizados} analizados esta semana`} />
      </div>

      <Tabla<DiaSemana>
        descripcion="EOD de la setter por día"
        filas={dias}
        claveFila={(d) => d.fecha}
        columnas={[
          { clave: 'dia', titulo: 'Día', celda: (d) => `${DIAS[new Date(`${d.fecha}T12:00:00Z`).getUTCDay()]} ${fechaCorta(d.fecha).slice(0, 5)}` },
          { clave: 'cal', titulo: 'Calendarios', numerica: true, celda: (d) => d.calendarios ?? '—' },
          { clave: 'ag', titulo: 'Agendas', numerica: true, celda: (d) => d.agendas ?? '—' },
          { clave: 'tasa', titulo: 'Agenda / calendario', numerica: true, celda: (d) => tasa(d.agendas, d.calendarios) },
          { clave: 'out', titulo: 'Outbound', numerica: true, celda: (d) => d.outbound ?? '—' },
          { clave: 'rec', titulo: 'Recursos', numerica: true, celda: (d) => d.recursos ?? '—' },
          { clave: 'resp', titulo: 'Respuesta outbound', numerica: true, celda: (d) => tasa(d.recursos, d.outbound) },
          { clave: 'hist', titulo: 'Agendas c/ etiqueta historias', numerica: true, celda: (d) => d.agendasHistorias ?? '—' },
          { clave: 'cong', titulo: 'Cierre', celda: (d) => (d.congelado ? 'enviado 23:59' : d.agendas == null ? '—' : 'en curso') },
        ]}
      />
      <p className="traz-nota">Agenda / calendario puede pasar el 100 %: hay agendas que no necesitaron calendario (landing, video, enrutamiento). Respuesta outbound = recursos enviados ÷ outbounds del día (la referencia de la clase ronda 24–25 %). «Agendas c/ etiqueta historias» usa la etiqueta mensual: es referencial, no atribución por historia.</p>

      <div className="traz-dos">
        <section className="cj-pila cj-pila--chica">
          <SeccionTitulo nivel={2} etiqueta="Agendas de la semana" titulo="De dónde vinieron" />
          <Tabla descripcion="Agendas de la semana enviadas por la botonera" filas={semanaEnvios} claveFila={(e) => e.subscriberId}
            vacio={<Vacio frase="Esta semana nadie usó «Enviar al Despacho» en la botonera." />}
            columnas={[
              { clave: 'nombre', titulo: 'Lead', largo: true, celda: (e) => e.nombre || (e.igUsuario ? `@${e.igUsuario}` : e.subscriberId) },
              { clave: 'origen', titulo: 'Origen', celda: (e) => (e.analisis ? ETIQUETA_ORIGEN[e.analisis.origen] : '—') },
              { clave: 'ciclo', titulo: 'Ciclo', celda: (e) => (e.analisis?.ciclo_dias != null ? tramoCiclo(e.analisis.ciclo_dias)?.etiqueta ?? '—' : '—') },
              { clave: 'gat', titulo: 'Pieza gatillo', largo: true, celda: (e) => e.analisis?.pieza_gatillo ?? '—' },
            ]} />
        </section>
        <section className="cj-pila cj-pila--chica">
          <SeccionTitulo nivel={2} etiqueta="Bola de nieve · 14 días" titulo="Ángulos gatillo de las agendas" />
          <Tabla descripcion="Ángulos gatillo de los últimos 14 días" filas={gatillos} claveFila={(g) => g[0]} vacio={<Vacio frase="Sin gatillos identificados en 14 días." />}
            columnas={[
              { clave: 'a', titulo: 'Ángulo', largo: true, celda: (g) => nombre.get(g[0]) ?? (g[0] === 'sin ángulo' ? 'Sin ángulo asignado' : g[0]) },
              { clave: 'n', titulo: 'Agendas', numerica: true, celda: (g) => `${g[1]} · ${pctTxt(g[1] / bola.length)}` },
            ]} />
          {res.origenes.length > 0 && <p className="traz-nota">Origen esta semana: {res.origenes.map(([o, n]) => `${ETIQUETA_ORIGEN[o]} ${n}`).join(' · ')}</p>}
        </section>
      </div>
    </div>
  )
}
