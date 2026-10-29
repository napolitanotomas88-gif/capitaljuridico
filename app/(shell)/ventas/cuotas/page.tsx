import { redirect } from 'next/navigation'

// Cobro de cuotas se mudó a /cuotas (10/10/2026). Los enlaces viejos siguen andando y conservan lo que traen (?nuevo=si&nombre=…).
export default async function CuotasViejo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams
  const qs = new URLSearchParams(Object.entries(p).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]))).toString()
  redirect(qs ? `/cuotas?${qs}` : '/cuotas')
}
