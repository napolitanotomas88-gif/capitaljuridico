// ── Bot "Capital Jurídico": etapa ÉXITO — h01, el MEDIDOR de éxito (puro, sin red ni reloj) ────────────────────────────────
// Tablero (1/11/2026): "medidor de éxito (contento + resultados; 5 días contento → pedir testimonio)".
// Las señales ya las guarda la etapa en cj_exito_senales:
//   · BUENA: un mensaje del cliente que Claude marcó como éxito (habla de resultados y son buenos) o un 8+ en su ronda vigente
//     de la encuesta (estado 'exito', tipo 'mensaje' o 'encuesta').
//   · MALA: un mensaje que habla de resultados y NO son buenos (estado 'no', detalle.habla = true y detalle.buenos = false).
// "Contento desde" = la primera señal buena después de la última mala (dentro de la ventana de 30 días). Cuando pasaron
// `dias` días desde ahí, está listo para pedir el OK del testimonio (el bloqueo de siempre —pedido abierto, 60 / 30 días—
// lo sigue mirando el núcleo).
import type { Senal } from './almacen'
import type { GrupoCliente } from './textos'

const DIA_MS = 86_400_000

export interface Medicion {
  clave: string
  chatId: string | null
  desde: string            // ISO de la primera señal buena de la racha
  senales: number          // señales buenas de la racha
  dias: number             // días enteros contento
  listo: boolean
  ultima: { cita: string | null; grupo: GrupoCliente | null; puntaje: number | null }
}

export const esBuena = (s: Pick<Senal, 'estado' | 'tipo'>): boolean => s.estado === 'exito' && (s.tipo === 'mensaje' || s.tipo === 'encuesta')
export const esMala = (s: Pick<Senal, 'estado' | 'tipo' | 'detalle'>): boolean =>
  s.tipo === 'mensaje' && s.estado === 'no' && s.detalle?.habla === true && s.detalle?.buenos === false

/** Una medición por cliente con racha buena vigente. `senales` puede traer de todos los clientes. */
export function medirContento(senales: readonly Senal[], ahora: number, dias: number): Medicion[] {
  const porClave = new Map<string, Senal[]>()
  for (const s of senales) {
    if (!s.clave || s.clave.startsWith('__')) continue
    if (!esBuena(s) && !esMala(s)) continue
    const l = porClave.get(s.clave) ?? []
    l.push(s)
    porClave.set(s.clave, l)
  }
  const out: Medicion[] = []
  for (const [clave, lista] of porClave) {
    const orden = [...lista].sort((a, b) => a.creado.localeCompare(b.creado))
    const iMala = orden.map(esMala).lastIndexOf(true)
    const racha = orden.slice(iMala + 1).filter(esBuena)
    if (!racha.length) continue
    const desde = racha[0].creado
    const ult = racha[racha.length - 1]
    const d = Math.floor((ahora - Date.parse(desde)) / DIA_MS)
    const grupo = typeof ult.detalle?.grupo === 'string' ? (ult.detalle.grupo as GrupoCliente) : null
    out.push({
      clave, chatId: [...racha].reverse().find((x) => x.chatId)?.chatId ?? null, desde, senales: racha.length, dias: Math.max(0, d),
      listo: ahora - Date.parse(desde) >= dias * DIA_MS,
      ultima: {
        cita: typeof ult.detalle?.cita === 'string' ? ult.detalle.cita : null,
        grupo,
        puntaje: typeof ult.detalle?.valor === 'number' ? ult.detalle.valor : null,
      },
    })
  }
  return out.sort((a, b) => a.desde.localeCompare(b.desde))
}
