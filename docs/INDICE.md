# Documentación técnica del Hub

Esta edición pública conserva arquitectura, contratos, guardas, procedimientos y diseño. No contiene el estado operativo de los clientes ni credenciales. Los ejemplos `Z001`, `Z002` y `CUENTA_QA` son ficticios; los marcadores requieren configuración privada y no se ejecutan tal cual.

## Leer primero

1. [Contexto y decisiones vigentes](CONTEXTO-HUB.md).
2. [Arquitectura y responsabilidades](ARQUITECTURA.md).
3. [Flujos vigentes e invariantes](FLUJOS-VIGENTES.md).
4. [Configuración privada](CONFIGURACION-PRIVADA.md).
5. [Datos y migraciones](DATOS-Y-MIGRACIONES.md).
6. [Operación, publicación y recuperación](RUNBOOK.md).
7. [Pruebas y límites de evidencia](VERIFICACION.md).

## Contratos por área

| Área | Documentos |
|---|---|
| Identidad y autorización | [Acceso y roles](ACCESO-Y-ROLES.md) |
| Clientes, fechas y campos | [Servicio](REGLAS-SERVICIO.md), [campos](CLIENTES-CAMPOS-20261029.md), [tabs](CRM-CLIENTES-TABS.md), [guiones en la ficha](CLIENTES-GUIONES.md) |
| Referidos | [Reglas](REGLAS-REFERIDOS.md), [registro](REGISTRAR-REFERIDO.md), [canje](CANJE-CREDITOS.md), [esquema Sheets](SPEC-PESTANAS-REFERIDOS-CREDITOS.md) |
| Alta y Drive | [Alta](BOT-ALTA-CJ.md), [bienvenida y borradores](BOT-BIENVENIDA-BORRADOR.md) |
| Kickoff y guiones | [Kickoff](BOT-KICKOFF-CJ.md), [motor de guiones](BOT-GUIONES-CJ.md), [documento y handoff](GUIONES-ENTREGA-20261028.md) |
| Grabación y Edición | [Tarjetas actuales](EDICION-TARJETAS-20261029.md), [bot](BOT-EDICION-CJ.md), [motor](edicion/MOTOR.md), [avisos](edicion/AVISOS.md), [pantalla](edicion/PANTALLA.md) |
| Anuncios | [Bot](BOT-ANUNCIOS-CJ.md), [Fathom](FATHOM-ANUNCIOS.md) |
| Éxito y bajas | [Éxito](BOT-EXITO-CJ.md), [bajas](BOT-BAJAS-CJ.md) |
| Prueba con cliente ficticio | [Punta a punta y limpieza](PRUEBA-PUNTA-A-PUNTA.md) |
| Ventas, cuotas y atribución | [Ventas](CRM-VENTAS-INTEGRADO.md), [integración](VENTAS-INTEGRACION.md), [contrato histórico](CRM-VENTAS-JERO.md), [cuotas](CUOTAS.md), [trazabilidad](TRAZABILIDAD.md), [atribución](EOD_ATRIBUCION_HISTORIAS.md) |
| Presentación | [Diseño](DISENO-CAPITAL-JURIDICO.md), [relevamiento histórico saneado](RELEVAMIENTO-EDICION-CJ.md) |
| Mensajería | [Whapi](BOT-WHAPI-CJ.md), [guardas vigentes](FLUJOS-VIGENTES.md), [WhatsApp de la bandeja al equipo](NOTIF-WHATSAPP.md) |

Los documentos heredados preservan decisiones técnicas fechadas. Sus estados «pendiente», «sin publicar» o resultados de pruebas históricas no describen automáticamente una instalación nueva. No usar un documento histórico para saltar las reglas vigentes o activar servicios externos.

## Apps Script

El puente principal saneado está versionado en `integrations/apps-script/Codigo.gs` y su dispatch conecta `cargarEnChips`. `guiones/puente/GuionesChips.gs` conserva la carga idempotente bajo chips; `edicion/puente/Vigia.gs` contiene el disparador sin destino por defecto. Los tres pertenecen al mismo proyecto, sin duplicar archivos. Requieren Script Properties privadas y no se despliegan ni instalan activadores al clonar. No se incluyen manifest o configuración `.clasp` privados ni se acredita un despliegue real por versionar estos archivos.

## Material deliberadamente excluido

No se importaron estado raw del dashboard, historial de cobros/clientes, previews operativos, recibos y planes de publicación con datos, capturas, dumps, parches compartidos obsoletos ni registros del vault. Las reglas útiles se reescribieron como contratos sin casos reales. No hay enlaces de acceso a entornos, Sheets, Drive, canales o grabaciones privadas.
