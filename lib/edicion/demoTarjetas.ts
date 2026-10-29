import type { EtapaTarjeta, TarjetaEdicion } from './tarjetasTipos'

export function tarjetasEdicionDemo(): TarjetaEdicion[] {
  const tarjeta = (id: string, nombre: string, etapa: EtapaTarjeta, id_crm: string, parent_id: string | null = null): TarjetaEdicion => ({
    id, nombre, etapa, id_crm, parent_id, video_id: null, version: 1, campos: { paleta: '#12352c · #f6efe2', crudo: '', editado: '' }, hijos: [], puede_editar: true,
    asignados: parent_id ? [] : ['Equipo de ejemplo'],
  })
  const uno = tarjeta('demo-tarjeta-1', 'Estudio Ejemplo Uno', 'editado', 'E001')
  uno.hijos = [tarjeta('demo-video-1', 'Video 1 · Tanda 2', 'editado', 'E001', uno.id), tarjeta('demo-video-2', 'Video 2 · Tanda 2', 'en espera de datos', 'E001', uno.id)]
  const dos = tarjeta('demo-tarjeta-2', 'Estudio Ejemplo Dos', 'para editar', 'E002')
  dos.hijos = [tarjeta('demo-video-3', 'Video 1 · Tanda 1', 'editando', 'E002', dos.id), tarjeta('demo-video-4', 'Video 2 · Tanda 1', 'para editar', 'E002', dos.id)]
  const tres = tarjeta('demo-tarjeta-3', 'Estudio Ejemplo Tres', 'revisión', 'E003')
  tres.hijos = [tarjeta('demo-video-5', 'Video 1 · Tanda 3', 'revisión', 'E003', tres.id)]
  tres.hijos[0].hijos = [tarjeta('demo-video-6', 'Versión alternativa', 'corregido', 'E003', tres.hijos[0].id)]
  return [uno, dos, tres, tarjeta('demo-tarjeta-4', 'Estudio Ejemplo Cuatro', 'publicado', 'E004')]
}
