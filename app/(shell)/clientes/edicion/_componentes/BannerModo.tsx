// El cartel del modo prueba: con EDICION_MODO distinto de "real" (o el ejemplo de ?demo=1) nada se guarda ni sale a Discord.
export function BannerModo({ modo, demo }: { modo: 'dry' | 'real'; demo: boolean }) {
  if (demo) {
    return (
      <p className="ed-modo" role="note">
        <strong>Datos de ejemplo.</strong> Esta pantalla es ficticia y solo existe en desarrollo (?demo=1): sirve para revisar el diseño. Los botones no guardan nada.
      </p>
    )
  }
  if (modo === 'real') return null
  return (
    <p className="ed-modo" role="note">
      <strong>Modo prueba.</strong> Podés revisar los cambios; no se guardan ni se envían avisos.
    </p>
  )
}
