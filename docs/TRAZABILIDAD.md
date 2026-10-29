> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Trazabilidad (`/trazabilidad`)

Sección del Despacho armada el 21/10/2026 a partir de la clase de trazabilidad de Paolo (mentoría de Mati y Rama).
Responde una pregunta: **qué contenido trae a los leads que pagan**. Todo es descriptivo: los porcentajes los calcula el
código; la IA solo extrae datos de chats y llamadas, nunca saca conclusiones.

## Método

- **Muestra**: cierres de front-end del CRM de ventas («Cerrado en llamada» o «Cerrado en seguimiento») que cobraron
  **USD 1.100 o más** (1ª cuota del plan en 3 de 3.300). Se toma el mayor entre *Cash Collected Día 1* y *Trato Cerrado*.
  Umbral configurable con `TRAZ_UMBRAL`.
- **Contraste**: el resto de los cierres (señas, parciales). Sirve para ver qué ángulos atraen a quien paga poco.
- **Tres capas por cierre**: closing (CRM), setting (botonera de ManyChat) y llamada (Fathom).
- Con menos de **120** cierres en la muestra el análisis es **direccional**: la pantalla lo avisa siempre.

## Pantallas

| Ruta | Qué muestra |
|---|---|
| `/trazabilidad` | Cierres por mes, grupo (muestra / contraste) y estado de sus capas. Botón «Procesar pendientes». |
| `/trazabilidad/lead/<clave>` | Ficha: CRM, setting analizado (piezas consumidas, gatillo, ciclo, seguimientos) y llamada analizada (dolores con cita, objeciones, arquetipo). Vincular, pegar a mano, reanalizar. |
| `/trazabilidad/reporte` | Reporte del período: ángulo gatillo contra presencia en el recorrido (lectura fija Dispara / Atrae / Mixto), piezas gatillo, bolsas, origen, ciclo de agenda por tramo, seguimientos, dolores de llamadas (los NUEVOS = fuera del catálogo), arquetipos, contraste e individual. |
| `/trazabilidad/semanal` | Semana domingo–sábado: EOD de la setter por día (recalculado con `lib/eodSetter.ts`) y agendas que pasaron por la botonera, con la bola de nieve de 14 días. |
| `/trazabilidad/angulos` | Catálogo de ángulos (semilla: estrategia del motor de contenido) con su bolsa, y asignación pieza → ángulo. Lo manual manda sobre lo que propone la IA. |
| `/trazabilidad/botonera` | Instalación y estado de la configuración. |

## Datos

- Neon (`DATABASE_URL`), tablas `cj_traz_setting`, `cj_traz_llamada`, `cj_traz_vinculo`, `cj_traz_piezas`, `cj_traz_angulos`
  (se crean solas, `lib/trazabilidad/db.ts`).
- CRM de ventas: solo lectura (`lib/trazabilidad/cierres.ts`, pestañas de `PESTANAS_VENTAS`, A:AH).
- Clave de un cierre: `pestaña|nombre normalizado|fecha de la llamada`. Si se cambia el nombre o la fecha en la planilla,
  el cierre pierde su llamada y su vínculo (hay que volver a traerlos).

## Entradas

- **Botonera** (extensión de Chrome, carpeta `docs/botonera-despacho`, copia de la v2.6 de Paolo con el
  botón «📤 Enviar al Despacho»): `POST /api/trazabilidad/botonera` con `Authorization: Bearer <TRAZABILIDAD_KEY>`.
  Guarda resumen, etiquetas, campos y chat; el análisis corre después de responder (`after`).
- **Fathom**: `FATHOM_API_KEYS` = `{"CUENTA_QA":"…","CUENTA_QA":"…"}` (una clave por closer: las grabaciones están en la cuenta de
  cada uno; la de RESPONSABLE_HUB no las ve). Se busca la reunión por el link de la planilla (Grabación 1–3) o por mail del lead ±2 días.
- **Cron** `GET /api/trazabilidad/procesar` (10:00 UTC = 7:00 AR, Bearer `CRON_SECRET`): analiza envíos pendientes (12) y
  trae llamadas (8). Una llamada no encontrada se reintenta a las 20 h.
- **ManyChat (API pública)**: `MANYCHAT_API_KEY`. `GET /api/trazabilidad/manychat` (Bearer `CRON_SECRET`) busca cada cierre sin setting en ManyChat por mail, teléfono (+549…) o nombre único y, con `?escribir=1`, guarda sus etiquetas y campos como envío `ManyChat API` (sin chat) y lo vincula; un envío de la botonera del mismo contacto no se pisa. El cron diario importa hasta 25 cierres nuevos por corrida.
- **Cron** `GET /api/trazabilidad/semanal` (lunes 11:00 UTC = 8:00 AR): manda a Discord la semana domingo–sábado (EOD por día, agendas de la botonera, cierres a los que les falta setting o llamada). Canal `TRAZ_DISCORD_WEBHOOK` o el de enrutamientos. `?preview=1` para ver el texto.

## Variables

| Variable | Para qué |
|---|---|
| `TRAZABILIDAD_KEY` | Clave que se carga en la botonera de cada setter. |
| `FATHOM_API_KEYS` / `FATHOM_API_KEY` | Lectura de llamadas. |
| `ANTHROPIC_API_KEY` | Análisis (modelo `TRAZ_MODELO`, por defecto `claude-opus-5-5`, esfuerzo medio). |
| `MANYCHAT_API_KEY` | Etiquetas de ManyChat de cada cierre (contenido consumido) sin la botonera. La carga RESPONSABLE_HUB. |
| `TRAZ_UMBRAL` | Opcional, USD (por defecto 1100). |

## Pruebas

`node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-trazabilidad.mjs` (muestra, vínculo, ciclo,
lectura y reporte, sin red). Las rutas nuevas están en `lib/auth/rutas.ts`, en el matcher de `proxy.ts` y en
`docs/ACCESO-Y-ROLES.md` (lo controla `scripts/test-rutas.mjs`).
