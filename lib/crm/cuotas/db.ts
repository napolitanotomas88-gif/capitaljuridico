// Base de Cuotas (Neon Postgres por HTTP). Solo servidor: la importan las server actions y la página de /cuotas.
import { neon } from "@neondatabase/serverless";
import type { Plan, RegistroPlan } from "./modelo";
export function configurado() {
  return (
    !!process.env.CUOTAS_DATABASE_URL?.trim() ||
    !!process.env.DATABASE_URL?.trim()
  );
}
export function sqlCuotas() {
  const url =
    process.env.CUOTAS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url)
    throw new Error("La base de datos de Cuotas todavía no está conectada.");
  return neon(url);
}
export async function listarPlanes(
  responsable?: string,
): Promise<RegistroPlan[]> {
  const sql = sqlCuotas();
  const filas =
    responsable === undefined
      ? await sql`SELECT data, version FROM cj_cuotas_planes ORDER BY updated_at DESC`
      : await sql`SELECT data, version FROM cj_cuotas_planes WHERE owner_id = ${responsable} ORDER BY updated_at DESC`;
  return filas.map((f) => ({
    plan: f.data as Plan,
    version: Number(f.version),
  }));
}
export async function obtenerPlan(
  id: string,
  responsable?: string,
): Promise<RegistroPlan | null> {
  const sql = sqlCuotas();
  const filas =
    responsable === undefined
      ? await sql`SELECT data, version FROM cj_cuotas_planes WHERE id = ${id}::uuid`
      : await sql`SELECT data, version FROM cj_cuotas_planes WHERE id = ${id}::uuid AND owner_id = ${responsable}`;
  return filas.length
    ? { plan: filas[0].data as Plan, version: Number(filas[0].version) }
    : null;
}
export async function crearPlan(plan: Plan): Promise<boolean> {
  const sql = sqlCuotas();
  const r =
    await sql`INSERT INTO cj_cuotas_planes (id, owner_id, data) VALUES (${plan.id}::uuid, ${plan.responsable}, ${JSON.stringify(plan)}::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`;
  return r.length > 0;
}
export async function guardarPlan(
  plan: Plan,
  version: number,
  propietarioAnterior: string,
): Promise<boolean> {
  const sql = sqlCuotas();
  const r =
    await sql`UPDATE cj_cuotas_planes SET data=${JSON.stringify(plan)}::jsonb, owner_id=${plan.responsable}, version=version+1, updated_at=now() WHERE id=${plan.id}::uuid AND version=${version} AND owner_id=${propietarioAnterior} RETURNING id`;
  return r.length > 0;
}
