// ── Vínculos carpeta ↔ cliente que vienen del alta (cj_altas) ─────────────────────────────────────────────────────
// Los clientes nuevos traen el id de su carpeta desde el bot de alta (tabla cj_altas, la arma la copia del orquestador del
// alta). Esa tabla todavía no existe en esta copia y no están acordadas sus columnas: hasta que la sesión del alta las
// confirme, esto devuelve [] y los vínculos salen del cruce por nombre (exacto → `bot`; dudoso → `a_confirmar`, lo confirma
// Aylu en /edicion/vinculos). Cuando estén, se lee acá (solo lectura) y quedan como vínculo `alta`.
import type { IdCrm } from '@/lib/edicion/tipos'

export async function vinculosDeAltas(): Promise<{ id_crm: IdCrm; carpeta_id: string }[]> {
  return []
}
