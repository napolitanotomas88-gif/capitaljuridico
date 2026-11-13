// ── Nombres de personas para los cruces por nombre (puro: sin red; lo prueba scripts/test-anuncios-vinculos.mjs) ──────────
// Pedido de Tomás (13/11/2026): el cruce cuenta de Meta ↔ cliente fallaba por dos cosas que se resuelven acá, en un solo lugar:
//   · Apóstrofos y comillas: «D’Ambrosio», «D'Ambrosio» y «DAmbrosio» son el mismo apellido. Las normalizaciones de antes
//     cambiaban el apóstrofo por un espacio («d arcangelo» ≠ «darcangelo»): ahora se saca antes de normalizar.
//   · Nombres de pila: un nombre de pila solo («Rodrigo») no identifica a nadie. Había tres listas distintas y «rodrigo» faltaba
//     en la de las sugerencias de «Por lanzar»: esta es la lista común (la unión de las tres).
// Se usa en lib/anuncios (cruce.ts, porLanzar.ts), lib/clientes/prioridad.ts y lib/rawSheets.ts.

/** Apóstrofos rectos y tipográficos, acentos sueltos y comillas tipográficas: se sacan sin dejar espacio. */
export const APOSTROFOS = /['’‘`´ʼ′“”]/g
export const sinApostrofos = (s: string): string => s.replace(APOSTROFOS, '')

/** Minúsculas, sin tildes, sin apóstrofos y sin puntuación (la puntuación queda como un espacio). */
export const normNombre = (x: unknown): string => sinApostrofos((x ?? '').toString()).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Nombres de pila frecuentes (normalizados): nunca cuentan solos como apellido para cruzar a un cliente. */
export const NOMBRES_DE_PILA: ReadonlySet<string> = new Set(`
  maria jose josefina laura paula paola ana juan pablo carlos jorge luis lucia lucas luciana andrea andres alejandra alejandro
  daniel daniela gabriel gabriela natalia carolina sofia sofi marcela marcelo martin martina javier diego fernando fernanda florencia
  flor agustin agustina sebastian nicolas cecilia veronica silvina claudia claudio mariana mariano marina romina valeria victoria
  elizabeth eugenia cristina cristian lorena gisela julieta yanina ignacio matias federico francisco gustavo ricardo roberto miguel
  manuel antonio eduardo sergio mauricio mauro leandro noemi beatriz susana patricia monica silvia graciela adriana rodolfo alfredo
  alberto gonzalo santiago tomas emiliano facundo ezequiel exequiel hernan marcos carmen leticia dario constanza soledad mercedes
  elena julio cesar oscar hector enrique guillermo horacio ariel marta liliana viviana sandra alicia belen camila micaela melina
  vanesa vanina noelia pamela rosario sabrina tamara celeste milagros guadalupe magdalena macarena emilia emilio esteban franco
  german gaston joaquin julian leonardo maximiliano octavio patricio ramiro rodrigo valentin valentina victor teresa teresita rocio
  ines pilar raquel irene lujan dolores isabel paz angel raul ramon hugo pedro ruben adrian benjamin bruno damian emanuel yamila
  ernesto geraldina geraldine daiana lourdes antonia rosa
`.trim().split(/\s+/))

/** ¿Sirve como apellido para cruzar? Ni nombre de pila ni la primera palabra del nombre (que casi siempre es un nombre). */
export const esApellidoDe = (palabra: string, nombreCompleto: string): boolean =>
  !NOMBRES_DE_PILA.has(palabra) && normNombre(nombreCompleto).split(' ')[0] !== palabra
