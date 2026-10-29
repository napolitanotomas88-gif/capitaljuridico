import Link from "next/link";
export function BotonGuia() {
  return <Link href="/ventas/guia" aria-label="Guía de uso" title="Guía de uso" className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/60 px-2 text-sm font-semibold hover:bg-white/10 lg:px-3"><span aria-hidden="true" className="text-lg">?</span><span className="hidden lg:inline">Guía de uso</span></Link>;
}
