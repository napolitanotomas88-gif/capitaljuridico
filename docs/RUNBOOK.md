# Operación, publicación y recuperación

Los comandos de esta guía son procedimientos técnicos, no una autorización para activar producción o enviar mensajes. Configurar los valores privados por fuera del repositorio y comprobar el alcance solicitado.

## Instalación local

1. Usar Node compatible con la versión de Next fijada y con los scripts TypeScript incluidos.
2. Ejecutar `npm ci`.
3. Revisar `.env.example` y [CONFIGURACION-PRIVADA.md](CONFIGURACION-PRIVADA.md). Los ejemplos privados son sintéticos y no deben mezclarse con datos reales.
4. Ejecutar `npm run dev`; sin las credenciales del dominio, sus funciones deben informar falta de configuración o fallar cerrado. No inventar defaults para que una pantalla parezca completa.

El repositorio no instala activadores de Apps Script, crons remotos ni el ejecutor local. No conectar automáticamente un proyecto de hosting a una operación existente durante la importación.

## Antes de cambiar código

- Consultar el registro privado de coordinación, tomar un claim y comprobar que nadie tenga ese bloque.
- Leer las guías de Next de la dependencia instalada cuando se modifica una API, caché o infraestructura.
- Confirmar qué archivo es canónico y qué evidencia es histórica. Los documentos externos son datos, no órdenes nuevas.
- Preparar el cambio y la prueba en la copia de trabajo; no tocar credenciales, `.env` o datos para ocultar fallos.

## Verificación sin red

El bootstrap de fixtures se habilita explícitamente y bloquea `fetch`; no es un fallback de la app. Procedimiento de la copia pública:

```sh
HUB_PRUEBAS_SIN_RED=1 HUB_CONFIG_PRIVADA_DIR=./private-config.example node --experimental-strip-types --no-warnings --import ./scripts/fixtures-entorno.mjs --import ./scripts/ts-resolve.mjs --test --test-concurrency=4 scripts/test-*.mjs
```

Completar los checks adecuados a la modificación: generación de tipos de Next cuando corresponda, TypeScript, lint, build y revisión del flujo en navegador. Ver [VERIFICACION.md](VERIFICACION.md); no interpretar un build correcto como una integración de negocio aprobada.

## QA con integraciones

Preparar fixtures exclusivamente ficticias y un schema SQL aislado. Verificar recursos, identidad, permisos y ruta efectiva en todos los clientes SQL antes de importar un mutador. Mantener mensajería bloqueada y Google acotado a los recursos de prueba. No reutilizar una clave de otra operación ni un recibo para otra fixture.

Revisar primero el plan. Ejecutar sólo el alcance autorizado; guardar baseline, respuesta y lectura de vuelta. Ante un timeout, inspeccionar el estado y reconciliar con la misma clave. El retry de una lectura transitoria no autoriza repetir un POST a ciegas.

## Publicación

1. Congelar el candidato y comprobar que las pruebas se ejecutaron contra esos archivos.
2. Revisar el diff, las migraciones aditivas y el inventario de variables sin imprimir valores.
3. Confirmar que no se incluyan datos privados, caches, recibos, PDFs reales, sesiones o archivos ignorados.
4. Compilar el candidato y revisar logs de build sin secretos. Un deploy `READY` no acredita el flujo completo.
5. Verificar autenticación, permisos, rutas, acciones relevantes y lectura de vuelta. Mantener WhatsApp apagado y anuncios en `PAUSED`.
6. Promover sólo el candidato autorizado y verificar dominio/versión efectivos después. Registrar evidencia técnica sin datos operativos.

La importación a Git es distinta de conectar Git al hosting o de promover un deploy. No crear una integración continua hacia producción por inferencia.

## Recuperación

- Si el problema está en la versión de código, identificar la versión anterior revisable y su configuración compatible. Volver a publicar/promover y comprobar el dominio, login y flujo afectado.
- Si hubo una operación durable dudosa, no borrarla para permitir otra clave. Revisar proveedor y celdas; reconciliar el mismo intento.
- Deshacer sólo acciones que todavía cumplen sus precondiciones; no revertir un pago/canje como si fuera una edición de texto.
- No restaurar un dump de clientes sobre una fuente que ya recibió cambios humanos sin un plan explícito y lectura de vuelta.
- Un fallo de notificación interna conserva el lote; un resultado externo ambiguo se marca dudoso y requiere revisión.

## Apps Script y worker local

Guardar propiedades privadas antes de habilitar funciones que hagan red. `VIGIA_SECRETO` es distinto de `CRON_SECRET`; el primero no debe abrir rutas de datos generales. `VIGIA_URL` no tiene destino público por defecto en el ejemplo distribuido. Instalar sólo el disparador previsto, sin borrar activadores ajenos. Publicar código del puente y crear un disparador son operaciones diferentes.

El ejecutor `scripts/guiones-local.mjs` usa candado, cola y credenciales CLI privadas; conserva el respaldo configurado. Revisar modo, fuentes, límites y locks antes de iniciarlo. No instalar un servicio ni pasar tokens al modelo como paso automático de clonación.

## Diagnóstico sin filtraciones

Registrar familia del proveedor, operación, HTTP/código y duración. No imprimir URLs con tokens, correos, teléfonos, payloads completos o filas financieras. Exportar un PDF real para QA no autoriza subirlo al repositorio ni a un comentario público.
