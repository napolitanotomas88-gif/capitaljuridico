// Mientras se lee la ficha de kickoff de la base del Despacho (cj_kickoffs): sin esto quedaba el de Clientes, que dice
// "Leyendo la planilla del CRM…" y esta pantalla no lee la planilla. Mismo estilo que components/shell/Cargando.tsx.
export default function CargandoKickoff() {
  return (
    <p className="cj-cargando cj-etiqueta" role="status">
      Leyendo la ficha de kickoff…
    </p>
  )
}
