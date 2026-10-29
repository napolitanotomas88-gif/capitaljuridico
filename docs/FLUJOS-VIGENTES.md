# Flujos vigentes y reglas de autorización

Las identidades de personas y proveedores se configuran fuera de Git. Las denominaciones RESPONSABLE_HUB, COORDINACION, REVISOR_GUIONES, EDITOR y ADS describen funciones; no son una nueva lista de acceso. Los enums técnicos existentes se conservan y el servidor resuelve sus whitelists por configuración.

## Alta, servicio y referidos

Un pago/alta entra como una operación identificada. El motor guarda cada paso y su resultado para reanudar sin repetir efectos: validar datos/comprobante, Finanzas, CRM, Drive, contrato/bienvenida y verificaciones según capacidades habilitadas. Un borrador de contrato no equivale a un contrato enviado o firmado. Sin datos imprescindibles o identidad inequívoca, preguntar al responsable y esperar.

Para un nuevo cliente referido que cierra, sumar **un mes calendario sin cargo** sólo si no está incluido. Registrar la procedencia y la huella para no duplicarlo. Es distinto de la recompensa del referidor.

En renovación real, revisar los meses de referidos liberados/vigentes y los topes. La huella del saldo y las fechas forma parte de la confirmación; reservar canje y renovación juntos, y escribir los movimientos relacionados en el batch del CRM. El replay no vuelve a consumir saldo. No consumir USD ni canjear por pausar, retomar o cambiar de etapa.

## Pausa, retoma y archivo

Pausar registra la fecha y detiene el consumo de servicio. Retomar compensa el intervalo que corresponde, sin contarlo dos veces. La línea de tiempo conserva pausa, retoma, extensión, renovación y hechos relevantes. No desplazar la fecha de proyección usando una duración vieja.

Archivar necesita doble confirmación, ID comprobado y versión actual. Sale de cartera/colas operativas, trabajadores y notificaciones accionables. Se conservan historial y registros financieros. Restaurar es explícito; no reactiva por sí solo entregas antiguas ni borra auditoría.

## Kickoff a guiones

1. Identificar la llamada y deduplicar grabaciones/eventos repetidos. Guardar ficha y las ideas por versión.
2. Mantener rama, zona, presupuesto y faltantes en su contexto. La revisión humana del kickoff y la aprobación final de guiones son controles distintos.
3. Crear la tanda idempotente y resolver el documento automáticamente. Priorizar vínculos exactos del alta, tabla canónica e índices autorizados; usar alias configurados explícitos cuando corresponda. No buscar por parecido ni crear un Doc vacío si existe uno legado verificado.
4. Si hace falta crear, reservar antes el ID CRM, guardar la carpeta y copiar la plantilla por el mecanismo existente. Una respuesta dudosa no autoriza una segunda copia.
5. Generar, revisar y corregir con el motor configurado. Editar un guion invalida su verificación; una corrección selectiva invalida los guiones afectados.
6. Verificar **cada guion** y dar **un único check final humano** de un revisor configurado (`GUIONES_REVISOR_FAUS` o `KICKOFF_REVISOR_TOMI`). El motor no aprueba en nombre de la persona.
7. Escribir bajo **Video** de la **TANDA** correcta con `cargarEnChips`. Conservar contenido manual, clave estable, revisión de publicación y la tanda realmente usada.
8. Notificar a coordinación la versión lista. `/clientes/entregas` exige permiso Clientes y whitelist explícita; confirmar entrega requiere origen, versión y confirmación. Aprobar guiones no manda directamente al cliente.

La marca `doc.publicada` del contrato legado identifica la aprobación; no debe utilizarse para inventar una fecha histórica de edición del Doc. Una reconciliación registra por separado cuándo verificó el contenido.

## Grabación y Edición

El vigía detecta archivos, compara con guiones y prepara observaciones. La comparación automática no sustituye el check humano sobre material, calidad, ortografía y pertinencia.

Las ocho columnas son En espera de datos, Para editar, Editando, Editado, Corregido, Revisión, Publicar y Publicado. Padre, hijo y subtarea anidada son independientes.

- El editor trabaja en sus etapas y materiales permitidos; no aprueba por coordinación.
- Retroceder requiere nota. Distinguir una corrección interna de un pedido del cliente.
- Las notas pendientes del motor vinculado deben resolverse antes de dar por listo.
- La tercera ronda del cliente requiere autorización del responsable con el rol previsto; conservar el tope de dos rondas sin esa autorización.
- Pasar explícitamente de Editado/Corregido a **Revisión** exige check autorizado y link válido. Encola una entrega de esa revisión.
- **Publicar** es una etapa, no una orden a Meta. **Publicado** necesita una cita real del OK del cliente y prepara el handoff a Ads.
- Antes de despachar, comprobar CRM actual, tarjeta, token de revisión y link. Una corrección, archivo o cambio de material invalida una entrega vieja. Los comentarios no regeneran tokens ni duplican envíos.
- Una importación conserva la procedencia y no genera notificaciones. Un histórico finalizado sin cita de OK no se transforma en una aprobación inventada.

Las correcciones internas se agrupan por cliente/destinatario y ventana. Las salidas del editor se avisan por lote completo o por su ventana de espera; no inundar Discord con un mensaje por video cuando corresponde un lote.

## Anuncios, éxito y offboarding

Los anuncios se preparan **apagados (`PAUSED`)**. Conservar revisión, permisos y el registro idempotente antes de cualquier operación externa. Simulación no acredita una campaña creada en Meta.

Éxito/testimonio/proyección usan señales y revisiones del dominio; no inferir una promesa alcanzada o un OK de cliente a partir de una columna distinta. En offboarding conservar aprobaciones y capacidades independientes. El diseño histórico de borrados automáticos no amplía la autorización actual de archivo reversible.

## WhatsApp y control de inactividad

**WhatsApp está APAGADO.** Configurar un token o ver el número conectado no habilita entregas. La activación requiere una orden operativa específica, modo real, salud del número y corte temporal. No cambiar el corte para forzar mensajes históricos.

La alerta a tres días sin respuesta es **interna al equipo**. Registrar actividad real con su fecha: equipo cuando confirma la entrega, cliente cuando llega una respuesta identificada. Un webhook tardío no retrocede el reloj.

Una outbox «enviando» con resultado incierto exige reconciliación. Reintentar notificaciones internas fallidas conserva el mismo lote/clave. Nunca presentar «encolado», «avisado» o «aprobado» como «entregado» sin constancia.
