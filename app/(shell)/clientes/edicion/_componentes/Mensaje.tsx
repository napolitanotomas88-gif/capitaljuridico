import type { Mensaje as M } from './useEnvio'

/** El resultado de una acción, leído por los lectores de pantalla (aria-live). Vacío no ocupa lugar. */
export function Mensaje({ msj, enviando, textoEnviando = 'Guardando…' }: { msj: M | null; enviando: boolean; textoEnviando?: string }) {
  return (
    <p role="status" aria-live="polite" className={msj?.error && !enviando ? 'ed-msj ed-msj--error' : 'ed-msj'}>
      {enviando ? textoEnviando : msj?.texto ?? ''}
    </p>
  )
}
