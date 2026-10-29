// Juguetes compartidos por los tests del bloque A de Grabación y Edición (no es un test: lo importan los test-*.mjs).
// Todo inventado: ningún nombre, mail, id ni secreto es real.

/** Un Neon falso: registra cada consulta (texto con $1…$n y valores) y responde con `responder(texto, valores, consultas)`. */
export function neonFalso(responder) {
  const consultas = []
  const correr = (texto, valores) => {
    consultas.push({ texto, valores })
    return Promise.resolve().then(() => responder(texto, valores, consultas))
  }
  const q = (strings, ...valores) => correr(strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim(), valores)
  q.query = (texto, valores = []) => correr(texto.replace(/\s+/g, ' ').trim(), valores)
  q.transaction = async arr => { consultas.push({ texto: 'TRANSACCION', valores: [arr.length] }); return Promise.all(arr) }
  return { consultas, fabrica: () => q }
}

/** El valor del parámetro que sigue a `prefijo` en el texto de una consulta ("SET estado = $3" → valores[2]). */
export function param(c, prefijo) {
  const i = c.texto.indexOf(prefijo)
  if (i < 0) return undefined
  const m = /^\$(\d+)/.exec(c.texto.slice(i + prefijo.length))
  return m ? c.valores[Number(m[1]) - 1] : undefined
}

export const errorPg = (code, mensaje = `error ${code}`) => Object.assign(new Error(mensaje), { code })

export const filaVideo = (over = {}) => ({
  id: '7', id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V2', tanda_guion: 1, numero: 2, guion_doc_id: null, guion_ref: null, guion_huella: null,
  guion_texto: '', gancho: '¿Te despidieron?', estado: 'para_editar', estado_previo: null, estado_desde: new Date('2026-10-20T12:00:00Z'),
  prioridad: 'normal', bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null, ronda_interna: 0, ronda_cliente: 0, editado_archivo_id: null,
  editado_url: null, envio_link: null, ok_cliente: null, origen: 'doc', clickup_id: null, posible_duplicado: [], version: 3,
  creado: new Date('2026-10-18T12:00:00Z'), actualizado: new Date('2026-10-20T12:00:00Z'), ...over,
})

export const filaEvento = (over = {}) => ({
  id: '90', video_id: '7', id_crm: 'A101', tipo: 'estado', de: null, a: null, actor_tipo: 'persona', actor_rol: 'aylu', actor_nombre: 'Aylén QA',
  actor_email: 'aylu@ejemplo.test', nota: '', datos: {}, cuando: new Date('2026-10-24T12:00:00Z'), ...over,
})

export const filaNota = (over = {}) => ({
  id: '30', video_id: '7', ronda: 1, origen: 'aylu', enviada: false, segundo: '17', hasta: null, tipo: 'texto', texto: 'seg 17 "mora"', imagen_url: null,
  tilde: null, evaluacion: null, pedido_id: null, creado_por: 'Aylén QA', creado: new Date('2026-10-24T12:00:00Z'), borrada: false, version: 1, ...over,
})

export const AYLU = { rol: 'aylu', nombre: 'Aylén QA', email: 'aylu@ejemplo.test' }
export const TOMAS = { rol: 'tomas', nombre: 'Tomás Napolitano', email: 'tomas@ejemplo.test' }
export const RENE = { rol: 'rene', nombre: 'René', email: 'rene@ejemplo.test' }
export const conTipo = p => ({ tipo: 'persona', ...p })

export const RED_BLOQUEADA = async () => { throw new Error('red bloqueada en los tests') }

// ── Repositorio EN MEMORIA con la misma semántica que lib/edicion/db/* (para probar el vigía y el diario sin base) ────────
// `escrituras` cuenta cada llamada que en la base real escribiría (el modo dry tiene que dejarlo en 0).
export async function repoMemoria(op = {}) {
  const { agrupar } = await import('../lib/bot/grabacion/tandas.ts')
  const { puede } = await import('../lib/edicion/estados.ts')
  const { aplicarAccion } = await import('../lib/edicion/db/videos.ts')
  const reloj = op.reloj ?? (() => new Date())
  const s = { carpetas: new Map(), archivos: new Map(), tandas: new Map(), videos: new Map(), eventos: [], docs: new Map(), pasos: [], corridas: [], transcripciones: new Map(), graba_equipo: new Set(), escrituras: 0 }
  let sec = 100
  const nid = () => ++sec
  const ahoraIso = () => reloj().toISOString()
  const w = () => { s.escrituras++ }
  const copia = x => JSON.parse(JSON.stringify(x))
  const OK = new Set(['alta', 'aylu', 'tomas', 'bot'])
  const evento = (v, tipo, actor, extra = {}) => {
    const e = { id: nid(), video_id: v.id, id_crm: v.id_crm, cliente: v.cliente, tipo, de: null, a: null, actor: actor.tipo === 'bot' ? actor : { ...actor, email: '' }, nota: '', datos: {}, cuando: ahoraIso(), ...extra }
    s.eventos.push(e)
    return e
  }
  const filaTablero = v => ({ ...copia(v), crudos: [...s.archivos.values()].filter(a => a.video_id === v.id && a.tipo === 'crudo' && !a.borrado).length,
    editado_propuesto: [...s.archivos.values()].some(a => a.propuesta_video_id === v.id && a.video_id === null), paleta: false, notas_abiertas: 0 })
  const repo = {
    abrirCorrida: async (tipo, origen) => {
      w()
      if (s.corridas.some(c => c.estado === 'corriendo')) return null
      const c = { id: nid(), tipo, origen, estado: 'corriendo', inicio: ahoraIso(), fin: null, consultas: 0, archivos_nuevos: 0, tandas_cerradas: 0, error: '', resumen: {} }
      s.corridas.push(c); return copia(c)
    },
    cerrarCorrida: async (id, r) => { w(); const c = s.corridas.find(x => x.id === id); Object.assign(c, r, { fin: ahoraIso() }) },
    ultimaCorrida: async tipo => copia([...s.corridas].reverse().find(c => (!tipo || c.tipo === tipo) && ['ok', 'corriendo', 'error'].includes(c.estado)) ?? null),
    corridasDesde: async desde => copia(s.corridas.filter(c => c.inicio >= desde)),
    fasesHechas: async desde => new Set(s.corridas.filter(c => c.inicio >= desde).flatMap(c => c.resumen?.fases ?? [])),
    carpetasAVigilar: async lim => copia([...s.carpetas.values()].filter(c => c.vigilar && !c.borrada && c.id_crm && OK.has(c.vinculo) && ['crudos', 'editados'].includes(c.raiz))
      .sort((a, b) => (a.consultada ?? '').localeCompare(b.consultada ?? '') || a.nivel - b.nivel).slice(0, lim)),
    guardarArbol: async (xs, o = {}) => {
      w()
      for (const c of xs) {
        const ya = s.carpetas.get(c.drive_id)
        if (!ya) { s.carpetas.set(c.drive_id, copia({ ...c, id_crm: c.id_crm?.toUpperCase() ?? null, borrada: null, avisado: null })); continue }
        const persona = ['alta', 'aylu', 'tomas'].includes(ya.vinculo)
        Object.assign(ya, { nombre: c.nombre, padre_id: c.padre_id, ruta: c.ruta, nivel: c.nivel, tipo: c.tipo, raiz: c.raiz, raiz_id: c.raiz_id, borrada: null,
          id_crm: persona ? ya.id_crm : c.id_crm, vinculo: persona ? ya.vinculo : c.vinculo, candidatos: persona ? ya.candidatos : c.candidatos,
          vigilar: o.pisarVigilar ? c.vigilar : (ya.vigilar || c.vigilar) })
      }
      return xs.length
    },
    anotarConsultas: async xs => { w(); for (const x of xs) { const c = s.carpetas.get(x.drive_id); if (c) { c.consultada = x.cuando; if (x.ultimo_archivo && (!c.ultimo_archivo || x.ultimo_archivo > c.ultimo_archivo)) c.ultimo_archivo = x.ultimo_archivo } } },
    ajustarVigilancia: async (activos, espera, ahora) => {
      w()
      const desde = new Date(ahora.getTime() - 45 * 86_400_000).toISOString()
      for (const c of s.carpetas.values()) {
        c.vigilar = !!(c.id_crm && activos.includes(c.id_crm) && !c.borrada && OK.has(c.vinculo) && ['crudos', 'editados'].includes(c.raiz)
          && (['crudos', 'editados'].includes(c.tipo) || (c.raiz === 'crudos' && espera.includes(c.id_crm)) || (c.ultimo_archivo ?? c.creada ?? '') >= desde))
      }
      return 0
    },
    vigilarCrudosDe: async id => { w(); for (const c of s.carpetas.values()) if (c.id_crm === id && c.raiz === 'crudos' && OK.has(c.vinculo)) c.vigilar = true },
    vinculosSinAviso: async () => { w(); const xs = [...s.carpetas.values()].filter(c => c.tipo === 'cliente' && c.vinculo === 'a_confirmar' && !c.avisado); for (const c of xs) c.avisado = ahoraIso(); return copia(xs) },
    marcarCarpetasBorradas: async (raiz, presentes) => { w(); let n = 0; for (const c of s.carpetas.values()) if (c.raiz_id === raiz && c.drive_id !== raiz && !c.borrada && !presentes.includes(c.drive_id)) { c.borrada = ahoraIso(); c.vigilar = false; n++ } return n },
    todasLasCarpetas: async () => copia([...s.carpetas.values()].filter(c => !c.borrada)),
    listarVinculos: async () => copia([...s.carpetas.values()].filter(c => c.tipo === 'cliente' && !c.borrada)),
    guardarArchivos: async (id_crm, tipo, xs) => {
      w()
      const nuevos = [], movidos = []
      for (const x of xs) {
        const ya = [...s.archivos.values()].find(a => a.drive_id === x.drive_id)
        if (!ya) {
          const a = { ...copia(x), id: nid(), id_crm: id_crm.toUpperCase(), tipo, tanda_id: null, inferido: x.inferido ?? { tanda_guion: null, numero: null, por: null },
            video_id: null, asignado_por: null, propuesta_video_id: null, transcripcion: { estado: x.tr_estado ?? 'no_aplica', proveedor_id: null, intentos: 0, motivo: '' }, borrado: null, visto: ahoraIso() }
          delete a.tr_estado
          s.archivos.set(a.id, a); nuevos.push(copia(a)); continue
        }
        const otroLugar = ya.tipo !== tipo || ya.id_crm !== id_crm.toUpperCase()
        const cambio = ya.carpeta_id !== x.carpeta_id || JSON.stringify(ya.ruta) !== JSON.stringify(x.ruta) || ya.nombre !== x.nombre || ya.borrado || otroLugar
        if (!cambio) continue
        if (JSON.stringify(ya.ruta) !== JSON.stringify(x.ruta)) ya.inferido = x.inferido
        if (otroLugar) {
          if (ya.tipo !== tipo && ['no_aplica', 'pendiente', 'vieja'].includes(ya.transcripcion.estado)) ya.transcripcion.estado = x.tr_estado ?? 'no_aplica'
          Object.assign(ya, { tipo, id_crm: id_crm.toUpperCase(), video_id: null, asignado_por: null, propuesta_video_id: null, tanda_id: null })
        }
        Object.assign(ya, { carpeta_id: x.carpeta_id, ruta: x.ruta, nombre: x.nombre, borrado: null })
        movidos.push(copia(ya))
      }
      return { nuevos, actualizados: movidos.length, movidos }
    },
    marcarBorrados: async (raiz, presentes) => {
      w()
      const out = []
      for (const a of s.archivos.values()) if (!a.borrado && s.carpetas.get(a.carpeta_id)?.raiz_id === raiz && !presentes.includes(a.drive_id)) { a.borrado = ahoraIso(); out.push(copia(a)) }
      return out
    },
    vincularArchivo: async p => {
      w()
      const a = s.archivos.get(p.archivo_id)
      if (!a || a.borrado) return { ok: false, motivo: 'no_existe', actual: null }
      if (p.actor.tipo === 'bot' && a.asignado_por && a.asignado_por !== 'bot') return { ok: false, motivo: 'no_permitido', actual: copia(a), detalle: 'lo asignó una persona' }
      const v = p.video_id === null ? null : s.videos.get(p.video_id)
      if (p.video_id !== null && (!v || v.id_crm !== a.id_crm)) return { ok: false, motivo: 'no_permitido', actual: copia(a), detalle: 'otro cliente' }
      const antes = a.video_id
      a.video_id = p.video_id; a.asignado_por = p.video_id === null ? null : (p.actor.tipo === 'bot' ? 'bot' : p.actor.rol)
      if (p.por) a.inferido = { ...a.inferido, por: p.por }
      if (a.propuesta_video_id === p.video_id) a.propuesta_video_id = null
      if (v && a.tipo === 'editado') { v.editado = { archivo_id: a.id, url: `https://drive.google.com/file/d/${a.drive_id}/view` }; if (v.bloqueo === 'sin_link_editado') { v.bloqueo = null; v.motivo_bloqueo = '' }; v.version++ }
      if (v && antes !== v.id) evento(v, a.tipo === 'editado' ? 'editado_vinculado' : 'crudo_vinculado', p.actor, { datos: { archivo_id: a.id, por: p.por ?? null } })
      return { ok: true, actual: copia(a) }
    },
    proponerEditado: async (aid, vid) => { w(); const a = s.archivos.get(aid), v = s.videos.get(vid); if (a && v && a.video_id === null && a.propuesta_video_id !== vid && v.id_crm === a.id_crm) { a.propuesta_video_id = vid; evento(v, 'editado_propuesto', { tipo: 'bot', proceso: 'vigia' }, { datos: { archivo_id: aid } }) } },
    crudosDeCliente: async (id, desde) => copia([...s.archivos.values()].filter(a => a.id_crm === id && a.tipo === 'crudo' && !a.borrado && (!desde || a.creado >= desde))),
    archivosDeTanda: async id => copia([...s.archivos.values()].filter(a => a.tanda_id === id && !a.borrado)),
    transcripcionesDe: async ids => copia(ids.map(i => s.transcripciones.get(i)).filter(Boolean)),
    estadoArchivos: async desde => ({
      sinUbicar: [...s.archivos.values()].filter(a => a.tipo === 'crudo' && a.video_id === null && !a.borrado && a.creado >= desde).map(a => ({ id_crm: a.id_crm, creado: a.creado, subio: a.subio })),
      editadosPorVincular: [...s.archivos.values()].filter(a => a.tipo === 'editado' && a.video_id === null && !a.borrado).length,
      sinTranscribir: [],
    }),
    asignarATanda: async (id_crm, tipo, archivos, ahora) => {
      w()
      const abierta = [...s.tandas.values()].find(t => t.id_crm === id_crm && t.tipo === tipo && t.estado === 'abierta')
      let ultima = null
      for (const g of agrupar(archivos, abierta ? [abierta] : [], ahora)) {
        let t = g.tanda_id !== null ? s.tandas.get(g.tanda_id) : null
        if (!t) {
          for (const x of s.tandas.values()) if (x.id_crm === id_crm && x.tipo === tipo && x.estado === 'abierta' && x.hasta < g.desde) { x.estado = 'cerrada'; x.cerrada = ahoraIso() }
          t = [...s.tandas.values()].find(x => x.id_crm === id_crm && x.tipo === tipo && x.estado === 'abierta')
          if (!t) { t = { id: nid(), id_crm, tipo, desde: g.desde, hasta: g.hasta, archivos: 0, subio: g.subio, estado: 'abierta', cerrada: null, resultado: null, version: 1 }; s.tandas.set(t.id, t) }
        }
        for (const id of g.archivos) { const a = s.archivos.get(id); if (a && a.tanda_id === null) a.tanda_id = t.id }
        const xs = [...s.archivos.values()].filter(a => a.tanda_id === t.id && !a.borrado)
        t.archivos = xs.length; t.desde = xs.map(a => a.creado).sort()[0]; t.hasta = xs.map(a => a.creado).sort().at(-1)
        t.subio = new Set(xs.map(a => a.subio)).size === 1 ? xs[0].subio : 'mixto'; t.version++
        ultima = copia(t)
      }
      return ultima
    },
    tandasParaCerrar: async ahora => copia([...s.tandas.values()].filter(t => {
      if (t.estado !== 'abierta' || Date.parse(t.hasta) >= ahora.getTime() - 45 * 60_000) return false
      if (Date.parse(t.hasta) < ahora.getTime() - 6 * 3_600_000) return true
      const limite = new Date(Date.parse(t.hasta) + 45 * 60_000).toISOString()
      return ![...s.carpetas.values()].some(c => c.id_crm === t.id_crm && c.vigilar && !c.borrada && c.raiz === t.tipo && (!c.consultada || c.consultada < limite))
    })),
    cerrarTanda: async (id, version) => { w(); const t = s.tandas.get(id); if (!t || t.estado !== 'abierta' || t.version !== version) return { ok: false, motivo: 'conflicto', actual: copia(t ?? null) }; t.estado = 'cerrada'; t.cerrada = ahoraIso(); t.version++; return { ok: true, actual: copia(t) } },
    reclamarComparacion: async (id, ahora) => {
      w(); const t = s.tandas.get(id)
      const colgada = t?.estado === 'comparando' && (!t.comparando_desde || Date.parse(t.comparando_desde) < ahora.getTime() - 10 * 60_000)
      if (!t || !(t.estado === 'cerrada' || colgada || (t.estado === 'comparada' && t.resultado?.pendiente_claude?.length))) return null
      t.estado = 'comparando'; t.comparando_desde = ahoraIso(); t.version++; return copia(t)
    },
    soltarComparacion: async id => { w(); const t = s.tandas.get(id); if (t?.estado === 'comparando') { t.estado = 'cerrada'; t.comparando_desde = null; t.version++ } },
    guardarResultado: async (id, r) => { w(); const t = s.tandas.get(id); if (t?.estado === 'comparando') { t.estado = 'comparada'; t.resultado = copia(r); t.version++ } },
    marcarAvisada: async id => { w(); const t = s.tandas.get(id); if (t && ['cerrada', 'comparando', 'comparada'].includes(t.estado)) { t.estado = 'avisada'; t.version++ } },
    tandasParaComparar: async ahora => copia([...s.tandas.values()].filter(t => t.tipo === 'crudos' && (
      (t.estado === 'cerrada' && (Date.parse(t.cerrada) < ahora.getTime() - 20 * 60_000 || ![...s.archivos.values()].some(a => a.tanda_id === t.id && ['pendiente', 'enviando', 'enviada'].includes(a.transcripcion.estado))))
      || (t.estado === 'comparada' && t.resultado?.pendiente_claude?.length)
      || (t.estado === 'comparando' && (!t.comparando_desde || Date.parse(t.comparando_desde) < ahora.getTime() - 10 * 60_000))))),
    tandasEditadosCerradas: async () => copia([...s.tandas.values()].filter(t => t.tipo === 'editados' && t.estado === 'cerrada')),
    leerTanda: async id => copia(s.tandas.get(id) ?? null),
    listarVideos: async (f = {}) => [...s.videos.values()].filter(v => (!f.estados || f.estados.includes(v.estado)) && (!f.id_crm || v.id_crm === f.id_crm.toUpperCase())
      && (!f.ids || f.ids.includes(v.id)) && (f.incluirFinales || f.estados?.some(e => ['aprobado', 'descartado'].includes(e)) || !['aprobado', 'descartado'].includes(v.estado))).map(filaTablero),
    moverVideo: async m => {
      w()
      const v = s.videos.get(m.id)
      if (!v) return { ok: false, motivo: 'no_existe', actual: null }
      if (v.version !== m.version) return { ok: false, motivo: 'conflicto', actual: null }
      const crudos = [...s.archivos.values()].filter(a => a.video_id === v.id && a.tipo === 'crudo' && !a.borrado).length
      const rol = m.actor.tipo === 'bot' ? 'bot' : m.actor.rol
      const p = puede(rol, m.accion, v, { crudos, notasNuevas: 0, notasSinTildar: 0, linkEditado: !!v.editado, ...m.ctx })
      if (!p.ok) return { ok: false, motivo: 'no_permitido', actual: null, detalle: p.motivo }
      const de = v.estado
      const { nuevo } = aplicarAccion(v, m.accion, p.a, m, ahoraIso(), !!v.editado)
      Object.assign(v, nuevo, { version: v.version + 1, estado_desde: de !== nuevo.estado ? ahoraIso() : v.estado_desde })
      const e = evento(v, 'estado', m.actor, { de, a: v.estado, datos: { accion: m.accion, ...(m.datos ?? {}) } })
      return { ok: true, actual: { video: copia(v), evento: copia(e) } }
    },
    actualizarVideo: async p => {
      w()
      const v = s.videos.get(p.id)
      if (!v) return { ok: false, motivo: 'no_existe', actual: null }
      if (v.version !== p.version) return { ok: false, motivo: 'conflicto', actual: null }
      Object.assign(v, copia(p.cambios)); v.version++
      const e = evento(v, p.tipo, p.actor, { nota: p.nota ?? '', datos: p.datos ?? {} })
      return { ok: true, actual: { video: copia(v), evento: copia(e) } }
    },
    crearVideoSiFalta: async (nv, actor) => {
      w()
      const ya = [...s.videos.values()].find(v => (v.id_crm === nv.id_crm.toUpperCase() && v.clave === nv.clave) || (nv.clickup_id && v.clickup_id === nv.clickup_id))
      if (ya) return { video: copia(ya), creado: false, evento: null }
      const v = { ...copia(nv), id: nid(), id_crm: nv.id_crm.toUpperCase(), estado_previo: null, estado_desde: ahoraIso(), bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null,
        ronda_interna: 0, ronda_cliente: 0, editado: null, envio_link: null, ok_cliente: null, version: 1, creado: ahoraIso(), actualizado: ahoraIso() }
      s.videos.set(v.id, v)
      const e = evento(v, nv.origen === 'clickup' ? 'importado' : 'creado', actor, { a: v.estado, datos: { origen: nv.origen } })
      return { video: copia(v), creado: true, evento: copia(e) }
    },
    leerDoc: async id => copia([...s.docs.values()].filter(d => d.id_crm === id.toUpperCase()).sort((a, b) => b.leido.localeCompare(a.leido))[0] ?? null),
    leerDocPorId: async id => copia(s.docs.get(id) ?? null),
    docsLeidos: async () => new Map([...s.docs.values()].map(d => [d.doc_id, { id_crm: d.id_crm, modificado: d.modificado }])),
    guardarDoc: async d => { w(); const nuevo = !s.docs.has(d.doc_id); s.docs.set(d.doc_id, copia(d)); return { nuevo } },
    listarDocs: async () => copia([...s.docs.values()]),
    pasosAbiertos: async () => copia(s.pasos.filter(p => p.estado === 'abierto')),
    crearPasos: async xs => {
      w()
      const out = []
      for (const x of xs) {
        if (s.pasos.some(p => p.id_crm === x.id_crm && p.ciclo === x.ciclo && p.escalon === x.escalon)) continue
        const p = { ...copia(x), id: nid(), hecho: x.hecho ?? null, decision: null, decidido: null, estado: 'abierto', version: 1, frenado: x.frenado ?? null }
        s.pasos.push(p); out.push(copia(p))
      }
      return out
    },
    actualizarPaso: async (id, c) => { w(); const p = s.pasos.find(x => x.id === id); if (p && p.estado === 'abierto' && !p.hecho) Object.assign(p, { videos: c.videos, frenado: c.frenado ?? null }) },
    cerrarCiclo: async (id, ciclo, estado) => { w(); let n = 0; for (const p of s.pasos) if (p.id_crm === id && p.ciclo === ciclo && p.estado === 'abierto') { p.estado = estado; n++ } return n },
    clientesGrabaEquipo: async () => new Set(s.graba_equipo),
  }
  return { s, repo }
}

/** Un video de juguete para el repositorio en memoria. */
export function videoJuguete(over = {}) {
  return { id: 1, id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V4', tanda_guion: 1, numero: 4, guion: null, guion_texto: '', gancho: '', estado: 'esperando_crudos',
    estado_previo: null, estado_desde: '2026-10-20T12:00:00.000Z', prioridad: 'normal', bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null, ronda_interna: 0,
    ronda_cliente: 0, editado: null, envio_link: null, ok_cliente: null, origen: 'doc', clickup_id: null, version: 1, creado: '2026-10-20T12:00:00.000Z', actualizado: '2026-10-20T12:00:00.000Z', ...over }
}
