// Configuración exclusivamente sintética para ejecutar la regresión sin red.
// Nunca se importa desde la app ni desde comandos operativos.
if (process.env.HUB_PRUEBAS_SIN_RED !== '1') throw new Error('fixtures-entorno requiere HUB_PRUEBAS_SIN_RED=1')
const fetchLocal = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (entrada, opciones) => {
  const url = new URL(typeof entrada === 'string' || entrada instanceof URL ? entrada : entrada.url)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Red externa bloqueada: entorno de fixtures')
  return fetchLocal(entrada, opciones)
}
const fixture = {
  BOT_BIENVENIDA_FIRMA: 'Operaciones QA',
  NEXT_PUBLIC_2CHAT_ESPACIO: 'STE00000000-0000-4000-8000-000000000001',
  NEXT_PUBLIC_2CHAT_NUMEROS_JSON: JSON.stringify(Object.fromEntries([1,2,3,4,5].map(n => [`Closer ${n}`, `WAN00000000-0000-4000-8000-${String(n).padStart(12,'0')}`]))),
  DRIVE_CARPETA_CLIENTES: 'fixture-google-id-000000000000000000000013',
  DRIVE_CARPETA_COMPROBANTES: 'fixture-google-id-000000000000000000000018',
  SHEET_ID_VENTAS_ORIGINAL: 'fixture-google-id-000000000000000000000016',
  SHEET_ID_GUIONES: 'fixture-sheet-guiones-00000000000001',
  PANDADOC_PLANTILLA_NORMAL: 'plantilla-ficticia-normal',
  PANDADOC_PLANTILLA_GARANTIA: 'plantilla-ficticia-garantia',
  CONTRATO_DIRECCION_ARGENTINA: 'Calle Ficticia 123, Ciudad Ejemplo, Provincia Ejemplo',
  KICKOFF_EQUIPO_GERO_A_EMAIL: 'grabador.a@example.test',
  KICKOFF_EQUIPO_VALENTINO_EMAIL: 'grabador.b@example.test',
  KICKOFF_EQUIPO_GERO_A_NOMBRES: 'geronimo,gero',
  KICKOFF_EQUIPO_GERO_A_APELLIDOS: 'ficticioa',
  KICKOFF_EQUIPO_VALENTINO_NOMBRES: 'valentino',
  KICKOFF_EQUIPO_VALENTINO_APELLIDOS: 'ficticiob,secundariob',
}
for (const [k,v] of Object.entries(fixture)) process.env[k] = v
