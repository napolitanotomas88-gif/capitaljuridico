# Finanzas SKWD dentro del Despacho

Pedido de Tomás (1/11/2026): la app «Finanzas SKWD» (React + Vite, base Supabase) pasa a vivir dentro de Finanzas, con la
estética de Finanzas, para llevar ahí los pagos de los clientes y del equipo.

- Pestañas en `/finanzas`: **Resumen** (el tablero de siempre; desde el 1/11 lee la app, ver abajo) y, en `/finanzas/<vista>`, Pagos,
  Gastos, Equipo, Pagos del equipo, Correcciones, Estado de resultados, Tablero y Gastos personales. Cuentas y
  Conciliación siguen ocultas, como en la app original: no se muestran sin indicación del responsable.
- Código: `components/finanzas/skwd/` (las pantallas y cálculos de la app original, sin cambios de lógica; los gráficos con
  colores para el fondo verde), `FinanzasSkwd.tsx` (marco, sesión de la base y pestaña), `estilos.tsx` (su App.css pasado
  al verde de Finanzas, encerrado en `.fin-skwd`), `vistas.ts` y `../NavFinanzas.tsx`.
- Acceso: igual que `/finanzas` (contraseña de Finanzas o administrador con Google). No hay otro inicio de sesión.
- No agregar datos al código (cifras, listados, exportaciones): todo se lee de la base con sesión y permisos.

## La base: Neon (desde el 1/11/2026)

Decisión de Tomás (1/11): «no lo vamos a usar más [Supabase], migramos todo». Los datos se copiaron a la base del
Despacho (Neon, `DATABASE_URL`), esquemas `finanzas` y `finanzas_priv`, con las mismas tablas, vistas, disparadores y
permisos; los totales se verificaron contra Supabase antes de cambiar. GitHub guarda solo la estructura (el repo es
público): `db/finanzas/estructura.sql`.

- Las pantallas siguen escribiendo `supabase.from(...)...`: `components/finanzas/skwd/supabase.js` arma el pedido y lo
  manda a `POST /api/finanzas/db` (mismo acceso que `/finanzas`).
- `lib/finanzasSkwd/baseNeon.ts` lo traduce a SQL (tablas de una lista blanca, valores siempre como parámetros) y lo
  corre en una transacción con `set local role finanzas_app` y el correo de la sesión en `request.jwt.claims`:
  `finanzas_priv.jwt()` hace de `auth.jwt()`, así los datos sensibles siguen solo para los correos de
  `finanzas_priv.sensibles_autorizados` y `creado_por` / `corregido_por` los firma la base.
- Sin Google (solo con la contraseña de Finanzas) firma `acceso-por-clave@finanzas.despacho`, que no ve lo sensible.
- Pruebas: `scripts/test-finanzas-base.mjs`.

## Resumen de `/finanzas` lee la app (desde el 1/11/2026)

Pedido de Tomás (1/11): «pasa todo a la app». El Resumen (`GET /api/finanzas` → `lib/finanzas.ts` → `lib/finanzasCalc.ts`)
toma pagos, gastos y pagos al equipo de la base, con `lib/finanzasApp.ts` (vistas `*_vigentes`, ya con correcciones; lee
como dueño, solo servidor; caché de 60 s, deduplicación y último valor bueno). El cálculo es el mismo.

- Cuenta que recibió: `finanzas.pago_quien_recibio`. Tomi / Gero / Financiera tal cual, Empresa = Relay, «Tomi y Gero»
  (efectivo) = mitad y mitad. Sin fila: los comprobantes de jul–sep (`lib/finanzasCuentas.ts`) de respaldo; si tampoco,
  «sin dato» y aviso en «A revisar».
- Sigue en la planilla: el **Estado de Resultados** ("Cash Collected", solo como control: la app no tiene un equivalente) y
  el **respaldo**: si falta `DATABASE_URL` o Neon falla, se muestra la planilla con un aviso. `FINANZAS_FUENTE=planilla`
  fuerza el camino viejo.
- Cierre de mes (`/api/finanzas-cierre`): el estimado de Meta se carga en la pestaña Gastos (como antes) **y** en
  `finanzas.gastos` como fila web (sin duplicar por fecha + concepto + monto), firmado `cierre@finanzas.despacho`, con su
  propio plan sobre los gastos de la app.
- Pruebas: `scripts/test-finanzas-app.mjs`.
- Los pagos que carga el bot (y la tarjeta del cliente) se copian a la app: `lib/finanzasSkwd/pagoApp.ts` (ver docs/BOT-ALTA-CJ.md). Pruebas: `scripts/test-finanzas-pago-app.mjs`.
