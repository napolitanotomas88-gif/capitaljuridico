import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { revisarEspaciosAgenda } from '@/lib/agendaSlots'
import { enviarConfirmacionAgenda, type InviteePayload } from '@/lib/confirmacionAgenda'
import { aplicarReagendaNueva, aplicarReprogramacion } from '@/lib/crm/calendlyReagenda'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Webhook de Calendly (cuenta de ventas): cada reserva o cancelación dispara al instante el
// chequeo de espacios de agenda (el cron de Vercel Hobby solo puede correr 1 vez por día), y cada
// reserva NUEVA de Reunión Consultiva dispara el WhatsApp de confirmación al lead (Make → 2Chat).
// Calendly no manda headers propios, así que en vez de CRON_SECRET se valida SU firma:
//   Calendly-Webhook-Signature: t=<unix>,v1=<HMAC-SHA256 de `${t}.${body}` con la signing key>
// La signing key se define al crear la suscripción y vive en CALENDLY_WEBHOOK_SIGNING_KEY.
function firmaValida(header: string | null, body: string, key: string): boolean {
  if (!header) return false
  const partes: Record<string, string> = {}
  for (const p of header.split(',')) { const i = p.indexOf('='); if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim() }
  const { t, v1 } = partes
  if (!t || !v1) return false
  // t tiene que ser numérico: con NaN la comparación de abajo daría false y se saltearía la ventana anti-replay
  if (!/^\d{1,12}$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const esperado = crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')
  const a = Buffer.from(esperado), b = Buffer.from(v1)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  if (!key) {
    console.error('calendly-webhook: falta CALENDLY_WEBHOOK_SIGNING_KEY — Calendly va a deshabilitar la suscripción si sigue así 24 h')
    return NextResponse.json({ error: 'falta CALENDLY_WEBHOOK_SIGNING_KEY' }, { status: 500 })
  }
  const body = await req.text()
  if (!firmaValida(req.headers.get('calendly-webhook-signature'), body, key))
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  let j: { event?: string; payload?: InviteePayload } = {}
  try { j = JSON.parse(body) } catch { /* body no JSON */ }
  const evento = j.event ?? ''
  if (!/^invitee\.(created|canceled)$/.test(evento)) return NextResponse.json({ ok: true, ignorado: evento || 'sin evento' })
  // Una reprogramación llega como canceled (rescheduled=true) + created a la vez: alcanza con el created
  if (evento === 'invitee.canceled' && j.payload?.rescheduled === true) return NextResponse.json({ ok: true, ignorado: 'canceled por reprogramación' })
  // Se responde YA (Calendly reintenta y termina deshabilitando la suscripción si tardamos) y el trabajo
  // corre después de la respuesta. Son dos tareas independientes: que falle una no frena la otra.
  const invitado = evento === 'invitee.created' ? j.payload : undefined
  after(async () => {
    await Promise.allSettled([
      // WhatsApp de confirmación al lead que acaba de agendar (vía Make → 2Chat)
      (async () => {
        if (!invitado) return
        const r = await enviarConfirmacionAgenda(invitado)
        if (!r.ok) console.error('calendly-webhook: confirmación por WhatsApp falló —', r.motivo)
      })().catch(e => console.error('calendly-webhook (confirmación):', e)),
      // Reprogramación (created con old_invitee) de una Reunión Consultiva: actualiza la fila del lead en el CRM de ventas
      // (R = No, AC = horario nuevo, AH = ese día; lib/crm/calendlyReagenda.ts). Si no se puede, queda en el log de Vercel:
      // en ninguna reagenda se manda nada a Discord ni al lead (pedido de Tomás, 19/10/2026).
      // También una reserva del evento "Reunión Consultiva - Reagenda <closer>" (la reunión ya había pasado y Calendly no la
      // deja reprogramar): mismos cambios en la fila del lead.
      (async () => {
        const nombreEvento = invitado?.scheduled_event?.name ?? ''
        if (!invitado || !/consultiva/i.test(nombreEvento)) return
        const reagendaNueva = !invitado.old_invitee && /reagenda/i.test(nombreEvento)
        if (!invitado.old_invitee && !reagendaNueva) return
        const telefono = invitado.text_reminder_number || (invitado.questions_and_answers ?? []).find(q => /tel[eé]fono|phone|whatsapp|celular|n[úu]mero/i.test(q.question ?? ''))?.answer || ''
        const inicioNuevo = invitado.scheduled_event?.start_time
        const r = invitado.old_invitee
          ? await aplicarReprogramacion({ oldInvitee: invitado.old_invitee, email: invitado.email, telefono, inicioNuevo })
          : await aplicarReagendaNueva({ email: invitado.email, telefono, inicioNuevo, closerNuevo: invitado.scheduled_event?.event_memberships?.[0]?.user_name })
        if (r.ok) console.log(`calendly-webhook: reprogramación cargada en el CRM — ${r.lead} (${r.hoja}, fila ${r.fila}) de ${r.de} a ${r.a}`)
        else console.error('calendly-webhook: reprogramación sin cargar en el CRM —', invitado.email ?? '', r.motivo)
      })().catch(e => console.error('calendly-webhook (reprogramación):', e)),
      // Espacios de agenda, con un margen para que la disponibilidad refleje la reserva
      (async () => {
        await new Promise(r => setTimeout(r, 2500))
        const r = await revisarEspaciosAgenda()
        if (!r.ok) console.error('calendly-webhook: chequeo de agenda falló —', r.motivo)
      })().catch(e => console.error('calendly-webhook (agenda):', e)),
    ])
  })
  return NextResponse.json({ ok: true, evento, encolado: true })
}
