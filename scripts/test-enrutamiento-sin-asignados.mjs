// Reporte de enrutamiento: ya no muestra "Asignados a Maite" y el % de agenda va sobre los leads IG del mes.
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-enrutamiento-sin-asignados.mjs
import assert from 'node:assert/strict'
import { armarEnrutamientosPerdidos } from '../lib/discord.ts'

const raw = {
  calls: [], clientesAgencia: [], clientesConsultora: [],
  enrutamiento: {
    dia: '2026-11-10',
    leadsIG: { dia: 360, previo: 263, mes: 2982 },
    asignados: { dia: 61, previo: 45, mes: 514 },
    noAsignados: { total: 299, identificados: [{ nombre: 'Z001', usuario: 'z001', id: '1' }] },
    agendasSetterDia: 3, agendasSetterMes: 25, tasaAgendaSetterMes: 25 / 2982,   // = agendas ÷ leads IG del mes (rawSheets)
    llamadas: { total: 0, porCloser: {}, lista: [] },
  },
}
const { partes, registro } = armarEnrutamientosPerdidos(raw, { creadas: [], canceladas: [] }, [], { disponible: true, formularios: 1, perdidos: [], yaAgendaron: 0 })
const txt = partes.join('\n')
assert.ok(!/Asignados a Maite/.test(txt), 'no muestra asignados')
assert.ok(/% agenda sobre leads IG \(mes\): \*\*?0,8%/.test(txt) || txt.includes('0,8%** (25 / 2.982)'), txt)
assert.ok(/Nada perdido/.test(txt), 'los no asignados ya no cuentan como perdidos')
assert.ok(!/Leads IG sin asignar/.test(txt))
assert.equal(registro.leadsIG.length, 0)
console.log('ok enrutamiento sin asignados')
