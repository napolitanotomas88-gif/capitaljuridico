import { EstilosFinanzas } from './Tema'

// Pantalla de la contraseña de Finanzas, en verde. Es PÚBLICA (se ve sin sesión de Google, como declara lib/auth/rutas.ts:
// Finanzas se abre solo con su contraseña) y, si hay una sesión de Google que puede ver la sección, app/finanzas/layout.tsx
// la envuelve en el marco del dashboard. Es un formulario común (POST a /api/finanzas/login): anda sin JavaScript.
export function FormularioClave({ mensaje, configurada }: { mensaje: string | null; configurada: boolean }) {
  return (
    <div className="fin-verde fin-fondo" data-theme="dark">
      <EstilosFinanzas />
      <div className="fin-clave-centro">
        <div className="glass-board fin-clave">
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>
            Finanzas <span style={{ color: 'var(--brand-orange)' }}>Capital Jurídico</span>
          </h1>
          <p className="text-sm mt-1 mb-5" style={{ color: 'var(--text-muted)' }}>Ingresá la contraseña para ver las finanzas.</p>
          {mensaje && (
            <p role="alert" className="text-sm rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: 'var(--fin-mal-bg)', backgroundImage: 'linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28))', color: 'var(--fin-mal)', fontWeight: 600 }}>
              {mensaje}
            </p>
          )}
          {configurada && (
            <form method="post" action="/api/finanzas/login" className="flex flex-col gap-3">
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }} htmlFor="password">CONTRASEÑA</label>
              <input
                id="password" name="password" type="password" required autoFocus autoComplete="current-password"
                className="fin-entrada rounded-xl px-3 py-2.5 text-base"
              />
              <button type="submit" className="fin-boton rounded-xl px-4 py-2.5 text-sm font-bold mt-1">
                Entrar
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
