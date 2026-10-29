import Link from 'next/link'
import { Cifra, Etiqueta, Tabla, Vacio, type Columna } from '@/components/ui'
import { AccionPendiente } from '@/components/clientes/AccionPendiente'
import { Pasos } from '@/components/clientes/Pasos'
import { RegistrarReferido } from '@/components/clientes/RegistrarReferido'
import { CanjeCreditos } from '@/components/clientes/CanjeCreditos'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { MOMENTOS_PEDIDO } from '@/lib/clientes/pestanasNuevas'
import type { FichaCliente, MovimientoFicha, PremioIntentoFicha, ReferidoFicha } from '@/lib/clientes/ficha'
import { fechaCorta, mesesTexto, numeroAR, textoDias, usd } from '@/lib/clientes/formato'
import { SeccionFicha } from './SeccionFicha'

// Créditos del programa de referidos de este cliente: saldo en meses y en USD, intentos con sus premios (ganados y próximos), extra del
// nivel, grabación según la zona, vencimiento más próximo, libro de movimientos y los referidos que presentó con el paso del
// programa en el que están. Todo calculado en el servidor con las reglas de lib/clientes/reglasReferidos.ts; acá solo se muestra.
const signo = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

const textoCierres = (n: number) => `${n} ${n === 1 ? 'cierre' : 'cierres'}`

// Qué vence en la fecha del vencimiento más próximo: cierres liberados, mes del intento, USD y/o entregables (web, branding)
const queVence = (v: { cierres: number; mesesIntentos: number; usd: number; entregables: number }) =>
  [
    v.cierres > 0 ? textoCierres(v.cierres) : '',
    v.mesesIntentos > 0 ? `${mesesTexto(v.mesesIntentos)} por intentos` : '',
    v.usd > 0 ? usd(v.usd) : '',
    v.entregables > 0 ? (v.entregables === 1 ? '1 premio (página web o branding)' : `${v.entregables} premios (página web y branding)`) : '',
  ].filter(Boolean).join(' y ')

const ESTADO_PREMIO: Record<PremioIntentoFicha['estado'], string> = { vigente: 'Vigente', vencido: 'Vencido', canjeado: 'Ya canjeado' }

const COLUMNAS_PREMIOS: Columna<PremioIntentoFicha>[] = [
  { clave: 'intento', titulo: 'Intento', celda: p => `Intento ${p.intento}` },
  { clave: 'premio', titulo: 'Premio', largo: true, celda: p => p.texto },
  { clave: 'fecha', titulo: 'Ganado el', celda: p => <span className="cj-num">{fechaCorta(p.fecha)}</span> },
  { clave: 'vence', titulo: 'Vence', celda: p => <span className="cj-num">{fechaCorta(p.vence)}</span> },
  { clave: 'estado', titulo: 'Estado', celda: p => ESTADO_PREMIO[p.estado] },
]

const COLUMNAS_MOVIMIENTOS: Columna<MovimientoFicha>[] = [
  { clave: 'fecha', titulo: 'Fecha', celda: m => <span className="cj-num">{fechaCorta(m.fecha)}</span> },
  { clave: 'tipo', titulo: 'Movimiento', celda: m => m.tipo },
  { clave: 'meses', titulo: 'Meses', numerica: true, celda: m => signo(m.meses) },
  { clave: 'extra', titulo: 'Extra', celda: m => m.extra || '—' },
  { clave: 'vence', titulo: 'Vence', celda: m => <span className="cj-num">{fechaCorta(m.vence)}</span> },
  {
    clave: 'nota', titulo: 'Nota', largo: true,
    celda: m => [m.renovacion ? `Renovación aplicada: ${m.renovacion}` : '', m.nota].filter(Boolean).join('. ') || '—',
  },
]

const COLUMNAS_REFERIDOS: Columna<ReferidoFicha>[] = [
  {
    clave: 'nombre', titulo: 'Referido', largo: true,
    celda: r => (
      <>
        {r.nombre || r.id || '—'}
        {r.estudio && <span className="cj-sub">{r.estudio}</span>}
      </>
    ),
  },
  {
    clave: 'pedido', titulo: 'Pedido',
    celda: r => (
      <>
        <span className="cj-num">{fechaCorta(r.fechaPedido)}</span>
        {r.momento && <span className="cj-sub">{r.momento}</span>}
      </>
    ),
  },
  { clave: 'estado', titulo: 'Estado', celda: r => r.estado || 'Sin estado' },
  { clave: 'paso', titulo: 'Paso del programa', largo: true, celda: r => <Pasos paso={r.paso} /> },
]

export function Creditos({ f, sufijo, puedeCanjear = false, demo = false }: { f: FichaCliente; sufijo: string; puedeCanjear?: boolean; demo?: boolean }) {
  const c = f.creditos
  const faltaReferidos = c.pestanasAusentes.includes('Referidos')
  const faltaCreditos = c.pestanasAusentes.includes('Créditos')

  return (
    <SeccionFicha id="creditos" etiqueta="Créditos y referidos" titulo="Programa de referidos">
      {faltaReferidos && faltaCreditos ? (
        <Vacio frase="Todavía no existen las pestañas “Referidos” y “Créditos” en la planilla del CRM. Cuando se creen y se cargue el primer referido, el saldo, los movimientos y los referidos de este cliente van a aparecer acá." />
      ) : (
        <>
          <div className="cj-rejilla">
            <Cifra
              tamano="media"
              etiqueta="Saldo (meses de servicio)"
              valor={numeroAR(c.mesesDisponibles)}
              contexto={
                <>
                  {c.renovacionGratis
                    ? `Renovación gratis${c.mesesExtraSobreRenovacion > 0 ? ` y ${mesesTexto(c.mesesExtraSobreRenovacion)} más` : ''}`
                    : `${mesesTexto(c.mesesPorCierres)} por cierres y ${mesesTexto(c.mesesPorIntentos)} por intentos`}
                  <span className="cj-sub">
                    Referencia USD {numeroAR(c.valorUSD)}
                    {c.renovacionGratis && ` en pago único o USD ${numeroAR(c.valorPlanDePagosUSD)} en plan de pagos`}
                  </span>
                </>
              }
            />
            <Cifra
              tamano="media"
              etiqueta="Saldo en USD"
              valor={usd(c.usd.disponible)}
              contexto={
                <>
                  Se canjea solo contra la renovación, aparte de los meses
                  <span className="cj-sub">
                    Ganado {usd(c.usd.ganado)} · canjeado {usd(c.usd.usado)}
                    {c.usd.vencido > 0 && ` · vencido ${usd(c.usd.vencido)}`}
                  </span>
                </>
              }
            />
            <Cifra
              tamano="media"
              etiqueta="Intentos"
              valor={numeroAR(c.intentos)}
              contexto={
                <>
                  Entraron a la llamada y no cerraron
                  <span className="cj-sub">Próximo (intento {c.proximosPremios[0].intento}): {c.proximosPremios[0].texto}</span>
                </>
              }
            />
            <Cifra
              tamano="media"
              etiqueta="Nivel de la escalera de cierres"
              valor={`${c.nivel} de ${c.nivelesTotal}`}
              contexto={
                c.proximoNivel
                  ? `${c.proximoNivel.cierresFaltantes === 1 ? 'Falta 1 cierre' : `Faltan ${c.proximoNivel.cierresFaltantes} cierres`}: ${c.proximoNivel.descripcion}`
                  : c.topeAlcanzado && c.topeMeses !== null
                    ? `Tope de ${c.topeMeses} meses alcanzado`
                    : 'Sin cierres liberados todavía'
              }
            />
            <Cifra
              tamano="media"
              className="cj-cifra--fecha"
              etiqueta="Vencimiento más próximo"
              valor={c.proximoVencimiento ? fechaCorta(c.proximoVencimiento.fecha) : '—'}
              contexto={c.proximoVencimiento ? `${textoDias(c.proximoVencimiento.dias)} · ${queVence(c.proximoVencimiento)}` : 'Sin créditos por vencer'}
            />
          </div>


          <p className="cj-parrafo cj-texto-2">
            Los meses liberados y vigentes se aplican automáticamente al confirmar una nueva renovación en el Despacho.
            La vista previa muestra los meses que se agregan y el fin del servicio. Los créditos en USD se canjean aparte, con revisión y confirmación manual.
          </p>

          {c.topeMeses !== null && c.mesesSobreTope > 0 && (
            <p className="cj-parrafo cj-texto-2">
              Tope de {c.topeMeses} meses acumulados en total: {mesesTexto(c.mesesSobreTope)} de los ganados ya no suman.
            </p>
          )}

          {c.advertencias.length > 0 && (
            <div className="cj-aviso" role="status">
              <p>Hay datos para revisar en la planilla:</p>
              <ul className="cj-lista cj-lista--aviso">
                {c.advertencias.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Detalle del ciclo{c.cicloDesde ? ` · desde el ${fechaCorta(c.cicloDesde)}` : ''}</Etiqueta>
            <dl className="cj-datos">
              <div>
                <dt className="cj-etiqueta">Cierres liberados</dt>
                <dd>{c.cierresLiberados}</dd>
              </div>
              <div>
                <dt className="cj-etiqueta">Intentos acumulados</dt>
                <dd>{c.intentos}</dd>
              </div>
              <div>
                <dt className="cj-etiqueta">Premios únicos</dt>
                <dd>
                  Página web: {c.paginaWeb ? (c.paginaWeb.vigente ? `ganada el ${fechaCorta(c.paginaWeb.fecha)}` : 'vencida') : 'todavía no'} · branding:{' '}
                  {c.branding ? (c.branding.vigente ? `ganado el ${fechaCorta(c.branding.fecha)}` : 'vencido') : 'todavía no'}
                </dd>
              </div>
              <div>
                <dt className="cj-etiqueta">Meses ganados</dt>
                <dd>
                  {c.mesesPorCierres} por cierres · {c.mesesPorIntentos} por intentos
                </dd>
              </div>
              <div>
                <dt className="cj-etiqueta">Por liberarse</dt>
                {c.cierresPendientes.length === 0 ? (
                  <dd>0</dd>
                ) : (
                  c.cierresPendientes.map(p => (
                    <dd key={p.idReferido}>
                      {p.idReferido}: {p.texto}
                    </dd>
                  ))
                )}
              </div>
              <div>
                <dt className="cj-etiqueta">Vencidos y reembolsados</dt>
                <dd>
                  {c.cierresVencidos} {c.cierresVencidos === 1 ? 'vencido' : 'vencidos'} · {c.cierresReembolsados} {c.cierresReembolsados === 1 ? 'reembolsado' : 'reembolsados'}
                </dd>
              </div>
              {c.anterioresAlPrograma > 0 && (
                <div>
                  <dt className="cj-etiqueta">Anteriores al programa</dt>
                  <dd>
                    {c.anterioresAlPrograma} {c.anterioresAlPrograma === 1 ? 'presentado' : 'presentados'} antes del {fechaCorta(c.programaDesde)}: no genera{c.anterioresAlPrograma === 1 ? '' : 'n'} crédito
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Premios por intentos</Etiqueta>
            <Tabla
              descripcion="Premios ganados por intentos de este cliente"
              columnas={COLUMNAS_PREMIOS}
              filas={c.premiosIntentos}
              claveFila={p => `i${p.intento}`}
              vacio={<Vacio frase="Todavía no hay intentos: un intento es un referido que entra a la llamada y no cierra." />}
            />
            <p className="cj-parrafo cj-texto-2">
              Próximos premios: {c.proximosPremios.map(p => `intento ${p.intento}, ${p.texto.charAt(0).toLowerCase()}${p.texto.slice(1)}`).join(' · ')}.
            </p>
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Referidos presentados</Etiqueta>
            {faltaReferidos ? (
              <Vacio frase="Todavía no existe la pestaña “Referidos” en la planilla del CRM." />
            ) : c.referidos.length === 0 ? (
              <Vacio frase="Este cliente todavía no presentó referidos." />
            ) : (
              <>
                {/* Tabla en escritorio; en móvil tarjetas, para que el paso del programa no quede fuera de pantalla */}
                <div className="cj-solo-escritorio">
                  <Tabla descripcion="Referidos presentados por este cliente" columnas={COLUMNAS_REFERIDOS} filas={c.referidos} claveFila={r => r.id || r.nombre} />
                </div>
                <div className="cj-solo-movil">
                  <ul className="cj-tarjetas" aria-label="Referidos presentados por este cliente">
                    {c.referidos.map(r => (
                      <li key={r.id || r.nombre} className="cj-tarjeta">
                        <div className="cj-tarjeta__cuerpo">
                          <div className="cj-tarjeta__cab">
                            <span className="cj-etiqueta">{r.id || 'Sin ID'}</span>
                            <span className="cj-etiqueta">{r.estado || 'Sin estado'}</span>
                          </div>
                          <p className="cj-tarjeta__nombre">{r.nombre || '—'}</p>
                          <dl className="cj-tarjeta__datos">
                            <div>
                              <dt className="cj-etiqueta">Pedido</dt>
                              <dd>
                                {fechaCorta(r.fechaPedido)}
                                {r.momento && <span className="cj-sub">{r.momento}</span>}
                              </dd>
                            </div>
                            <div>
                              <dt className="cj-etiqueta">Estudio</dt>
                              <dd>{r.estudio || '—'}</dd>
                            </div>
                            <div>
                              <dt className="cj-etiqueta">Paso del programa</dt>
                              <dd>
                                <Pasos paso={r.paso} />
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Libro de movimientos</Etiqueta>
            {faltaCreditos ? (
              <Vacio frase="Todavía no existe la pestaña “Créditos” (el libro de movimientos) en la planilla del CRM." />
            ) : (
              <>
              <Tabla
                descripcion="Movimientos de créditos de este cliente"
                columnas={COLUMNAS_MOVIMIENTOS}
                filas={c.movimientos}
                claveFila={m => `${m.fecha}-${m.tipo}-${m.meses}-${m.nota}`}
                vacio={<Vacio frase="Todavía no hay movimientos en el libro de este cliente." />}
              />
              <p className="cj-parrafo cj-texto-2">El libro no tiene una columna de USD: los canjes en USD se leen del texto del campo Extra (la palabra USD seguida del monto).</p>
              </>
            )}
          </div>
        </>
      )}

      <div className="cj-pendientes">
        {/^[AC]\d{3,}$/.test(f.id) && !demo ? (
          <RegistrarReferido referidor={{ id: f.id, nombre: f.nombre }} momentos={MOMENTOS_PEDIDO} hoy={hoyArgentina()} />
        ) : (
          <p className="cj-parrafo cj-texto-2">Registrar referido: solo para clientes de la planilla (no disponible en datos de ejemplo).</p>
        )}
        {puedeCanjear && /^[A-Z]\d{3,}$/.test(f.id) ? (
          <CanjeCreditos idCliente={f.id} hoy={hoyArgentina()} demo={demo} />
        ) : (
          <AccionPendiente>Canjear crédito</AccionPendiente>
        )}
      </div>
      <Link href={`/clientes/referidos${sufijo}`} className="cj-enlace" style={{ alignSelf: 'flex-start' }}>
        Ver las reglas del programa
      </Link>
    </SeccionFicha>
  )
}
