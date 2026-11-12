// Leads del embudo formulario → WhatsApp (Neon, la misma DATABASE_URL que Trazabilidad y Cuotas). La tabla se crea sola.
import 'server-only'
import { neon } from '@neondatabase/serverless'

function sql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('La base de datos todavía no está conectada (DATABASE_URL).')
  return neon(url)
}

let lista: Promise<void> | null = null
export function asegurarTabla(): Promise<void> {
  lista ??= (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS cj_embudo_wa_lead (
      id text PRIMARY KEY,
      creado timestamptz NOT NULL DEFAULT now(),
      nombre text NOT NULL,
      apellido text NOT NULL,
      telefono text NOT NULL,
      facturacion text NOT NULL,
      urgencia text NOT NULL,
      letra text NOT NULL,
      calificado boolean NOT NULL,
      origen jsonb NOT NULL DEFAULT '{}',
      capi_ok boolean,
      capi_error text,
      wa_click timestamptz,
      wa_escribio timestamptz,
      seguimiento_enviado timestamptz,
      seguimiento_error text
    )`
    await sql()`CREATE INDEX IF NOT EXISTS cj_embudo_wa_lead_tel ON cj_embudo_wa_lead (telefono)`
  })().catch((e) => { lista = null; throw e })
  return lista
}

export type LeadNuevo = {
  id: string; nombre: string; apellido: string; telefono: string; facturacion: string; urgencia: string
  letra: string; calificado: boolean; origen: Record<string, string>
}

export async function guardarLead(l: LeadNuevo): Promise<void> {
  await asegurarTabla()
  await sql()`INSERT INTO cj_embudo_wa_lead (id, nombre, apellido, telefono, facturacion, urgencia, letra, calificado, origen)
    VALUES (${l.id}, ${l.nombre}, ${l.apellido}, ${l.telefono}, ${l.facturacion}, ${l.urgencia}, ${l.letra}, ${l.calificado}, ${JSON.stringify(l.origen)}::jsonb)
    ON CONFLICT (id) DO NOTHING`
}

export async function marcarCapi(id: string, ok: boolean, error: string | null): Promise<void> {
  await sql()`UPDATE cj_embudo_wa_lead SET capi_ok = ${ok}, capi_error = ${error} WHERE id = ${id}`
}

export async function marcarClick(id: string): Promise<boolean> {
  await asegurarTabla()
  const r = await sql()`UPDATE cj_embudo_wa_lead SET wa_click = COALESCE(wa_click, now()) WHERE id = ${id} RETURNING id`
  return r.length > 0
}
