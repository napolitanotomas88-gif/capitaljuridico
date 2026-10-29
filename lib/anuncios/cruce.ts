// ── Cruce cuenta publicitaria ↔ cliente del CRM ↔ sheet de guiones ───────────────────────────
// Copia simplificada de la lógica de lib/rawSheets.ts (indiceClientes / resolverAlias) para no
// acoplarse a ese archivo. Nombres normalizados: minúsculas, sin acentos ni puntuación.
//   Cuenta → cliente: 1) AJUSTES_CUENTA (cuentas.ts); 2) col C de "Cuentas Meta" (fila exacta por
//   nombre o id; si no, la única fila SI cuyas palabras están todas en el nombre de la cuenta);
//   3) match por nombre de la cuenta / del portfolio contra el CRM (≥2 palabras de 4+ letras con UN cliente).
//   Cliente → guiones: pestaña "Alias Guiones" del CRM; si no, alias tipo "CarlosE" (nombre + iniciales
//   de apellidos) que calce con UN solo cliente vigente; si no, el alias pegado al nombre ("SofíaCuervo").
import type { ClienteCRM, DatosSheets, FilaGuion } from './sheets'
import { cargarCuentas } from './cuentas'

export const normTxt = (x: unknown) => (x ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const pegado = (x: string) => normTxt(x).replace(/ /g, '')
const esVigente = (estado: string) => estado === 'ACTIVO' || estado === 'PAUSADO'

const PALABRAS_GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'juridicos', 'abogado', 'abogada', 'abogados', 'abogadas',
  'asociados', 'asociadas', 'legal', 'legales', 'consultora', 'publicidad', 'campanas', 'finanzas', 'firma', 'dolares', 'notarial', 'penal'])

export interface ClienteResuelto {
  cliente: ClienteCRM | null      // cliente del CRM (match fuerte)
  nombreColC: string              // lo cargado en la col C de "Cuentas Meta" (aunque no matchee el CRM)
  filaCuentasMeta: { actual: boolean; exacta: boolean } | null
  exCliente: string | null        // motivo si el CRM lo marca como ex-cliente
  activo: boolean                 // cliente vigente según CRM o "Cuentas Meta" (col B = SI)
  pausado: boolean
}

export type EstadoGuion = 'grabado' | 'pendiente' | 'sin_guiones' | 'inactivo'
export interface Guiones { estado: EstadoGuion; detalle: string; alias: string[] }

export function crearCruce(s: DatosSheets) {
  const AJUSTES_CUENTA = cargarCuentas().ajustes
  // ── CRM: un registro por nombre (si hay duplicados, gana el vigente) ──
  const crmPorNombre = new Map<string, ClienteCRM & { tokens: string[] }>()
  for (const c of s.clientes) {
    const k = normTxt(c.nombre), prev = crmPorNombre.get(k)
    if (!prev || (!esVigente(prev.estado) && esVigente(c.estado))) crmPorNombre.set(k, { ...c, tokens: k.split(' ') })
  }
  const clientes = [...crmPorNombre.values()]
  const matchPorNombre = (texto: string): ClienteCRM | null => {
    const t = normTxt(texto).split(' ').filter(x => x.length >= 4 && !PALABRAS_GENERICAS.has(x))
    if (t.length < 2) return null
    // Gana el cliente con más palabras en común; ante empate, sólo el único vigente.
    // No se elige por un apellido aislado ni se resuelven empates por orden.
    const hits = clientes.map(c => ({ c, n: t.filter(x => c.tokens.includes(x)).length })).filter(h => h.n >= 2).sort((a, b) => b.n - a.n)
    if (!hits.length) return null
    const mejores = hits.filter(h => h.n === hits[0].n).map(h => h.c)
    if (mejores.length === 1) return mejores[0]
    const vig = mejores.filter(c => esVigente(c.estado))
    return vig.length === 1 ? vig[0] : null
  }
  const buscarCliente = (nombre: string): ClienteCRM | null =>
    nombre ? crmPorNombre.get(normTxt(nombre)) ?? matchPorNombre(nombre.replace(/\(.*?\)/g, ' ')) ?? matchPorNombre(nombre) : null

  // ── "Cuentas Meta": fila exacta por nombre/id o difusa (solo filas SI) ──
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  const cuentaInfo = new Map<string, { actual: boolean; clienteCRM: string }>()
  for (const f of s.cuentasMeta) cuentaInfo.set(norm(f.cuenta), { actual: f.actual, clienteCRM: f.clienteCRM })
  const IGNORAR = new Set(['usd', 'ars', 'cp', 'ads', 'y', 'de', 'la', 'del'])
  const tokensCuenta = (x: string) => norm(x).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !IGNORAR.has(t))
  const filasSI = [...cuentaInfo.entries()].filter(([, v]) => v.actual).map(([k, v]) => ({ t: tokensCuenta(k), v })).filter(f => f.t.length >= 2)
  const infoCuenta = (nombre: string, id: string) => {
    const exacta = cuentaInfo.get(norm(nombre)) ?? cuentaInfo.get(id) ?? cuentaInfo.get(id.replace(/^act_/, ''))
    if (exacta) return { ...exacta, exacta: true }
    const tn = new Set(tokensCuenta(nombre))
    const m = filasSI.filter(f => f.t.every(x => tn.has(x)))
    return m.length === 1 ? { ...m[0].v, exacta: false } : null
  }

  function resolverCliente(c: { id: string; nombre: string; negocio?: string | null }): ClienteResuelto {
    const ajuste = AJUSTES_CUENTA[c.id]
    const info = infoCuenta(c.nombre, c.id)
    let colC = ajuste?.cliente ?? info?.clienteCRM ?? ''
    let cli = colC ? buscarCliente(colC) : null
    // Col C traída por match DIFUSO que apunta a un ex-cliente: no se usa
    if (!ajuste?.cliente && info && !info.exacta && cli && !esVigente(cli.estado)) { colC = ''; cli = null }
    if (!colC) cli = matchPorNombre(c.nombre) ?? (c.negocio ? matchPorNombre(c.negocio) : null)
    const estado = cli?.estado ?? ''
    let exCliente: string | null = null
    if (info?.exacta && !info.actual) exCliente = 'la pestaña "Cuentas Meta" la marca como NO cliente actual'
    else if (estado === 'FINALIZADO' || estado === 'INACTIVO') exCliente = `el cliente ${cli!.nombre} figura ${estado} en el CRM`
    return {
      cliente: cli,
      nombreColC: colC,
      filaCuentasMeta: info ? { actual: info.actual, exacta: info.exacta } : null,
      exCliente,
      activo: !exCliente && (estado === 'ACTIVO' || (!!info?.actual && estado !== 'PAUSADO')),
      pausado: estado === 'PAUSADO',
    }
  }

  // ── Guiones: alias → cliente del CRM ──
  const aliasTabla = new Map<string, string>()
  for (const a of s.alias) aliasTabla.set(normTxt(a.alias), a.cliente)
  const resolverAlias = (alias: string): ClienteCRM | null => {
    const porTabla = aliasTabla.get(normTxt(alias))
    if (porTabla) return buscarCliente(porTabla)
    // "CarlosE" = nombre Carlos + apellido con E · "GiseV" · "Enzo" (único cliente vigente que calza)
    const m = alias.replace(/\s+/g, '').match(/^([A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]{2,})([A-ZÁÉÍÓÚÑ]{0,2})$/)
    if (!m || (!m[2] && m[1].length < 4)) return null
    const nom = normTxt(m[1]), iniciales = normTxt(m[2]).split('')
    const hits = clientes.filter(c => {
      if (!esVigente(c.estado)) return false
      const i = c.tokens.findIndex(tk => tk.startsWith(nom))
      if (i < 0) return false
      let desde = i + 1
      for (const ini of iniciales) {
        const j = c.tokens.findIndex((tk, k) => k >= desde && tk.startsWith(ini))
        if (j < 0) return false
        desde = j + 1
      }
      return true
    })
    return hits.length === 1 ? hits[0] : null
  }
  // Filas de guiones agrupadas por cliente (clave = nombre normalizado del CRM, o el alias si no se resolvió)
  const guionesPorCliente = new Map<string, { alias: Set<string>; filas: FilaGuion[] }>()
  const guionesPorAlias = new Map<string, { alias: Set<string>; filas: FilaGuion[]; resuelto: boolean }>()
  for (const g of s.guiones) {
    const cli = resolverAlias(g.alias)
    const k = cli ? normTxt(cli.nombre) : `alias:${pegado(g.alias)}`
    const acc = guionesPorCliente.get(k) ?? { alias: new Set<string>(), filas: [] }
    acc.alias.add(g.alias); acc.filas.push(g)
    guionesPorCliente.set(k, acc)
    guionesPorAlias.set(pegado(g.alias), { ...acc, resuelto: !!cli })
  }

  const NOTA_INACTIVA = /\bno\s+(mandar|enviar|grabar)\b|\bpausa|\bbaja\b/i
  const dm = (ymd: string) => `${+ymd.slice(8, 10)}/${+ymd.slice(5, 7)}`

  function guionesDe(cliente: ClienteCRM | null, nombreColC: string, nombreCuenta: string, aliasAjuste?: string): Guiones {
    let grupo: { alias: Set<string>; filas: FilaGuion[] } | undefined = aliasAjuste ? guionesPorAlias.get(pegado(aliasAjuste)) : undefined
    if (!grupo && cliente) grupo = guionesPorCliente.get(normTxt(cliente.nombre))
    if (!grupo && nombreColC) grupo = guionesPorCliente.get(normTxt(nombreColC))
    if (!grupo) {
      // Un alias sin resolver también puede venir unido al nombre, sin espacios.
      const candidatos = [cliente?.nombre, nombreColC, nombreCuenta].filter((x): x is string => !!x).map(pegado)
      for (const [a, g] of guionesPorAlias) {
        if (!g.resuelto && a.length >= 6 && candidatos.some(c => c.includes(a))) { grupo = g; break }
      }
    }
    if (!grupo) return { estado: 'sin_guiones', detalle: 'no figura en el sheet de guiones', alias: [] }
    const alias = [...grupo.alias]
    const filas = grupo.filas
    if (filas.some(f => !f.grabado && f.nota && NOTA_INACTIVA.test(f.nota)))
      return { estado: 'inactivo', detalle: `guiones en pausa ("${filas.find(f => f.nota && NOTA_INACTIVA.test(f.nota))!.nota}")`, alias }
    const pendientes = filas.filter(f => f.diaRealizado && !f.grabado).sort((a, b) => b.diaRealizado!.localeCompare(a.diaRealizado!))
    if (pendientes.length) {
      const p = pendientes[0]
      return { estado: 'pendiente', detalle: `guiones listos el ${dm(p.diaRealizado!)}, falta grabar${p.nota ? ` (${p.nota})` : ''}`, alias }
    }
    const grabadas = filas.filter(f => f.grabado)
    if (grabadas.length) {
      const fechas = grabadas.map(f => f.fechaGrabacion ?? f.diaRealizado).filter((x): x is string => !!x).sort()
      return { estado: 'grabado', detalle: fechas.length ? `grabado (guiones del ${dm(fechas[fechas.length - 1])})` : 'grabado', alias }
    }
    return { estado: 'sin_guiones', detalle: 'en la lista de guiones pero todavía sin hacer', alias }
  }

  return { resolverCliente, guionesDe, buscarCliente }
}
