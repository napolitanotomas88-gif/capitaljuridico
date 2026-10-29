> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# CRM de ventas integrado al dashboard (7/10/2026)

Pedido de RESPONSABLE_HUB: sumar el CRM de ventas (ZIP `<ID_PRIVADO_CONFIGURADO>.zip`) al dashboard, "utilizando el sistema que ya armé yo" (login de Google, roles y shell) y **conservando la estética del CRM aplicada a todas las aplicaciones**. Cuotas: para después. **No está desplegado**: esto vive solo en `dashboard-unificado` (producción sigue como estaba).

## Qué entró

La lógica y las pantallas del CRM, portadas casi sin cambios (se copiaron con las rutas de importación reescritas; el ZIP original queda como referencia, no se tocó):

| Pantalla | Ruta | Quién |
|---|---|---|
| Mi día de un closer: Pre-call, ¿Se presentó?, Resultado, No-show, Post-call, Listo por hoy, Calls de hoy, Hechas hoy, filtros, búsqueda, hoja inferior, Deshacer | `/ventas/closer/[id]` y `/ventas` | closer y setter (solo sus pestañas); socio (cualquiera) |
| Ficha del lead (URL propia) | `/ventas/lead/[hoja]/[fila]` | igual |
| Tablero de administración, historial por período | `/ventas/admin` | solo socio (el socio entra a `/ventas` y cae acá) |
| Guía de uso | `/ventas/guia` | quien ve Ventas |

Código: `lib/crm/*` (motor de próxima acción, lectura/escritura/verificación/log de Sheets, pantalla, fechas, ficha, admin, `acciones.ts` con las server actions), `components/crm/*`, `app/(shell)/ventas/*`.

## Cómo se conectó al sistema del dashboard

- **Sesión:** la de Google del dashboard. Se eliminó el PIN, `CLOSERS_JSON`, `ADMIN_PIN`, `SESSION_SECRET` y la cookie propia. `lib/crm/auth.ts` conserva la forma del original: socio = "admin" del CRM; closer o setter = "closer" con las pestañas de `AUTH_VENTAS_PESTANAS` (la variable que ya existía, mail → pestañas). Closer o setter sin pestaña asignada: aviso "Tu cuenta todavía no tiene un CRM asignado" (sin leer ningún lead). CSM: sin acceso (redirige a Clientes).
- **Nombre del closer:** el de la persona en `AUTH_USUARIOS`; en el tablero del socio, el de la persona asignada a esa pestaña si es una sola, y si no el de la pestaña. Es lo que queda en la columna Closer del log.
- **Planilla y credenciales:** `SHEET_ID_VENTAS`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (las del dashboard). Los "Deshacer" se firman con `AUTH_SECRET` (con prefijo propio).
- **Barrera de escritura:** `SHEET_ID_VENTAS` es la planilla **ORIGINAL** del CRM de ventas. El código se niega a escribir en ella salvo `PERMITIR_ESCRITURA_ORIGINAL=si` (verificado: original sin la variable → bloqueado; con la variable → permitido; otra planilla → permitido). **Hoy no está cargada, y la cuenta de servicio probablemente solo tenga lectura**: mientras tanto el CRM se ve y lee, y al intentar guardar muestra el aviso de que no se pudo. Activar la escritura es decisión de RESPONSABLE_HUB y requiere dos cosas: la variable en Vercel y que la cuenta de servicio sea **editora** de la planilla. No se activó ni se escribió nada (en las pruebas con datos reales solo se miró).
- **Rutas:** `/ventas/*` ya estaba como "Google, sección ventas"; se agregó `/marca/*` (logo) como pública para la pantalla de acceso. El tablero `/ventas/admin` exige socio dentro de la página (`requerirAdmin`).

## Qué NO entró (a propósito)

- **Cuotas** (`/cuotas`, plan de cobros, renovaciones): necesita una base Neon propia (`CUOTAS_DATABASE_URL`) y migrar con `scripts/preparar-cuotas.mjs` del ZIP. Se quitó el botón y la sección de la guía. Cuando haya base, se porta como `/ventas/cuotas`.
- Automatizaciones de Make/Calendly (el ZIP tampoco las trae), kit Docker/VPS, manifiesto e íconos propios, login por PIN.
- Pruebas de componentes React del original (necesitan jsdom): las de lógica sí (abajo).

## Estética: la del CRM en todo el dashboard

Paleta oficial (marfil `#f2eadc`, blanco `#fffdf8`, negro `#1d1d1b`, dorado `#be8f49` / oscuro `#805c29`, verde `#012d25`, bordó `#7f202c`), tipografía **Source Serif 4** (con su licencia en `app/(shell)/fonts/`) y radios chicos.

- **CRM:** conserva sus clases tal cual (`@theme` y clases propias sumadas a `app/globals.css`).
- **Shell** (`app/(shell)/cj.css`): los tokens `--cj-*` se redefinieron (fondo marfil, texto negro, acento dorado oscuro); la barra lateral es verde con filete dorado y el **logo oficial** (`public/marca/*`) reemplaza al wordmark de texto. La barra lateral invierte los tokens localmente, así que no hubo que reescribir pantallas. Alcanza a Resumen, Guiones, Clientes, Referidos y `/entrar`. En móvil, dentro del CRM la barra del shell no se queda pegada (se pega el encabezado del CRM, como en el original).
- **Dashboard viejo** (Resumen y lo que usa `var(--bg)`, `--brand-orange`…): las variables de `globals.css` pasaron a la paleta del CRM (el naranja es ahora dorado, el rojo bordó, fondo marfil). El Resumen arranca en claro; el botón "Modo oscuro" sigue y "Descargar PDF" siempre imprime en claro.
- **PWA:** `theme_color` verde, `background_color` marfil, íconos con verde, marfil y dorado.
- **Finanzas y Anuncios** (7/10/2026, después): verdes y dentro del marco del dashboard cuando hay sesión de Google; se abren con su contraseña de siempre. Ver `docs/ACCESO-Y-ROLES.md`, "Finanzas y Anuncios dentro del marco".
- `docs/DISENO-CAPITAL-JURIDICO.md` describe la estética anterior (TINTA/LATÓN, Manual de Identidad de Skyward): esta decisión de RESPONSABLE_HUB la reemplaza.

## Verificación

- `tsc` y eslint limpios en lo tocado. Build de producción en una copia limpia: 0 errores, rutas `/ventas`, `/ventas/admin`, `/ventas/closer/[id]`, `/ventas/guia`, `/ventas/lead/[hoja]/[fila]`.
- **Pruebas de lógica del CRM portadas:** `scripts/crm-tests` (README adentro): **378/378** (motor, pantalla, fechas, ficha, hechas hoy, escritura verificada, log, desplegables, entrada, errores). Cuidado: se corren desde su propia carpeta (`cd scripts/crm-tests && npm install && npx vitest run`); correr `npm install --no-save` desde ahí sin `package.json` propio actualiza `node_modules` de la raíz, cosa que pasó una vez y se revirtió con `npm ci` (package.json y lock quedaron idénticos).
- Suites del dashboard: rutas 298, auth-google 66, auth 6, pantallas 120, clientes 58, créditos 130, panel-referidos 24, alta-referido 34, coordinador-postgres 20, ventas 13, eod 35, anuncios-vista: todas en verde (test-rutas y la matriz de rutas ahora conocen `/marca/*`, el manifiesto marfil/verde y `rutaMenu` del socio).
- Modo producción (valores inventados, sin Google): sin sesión todo `/ventas/*` redirige a `/entrar`, `/marca/*` 200; socio `/ventas` → `/ventas/admin`; closer: `/ventas/admin` y pestañas ajenas → `/ventas`; closer sin pestaña: aviso; setter ídem; csm → `/clientes`.
- Con el servidor de desarrollo (usuario de prueba, datos reales, solo lectura): tablero, Mi día y Resumen renderizan con la estética nueva a 800 px y 390 px; `/entrar` en marfil con el logo.
- **No probado:** escribir en la planilla (bloqueado a propósito), el flujo con una cuenta real de closer, Cuotas.

## Para publicar (pendiente de RESPONSABLE_HUB)

1. Cargar `AUTH_VENTAS_PESTANAS` en Production con los mails de closers y setters (ej.: `{"closer@…":["Closer 1"]}`; pestañas válidas: Closer 1, Closer 2, Closer 3, OPERADOR_AUTORIZADO-OPERADOR_AUTORIZADO Rejunte) y confirmar sus mails/roles en `AUTH_USUARIOS`.
2. Decidir si ya se escribe: dar a la cuenta de servicio permiso de **editora** en la planilla y cargar `PERMITIR_ESCRITURA_ORIGINAL=si`. Hasta entonces el CRM solo lee.
3. **Diff contra la fuente realmente desplegada antes de subir:** el árbol de trabajo difiere de `/tmp/cj-deploy-20261007b` también en `components/LeadQualityCard.tsx`, `lib/analista.ts` y `lib/rawSheets.ts` (cambios de otras sesiones, no de esta). El snapshot `/tmp/cj-dashboard-integrado-1` está obsoleto.
4. Deploy desde la carpeta vinculada (`$APP_DIR`), login real con un closer y con el socio, y reversa por "Promote" del deployment anterior.
