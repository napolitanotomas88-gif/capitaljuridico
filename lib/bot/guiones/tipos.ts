// ── Etapa Guiones del bot Capital Jurídico: tipos (puro) ─────────────────────────────────────────
// De las ideas aprobadas en la ficha de kickoff (/clientes/<id>/kickoff) sale una TANDA de guiones completos. Decisiones de
// Tomás (24/10/2026): ~6 guiones por tanda, 500–800 caracteres de texto hablado, la ciudad o provincia en el gancho y, sobre
// todo, diversidad creativa: cada guion con un recurso creativo distinto (pizarra, documento en mano, caminar, actuar…) y el
// abogado nunca quieto (algo cambia en cada sección: plano, ángulo, objeto, postura).
// Formato de cada sección, del prompt maestro de Tomás: Velocidad (1–5) → indicación de grabación entre paréntesis → texto.

export const SECCIONES = ['HOOK', 'PROBLEMA', 'SOLUCION', 'CTA'] as const
export type Seccion = (typeof SECCIONES)[number]
export const NOMBRE_SECCION: Record<Seccion, string> = { HOOK: 'HOOK', PROBLEMA: 'PROBLEMA', SOLUCION: 'SOLUCIÓN', CTA: 'CTA' }

/** Cómo arranca el gancho: sirve para que la tanda no salga con seis ganchos iguales. */
export const TIPOS_GANCHO = [
  'pregunta_callout',   // «¿Te despidieron en San Juan y…?»
  'si_condicional',     // «Si trabajaste más de un año y medio en blanco…»
  'desmentida',         // «Te dijeron que no te corresponde nada. Mentira.»
  'caso_contado',       // «La semana pasada me escribió alguien de San Juan…»
  'lista',              // «Tres señales de que…»
  'acting',             // el abogado actúa al empleador: «Mirá, mañana no hace falta que vengas»
  'giro_corto',         // «No te despiden… pero hacen todo para que te vayas»
  'lectura',            // lee una pregunta o un mensaje desde el celular o un papel
] as const
export type TipoGancho = (typeof TIPOS_GANCHO)[number]

export interface SeccionGuion {
  seccion: Seccion
  velocidad: number               // 1 a 5
  indicacion: string              // lo que va entre paréntesis, sin los paréntesis
  texto: string                   // lo que dice el abogado; en el CTA incluye «(gesto con el dedo hacia abajo)»
}

export interface Guion {
  numero: number                  // 1..n dentro de la tanda
  titulo: string
  idea: string                    // de qué idea aprobada sale (su título)
  formato: string                 // clave del catálogo de recursos creativos (formatos.ts)
  tipo_gancho: TipoGancho
  utileria: string[]              // lo que el abogado tiene que tener a mano ([] = nada)
  secciones: SeccionGuion[]       // HOOK, PROBLEMA, SOLUCION, CTA, en ese orden
  ganchos_alternativos: string[]  // otras formas de abrir el mismo guion, para elegir
  intencion: string               // por qué está armado así (para quien revisa)
  verificar: string[]             // cifras, plazos o afirmaciones legales que tiene que mirar Tomás ([] = nada)
}

export interface Tanda {
  cliente: string
  ciudad: string                  // la ciudad o provincia que nombra cada gancho (p. ej. «San Juan»)
  guiones: Guion[]
  notas: string                   // para quien revisa ('' = nada)
}

/** Lo mínimo del catálogo que necesita el revisor mecánico. */
export interface FormatoCatalogo { nombre: string; dificultad: 1 | 2 | 3 }
export type Catalogo = Record<string, FormatoCatalogo>

export type Gravedad = 'error' | 'aviso'
export interface Hallazgo {
  gravedad: Gravedad
  guion: number | null            // null = de la tanda entera
  regla: string                   // clave corta: 'largo', 'ciudad', 'comillas'…
  detalle: string
}
