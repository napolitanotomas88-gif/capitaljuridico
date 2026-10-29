// ── Ficha de marca (e05): SQL sobre cj_marca (la tabla la crea la migración de A) ─────────────────────────────────────
// Una fila por cliente del CRM. Escrituras condicionadas a la versión que vio quien guarda:
//   · version null = crear: INSERT … ON CONFLICT DO NOTHING; si ya existía → conflicto (con lo de ahora);
//   · version n   = actualizar: UPDATE … WHERE version = n; si no prendió → conflicto (con lo de ahora) o no_existe.
// `actualizado_por` y los `quien` de las fuentes guardan el NOMBRE, nunca el mail. Las lecturas no crean la tabla.
// La ficha se valida antes (marca.ts, validarFicha); acá se vuelve a validar por las dudas (nunca entra algo sin validar).
import type { FichaMarca, IdCrm, Persona, ResultadoEscritura } from '../tipos'
import { fuentesAlGuardar, validarFicha, type FichaMarcaEntrada } from '../marca'
import { ErrorEntradaEdicion, asegurarTablas, consulta, entero, idCrm, iso, json, leer, txt, type Fila } from './base'

export function aMarca(f: Fila): FichaMarca {
  return {
    id_crm: txt(f.id_crm), colores: json(f.colores, []), tipografias: json(f.tipografias, []), logo: json(f.logo, null),
    referencia: json(f.referencia, null), carpeta_marca: json(f.carpeta_marca, null), fuentes: json(f.fuentes, {}),
    notas: txt(f.notas), version: entero(f.version, 1), actualizado: iso(f.actualizado),
  }
}

export async function leerMarca(id: IdCrm): Promise<FichaMarca | null> {
  const k = idCrm(id)
  return leer('leer marca', null, async q => {
    const [f] = await q`SELECT * FROM cj_marca WHERE id_crm = ${k}` as Fila[]
    return f ? aMarca(f) : null
  })
}

export async function leerMarcas(ids: IdCrm[]): Promise<Map<IdCrm, FichaMarca>> {
  const ks = [...new Set(ids.map(idCrm))]
  if (!ks.length) return new Map()
  return leer('leer marcas', new Map<IdCrm, FichaMarca>(), async q => {
    const filas = await q`SELECT * FROM cj_marca WHERE id_crm = ANY(${ks}::text[])` as Fila[]
    return new Map(filas.map(f => { const m = aMarca(f); return [m.id_crm, m] as const }))
  })
}

/** Crea (version null) o actualiza (version = la que vio) la ficha. Las fuentes de lo que cambió quedan a nombre de quien guarda. */
export async function guardarMarca(id: IdCrm, ficha: FichaMarcaEntrada, version: number | null, actor: Persona): Promise<ResultadoEscritura<FichaMarca>> {
  const k = idCrm(id)
  const v = validarFicha({ ...ficha, id_crm: k })
  if (!v.ok) throw new ErrorEntradaEdicion(v.campo, v.error)
  if (actor.rol !== 'aylu' && actor.rol !== 'tomas') return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'la ficha de marca la cargan Aylu o Tomás' }
  if (version !== null && (!Number.isSafeInteger(version) || version <= 0)) throw new ErrorEntradaEdicion('version', 'versión inválida')
  const f = v.ficha
  const ahora = new Date().toISOString()
  await asegurarTablas()
  return consulta('guardar marca', async q => {
    const [previa] = await q`SELECT * FROM cj_marca WHERE id_crm = ${k}` as Fila[]
    const antes = previa ? aMarca(previa) : null
    const fuentes = JSON.stringify(fuentesAlGuardar(antes, f, actor, ahora))
    let filas: Fila[]
    if (version === null) {
      if (antes) return { ok: false, motivo: 'conflicto', actual: antes, detalle: 'la ficha ya existe' }
      filas = await q`INSERT INTO cj_marca (id_crm, colores, tipografias, logo, referencia, carpeta_marca, fuentes, notas, version, actualizado, actualizado_por)
        VALUES (${k}, ${JSON.stringify(f.colores)}::jsonb, ${JSON.stringify(f.tipografias)}::jsonb, ${JSON.stringify(f.logo)}::jsonb,
          ${JSON.stringify(f.referencia)}::jsonb, ${JSON.stringify(f.carpeta_marca)}::jsonb, ${fuentes}::jsonb, ${f.notas}, 1, now(), ${actor.nombre})
        ON CONFLICT (id_crm) DO NOTHING RETURNING *` as Fila[]
    } else {
      filas = await q`UPDATE cj_marca SET colores = ${JSON.stringify(f.colores)}::jsonb, tipografias = ${JSON.stringify(f.tipografias)}::jsonb,
          logo = ${JSON.stringify(f.logo)}::jsonb, referencia = ${JSON.stringify(f.referencia)}::jsonb, carpeta_marca = ${JSON.stringify(f.carpeta_marca)}::jsonb,
          fuentes = ${fuentes}::jsonb, notas = ${f.notas}, version = version + 1, actualizado = now(), actualizado_por = ${actor.nombre}
        WHERE id_crm = ${k} AND version = ${version} RETURNING *` as Fila[]
    }
    if (filas[0]) return { ok: true, actual: aMarca(filas[0]) }
    const [ahoraFila] = await q`SELECT * FROM cj_marca WHERE id_crm = ${k}` as Fila[]
    return ahoraFila ? { ok: false, motivo: 'conflicto', actual: aMarca(ahoraFila) } : { ok: false, motivo: 'no_existe', actual: null }
  })
}
