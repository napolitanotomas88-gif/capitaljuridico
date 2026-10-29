import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { rolPuedeCanjear, validarCanje, decidirCanje, estadoEscrituraCanje } from '@/lib/clientes/canje'
import { registrarCanje, planillaLibroReal, type EstadoLibro, type ResultadoCanje } from '@/lib/clientes/escribirCanje'
import { reservasCanjeDesdeEntorno } from '@/lib/clientes/reservasCanje'
import { entornoActual } from '@/lib/clientes/escribirReferido'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { demoPermitido } from '@/lib/clientes/demo'
import { cargarVista } from '@/lib/clientes/vista'
import { leerClientes } from '@/lib/clientes/leer'
import { calcularCreditosDeDatos } from '@/lib/clientes/programa'
import { invalidarSnapshot } from '@/lib/clientes/snapshot'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { REGLAS_REFERIDOS } from '@/lib/clientes/reglasReferidos'

// POST /api/referidos/canje — canje de créditos contra la renovación (meses y USD por separado).
// Solo roles que ven Referidos (socio y csm), con sesión de Google, mismo origen, JSON.
//   · Sin CRM_ESCRITURA_CANJE=real (o con ?demo): SIMULACIÓN. Calcula el movimiento que se asentaría en el libro "Créditos" y no escribe nada.
//   · { vistaPrevia: true }: siempre simula (es el paso "revisar" de la pantalla antes de "Confirmar canje"); con escritura real disponible lee
//     el CRM fresco y avisa con `escrituraReal: true` si quien pide puede confirmar.
//   · Con la bandera y sin Postgres (DATABASE_URL + REFERIDOS_HMAC_SECRET): 503, escritura bloqueada.
//   · Con la bandera y con Postgres: ESCRITURA REAL vía registrarCanje (reserva durable en canjes_reservas → fila en el libro → confirmación),
//     solo para Tomás, Gero A, Gero M y Aylu (por mail, acciones/permisos.ts). Conectado con el OK de Tomás (27/10/2026). La migración 002
//     tiene que estar corrida: si no, la reserva falla y se responde 503 sin tocar el libro. Nunca responde "guardado" sin escribir.
export const dynamic = 'force-dynamic'

const CABECERAS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const responder = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS })

/** Lectura FRESCA del CRM (salta el snapshot de 10 min) + el mismo cálculo de créditos que usan las pantallas. */
async function leerEstadoFresco(idCliente: string): Promise<Pick<EstadoLibro, 'clienteExiste' | 'resumen'>> {
  const datos = await leerClientes({ forzar: true })
  // Con plata en juego no se decide sobre datos guardados de una lectura que falló: mejor "no disponible" que un saldo viejo.
  if (datos.fuente === 'snapshot_viejo') throw new Error('Sheets no respondió: solo hay datos guardados')
  const id = idCliente.toUpperCase()
  return { clienteExiste: datos.clientes.some(c => c.id.toUpperCase() === id), resumen: calcularCreditosDeDatos(datos).get(id) }
}

/** Código HTTP de cada resultado del escritor */
function statusDe(r: ResultadoCanje): number {
  if (r.ok) return r.estado === 'guardado' ? 201 : 200
  switch (r.codigo) {
    case 'pendiente_confirmacion': return 202
    case 'validacion': return 422
    case 'sin_actor': case 'sin_permiso': case 'sin_permiso_planilla': return 403
    case 'rechazado': case 'clave_reutilizada': case 'conflicto_ciclo': return 409
    case 'escritura_bloqueada': case 'planilla_no_disponible': return 503
  }
}

export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'referidos') // 401 sin sesión, 403 sin permiso (segunda barrera, además del proxy)
  if (rechazo) return rechazo
  const sesion = sesionDePeticion(req.headers)
  if (!sesion || !rolPuedeCanjear(sesion.rol)) return responder({ error: 'Tu rol no puede canjear créditos.' }, 403)

  const origen = req.headers.get('origin')
  let mismoOrigen = false
  try {
    mismoOrigen = !!origen && new URL(origen).host === req.headers.get('host')
  } catch {
    mismoOrigen = false
  }
  if (!mismoOrigen) return responder({ error: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return responder({ error: 'Se espera JSON.' }, 415)

  let cuerpo: Record<string, unknown>
  try {
    const texto = await req.text()
    if (texto.length > 4000) return responder({ error: 'El pedido es demasiado grande.' }, 413)
    const j: unknown = JSON.parse(texto)
    if (!j || typeof j !== 'object' || Array.isArray(j)) return responder({ error: 'JSON inválido.' }, 400)
    cuerpo = j as Record<string, unknown>
  } catch {
    return responder({ error: 'JSON inválido.' }, 400)
  }

  const demo = cuerpo.demo === true && demoPermitido()
  const bandera = process.env.CRM_ESCRITURA_CANJE === 'real' && !demo // un cliente de ejemplo nunca se escribe
  const reservas = bandera ? reservasCanjeDesdeEntorno(process.env, entornoActual()) : null
  const modo = estadoEscrituraCanje(bandera, reservas !== null)
  const vistaPrevia = cuerpo.vistaPrevia === true

  // ── Escritura real ──
  if (modo.modo === 'real' && reservas && !vistaPrevia) {
    if (!puedeHacerAcciones(sesion.email)) return responder({ ok: false, codigo: 'sin_permiso', mensaje: 'Solo Tomás, Gero A, Gero M y Aylu pueden canjear créditos.' }, 403)
    let planilla
    try {
      planilla = planillaLibroReal(leerEstadoFresco)
    } catch {
      return responder({ ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo conectar con la planilla del CRM. No se guardó nada.' }, 503)
    }
    const r = await registrarCanje(cuerpo as never, sesion.email ?? '', { planilla, bandera: true, reservas, rol: sesion.rol, hoy: hoyArgentina() })
    // Guardado, o pendiente (la escritura pudo llegar): la próxima carga de la ficha vuelve a leer el CRM
    if ((r.ok && r.estado === 'guardado') || (!r.ok && r.codigo === 'pendiente_confirmacion')) invalidarSnapshot()
    return responder(r, statusDe(r))
  }

  // ── Simulación (o bloqueada: se informa el saldo igual) ──
  let vista
  try {
    if (modo.modo === 'real') {
      // Vista previa de un canje que se va a escribir: lectura fresca, para que lo que se confirma sea lo mismo que se asienta
      const datos = await leerClientes({ forzar: true })
      if (datos.fuente === 'snapshot_viejo') throw new Error('datos guardados')
      vista = { datos, creditos: calcularCreditosDeDatos(datos), esDemo: false }
    } else vista = await cargarVista(demo)
  } catch {
    return responder({ ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo leer el CRM. No se calculó nada.' }, 503)
  }
  const reglas = vista.datos.reglas ?? REGLAS_REFERIDOS
  const v = validarCanje(cuerpo as never, vista.datos.hoy, reglas)
  if (!v.ok) return responder({ ok: false, codigo: 'validacion', errores: v.errores }, 422)

  const existe = vista.datos.clientes.some(c => c.id.toUpperCase() === v.canje.idCliente)
  const decision = existe
    ? decidirCanje(v.canje, vista.creditos.get(v.canje.idCliente), sesion.email ?? '', reglas)
    : ({ tipo: 'rechazado', codigo: 'cliente_inexistente', mensaje: 'Ese cliente no existe en el CRM.' } as const)
  if (decision.tipo === 'rechazado') return responder({ ok: false, codigo: 'rechazado', motivo: decision.codigo, mensaje: decision.mensaje }, 409)

  if (modo.modo === 'bloqueada') return responder({ ok: false, codigo: 'escritura_bloqueada', motivo: modo.codigo, mensaje: modo.motivo, saldo: decision.saldo }, 503)
  const escrituraReal = modo.modo === 'real' && puedeHacerAcciones(sesion.email)
  const mensaje = modo.modo !== 'real' ? modo.motivo
    : escrituraReal ? 'Vista previa: todavía no se guardó nada. Revisá los montos y confirmá para asentarlo en el libro "Créditos".'
    : 'Vista previa: solo Tomás, Gero A, Gero M y Aylu pueden confirmar un canje. No se guardó nada.'
  return responder({
    ok: true, estado: 'simulado', mensaje, esDemo: vista.esDemo, escrituraReal,
    saldo: decision.saldo, referenciaMeses: decision.referenciaMeses, movimiento: decision.movimiento, politicaSaldo: decision.politicaSaldo, huella: decision.huella, avisos: decision.avisos,
  }, 200)
}
