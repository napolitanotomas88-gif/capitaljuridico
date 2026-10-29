> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Programa de referidos: reglas (versión `final-2026-10-08`)

Fuente: documento "Sistema de referidos — Capital Jurídico", corregido por RESPONSABLE_HUB el 6/10/2026 y con las reglas nuevas que decidió el 7/10/2026 (escalera de intentos, beneficios del referido, grabación por zona). **Todo está en modo solo lectura**: el dashboard calcula y muestra, no escribe créditos en ninguna planilla (los constructores de payload siguen en dry-run).

Dónde vive cada cosa:

| Qué | Archivo |
|---|---|
| Todas las reglas, valores, metas y dudas abiertas (la única fuente de números) | `lib/clientes/reglasReferidos.ts` |
| Cálculo de créditos (escalera de cierres, escalera de intentos, USD, tope, liberación, vigencia, ciclo, canje) | `lib/clientes/creditos.ts` |
| Zona de quien refiere según su teléfono (extra de grabación) | `lib/clientes/zona.ts` |
| Metas del mes y KPI de clientes nuevos por referido | `lib/clientes/metas.ts` |
| Embudo, ranking, "cerca del próximo nivel", paso de cada referido | `lib/clientes/programa.ts` |
| Panel por cliente (columnas de `/clientes` y panel de la ficha) | `lib/clientes/panelReferidos.ts`, `lib/clientes/listado.ts`, `lib/clientes/ficha.ts` |
| Pantalla `/referidos` (reglas, metas, resultados) | `app/(shell)/referidos/` |
| Créditos y panel de la ficha del cliente | `app/(shell)/clientes/[id]/_componentes/Creditos.tsx` y `PanelReferidos.tsx` |
| Datos de ejemplo (`?demo=1`, solo en desarrollo) | `lib/clientes/demo.ts` |
| Tests | `scripts/test-creditos.mjs`, `scripts/test-pantallas.mjs`, `scripts/test-panel-referidos.mjs`, `scripts/test-clientes.mjs` |

Para cambiar una regla se edita **solo** `reglasReferidos.ts` (y se sube `version`): el cálculo, las pantallas y los tests leen de ahí. Los textos de las pantallas no tienen números propios (hay un test que lo vigila).

## 1. Tabla de reglas

Estado: **confirmada** = decidida por RESPONSABLE_HUB; **supuesto** = el documento la marca como supuesto; **ambigua** = está en las dudas abiertas (sección 3).

| # | Regla | Valor | Estado | Parámetro |
|---|---|---|---|---|
| 1 | Inicio del programa | 1/10/2026. Los referidos presentados antes no generan nada | confirmada | `vigenteDesde` |
| 2 | Valor de referencia del mes (solo reportes) | USD 650 | confirmada | `valorMesUSD` |
| 2 | Renovación gratis | 4 meses; USD 2.600 en pago único y USD 3.800 en plan de pagos | confirmada | `escalera[3 cierres]`, `renovacionGratis` |
| 3 | Escalera por **cierres liberados**; el nivel alcanzado **reemplaza** al anterior | ver 1.1 | confirmada | `escalera`, `masAllaDeLaEscalera` |
| 3 | **Sin tope de meses** (decisión de RESPONSABLE_HUB, 8/10/2026): los meses de la escalera de cierres y el mes del intento 5 se suman sin límite | sin tope (`null`) | confirmada | `topeMesesAcumulados` |
| 4 | **Intento** = un referido que entra a la llamada y **no cierra** (estado "No cerró"). Los cierres no cuentan como intentos | ver 1.2 | confirmada | `intentos.estado` |
| 4 | Escalera por **intentos** (cantidad acumulada de intentos de quien refiere) | ver 1.2 | confirmada; el contador y los USD 150 son **ambiguos** | `intentos` |
| 5 | Beneficios del referido (el lead) | USD 300 de descuento + 1 mes más de servicio, **solo si se suma en la llamada**: si se va, pierde todos | confirmada; que se haya sumado en la llamada **no se puede verificar** | `referido` |
| 6 | Liberación del crédito de un cierre | cuando entra el primer pago y pasan 14 días sin reembolso | confirmada la regla; **ambiguos** los 14 días | `liberacion.diasSinReembolso` |
| 6 | Reembolso posterior a la liberación | hoy no revierte un crédito ya canjeado | **ambigua** | – (ajuste manual en el libro) |
| 6 | Vigencia de cada premio | 12 meses desde que se gana (liberación del cierre, o llamada del intento); **desde cuándo corre**: hoy desde la liberación | duración confirmada; arranque **ambiguo** | `vigenciaMeses`, `vigenciaDesde` |
| 7 | Canje (meses y USD) | solo contra la renovación de quien refiere, nunca en efectivo; vence si no renueva dentro de la vigencia | confirmada | `canje` |
| 7 | Máximo de nombres por pedido | 3 | supuesto | `pedido.maxNombresPorPedido` |
| 7 | Referido válido | lead nuevo, de otro estudio, que asiste a la llamada; validar "otro estudio" no tiene dato | regla confirmada; control de "otro estudio" **ambiguo** | `referidoValido` |
| 8 | Grabación con cámara profesional (oficinas de Buenos Aires) | **extra** solo si quien refiere está en la zona de Buenos Aires; la ofrece el closer en la llamada de los referidos y confirma | confirmada; la zona es solo una **pista** | `grabacion` |
| 9 | Meta del KPI principal (% de clientes nuevos del mes que entran por referido) | octubre 2026 = 5 %; diciembre 2026 = 10 %; marzo 2027 = 15 a 20 % | confirmada | `metas.kpiPrincipal.hitos` |
| 9 | Indicadores de apoyo | pedido hecho al 60 % de los activos por mes · 8 a 10 % de los activos presentan a alguien por mes · cierre de referidos de 30 % o más · costo por cierre menor a USD 446 | estimaciones **sin verificar** | `metas.apoyo` |

### 1.1 Escalera por cierres liberados (igual que antes)

El nivel alcanzado reemplaza al anterior: **no se suman**.

| Cierres liberados | Lo que gana quien refiere (meses en total) | Valor de referencia (USD) |
|---|---|---|
| 1 | 1 mes de servicio | 650 |
| 2 | 2 meses de servicio + identidad de marca completa (alcance, responsable y plazo por definir) | 1.300 + extra |
| 3 | Renovación gratis de 4 meses | 2.600 en pago único · 3.800 en plan de pagos |
| 4 o más | +1 mes por cada cierre extra, **sin tope** | 650 por cada mes extra (2.600 o 3.800 de la renovación gratis, más 650 por mes) |

Valorización (`valorizarMeses`): 1 mes = USD 650; la renovación gratis vale USD 2.600 (pago único) o USD 3.800 (plan de pagos) y los meses por encima de la renovación se cuentan a USD 650. Por ejemplo, con 8 meses: 2.600 + 4 × 650 = 5.200 (o 3.800 + 4 × 650 = 6.400); con 12, 2.600 + 8 × 650 = 7.800.

### 1.2 Escalera por intentos

Un **intento** es un referido que **entra a la llamada y no cierra** (estado "No cerró") y que se presentó desde el 1/10/2026. Los cierres no cuentan como intentos, y un referido en estado "Asistió" que todavía no tiene resultado tampoco (puede cerrar). Cada premio se gana en la **fecha de la llamada** del intento (o la del pedido, si falta la llamada) y vence a los 12 meses de ganado.

| Intentos acumulados | Lo que gana quien refiere | Cuántas veces |
|---|---|---|
| 1 | **Página web** completa con los servicios específicos del abogado: le queda para siempre, se le entrega el proyecto y se le enseña a editarla | una sola vez por cliente |
| 2 | **Crédito de USD 300** (solo contra la renovación) | cada vez |
| 3 | **Branding** completo: historias, foto de perfil, logo, colorimetría, usos y banner, más 1 carrusel explicativo de lo que hace el estudio | una sola vez por cliente |
| 4 | Otros **USD 300** de crédito | cada vez |
| 5 | **+1 mes de servicio** (se suma a los de la escalera de cierres, sin tope) | cada vez |
| 6 en adelante | **USD 150** de crédito por cada intento adicional, **sin tope** (**tentativo**: se dijo "podríamos ver", duda `credito_150_sin_tope`) | por cada intento |

Los créditos en USD (intentos 2, 4 y 6 en adelante) **no se convierten a meses**: se llevan aparte y se canjean solo contra la renovación, con la misma vigencia. Con 12 intentos, por ejemplo: 300 + 300 + 7 × 150 = USD 1.650.

Qué se calcula (`calcularCreditos`, en `ResumenCredito`):

- `intentos`: cantidad acumulada (el contador **sigue de largo**, no se reinicia por ciclo).
- `premiosIntentos`: cada premio ganado con su fecha, su vencimiento y su estado (`vigente`, `vencido`, o `canjeado` si se consumió en un canje anterior; la página web y el branding no se canjean).
- `paginaWeb` y `branding`: se ganan una sola vez por cliente; solo dependen de la vigencia.
- `mesesPorIntentos`: el mes del intento 5, si es vigente y del ciclo actual.
- `usd`: `ganado` (todo lo ganado por intentos desde el inicio del programa), `usado` (canjes leídos del libro, ver 2.1), `vencido` (del ciclo actual) y `disponible` (del ciclo actual y vigente). `usdPorVencer` sale de los vencimientos de los próximos 60 días.
- `proximoIntento`: qué da el próximo intento.

### 1.3 Ejemplos (resultado de `calcularCreditos`, sin tope de meses)

| Cierres liberados | Intentos | Meses por cierres | Mes del intento 5 | Meses ganados | Renovación gratis | USD ganados | Página web / branding |
|---|---|---|---|---|---|---|---|
| 0 | 1 | 0 | 0 | 0 | no | 0 | web |
| 0 | 3 | 0 | 0 | 0 | no | 300 | web + branding |
| 0 | 5 | 0 | 1 | 1 | no | 600 | web + branding |
| 1 | 0 | 1 | 0 | 1 | no | 0 | – |
| 2 | 2 | 2 (+ identidad de marca) | 0 | 2 | no | 300 | web |
| 3 | 5 | 4 | 1 | 5 | sí (+1 mes) | 600 | web + branding |
| 6 | 5 | 7 | 1 | 8 | sí (+4 meses) | 600 | web + branding |
| 7 | 5 | 8 | 1 | 8 (1 mes no suma) | sí (+4 meses) | 600 | web + branding |
| 0 | 12 | 0 | 1 | 1 | no | 1.650 | web + branding |

El test `0 a 12 intentos combinados con 0 a 8 cierres` recorre las 117 combinaciones contra un cálculo hecho aparte (tablas escritas a mano, sin usar el código).

## 2. Cómo se calcula (resumen)

1. **Inicio del programa.** Un referido cuya fecha de presentación es anterior al 1/10/2026 no genera cierre ni intento (se informa como "anterior al programa"). Fecha de presentación = la del pedido; si falta, la de la llamada; si falta, la del primer pago. Sin ninguna fecha no se puede decir que sea anterior y se evalúa normal. La fecha de "hoy" es la argentina (UTC-3).
2. **Liberación de un cierre.** El crédito se libera el día `primer pago + 14`: con el pago el día D, el D+13 todavía no y el D+14 sí. Un reembolso lo anula siempre. La fecha de liberación de la planilla (fórmula) no se usa: se recalcula.
3. **Vigencia.** Cada premio dura 12 meses desde que se gana (vigente hasta ese día inclusive): el crédito de un cierre, desde su liberación; el premio de un intento, desde la fecha de su llamada.
4. **Ciclos y renovación confirmada.** El canje manual completo contra una renovación cierra los ciclos de meses y USD: lo ganado hasta su fecha queda consumido. Desde la aprobación de RESPONSABLE_HUB del 29/10/2026, confirmar una renovación real aplica automáticamente todos los meses liberados y vigentes, sin consumir USD ni descontarlos del precio. Se registra como movimiento `canje` con Extra exacto `auto_meses_renovacion_v1`: cierra sólo el ciclo de meses. El cálculo mantiene `cicloUsdDesde` separado, determinado únicamente por los canjes manuales completos. El canje de un **extra** (grabación, página web, branding) no corta ninguno de los dos ciclos; la web y el branding no se consumen. Cambiar de etapa, pausar o reactivar tampoco canjea créditos.
5. **Meses.** `meses = meses de la escalera de cierres + mes del intento 5`, sin tope (`topeMesesAcumulados: null`). Si algún día se fija un número, el código lo aplica y los que sobran se informan como "sobre el tope". Los ajustes manuales del libro se suman aparte y el saldo nunca es negativo.
6. **Contador de intentos.** Sigue de largo durante toda la vida del cliente: el primer intento después de un canje es el siguiente número (por ejemplo el 3.º, que da el branding), no un "1.º" nuevo. Por eso la página web y el branding se dan una sola vez.
7. **Todo se canjea contra la renovación.** El crédito no se convierte a plata: los USD son una referencia para reportes en el caso de los meses, y el saldo en USD se lleva aparte.
8. **Grabación (extra por zona).** No es un crédito que se gane solo: ver 2.2.

### 2.1 Créditos en USD y el libro de Créditos

El libro "Créditos" **no tiene columna de USD**. Por eso los canjes en USD se leen del **texto del campo Extra** de los movimientos `canje`, con un patrón tipo `USD 300` (también `usd300`, `U$S 300`, `US$ 300`, `300 USD`, `300 dólares`, `USD 1.200`, `USD 1.200,50`). Si hay más de un monto en el mismo texto se toma el primero y el cálculo deja una advertencia. Un canje sin ese texto **no descuenta USD**, y un movimiento que no es `canje` nunca cuenta.

La marca del canje automático de meses no incluye montos USD. Su renovación y el movimiento se reservan en una misma transacción Postgres y se escriben en un único `spreadsheets.batchUpdate`; no hay una ventana en la que se consuma el crédito sin extender el servicio. Comparte el índice único por cliente y ciclo con el canje manual, por lo que una confirmación concurrente no puede gastar otra vez los mismos meses. Si el saldo cambió desde la revisión, la confirmación devuelve 409 y exige revisar de nuevo. Una renovación que consumió créditos requiere una corrección conjunta, no un deshacer automático.

Limitación y recomendación: leer el texto es frágil (un error de tipeo y el canje no se ve). Se recomienda **sumar una columna "Crédito USD (+/-)"** al libro (positiva al ganar, negativa al canjear). **No se agregó ninguna columna ni se escribió nada en la planilla**; es una decisión de RESPONSABLE_HUB. `planCanje` (dry-run) ya arma el texto del Extra con los USD ("renovación gratis + USD 600") para que se pueda leer de vuelta.

### 2.2 Grabación con cámara profesional: extra por zona

La grabación en las oficinas de Buenos Aires es un **extra** para quien refiere **solo si está en la zona de Buenos Aires**. La zona se deduce del celular del cliente que refiere (Agencia / Consultora) con `zonaPorTelefono` (`lib/clientes/zona.ts`):

- Números de Argentina con código de área 11 = `buenos_aires`. Formas que reconoce: `+54 9 11…`, `+54 11…`, `54 11…`, `0054…`, `011…`, `(011) 15…` y `11…` con 10 dígitos (también con el 15 de celular).
- Todo lo demás (otro código de área, otro país, número incompleto o vacío) = `sin_determinar`. **No es un no**: no se sabe. Una celda con varios teléfonos es de Buenos Aires si alguno lo es.
- Es solo una **pista**. El closer ofrece el extra (pitch) en la llamada de los referidos y lo confirma. Las pantallas lo muestran como "Extra disponible para esta zona: grabación en las oficinas (a confirmar por el closer)", nunca como crédito ganado, y no hay un saldo para llevar.

### 2.3 Beneficios del referido (el lead)

USD 300 de descuento + 1 mes más de servicio, **solo si se suma en la llamada**: si se va, pierde todos (`referido = { descuentoUSD: 300, soloEnLlamada: true, mesesServicioExtra: 1 }`). Esto **confirma** el descuento (ya no es una duda). La planilla Referidos **no tiene un dato de "cerró en la llamada"**, así que no se calcula ni se verifica: queda como duda abierta (`cerro_en_llamada`) y como condición que confirma el closer. Las pantallas lo muestran siempre con esa condición.

## 3. Qué quedó ambiguo y por qué

Son las **diez** dudas que muestran `/referidos` y la ficha, tal cual (están en `dudasAbiertas`, en lenguaje claro, sin identificadores de código). Mientras no se confirmen, el cálculo usa el valor de la columna "Hoy se calcula así".

| Clave | Duda | Hoy se calcula así | Cómo se cambia cuando se confirme |
|---|---|---|---|
| `dias_liberacion` | Una sección del documento perdió el "14 días" | 14 días desde el primer pago, sin reembolso | `liberacion.diasSinReembolso` (y los 14 de la fórmula de la pestaña Referidos, ver `docs/CRM-CLIENTES-TABS.md`) |
| `reembolso_posterior` | La planilla no tiene fecha de reembolso | Un cierre reembolsado no suma; si el crédito ya se canjeó, no se revierte (se corrige a mano con un `ajuste`) | Definir la regla y, si hace falta, sumar una columna "Fecha de reembolso" en Referidos |
| `vigencia_desde` | El documento confirma los 12 meses pero no el punto de partida | Desde la liberación del crédito (o desde la llamada del intento); la alternativa es desde el primer pago | `vigenciaDesde` y `vencimientoDeCredito` |
| `otro_estudio` | No hay dato para validarlo: la planilla no tiene el estudio de quien refiere | Control manual: el referido del mismo estudio se marca como Descartado | Sumar la columna Estudio en Agencia (o "Estudio del referidor" en Referidos) |
| `contador_intentos` | ¿El contador de intentos vuelve a cero en cada ciclo? | No se reinicia (sigue de largo); la web y el branding se dan una sola vez | Pasaría a contarse solo dentro del ciclo (hoy no hay parámetro: sería un cambio en `calcularCreditos`) |
| `credito_150_sin_tope` | Los USD 150 por cada intento desde el 6.º son tentativos ("podríamos ver") y sin tope | Se calculan y suman al saldo en USD sin límite | `intentos.masAllaDeLaEscalera` (`creditoUSD`, `sinTope`, `tentativo`) |
| `cerro_en_llamada` | La planilla Referidos no tiene un dato de que el referido se sumó en la llamada | No se calcula ni se verifica: lo confirma el closer | Sumar una columna (por ejemplo "Cerró en la llamada") en Referidos y leerla |
| `zona_buenos_aires` | El prefijo telefónico (código de área 11) es solo una pista | Con 11 = Buenos Aires; si no se puede deducir, "sin determinar" (no es un no) | `zonaPorTelefono` o una columna "Zona" en la planilla |
| `credito_usd_en_libro` | El libro no tiene columna de USD | Los canjes en USD se leen del texto del campo Extra ("USD 300") | Sumar la columna "Crédito USD (+/-)" y leerla en `calcularCreditos` |
| `entregables` | Falta el alcance fino, el responsable y el plazo de la página web y del branding | Se muestra solo que se ganó y hasta cuándo vale; no hay seguimiento de la entrega | Definir el alcance y, si hace falta, un estado de entrega |

### 3.1 Resueltas (no figuran como duda)

- **Sin tope de meses** (8/10/2026): se quitó el tope de 8 meses; por eso ya no hay duda sobre si el mes del 5.º intento cuenta dentro de él.
- El extra del nivel 2 es la **identidad de marca completa**; su alcance, responsable y plazo siguen por definir (se dice así junto al extra).
- El **descuento del referido es de USD 300**, solo si se suma en la llamada (7/10/2026). Quedó pendiente solo el dato que permitiría verificarlo (`cerro_en_llamada`).
- La **grabación** pasó a ser un extra por zona (7/10/2026); ya no se gana con una llamada y no hay duda sobre el viaje: queda como pista para el closer.
- 1 mes = USD 650.
- El máximo de 3 nombres por pedido es un **supuesto** del documento: figura en las reglas como tal, no como duda.

### 3.2 Decisiones de implementación (no son dudas del documento, pero conviene saberlas)

- **Un cierre no es un intento** y un intento no es un cierre. Un referido en estado "Asistió" todavía no es ninguno de los dos.
- **La fecha de un intento** es la de la llamada; si falta o es ilegible, la del pedido; si no hay ninguna, el intento no cuenta y se avisa. El primer pago no es fecha de intento.
- **Un referido que no es válido** (por ejemplo, ya era contacto del CRM) no suma ni como cierre ni como intento, y deja una advertencia.
- **Los intentos de septiembre o anteriores no cuentan:** el contador arranca el 1/10/2026 (por fecha de presentación).
- **La zona "sin determinar" incluye a quien tiene un celular de otro código de área** (por ejemplo Córdoba o La Plata): no se infiere que no esté en la zona, solo que no se puede asegurar.
- **El nivel 3 reemplaza al 2 también en el extra**: al llegar a 3 cierres deja de figurar la identidad de marca completa.
- **El KPI cuenta como "entró por referido" a un cierre reembolsado**: el cliente entró igual. Un cierre sin "ID cliente nuevo" no se puede ubicar en ningún cliente: no se estima ni se suma, se informa aparte.
- **Entre dos hitos de la meta rige la última fijada** (noviembre de 2026: 5 %; enero y febrero de 2027: 10 %); después de marzo de 2027, el rango de 15 a 20 %. Antes de octubre de 2026 no hay meta.
- **Los ajustes manuales del libro** son una corrección a mano, no un premio. No hay ajustes en USD (no hay columna).
- **En el libro, `ganado_llamada` se lee como "premio ganado por un intento"** (el nombre se conserva porque es el valor de la lista desplegable de la planilla). Solo el mes del intento 5 trae meses; la página web y el branding van con Extra y 0 meses, y los USD no se registran (ver 2.1).
- **La demo calcula con el inicio del programa 14 meses antes de hoy** (solo cambia esa fecha) para poder mostrar créditos liberados, canjeados y por vencer, que con el calendario real no existirían hasta mediados de octubre. La pantalla lo avisa. Todos los clientes son ficticios y llevan "(ejemplo)".

## 4. De dónde sale cada número

| Número | Valor | Fuente | En el código |
|---|---|---|---|
| Inicio del programa | 1/10/2026 | Documento, corregido el 6/10/2026 | `vigenteDesde` |
| Mes | USD 650 | Documento (valores de referencia) | `valorMesUSD` |
| Renovación gratis | 4 meses · USD 2.600 / USD 3.800 | Documento. 4 × 650 = 2.600 (pago único); 3.800 es el valor en plan de pagos | `escalera`, `renovacionGratis` |
| Escalera por cierres | 1 · 2 · 4 meses; +1 por cierre extra | Documento (escalera por cierres) | `escalera`, `masAllaDeLaEscalera` |
| Tope | sin tope | Decisión de RESPONSABLE_HUB, 8/10/2026 (antes: 8 meses en total) | `topeMesesAcumulados: null` |
| Escalera por intentos | web · USD 300 · branding · USD 300 · +1 mes · USD 150 por intento | Decisión de RESPONSABLE_HUB, 7/10/2026 | `intentos` |
| Beneficios del referido | USD 300 de descuento + 1 mes, solo si se suma en la llamada | Decisión de RESPONSABLE_HUB, 7/10/2026 | `referido` |
| Grabación | extra solo en la zona de Buenos Aires (oficinas) | Decisión de RESPONSABLE_HUB, 7/10/2026 | `grabacion` |
| Liberación | 14 días | Documento (mantenido; una sección perdió el número: duda) | `liberacion.diasSinReembolso` |
| Vigencia | 12 meses | Documento (confirmada) | `vigenciaMeses` |
| Máximo de nombres | 3 | Documento, marcado como supuesto | `pedido.maxNombresPorPedido` |
| Metas | 5 % · 10 % · 15 a 20 % | Documento (octubre 2026, diciembre 2026, marzo 2027) | `metas.kpiPrincipal.hitos` |
| Apoyo | 60 % · 8 a 10 % · 30 % o más · USD 446 | Documento (estimaciones sin verificar) | `metas.apoyo` |

## 5. Qué cambió el 7/10/2026

| Antes (6/10) | Ahora (7/10, versión `final-2026-10-07`; el 8/10 se quitó el tope de meses, versión `final-2026-10-08`) |
|---|---|
| Regla anterior de llamadas (una grabación con la primera y un mes cada cierta cantidad) | **Eliminado.** Lo reemplaza la escalera por **intentos** (un referido que entra a la llamada y no cierra): web, USD 300, branding, USD 300, +1 mes y USD 150 por intento desde el 6.º |
| Un cierre contaba también como llamada | Un cierre **no** cuenta como intento; la escalera por cierres sigue igual |
| Tope de 8 meses compartido por la escalera y los meses de la regla anterior de llamadas | 7/10: tope compartido por la escalera de cierres y el mes del intento 5. **8/10: sin tope** |
| Todo el crédito en meses | Los meses siguen igual; los créditos en USD (intentos 2, 4 y 6+) se llevan **aparte**, sin convertir |
| Grabación como crédito ganado automáticamente | Grabación como **extra por zona** (solo Buenos Aires), a confirmar por el closer |
| Descuento de USD 300 al referido pendiente de confirmar (duda) | **Confirmado**, solo si se suma en la llamada; falta el dato para verificarlo (duda `cerro_en_llamada`) |
| 7 dudas abiertas | 11 dudas el 7/10 (se quitaron las del descuento, el viaje y el contador de llamadas; se sumaron las de intentos, USD, zona, entregables y tope). **10 el 8/10**: sin tope ya no hay duda sobre el tope |

## 6. Metas y KPI

**KPI principal:** de los clientes nuevos del mes, qué porcentaje entró por referido.

- *Clientes nuevos del mes* = clientes de Agencia, con ID y que cuentan para las métricas, cuyo **Día 1** cae en ese mes.
- *Entró por referido* = su ID figura como "ID cliente nuevo" en un referido con estado **Cerró** (cada cliente una vez, aunque lo hayan presentado dos).
- El KPI real de `/referidos` es el del mes de hoy (hora argentina), comparado con la meta de ese mes (`kpiClientesNuevosPorReferido`, `metaDelMes`).
- **Estados vacíos honestos:** sin la pestaña "Referidos" en la planilla muestra "sin datos" (no inventa un 0 %); con la pestaña vacía dice "Sin registros todavía" (no ceros como saldo confirmado); sin clientes nuevos en el mes, "todavía no hay clientes nuevos"; antes de octubre de 2026 no hay meta.
- Los indicadores de apoyo (60 %, 8 a 10 %, 30 % o más, menos de USD 446) se muestran como **estimaciones sin verificar**; no se calculan, porque sus denominadores todavía no están definidos.

## 7. Cómo verificar

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-creditos.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-pantallas.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-panel-referidos.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-clientes.mjs
npx tsc --noEmit
```

Pantallas: `/referidos` y `/clientes/<ID>`; con `?demo=1` (solo en desarrollo) muestran datos ficticios rotulados "(ejemplo)". En producción el parámetro se ignora.
