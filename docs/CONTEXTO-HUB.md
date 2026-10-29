# Contexto técnico y funcional del Hub

Actualizado el 29 de octubre de 2026. Este documento conserva decisiones y contratos del producto; no incluye datos de clientes ni reemplaza sus fuentes operativas.

## Recorrido del cliente

Alta → Kickoff → Guiones → Grabación → Edición → Por lanzar → Lanzado → Éxito → Renovación.

La referencia de trabajo confirmada es el documento privado **Sistema de tareas - C.J**, con Grabación e01–e05 y Edición f01–f06. Se verificó el original durante la revisión del 29/10. Las instrucciones posteriores del usuario prevalecen sobre ese documento.

La interfaz debe permitir completar las acciones desde el Despacho y mantener sincronizadas sus fuentes. No considerar que una función quedó probada por haber compilado o por mostrar un botón: comprobar escritura, lectura de vuelta e idempotencia cuando corresponde.

## Clientes y servicio

- Las tarjetas permiten registrar pagos, sumar servicio, pausar, reanudar, registrar renovación o proyección y archivar/restaurar al cliente.
- Archivar requiere doble confirmación; retira de vistas y colas operativas. El historial y los registros contables se conservan.
- Los pagos se reflejan en Finanzas. Las acciones usan vista previa, confirmación, identidad comprobada, historial y reversa cuando es aplicable.
- El servicio puede extenderse por meses, semanas o un período personalizado. La pausa detiene el consumo de días; al reanudar se registra la fecha y se compensa el período pausado.
- Pausa, retoma y cambios relevantes aparecen como eventos en la línea de tiempo.
- Estudio, CSM y Ciudad son campos opcionales del cliente en Agencia y Consultora. Se resuelven por encabezado, no por una posición asumida. Ciudad no se deduce del teléfono y CSM no se copia del closer.
- El catálogo CSM es una configuración de negocio explícita. Asignar un responsable no concede acceso al sistema.

## Referidos

- Un cliente nuevo que entra por referido y cierra recibe **un mes calendario adicional sin cargo**. Verificar que no esté incluido antes de sumarlo.
- El beneficio del cliente referido es distinto de los créditos del referidor.
- Al confirmar una renovación real, aplicar automáticamente los meses de referidos liberados y vigentes según los topes del programa. Registrar renovación y canje juntos, con idempotencia y vista previa de fechas.
- Pausar, reanudar o cambiar de etapa no canjea créditos.
- Los créditos en USD no se consumen automáticamente con los meses. Requieren un canje separado y confirmado.
- No inventar reglas comerciales para los casos que las fuentes todavía marquen como abiertos.

## Kickoff, guiones y Drive

- Las ideas de la llamada de kickoff pasan a la creación de guiones.
- El documento del cliente se localiza o crea automáticamente en Drive y queda vinculado al flujo. Reutilizar el vínculo canónico; no duplicar documentos por diferencias de nombre.
- Cada guion va dentro de su sección plegable **Video** en la **TANDA** correspondiente, conservando el formato previo.
- No agregar guiones sueltos al final ni sobrescribir texto manual que no corresponda a la versión aprobada.
- Cada guion lleva su verificación. La tanda exige un único check final de uno de los revisores humanos autorizados.
- No suplantar al revisor humano ni convertir una comparación automática en su aprobación.
- Con la tanda lista y el documento confirmado, generar el aviso interno de entrega para los responsables configurados. Aviso interno y entrega al cliente son estados diferentes.
- En el contrato legado, `doc.publicada` identifica la versión de aprobación. Una reconciliación debe registrar por separado cuándo se comprobó el contenido; ese token no acredita una fecha histórica de escritura en Drive.
- El ejecutor local conserva bloqueo de concurrencia y respaldo Codex. Revisar sus modos y configuración antes de ejecutarlo contra servicios reales.

## Edición en tarjetas

- Mantener el uso habitual de ClickUp: tarjetas por cliente y video, links de Drive, paleta, estado, comentarios y correcciones.
- Columnas: en espera de datos, para editar, editando, editado, corregido, revisión, publicar y publicado.
- Permitir volver hacia atrás para corregir o revisar, conservando historial y avisando al responsable configurado.
- Los avisos de edición/revisión y video terminado se dirigen al equipo correspondiente. No enviar una entrega al cliente sólo por haber importado una tarjeta histórica.
- Importaciones y reconciliaciones preservan estados, materiales y asociaciones de video; no generan una nueva tanda de mensajes históricos.
- El tablero debe desplazarse horizontalmente dentro de su propio contenedor. `contain: layout paint` evita que las columnas ensanchen toda la página en celular; los diálogos quedan fuera de ese contenedor.

## WhatsApp y avisos

- **WhatsApp permanece apagado** en esta entrega. Su reconexión y activación son un trabajo operativo separado.
- La alerta de tres días sin respuesta es un **aviso interno al equipo**, no un recordatorio automático al cliente.
- Conservar guardas de sesión, habilitación explícita, fecha de corte, vigencia y revisión de destinatarios.
- Los mensajes anteriores al corte no se despachan al reconectar. Se conservan para revisión, sin bloquear la cola vigente.
- Revalidar inmediatamente antes del envío. Limitar los lotes y conservar claves idempotentes; un resultado incierto no autoriza duplicar el envío.
- Encolado, avisado, aprobado y enviado no son sinónimos.

## Interfaz y exportaciones

- Diseño de cristal, fondo difuminado, Atajos con acciones y pendientes, aviso emergente/sonido y presencia con texto legible en blanco.
- La presencia sólo indica conexión a la página; no significa que la persona haya tomado una tarea.
- Anuncios preparados en estado **PAUSED**. Una prueba simulada de publicación no acredita cambios reales en Meta.
- El PDF del Resumen imprime el contenido sin navegación. Los gráficos responsivos y sus leyendas deben ajustarse al papel y conservar ejes, etiquetas y tablas.
- El renderer PDF de Anuncios es un flujo distinto de la impresión del Resumen; verificar ambos cuando se cambian.
- Comprobar diseño responsive con medidas y capturas. La emulación no acredita audio ni comportamiento en un teléfono físico.

## Fuentes, permisos y cambios compartidos

- Sheets/CRM, Finanzas, Drive, base de datos y proveedores externos conservan sus responsabilidades. No inferir datos ausentes ni inventar identidades por similitud de nombre.
- Operaciones reales sólo con configuración y permisos explícitos; las pruebas deben usar fixtures y ámbitos aislados.
- Secretos por cabecera y configuración privada, nunca por URL, código, captura o logs.
- Un cambio debe dejar evidencia verificable sin publicar datos privados.
- Para trabajo en paralelo, consultar el registro privado **Capital Jurídico · Coordinación del equipo**, tomar una tarea con un único responsable y registrar resultado/evidencia.
- Las escrituras del registro usan `requiredRevisionId`; ante conflicto, releer y conservar la toma ajena. Un espejo de notas no sustituye al registro original.
- No trasladar al repositorio público los recibos reales, documentos de clientes, grabaciones, hojas exportadas, sesiones, QR ni el vault completo.

## Verificación y trabajo posterior

Las comprobaciones de esta entrega distinguen implementación, prueba aislada, revisión visual y resultado operativo. Las aprobaciones editoriales, correcciones de videos y entregas a clientes siguen siendo trabajo del equipo sobre sus fuentes privadas.

Antes de declarar un pendiente histórico vigente, contrastarlo con el estado actual. El traspaso antiguo de conversaciones sirve como pista, no como comprobante de publicación o de entrega.
