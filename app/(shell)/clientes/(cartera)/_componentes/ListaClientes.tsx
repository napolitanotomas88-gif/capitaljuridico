'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Monto } from '@/components/clientes/Monto'
import { PuntajeRapido } from '@/components/clientes/PuntajeRapido'
import { Boton, CampoBusqueda, ChipFiltro, ChipSemaforo, Tabla, Vacio, type Columna } from '@/components/ui'
import { ETIQUETA_ESTADO, fechaCorta, numeroAR, textoDias } from '@/lib/clientes/formato'
import {
  FILTROS_INICIALES, ESTADOS_FILTRO, ORDENES, SEMAFOROS_FILTRO, cambioDeLinea, filtrarListado, filtrosAParams, hayParams, closersDe, ordenarListado, soloRenovacion, textoCredito, textoMostrar, textoReferidos, textoUsadosPendientes, textoIntentos,
  type ClienteListado, type EstadoFiltro, type FiltrosListado, type Orden, type SemaforoFiltro,
} from '@/lib/clientes/listado'

// Lista de clientes con filtros por chips, búsqueda por nombre y orden. Filtra en el navegador sobre las filas
// que ya mandó el servidor (cero lecturas a Sheets al filtrar) y deja los filtros en la URL para poder compartirla.
// En escritorio es una tabla densa; en móvil, tarjetas apiladas con los mismos datos.

const ETIQUETA_ESTADO_FILTRO: Record<EstadoFiltro, string> = { actuales: 'Clientes actuales', todos: 'Todos (también finalizados)', ACTIVO: 'Activo', PAUSADO: 'Pausado', FINALIZADO: 'Finalizado', INACTIVO: 'Inactivo', '': 'Sin estado' }
const ETIQUETA_SEMAFORO_FILTRO: Record<SemaforoFiltro, string> = { todos: 'Todos', verde: 'Al día', amarillo: 'Por vencer', rojo: 'Vencido', gris: 'Sin fecha' }
const ETIQUETA_ORDEN: Record<Orden, string> = { vencimiento: 'Vencimiento', nombre: 'Nombre', id: 'ID', cobrado: 'Cobrado' }

type Props = {
  filas: ClienteListado[]
  iniciales: FiltrosListado
  /** Cuántas filas de Agencia no cuentan como clientes (se ofrecen con un chip) */
  noClientes: number
  /** false = todavía no existen las pestañas de referidos/créditos: la columna lo aclara */
  creditosDisponibles: boolean
  /** false = sin la sección Finanzas: sin la columna de cobros ni el orden por cobrado (los montos ya vienen vacíos) */
  verCobros?: boolean
}

// Los chips de "Mostrar" con número (sin campaña, renovación, sin respuesta) solo existen en Agencia: se cuentan ahí
const contar = (filas: ClienteListado[], p: (f: ClienteListado) => boolean) => filas.filter(f => f.linea === 'agencia' && !f.noCliente && p(f)).length
// Al PRENDER un chip de vencimiento se ordena por vencimiento; al apagarlo se respeta el orden que se haya elegido
const ordenAlPrender = (prende: boolean): Partial<FiltrosListado> => (prende ? { orden: 'vencimiento' } : {})

function Grupo({ etiqueta, className, children }: { etiqueta: string; className?: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className={className ? `cj-grupo ${className}` : 'cj-grupo'} role="group" aria-labelledby={id}>
      <span id={id} className="cj-etiqueta">
        {etiqueta}
      </span>
      <div className="cj-fila">{children}</div>
    </div>
  )
}

const POR_PAGINA = 40
const diasTexto = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`
/** "Renovación · vence en 12 días" / "vence hoy" / "venció hace 5 días" */
export const textoRenovacion = (dias: number) =>
  `Renovación · ${dias > 0 ? `vence en ${diasTexto(dias)}` : dias === 0 ? 'vence hoy' : `venció hace ${diasTexto(-dias)}`}`

// Lo que antes mostraba Backend (retirado el 10/10/2026): renovación pendiente y llamada de proyección, con el texto de
// "Llamada agendada" del CRM abajo (ahí suelen estar las decisiones, p. ej. "no renueva")
const tieneMarcas = (f: ClienteListado) => !!f.backend && (f.backend.renovacionDias !== null || f.backend.proyeccion)
const tieneNota = (f: ClienteListado) => tieneMarcas(f) && !!f.backend?.notaCrm

// id = las insignias (van en el nombre accesible de la tarjeta); idNota = "Llamada agendada" (va en la descripción)
function MarcasBackend({ f, id, idNota }: { f: ClienteListado; id?: string; idNota?: string }) {
  const b = f.backend
  if (!b || !tieneMarcas(f)) return null
  return (
    <span className="cl-marcas">
      <span id={id} className="bk-insignias" style={{ marginTop: 6, whiteSpace: 'nowrap' }}>
        {b.renovacionDias !== null && (
          <span className={`bk-insignia ${b.renovacionDias < 0 ? 'bk-insignia--rojo' : 'bk-insignia--ambar'}`}>{textoRenovacion(b.renovacionDias)}</span>
        )}
        {b.proyeccion && <span className="bk-insignia bk-insignia--verde">Proyección pendiente</span>}
      </span>
      {b.notaCrm && <span id={idNota} className="cj-sub">Llamada agendada: {b.notaCrm}</span>}
    </span>
  )
}

// Fin del período con cuántos días faltan (solo para los activos: en los que ya terminaron no aporta)
function FinPeriodo({ f }: { f: ClienteListado }) {
  if (!f.fin) return <>—</>
  return (
    <>
      <span className="cj-num">{fechaCorta(f.fin)}</span>
      {f.estado === 'ACTIVO' && f.dias !== null && <span className="cj-sub">{textoDias(f.dias)}</span>}
    </>
  )
}

function Cobrado({ f }: { f: ClienteListado }) {
  if (f.cobrado === null && f.contratado === null) return <>{f.cobrosAviso ? <span className="cj-sub" title={f.cobrosAviso}>Cobros por verificar</span> : '—'}</>
  return (
    <>
      <span className="cj-num">
        <Monto>{f.cobrado === null ? '—' : numeroAR(f.cobrado)} / {f.contratado === null ? '—' : numeroAR(f.contratado)}</Monto>
      </span>
      {f.saldo !== null && <span className="cj-sub">saldo <Monto>{numeroAR(f.saldo)}</Monto></span>}
      {f.cobrosAviso && <span className="cj-sub" title={f.cobrosAviso}>Cobros por verificar</span>}
    </>
  )
}

const linkDe = (f: ClienteListado) => `/clientes/${encodeURIComponent(f.id)}`
// Tarjeta del celular: el nombre accesible es corto (nombre + insignias) y el resto va como descripción, en el orden en que
// se ve: ID y semáforo, la nota "Llamada agendada" si hay, y los datos. Sin esto el lector solo anunciaba el nombre.
const nombreTarjeta = (f: ClienteListado) => (tieneMarcas(f) ? `cl-n-${f.clave} cl-m-${f.clave}` : `cl-n-${f.clave}`)
const descripcionTarjeta = (f: ClienteListado) => [`cl-c-${f.clave}`, ...(tieneNota(f) ? [`cl-a-${f.clave}`] : []), `cl-d-${f.clave}`].join(' ')

export function ListaClientes({ filas, iniciales, noClientes, creditosDisponibles, verCobros = true }: Props) {
  const [filtros, setFiltros] = useState<FiltrosListado>(iniciales)
  const refEstado = useRef<HTMLParagraphElement>(null)
  // Último control enfocado dentro de la lista (lo anota el onFocus del contenedor: en React burbujea)
  const ultimoFoco = useRef<Element | null>(null)
  // Último puntaje guardado desde la lista: si la fila sale del filtro, el aviso lo da el renglón de resultados
  const [guardado, setGuardado] = useState<{ id: string; nombre: string; mensaje: string } | null>(null)
  const [limite, setLimite] = useState(POR_PAGINA)
  // Los filtros que trae la URL del servidor cambian cuando se navega a /clientes?vencen=30 (las cifras de arriba) o al abrir
  // una tarjeta (?cliente=, que conserva los filtros de la lista). Se aplican solo si son OTROS que los que ya se ven: abrir o
  // cerrar una tarjeta no reinicia la lista ni "Ver todos" (revisión del Hub, 26/10/2026; antes iba una key por filtros)
  const claveIniciales = filtrosAParams(iniciales).toString()
  const [inicialesVistas, setInicialesVistas] = useState(claveIniciales)
  if (claveIniciales !== inicialesVistas) {
    setInicialesVistas(claveIniciales)
    if (claveIniciales !== filtrosAParams(filtros).toString()) { setFiltros(iniciales); setLimite(POR_PAGINA) }
  }

  const cambiar = (parcial: Partial<FiltrosListado>) => {
    setGuardado(null)
    setLimite(POR_PAGINA)
    const siguiente = { ...filtros, ...parcial }
    setFiltros(siguiente)
    // Los filtros viajan en la URL (se puede compartir o recargar); replaceState no agrega pasos al historial
    const qs = filtrosAParams(siguiente).toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }

  const delTipo = useMemo(() => filas.filter(f => f.linea === filtros.linea && (filtros.conNoClientes || !f.noCliente)), [filas, filtros.linea, filtros.conNoClientes])
  const closers = useMemo(() => closersDe(delTipo), [delTipo])
  const visibles = useMemo(() => ordenarListado(filtrarListado(filas, filtros), filtros.orden), [filas, filtros])
  // Se dibujan de a POR_PAGINA (25/10/2026: con todas, la lista eran ~5.800 nodos entre la tabla y las tarjetas del celular
  // y trababa la página). Filtrar, buscar y contar sigue siendo sobre todas; "Ver los otros N" suma la página siguiente.
  const muestra = visibles.slice(0, limite)
  // Al sumar filas, el botón puede desaparecer: el foco va a la primera fila nueva (la de la vista que se ve: tabla o tarjetas)
  const verMas = (nuevo: number) => {
    const primera = muestra.length
    setLimite(nuevo)
    requestAnimationFrame(() => {
      const enlaces = [...document.querySelectorAll<HTMLElement>('#lista-clientes tbody tr, #lista-clientes .cj-tarjetas > li')]
        .filter(el => el.offsetParent !== null)
      enlaces[primera]?.querySelector<HTMLElement>('a, button')?.focus()
    })
  }
  // Si el control enfocado desaparece cuando cambian las filas, el foco caía en <body> y el lector de pantalla perdía la
  // posición: va al renglón de resultados (el conteo). Pasa con «Limpiar filtros», «Ver todos los clientes», un chip de
  // Mostrar que solo se ve prendido y también con la fila que se va al puntuarla con «Sin respuesta este mes» prendido (ahí
  // cambian las filas que manda el servidor, no los filtros). Si el foco ya está en otro lado, no se toca
  useEffect(() => {
    const t = ultimoFoco.current
    const a = document.activeElement
    if (t && !t.isConnected && (!a || a === document.body)) refEstado.current?.focus()
  }, [visibles])
  const sinCampana = useMemo(() => contar(filas, f => f.sinCampana), [filas])
  const sinRespuesta = useMemo(() => contar(filas, f => f.sinRespuestaMes), [filas])
  const renovacion = useMemo(() => contar(filas, f => f.backend?.renovacionDias != null), [filas])
  const hayFiltros = hayParams(filtrosAParams({ ...filtros, orden: FILTROS_INICIALES.orden }))
  const limpiar = () => cambiar({ ...FILTROS_INICIALES, orden: filtros.orden })
  const enAgencia = filtros.linea === 'agencia'
  const mostrando = textoMostrar(filtros)
  const avisoFuera = guardado && !visibles.some(f => f.id === guardado.id) ? `${guardado.mensaje} ${guardado.nombre} ya no aparece con estos filtros.` : null
  const anotar = (f: ClienteListado) => (mensaje: string) => setGuardado({ id: f.id, nombre: f.nombre, mensaje })

  const columnas: Columna<ClienteListado>[] = [
    { clave: 'id', titulo: 'ID', celda: f => f.id || '—' },
    {
      clave: 'nombre', titulo: 'Cliente', largo: true,
      celda: f => (
        <>
          {f.id ? (
            <Link href={linkDe(f)} prefetch={false} className="cj-enlace-fila">
              {f.nombre}
            </Link>
          ) : (
            <>
              {f.nombre}
              <span className="cj-sub">Sin ID en la planilla</span>
            </>
          )}
          {f.noCliente && <span className="cj-sub">No cuenta como cliente</span>}
          <MarcasBackend f={f} />
        </>
      ),
    },
    { clave: 'puntaje', titulo: 'Cómo le va (1-10)', celda: f => (f.id ? <PuntajeRapido idCliente={f.id} nombre={f.nombre} actual={f.puntaje} sinRespuesta={f.sinRespuestaMes} alGuardar={anotar(f)} /> : '—') },
    { clave: 'estado', titulo: 'Estado', celda: f => ETIQUETA_ESTADO[f.estado] },
    { clave: 'semaforo', titulo: 'Semáforo', celda: f => (f.semaforo ? <ChipSemaforo estado={f.semaforo} /> : <span className="cj-texto-2">—</span>) },
    { clave: 'closer', titulo: 'Closer', celda: f => f.closer || '—' },
    { clave: 'fin', titulo: 'Fin del período', celda: f => <FinPeriodo f={f} /> },
    ...(verCobros ? [{ clave: 'cobrado', titulo: 'Cobrado / contratado (USD)', numerica: true, celda: (f: ClienteListado) => <Cobrado f={f} /> }] : []),
    { clave: 'creditos', titulo: 'Créditos disponibles', celda: f => textoCredito(f.credito) },
    { clave: 'referidos', titulo: 'Referidos: presentó / asistieron / cerraron', celda: f => <span className="cj-num">{textoReferidos(f.panel)}</span> },
    { clave: 'usados', titulo: 'Créditos usados / por liberar', celda: f => textoUsadosPendientes(f.panel) },
    { clave: 'intentos', titulo: 'Intentos y premios únicos', celda: f => textoIntentos(f.panel) },
  ]

  if (filas.length === 0) return <Vacio frase="Todavía no hay clientes cargados en la planilla." />

  return (
    <div className="cj-pila cj-pila--chica" style={{ gap: 40 }} onFocus={e => { ultimoFoco.current = e.target }}>
      <div className="cj-filtros">
        <CampoBusqueda
          value={filtros.q}
          onChange={e => cambiar({ q: e.target.value })}
          placeholder="Buscar por nombre o ID"
          etiqueta="Buscar cliente por nombre o ID"
        />
        <div className="cj-grupos">
          <Grupo etiqueta="Estado">
            {ESTADOS_FILTRO.map(v => (
              <ChipFiltro key={v} activo={filtros.estado === v} onClick={() => cambiar({ estado: v })}>
                {ETIQUETA_ESTADO_FILTRO[v]}
              </ChipFiltro>
            ))}
          </Grupo>
          <Grupo etiqueta="Semáforo">
            {SEMAFOROS_FILTRO.map(v => (
              <ChipFiltro key={v} activo={filtros.semaforo === v} onClick={() => cambiar({ semaforo: v })}>
                {ETIQUETA_SEMAFORO_FILTRO[v]}
              </ChipFiltro>
            ))}
          </Grupo>
          <Grupo etiqueta="Closer">
            <ChipFiltro activo={filtros.closer === 'todos'} onClick={() => cambiar({ closer: 'todos' })}>
              Todos
            </ChipFiltro>
            {closers.map(c => (
              <ChipFiltro key={c.nombre} activo={filtros.closer === c.nombre} onClick={() => cambiar({ closer: c.nombre })}>
                {c.nombre}
              </ChipFiltro>
            ))}
          </Grupo>
          <Grupo etiqueta="Línea">
            <ChipFiltro activo={filtros.linea === 'agencia'} onClick={() => cambiar(cambioDeLinea('agencia'))}>
              Agencia
            </ChipFiltro>
            <ChipFiltro activo={filtros.linea === 'consultora'} onClick={() => cambiar(cambioDeLinea('consultora'))}>
              Consultora
            </ChipFiltro>
          </Grupo>
          {/* Primero la lista de trabajo de los CSM (renovación pendiente). En el celular este grupo se parte en varias filas
              en vez de desplazarse de costado, para que ningún chip quede fuera de la pantalla. Los chips que solo existen en
              Agencia se ven ahí; en Consultora solo si quedaron prendidos (por un enlace), para poder apagarlos. */}
          <Grupo etiqueta="Mostrar" className="cj-grupo--envuelve">
            {((enAgencia && renovacion > 0) || filtros.renovacion) && (
              <ChipFiltro activo={filtros.renovacion} onClick={() => cambiar({ renovacion: !filtros.renovacion, ...ordenAlPrender(!filtros.renovacion) })}>
                Renovación pendiente ({enAgencia ? renovacion : 0})
              </ChipFiltro>
            )}
            {((enAgencia && sinCampana > 0) || filtros.sinCampana) && (
              <ChipFiltro activo={filtros.sinCampana} onClick={() => cambiar({ sinCampana: !filtros.sinCampana })}>
                Prioridad: sin campaña ({enAgencia ? sinCampana : 0})
              </ChipFiltro>
            )}
            {((enAgencia && sinRespuesta > 0) || filtros.sinRespuesta) && (
              <ChipFiltro activo={filtros.sinRespuesta} onClick={() => cambiar({ sinRespuesta: !filtros.sinRespuesta })}>
                Sin respuesta este mes ({enAgencia ? sinRespuesta : 0})
              </ChipFiltro>
            )}
            <ChipFiltro activo={filtros.vencen === 30} onClick={() => cambiar({ vencen: filtros.vencen === 30 ? 0 : 30, ...ordenAlPrender(filtros.vencen !== 30) })}>
              Por vencer · 30 días
            </ChipFiltro>
            <ChipFiltro activo={filtros.vencen === 15} onClick={() => cambiar({ vencen: filtros.vencen === 15 ? 0 : 15, ...ordenAlPrender(filtros.vencen !== 15) })}>
              Por vencer · 15 días
            </ChipFiltro>
            {((enAgencia && noClientes > 0) || filtros.conNoClientes) && (
              <ChipFiltro activo={filtros.conNoClientes} onClick={() => cambiar({ conNoClientes: !filtros.conNoClientes, closer: 'todos' })}>
                Incluir no clientes ({enAgencia ? noClientes : 0})
              </ChipFiltro>
            )}
          </Grupo>
          <Grupo etiqueta="Orden">
            {ORDENES.filter(v => verCobros || v !== 'cobrado').map(v => (
              <ChipFiltro key={v} activo={filtros.orden === v} onClick={() => cambiar({ orden: v })}>
                {ETIQUETA_ORDEN[v]}
              </ChipFiltro>
            ))}
          </Grupo>
        </div>
      </div>

      {/* El conteo es la región viva (se anuncia al filtrar); "Limpiar filtros" queda al lado, afuera, siempre a mano */}
      <div className="cj-resultado">
        <div className="cj-fila">
          <p ref={refEstado} tabIndex={-1} className="cj-etiqueta" role="status" aria-atomic="true">
            {visibles.length} de {delTipo.length} {filtros.linea === 'consultora' ? 'clientes de Consultora' : 'clientes'}
            {mostrando.length > 0 && ` · ${mostrando.join(' · ')}`}
            {avisoFuera && <span className="cl-aviso">{avisoFuera}</span>}
          </p>
          {hayFiltros && visibles.length > 0 && (
            <Boton variante="secundario" onClick={limpiar}>
              Limpiar filtros
            </Boton>
          )}
        </div>
        {!creditosDisponibles && <span className="cj-etiqueta">Créditos: todavía no existen las pestañas Referidos y Créditos</span>}
      </div>

      {visibles.length === 0 ? (
        soloRenovacion(filtros) ? (
          // Lo que abre /backend (?renovacion=1): sin filas no es "ningún cliente coincide", es que no hay renovaciones (ventana de 45 días, lib/backend/calculo.ts)
          <Vacio
            frase="No hay renovaciones pendientes: nadie de Agencia vence en los próximos 45 días ni quedó vencido sin decisión."
            accion={
              <Boton variante="secundario" onClick={() => cambiar({ renovacion: false })}>
                Ver todos los clientes
              </Boton>
            }
          />
        ) : (
          <Vacio
            frase="Ningún cliente coincide con estos filtros."
            accion={
              hayFiltros ? (
                <Boton variante="secundario" onClick={limpiar}>
                  Limpiar filtros
                </Boton>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="cj-solo-escritorio">
            <Tabla descripcion="Clientes" columnas={columnas} filas={muestra} claveFila={f => f.clave} className="cj-tabla-compacta" />
          </div>
          <div className="cj-solo-movil">
            <ul className="cj-tarjetas" aria-label="Clientes">
              {muestra.map(f => {
                const cuerpo = (
                  <>
                    <div id={`cl-c-${f.clave}`} className="cj-tarjeta__cab">
                      <span className="cj-etiqueta">{f.id || 'Sin ID'}</span>
                      {f.semaforo && <ChipSemaforo estado={f.semaforo} />}
                    </div>
                    <p id={`cl-n-${f.clave}`} className="cj-tarjeta__nombre">{f.nombre}</p>
                    <MarcasBackend f={f} id={`cl-m-${f.clave}`} idNota={`cl-a-${f.clave}`} />
                    <dl id={`cl-d-${f.clave}`} className="cj-tarjeta__datos">
                      <div>
                        <dt className="cj-etiqueta">Estado</dt>
                        <dd>{ETIQUETA_ESTADO[f.estado]}</dd>
                      </div>
                      <div>
                        <dt className="cj-etiqueta">Closer</dt>
                        <dd>{f.closer || '—'}</dd>
                      </div>
                      <div>
                        <dt className="cj-etiqueta">Fin del período</dt>
                        <dd>
                          <FinPeriodo f={f} />
                        </dd>
                      </div>
                      {verCobros && (
                        <div>
                          <dt className="cj-etiqueta">Cobrado / contratado (USD)</dt>
                          <dd>
                            <Cobrado f={f} />
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt className="cj-etiqueta">Créditos disponibles</dt>
                        <dd>{textoCredito(f.credito)}</dd>
                      </div>
                      {f.panel && (
                        <>
                          <div>
                            <dt className="cj-etiqueta">Referidos (presentó / asistieron / cerraron)</dt>
                            <dd className="cj-num">{textoReferidos(f.panel)}</dd>
                          </div>
                          <div>
                            <dt className="cj-etiqueta">Créditos usados / por liberar</dt>
                            <dd>{textoUsadosPendientes(f.panel)}</dd>
                          </div>
                          <div>
                            <dt className="cj-etiqueta">Intentos y premios únicos</dt>
                            <dd>{textoIntentos(f.panel)}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                  </>
                )
                return (
                  <li key={f.clave} className="cj-tarjeta">
                    {f.id ? (
                      // Nombre accesible corto (nombre y, si tiene, la marca de renovación); los datos y la nota van en la descripción
                      <Link href={linkDe(f)} prefetch={false} className="cj-tarjeta__enlace" aria-labelledby={nombreTarjeta(f)} aria-describedby={descripcionTarjeta(f)}>
                        {cuerpo}
                      </Link>
                    ) : (
                      <div className="cj-tarjeta__enlace">{cuerpo}</div>
                    )}
                    {f.id && (
                      <div className="cj-tarjeta__puntaje">
                        <PuntajeRapido idCliente={f.id} nombre={f.nombre} actual={f.puntaje} sinRespuesta={f.sinRespuestaMes} alGuardar={anotar(f)} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
          {visibles.length > muestra.length && (
            <div className="cj-fila">
              <Boton variante="secundario" onClick={() => verMas(limite + POR_PAGINA)}>
                Ver los otros {Math.min(POR_PAGINA, visibles.length - muestra.length)}{visibles.length - muestra.length > POR_PAGINA ? ` (quedan ${visibles.length - muestra.length})` : ''}
              </Boton>
              <Boton variante="secundario" onClick={() => verMas(Infinity)}>Ver todos</Boton>
            </div>
          )}
        </>
      )}
    </div>
  )
}
