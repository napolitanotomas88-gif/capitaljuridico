import { createClient } from '@supabase/supabase-js'

// Base de Finanzas SKWD (Supabase, con sus permisos RLS por usuario). Dentro del Despacho (1/11/2026) las variables son
// NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_KEY (la clave PUBLICABLE: va al navegador; nunca la secreta).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const clave = process.env.NEXT_PUBLIC_SUPABASE_KEY

export const supabaseConfigurado = Boolean(url && clave)
// Sin configuración queda en null: FinanzasSkwd no muestra ninguna pantalla que la use
export const supabase = supabaseConfigurado ? createClient(url, clave) : null
