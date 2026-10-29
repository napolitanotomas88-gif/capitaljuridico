# Inventario de esquema por módulo

Extraído del DDL incluido en esta copia. Es un inventario técnico, no un dump ni una constatación del esquema instalado. Revisar los migradores y las precondiciones antes de ejecutar. No incluye datos, credenciales, IDs de entorno o recibos.

| Fuente canónica | Tablas declaradas |
|---|---|
| `lib/bot/alta/despacho/archivos.ts` | `IF`, `cj_altas_archivos` |
| `lib/bot/alta/motor/almacenNeon.ts` | `cj_altas`, `cj_altas_mensajes`, `cj_altas_pasos`, `cj_altas_recursos` |
| `lib/bot/anuncios/registro.ts` | `cj_anuncios_avisos` |
| `lib/bot/bajas/almacenNeon.ts` | `cj_bajas_bajas`, `cj_bajas_llamadas`, `cj_bajas_pedidos`, `cj_bajas_recontactos` |
| `lib/bot/exito/almacenNeon.ts` | `cj_exito_encuestas`, `cj_exito_lotes`, `cj_exito_pedidos`, `cj_exito_senales`, `cj_exito_testimonios` |
| `lib/bot/guiones/documento.ts` | `cj_guiones_documentos` |
| `lib/bot/guiones/registro.ts` | `cj_guiones` |
| `lib/bot/kickoff/registro.ts` | `cj_kickoffs` |
| `lib/bot/whapi/guiones.ts` | `cj_guiones_reenvios` |
| `lib/bot/whapi/salud.ts` | `cj_altas_recursos` |
| `lib/clientes/acciones/durable.ts` | `cj_cliente_acciones`, `cj_cliente_acciones_filas` |
| `lib/clientes/acciones/registro.ts` | `cj_cliente_acciones` |
| `lib/clientes/beneficiosPendientes.ts` | `cj_beneficios_referidos_pendientes` |
| `lib/clientes/hitosRegistro.ts` | `cj_etapas_manual`, `cj_hitos`, `cj_hitos_historial` |
| `lib/clientes/inactivos.ts` | `cj_inactivos_contactos` |
| `lib/clientes/migraciones/001_referidos_alta.sql` | `referidos_reservas` |
| `lib/clientes/migraciones/002_canjes_reservas.sql` | `canjes_reservas` |
| `lib/edicion/db/migracion.ts` | `IF`, `cj_edicion_avisos`, `cj_edicion_clientes`, `cj_edicion_esquema`, `cj_grab_archivos`, `cj_grab_carpetas`, `cj_grab_corridas`, `cj_grab_guiones`, `cj_grab_seguimientos`, `cj_grab_tandas`, `cj_grab_transcripciones`, `cj_marca`, `cj_marca_propuestas`, `cj_video_eventos`, `cj_video_notas`, `cj_video_pedidos`, `cj_videos` |
| `lib/edicion/tarjetasDb.ts` | `cj_edicion_tarjetas`, `cj_edicion_tarjetas_historial`, `cj_edicion_tarjetas_operaciones`, `cj_edicion_tarjetas_outbox` |
| `lib/fathomAnuncios/registro.ts` | `cj_fathom_anuncios` |
| `lib/notificaciones/registro.ts` | `cj_notificaciones`, `cj_notificaciones_vistas` |
| `lib/presencia/registro.ts` | `cj_presencia` |
| `lib/trazabilidad/db.ts` | `cj_traz_angulos`, `cj_traz_anuncios`, `cj_traz_conceptos`, `cj_traz_llamada`, `cj_traz_piezas`, `cj_traz_setting`, `cj_traz_vinculo` |

Las restricciones, índices, versiones y migraciones aditivas permanecen en el código señalado. No inferir que este listado equivale al orden de una migración productiva. Ver [DATOS-Y-MIGRACIONES.md](DATOS-Y-MIGRACIONES.md).
