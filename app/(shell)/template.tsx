// Se vuelve a montar en CADA navegación del shell (a diferencia del layout): así cada pantalla entra con una transición corta.
export default function Plantilla({ children }: { children: React.ReactNode }) {
  return <div className="cj-transicion">{children}</div>
}
