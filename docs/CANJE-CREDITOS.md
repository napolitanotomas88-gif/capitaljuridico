> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Canje de créditos y contrato de afiliados externos (7/10/2026)

Estado (27/10/2026): **escritor conectado a la ruta, escritura real todavía apagada**. RESPONSABLE_HUB aprobó conectarlo ("El canje real de créditos: conectalo porque ya está diseñado"). Mientras no se cargue `CRM_ESCRITURA_CANJE=real` sigue siendo simulación y no se escribe nada. Responsable: referidos / clientes / créditos.

## Canje contra la renovación

| Qué | Dónde |
|---|---|
| Validación, decisión, huella e idempotencia (puros) | `lib/clientes/canje.ts` |
| Ruta `POST /api/referidos/canje` (socio y csm, mismo origen, JSON) | `app/api/referidos/canje/route.ts` |
| Botón "Canjear crédito" en la ficha (revisar → confirmar) | `components/clientes/CanjeCreditos.tsx`, `app/(shell)/clientes/[id]/_componentes/Creditos.tsx` |
| Pruebas | `scripts/test-canje.mjs` |

Reglas que cumple (sin reglas comerciales nuevas; el cálculo sigue siendo `planCanje` / `saldoCanjeable`):

- **Monedas separadas.** Meses de servicio y USD se muestran, validan y asientan cada uno en su unidad; nunca se suman ni se convierten. El valor de referencia de los meses en USD va rotulado aparte ("no es plata a pagar").
- **Solo contra la renovación** de quien refiere; `contexto: "efectivo"` se rechaza con 422. Se canjea todo el saldo del ciclo.
- **Idempotencia.** `huellaCanje` (cliente, fecha, renovación, meses, USD, versión de reglas, ciclo) + `relacionConPrevia` (misma clave y contenido = misma operación; misma clave y otro contenido = conflicto). Además, al asentarse un canje el saldo del ciclo queda en cero y repetirlo se rechaza por `sin_saldo`; una fecha anterior al último canje se rechaza.
- **Permisos.** La ruta exige sesión de Google y rol que ve Referidos (socio y csm); `rolPuedeCanjear` lo repite. closer y setter: 403. El canje **real** además exige ser RESPONSABLE_HUB, CSM, COORDINACION o COORDINACION (por mail: `lib/clientes/acciones/permisos.ts` → `puedeHacerAcciones`); el resto de socio/csm solo ve la vista previa.
- **Fecha: solo hoy.** El saldo se calcula a hoy; un canje con fecha pasada cortaría el ciclo antes de lo ganado después y lo dejaría disponible otra vez (doble gasto, hallazgo P1 del revisor). Se rechaza (`validacion` y `fecha_retroactiva`) hasta que se defina una regla para canjear "a la fecha"; no se inventó ninguna. Regresión en `test-canje.mjs`.
- **Política de saldo = propuesta.** "Se canjea todo el saldo del ciclo y se cierra" **no está en las reglas fuente** (`reglasReferidos.ts` solo dice contra la renovación, nunca efectivo, vence si no renueva). Se muestra rotulada como propuesta (`POLITICA_SALDO`) en la respuesta y en la pantalla.
- **Escritura.** `estadoEscrituraCanje`: sin `CRM_ESCRITURA_CANJE=real` es simulación; con la bandera y sin Postgres (`DATABASE_URL` + `REFERIDOS_HMAC_SECRET`) responde **503 `sin_base_de_datos`**; con las dos es `real` y la ruta llama a `registrarCanje` (solo la ruta importa el escritor: lo vigila `test-clientes.mjs`). Con `demo` nunca escribe. Nunca responde "guardado" sin escribir.
- **Dos pasos en la pantalla.** `{ vistaPrevia: true }` siempre simula (con escritura real lee el CRM fresco y devuelve `escrituraReal`); recién "Confirmar canje: N meses y USD X" manda el canje real con la MISMA clave de envío (reintentar no duplica).
- **Códigos de la escritura real:** 201 `guardado` ("Canje asentado como M00X"), 202 `pendiente_confirmacion` (reintentar el mismo canje), 409 `rechazado` / `clave_reutilizada` / `conflicto_ciclo`, 422 `validacion`, 403 `sin_permiso` / `sin_permiso_planilla`, 503 `escritura_bloqueada` / `planilla_no_disponible`. Tras guardado o pendiente se invalida el snapshot del CRM para que la ficha se refresque.
- **Lectura fresca.** `leerEstadoFresco` (en la ruta) lee el CRM con `leerClientes({ forzar: true })` y calcula con `calcularCreditosDeDatos`, igual que las pantallas. Si Sheets falla y solo hay datos guardados, no canjea (503).
- Los textos que empiezan con `= + - @` se asientan con apóstrofo (no se interpretan como fórmula).

## Escritor del libro Créditos (conectado a la ruta, detrás de la bandera)

| Qué | Dónde |
|---|---|
| Migración (todavía NO ejecutada en producción) | `lib/clientes/migraciones/002_canjes_reservas.sql` |
| Reservas durables con Postgres (adapter + `reservasCanjeDesdeEntorno`, pool propio `cj-canjes`) | `lib/clientes/reservasCanje.ts` |
| Protocolo del escritor + adaptador Sheets (`planillaLibroReal`, lo usa la ruta) | `lib/clientes/escribirCanje.ts` |
| Pruebas con base y planilla FALSAS | `scripts/test-escribir-canje.mjs` |
| Validación contra Postgres REAL (base de prueba, esquema temporal) | `scripts/validar-canjes-postgres.mjs` |

Protocolo: (1) reintento por (actor, clave) **sin recalcular** → se completa la reserva con su saldo **congelado**, aunque el libro ya refleje el canje; (2) si no hay reserva, lectura fresca + `decidirCanje`; (3) **reserva con COMMIT de fila + ID + saldo congelado antes de tocar el libro**; (4) comprobar que la fila siga libre (o ya tenga nuestro ID) y escribir A:G e I:K (H, "Vence", es fórmula); (5) confirmar. Corte o espera agotada = `pendiente_confirmacion` (nunca guardado). 403 = se libera. Fila ocupada = se descarta y no se reusa.

- **Idempotencia durable:** la huella incluye actor + cliente + fecha + renovación (+ saldo y versión de reglas en la de contenido). Misma (actor, clave) y mismo pedido = misma reserva; otro pedido = `clave_reutilizada` (409); mismo ciclo con otro contenido (u otro actor) = `conflicto_ciclo` (409); mismo canje exacto = no se reserva dos veces.
- **Anti doble gasto sin depender del lock:** índice único parcial por (cliente, ciclo) vivo, más (actor, clave) y fila. El lock solo ordena la asignación; si la conexión se corta, la reserva ya está commiteada y los índices siguen valiendo.
- **Monedas:** en la base, `meses` y `usd` son columnas separadas; en el libro los meses van en F (negativos) y los USD solo como texto en Extra (`USD 300`), como hoy. No se agrega ninguna columna a la planilla.
- **Afiliados externos:** `calcularCreditos` rechaza `X###`; `calcularCreditosDeTodos` y `resumirPrograma` (el camino real de las pantallas) los excluyen (hallazgo P2). Probado en el pipeline, no solo en el helper.

**Límites:** la lógica está probada con mocks. La validación contra Postgres real ya está escrita (`scripts/validar-canjes-postgres.mjs`, gemela de `validar-reservas-postgres.mjs`: exige `TEST_DATABASE_URL` con "test"/"prueba" en el nombre y `CJ_TEST_DB_CONFIRMADO=si`) pero todavía hay que correrla. Nunca se escribió contra el libro Créditos real.

### Qué falta para escribir de verdad

1. Correr `scripts/validar-canjes-postgres.mjs` contra una base de PRUEBA (lo hace el orquestador) y, si pasa, correr la migración **002** en el Neon de producción (la 001 ya corrió el 27/10/2026). Sin la 002, con la bandera puesta la reserva falla y el canje responde 503 sin tocar el libro.
2. Cargar `CRM_ESCRITURA_CANJE=real` en Vercel (decisión de una persona; hoy NO está). `DATABASE_URL` y `REFERIDOS_HMAC_SECRET` ya existen por las altas de referidos.
3. Primer canje real de prueba mirando el libro Créditos (fila, ID `M###`, F negativo, Extra con los USD).
4. Definir la política de saldo (¿todo, o parcial?) y la regla de canje con fecha pasada.
5. Decidir la columna "Crédito USD (+/-)" del libro (duda `credito_usd_en_libro`): hoy los USD van en el texto del campo Extra.

## Contrato de afiliados externos (preparado, sin recompensa)

`lib/clientes/afiliadosExternos.ts`. No hay pestaña, ruta ni pantalla.

- **IDs propios `X###`** (los clientes son `A###`/`C###`; los ejemplos de `?demo=1` son `E###`). Un afiliado externo nunca entra al cálculo de créditos ni al canje (`soloDeClientes`, `decidirCanje` lo rechaza).
- **Recompensa "por definir"** (`RECOMPENSA_AFILIADO_EXTERNO`: sin moneda ni monto). Una alta con cualquier campo de recompensa, comisión, descuento, crédito, monto, USD o meses se **rechaza** en vez de ignorarse.
- **Idempotencia por persona**: mismo afiliado y mismo teléfono (últimos 8 dígitos) = duplicado; otro afiliado = conflicto; afiliado inactivo o inexistente = rechazo.
- **Permisos**: solo el socio gestiona afiliados externos (propuesta conservadora, a confirmar).
- Si algún día hay recompensa, cada moneda va aparte; este contrato no define ninguna.

## Cómo verificar

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-canje.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-escribir-canje.mjs
npx tsc --noEmit
```

Pantalla local: `/clientes/E001?demo=1` (cliente de ejemplo con saldo en meses y en USD) → "Canjear crédito (simulación)" (con `?demo=1` nunca escribe, aunque esté la bandera).
