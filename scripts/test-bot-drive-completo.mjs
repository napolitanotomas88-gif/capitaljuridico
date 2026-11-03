// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-drive-completo.mjs
// Regla de Tomás (2/11/2026): «toda alta y todo cliente activo tiene Crudos, Editados, Marca y Guiones». Prueba:
//   · prepararDriveCliente con una carpeta que ya existía: reconoce lo que hay por el prefijo (sufijos puestos a mano), la reutiliza
//     sin esperar el OK cuando aceptarExistente dice que es del cliente, y omite lo pedido;
//   · decidir() (revisión diaria): revisar / crear / ambiguo / en_alta;
//   · correrDriveCompleto(): ensayo sin escribir, tope, avisos una vez y resumen solo si hizo algo.
// Datos INVENTADOS, puente y Drive de juguete: nunca se llama a Google ni al puente real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepararDriveCliente, clasificarHijos, MIME_CARPETA_DRIVE, MIME_DOC_DRIVE, MOTIVO_CARPETA_REUSADA } from '../lib/bot/alta/driveCliente.ts'
import { decidir, correrDriveCompleto, esReciente, modoDriveCompleto, TOPE_POR_CORRIDA } from '../lib/bot/alta/driveCompleto.ts'

for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) delete process.env[k]

const RAIZ = 'RaizClientesDeJuguete0000001'
const PLANTILLA = 'PlantillaGuionesJuguete00001'
const id = (n) => `IdDeJuguete${String(n).padStart(17, '0')}`

/** Drive de juguete: carpetas con hijos; el puente busca por nombre exacto adentro del padre (como el real). */
function driveJuguete(inicial = {}) {
  let n = 100
  const hijos = new Map(Object.entries(inicial))   // padreId → [{ id, name, mimeType }]
  const llamadas = []
  const crear = (padre, nombre, mimeType) => {
    const xs = hijos.get(padre) ?? []
    const ya = xs.find((x) => x.name === nombre)
    if (ya) return { id: ya.id, url: `https://drive.ejemplo/${ya.id}`, yaExistia: true }
    const nuevo = { id: id(n++), name: nombre, mimeType }
    hijos.set(padre, [...xs, nuevo])
    return { id: nuevo.id, url: `https://drive.ejemplo/${nuevo.id}`, yaExistia: false }
  }
  const puente = {
    async ping() { return { cuenta: null, version: null } },
    async crearCarpeta({ padreId, nombre }) { llamadas.push(['crearCarpeta', nombre]); return crear(padreId, nombre, MIME_CARPETA_DRIVE) },
    async crearDoc({ carpetaId, nombre }) { llamadas.push(['crearDoc', nombre]); return crear(carpetaId, nombre, MIME_DOC_DRIVE) },
    async copiarArchivo({ carpetaId, nombre }) { llamadas.push(['copiarArchivo', nombre]); return crear(carpetaId, nombre, MIME_DOC_DRIVE) },
    async subirArchivo() { throw new Error('no') }, async aPapelera() {}, async aPapeleraCarpeta() {},
  }
  return { puente, hijos, llamadas, listar: async (c) => hijos.get(c) ?? [] }
}

const alta = (nombre) => ({ etiquetaAlta: true, nombre, correo: 'cliente@ejemplo.com', socios: null, telefonos: [], cuotas: [], faltantes: [], avisos: [] })

// ── clasificarHijos ────────────────────────────────────────────────────────────────────────────────────────────
test('reconoce lo que ya hay por el prefijo, con cualquier sufijo (los que se arman a mano)', () => {
  const r = clasificarHijos([
    { id: id(1), name: 'Crudos - TQ', mimeType: MIME_CARPETA_DRIVE },
    { id: id(2), name: 'EDITADOS Juli', mimeType: MIME_CARPETA_DRIVE },
    { id: id(3), name: 'Guiones - Zule Ibarra', mimeType: MIME_DOC_DRIVE, modifiedTime: '2026-10-01T00:00:00Z' },
    { id: id(4), name: 'Plantilla Guiones - C.J', mimeType: MIME_DOC_DRIVE, modifiedTime: '2026-11-01T00:00:00Z' },
    { id: id(5), name: 'Marcas registradas.pdf', mimeType: 'application/pdf' },
  ])
  assert.equal(r.crudos.id, id(1))
  assert.equal(r.editados.id, id(2))
  assert.equal(r.guiones.id, id(3))     // la plantilla no cuenta como Doc del cliente
  assert.equal(r.marca, undefined)      // un PDF "Marcas…" no es la carpeta Marca
  assert.equal(r.bienvenida, undefined)
})

// ── prepararDriveCliente con carpeta existente ───────────────────────────────────────────────────────────────────
test('alta con la carpeta armada a mano: si es del cliente, la reutiliza sin OK y crea solo lo que falta', async () => {
  const carpeta = { id: id(10), name: 'Zulema Ibarra - C.J', mimeType: MIME_CARPETA_DRIVE }
  const d = driveJuguete({ [RAIZ]: [carpeta], [id(10)]: [{ id: id(11), name: 'Guiones - Zule Ibarra', mimeType: MIME_DOC_DRIVE }] })
  const pedidas = []
  const r = await prepararDriveCliente(alta('Zulema Ibarra'), {
    modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: RAIZ, idCrm: 'A900',
    aceptarExistente: async (c) => { pedidas.push(c.id); return true },
    deps: { puente: () => d.puente, listarHijos: d.listar },
  })
  assert.deepEqual(pedidas, [id(10)])
  assert.equal(r.esperaOk, null)
  assert.equal(r.carpeta.estado, 'existia')
  assert.equal(r.carpeta.motivo, MOTIVO_CARPETA_REUSADA)
  assert.equal(r.guiones.id, id(11))      // el "Guiones - Zule Ibarra" armado a mano, sin copiar otro
  assert.ok(!d.llamadas.some(([a]) => a === 'copiarArchivo'))
  assert.deepEqual(d.llamadas.filter(([a]) => a === 'crearCarpeta').map(([, n]) => n).sort(), ['Crudos - ZulemaI', 'Editados - ZulemaI', 'Zulema Ibarra - C.J', 'Marca - ZulemaI'].sort())
  assert.ok(r.completo)
  assert.equal(r.guardar.carpeta.id, id(10))
  // Segunda corrida con lo guardado: no crea nada más
  d.llamadas.length = 0
  const r2 = await prepararDriveCliente(alta('Zulema Ibarra'), { modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: RAIZ, guardado: r.guardar, deps: { puente: () => d.puente, listarHijos: d.listar } })
  assert.ok(r2.completo)
  assert.deepEqual(d.llamadas, [])
  assert.equal((d.hijos.get(id(10)) ?? []).length, 5)
})

test('alta con carpeta existente: si aceptarExistente dice que no (o tira), espera el OK como siempre', async () => {
  for (const aceptar of [async () => false, async () => { throw new Error('sin base') }, undefined]) {
    const d = driveJuguete({ [RAIZ]: [{ id: id(20), name: 'Ana Gómez - C.J', mimeType: MIME_CARPETA_DRIVE }] })
    const r = await prepararDriveCliente(alta('Ana Gómez'), { modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: RAIZ, aceptarExistente: aceptar, deps: { puente: () => d.puente, listarHijos: d.listar } })
    assert.equal(r.esperaOk, 'carpeta_existente')
    assert.equal(d.llamadas.length, 1)   // solo el crearCarpeta que la encontró
  }
})

test('carpeta guardada: lo que ya tiene con otro sufijo no se duplica; omitir bienvenida no la crea y queda completo', async () => {
  const d = driveJuguete({ [id(30)]: [
    { id: id(31), name: 'Crudos - TQ', mimeType: MIME_CARPETA_DRIVE },
    { id: id(32), name: 'Editados - TQ', mimeType: MIME_CARPETA_DRIVE },
    { id: id(33), name: 'Guiones - TQ', mimeType: MIME_DOC_DRIVE },
  ] })
  const r = await prepararDriveCliente(alta('Teodoro Quintana'), {
    modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: RAIZ, omitir: ['bienvenida'],
    guardado: { carpeta: { id: id(30), url: 'https://drive.ejemplo/c' } }, deps: { puente: () => d.puente, listarHijos: d.listar },
  })
  assert.deepEqual(d.llamadas, [['crearCarpeta', 'Marca - TeodoroQ']])
  assert.ok(r.completo)
  assert.equal(r.bienvenida.estado, 'pendiente')
  assert.equal(r.guardar.bienvenida, undefined)
  assert.equal(r.guardar.crudos.id, id(31))
})

test('si no se puede listar la carpeta, sigue como antes (el puente busca por el nombre exacto)', async () => {
  const d = driveJuguete({ [id(40)]: [] })
  const r = await prepararDriveCliente(alta('Ana Paz'), {
    modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: RAIZ, guardado: { carpeta: { id: id(40), url: 'u' } },
    deps: { puente: () => d.puente, listarHijos: async () => { throw new Error('403') } },
  })
  assert.ok(r.completo)
  assert.equal(d.llamadas.length, 5)
})

// ── decidir ──────────────────────────────────────────────────────────────────────────────────────────────────────
const HOY = '2026-11-02'
const cli = (id_, nombre, dia1 = '2026-10-30') => ({ id: id_, nombre, dia1 })
const carp = (n, nombre) => ({ id: id(n), nombre })

test('decidir: por registro, por nombre exacto, crear (nuevo y sin parecidos) y en_alta', () => {
  const ds = decidir({
    clientes: [cli('A1', 'Herminia Sol Varela', '2026-09-01'), cli('A2', 'Fausto Ledesma', '2026-09-01'), cli('A3', 'Zoe Quiroga'), cli('A4', 'Ofelia Brun', HOY)],
    todosCrm: [{ id: 'A1', nombre: 'Herminia Sol Varela' }, { id: 'A2', nombre: 'Fausto Ledesma' }, { id: 'A3', nombre: 'Zoe Quiroga' }, { id: 'A4', nombre: 'Ofelia Brun' }],
    carpetas: [carp(1, 'Herminia Varela - C.J'), carp(2, 'Fausto Ledesma - C.J')],
    vinculos: [{ drive_id: id(1), id_crm: 'A1', origen: 'vigia', vinculo: 'tomas' }],
    altasEnCurso: [{ id_crm: null, nombre: 'Ofelia Brun' }],
    hoy: HOY,
  })
  const por = Object.fromEntries(ds.map((d) => [d.cliente.id, d]))
  assert.equal(por.A1.tipo, 'revisar'); assert.equal(por.A1.por, 'registro'); assert.equal(por.A1.vinculo, 'tomas')
  assert.equal(por.A2.tipo, 'revisar'); assert.equal(por.A2.por, 'nombre')
  assert.equal(por.A3.tipo, 'crear')
  assert.equal(por.A4.tipo, 'en_alta')
})

test('decidir: ambigüedades (no se toca nada)', () => {
  const base = { todosCrm: [], vinculos: [], hoy: HOY }
  const uno = (c, extra) => decidir({ ...base, ...extra, clientes: [c], todosCrm: [{ id: c.id, nombre: c.nombre }, ...(extra.todosCrm ?? [])] })[0]
  // Dos carpetas: la registrada y otra con su nombre exacto
  assert.equal(uno(cli('A1', 'Ana Paz'), { carpetas: [carp(1, 'Ana Paz - C.J'), carp(2, 'Ana Paz - SKWD')], vinculos: [{ drive_id: id(1), id_crm: 'A1', origen: 'vigia', vinculo: 'bot' }] }).codigo, 'dos_carpetas')
  // Registrada fuera de Clientes (suelta en Mi unidad) además de la de Clientes
  assert.equal(uno(cli('A1', 'Ana Paz'), { carpetas: [carp(1, 'Ana Paz - C.J')], vinculos: [{ drive_id: id(9), id_crm: 'A1', origen: 'doc' }] }).codigo, 'suelta')
  // Solo la suelta
  assert.equal(uno(cli('A1', 'Ana Paz'), { carpetas: [], vinculos: [{ drive_id: id(9), id_crm: 'A1', origen: 'doc' }] }).codigo, 'fuera')
  // Homónimo en el CRM
  assert.equal(uno(cli('A1', 'Ana Paz'), { carpetas: [carp(1, 'Ana Paz - C.J')], todosCrm: [{ id: 'A9', nombre: 'Ana Paz' }] }).codigo, 'homonimo')
  // La carpeta con su nombre es de otro ID
  assert.equal(uno(cli('A1', 'Ana Paz'), { carpetas: [carp(1, 'Ana Paz - C.J')], vinculos: [{ drive_id: id(1), id_crm: 'A7', origen: 'vigia', vinculo: 'tomas' }] }).codigo, 'de_otro')
  // Nombre parecido ("Majo Ugarte - SKWD" para María José Ugarte): no se crea otra
  assert.equal(uno(cli('A1', 'Maria Jose Ugarte'), { carpetas: [carp(1, 'Majo Ugarte - SKWD')] }).codigo, 'parecida')
  assert.equal(uno(cli('A1', 'Eliseo Fabian Arroyo'), { carpetas: [carp(1, 'Eliseo - SKWD')] }).codigo, 'parecida')
  // Cliente viejo sin carpeta
  assert.equal(uno(cli('A1', 'Zoe Quiroga', '2026-08-01'), { carpetas: [] }).codigo, 'viejo_sin_carpeta')
  assert.equal(uno(cli('A1', 'Zoe Quiroga', null), { carpetas: [] }).codigo, 'viejo_sin_carpeta')
})

test('modo por defecto: ensayo; reciente = Día 1 de 7 días o menos', () => {
  assert.equal(modoDriveCompleto({}), 'ensayo')
  assert.equal(modoDriveCompleto({ BOT_DRIVE_COMPLETO_MODO: 'real' }), 'real')
  assert.equal(modoDriveCompleto({ BOT_DRIVE_COMPLETO_MODO: 'APAGADO' }), 'apagado')
  assert.equal(esReciente({ dia1: '2026-10-27' }, HOY), true)
  assert.equal(esReciente({ dia1: '2026-10-20' }, HOY), false)
  assert.equal(esReciente({ dia1: null }, HOY), false)
})

// ── correrDriveCompleto ───────────────────────────────────────────────────────────────────────────────────────────
function depsJuguete(entrada, hijos, op = {}) {
  const hecho = { preparar: [], vigia: [], docs: [], avisos: [] }
  const avisadas = new Set()
  let nuevos = 0
  return {
    hecho,
    deps: {
      leerEntrada: async () => ({ carpetaClientesId: RAIZ, ...entrada }),
      listarHijos: async (c) => hijos[c] ?? [],
      preparar: async (a, o) => {
        hecho.preparar.push({ nombre: a.nombre, o })
        const g = { ...(o.guardado ?? {}) }
        const el = (k) => (g[k] ? { estado: 'existia', id: g[k].id } : o.omitir?.includes(k) ? { estado: 'pendiente' } : (g[k] = { id: `${k}Nuevo${String(++nuevos).padStart(18, '0')}`, url: 'u' }, { estado: 'creado', id: g[k].id }))
        const carpeta = g.carpeta ? { estado: 'existia', id: g.carpeta.id } : (g.carpeta = { id: 'CarpetaNueva0000000000000001', url: 'u' }, { estado: 'creado' })
        const r = { carpeta, crudos: el('crudos'), editados: el('editados'), marca: el('marca'), guiones: el('guiones'), bienvenida: el('bienvenida'), errores: [], esperaOk: null, guardar: g }
        return r
      },
      plantillaGuionesId: () => PLANTILLA,
      registradasVigia: async () => new Set(op.vigia ?? []),
      docsListos: async () => new Set(op.listos ?? []),
      guardarVigia: async (f) => { hecho.vigia.push(...f) },
      vincularDoc: async (p) => { hecho.docs.push(p) },
      avisar: async (a) => { hecho.avisos.push(a); if (avisadas.has(a.clave)) return 'ya_estaba'; avisadas.add(a.clave); return 'enviado' },
      ahora: () => 0,
    },
  }
}

const ENTRADA = {
  clientes: [cli('A1', 'Ana Paz', '2026-09-01'), cli('A2', 'Zoe Quiroga', '2026-10-31'), cli('A3', 'Maria Jose Ugarte', '2026-09-12'), cli('A4', 'Rita Olmos', '2026-10-01')],
  todosCrm: [{ id: 'A1', nombre: 'Ana Paz' }, { id: 'A2', nombre: 'Zoe Quiroga' }, { id: 'A3', nombre: 'Maria Jose Ugarte' }, { id: 'A4', nombre: 'Rita Olmos' }],
  carpetas: [carp(1, 'Ana Paz - C.J'), carp(3, 'Majo Ugarte - SKWD'), carp(4, 'Rita Olmos - C.J')],
  vinculos: [{ drive_id: id(1), id_crm: 'A1', origen: 'vigia', vinculo: 'tomas' }],
  hoy: HOY,
}
const HIJOS = {
  [id(1)]: [{ id: id(11), name: 'Crudos - AP', mimeType: MIME_CARPETA_DRIVE }, { id: id(12), name: 'Editados - AP', mimeType: MIME_CARPETA_DRIVE }, { id: id(13), name: 'Guiones - AP', mimeType: MIME_DOC_DRIVE }],
  [id(4)]: [{ id: id(41), name: 'Crudos', mimeType: MIME_CARPETA_DRIVE }, { id: id(42), name: 'Editados', mimeType: MIME_CARPETA_DRIVE }, { id: id(43), name: 'Marca', mimeType: MIME_CARPETA_DRIVE }, { id: id(44), name: 'Guion', mimeType: MIME_DOC_DRIVE }],
}

test('ensayo: lista lo que haría y no escribe ni avisa', async () => {
  const { deps, hecho } = depsJuguete(ENTRADA, HIJOS)
  const r = await correrDriveCompleto(deps, { modo: 'ensayo' })
  const por = Object.fromEntries(r.plan.map((l) => [l.id, l]))
  assert.equal(por.A1.accion, 'completar'); assert.deepEqual(por.A1.faltan, ['Marca'])
  assert.equal(por.A2.accion, 'crear'); assert.ok(por.A2.faltan.includes('Bienvenida'))   // reciente
  assert.equal(por.A3.accion, 'ambiguo')
  assert.equal(por.A4.accion, 'registrar')   // completa, falta registrarla en el vigía
  assert.deepEqual(hecho, { preparar: [], vigia: [], docs: [], avisos: [] })
})

test('real: completa sin bienvenida a los viejos, crea la nueva, registra, avisa la ambigüedad una vez y un solo resumen', async () => {
  const { deps, hecho } = depsJuguete(ENTRADA, HIJOS, { vigia: [id(4), id(41), id(42), id(43)] })
  const r = await correrDriveCompleto(deps, { modo: 'real' })
  const por = Object.fromEntries(r.plan.map((l) => [l.id, l]))
  assert.deepEqual(por.A1.hecho, ['Marca'])
  const pA1 = hecho.preparar.find((p) => p.nombre === 'Ana Paz')
  assert.deepEqual(pA1.o.omitir, ['bienvenida'])
  assert.equal(pA1.o.guardado.guiones.id, id(13))
  const pA2 = hecho.preparar.find((p) => p.nombre === 'Zoe Quiroga')
  assert.equal(pA2.o.guardado, null); assert.deepEqual(pA2.o.omitir, [])
  assert.equal(por.A4.accion, 'nada')
  // Vigía: la Marca nueva de A1 (con su vínculo 'tomas') y la carpeta nueva de A2 con sus raíces
  assert.ok(hecho.vigia.some((f) => f.tipo === 'marca' && f.id_crm === 'A1' && f.vinculo === 'tomas'))
  assert.equal(hecho.vigia.filter((f) => f.id_crm === 'A2').length, 4)
  assert.ok(hecho.vigia.find((f) => f.id_crm === 'A2' && f.tipo === 'cliente').padre_id === RAIZ)
  // Doc: solo el creado (A2); el de A1 ya existía y A1 no es reciente
  assert.deepEqual(hecho.docs.map((d) => d.idCrm), ['A2'])
  const ops = hecho.avisos.filter((a) => a.canal === 'operaciones')
  assert.equal(ops.length, 1); assert.equal(ops[0].idCrm, 'A3'); assert.deepEqual(ops[0].menciones, ['aylu', 'gero_m'])
  assert.equal(hecho.avisos.filter((a) => a.canal === 'sistema').length, 1)
  // Mañana: lo mismo no se vuelve a avisar (la clave ya estaba)
  const r2 = await correrDriveCompleto(deps, { modo: 'real' })
  assert.ok(r2.avisos.filter((a) => a.clave.includes('ambiguo')).every((a) => a.estado === 'ya_estaba'))
})

test('tope: no llama al puente para más de N clientes por corrida', async () => {
  const clientes = Array.from({ length: TOPE_POR_CORRIDA + 3 }, (_, i) => cli(`A${i + 10}`, `Cliente Numero${'x'.repeat(i + 1)} Apellido${i}`, '2026-09-01'))
  const carpetas = clientes.map((c, i) => carp(200 + i, `${c.nombre} - C.J`))
  const { deps, hecho } = depsJuguete({ clientes, todosCrm: clientes, carpetas, vinculos: [], hoy: HOY }, {})
  const r = await correrDriveCompleto(deps, { modo: 'real' })
  assert.equal(hecho.preparar.length, TOPE_POR_CORRIDA)
  assert.equal(r.resumen.tope, 3)
})

test('sin nada que hacer: no manda resumen', async () => {
  const { deps, hecho } = depsJuguete({ clientes: [cli('A4', 'Rita Olmos')], todosCrm: [{ id: 'A4', nombre: 'Rita Olmos' }], carpetas: [carp(4, 'Rita Olmos - C.J')], vinculos: [], hoy: HOY },
    { [id(4)]: [...HIJOS[id(4)], { id: id(45), name: 'Bienvenida - Rita Olmos', mimeType: MIME_DOC_DRIVE }] }, { vigia: [id(4), id(41), id(42), id(43)], listos: ['A4'] })
  const r = await correrDriveCompleto(deps, { modo: 'real' })
  assert.equal(r.resumen.nada, 1)
  assert.deepEqual(hecho.avisos, [])
})

test('con Doc de guiones registrado fuera de su carpeta: no le copia otro', async () => {
  const hijos = { [id(5)]: [{ id: id(51), name: 'Crudos - VP', mimeType: MIME_CARPETA_DRIVE }, { id: id(52), name: 'Editados - VP', mimeType: MIME_CARPETA_DRIVE }, { id: id(53), name: 'Marca - VP', mimeType: MIME_CARPETA_DRIVE }] }
  const { deps, hecho } = depsJuguete({ clientes: [cli('A5', 'Vera Paz', '2026-09-01')], todosCrm: [{ id: 'A5', nombre: 'Vera Paz' }], carpetas: [carp(5, 'Vera Paz - C.J')], vinculos: [], hoy: HOY },
    hijos, { vigia: [id(5), id(51), id(52), id(53)], listos: ['A5'] })
  const r = await correrDriveCompleto(deps, { modo: 'real' })
  assert.equal(r.resumen.nada, 1)
  assert.equal(hecho.preparar.length, 0)
})

test('avisos: los ya avisados no tapan el tope de los que siguen', async () => {
  const clientes = Array.from({ length: 12 }, (_, i) => cli(`A${i + 60}`, `Persona${'q'.repeat(i + 1)} Sincarpeta${'z'.repeat(i + 1)}`, '2026-01-01'))
  const { deps, hecho } = depsJuguete({ clientes, todosCrm: clientes, carpetas: [], vinculos: [], hoy: HOY }, {})
  await correrDriveCompleto(deps, { modo: 'real' })
  const primera = hecho.avisos.filter((a) => a.canal === 'operaciones').length
  assert.equal(primera, 8)
  await correrDriveCompleto(deps, { modo: 'real' })
  assert.equal(new Set(hecho.avisos.filter((a) => a.canal === 'operaciones').map((a) => a.clave)).size, 12)
})
