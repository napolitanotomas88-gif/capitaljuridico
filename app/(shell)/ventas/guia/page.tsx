import Link from "next/link";
import { requerirSesion } from "@/lib/crm/auth";
import { BotonMensajes } from "@/components/crm/BotonMensajes";
import { SECCIONES_GUIA } from "@/lib/crm/config/guia";
import { videosGuia } from "@/lib/crm/videosGuia";
import { EditarVideos } from "./EditarVideos";
export const metadata = { title: "Guía de uso" };
export default async function Guia() {
  const sesion = await requerirSesion();
  const videos = await videosGuia();
  return <>
    <header className="marca-barra sticky top-0 z-30 bg-negro text-blanco"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3"><span className="font-bold tracking-wide">Capital Jurídico</span><Link href="/ventas" className="inline-flex min-h-11 items-center font-bold text-dorado">← Volver a Mi día</Link><BotonMensajes /></div></header>
    {/* div y no main (el main es el del shell); pb-28: en el celular la barra de secciones no tapa el final. */}
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-8 lg:pb-8"><p className="text-sm font-bold uppercase tracking-widest text-dorado-oscuro">Capital Jurídico · Capacitación</p><h1 className="mt-2 text-3xl font-bold">Guía de uso</h1><p className="mt-3 text-lg text-gris-texto">Tu rutina de trabajo, paso a paso. Primero hacé la tarea; después registrala.</p>
    <section className="my-6 rounded-2xl border border-gris-linea bg-blanco p-5"><h2 className="text-xl font-bold">Guía de uso del CRM de ventas · Video</h2><a href={videos.ventas} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-dorado px-4 font-bold">Ver guía de Ventas ↗</a></section>
    {sesion.rol === "admin" && <EditarVideos ventas={videos.ventas} cuotas={videos.cuotas} />}
    <nav aria-label="Contenido de la guía" className="mb-6 rounded-2xl bg-negro p-5 text-blanco"><h2 className="mb-2 font-bold">Contenido</h2><ul className="grid gap-1 sm:grid-cols-2">{SECCIONES_GUIA.map((s,i)=><li key={s.titulo}><a href={`#paso-${i}`} className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">{s.titulo}</a></li>)}</ul></nav>
    <div className="space-y-4">{SECCIONES_GUIA.map((s,i)=><section id={`paso-${i}`} key={s.titulo} className="scroll-mt-28 rounded-2xl border border-gris-linea bg-blanco p-5 sm:p-7"><h2 className="text-xl font-bold">{s.titulo}</h2>{s.titulo.startsWith("Cuotas:") && <a href={videos.cuotas} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-dorado px-4 font-bold">Ver guía de Cobro de cuotas ↗</a>}<p className="mt-3 whitespace-pre-line leading-relaxed">{s.texto}</p></section>)}</div></div>
  </>;
}
