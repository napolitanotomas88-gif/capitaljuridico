import { cache, Suspense } from 'react'
import { Bloque } from '@/components/ui'
import { conCache } from '@/lib/anuncios/cache'
import type { Sesion } from '@/lib/auth/sesion'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import { aListado, sinRespuestaDelMes, type FiltrosListado } from '@/lib/clientes/listado'
import { marcaDe, marcasBackend } from '@/lib/clientes/marcasBackend'
import { panelesDeTodos } from '@/lib/clientes/panelReferidos'
import { carpetasDrive } from '@/lib/clientes/drive'
import { hitosDelCliente, type Hito, type HitoManual } from '@/lib/clientes/hitos'
import { leerAnotaciones, type EtapaManual } from '@/lib/clientes/hitosRegistro'
import { claveNombre, clientesTrabados, crearCruceCarpetas, crearCruceClickUp } from '@/lib/clientes/prioridad'
import { tareasClickUp } from '@/lib/clientes/produccion'
import { PUNTAJE_CONTENTO, ubicarCliente, type FilaRecorrido, type FuentesCliente } from '@/lib/clientes/recorrido'
import { extenderDemo } from '@/lib/clientes/recorridoDemo'
import { campanasMetaCartera, exitosDelBot, leerDespachoRecorrido } from '@/lib/clientes/recorridoFuentes'
import type { VistaCRM } from '@/lib/clientes/vista'
import { leerSeguimiento, leerTypeform } from '@/lib/seguimiento/hojas'
import { ESTADO_VACIO, estadoPorCliente } from '@/lib/seguimiento/modelo'
import type { ResultadoTypeform } from '@/lib/seguimiento/typeform'
import { DetalleCliente } from './DetalleCliente'
import { EstadoTypeform } from './EstadoTypeform'
import { Esqueleto, LineaTiempo } from './LineaTiempo'
import { LimiteError } from './LimiteError'
import { ListaClientes } from './ListaClientes'

// Lo de la cartera que depende de fuentes de afuera (Seguimiento, Typeform, ClickUp, Meta y el Despacho), separado de la
// página (optimización 25/10/2026): la página muestra al toque el título y las cifras del CRM, y la línea de tiempo y la
// lista llegan por streaming, cada una con su esqueleto, apenas están las fuentes. Si Meta está fría (hasta 4 s después de
// un deploy), ya no deja la pantalla en blanco. armarCartera se cachea por pedido (React cache): las dos partes comparten
// UNA sola lectura de cada fuente.

const armarCartera = cache(async (vista: VistaCRM) => {
  const { datos } = vista
  const agencia = datos.clientes.filter(c => c.linea === 'agencia' && c.id)
  // En paralelo y sin frenar: si alguna fuente falla, la página sigue sin ese dato. Con ?demo=1 no se consulta nada de afuera.
  const [seguimiento, lecturaTypeform, clickup, meta, despacho, drive, anotaciones, exitoBotDe] = await Promise.all([
    // Si la planilla falla no es "la pestaña no existe": sale sin puntajes y sin ese aviso
    vista.esDemo ? { puntajes: [], ausente: false } : leerSeguimiento().catch(() => ({ puntajes: [], ausente: false })),
    // Con caché de 5 min: abrir y cerrar la tarjeta de un cliente (?cliente=) vuelve a armar la página y no debe leer la planilla cada vez
    vista.esDemo ? { r: null, error: false } : conCache('typeform-cartera-v1', 300, () => leerTypeform(agencia.map(c => ({ id: c.id, nombre: c.nombre, mail: c.mail, celular: c.celular }))))
      .then((c): { r: ResultadoTypeform | null; error: boolean } => ({ r: c.data, error: false }), () => ({ r: null, error: true })),
    vista.esDemo ? { tareas: [], aviso: null } : tareasClickUp(),
    vista.esDemo ? { porCliente: new Map(), aviso: null } : campanasMetaCartera(),
    vista.esDemo ? null : leerDespachoRecorrido(),
    // Drive: el doc de guiones y las carpetas de crudos y editados (caché de 30 min; no se espera más de 3 s)
    vista.esDemo ? { carpetas: [], aviso: null } : carpetasDrive(3_000),
    // Lo anotado a mano (hitos de cj_hitos y etapas de cj_etapas_manual). Si no se puede leer, se avisa arriba: la cartera
    // sale con lo automático y lo anotado no "desaparece" en silencio
    vista.esDemo ? { hitos: new Map<string, HitoManual[]>(), etapas: new Map<string, EtapaManual>(), falla: false } : leerAnotaciones().then(r => ({ ...r, falla: false }), e => {
      console.error('[cartera] anotaciones:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
      return { hitos: new Map<string, HitoManual[]>(), etapas: new Map<string, EtapaManual>(), falla: true }
    }),
    // El OK del bot de Éxito (cj_exito_pedidos, de CONSULTOR): sin tabla todavía, ninguno
    vista.esDemo ? (() => null) : exitosDelBot(),
  ])
  const { r: typeform, error: errorTypeform } = lecturaTypeform
  const estados = estadoPorCliente([...seguimiento.puntajes, ...(typeform?.puntajes ?? [])], datos.hoy)
  const tareaDe = crearCruceClickUp(clickup.tareas)
  const campanaDe = (n: string) => meta.porCliente.get(claveNombre(n)) ?? null
  const carpetaDe = crearCruceCarpetas(drive.carpetas, x => x.nombre, agencia.map(c => c.nombre))

  // ── Línea de tiempo: cada cliente de Agencia en su etapa (regla en lib/clientes/recorrido.ts; ?demo=1 → recorridoDemo.ts) ──
  const demoRecorrido = vista.esDemo ? extenderDemo(datos) : null
  const vistaRecorrido = demoRecorrido ? { ...vista, datos: demoRecorrido.datos } : vista
  const lecturas = vista.esDemo ? { meta: true, despacho: true, clickup: true } : { meta: meta.porCliente.size > 0 || !meta.aviso, despacho: !!despacho?.ok, clickup: clickup.tareas.length > 0 }
  const hitosPorId = new Map<string, Hito[]>()
  const filasRecorrido: FilaRecorrido[] = vistaRecorrido.datos.clientes
    .filter(c => c.linea === 'agencia' && c.id && !c.esNoCliente)
    .map(c => {
      const e = estados.get(c.id)?.ultimo
      const k = despacho?.kickoffDe(c.id, c.nombre) ?? null
      const m = campanaDe(c.nombre)
      const t = tareaDe(c.nombre)
      const tanda = despacho?.tandaDe(c.id) ?? null
      const videos = despacho?.videosDe(c.id) ?? null
      const carpeta = carpetaDe(c.nombre)
      const base: FuentesCliente = demoRecorrido?.fuentes.get(c.id) ?? {
        kickoff: k && { fecha: k.fecha, frenos: k.frenos, ideas: k.ideas },
        tanda, videos,
        meta: m && { activa: m.activa, ultimoLanzamiento: m.ultimoLanzamiento, semaforo: m.semaforo },
        clickup: t && { estado: t.estado, actualizada: t.actualizada },
        puntaje: e ? { valor: e.valor, dia: e.dia } : null,
      }
      // El registro de hitos: lo que dicen todas las fuentes + lo anotado a mano (lib/clientes/hitos.ts)
      const hitos = hitosDelCliente({
        dia1: c.dia1, renovo: c.renovo, inicioPeriodo2: c.periodos.find(p => p.periodo === 1)?.dia1 ?? null,
        kickoff: base.kickoff?.fecha ?? null,
        tanda: base.tanda ? { creado: base.tanda.creado ?? null, estado: base.tanda.estado, aprobada: base.tanda.aprobada ?? null, enviada: base.tanda.enviada ?? null, notaCliente: base.tanda.notaCliente ?? null } : null,
        videos: base.videos ? { crudos: base.videos.crudoRecibido ?? null, editados: base.videos.editado ?? null } : null,
        drive: carpeta ? { guion: carpeta.guion?.modificado ?? null, guionCreado: carpeta.guion?.creado ?? null, crudos: carpeta.crudos?.cantidad ? carpeta.crudos.primero ?? carpeta.crudos.ultimo : null, editados: carpeta.editados?.cantidad ? carpeta.editados.primero ?? carpeta.editados.ultimo : null } : null,
        clickupGuiones: t?.guionesHechos.slice().sort()[0] ?? null,
        lanzamiento: m?.primerLanzamiento ?? base.meta?.ultimoLanzamiento ?? null,
        campanaActiva: !!base.meta?.activa,
        // Éxito por puntaje: el PRIMER 8 o más (con la promesa no incumplida)
        exito: /^no\b/i.test(c.promesa.trim()) ? null : (estados.get(c.id)?.historial ?? []).filter(p => p.valor >= PUNTAJE_CONTENTO).map(p => p.dia).sort()[0] ?? null,
        exitoBot: exitoBotDe(c.id, c.nombre),
        manuales: anotaciones.hitos.get(c.id.toUpperCase()) ?? [],
      })
      hitosPorId.set(c.id, hitos)
      return { id: c.id, clave: `${c.id}-${c.fila}`, nombre: c.nombre, closer: c.closer, ...ubicarCliente(c, { ...base, hitos, etapaManual: anotaciones.etapas.get(c.id.toUpperCase()) ?? null }, datos.hoy, lecturas) }
    })
  // IDs repetidos en el CRM (la planilla los admite): se avisan para corregirlos; las tarjetas usan una clave por fila
  const vistos = new Map<string, number>()
  for (const f of filasRecorrido) vistos.set(f.id.toUpperCase(), (vistos.get(f.id.toUpperCase()) ?? 0) + 1)
  const repetidos = [...vistos].filter(([, n]) => n > 1).map(([id]) => id)
  const avisoRepetidos = repetidos.length ? `IDs repetidos en el CRM: ${repetidos.join(', ')}. Corregilos en la planilla: la tarjeta abre la primera fila de cada uno.` : null
  const avisoAnotaciones = anotaciones.falla ? 'No se pudo leer lo anotado a mano (hitos y etapas corregidas): se muestra lo automático. Recargá en un minuto.' : null
  const avisosRecorrido = vista.esDemo ? [] : [meta.aviso, despacho?.aviso, clickup.aviso, drive.aviso, avisoAnotaciones, avisoRepetidos].filter((a): a is string => !!a)

  // ── Lista de clientes ──
  // Sin la pestaña Referidos no hay nada que contar: las columnas del panel muestran "—" (no ceros que parezcan datos)
  const paneles = datos.pestanasAusentes.includes('Referidos') ? new Map() : panelesDeTodos(datos, vista.creditos, datos.reglas)
  const trabados = clickup.tareas.length ? clientesTrabados(agencia.map(c => ({ id: c.id, nombre: c.nombre, closer: c.closer, estado: c.estado })), tareaDe, campanaDe, datos.hoy) : []
  const idsTrabados = new Set(trabados.map(t => t.idCliente))
  // Lo que mostraba Backend (retirado el 10/10/2026), calculado en vivo con sus mismas reglas (la API usa la misma función)
  const marcas = marcasBackend(datos.hoy, datos.clientes)
  const filas = datos.clientes.map((c, i) => {
    const e = estados.get(c.id) ?? ESTADO_VACIO
    return aListado(c, i, vista.creditos.get(c.id), paneles.get(c.id), {
      puntaje: e.ultimo ? { valor: e.ultimo.valor, tendencia: e.tendencia, fuente: e.ultimo.fuente, dia: e.ultimo.dia } : null,
      // Solo Agencia y solo con el Typeform conectado (la regla y su test están en lib/clientes/listado.ts)
      sinRespuestaMes: sinRespuestaDelMes(c, e, datos.hoy, !!typeform),
      sinCampana: idsTrabados.has(c.id),
      backend: marcaDe(marcas, c),
    })
  })
  return { seguimiento, typeform, errorTypeform, campanaDe, despacho, demoRecorrido, vistaRecorrido, filasRecorrido, avisosRecorrido, filas, hitosPorId }
})

/** La línea de tiempo y, si la URL trae ?cliente=<ID>, la tarjeta abierta de ese cliente. */
export async function RecorridoEnVivo({ vista, pedido, sesion, accion }: { vista: VistaCRM; pedido: string | null; sesion: Sesion; accion?: string }) {
  const c = await armarSinCaer(vista)
  if (!c) return <FallaBloque titulo="Recorrido" />
  const id = pedido?.toUpperCase() ?? null
  const valido = !!id && ID_CLIENTE_VALIDO.test(id)
  const fila = valido ? c.filasRecorrido.find(f => f.id === id) ?? null : null
  // ?cliente= que no abre nada (ID mal escrito, de Consultora, finalizado sin cobro o inexistente): se avisa en vez de no mostrar nada
  const avisoCliente = id && !fila
    ? { texto: valido ? `El cliente ${id} no está en la línea de tiempo (puede ser de Consultora, no contar como cliente o no existir).` : `«${pedido}» no es un ID de cliente válido.`, href: valido ? `/clientes/${encodeURIComponent(id)}${vista.esDemo ? '?demo=1' : ''}` : null }
    : null
  return (
    <LineaTiempo
      filas={c.filasRecorrido}
      abierto={fila?.id ?? null}
      avisos={c.avisosRecorrido}
      avisoCliente={avisoCliente}
      detalle={fila && (
        <LimiteError key={fila.id}>
        <Suspense fallback={<Esqueleto />}>
          <DetalleCliente
            vista={c.vistaRecorrido}
            fila={fila}
            quien={sesion}
            meta={c.demoRecorrido ? metaDemo(c.demoRecorrido.fuentes.get(fila.id)?.meta ?? null) : c.campanaDe(fila.nombre)}
            kickoff={c.despacho?.kickoffDe(fila.id, fila.nombre)?.tarjeta ?? null}
            hitos={c.hitosPorId.get(fila.id) ?? []}
            demo={vista.esDemo}
            accionInicial={accion}
          />
        </Suspense>
        </LimiteError>
      )}
    />
  )
}

/** El estado del Typeform y la lista de clientes con sus filtros. */
export async function ListaEnVivo({ vista, filtros, noClientes, verCobros }: { vista: VistaCRM; filtros: FiltrosListado; noClientes: number; verCobros: boolean }) {
  const c = await armarSinCaer(vista)
  if (!c) return <FallaBloque titulo="Clientes" />
  const { datos } = vista
  const creditosDisponibles = !datos.pestanasAusentes.includes('Referidos') && !datos.pestanasAusentes.includes('Créditos')
  return (
    <>
      <EstadoTypeform resultado={c.typeform} error={c.errorTypeform} />
      {c.seguimiento.ausente && <p className="cj-etiqueta">Los puntajes se guardan en la pestaña “Seguimiento” del CRM: se crea sola con el primer puntaje.</p>}
      <Bloque titulo="Clientes" id="lista-clientes">
        {/* Sin Finanzas los montos ni siquiera llegan al navegador */}
        <ListaClientes filas={verCobros ? c.filas : c.filas.map(f => ({ ...f, contratado: null, cobrado: null, saldo: null, cobrosAviso: null }))} verCobros={verCobros} iniciales={filtros} noClientes={noClientes} creditosDisponibles={creditosDisponibles} />
      </Bloque>
    </>
  )
}

/** Mientras llegan las fuentes: el lugar de la línea de tiempo o de la lista, sin saltos (misma altura aproximada). */
export function EsperaBloque({ titulo, alto }: { titulo: string; alto: number }) {
  return (
    <section className="cj-panel rc-espera" style={{ minHeight: alto }} aria-busy="true">
      <p className="cj-etiqueta cj-etiqueta--laton">{titulo}</p>
      <Esqueleto etiqueta={`Cargando ${titulo.toLowerCase()}`} />
    </section>
  )
}

// Las fuentes ya fallan solas; esto ataja un error al armar (un dato con forma inesperada) para que no se caiga la página
// entera con el título y las cifras que ya se mostraron: el bloque avisa y el resto sigue.
async function armarSinCaer(vista: VistaCRM) {
  try { return await armarCartera(vista) } catch (e) {
    console.error('[cartera] no se pudo armar:', String((e as Error)?.message ?? e).slice(0, 200))
    return null
  }
}
function FallaBloque({ titulo }: { titulo: string }) {
  return (
    <section className="cj-panel">
      <p className="cj-etiqueta cj-etiqueta--laton">{titulo}</p>
      <p className="cj-aviso" role="alert">No se pudo armar este bloque. Recargá la página en un minuto; si sigue, avisá.</p>
    </section>
  )
}

// ?demo=1: la campaña ficticia de recorridoDemo.ts con la forma que lee la tarjeta
const metaDemo = (m: FuentesCliente['meta']) => (m ? { ...m, lanzamientoAprox: false, aGrabar: null } : null)
