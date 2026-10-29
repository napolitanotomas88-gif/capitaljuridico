// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-vista.mjs
// Pantalla de la ficha de kickoff (/clientes/<id>/kickoff): modelo de vista (lib/bot/kickoff/vista.ts), tildes y revisión
// (revision.ts), la decisión de la API (acciones.ts) y las consultas nuevas de registro.ts contra un Neon FALSO. SIN red y
// SIN base: fetch global queda bloqueado y DATABASE_URL apunta a un host inventado.
// Fixture: FICHA_EJEMPLO de lib/bot/kickoff/demo.ts, la copia SANEADA de .cache/kickoff-prueba/salida-195704214.json (prueba
// del 24/10 con el portfolio de Meta): sin mails, ids de cuentas, nombres de clientes ni copy ajeno. Si además está la salida
// real de la prueba (no se versiona), un test la pasa por la vista para controlar que no se filtren los nombres de los otros
// clientes ni sus cuentas, ni el mail del invitado o de quien grabó (los de trabajo del equipo sí pueden aparecer: un
// pendiente dice a quién darle acceso); no imprime nada de su contenido.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

for (const k of ['DATABASE_URL', 'KICKOFF_REVISOR_TOMI', 'KICKOFF_REVISOR_GERO_M', 'META_ANUNCIOS_TOKEN', 'META_CLIENTES_TOKEN', 'META_ADS_WRITE_TOKEN']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const { FICHA_EJEMPLO, filasDemo } = await import('../lib/bot/kickoff/demo.ts')
const V = await import('../lib/bot/kickoff/vista.ts')
const R = await import('../lib/bot/kickoff/revision.ts')
const { atenderAccion, atenderPost, mismoOrigen, textoParaLanzar, LARGO_MAX_CUERPO } = await import('../lib/bot/kickoff/acciones.ts')
const { calcularFaltantes } = await import('../lib/bot/kickoff/ficha.ts')
const registro = await import('../lib/bot/kickoff/registro.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')
const { MAILS_ACCESOS_EQUIPO } = await import('../lib/bot/kickoff/tipos.ts')

const clonar = x => JSON.parse(JSON.stringify(x))
const CUANDO = '2026-10-24T18:05:00.000Z'
/** Una fila de cj_kickoffs como la devuelve listarFichasCliente, con la ficha del ejemplo (o la que se pase). */
function fila(o = {}) {
  const ficha = 'ficha' in o ? o.ficha : clonar(FICHA_EJEMPLO)
  return {
    recording_id: ficha?.recording_id ?? 100000001, estado: 'lista', titulo: ficha?.titulo ?? null, url: ficha?.url ?? null, cliente_crm: ficha?.cliente?.cliente_crm ?? null,
    id_crm: ficha?.cliente?.id_crm ?? null, error: null, ideas: null, revision: null, portfolio_checks: null, faltantes_checks: null,
    creado: '2026-10-24T17:26:55.361Z', actualizado: '2026-10-24T17:52:02.881Z', ...o, ficha,
  }
}
const huellaEjemplo = () => V.armarVista(fila()).ideas.huella
const rev = (estado, huella = huellaEjemplo(), comentario = '', historial = []) => ({ estado, comentario, cuando: CUANDO, email: 'x@ejemplo.test', huella, historial })
const textos = xs => xs.map(x => x.texto)

describe('vista: la ficha del ejemplo (copia saneada de la prueba del 24/10)', () => {
  const v = V.armarVista(fila())
  test('encabezado: cliente del CRM, fecha, quién la hizo y el link a Fathom', () => {
    assert.equal(v.encabezado.cliente, 'Clienta Ejemplo (ejemplo)')
    assert.equal(v.encabezado.verificado, true)
    assert.equal(v.encabezado.idCrm, 'E157')
    assert.equal(v.encabezado.quien, 'Tomás')
    assert.equal(v.encabezado.fecha, 'vie 23/10 09:00')
    assert.equal(v.encabezado.fathom, 'https://fathom.video/calls/100000001')
    assert.equal(v.encabezado.esKickoff, true)
    assert.deepEqual([v.registro.tono, v.registro.etiqueta, v.registro.aviso], ['verde', 'Lista', null])
  })
  test('portfolio: 5 de 7 ok según Meta; Instagram y WhatsApp quedan para tildar (WhatsApp, mencionado)', () => {
    assert.equal(v.portfolio.filas.length, 7)
    assert.deepEqual(v.portfolio.filas.filter(x => x.tildable).map(x => x.item), ['instagram', 'whatsapp_business'])
    assert.equal(v.portfolio.resumen.texto, '5 de 7 ok · 2 para tildar a mano')
    const wa = v.portfolio.filas.find(x => x.item === 'whatsapp_business')
    assert.equal(wa.visto.texto, 'Para tildar (se mencionó)', '"sin verificar" queda solo para la verificación de Meta')
    assert.equal(v.portfolio.filas.find(x => x.item === 'instagram').visto.texto, 'Para tildar')
    assert.equal(wa.dato.momento.etiqueta, '≈19:58')
    // La tarjeta la da ok Meta, pero se mencionó en la llamada: lleva la cita y el ▶ (como el markdown)
    const tarjeta = v.portfolio.filas.find(x => x.item === 'tarjeta')
    assert.deepEqual([tarjeta.fuente, tarjeta.visto.texto, tarjeta.tildable], ['meta', 'Ok', false])
    assert.match(tarjeta.dato.cita, /bien cargada/)
    // Lo que no habla de la llamada no lleva ▶
    assert.equal(v.portfolio.filas.find(x => x.item === 'pagina_facebook').dato, null)
    assert.match(v.portfolio.meta.lineas[0], /^Cuenta revisada en Meta: act_100000000000001 \(«USD ESTUDIO JURIDICO EJEMPLO»\) · factura en USD · hora de Argentina · la encontró el tablero de anuncios \(no está en «Cuentas Meta» del CRM\)/)
  })
  test('faltantes: los que calcula ficha.ts (la zona con su ▶ y los lugares, la cuenta para cargar en el CRM); la grabación cortada, en la cabecera', () => {
    // En la pantalla el ▶ del faltante va aparte (como link): el texto no lo repite (en el markdown y el aviso sigue)
    const sinPlay = x => x.replace(/\s*▶\s*≈?\d{1,2}:\d{2}/g, '')
    assert.deepEqual(textos(v.faltantes), FICHA_EJEMPLO.faltantes.map(sinPlay), 'el ejemplo guarda los faltantes de hoy')
    assert.deepEqual(calcularFaltantes(FICHA_EJEMPLO), FICHA_EJEMPLO.faltantes)
    assert.equal(v.faltantes[0].texto, 'Zona del mapa: anotar el recorte exacto para la campaña (se ve en la grabación; se nombró Colonia Ejemplo, Paraje Norte, Villa Inventada y El Molino)')
    assert.match(FICHA_EJEMPLO.faltantes[0], /se ve en la grabación ▶ ≈17:18;/)
    assert.deepEqual([v.faltantes[0].clave, v.faltantes[0].momento.etiqueta, v.faltantes[0].momento.href], ['zona_mapa', '≈17:18', 'https://fathom.video/calls/100000001?timestamp=1038'])
    assert.equal(v.faltantes[1].texto, 'Portfolio para tildar a mano (Meta no los pudo leer y en la llamada no se confirmaron): Instagram y WhatsApp Business (WhatsApp Business solo se nombró)')
    assert.equal(v.faltantes[1].clave, null, 'se resuelve tildando en la tabla, no acá')
    assert.equal(v.faltantes[2].clave, 'cuenta_crm')
    assert.equal(v.encabezado.corte, 'La grabación cortó a las 09:22; el evento iba hasta las 09:45')
    assert.deepEqual(v.hechos, [])
  })
  test('una ficha vieja con los textos de antes: se recalculan (zona con ▶) y "la grabación terminó…" deja de ser un faltante', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.faltantes = ['Zona marcada en un mapa en pantalla: verificar el recorte exacto en la grabación o en la cuenta', 'La grabación terminó a las 09:22 y el evento estaba agendado hasta las 09:45: si después…']
    const vv = V.armarVista(fila({ ficha: f }))
    assert.match(vv.faltantes[0].texto, /^Zona del mapa: anotar el recorte/)
    assert.ok(!vv.faltantes.some(x => /grabación terminó/.test(x.texto)))
    // Si la ficha ni siquiera se puede recalcular, quedan los guardados (sin el de la grabación)
    const rota = clonar(FICHA_EJEMPLO); rota.zona = null; rota.faltantes = ['Zona marcada en un mapa en pantalla: verificar', 'La grabación terminó a las 09:22 y…']
    assert.deepEqual(textos(V.armarVista(fila({ ficha: rota })).faltantes).filter(x => !/^Portfolio/.test(x)), ['Zona marcada en un mapa en pantalla: verificar'])
  })
  test('faltantes marcados como hechos: pasan a "Hechos" con la nota y dejan de contar; la nota del mapa va a "para lanzar"', () => {
    const marca = (nota = '') => ({ nota, quien: 'Ana Prueba', email: 'ana@ejemplo.test', cuando: CUANDO })
    const vv = V.armarVista(fila({ faltantes_checks: { zona_mapa: marca('radio 30 km desde Colonia Ejemplo'), cuenta_crm: marca(), otra: marca('x'), fecha_lanzamiento: marca('jue 29/10'), whatsapp_destino: marca('no es un número') } }))
    assert.deepEqual(vv.faltantes.map(x => x.clave), [null])
    assert.deepEqual(vv.hechos.map(x => [x.clave, x.marca.nota, x.marca.quien, x.marca.cuandoTexto]), [['zona_mapa', 'radio 30 km desde Colonia Ejemplo', 'Ana Prueba', 'sáb 24/10 15:05'], ['cuenta_crm', '', 'Ana Prueba', 'sáb 24/10 15:05']])
    assert.equal(vv.hechos[0].marca.email, undefined, 'sin el mail de quien marcó')
    assert.equal(vv.lanzar.zona.nota, 'radio 30 km desde Colonia Ejemplo')
    assert.deepEqual(vv.lanzar.datos.map(d => [d.clave, d.marca?.nota ?? null]), [['fecha_lanzamiento', 'jue 29/10'], ['whatsapp_destino', null]], 'un dato que ya no valida no se muestra')
    assert.equal(V.claveMarcable(vv, 'zona_mapa'), true)
    assert.equal(V.claveMarcable(vv, 'whatsapp_destino'), true)
    assert.equal(V.claveMarcable(vv, 'rama'), false, 'la ficha no tiene ese faltante')
  })
  test('para lanzar: cuenta con moneda y hora, página, presupuesto de arranque, zona, avatar sin el contexto, ideas y lanzamiento', () => {
    const l = v.lanzar
    assert.equal(l.cuenta, 'act_100000000000001 («USD ESTUDIO JURIDICO EJEMPLO»)')
    assert.equal(l.monedaHora, 'factura en USD · hora de Argentina')
    assert.equal(l.pagina, 'Página en el portfolio: «Estudio Clienta Ejemplo»')
    assert.equal(l.presupuesto, 'USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes')
    assert.equal(l.zona.texto, 'Colonia Ejemplo · Paraje Norte · Villa Inventada · El Molino · se presenta como «Santa Rosa capital»')
    assert.equal(l.zona.momento.etiqueta, '≈17:18')
    assert.equal(l.avatar, 'al menos un año y medio trabajando · prioridad a gente en blanco o mitad en negro y mitad en blanco · afuera: pasantes · gente con pocos meses de trabajo · trabajo totalmente en negro')
    assert.equal(l.lanzamiento, 'Lanzamiento: sin fecha (guiones para mar 27/10 o mié 28/10, estimado; después graba Clara y se edita)')
    assert.match(textoParaLanzar(v), /^cuenta act_100000000000001 .*\(factura en USD · hora de Argentina\) · 💵 USD 8 por día para arrancar/)
  })
  test('avatar: el contexto del mercado va aparte (no es un filtro)', () => {
    assert.deepEqual(v.avatar.excluye.map(d => d.texto.slice(0, 12)), ['nada de pasa', 'nada de gent', 'nada de trab'])
    assert.match(v.avatar.contexto[0].texto, /^contexto de la zona/)
  })
  test('▶ minuto: al segundo de la cita (≈) si hay aprox; si no, al del renglón; ?timestamp= en segundos', () => {
    assert.deepEqual(v.rama.dato.momento, { href: 'https://fathom.video/calls/100000001?timestamp=1330', etiqueta: '22:10', aprox: false })
    assert.deepEqual(v.rama.aFuturo[0].momento, { href: 'https://fathom.video/calls/100000001?timestamp=505', etiqueta: '≈08:25', aprox: true })
    assert.equal(v.zona.presentarse.texto, 'Santa Rosa capital')
    assert.equal(v.presupuesto.texto, 'USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes')
    assert.ok(v.presupuesto.mes.momento, 'el mensual dicho aparte lleva su ▶')
  })
  test('ideas: 5, a revisar por Tomi y Gero M; ganadores con qué ideas los citan', () => {
    assert.equal(v.ideas.lista.length, 5)
    assert.match(v.ideas.huella, /^[0-9a-f]{8}$/)
    assert.deepEqual([v.ideas.general, v.ideas.texto], ['pendiente', 'Falta que las revisen Tomi y Gero M.'])
    assert.deepEqual(v.ideas.lista[0].ganadores, ['G2'])
    assert.deepEqual(v.ganadores.lista.find(g => g.id === 'G2').ideas, [1])
    assert.equal(v.ganadores.lista.length, 10)
  })
  test('privacidad: de los ganadores no sale el otro cliente, su cuenta ni el copy; tampoco los mails', () => {
    for (const g of v.ganadores.lista) assert.deepEqual(Object.keys(g).sort(), ['anuncio', 'cplUSD', 'gastoUSD', 'id', 'ideas', 'mensajes', 'pais', 'subtema'])
    const todo = JSON.stringify(v)
    assert.ok(!/Cliente \d+ \(ejemplo\)|act_2000/.test(todo), 'el nombre o la cuenta de otro cliente se filtró')
    assert.ok(!todo.includes('@'), 'un mail se filtró')
    assert.equal(v.ganadores.estadoTexto, 'Listos')
    assert.equal(v.ganadores.nota, '16 cuentas de la rama, 30 guiones con USD 20+ y 10+ mensajes · 1 de otra rama descartados · 4 de otro país (no AR) quedaron afuera')
  })
  test('mails: los del equipo pasan a su nombre corto y cualquier otro a [mail], en todo texto (un pendiente de Claude los traía)', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.pendientes = ['Dar acceso a grabador.a@example.test y a grabador.b@example.test', 'Escribirle a cliente.real@estudio.com.ar']
    f.acuerdos[0].que = 'Mandarle los guiones a cliente.real@estudio.com.ar'
    const vv = V.armarVista(fila({ ficha: f }))
    assert.deepEqual(vv.pendientes, ['Dar acceso a Gero A y a Valentino', 'Escribirle a [mail]'])
    assert.equal(vv.acuerdos[0].que, 'Mandarle los guiones a [mail]')
    assert.ok(!JSON.stringify(vv).includes('@'))
    assert.equal(V.taparMails('x Grabador.A@example.test y'), 'x Gero A y')
  })
  test('ganadores: estado con texto (nunca la clave cruda) y la nota vieja "de otro país que AR afuera" se lee bien', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.ganadores = { ...f.ganadores, estado: 'pocos_datos', nota: '3 cuentas · 2 de otro país que AR (1 usados para completar, marcados)' }
    const g = V.armarVista(fila({ ficha: f })).ganadores
    assert.deepEqual([g.estadoTexto, g.nota], ['Pocos datos (menos de 3)', '3 cuentas · 2 de otro país (no AR): 1 usados para completar, marcados'])
  })
})

describe('vista: tildes a mano', () => {
  const check = (valor, quien = 'Ana Prueba', nota = '') => ({ valor, nota, quien, email: 'ana@ejemplo.test', cuando: CUANDO })
  test('el tilde manda sobre "sin dato" y la línea de tildar lista solo lo que falta', () => {
    const v = V.armarVista(fila({ portfolio_checks: { instagram: check('ok') } }))
    const ig = v.portfolio.filas.find(x => x.item === 'instagram')
    assert.deepEqual([ig.visto.texto, ig.visto.aMano, ig.check.quien, ig.check.cuandoTexto], ['Ok (a mano)', true, 'Ana Prueba', 'sáb 24/10 15:05'])
    assert.equal(ig.check.email, undefined, 'el mail de quien tildó no va a la pantalla')
    assert.equal(v.portfolio.resumen.texto, '6 de 7 ok · 1 para tildar a mano · 1 tildado a mano')
    assert.equal(v.faltantes[1].texto, 'Portfolio para tildar a mano (Meta no los pudo leer y en la llamada no se confirmaron): WhatsApp Business (WhatsApp Business solo se nombró)')
  })
  test('todo tildado: sin línea de tildar; lo tildado como falta queda en los faltantes con quién', () => {
    const v = V.armarVista(fila({ portfolio_checks: { instagram: check('ok'), whatsapp_business: check('falta', 'Tomi', 'le pedí que lo cree') } }))
    assert.ok(!textos(v.faltantes).some(x => /tildar a mano/.test(x)))
    assert.ok(textos(v.faltantes).includes('Portfolio · WhatsApp Business: falta (lo tildó Tomi el sáb 24/10 15:05) · le pedí que lo cree'), textos(v.faltantes).join('\n'))
    assert.equal(v.portfolio.resumen.aTildar, 0)
  })
  test('un tilde de un ítem que ya resolvió Meta se muestra pero no manda', () => {
    const v = V.armarVista(fila({ portfolio_checks: { pagina_facebook: check('falta') } }))
    const p = v.portfolio.filas.find(x => x.item === 'pagina_facebook')
    assert.deepEqual([p.tildable, p.visto.texto, p.check.valor], [false, 'Ok', 'falta'])
    assert.equal(V.itemTildable(v, 'pagina_facebook'), false)
    assert.equal(V.itemTildable(v, 'instagram'), true)
  })
  test('portfolio_checks con basura: se ignora lo que no tiene forma', () => {
    const v = V.armarVista(fila({ portfolio_checks: { instagram: { valor: 'quizás', cuando: CUANDO }, whatsapp_business: { valor: 'ok', cuando: 'ayer' }, otro: check('ok') } }))
    assert.equal(v.portfolio.resumen.tildados, 0)
  })
})

describe('vista: casos', () => {
  test('ficha vieja sin portfolio_meta (ni portfolio_final ni grabo): todo de la llamada y los 7 para tildar', () => {
    const f = clonar(FICHA_EJEMPLO)
    for (const k of ['portfolio_meta', 'portfolio_final', 'grabo', 'fin_grabacion', 'fin_agendado']) delete f[k]
    const v = V.armarVista(fila({ ficha: f }))
    assert.equal(v.portfolio.filas.filter(x => x.tildable).length, 7)
    assert.deepEqual(v.portfolio.filas.filter(x => x.mencionado).map(x => x.item), ['whatsapp_business', 'tarjeta'])
    assert.match(v.portfolio.meta.lineas[0], /^Sin chequeo de Meta/)
    assert.equal(v.encabezado.quien, null)
    const linea = textos(v.faltantes).find(x => /tildar a mano/.test(x))
    assert.equal(linea, 'Portfolio para tildar a mano (sin chequeo de Meta y en la llamada no se confirmaron): los 7 ítems (WhatsApp Business y Tarjeta solo se nombraron)')
    assert.ok(!textos(v.faltantes).some(x => /^Portfolio · cargar act_/.test(x)), 'sin Meta no hay cuenta encontrada por el tablero')
    assert.equal(v.encabezado.corte, null, 'sin fin agendado no hay nota de corte')
  })
  test('sin id_crm: cliente sin verificar (el escuchado) y la API no la toca desde la URL de nadie', async () => {
    const f = clonar(FICHA_EJEMPLO)
    Object.assign(f.cliente, { cliente_crm: null, id_crm: null, como: null })
    const fl = fila({ ficha: f, id_crm: null, cliente_crm: null })
    const v = V.armarVista(fl)
    assert.deepEqual([v.encabezado.cliente, v.encabezado.verificado, v.encabezado.idCrm, v.encabezado.como], ['CLIENTA EJEMPLO', false, null, 'sin verificar en el CRM'])
    const d = deps({ fila: fl })
    const r = await atenderAccion(d, 'E157', { accion: 'check', recording_id: fl.recording_id, item: 'instagram', valor: 'ok', nota: '', previo: null }, SESION)
    assert.equal(r.status, 404)
    assert.equal(d.escrituras.length, 0)
  })
  test('revisión a medias: aprobó Tomi, falta Gero M', () => {
    const v = V.armarVista(fila({ revision: { tomi: rev('aprobada'), gero_m: null } }))
    assert.deepEqual([v.ideas.general, v.ideas.texto], ['a_medias', 'Aprobó Tomi; falta Gero M.'])
    assert.deepEqual(v.ideas.revisores.map(r => [r.clave, r.estado, r.previo]), [['tomi', 'aprobada', CUANDO], ['gero_m', 'pendiente', null]])
  })
  test('ideas aprobadas por los dos', () => {
    const v = V.armarVista(fila({ revision: { tomi: rev('aprobada'), gero_m: rev('aprobada') } }))
    assert.deepEqual([v.ideas.general, v.ideas.texto], ['aprobadas', 'Aprobadas por Tomi y Gero M.'])
  })
  test('cambios pedidos: manda sobre la aprobación del otro', () => {
    const v = V.armarVista(fila({ revision: { tomi: rev('aprobada'), gero_m: rev('cambios', huellaEjemplo(), 'la 5 no: es de ART') } }))
    assert.deepEqual([v.ideas.general, v.ideas.texto], ['cambios', 'Gero M pidió cambios · aprobó Tomi.'])
    assert.equal(v.ideas.revisores[1].comentario, 'la 5 no: es de ART')
  })
  test('una aprobación de otras ideas (el bot las rehizo) no cuenta, pero conserva la marca para escribir', () => {
    const v = V.armarVista(fila({ revision: { tomi: rev('aprobada', '00000000'), gero_m: null } }))
    const t = v.ideas.revisores[0]
    assert.deepEqual([t.estado, t.previo], ['pendiente', CUANDO])
    assert.match(t.anterior, /^aprobó otra versión de las ideas/)
    assert.equal(v.ideas.general, 'pendiente')
  })
  test('fila en error con las ideas solo en la columna ideas: se muestran, avisando', () => {
    const [, segunda] = filasDemo('E157')
    const v = V.armarVista(segunda)
    assert.deepEqual([v.registro.tono, v.registro.etiqueta, v.ideas.desdeRegistro, v.ideas.lista.length, v.ganadores.lista.length], ['rojo', 'Con error', true, 5, 10])
    assert.match(v.registro.aviso, /^El bot no terminó esta ficha/)
  })
  test('el motivo del error va sin URLs', () => {
    const v = V.armarVista(fila({ estado: 'error', error: 'falló https://discord.com/api/webhooks/123/abc al mandar' }))
    assert.ok(!/discord\.com/.test(v.registro.aviso) && /\[url\]/.test(v.registro.aviso))
  })
  test('no es un kickoff: sin faltantes ni ideas para revisar', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.tipo_reunion = 'seguimiento'
    f.ideas_guiones = { estado: 'no_corresponde', revisores: ['Tomi', 'Gero M'], ideas: [], notas: '', motivo: 'la llamada no es un kickoff (seguimiento)' }
    const v = V.armarVista(fila({ ficha: f, estado: 'no_kickoff' }))
    assert.deepEqual([v.encabezado.esKickoff, v.faltantes, v.ideas.general, v.registro.etiqueta], [false, [], 'sin_ideas', 'No es kickoff'])
  })
  test('una URL que no es de Fathom no se linkea (ni la llamada ni los minutos)', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.url = 'https://otro.test/calls/1'
    const v = V.armarVista(fila({ ficha: f, url: 'javascript:alert(1)' }))
    assert.equal(v.encabezado.fathom, null)
    assert.equal(v.rama.dato.momento, null)
    assert.equal(V.urlFathom('http://fathom.video/calls/1'), null)
    assert.equal(V.urlFathom('https://fathom.video.otro.test/x'), null)
    assert.equal(V.urlFathom('https://share.fathom.video/x'), 'https://share.fathom.video/x')
  })
  test('lo que no tiene forma de ficha: null', () => {
    for (const x of [null, {}, { version: 2 }, 'texto', { version: 1, recording_id: 1, tipo_reunion: 'kickoff' }]) assert.equal(V.armarVista(fila({ ficha: x })), null)
  })
})

describe('vista: cuál se muestra y el selector', () => {
  const kick = (id, fecha, o = {}) => { const f = clonar(FICHA_EJEMPLO); f.recording_id = id; f.fecha = fecha; return fila({ ficha: f, recording_id: id, ...o }) }
  const seg = (id, fecha) => { const f = clonar(FICHA_EJEMPLO); f.recording_id = id; f.fecha = fecha; f.tipo_reunion = 'seguimiento'; return fila({ ficha: f, recording_id: id, estado: 'no_kickoff' }) }
  const filas = [kick(1, '2026-10-20T12:00:00Z'), seg(3, '2026-10-30T12:00:00Z'), kick(2, '2026-10-23T12:00:00Z'), fila({ recording_id: 9, ficha: { basura: true } })]
  test('por defecto, el último kickoff (aunque haya un seguimiento más nuevo)', () => assert.equal(V.elegirFila(filas).recording_id, 2))
  test('?grabacion= elige otra del mismo cliente; una que no está → la de siempre', () => {
    assert.equal(V.elegirFila(filas, '1').recording_id, 1)
    assert.equal(V.elegirFila(filas, ['3']).recording_id, 3)
    assert.equal(V.elegirFila(filas, '77').recording_id, 2)
    assert.equal(V.elegirFila(filas, '1 OR 1=1').recording_id, 2)
  })
  test('sin fichas legibles: null; con una sola: sin selector', () => {
    assert.equal(V.elegirFila([fila({ ficha: null })]), null)
    assert.deepEqual(V.opcionesFichas([kick(1, '2026-10-20T12:00:00Z')], null), [])
  })
  test('opciones: de la más nueva a la más vieja, con el tipo y quién', () => {
    const o = V.opcionesFichas(filas, V.elegirFila(filas))
    assert.deepEqual(o.map(x => [x.recording_id, x.actual]), [[3, false], [2, true], [1, false]])
    assert.equal(o[0].etiqueta, 'vie 30/10 09:00 · seguimiento (no es kickoff)')
    assert.equal(o[1].etiqueta, 'vie 23/10 09:00 · kickoff (Fathom de Tomás)')
  })
  test('el ejemplo (?demo=1): dos filas con el ID pedido; la primera a medias, con Instagram tildado, el mapa hecho y el historial', () => {
    const [a, b] = filasDemo('e001')
    assert.deepEqual([a.id_crm, b.id_crm, a.ficha.cliente.id_crm], ['E001', 'E001', 'E001'])
    const v = V.armarVista(a)
    assert.equal(v.ideas.general, 'a_medias')
    assert.equal(v.portfolio.filas.find(x => x.item === 'instagram').visto.texto, 'Ok (a mano)')
    assert.deepEqual(v.hechos.map(x => x.clave), ['zona_mapa_video'], 'el «revisar» del mapa leído, marcado después de leer el video')
    assert.equal(v.lanzar.datos[0].marca.nota, 'jue 29/10, si graba el martes')
    assert.deepEqual(v.ideas.revisores[0].historial, ['Pidió cambios el sáb 24/10 15:02: «En la 2, el gancho más corto»'])
    assert.equal(FICHA_EJEMPLO.cliente.id_crm, 'E157', 'filasDemo no toca el fixture')
  })
  test('el ejemplo no tiene datos de la llamada real (ni la provincia, ni las localidades, ni frases)', () => {
    const todo = JSON.stringify([FICHA_EJEMPLO, ...filasDemo()])
    for (const x of ['San Juan', 'Media Agua', 'Tres Esquinas', 'Pedernal', 'Caucete', 'Causete', 'Bordón', 'Jáchal', 'deciles', 'Ortiz', 'Molina', 'Laura', 'Cris)']) assert.ok(!todo.includes(x), x)
  })
})

describe('revision.ts: lectura del jsonb, textos y validación del pedido', () => {
  test('textoLimpio: sin controles ni marcas de dirección; multilínea conserva los saltos; largo de más → null', () => {
    assert.equal(R.textoLimpio('  hola\u0000  ‮mundo​ ', 50), 'hola mundo')
    assert.equal(R.textoLimpio('a\r\nb\n\n\n\nc', 50, true), 'a\nb\n\nc')
    assert.equal(R.textoLimpio('a\nb', 50), 'a b')
    assert.equal(R.textoLimpio('x'.repeat(11), 10), null)
    assert.equal(R.textoLimpio(3, 10), null)
  })
  test('leerRevision: solo lo que tiene forma; el historial se lee con cuidado; "pendiente" (deshizo) vale', () => {
    assert.deepEqual(R.leerRevision(null), { tomi: null, gero_m: null })
    const r = R.leerRevision({ tomi: { estado: 'aprobada', cuando: CUANDO, huella: 'abcdef12', email: 'T@X.TEST', historial: [{ estado: 'cambios', comentario: 'la 2', cuando: CUANDO, huella: 'abcdef12' }, { estado: 'raro', cuando: CUANDO }] }, gero_m: { estado: 'lo pienso', cuando: CUANDO }, otro: {} })
    assert.deepEqual(r.tomi, { estado: 'aprobada', comentario: '', cuando: CUANDO, email: 't@x.test', huella: 'abcdef12', historial: [{ estado: 'cambios', comentario: 'la 2', cuando: CUANDO, huella: 'abcdef12' }] })
    assert.equal(r.gero_m, null)
    assert.equal(R.leerRevision({ gero_m: { estado: 'pendiente', cuando: CUANDO, huella: '' } }).gero_m.estado, 'pendiente')
  })
  test('historialNuevo: lo que había pasa adelante (no un "pendiente"), hasta 5', () => {
    const previa = { ...rev('cambios', 'abcdef12', 'la 2'), historial: Array.from({ length: 5 }, (_, i) => ({ estado: 'aprobada', comentario: '', cuando: CUANDO, huella: `0000000${i}` })) }
    const h = R.historialNuevo(previa)
    assert.equal(h.length, R.MAX_HISTORIAL)
    assert.deepEqual(h[0], { estado: 'cambios', comentario: 'la 2', cuando: CUANDO, huella: 'abcdef12' })
    assert.deepEqual(R.historialNuevo({ ...previa, estado: 'pendiente' }), previa.historial)
    assert.deepEqual(R.historialNuevo(null), [])
  })
  test('huellaIdeas: cambia si cambia un gancho, no si cambia el ángulo', () => {
    const a = [{ titulo: 'T', gancho: 'G', angulo: 'x' }], b = [{ titulo: 'T', gancho: 'G2', angulo: 'x' }], c = [{ titulo: 'T', gancho: 'G', angulo: 'y' }]
    assert.notEqual(R.huellaIdeas(a), R.huellaIdeas(b))
    assert.equal(R.huellaIdeas(a), R.huellaIdeas(c))
  })
  const okCheck = { accion: 'check', recording_id: 100000001, item: 'instagram', valor: 'ok', nota: ' visto ', previo: null }
  const okRev = { accion: 'revision', recording_id: 100000001, estado: 'cambios', comentario: 'la 3 no', huella: 'abcdef12', previo: CUANDO }
  const okFalt = { accion: 'faltante', recording_id: 100000001, clave: 'zona_mapa', hecho: true, nota: ' radio 30 km ', previo: null }
  test('pedidos válidos', () => {
    assert.deepEqual(R.validarPedido(okCheck), { ok: true, pedido: { ...okCheck, nota: 'visto' } })
    assert.deepEqual(R.validarPedido({ ...okCheck, valor: null, nota: '' }).pedido.valor, null)
    assert.deepEqual(R.validarPedido(okRev).pedido.estado, 'cambios')
    assert.equal(R.validarPedido({ ...okRev, estado: 'pendiente', comentario: '', huella: '' }).ok, true, 'deshacer no necesita huella')
    assert.deepEqual(R.validarPedido(okFalt).pedido, { ...okFalt, nota: 'radio 30 km' })
    assert.equal(R.validarPedido({ ...okFalt, hecho: false, nota: '' }).ok, true)
    assert.equal(R.validarPedido({ ...okFalt, clave: 'whatsapp_destino', nota: '+54 9 2954 123456' }).pedido.nota, '+54 9 2954 123456')
    assert.equal(R.validarPedido({ ...okFalt, clave: 'fecha_lanzamiento', nota: 'lun 2/11' }).ok, true)
  })
  test('pedidos inválidos: cada uno dice el campo', () => {
    const casos = [
      [null, 'cuerpo'], [[], 'cuerpo'], [{ ...okCheck, accion: 'borrar' }, 'accion'], [{ ...okCheck, quien: 'tomi' }, 'quien'],
      [{ ...okCheck, recording_id: '100000001' }, 'recording_id'], [{ ...okCheck, recording_id: -1 }, 'recording_id'], [{ ...okCheck, recording_id: 1.5 }, 'recording_id'],
      [{ ...okCheck, item: 'tiktok' }, 'item'], [{ ...okCheck, valor: 'si' }, 'valor'], [{ ...okCheck, nota: 'x'.repeat(R.LARGO_NOTA + 1) }, 'nota'],
      [{ ...okCheck, valor: null, nota: 'algo' }, 'nota'], [{ ...okCheck, previo: 'ayer' }, 'previo'], [{ ...okCheck, previo: '2026-10-24' }, 'previo'],
      [{ ...okRev, estado: 'ok' }, 'estado'], [{ ...okRev, comentario: ' ' }, 'comentario'], [{ ...okRev, estado: 'pendiente' }, 'comentario'],
      [{ ...okRev, comentario: 'x'.repeat(R.LARGO_COMENTARIO + 1) }, 'comentario'], [{ ...okRev, item: 'instagram' }, 'item'],
      // La huella de las ideas que se vieron: obligatoria para aprobar o pedir cambios, y con forma
      [{ ...okRev, huella: undefined }, 'huella'], [{ ...okRev, huella: 'ABCDEF12' }, 'huella'], [{ ...okRev, huella: 12345678 }, 'huella'],
      [{ ...okFalt, clave: 'cualquiera' }, 'clave'], [{ ...okFalt, hecho: 'si' }, 'hecho'], [{ ...okFalt, hecho: false, nota: 'x' }, 'nota'],
      [{ ...okFalt, clave: 'whatsapp_destino', nota: 'llamame' }, 'nota'], [{ ...okFalt, clave: 'fecha_lanzamiento', nota: ' ' }, 'nota'], [{ ...okFalt, item: 'instagram' }, 'item'],
    ]
    for (const [c, campo] of casos) {
      const r = R.validarPedido(c)
      assert.equal(r.ok, false, JSON.stringify(c)?.slice(0, 80))
      assert.equal(r.campo, campo, JSON.stringify(c)?.slice(0, 80))
    }
  })
  test('revisorDeSesion: variables primero (mail exacto); fuera de producción, el apellido como palabra entera; el usuario de prueba nunca', () => {
    const s = (nombre, email, o = {}) => ({ nombre, email, ...o })
    assert.equal(R.revisorDeSesion(s('Tomás Napolitano', 'tomas@x.test'), {}), 'tomi')
    assert.equal(R.revisorDeSesion(s('Gerónimo Mozzi', 'g@x.test'), {}), 'gero_m')
    assert.equal(R.revisorDeSesion(s('Gero', 'ggeroo.algo@x.test'), {}), null, 'por el mail nunca (ggeroo es su usuario de Discord, no su Gmail)')
    assert.equal(R.revisorDeSesion(s('Gerónimo Actis', 'geroa@x.test'), {}), null, 'Gero A no revisa ideas')
    assert.equal(R.revisorDeSesion(s('Tomás', 'skyward@x.test'), {}), null, 'sin apellido ni variable: no se adivina')
    // Palabra entera: "Mozzini" o "Napolitanoa" no son ellos
    assert.equal(R.revisorDeSesion(s('Lucía Mozzini', 'l@x.test'), {}), null)
    assert.equal(R.revisorDeSesion(s('Ana Mozzitelli', 'a@x.test'), {}), null)
    const env = { KICKOFF_REVISOR_TOMI: 'skyward@x.test, otro@x.test', KICKOFF_REVISOR_GERO_M: 'gm@x.test' }
    assert.equal(R.revisorDeSesion(s('Tomás', 'Skyward@X.test'), env), 'tomi')
    assert.equal(R.revisorDeSesion(s('Gero', 'gm@x.test'), env), 'gero_m')
    assert.equal(R.revisorDeSesion(s('Gero', 'gm@x.test.ar'), env), null, 'el mail exacto, no un prefijo')
    assert.equal(R.revisorDeSesion(s('Tomás Napolitano', 'tomas@x.test'), env), null, 'con la variable cargada, el apellido ya no alcanza')
    assert.equal(R.revisorDeSesion(s('Tomás Napolitano', 'tomas@x.test', { esDePrueba: true }), {}), null)
    assert.equal(R.revisorDeSesion(s('X', 'a@x.test'), { KICKOFF_REVISOR_TOMI: 'a@x.test', KICKOFF_REVISOR_GERO_M: 'a@x.test' }), null, 'en las dos listas: nadie')
    assert.equal(R.revisorDeSesion(null, {}), null)
  })
  test('revisorDeSesion en producción: falla cerrado sin las variables (cualquier "Napolitano" que vea Clientes aprobaba)', () => {
    const s = (nombre, email) => ({ nombre, email })
    for (const prod of [{ NODE_ENV: 'production' }, { VERCEL_ENV: 'production' }]) {
      assert.equal(R.revisorDeSesion(s('Tomás Napolitano', 'tomas@x.test'), prod), null)
      assert.equal(R.revisorDeSesion(s('Ana Napolitano', 'ana@x.test'), prod), null)
      assert.equal(R.revisorDeSesion(s('Gerónimo Mozzi', 'g@x.test'), prod), null)
      assert.equal(R.revisorDeSesion(s('Cualquiera', 'gm@x.test'), { ...prod, KICKOFF_REVISOR_GERO_M: 'gm@x.test' }), 'gero_m')
      assert.equal(R.revisorDeSesion(s('Tomás Napolitano', 'tomas@x.test'), { ...prod, KICKOFF_REVISOR_GERO_M: 'gm@x.test' }), null, 'falta la de Tomi: nadie es Tomi')
    }
  })
})

// ── La API (acciones.ts) con dependencias falsas ──
const SESION = { nombre: 'Ana Prueba', email: 'ana@ejemplo.test', esDePrueba: false }
const TOMI = { nombre: 'Tomás Napolitano', email: 'tomas@ejemplo.test', esDePrueba: false }
const GERO = { nombre: 'Gerónimo Mozzi', email: 'gero@ejemplo.test', esDePrueba: false }
const AHORA = new Date('2026-10-24T19:00:00.000Z')
const AVISOS = { urlBase: 'https://despacho.ejemplo.test', menciones: { tomi: '111111111111111111', gero_m: '222222222222222222', valentino: '333333333333333333' }, ads: true }
function deps(o = {}) {
  const escrituras = []
  return {
    escrituras,
    leer: async id => {
      if (o.leer) return o.leer(id)
      const f = o.fila ?? fila()
      return f.recording_id === id ? f : undefined
    },
    guardarCheck: async (...a) => { escrituras.push(['check', ...a]); return o.resultado ?? { ok: true, actual: {} } },
    guardarMarca: async (...a) => { escrituras.push(['marca', ...a]); return o.resultado ?? { ok: true, actual: {} } },
    guardarRevision: async (...a) => { escrituras.push(['revision', ...a]); return o.resultado ?? { ok: true, actual: o.revisionDespues ?? { tomi: null, gero_m: null } } },
    ahora: () => AHORA,
    ...(o.avisos === false ? {} : { avisos: o.avisos ?? AVISOS }),
  }
}
const pedidoCheck = (o = {}) => ({ accion: 'check', recording_id: 100000001, item: 'instagram', valor: 'ok', nota: 'lo vi', previo: null, ...o })
const pedidoRev = (o = {}) => ({ accion: 'revision', recording_id: 100000001, estado: 'aprobada', comentario: '', huella: huellaEjemplo(), previo: null, ...o })
const pedidoFalt = (o = {}) => ({ accion: 'faltante', recording_id: 100000001, clave: 'zona_mapa', hecho: true, nota: 'radio 30 km', previo: null, ...o })

describe('acciones.ts: lo que decide la API antes de escribir', () => {
  test('tilde: quién y cuándo salen de la sesión y del reloj; el cliente de la URL va a la condición; 200 con la marca nueva', async () => {
    const d = deps()
    const r = await atenderAccion(d, 'e157', pedidoCheck(), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.ok, r.cuerpo.cuando], [200, true, AHORA.toISOString()])
    assert.deepEqual(d.escrituras, [['check', 100000001, 'instagram', 'ok', { nombre: 'Ana Prueba', email: 'ana@ejemplo.test' }, { previo: null, nota: 'lo vi', cuando: AHORA.toISOString(), idCrm: 'E157' }]])
  })
  test('tilde de un ítem que resolvió Meta: 409 sin escribir', async () => {
    const d = deps()
    const r = await atenderAccion(d, 'E157', pedidoCheck({ item: 'pagina_facebook' }), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.codigo, d.escrituras.length], [409, 'no_tildable', 0])
  })
  test('la grabación de otro cliente (o una que no existe): 404 sin escribir', async () => {
    const d = deps()
    assert.equal((await atenderAccion(d, 'A001', pedidoCheck(), SESION, {})).status, 404)
    assert.equal((await atenderAccion(d, 'E157', pedidoCheck({ recording_id: 5 }), SESION, {})).status, 404)
    assert.equal(d.escrituras.length, 0)
  })
  test('conflicto (otro lo cambió desde lo que se vio): 409; ya es de otro cliente: 404', async () => {
    let d = deps({ resultado: { ok: false, motivo: 'conflicto', actual: {} } })
    let r = await atenderAccion(d, 'E157', pedidoCheck({ previo: CUANDO }), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.codigo], [409, 'conflicto'])
    d = deps({ resultado: { ok: false, motivo: 'no_existe', actual: null } })
    r = await atenderAccion(d, 'E157', pedidoCheck(), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.codigo], [404, 'no_existe'])
  })
  test('faltante: marcar como hecho con nota (quien sale de la sesión); uno que la ficha no tiene → 409; un dato de lanzamiento, siempre', async () => {
    let d = deps()
    let r = await atenderAccion(d, 'E157', pedidoFalt(), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.mensaje, r.cuerpo.cuando], [200, 'Marcado como hecho.', AHORA.toISOString()])
    assert.deepEqual(d.escrituras, [['marca', 100000001, 'zona_mapa', true, { nombre: 'Ana Prueba', email: 'ana@ejemplo.test' }, { previo: null, nota: 'radio 30 km', cuando: AHORA.toISOString(), idCrm: 'E157' }]])
    d = deps()
    r = await atenderAccion(d, 'E157', pedidoFalt({ clave: 'rama', nota: '' }), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.codigo, d.escrituras.length], [409, 'no_marcable', 0])
    d = deps()
    r = await atenderAccion(d, 'E157', pedidoFalt({ clave: 'whatsapp_destino', nota: '+54 9 2954 123456' }), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.mensaje], [200, 'Dato guardado.'])
    r = await atenderAccion(deps(), 'E157', pedidoFalt({ clave: 'zona_mapa', hecho: false, nota: '', previo: CUANDO }), SESION, {})
    assert.deepEqual([r.status, r.cuerpo.mensaje, r.cuerpo.cuando], [200, 'Desmarcado.', undefined])
  })
  test('revisión: quien no es Tomi ni Gero M → 403; Tomi → su clave, la huella que VIO y el historial', async () => {
    let d = deps()
    assert.deepEqual([(await atenderAccion(d, 'E157', pedidoRev(), SESION, {})).status, d.escrituras.length], [403, 0])
    // Lo que había (un pedido de cambios) pasa al historial: no se pierde al aprobar encima
    d = deps({ fila: fila({ revision: { tomi: rev('cambios', huellaEjemplo(), 'la 5 no'), gero_m: null } }) })
    const r = await atenderAccion(d, 'E157', pedidoRev({ previo: CUANDO }), TOMI, {})
    assert.deepEqual([r.status, r.cuerpo.mensaje, r.cuerpo.cuando], [200, 'Listo: Tomi aprobó las ideas.', AHORA.toISOString()])
    assert.deepEqual(d.escrituras, [['revision', 100000001, 'tomi', 'aprobada', '', {
      previo: CUANDO, idCrm: 'E157', email: 'tomas@ejemplo.test', huella: huellaEjemplo(), cuando: AHORA.toISOString(),
      historial: [{ estado: 'cambios', comentario: 'la 5 no', cuando: CUANDO, huella: huellaEjemplo() }],
    }]])
  })
  test('revisión con la huella de OTRAS ideas (el bot las rehízo mientras tanto): 409 «ideas_cambiaron», sin escribir', async () => {
    const d = deps()
    const r = await atenderAccion(d, 'E157', pedidoRev({ huella: '00000000' }), TOMI, {})
    assert.deepEqual([r.status, r.cuerpo.codigo, r.cuerpo.mensaje, d.escrituras.length], [409, 'ideas_cambiaron', 'Las ideas cambiaron: recargá para ver las nuevas.', 0])
    // Deshacer no necesita la huella (no aprueba nada)
    assert.equal((await atenderAccion(deps(), 'E157', pedidoRev({ estado: 'pendiente', huella: '', previo: CUANDO }), TOMI, {})).status, 200)
  })
  test('avisos: pedir cambios avisa al OTRO revisor (solo él mencionado); aprobadas por los dos → ✅ y el bloque para Valentino', async () => {
    let r = await atenderAccion(deps(), 'E157', pedidoRev({ estado: 'cambios', comentario: 'la 5 no va: es de ART **ya**' }), GERO, {})
    assert.equal(r.cuerpo.mensaje, 'Listo: Gero M pidió cambios. Le avisé a Tomi en Discord.')
    assert.equal(r.avisos.length, 1)
    assert.deepEqual([r.avisos[0].canal, r.avisos[0].menciones], ['kickoff', ['111111111111111111']])
    assert.equal(r.avisos[0].texto, '<@111111111111111111> ✏️ Gero M pidió cambios en las ideas de Clienta Ejemplo (ejemplo): «la 5 no va: es de ART \\*\\*ya\\*\\*» · [Ficha](<https://despacho.ejemplo.test/clientes/E157/kickoff>)', 'lo que escribió la persona va escapado (sin markdown ni menciones)')
    // Tomi aprueba y Gero M ya había aprobado ESTAS ideas
    const ambos = { tomi: rev('aprobada'), gero_m: rev('aprobada') }
    r = await atenderAccion(deps({ revisionDespues: ambos }), 'E157', pedidoRev(), TOMI, {})
    assert.deepEqual(r.avisos.map(a => [a.canal, a.menciones]), [['kickoff', []], ['ads', ['333333333333333333']]])
    assert.match(r.avisos[0].texto, /^✅ Ideas de Clienta Ejemplo \(ejemplo\) aprobadas por Tomi y Gero M · \[Ficha\]/)
    assert.match(r.avisos[1].texto, /^<@333333333333333333> ✅ Kickoff de Clienta Ejemplo .*: ideas aprobadas por Tomi y Gero M · cuenta act\\_100000000000001 .* · 💵 USD 8 por día para arrancar \(hasta 10\) .* · 📍 Colonia Ejemplo/)
    assert.ok(r.avisos.every(a => a.texto.length <= 2000))
    // Sin el canal de anuncios configurado: solo el ✅; si Gero M aprobó OTRAS ideas, nada
    r = await atenderAccion(deps({ revisionDespues: ambos, avisos: { ...AVISOS, ads: false } }), 'E157', pedidoRev(), TOMI, {})
    assert.deepEqual(r.avisos.map(a => a.canal), ['kickoff'])
    r = await atenderAccion(deps({ revisionDespues: { tomi: rev('aprobada'), gero_m: rev('aprobada', '00000000') } }), 'E157', pedidoRev(), TOMI, {})
    assert.equal(r.avisos, undefined)
  })
  test('revisión sobre una ficha sin ideas: 409', async () => {
    const f = clonar(FICHA_EJEMPLO)
    f.ideas_guiones = { estado: 'sin_ideas', revisores: [], ideas: [], notas: '', motivo: 'Claude no devolvió ideas válidas' }
    const d = deps({ fila: fila({ ficha: f }) })
    assert.deepEqual([(await atenderAccion(d, 'E157', pedidoRev(), TOMI, {})).cuerpo.codigo, d.escrituras.length], ['sin_ideas', 0])
  })
  test('el usuario de prueba de desarrollo no escribe; un cuerpo inválido ni se lee', async () => {
    let leidas = 0
    const d = deps({ leer: async () => { leidas++; return fila() } })
    assert.equal((await atenderAccion(d, 'E157', pedidoCheck(), { ...SESION, esDePrueba: true }, {})).status, 403)
    assert.deepEqual([(await atenderAccion(d, 'E157', { accion: 'check' }, SESION, {})).status, leidas], [422, 0])
  })
  test('la base no responde: 503', async () => {
    const d = deps({ leer: async () => { throw new ErrorTransitorio('la base no respondió') } })
    assert.equal((await atenderAccion(d, 'E157', pedidoCheck(), SESION, {})).status, 503)
  })
})

// ── La barrera HTTP de la API (atenderPost: lo que hace la ruta app/api/clientes/[id]/kickoff/route.ts) ──
describe('API de la pantalla: la barrera HTTP antes de escribir', () => {
  const URL_API = 'https://despacho.ejemplo.test/api/clientes/E157/kickoff'
  const HOST = 'despacho.ejemplo.test'
  const pedido = (o = {}) => new Request(URL_API, {
    method: 'POST',
    headers: { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json', 'x-sesion': 'ana', ...(o.headers ?? {}) },
    body: o.cuerpo ?? JSON.stringify(pedidoCheck()),
  })
  /** Dependencias falsas: la "sesión" sale de una cabecera de prueba; exigirAcceso responde 401/403 como exigirAccesoApi. */
  const barrera = (o = {}) => {
    const d = deps(o)
    const enviados = []
    return {
      d, enviados,
      deps: {
        exigirAcceso: req => {
          const quien = req.headers.get('x-sesion')
          if (!quien) return new Response(JSON.stringify({ error: 'sin sesión' }), { status: 401 })
          if (quien === 'ventas') return new Response(JSON.stringify({ error: 'sin permiso' }), { status: 403 })
          return null
        },
        sesion: req => (req.headers.get('x-sesion') === 'tomi' ? TOMI : req.headers.get('x-sesion') ? SESION : null),
        baseLista: () => o.base ?? true,
        accion: d,
        enviarAvisos: a => enviados.push(...a),
        env: {},
      },
    }
  }
  test('todo bien: llega a la decisión y escribe', async () => {
    const b = barrera()
    const r = await atenderPost(pedido(), 'E157', b.deps)
    assert.equal(r.status, 200)
    assert.equal((await r.json()).ok, true)
    assert.equal(b.d.escrituras.length, 1)
  })
  test('sin sesión → 401; sin el rol → 403 (y nada se lee ni se escribe)', async () => {
    for (const [sesion, status] of [[null, 401], ['ventas', 403]]) {
      const b = barrera()
      const req = pedido({ headers: { 'x-sesion': sesion ?? '' } })
      if (!sesion) req.headers.delete('x-sesion')
      assert.equal((await atenderPost(req, 'E157', b.deps)).status, status)
      assert.equal(b.d.escrituras.length, 0)
    }
  })
  test('mismo origen: sin Origin, de otro host o con un host parecido → 403', async () => {
    for (const origin of [null, 'https://otro.test', `https://${HOST}.otro.test`, `https://${HOST}:8443`, 'null', 'no es una url']) {
      const b = barrera()
      const req = pedido()
      if (origin === null) req.headers.delete('origin'); else req.headers.set('origin', origin)
      const r = await atenderPost(req, 'E157', b.deps)
      assert.equal(r.status, 403, String(origin))
      assert.equal(b.d.escrituras.length, 0)
    }
    // x-forwarded-host no cuenta: se compara con host
    assert.equal(mismoOrigen(new Headers({ origin: 'https://atacante.test', host: HOST, 'x-forwarded-host': 'atacante.test' })), false)
    assert.equal(mismoOrigen(new Headers({ origin: `https://${HOST}`, host: HOST })), true)
  })
  test('no es JSON → 415; ID del cliente raro → 404; cuerpo de más de 4.000 → 413; JSON roto → 400; sin base → 503', async () => {
    const casos = [
      [pedido({ headers: { 'content-type': 'text/plain' } }), 'E157', 415],
      [pedido(), "E157' OR 1=1", 404], [pedido(), '157', 404], [pedido(), 'E1234567', 404],
      [pedido({ cuerpo: JSON.stringify({ ...pedidoCheck(), nota: 'x'.repeat(LARGO_MAX_CUERPO) }) }), 'E157', 413],
      [pedido({ cuerpo: '{no' }), 'E157', 400],
    ]
    for (const [req, id, status] of casos) {
      const b = barrera()
      assert.equal((await atenderPost(req, id, b.deps)).status, status, `${id} → ${status}`)
      assert.equal(b.d.escrituras.length, 0)
    }
    const b = barrera({ base: false })
    assert.equal((await atenderPost(pedido(), 'E157', b.deps)).status, 503)
    assert.equal(b.d.escrituras.length, 0)
  })
  test('los avisos de la revisión salen por enviarAvisos (después de responder), no en la respuesta', async () => {
    const b = barrera()
    const r = await atenderPost(pedido({ headers: { 'x-sesion': 'tomi' }, cuerpo: JSON.stringify(pedidoRev({ estado: 'cambios', comentario: 'la 5 no' })) }), 'E157', b.deps)
    const j = await r.json()
    assert.equal(r.status, 200)
    assert.ok(!('avisos' in j), 'el navegador no ve los avisos')
    assert.deepEqual(b.enviados.map(a => [a.canal, a.menciones]), [['kickoff', ['222222222222222222']]])
  })
  test('27/10: aprobar ya NO dispara la tanda de guiones (arranca sola con la ficha lista); los avisos siguen', async () => {
    const ambos = { tomi: rev('aprobada'), gero_m: rev('aprobada') }
    const r = await atenderAccion(deps({ revisionDespues: ambos }), 'E157', pedidoRev(), TOMI, {})
    assert.equal(r.status, 200)
    assert.ok(!('guiones' in r))
    const b = barrera()
    const res = await atenderPost(pedido({ headers: { 'x-sesion': 'tomi' }, cuerpo: JSON.stringify(pedidoRev()) }), 'E157', b.deps)
    assert.equal(res.status, 200)
    assert.ok(!('guiones' in await res.json()))
  })

})

// ── registro.ts: las consultas nuevas contra un Neon FALSO ──
describe('registro (pantalla): SQL contra un Neon falso', () => {
  /** Un q`` falso: anota cada consulta (texto con $n y valores) y responde lo que diga `responder`. */
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    return { consultas, fabrica: () => q }
  }
  beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
  const limpiar = () => { registro.sqlParaPruebas(null); delete process.env.DATABASE_URL }
  const sinTabla = () => { throw Object.assign(new Error('relation "cj_kickoffs" does not exist'), { code: '42P01' }) }
  const Q = { nombre: 'Ana', email: 'ana@x.test' }

  test('listarFichasCliente: por id_crm en mayúsculas, solo con ficha, sin payload, faltantes_checks por to_jsonb y sin crear nada', async () => {
    try {
      const n = neonFalso(() => [{ recording_id: '100000001', estado: 'lista', titulo: 'T', url: 'u', cliente_crm: 'C', id_crm: 'E157', error: null, ficha: { a: 1 }, ideas: null, revision: null, portfolio_checks: {}, faltantes_checks: null, creado: new Date(CUANDO), actualizado: new Date(CUANDO) }])
      registro.sqlParaPruebas(n.fabrica)
      const filas = await registro.listarFichasCliente('e157')
      assert.equal(filas[0].recording_id, 100000001)
      assert.equal(filas[0].creado, CUANDO)
      assert.equal(filas[0].faltantes_checks, null)
      const c = n.consultas[0]
      assert.match(c.texto, /to_jsonb\(cj_kickoffs\) -> 'faltantes_checks' AS faltantes_checks/, 'anda aunque la columna todavía no exista')
      assert.match(c.texto, /FROM cj_kickoffs WHERE upper\(id_crm\) = \$1 AND ficha IS NOT NULL ORDER BY creado DESC LIMIT \$2$/)
      assert.deepEqual(c.valores, ['E157', registro.MAX_FICHAS_CLIENTE])
      assert.ok(!/(^|[\s,])payload/.test(c.texto), 'el payload (transcripción y mails) no se lee')
      assert.equal(n.consultas.length, 1, 'nada de CREATE')
    } finally { limpiar() }
  })
  test('listarFichasCliente: sin tabla → []; un ID inválido ni llega a la base', async () => {
    try {
      const n = neonFalso(sinTabla)
      registro.sqlParaPruebas(n.fabrica)
      assert.deepEqual(await registro.listarFichasCliente('A157'), [])
      await assert.rejects(registro.listarFichasCliente("A1' OR 1=1"), /ID del CRM inválido/)
      assert.equal(n.consultas.length, 1)
    } finally { limpiar() }
  })
  test('guardarCheckPortfolio: jsonb_set de UNA clave con condición sobre el cuando visto Y el cliente; no toca actualizado', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('UPDATE') ? [{ portfolio_checks: { instagram: { valor: 'ok', nota: '', quien: 'Ana', email: 'ana@x.test', cuando: CUANDO } } }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const r = await registro.guardarCheckPortfolio(100000001, 'instagram', 'ok', { nombre: 'Ana', email: 'ANA@x.test' }, { previo: null, nota: ' ', cuando: CUANDO, idCrm: 'e157' })
      assert.equal(r.ok, true)
      assert.equal(r.actual.instagram.valor, 'ok')
      const u = n.consultas[0]
      assert.match(u.texto, /^UPDATE cj_kickoffs SET portfolio_checks = CASE WHEN \$1::boolean THEN COALESCE\(portfolio_checks, '\{\}'::jsonb\) - \$2::text ELSE jsonb_set\(COALESCE\(portfolio_checks, '\{\}'::jsonb\), ARRAY\[\$3::text\], \$4::jsonb, true\) END WHERE recording_id = \$5 AND upper\(id_crm\) = \$6 AND COALESCE\(portfolio_checks -> \$7::text ->> 'cuando', ''\) = \$8 RETURNING portfolio_checks$/)
      assert.ok(!/actualizado|CREATE|ficha|estado/.test(u.texto))
      assert.deepEqual(JSON.parse(u.valores[3]), { valor: 'ok', nota: '', quien: 'Ana', email: 'ana@x.test', cuando: CUANDO })
      assert.deepEqual([u.valores[0], u.valores[4], u.valores[5], u.valores[7]], [false, 100000001, 'E157', ''])
    } finally { limpiar() }
  })
  test('guardarCheckPortfolio: quitar; conflicto (vuelve lo actual); la fila ya es de OTRO cliente → no_existe sin devolverla; fila inexistente; sin tabla', async () => {
    try {
      let n = neonFalso(t => (t.startsWith('UPDATE') ? [{ portfolio_checks: {} }] : []))
      registro.sqlParaPruebas(n.fabrica)
      await registro.guardarCheckPortfolio(1, 'instagram', null, Q, { previo: CUANDO, cuando: CUANDO, idCrm: 'E157' })
      assert.deepEqual([n.consultas[0].valores[0], n.consultas[0].valores[3], n.consultas[0].valores[7]], [true, null, CUANDO])
      n = neonFalso(t => (t.startsWith('SELECT') ? [{ id_crm: 'e157', portfolio_checks: { instagram: { valor: 'falta', cuando: CUANDO } } }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const c = await registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { previo: null, cuando: CUANDO, idCrm: 'E157' })
      assert.deepEqual([c.ok, c.motivo, c.actual.instagram.valor], [false, 'conflicto', 'falta'])
      // El bot rehízo la ficha y la cruzó con otro cliente entre la lectura y la escritura: no se escribe en la ficha del otro
      n = neonFalso(t => (t.startsWith('SELECT') ? [{ id_crm: 'A001', portfolio_checks: { instagram: { valor: 'falta', cuando: CUANDO } } }] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.deepEqual(await registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { previo: null, cuando: CUANDO, idCrm: 'E157' }), { ok: false, motivo: 'no_existe', actual: null })
      n = neonFalso(() => [])
      registro.sqlParaPruebas(n.fabrica)
      assert.deepEqual(await registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { previo: null, cuando: CUANDO, idCrm: 'E157' }), { ok: false, motivo: 'no_existe', actual: null })
      n = neonFalso(sinTabla)
      registro.sqlParaPruebas(n.fabrica)
      assert.equal((await registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { previo: null, cuando: CUANDO, idCrm: 'E157' })).motivo, 'no_existe')
      assert.ok(!n.consultas.some(x => /CREATE/.test(x.texto)), 'un tilde no crea la tabla')
    } finally { limpiar() }
  })
  test('guardarCheckPortfolio: entradas inválidas (también el ID del cliente) → error ANTES de tocar la base', async () => {
    try {
      const n = neonFalso(() => [])
      registro.sqlParaPruebas(n.fabrica)
      const op = { previo: null, idCrm: 'E157' }
      const malos = [
        () => registro.guardarCheckPortfolio('1', 'instagram', 'ok', Q, op),
        () => registro.guardarCheckPortfolio(1, 'tiktok', 'ok', Q, op),
        () => registro.guardarCheckPortfolio(1, 'instagram', 'si', Q, op),
        () => registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { ...op, previo: 'ayer' }),
        () => registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { ...op, nota: 'x'.repeat(R.LARGO_NOTA + 1) }),
        () => registro.guardarCheckPortfolio(1, 'instagram', 'ok', { nombre: 'Ana', email: 'no es un mail' }, op),
        () => registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { previo: null }),
        () => registro.guardarCheckPortfolio(1, 'instagram', 'ok', Q, { previo: null, idCrm: "E1' OR 1=1" }),
      ]
      for (const m of malos) await assert.rejects(m(), R.ErrorEntradaKickoff)
      assert.equal(n.consultas.length, 0)
    } finally { limpiar() }
  })
  test('guardarMarcaFaltante: una clave de faltantes_checks con condición; desmarcar la saca; un dato se valida; sin la columna, la suma y reintenta', async () => {
    try {
      let n = neonFalso(t => (t.startsWith('UPDATE') ? [{ faltantes_checks: { zona_mapa: { nota: 'radio 30 km', quien: 'Ana', email: 'ana@x.test', cuando: CUANDO } } }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const r = await registro.guardarMarcaFaltante(7, 'zona_mapa', true, Q, { previo: null, nota: 'radio 30 km', cuando: CUANDO, idCrm: 'E157' })
      assert.deepEqual([r.ok, r.actual.zona_mapa.nota], [true, 'radio 30 km'])
      const u = n.consultas[0]
      assert.match(u.texto, /^UPDATE cj_kickoffs SET faltantes_checks = CASE WHEN \$1::boolean THEN COALESCE\(faltantes_checks, '\{\}'::jsonb\) - \$2::text ELSE jsonb_set\(COALESCE\(faltantes_checks, '\{\}'::jsonb\), ARRAY\[\$3::text\], \$4::jsonb, true\) END WHERE recording_id = \$5 AND upper\(id_crm\) = \$6 AND COALESCE\(faltantes_checks -> \$7::text ->> 'cuando', ''\) = \$8 RETURNING faltantes_checks$/)
      assert.ok(!/actualizado|CREATE|ficha|estado/.test(u.texto))
      await registro.guardarMarcaFaltante(7, 'zona_mapa', false, Q, { previo: CUANDO, cuando: CUANDO, idCrm: 'E157' })
      assert.deepEqual([n.consultas[1].valores[0], n.consultas[1].valores[3]], [true, null])
      await assert.rejects(registro.guardarMarcaFaltante(7, 'whatsapp_destino', true, Q, { previo: null, nota: 'llamame', idCrm: 'E157' }), R.ErrorEntradaKickoff)
      await assert.rejects(registro.guardarMarcaFaltante(7, 'cualquiera', true, Q, { previo: null, idCrm: 'E157' }), R.ErrorEntradaKickoff)
      // Tabla de antes del 24/10 sin la columna: 42703 → asegurarTabla (suma la columna) → reintento
      let primera = true
      n = neonFalso(t => {
        if (t.startsWith('UPDATE') && primera) { primera = false; throw Object.assign(new Error('column "faltantes_checks" does not exist'), { code: '42703' }) }
        return t.startsWith('UPDATE') ? [{ faltantes_checks: {} }] : []
      })
      registro.sqlParaPruebas(n.fabrica)
      assert.equal((await registro.guardarMarcaFaltante(7, 'zona_mapa', true, Q, { previo: null, cuando: CUANDO, idCrm: 'E157' })).ok, true)
      assert.ok(n.consultas.some(x => /ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS faltantes_checks jsonb NOT NULL DEFAULT '\{\}'::jsonb/.test(x.texto)))
      assert.equal(n.consultas.filter(x => x.texto.startsWith('UPDATE')).length, 2)
    } finally { limpiar() }
  })
  test('guardarRevision: solo la clave del revisor, con condición (y el cliente); pendiente guarda el historial; cambios exige comentario', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('UPDATE') ? [{ revision: { tomi: rev('aprobada', 'abcdef12'), gero_m: null } }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const historial = [{ estado: 'cambios', comentario: 'la 2', cuando: CUANDO, huella: 'abcdef12' }]
      const r = await registro.guardarRevision(7, 'tomi', 'aprobada', '', { previo: null, idCrm: 'E157', email: 'tomas@x.test', huella: 'abcdef12', cuando: CUANDO, historial })
      assert.equal(r.ok, true)
      const u = n.consultas[0]
      assert.match(u.texto, /^UPDATE cj_kickoffs SET revision = jsonb_set\(COALESCE\(revision, '\{"tomi": null, "gero_m": null\}'::jsonb\), ARRAY\[\$1::text\], \$2::jsonb, true\) WHERE recording_id = \$3 AND upper\(id_crm\) = \$4 AND COALESCE\(revision -> \$5::text ->> 'cuando', ''\) = \$6 RETURNING revision$/)
      assert.ok(!/actualizado|CREATE/.test(u.texto))
      assert.deepEqual([u.valores[0], JSON.parse(u.valores[1]).huella, JSON.parse(u.valores[1]).historial, u.valores[2], u.valores[3]], ['tomi', 'abcdef12', historial, 7, 'E157'])
      await registro.guardarRevision(7, 'gero_m', 'pendiente', '', { previo: CUANDO, idCrm: 'E157', email: 'g@x.test', huella: '', cuando: CUANDO, historial })
      assert.deepEqual(JSON.parse(n.consultas[1].valores[1]), { estado: 'pendiente', comentario: '', cuando: CUANDO, email: 'g@x.test', huella: '', historial }, 'deshacer no borra el historial')
      assert.equal(n.consultas[1].valores[5], CUANDO)
      const antes = n.consultas.length
      const op = { previo: null, idCrm: 'E157', email: 'tomas@x.test', huella: 'abcdef12' }
      await assert.rejects(registro.guardarRevision(7, 'tomi', 'cambios', ' ', op), R.ErrorEntradaKickoff)
      await assert.rejects(registro.guardarRevision(7, 'gero_a', 'aprobada', '', op), R.ErrorEntradaKickoff)
      await assert.rejects(registro.guardarRevision(7, 'tomi', 'aprobada', '', { ...op, huella: '' }), R.ErrorEntradaKickoff)
      await assert.rejects(registro.guardarRevision(7, 'tomi', 'aprobada', '', { ...op, historial: [{ estado: 'otro', cuando: CUANDO }] }), R.ErrorEntradaKickoff)
      await assert.rejects(registro.guardarRevision(7, 'tomi', 'aprobada', '', { ...op, idCrm: undefined }), R.ErrorEntradaKickoff)
      assert.equal(n.consultas.length, antes)
    } finally { limpiar() }
  })
})

describe('la salida real de la prueba (si está en .cache; no se versiona)', () => {
  const ruta = new URL('../.cache/kickoff-prueba/salida-195704214.json', import.meta.url)
  test('pasa por la vista sin filtrar los nombres de otros clientes, sus cuentas ni ningún mail', { skip: !existsSync(ruta) && 'no está .cache/kickoff-prueba/salida-195704214.json' }, () => {
    const salida = JSON.parse(readFileSync(ruta, 'utf8'))
    const v = V.armarVista(fila({ ficha: salida.ficha, url: salida.ficha.url }))
    assert.ok(v, 'la ficha real se lee')
    const todo = JSON.stringify(v)
    const ajenos = (salida.ficha.ganadores?.lista ?? []).flatMap(g => [g.cliente, g.cuentaId]).filter(Boolean)
    assert.ok(ajenos.length > 0)
    assert.equal(ajenos.filter(x => todo.includes(x)).length, 0, 'se filtró un cliente o una cuenta de los ganadores')
    // Ningún mail: los del equipo pasan a su nombre corto (Gero A, Valentino) y cualquier otro a [mail]
    assert.deepEqual([...todo.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map(m => m[0]), [], 'se filtró un mail')
    for (const m of [salida.ficha.cliente?.email, salida.ficha.grabo?.email, ...MAILS_ACCESOS_EQUIPO].filter(Boolean)) assert.ok(!todo.includes(m), 'se filtró un mail')
    assert.equal(v.portfolio.filas.filter(x => x.tildable).length, 2)
    // Rearmada con el código de hoy: el pendiente del portfolio ya no está y la grabación cortada es una nota
    assert.ok(!v.pendientes.some(x => /portfolio/i.test(x)), v.pendientes.join(' | '))
    assert.ok(!v.faltantes.some(x => /grabación terminó/.test(x.texto)))
  })
})
