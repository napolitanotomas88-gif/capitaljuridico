> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# CRM de clientes: pestañas nuevas "Referidos" y "Créditos", y altas de clientes

Diseño del 6/10/2026, con las reglas del 7/10/2026 (`final-2026-10-07`; todas están en `docs/REGLAS-REFERIDOS.md`). **No se creó ni se escribió nada en la planilla**:
todo esto está documentado y, donde hace falta, como payload dry-run que solo se imprime.

Planilla: "2026 - CRM - CLIENTES" (`SHEET_ID_CLIENTES`). Código: `lib/clientes/` (la fuente única del diseño de las
pestañas es `lib/clientes/pestanasNuevas.ts`; las reglas del programa, `lib/clientes/reglasReferidos.ts`).

## 1. Cómo se reparte el trabajo

- **Referidos** guarda los hechos: quién refirió a quién, qué pasó con la llamada, cuándo entró el primer pago y si hubo reembolso.
- **Créditos** es el libro de movimientos: lo que se ganó (para auditar), los canjes contra renovaciones, los vencimientos y los ajustes manuales. Se agregan filas, no se editan las anteriores.
- **El dashboard calcula** (`lib/clientes/creditos.ts`) con los datos de Referidos y del libro. Las fórmulas de la planilla (liberación, vence) son informativas: si alguien las pisa, el saldo no cambia.
- Todo el texto de interfaz y de la planilla va en español rioplatense. Los encabezados de abajo son los que `parsear.ts` lee (hay un test que lo verifica); las columnas se buscan por encabezado, nunca por letra.

## 2. Pestaña "Referidos" (una fila por referido, hasta 3 por pedido)

| Col | Encabezado | Tipo | Obligatoria | Validación | Fórmula |
|---|---|---|---|---|---|
| A | ID | texto | sí | `R001`, `R002`… sin repetir (bloquea) | no (lo asigna el dashboard; a mano, el siguiente libre) |
| B | Fecha del pedido | fecha | sí | fecha válida | no |
| C | Momento | lista | sí | Post-kickoff · Primer win · Reporte de fin de mes · Llamada de proyección | no |
| D | ID referidor | texto | sí | tiene que existir en `Agencia!A` (avisa, no bloquea) | no |
| E | Nombre | texto | no | – | no |
| F | Teléfono | texto | sí | – (sirve para verificar que sea un lead nuevo) | no |
| G | Mail | texto | no | si se completa, que parezca un mail (avisa) | no |
| H | Estudio | texto | sí | – (tiene que ser distinto al del que refiere) | no |
| I | Estado | lista | sí | Presentado · Asistió · No asistió · Cerró · No cerró · Descartado | no |
| J | Fecha de llamada | fecha | si Asistió/Cerró/No cerró | fecha válida; **queda en rojo si falta** | no |
| K | ID cliente nuevo | texto | si Cerró | tiene que existir en `Agencia!A` (avisa); **rojo si Cerró y falta** | no |
| L | Fecha del primer pago | fecha | si Cerró | fecha válida; **rojo si Cerró y falta** | no |
| M | Fecha de liberación | fecha | – | – | **sí**: `=IF(OR($L2="",$N2="SI"),"",$L2+14)` |
| N | Reembolso | lista | no | SI · NO | no |
| O | Notas | texto | no | – | no |
| P | Cargado por | texto | no | – (el dashboard lo completa solo) | no |
| Q | Referidor (nombre) | texto | – | – | **sí** (ayuda visual, no la lee el dashboard): `INDEX/MATCH` del ID contra Agencia |

- Flujo del estado: Presentado → (Asistió | No asistió) → (Cerró | No cerró). Descartado si el referido no es válido (lead nuevo, de otro estudio, que asiste).
- Las columnas M y Q van protegidas **con aviso** (se pueden editar, pero avisa). El 14 de M sale de `REGLAS_REFERIDOS.liberacion.diasSinReembolso`: si cambia la regla, se cambia en los dos lugares (el dashboard igual recalcula con el valor del código).
- Formato condicional: Cerró en verde suave; No asistió y Descartado en gris; los tres campos obligatorios faltantes en rojo suave.

## 3. Pestaña "Créditos" (libro de movimientos)

| Col | Encabezado | Tipo | Obligatoria | Validación | Fórmula |
|---|---|---|---|---|---|
| A | ID | texto | sí | `M001`, `M002`… sin repetir (bloquea) | no |
| B | Fecha | fecha | sí | fecha válida | no |
| C | ID cliente | texto | sí | tiene que existir en `Agencia!A` (avisa) | no |
| D | Tipo | lista | sí | ganado_cierre · ganado_llamada · canje · vencimiento · ajuste | no |
| E | Referido | texto | no | tiene que existir en `Referidos!A` (avisa) | no |
| F | Meses (+/-) | número | sí | ganado ≥ 0 · canje y vencimiento ≤ 0 · ajuste libre (bloquea) | no |
| G | Extra | texto | no | – (en un canje, los USD canjeados con el patrón `USD 300`: el libro no tiene columna de USD) | no |
| H | Vence | fecha | – | – | **sí** en ganado_*: `=IF(OR($D2="ganado_cierre",$D2="ganado_llamada"),IF($B2="","",EDATE($B2,12)),"")`; en un ajuste con vencimiento se escribe a mano encima |
| I | Renovación aplicada | texto | si Tipo = canje | rojo si es canje (que no es de un extra: grabación, página web o branding) y falta | no |
| J | Nota | texto | no | – | no |
| K | Cargado por | texto | no | – | no |

Qué fila se escribe y cuándo:

| Evento | Tipo | Fecha | Meses | Extra |
|---|---|---|---|---|
| Intento 1 (un referido entra a la llamada y no cierra) | ganado_llamada | día de la llamada | 0 | `página web` (una sola vez) |
| Intento 3 | ganado_llamada | día de la llamada | 0 | `branding` (una sola vez) |
| Intento 5 | ganado_llamada | día de la llamada | +1 | – |
| Un cierre se libera (primer pago + 14 días, sin reembolso) | ganado_cierre | día de la liberación | lo que **sube** el total (ver abajo) | `identidad de marca completa` en el 2.º cierre |
| Se aplica contra una renovación | canje | día de la renovación (**corta el ciclo**) | `-` el saldo (todo) | `renovación gratis` si corresponde y los USD canjeados (`USD 600`) |
| Se entrega la grabación, la página web o el branding | canje | día de la entrega | 0 | `grabación` / `página web` / `branding` (no corta el ciclo) |
| El crédito pasó los 12 meses sin canjearse | vencimiento | día del vencimiento | `-` lo vencido | – |
| Corrección manual | ajuste | día | +/- | motivo en Nota |

Los créditos en USD de los intentos 2, 4 y 6 en adelante **no tienen columna** en el libro: el dashboard los calcula desde los referidos y lee los canjes en USD del texto del campo Extra (`USD 300`). Se recomienda sumar una columna "Crédito USD (+/-)" (no se agregó: es una decisión de RESPONSABLE_HUB).

Como el escalón alcanzado **reemplaza** al anterior, los meses de cada `ganado_cierre` son el incremento del total: 1.º cierre +1 (total 1), 2.º +1 (total 2), 3.º +2 (total 4: renovación gratis), 4.º en adelante +1 por cierre. Los cierres y el mes del intento 5 se suman **sin tope de meses** (se quitó el tope de 8 el 8/10/2026).

## 4. Cómo se crearían las pestañas (solo dry-run)

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/crm-referidos-tabs.mjs          # resumen
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/crm-referidos-tabs.mjs --json   # batchUpdate completo (~290 KB)
```

El script solo imprime: no importa googleapis, no lee credenciales y rechaza cualquier flag que no sea `--json` (no existe un flag para enviarlo; hay un test que lo verifica). El batchUpdate trae 70 pedidos: crea las dos hojas con `sheetId` propios (7100001 y 7100002, que no existen hoy), escribe encabezados y fórmulas fila por fila, aplica validaciones, formatos de fecha, filtro básico, rangos protegidos con aviso y el formato condicional. El estilo del encabezado es el de las demás pestañas del CRM (fondo oscuro, texto naranja), porque la planilla no es parte del rebranding.

Antes de aplicarlo de verdad (decisión aparte, con permiso de escritura que esta capa no tiene): confirmar que las pestañas siguen sin existir (`datos.pestanasAusentes`), hacer una copia de la planilla y cargar primero una fila de prueba.

## 5. Altas de clientes: la trampa conocida

El equipo suele cargar clientes **sin ID y sin fórmulas**. Todas las fórmulas de Agencia (J a N) empiezan con `=IF($A2="","",…)`: sin ID no calculan, y las filas que se agregan al final muchas veces no traen las fórmulas copiadas. Consecuencias: sin fin de período, sin LTV ni duración, semáforo en gris y el cliente queda fuera de las métricas (solo cuentan las filas con ID). Además "LTV cobrado" busca los pagos por los **últimos 7 dígitos del celular** o por el nombre normalizado (minúsculas, sin acentos): sin celular y nombre bien cargados queda en 0. Y sin la fila del período 0 en Renovaciones, "LTV contratado" da 0 y el fin de período cae al valor por defecto (Día 1 + 4 meses).

Lo que se vio en la lectura real del 6/10/2026 (solo números e IDs):

- Las 150 filas (140 Agencia + 10 Consultora) tienen ID, así que hoy no hay filas sin ID.
- **Z003 a Z004** (filas 132 a 141) tienen ID y Día 1 pero **les faltan las fórmulas de LTV contratado, LTV cobrado y Duración (L:N)**; a **Z005** le faltan M:N (en esas filas el fin de período sí aparece, por el valor por defecto de Día 1 + 4 meses). Además hay **12 clientes sin período 0 en Renovaciones** (Z006 y Z005 a Z004), o sea sin precio inicial cargado.
- Las columnas **A y B de Agencia no tienen encabezado** (ID y Nombre). Hoy se leen "junto a Estado" y el diagnóstico lo marca; conviene ponerles "ID" y "Nombre" en la planilla.
- Las fórmulas están en J (Fin período actual), K (Renovó), L (LTV contratado), M (LTV cobrado) y N (Duración). Las filas de Renovaciones no tienen fórmulas (se cargan a mano). "Fin período actual" toma el máximo de Finalización en Renovaciones y, si no hay, Día 1 + 4 meses.

`lib/clientes/altas.ts` arma, sin escribir nada, el plan completo de un alta (`planAlta`) y el de reparación de lo que ya está incompleto (`planReparacionFormulas`):

1. ID correlativo: el mayor entre Agencia y Renovaciones más uno (hoy sería Z007). Nunca reutiliza uno.
2. Fila de Agencia (por encabezado, sin tocar las columnas con fórmula): ID, nombre, ACTIVO, celular, mail, closer, fuente, contrato, Día 1 como número de serie y anotaciones.
3. Pedido de copiar las fórmulas de J:N de la **fila 2** a la fila nueva (`copyPaste` con `PASTE_FORMULA`; el `sheetId` queda como pendiente de leer con `spreadsheets.get`).
4. Fila del período 0 en Renovaciones: Día 1, Finalización = Día 1 + 4 meses (como ya hace el equipo), precio inicial y la nota habitual "período inicial cargado por el dashboard". La columna Meses solo se completa si no son 4.
5. Control de duplicados por celular (7 dígitos), mail y nombre: un cliente vigente bloquea el alta; un finalizado solo avisa.

**Precio inicial.** No hay una pestaña de precios: `lib/clientes/precios.ts` es un borrador sin verificar armado con lo que muestran los períodos 0 (2.600 es el más usado y el que el equipo anota como "precio ASUMIDO"; 3.300 aparece en las altas de septiembre) y con la bóveda (tarifa estándar 3.800 y pago completo 3.300 desde el 17/6). El plan avisa siempre de dónde salió el precio y que hay que confirmarlo.

## 6. Dudas abiertas (también en `REGLAS_REFERIDOS.dudasAbiertas` y, con el porqué de cada una, en `docs/REGLAS-REFERIDOS.md`)

- Días de espera para liberar un crédito: se mantienen 14, pero una sección del documento perdió el número.
- Reembolso posterior a la liberación: no hay columna de fecha de reembolso; si el crédito ya se canjeó, se corrige con un movimiento `ajuste`.
- Vigencia de 12 meses (confirmada): desde cuándo corre. Hoy, desde la liberación del crédito (o desde la llamada del intento); la alternativa es desde el primer pago.
- Referido de otro estudio: sin dato para validarlo; control manual (el del mismo estudio se marca como Descartado).
- Contador de intentos: si vuelve a cero en cada ciclo. Hoy sigue de largo; la página web y el branding se dan una sola vez.
- Crédito por intento desde el 6.º (USD 150, sin tope): tentativo.
- Beneficios del referido (USD 300 de descuento y 1 mes más): valen solo si se suma en la llamada; la planilla Referidos no tiene un dato para verificarlo.
- Zona de Buenos Aires para la grabación en las oficinas: se deduce del teléfono (código de área 11) y es solo una pista.
- Créditos en USD: el libro no tiene columna de USD; se leen del texto del campo Extra y se recomienda sumar "Crédito USD (+/-)".
- Entregables (página web y branding): falta el alcance fino, el responsable y el plazo.
