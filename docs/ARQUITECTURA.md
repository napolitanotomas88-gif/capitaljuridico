# Arquitectura y fuentes de verdad

El Hub es una aplicación Next.js 16 con App Router, React 19 y TypeScript. La versión exacta está en `package.json`; consultar la documentación de Next incluida con la dependencia antes de cambiar rutas, caché, configuración o middleware.

## Capas

| Capa | Responsabilidad | Fuentes |
|---|---|---|
| Shell autenticado | Navegación, Atajos, presencia, notificaciones, permisos de interfaz | `app/(shell)`, `components/shell`, `lib/auth`, `lib/presencia`, `lib/notificaciones` |
| API | Sesión/rol, validación, mismo origen, firma o Bearer de integración, respuestas estables | `app/api`, `lib/auth/rutas.ts`, `proxy.ts` |
| Dominio | Fechas, elegibilidad, transiciones, planes y huellas | `lib/clientes`, `lib/bot`, `lib/edicion`, `lib/anuncios` |
| Adaptadores | Google, PostgreSQL/Neon, Drive Bridge, Meta, Fathom, PandaDoc, Whapi y Discord | Módulos servidor de cada dominio |
| Trabajadores | Reanudación de pasos, notificaciones y procesamiento asíncrono | Crons declarados, vigía y ejecutor local |
| Verificación | Fixtures, pruebas puras, SQL falso, harnesses aislados y revisión visual | `scripts/test-*.mjs`, suites específicas, documentación de QA |

La UI muestra capacidades; el servidor vuelve a autorizarlas. No confiar en un botón oculto, un parámetro de query o un rol enviado por el navegador como autorización.

## Responsabilidad de cada fuente

- **CRM en Sheets:** identidad estable, estado de servicio, fechas, renovaciones, datos del cliente y reglas de referidos/créditos según encabezados. Agencia y Consultora son líneas distintas con búsqueda por ID único.
- **Finanzas:** ledger de cobros y conciliación de lo contratado/cobrado. Un cambio de servicio o una pausa no inventa un pago. La visualización financiera usa sus adaptadores, no un número escrito en una tarjeta.
- **PostgreSQL:** reservas durables, pasos, historial, versiones, deduplicación, revisiones, notas y outbox. Las tablas no sustituyen una lectura actual del CRM para autorizar un envío.
- **Drive/Docs:** materiales y documento canónico del cliente. Guardar IDs exactos y comprobar metadata. Un título parecido no prueba identidad.
- **Fathom:** llamadas fuente. Su extracción es una propuesta estructurada; no convierte una afirmación de la transcripción en aprobación humana.
- **ClickUp:** origen histórico de importación. Las tarjetas del Hub conservan jerarquía y estado independiente; importar no escribe en ClickUp ni envía mensajes.
- **Meta:** lectura de métricas y operaciones de anuncios autorizadas. «Publicado» en Edición no activa Meta. Los anuncios preparados permanecen `PAUSED`.
- **Whapi/Discord:** transporte de mensajes, no fuentes de autorización. WhatsApp está apagado en esta entrega.

## Patrón de una acción de cliente

1. Validar actor, sección y capacidad, origen y cuerpo.
2. Leer identidad y celdas actuales; preparar una vista previa y huella.
3. Confirmar con la misma clave y precondiciones. Reservar durablemente antes del envío.
4. Congelar rangos/valores y escribir el batch permitido en Sheets.
5. Leer de vuelta y confirmar historial/resultado. El replay de la misma clave devuelve el mismo resultado.
6. Si la respuesta externa quedó incierta, reconciliar. Una clave nueva no sirve para esquivar un intento pendiente.

Sheets no proporciona CAS de valores ni una transacción distribuida con PostgreSQL. Por eso se combinan reservas, revisión fresca, rangos congelados y verificación posterior. Una reversa sólo se admite cuando sus precondiciones prueban que no se pisan cambios humanos o consecuencias irreversibles.

## Tarjetas y motor de Edición

`tarjetasDb.ts` guarda tarjeta, evento, operación idempotente, outbox y video vinculado en una transacción. Comprueba identidad y versión de ambos. Mover un padre no modifica hijos. El sincronizador del motor utiliza estado/versiones actuales y omite eventos nacidos en tarjetas para no crear bucles. Los históricos finalizados sin cita de OK quedan protegidos, no convertidos en aprobaciones ficticias.

La outbox se despacha separadamente, revalida el destino antes del efecto y conserva resultados ambiguos. Notificación interna y envío al cliente son canales distintos.

## Caché y frescura

Las métricas toleran caché con sus marcas de actualización. Los permisos, la identidad operativa y el guard antes de un envío requieren su fuente vigente. Una lectura fallida no autoriza usar un snapshot viejo. Los lotes pueden compartir una lectura fresca dentro de su contexto; antes del efecto externo se vuelve a comprobar lo exigido por el módulo.

## Despliegue y ejecución local

La aplicación se publica con configuración privada del entorno. Los workers locales de guiones son procesos separados, con candado y credenciales propias. Clonar el repositorio no instala launchd, crons, activadores de Apps Script ni autoriza mensajes. El respaldo Codex conserva el contrato de guiones y las guardas del ejecutor principal; no amplía permisos.

El PDF semanal de Anuncios se genera con `pdf-lib` y fuentes descargadas. El PDF de Resumen usa impresión del navegador y CSS de papel. Requieren QA diferente; que uno funcione no prueba el otro.
