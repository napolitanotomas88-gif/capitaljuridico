// ── Feriados nacionales y días no laborables de Argentina (2026 y 2027) ──────────────────────
// Los usa el detector de aumentos de CPL: un fin de semana o feriado suele tener otro costo por
// mensaje que un día hábil, así que se separan para no disparar alertas falsas.
//
// CÓMO EDITAR: agregar/quitar líneas 'AAAA-MM-DD': 'descripción'. Si el Gobierno traslada un
// feriado o decreta un día no laborable nuevo, se corrige acá y listo (no hay que tocar nada más).
// Reglas de traslado (Ley 27.399): los feriados "trasladables" que caen martes o miércoles pasan
// al lunes anterior; los que caen jueves o viernes, al lunes siguiente. Los inamovibles no se mueven.
//
// Fuente: calendario oficial (argentina.gob.ar/interior/feriados). Los de 2027 están calculados
// con la ley; los "días no laborables con fines turísticos" de 2027 todavía no fueron decretados.

export const FERIADOS: Record<string, string> = {
  // ── 2026 ──
  '2026-01-01': 'Año Nuevo',
  '2026-02-16': 'Carnaval',
  '2026-02-17': 'Carnaval',
  '2026-03-23': 'Día no laborable con fines turísticos (puente)',
  '2026-03-24': 'Día Nacional de la Memoria por la Verdad y la Justicia',
  '2026-04-02': 'Día del Veterano y de los Caídos en Malvinas + Jueves Santo (no laborable)',
  '2026-04-03': 'Viernes Santo',
  '2026-05-01': 'Día del Trabajador',
  '2026-05-25': 'Día de la Revolución de Mayo',
  '2026-06-15': 'Paso a la Inmortalidad del Gral. Güemes (trasladado del 17/6)',
  '2026-06-20': 'Paso a la Inmortalidad del Gral. Belgrano',
  '2026-07-09': 'Día de la Independencia',
  '2026-07-10': 'Día no laborable con fines turísticos (puente)',
  '2026-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2026-10-12': 'Día del Respeto a la Diversidad Cultural',
  '2026-11-23': 'Día de la Soberanía Nacional (trasladado del 20/11)',
  '2026-12-07': 'Día no laborable con fines turísticos (puente)',
  '2026-12-08': 'Inmaculada Concepción de María',
  '2026-12-25': 'Navidad',

  // ── 2027 ── (traslados calculados con la Ley 27.399: confirmar cuando salga el decreto)
  '2027-01-01': 'Año Nuevo',
  '2027-02-08': 'Carnaval',
  '2027-02-09': 'Carnaval',
  '2027-03-24': 'Día Nacional de la Memoria por la Verdad y la Justicia',
  '2027-03-25': 'Jueves Santo (no laborable)',
  '2027-03-26': 'Viernes Santo',
  '2027-04-02': 'Día del Veterano y de los Caídos en Malvinas',
  '2027-05-01': 'Día del Trabajador',
  '2027-05-25': 'Día de la Revolución de Mayo',
  '2027-06-20': 'Paso a la Inmortalidad del Gral. Belgrano',
  '2027-06-21': 'Paso a la Inmortalidad del Gral. Güemes (trasladado del jueves 17/6)',
  '2027-07-09': 'Día de la Independencia',
  '2027-08-16': 'Paso a la Inmortalidad del Gral. San Martín (trasladado del martes 17/8)',
  '2027-10-11': 'Día del Respeto a la Diversidad Cultural (trasladado del martes 12/10)',
  '2027-11-20': 'Día de la Soberanía Nacional (cae sábado)',
  '2027-12-08': 'Inmaculada Concepción de María',
  '2027-12-25': 'Navidad',
  // Días no laborables con fines turísticos 2027: agregarlos acá cuando se publiquen.
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Día de la semana de una fecha 'AAAA-MM-DD' (0 = domingo), sin depender de la zona horaria del server
export function diaSemana(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}

export const nombreDia = (ymd: string) => DIAS[diaSemana(ymd)]

export function esFeriado(ymd: string): boolean {
  return ymd in FERIADOS
}

// Hábil = lunes a viernes que no es feriado ni día no laborable
export function esHabil(ymd: string): boolean {
  const d = diaSemana(ymd)
  return d !== 0 && d !== 6 && !esFeriado(ymd)
}

// 'finde' agrupa sábados, domingos, feriados y días no laborables (todos suelen comportarse distinto)
export function tipoDia(ymd: string): 'habil' | 'finde' {
  return esHabil(ymd) ? 'habil' : 'finde'
}

export function etiquetaDia(ymd: string): string {
  if (FERIADOS[ymd]) return `feriado (${FERIADOS[ymd]})`
  const d = diaSemana(ymd)
  return d === 0 || d === 6 ? 'fin de semana' : 'hábil'
}
