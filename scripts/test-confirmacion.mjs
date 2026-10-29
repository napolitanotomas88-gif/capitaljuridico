// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-confirmacion.mjs
// WhatsApp de confirmación al agendar: cada closer manda desde SU escenario de Make (9/10/2026: se suma Carlos Roletto).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { variableWebhookDe, datosConfirmacion } from '../lib/confirmacionAgenda.ts'

test('cada closer usa la variable de su escenario; Marcos sigue con la suya', () => {
  assert.equal(variableWebhookDe('Marcos Carlomagno'), 'MAKE_WEBHOOK_CONFIRMACION')
  assert.equal(variableWebhookDe('Carlos Roletto'), 'MAKE_WEBHOOK_CONFIRMACION_CARLOS')
  assert.equal(variableWebhookDe('  carlos   ROLETTO '), 'MAKE_WEBHOOK_CONFIRMACION_CARLOS')
  assert.equal(variableWebhookDe('Yamila Coutoune'), 'MAKE_WEBHOOK_CONFIRMACION_YAMILA')
  assert.equal(variableWebhookDe('Nahuel Milena'), 'MAKE_WEBHOOK_CONFIRMACION_NAHUEL')
  assert.equal(variableWebhookDe('Brenda Amado'), 'MAKE_WEBHOOK_CONFIRMACION_BRENDA')
  assert.equal(variableWebhookDe('Gerónimo X'), 'MAKE_WEBHOOK_CONFIRMACION')
})
test('una Reunión Consultiva con un closer sin WhatsApp se omite; con Carlos ya no se omite por closer', async () => {
  const ev = (closer) => ({ scheduled_event: { name: 'Reunión Consultiva', start_time: '2026-10-20T15:00:00.000Z', event_memberships: [{ user_name: closer }] } })
  const otro = await datosConfirmacion(ev('Fulano Pérez'))
  assert.match(otro.omitir ?? '', /todavía no tiene WhatsApp automático/)
  const carlos = await datosConfirmacion(ev('Carlos Roletto'))
  assert.doesNotMatch(carlos.omitir ?? '', /todavía no tiene WhatsApp automático/)
  // Reserva de reagenda (lead cuya reunión ya pasó): no se le escribe de nuevo, aunque el evento diga "Reunión Consultiva"
  const reagenda = await datosConfirmacion({ scheduled_event: { name: 'Reunión Consultiva - Reagenda Carlos', start_time: '2026-10-20T15:00:00.000Z', event_memberships: [{ user_name: 'Carlos Roletto' }] } })
  assert.equal(reagenda.omitir, 'reagenda')
  const yamila = await datosConfirmacion(ev('Yamila Coutoune'))
  assert.doesNotMatch(yamila.omitir ?? '', /todavía no tiene WhatsApp automático/)
  const nahuel = await datosConfirmacion(ev('Nahuel Milena'))
  assert.doesNotMatch(nahuel.omitir ?? '', /todavía no tiene WhatsApp automático/)
  const brenda = await datosConfirmacion(ev('Brenda Amado'))
  assert.doesNotMatch(brenda.omitir ?? '', /todavía no tiene WhatsApp automático/)
})
