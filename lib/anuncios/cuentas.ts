import { leerCuentasPrivadas } from '../configPrivada'

// IDs, exclusiones y cruces manuales de clientes se configuran de forma privada.
export const cargarCuentas = leerCuentasPrivadas

export function esCuentaPropia(id: string): boolean {
  const propia = (process.env.META_AD_ACCOUNT_ID ?? '').replace(/^act_/, '').trim()
  return !!propia && id.replace(/^act_/, '') === propia
}

export const conAct = (id: string) => (id.startsWith('act_') ? id : `act_${id}`)
export const sinAct = (id: string) => id.replace(/^act_/, '')
