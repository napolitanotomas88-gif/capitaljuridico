'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { INTERVALO_AVISO_MS, MAX_CARTELES, debeSonar, nuevas, ultimoId, urlSegura, type AvisoNotificacion } from '@/lib/aviso/logica'

const CLAVE_ULTIMO = 'cj-aviso-ultimo'

/** Un "ding" suave de dos notas con Web Audio (sin archivos). Solo anda después de un toque en la página (regla del navegador). */
function sonar(ctx: AudioContext | null) {
  if (!ctx) return
  try {
    const t = ctx.currentTime
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.35)
      o.connect(g).connect(ctx.destination)
      o.start(t + i * 0.18)
      o.stop(t + i * 0.18 + 0.4)
    }
  } catch {
    /* sin audio: queda el cartel */
  }
}

const leerUltimo = (): number | null => {
  try {
    const v = Number(localStorage.getItem(CLAVE_ULTIMO))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
const guardarUltimo = (id: number) => {
  try {
    localStorage.setItem(CLAVE_ULTIMO, String(id))
  } catch {
    /* sin almacenamiento: se recalcula la próxima vez */
  }
}

async function pedir(desde: number): Promise<AvisoNotificacion[] | null> {
  try {
    const r = await fetch(`/api/notificaciones?desde=${desde}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as { notificaciones?: AvisoNotificacion[] }
    return j.notificaciones ?? []
  } catch {
    return null
  }
}

/**
 * Aviso emergente con sonido (27/10/2026): cada 30 s, con la pestaña a la vista, pide las notificaciones nuevas (fuente única:
 * /api/notificaciones del Hub) y muestra un cartel por cada una (hasta 3). Las urgentes suenan, salvo de 23 a 8. Al entrar por
 * primera vez toma como punto de partida la última que existe (no salta lo viejo). Va en el marco (MarcoShell).
 */
export function Aviso() {
  const router = useRouter()
  const [carteles, setCarteles] = useState<AvisoNotificacion[]>([])
  const ultimo = useRef<number | null>(null)
  const audio = useRef<AudioContext | null>(null)

  // El navegador no deja sonar hasta que la persona toca algo: el contexto de audio se crea con el primer toque
  useEffect(() => {
    const habilitar = () => {
      if (!audio.current) {
        try {
          audio.current = new AudioContext()
        } catch {
          audio.current = null
        }
      }
      void audio.current?.resume()
    }
    window.addEventListener('pointerdown', habilitar, { once: true })
    window.addEventListener('keydown', habilitar, { once: true })
    return () => {
      window.removeEventListener('pointerdown', habilitar)
      window.removeEventListener('keydown', habilitar)
    }
  }, [])

  useEffect(() => {
    let vivo = true
    const revisar = async () => {
      if (document.visibilityState !== 'visible') return
      // Punto de partida: lo guardado o, la primera vez, la última que existe (recorriendo de a 50)
      if (ultimo.current === null) {
        let desde = leerUltimo()
        if (desde === null) {
          desde = 0
          for (let i = 0; i < 20; i++) {
            const pagina = await pedir(desde)
            if (!pagina) return
            desde = ultimoId(pagina, desde)
            if (pagina.length < 50) break
          }
        }
        ultimo.current = desde
        guardarUltimo(desde)
        return
      }
      const lista = await pedir(ultimo.current)
      if (!vivo || !lista) return
      const llegaron = nuevas(lista, ultimo.current)
      ultimo.current = ultimoId(lista, ultimo.current)
      guardarUltimo(ultimo.current)
      if (!llegaron.length) return
      setCarteles((c) => [...c, ...llegaron].slice(-MAX_CARTELES))
      if (debeSonar(llegaron, new Date())) sonar(audio.current)
    }
    void revisar()
    const id = setInterval(revisar, INTERVALO_AVISO_MS)
    document.addEventListener('visibilitychange', revisar)
    return () => {
      vivo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', revisar)
    }
  }, [])

  const marcarVista = useCallback((n: AvisoNotificacion) => {
    setCarteles((c) => c.filter((x) => x.id !== n.id))
    void fetch(`/api/notificaciones/${n.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'vista' }) }).catch(() => {})
  }, [])

  if (!carteles.length) return null
  return (
    <div className="cj-notificacion-flotante" aria-live="polite">
      {carteles.map((n) => {
        const url = urlSegura(n.url)
        return (
          <div key={n.id} className={`cj-notificacion-flotante__cartel${n.urgente ? ' cj-notificacion-flotante__cartel--urgente' : ''}`} role={n.urgente ? 'alert' : 'status'}>
            <button
              type="button"
              className="cj-notificacion-flotante__cuerpo"
              onClick={() => {
                marcarVista(n)
                if (url) router.push(url)
              }}
            >
              <strong>{n.titulo}</strong>
              {n.cuerpo && <span>{n.cuerpo}</span>}
            </button>
            <button type="button" className="cj-notificacion-flotante__cerrar" aria-label={`Cerrar el aviso "${n.titulo}"`} onClick={() => marcarVista(n)}>
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
