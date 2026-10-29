interface Props {
  children: React.ReactNode
  icon?: string
}

export function SectionTitle({ children, icon }: Props) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon && <span className="text-base">{icon}</span>}
      <h2 className="text-xs uppercase tracking-widest text-zinc-500 font-semibold">{children}</h2>
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  )
}
