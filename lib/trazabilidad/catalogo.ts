// ── Catálogo inicial de ángulos, bolsas y arquetipos ─────────────────────────────────────────
// Sale de la estrategia del motor de contenido (motor-contenido/kb/estrategia.md, 488 llamadas): los 7 ángulos, sus
// cadenas y los descartados. Es solo la SEMILLA: la tabla cj_traz_angulos manda y se edita en /trazabilidad/angulos.
// Las bolsas son las de la clase de trazabilidad: siembra (atrae), cosecha (nutre) y urgencia (cierra).

export const BOLSAS = ['siembra', 'cosecha', 'urgencia'] as const
export type Bolsa = (typeof BOLSAS)[number]
export const ETIQUETA_BOLSA: Record<Bolsa, string> = { siembra: 'Siembra · atracción', cosecha: 'Cosecha · nutrición', urgencia: 'Urgencia · cierre' }

export interface Angulo { id: string; nombre: string; descripcion: string; bolsa: Bolsa | null; descartado: boolean }

export const ANGULOS_SEMILLA: Angulo[] = [
  { id: 'referidos', nombre: 'Depender de referidos', descripcion: 'Boca a boca, serrucho de ingresos, vida en pausa, falta de control.', bolsa: null, descartado: false },
  { id: 'fusible', nombre: 'El fusible (todos cobran fijo menos vos)', descripcion: 'Cadena de referidos: gastos fijos de la casa contra ingresos impredecibles.', bolsa: null, descartado: false },
  { id: 'curiosos', nombre: 'Curiosos y regateo', descripcion: 'Mensajes que no pagan, gente que pide precio y desaparece.', bolsa: null, descartado: false },
  { id: 'fechas-fijas', nombre: 'Fechas fijas de la vida', descripcion: 'Vencimientos (colegio, prepaga, tarjeta) contra cobros sin fecha.', bolsa: null, descartado: false },
  { id: 'peaje', nombre: 'El peaje del referido', descripcion: 'Comisiones o favores que se pagan por cada caso que llega.', bolsa: null, descartado: false },
  { id: 'no-cierra', nombre: 'Recibís mensajes pero no cerrás', descripcion: 'El problema es quién te escribe: hace falta un filtro.', bolsa: null, descartado: false },
  { id: 'honorarios', nombre: 'No concretás los honorarios', descripcion: 'No saber cuánto cobrar, regateo, cuotas que se caen, trabajar gratis.', bolsa: null, descartado: false },
  { id: 'contenido-agencias', nombre: 'Tu contenido o tus anuncios no generan consultas', descripcion: 'Seguidores sin clientes, agencias y CM que entregan posteos y no casos.', bolsa: null, descartado: false },
  { id: 'ia', nombre: 'No sabés apalancarte de la IA', descripcion: 'Cursos de IA sin resultados; la IA sin sistema es un hobby.', bolsa: null, descartado: false },
  { id: 'ansiedad', nombre: 'La ansiedad silenciosa', descripcion: 'Cargar solo con la incertidumbre, no dormir aun facturando.', bolsa: null, descartado: false },
  { id: 'agenda-esclava', nombre: 'La agenda esclava', descripcion: 'Clientes sin límites que escriben a cualquier hora porque llegaron de favor.', bolsa: null, descartado: false },
  { id: 'descalce', nombre: 'Descalce judicial', descripcion: 'Escritorio lleno, cuenta vacía: los tiempos de la justicia contra los gastos.', bolsa: null, descartado: false },
  { id: 'casos-exito', nombre: 'Casos de éxito y testimonios', descripcion: 'Resultados de clientes con nombre, cifra y fecha.', bolsa: null, descartado: false },
  { id: 'oferta-directa', nombre: 'Oferta directa / VSL', descripcion: 'Promesa, problema, 3 pilares y llamado a agendar o ver el video.', bolsa: null, descartado: false },
  { id: 'titulo-colgado', nombre: 'Título colgado / abogado sin casos', descripcion: 'DESCARTADO: atrae al curioso sin caja.', bolsa: null, descartado: true },
  { id: 'competencia', nombre: 'Tu competencia te está pasando', descripcion: 'DESCARTADO: no distingue compradores.', bolsa: null, descartado: true },
  { id: 'desesperacion', nombre: 'Desesperación económica', descripcion: 'DESCARTADO: anticorrelaciona con el cierre.', bolsa: null, descartado: true },
]

// Los 4 arquetipos del avatar (estrategia §5). Claude elige uno por llamada; "sin datos" si no se puede.
export const ARQUETIPOS = ['A', 'B', 'C', 'D', 'sin datos'] as const
export type Arquetipo = (typeof ARQUETIPOS)[number]
export const ETIQUETA_ARQUETIPO: Record<Arquetipo, string> = {
  A: 'A · Ya venía en camino',
  B: 'B · Lo vengo pensando',
  C: 'C · Curioso en crisis',
  D: 'D · Comparador racional',
  'sin datos': 'Sin datos',
}
export const DESCRIPCION_ARQUETIPOS = `A — Ya venía en camino: pasos previos ejecutados, evento bisagra con fecha, habla de familia, verificó pruebas.
B — El eterno "lo vengo pensando": aspiración difusa, sin fecha, disparado por el anuncio.
C — El curioso en crisis: urgencia máxima, caja cero, no puede comprar.
D — El comparador racional: tiene caja y compara agencias; se gana con diferenciación y prueba verificable.`
