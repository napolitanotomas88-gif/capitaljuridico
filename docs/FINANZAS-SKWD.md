# Finanzas SKWD dentro del Despacho

Pedido de Tomás (1/11/2026): la app «Finanzas SKWD» (React + Vite, base Supabase) pasa a vivir dentro de Finanzas, con la
estética de Finanzas, para llevar ahí los pagos de los clientes y del equipo.

- Pestañas en `/finanzas`: **Resumen** (el tablero de siempre, planilla de Google) y, en `/finanzas/<vista>`, Pagos,
  Gastos, Equipo, Pagos del equipo, Correcciones, Estado de resultados, Tablero y Gastos personales. Cuentas y
  Conciliación siguen ocultas, como en la app original: no se muestran sin indicación del responsable.
- Código: `components/finanzas/skwd/` (las pantallas y cálculos de la app original, sin cambios de lógica; los gráficos con
  colores para el fondo verde), `FinanzasSkwd.tsx` (marco, sesión de la base y pestaña), `estilos.tsx` (su App.css pasado
  al verde de Finanzas, encerrado en `.fin-skwd`), `vistas.ts` y `../NavFinanzas.tsx`.
- Acceso: igual que `/finanzas` (contraseña de Finanzas o administrador con Google) y además el inicio de sesión de la base
  (email y contraseña de Supabase), del que dependen los permisos RLS y los datos sensibles del equipo.
- Variables: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_KEY` (clave **publicable**). Se incrustan al compilar:
  si cambian, hay que volver a publicar. Sin ellas, las pestañas avisan que falta conectar la base.
- No agregar datos al código (cifras, listados, exportaciones): todo se lee de la base con sesión y permisos.

## Sin segundo inicio de sesión (1/11/2026)

Pedido de Tomás: «no hace falta la contraseña: al Despacho ya se entra con el correo». Los permisos de la base solo piden
el rol `authenticated` y miran el correo del token (`auth.jwt() ->> 'email'`: datos sensibles para los correos de
`private.sensibles_autorizados`, y `creado_por`). Entonces `GET /api/finanzas/base` (mismo acceso que `/finanzas`) firma
un token de 1 h con el correo de la sesión de Google, usando `SUPABASE_JWT_SECRET` (el JWT secret del proyecto, solo en
el servidor), y `supabase-js` lo usa con `accessToken`. Sin Google (solo con la contraseña de Finanzas) va un correo
genérico que no ve lo sensible. Si falta `SUPABASE_JWT_SECRET`, vuelve el inicio de sesión de la app original.
