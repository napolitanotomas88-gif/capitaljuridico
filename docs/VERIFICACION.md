# Verificación del Hub

## Qué demuestra cada comprobación

| Comprobación | Acredita | No acredita |
|---|---|---|
| Test puro con fixtures | Reglas y guardas del caso probado | Conexión o cambios reales |
| TypeScript/lint/build | Contratos estáticos y compilación | Entrega, permisos efectivos o escritura correcta |
| QA de integración aislada | Adaptadores y durabilidad contra recursos ficticios comprobados | Resultado en clientes reales |
| Navegador autenticado | Flujo UI/API visible del candidato revisado | Que otro rol tenga los mismos permisos |
| Lectura de vuelta | Resultado observado en la fuente del cambio | Que un timeout previo no requiera reconciliación |
| Replay/concurrencia | Idempotencia y rechazo de conflictos del caso | Permiso para cambiar de clave o reintentar otro efecto |
| PDF exportado | Layout del archivo inspeccionado | Diálogo nativo o impresora física |
| Emulación móvil | Medidas y comportamiento del viewport simulado | Audio, cámara o gestos en un dispositivo físico |

## Suites por área

- Identidad/rutas: tests de auth, roles, rutas y protección de APIs. Revisar `401`, `403`, mismo origen y listas explícitas.
- Clientes: planes, escritores, historial, acciones reales con dependencias falsas, campos, encabezados, referidos, canjes, pausa/retoma y archivados.
- Alta/kickoff/guiones: parseo, deduplicación, estados, permisos, vínculo documental, reserva de creación, chips y handoff.
- Grabación/Edición: transiciones, motor, notas, rondas, versión del video, importación y outbox; verificar que archivo/ambigüedad bloqueen efectos.
- Mensajería: salud desconectada, modo apagado, corte temporal, destinatario, locks y resultados ambiguos. Nunca usar un cliente real para demostrar que la guarda falla.
- Métricas/ventas: parsers, atribución, conciliación y máquinas de estados con filas ficticias.
- Configuración pública: ausencia, JSON inválido, validadores, carga lazy y ausencia de destinos personales por defecto.

El comando sin red está en [RUNBOOK.md](RUNBOOK.md). Seleccionar suites significativas para el cambio. Después de pasarlas no repetir toda la batería sin un cambio, un fallo o una incertidumbre nueva.

## Integración aislada de acciones

Usar un único cliente ficticio `Z001` y recursos de QA separados. Comprobar:

1. Revisión, confirmación, lectura de vuelta y ledger fixture cuando corresponda.
2. Doble clic, dos claves concurrentes incompatibles y replay de respuesta perdida.
3. Extensiones por meses/semanas/personalizado, pausa y retoma con días efectivos.
4. Archivo/restauración y exclusión en todas las colas operativas.
5. Reversa admisible sin pisar cambios humanos, conservación de fórmulas y formato.
6. Renovación más canje de meses, saldo y topes; no consumo USD ni reversa insegura.
7. Ambas líneas CRM por ID único; no duplicar el ID entre Agencia y Consultora.

Las claves, schema y destino de QA forman parte del recibo privado. Un recibo aprobado no se reutiliza si cambió la fixture o se restauró una baseline distinta.

## Docs y entrega

Revisar ID, título, carpeta y fuente autorizada del vínculo. La diferencia textual entre un borrador no aprobado y un Doc manual no prueba que el Doc sea de otra persona. No escribir para probar identidad.

Una fixture de chips debe comprobar la sección Video, la tanda, el sexto chip si corresponde, conservación de manuales, corrección idempotente y bloqueo de otra clave sobre texto ajeno. La prueba debe usar una carpeta/Doc de QA explícitos; un nombre parecido no autoriza tocar una plantilla o cliente real.

## UI móvil

Probar al menos un viewport estrecho y permisos relevantes. Medir `documentElement.scrollWidth`, ancho del contenido y scroll local del kanban. El tablero debe deslizar dentro de su contenedor; `contain: layout paint` en columnas evita propagar el desbordamiento a toda la página. Sus diálogos están fuera de ese contenedor. Verificar también modal, foco, confirmación, reintento con la misma clave y texto de errores.

## PDF

Para Anuncios, llamar al renderer actual con datos rotulados como ficticios y probar tabla multipágina, nombres largos, tildes, monedas y valores nulos. Renderizar todas las páginas e inspeccionar, además de extraer texto para detectar faltantes.

Para Resumen, verificar el CSS de impresión de la versión actual: sin navegación, primera página útil, tablas sin superposición, gráficos dentro del papel y donas centradas. Recharts utiliza un div interno de ancho cero para permitir shrink; un ancho porcentual de impresión debe resolverse contra el contenedor adecuado y las leyendas deben ajustarse. Una corrección que deja vacíos los SVG no está aprobada.

Guardar PDF/PNG reales sólo en un ámbito privado, no en Git. No presentar una fixture como producción ni afirmar que `Page.printToPDF` prueba el diálogo de `window.print` o una impresora física.
