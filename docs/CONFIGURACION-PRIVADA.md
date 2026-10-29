# Configuración privada

Este repositorio no se autoconfigura contra una operación real. No incluye valores para usuarios, carpetas, hojas, cuentas publicitarias, canales, plantillas o teléfonos. Usar `.env.example` como inventario; configurar los valores en el administrador de secretos o en un archivo local ignorado. Nunca guardarlos aquí ni en capturas/logs.

## Identidad y proveedores

| Grupo | Variables o contrato |
|---|---|
| Sesión | `AUTH_SECRET`, `AUTH_USUARIOS`, `AUTH_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Google servidor | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, permisos explícitos sobre los recursos requeridos |
| Base | `DATABASE_URL`; seleccionar y verificar el destino antes de importar mutadores |
| CRM y Finanzas | `SHEET_ID_CLIENTES`, `SHEET_ID_FINANZAS`, `SHEET_ID_VENTAS`, `SHEET_ID_VENTAS_ORIGINAL`, `SHEET_ID_GUIONES` |
| Drive | `DRIVE_CARPETA_CLIENTES`, `DRIVE_CARPETA_COMPROBANTES`, `PLANTILLA_GUIONES_ID`, `PUENTE_DRIVE_URL`, `PUENTE_DRIVE_SECRETO` |
| ClickUp | `CLICKUP_TOKEN`, `CLICKUP_LIST_ID`, `CLICKUP_LISTA_EDICION`, `CLICKUP_LISTA_SEGUIMIENTO` |
| Crons/integraciones | `CRON_SECRET` y los secretos de cada webhook; no intercambiarlos ni enviarlos por query |
| Avisos y revisores | `DISCORD_WEBHOOK_*`, `DISCORD_ID_*`, whitelists `KICKOFF_REVISOR_*`, `GUIONES_REVISOR_FAUS`, `EDICION_REVISOR_AYLU`, `GUIONES_ENTREGA_EMAIL` y listas de aprobadores del módulo |
| Contratos | `PANDADOC_API_KEY`, `PANDADOC_PLANTILLA_NORMAL`, `PANDADOC_PLANTILLA_GARANTIA`, `CONTRATO_DIRECCION_ARGENTINA` |
| Mensajería | `WHAPI_TOKEN` y destinos privados. Los modos de WhatsApp permanecen apagados; ver flujos vigentes |
| Herramientas opcionales | `GOOGLE_CLOUD_PROJECT`, `DOC_GUIONES_PRUEBA_ID`; configurarlas no ejecuta habilitaciones o escrituras |

No deducir un destino por un nombre. Variables ausentes bloquean la capacidad correspondiente antes del efecto externo. `SHEET_ID_VENTAS_ORIGINAL` participa en la protección de escritura: no omitirlo para evitar esa barrera. Los identificadores `NEXT_PUBLIC_*` se entregan al navegador; nunca poner un secreto en ellos.

El link opcional de mensajes de ventas usa `NEXT_PUBLIC_VENTAS_MENSAJES_URL` validado como HTTPS; sin él el botón se oculta. La integración 2chat usa `NEXT_PUBLIC_2CHAT_ESPACIO` y `NEXT_PUBLIC_2CHAT_NUMEROS_JSON` (mapa privado de pestaña operativa a número autorizado); sin mapa válido se usa el fallback previsto, no un número personal por defecto.

## Cuatro datasets externos

`lib/configPrivada.ts` carga cada dataset de forma lazy. Si su variable JSON está definida, usa ese valor; en caso contrario lee el archivo correspondiente desde `HUB_CONFIG_PRIVADA_DIR` o `.private-config` (directorio ignorado).

| Archivo privado | Variable alternativa | Contenido |
|---|---|---|
| `finanzas-cuentas.json` | `HUB_CONFIG_FINANZAS_CUENTAS_JSON` | Meses y comprobantes de conciliación autorizados |
| `anuncios-cuentas.json` | `HUB_CONFIG_ANUNCIOS_CUENTAS_JSON` | Cuentas base, exclusiones y ajustes de identidad/rama |
| `anuncios-presupuestos.json` | `HUB_CONFIG_ANUNCIOS_PRESUPUESTOS_JSON` | Vínculos de presupuesto y tareas por cuenta |
| `fathom-alias.json` | `HUB_CONFIG_FATHOM_ALIAS_JSON` | Alias explícitos de cliente |

Ausencia, JSON inválido o esquema incorrecto produce un error claro. No se sustituye una configuración faltante por un cálculo silencioso con datos vacíos. `private-config.example` contiene únicamente ejemplos ficticios para pruebas; no es una copia de producción ni un fallback automático de la app.

## Catálogo CSM y acceso

`HUB_CSM_OPCIONES_JSON` define opciones `{nombre, activo, nombresIdentidad}`; `HUB_CSM_VERSION` y `HUB_CSM_FUENTE` identifican su revisión. Sin catálogo no hay nuevas opciones; un valor malformado es error. Asignar una opción no concede permisos ni crea una cuenta Google. Una cuenta de acceso existente sólo se vincula cuando su identidad coincide de forma única con el catálogo explícito. No completar por parecido, por Closer o por un rol amplio.

## Bridge y modos

El puente saneado está en `integrations/apps-script/Codigo.gs`; los módulos de chips y vigía están en `docs/guiones/puente/GuionesChips.gs` y `docs/edicion/puente/Vigia.gs`. Se cargan en el mismo proyecto Apps Script. Los secretos y destinos se configuran en Script Properties: `SECRETO`, `DRIVE_CARPETA_COMPROBANTES`, `PUENTE_CORREO_ORGANIZACION`, `VIGIA_SECRETO` y `VIGIA_URL`. Sin secreto o destino obligatorio, rechazar antes de llamar al proveedor; sólo el ping autenticado admite instalación incompleta. Las pruebas usan el código saneado del repositorio y fixtures, nunca un directorio personal ni propiedades de producción. No versionar los valores ni copiar una configuración privada.

Los switches de modo/capacidad se documentan en cada módulo (`BOT_ALTA_*`, `BOT_BAJAS_*`, `BOT_EXITO_*`, `EDICION_*`, `GUIONES_*`, `CRM_ESCRITURA_*`, `CLIENTES_ESCRITURA`). Configurarlos en `real` requiere autorización y revisión del entorno; no activarlos como paso de instalación. En particular, WhatsApp permanece apagado y necesita también conexión, revisión y corte temporal para una activación posterior.

El worker local usa credenciales CLI privadas del usuario autorizado. No publicar tokens, archivos de sesión, logs ni LaunchAgents con valores. El respaldo Codex no requiere que las credenciales de producción se pasen al modelo.
