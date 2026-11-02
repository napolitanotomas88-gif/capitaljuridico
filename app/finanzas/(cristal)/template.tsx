// Se vuelve a montar en cada cambio de pantalla: dispara la entrada de los paneles de cristal (cristal.css)
export default function Plantilla({ children }: { children: React.ReactNode }) {
  return <div className="fin-cristal__vista">{children}</div>
}
