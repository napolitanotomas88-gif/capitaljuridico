'use client'

import { useEffect, useState } from 'react'

interface Props {
  lastUpdated: string | null
  loading: boolean
  error: string | null
}

export function StatusBar({ lastUpdated, loading, error }: Props) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const timeAgo = lastUpdated
    ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000)
    : null

  return (
    <div className="flex items-center gap-3 text-xs text-zinc-500">
      {/* Indicador pulsante */}
      <span className="relative flex h-2 w-2">
        {loading ? (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
        ) : error ? (
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        ) : (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-40" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
          </>
        )}
      </span>

      {error ? (
        <span className="text-red-400">{error}</span>
      ) : loading ? (
        <span className="text-yellow-400">Actualizando...</span>
      ) : timeAgo !== null ? (
        <span>
          Actualizado hace{' '}
          <span className="text-zinc-400">
            {timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m`}
          </span>
        </span>
      ) : null}

      <span className="ml-auto text-zinc-700">Próxima actualización: 30s</span>
    </div>
  )
}
