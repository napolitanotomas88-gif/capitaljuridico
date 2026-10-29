// ── Quién aprueba una tanda de guiones (verificación humana, d02): Tomi o Faus ──────────────────
// Por mail de la sesión de Google: KICKOFF_REVISOR_TOMI (el mismo de las ideas del kickoff) y GUIONES_REVISOR_FAUS. Puro.
const mails = (v?: string) => (v ?? '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean)

export function esAprobador(email: string, env: Record<string, string | undefined> = process.env): boolean {
  const e = email.trim().toLowerCase()
  return !!e && [...mails(env.KICKOFF_REVISOR_TOMI), ...mails(env.GUIONES_REVISOR_FAUS)].includes(e)
}

/** Los guiones que faltan verificar (27/10: cada guion lleva su «✓ Verificado» y el check final se habilita con todos). Puro. */
export function faltanVerificar(guiones: Record<string, { verificado?: unknown }>): number[] {
  return Object.entries(guiones).filter(([, g]) => !g.verificado || typeof g.verificado !== 'object').map(([n]) => Number(n)).sort((a, b) => a - b)
}
