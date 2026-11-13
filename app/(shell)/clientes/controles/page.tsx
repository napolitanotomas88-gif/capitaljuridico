import type { Metadata } from 'next'
import Link from 'next/link'
import { SeccionTitulo } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { incumplimientosEntre, leerConfigs, type IncumplimientoGuardado } from '@/lib/clientes/controles/db'
import { NOMBRE_TIPO, controlesEncendidos, dm, esIdCrm, ymdAR, type ConfigControles } from '@/lib/clientes/controles/reglas'
import { sumarDias } from '@/lib/anuncios/formato'
import { Verificar } from './Verificar'
import '../altas/altas.css'

// Controles de cumplimiento (11/11/2026): la configuración de cada cliente con garantía y el historial de incumplimientos
// con el estado de su aviso. El aviso se pega a mano y se marca «Enviado» en /clientes/para-enviar (pieza j01): acá se ve
// quién lo mandó y cuándo. La configuración se carga por API (POST /api/clientes/controles con CRON_SECRET).
export const metadata: Metadata = { title: 'Controles de cumplimiento' }
export const dynamic = 'force-dynamic'

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

function estadoAviso(i: IncumplimientoGuardado): string {
  if (i.estado === 'a_verificar') return 'A verificar (sin aviso al cliente todavía)'
  if (i.estado === 'descartado_verificacion') return `No corresponde${i.motivo ? ` (${i.motivo})` : ''} · ${i.por ?? ''} ${hora(i.cuando)}`
  if (i.estado === 'enviado') return `Enviado por ${i.por ?? '—'} el ${hora(i.cuando)}`
  if (i.estado === 'descartado') return `No corresponde${i.motivo ? ` (${i.motivo})` : ''} · ${i.por ?? ''} ${hora(i.cuando)}`
  if (i.estado === 'para_enviar') return 'Para enviar'
  return 'Sin aviso registrado'
}
const confirmado = (i: IncumplimientoGuardado) => (i.verificado && i.estado !== 'descartado_verificacion' ? ` · confirmado por ${i.verificado.por ?? '—'} el ${hora(i.verificado.cuando)}` : '')

export default async function ControlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirAcceso('clientes')
  const sp = await searchParams
  const pedido = typeof sp.cliente === 'string' ? sp.cliente.trim().toUpperCase() : ''
  const cliente = esIdCrm(pedido) ? pedido : null
  const hoy = ymdAR(new Date())
  let configs: ConfigControles[] = []
  let historial: IncumplimientoGuardado[] = []
  let error: string | null = null
  try {
    configs = await leerConfigs(hoy, false)
    historial = await incumplimientosEntre(cliente, sumarDias(hoy, -120), hoy)
  } catch { error = 'No se pudo leer la base. Probá de nuevo en un rato.' }
  return (
    <div className="cj-pila cj-altas">
      <SeccionTitulo titulo="Controles de cumplimiento" />
      <p className="cj-texto-2">
        {controlesEncendidos() ? 'Encendidos: corren todos los días a las 10:00 y el resumen sale los lunes.' : 'Apagados (CONTROLES_CLIENTES no está en «encendido»).'}{' '}
        Error de pago y presupuesto del período no invertido dejan el aviso directo en <Link href="/clientes/para-enviar">Para enviar</Link>. Capturas, guiones y crudos quedan «a verificar»: el aviso se arma solo con «Es incumplimiento». Nada se le manda al cliente solo.
      </p>
      {error && <div className="cj-aviso"><p>{error}</p></div>}
      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo etiqueta="Configuración" titulo={`Clientes controlados (${configs.length})`} nivel={2} />
        {!configs.length && <p className="cj-texto-2">Ningún cliente configurado.</p>}
        <ul className="cj-altas__historial">
          {configs.map((c) => (
            <li key={c.idCrm}>
              <Link href={`/clientes/controles?cliente=${c.idCrm}`}><strong>{c.cliente}</strong> ({c.idCrm})</Link>
              {' · '}{c.activo ? 'activo' : 'inactivo'} · desde {dm(c.desde)} · USD {c.presupuestoDiarioUsd}/día · Meta {c.cuentaMeta ? 'sí' : 'no'} · Capturas {c.carpetaCapturas ? 'sí' : 'se crea en la primera corrida'}
              {' · '}plazos: revisión {c.plazos.revisionHabiles} hábiles, crudos {c.plazos.crudosCorridos} días, capturas {c.plazos.capturasHoras} h, corrección {c.plazos.correccionCorridos} días
              {' · '}período de {c.plazos.periodoDias} días · cláusulas: pago {c.clausulas.pago}, gasto {c.clausulas.gasto}, guiones {c.clausulas.guiones}, crudos {c.clausulas.crudos}, capturas {c.clausulas.capturas}
            </li>
          ))}
        </ul>
      </section>
      <section className="cj-pila cj-pila--chica">
        <SeccionTitulo etiqueta="Historial" titulo={`Incumplimientos${cliente ? ` de ${cliente}` : ''} · últimos 120 días (${historial.length})`} nivel={2} />
        {cliente && <p className="cj-texto-2"><Link href="/clientes/controles">Ver todos</Link></p>}
        {!historial.length && !error && <p className="cj-texto-2">Sin incumplimientos registrados.</p>}
        <ul className="cj-altas__historial">
          {historial.map((i) => (
            <li key={i.id}>
              <strong>{dm(i.fecha)}</strong> · {i.idCrm} · {NOMBRE_TIPO[i.tipo] ?? i.tipo} · cláusula {i.clausula ?? '—'} · {estadoAviso(i)}{confirmado(i)}
              {i.estado === 'a_verificar' && <><br /><span className="cj-texto-2">{i.lineas.slice(0, 2).join(' · ')}</span><br /><Verificar id={i.id} resumen={`${NOMBRE_TIPO[i.tipo] ?? i.tipo}, ${dm(i.fecha)}`} /></>}
              {i.mensajeId && i.estado === 'para_enviar' && <> · <Link href={`/clientes/para-enviar#m-${i.mensajeId}`}>Abrir aviso</Link></>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
