// ── Propuestas de paleta (e05): SQL sobre cj_marca_propuestas (la tabla la crea la migración v2) ────────────────────────
// El vigía (lib/bot/grabacion/marcaVigia.ts) lee con Claude cada archivo nuevo de "Marca - X" y deja una fila por archivo:
//   · propuesta   = Claude leyó colores (y quizás tipografías): la ficha del cliente la muestra con «Usar estos colores»;
//   · sin_colores = el archivo no muestra una paleta (una foto, un contrato…): queda anotado para no volver a leerlo;
//   · error       = no se pudo bajar o leer (formato, peso, Claude lo rechazó) o falló 3 veces: no se reintenta;
//   · reintentar  = falla pasajera (Claude saturado, Google 5xx/403 de cuota, red): se relee en la pasada siguiente, y al
//     tercer intento pasa a error (así un PDF que nunca termina no se paga todos los días).
// Nunca toca cj_marca: la ficha la guardan Aylu o Tomás. Las lecturas no crean la tabla.
import type { IdCrm, Iso } from '../tipos'
import { asegurarTablas, consulta, idCrm, iso, json, leer, txt, type Fila } from './base'

export type EstadoPropuesta = 'propuesta' | 'sin_colores' | 'error' | 'reintentar'
export interface ColorPropuesto { hex: string; nombre: string }
export interface PropuestaMarca {
  id: number; id_crm: IdCrm; drive_id: string; nombre: string; estado: EstadoPropuesta
  colores: ColorPropuesto[]; tipografias: string[]; nota: string; modelo: string; creado: Iso
}
export type PropuestaNueva = Omit<PropuestaMarca, 'id' | 'creado' | 'estado'> & { estado: Exclude<EstadoPropuesta, 'reintentar'> }

export const MAX_INTENTOS_MARCA = 3

function aPropuesta(f: Fila): PropuestaMarca {
  return {
    id: Number(f.id), id_crm: txt(f.id_crm), drive_id: txt(f.drive_id), nombre: txt(f.nombre), estado: txt(f.estado) as EstadoPropuesta,
    colores: json(f.colores, []), tipografias: json(f.tipografias, []), nota: txt(f.nota), modelo: txt(f.modelo), creado: iso(f.creado),
  }
}

/** De estos archivos, los que ya no se leen (todo menos 'reintentar'). */
export async function archivosYaLeidos(driveIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(driveIds)]
  if (!ids.length) return new Set()
  return leer('propuestas leídas', new Set<string>(), async q => {
    const filas = await q`SELECT drive_id FROM cj_marca_propuestas WHERE drive_id = ANY(${ids}::text[]) AND estado <> 'reintentar'` as Fila[]
    return new Set(filas.map(f => txt(f.drive_id)))
  })
}

/** Guarda la lectura de un archivo (pisa solo una fila 'reintentar'). Si otra corrida ya lo cerró, devuelve false. */
export async function guardarPropuesta(p: PropuestaNueva): Promise<boolean> {
  const k = idCrm(p.id_crm)
  await asegurarTablas()
  return consulta('guardar propuesta de marca', async q => {
    const filas = await q`INSERT INTO cj_marca_propuestas (id_crm, drive_id, nombre, estado, colores, tipografias, nota, modelo)
      VALUES (${k}, ${p.drive_id}, ${p.nombre.slice(0, 200)}, ${p.estado}, ${JSON.stringify(p.colores)}::jsonb, ${JSON.stringify(p.tipografias)}::jsonb,
        ${p.nota.slice(0, 500)}, ${p.modelo.slice(0, 60)})
      ON CONFLICT (drive_id) DO UPDATE SET id_crm = EXCLUDED.id_crm, nombre = EXCLUDED.nombre, estado = EXCLUDED.estado, colores = EXCLUDED.colores,
        tipografias = EXCLUDED.tipografias, nota = EXCLUDED.nota, modelo = EXCLUDED.modelo, creado = now()
      WHERE cj_marca_propuestas.estado = 'reintentar'
      RETURNING id` as Fila[]
    return filas.length > 0
  })
}

/** Anota una falla pasajera: suma un intento y, al llegar a MAX_INTENTOS_MARCA, la deja en 'error' con el motivo. */
export async function anotarReintento(p: { id_crm: IdCrm; drive_id: string; nombre: string; nota: string }): Promise<void> {
  const k = idCrm(p.id_crm)
  const nota = p.nota.slice(0, 450)
  await asegurarTablas()
  await consulta('reintento de marca', async q => {
    await q`INSERT INTO cj_marca_propuestas (id_crm, drive_id, nombre, estado, nota, intentos)
      VALUES (${k}, ${p.drive_id}, ${p.nombre.slice(0, 200)}, 'reintentar', ${nota}, 1)
      ON CONFLICT (drive_id) DO UPDATE SET intentos = cj_marca_propuestas.intentos + 1, nota = EXCLUDED.nota,
        estado = CASE WHEN cj_marca_propuestas.intentos + 1 >= ${MAX_INTENTOS_MARCA} THEN 'error' ELSE 'reintentar' END
      WHERE cj_marca_propuestas.estado = 'reintentar'`
  })
}

/** Las últimas lecturas de un cliente, la más nueva primero (la ficha muestra la propuesta y, si no hay, el último problema). */
export async function lecturasDe(id: IdCrm, limite = 5): Promise<PropuestaMarca[]> {
  const k = idCrm(id)
  return leer('propuestas de marca', [] as PropuestaMarca[], async q => {
    const filas = await q`SELECT * FROM cj_marca_propuestas WHERE id_crm = ${k} AND estado <> 'reintentar' ORDER BY creado DESC LIMIT ${limite}` as Fila[]
    return filas.map(aPropuesta)
  })
}
