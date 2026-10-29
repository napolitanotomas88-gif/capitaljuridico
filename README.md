# Capital Jurídico · Hub

Aplicación de operaciones y métricas con Next.js 16, React 19, Google Workspace y PostgreSQL. Reúne cartera, altas, referidos, guiones, edición, anuncios, ventas, cobros y finanzas.

Esta importación combina la copia original de desarrollo con la versión revisada del Hub. Conserva los cambios recientes del ejecutor local de guiones y del respaldo Codex. Los datos operativos privados, las credenciales, las grabaciones y los recibos de producción quedan fuera del repositorio.

## Empezar

1. Instalar dependencias con `npm ci`.
2. Consultar `.env.example` y la documentación de configuración privada. Las credenciales se cargan por fuera de Git.
3. Ejecutar `npm run dev`. Las funciones que necesitan servicios privados requieren su configuración y permisos correspondientes.
4. Antes de publicar, ejecutar TypeScript, las pruebas pertinentes y `npm run build`; revisar el resultado real de los flujos modificados.

La documentación incluida con la versión instalada de Next.js está en `node_modules/next/dist/docs/`. Hay diferencias respecto de versiones anteriores: leer la guía pertinente antes de cambiar rutas, middleware, caché o configuración.

## Organización

| Ubicación | Contenido |
|---|---|
| `app/(shell)` | Pantallas autenticadas y diseño compartido |
| `app/api` | Endpoints, webhooks y crons |
| `components` | Componentes de interfaz y gráficos |
| `lib/clientes` | Lectura, acciones, historial y reglas de servicio |
| `lib/bot` | Altas, kickoff, guiones, grabación, edición e integraciones |
| `lib/edicion` | Tarjetas, transiciones, revisión y avisos |
| `lib/auth` | Sesiones, permisos y acceso a Google |
| `scripts` | Pruebas y herramientas operativas con sus propias guardas |
| `docs` | Arquitectura, contratos, flujos y procedimientos |

## Contexto y coordinación

Leer [CONTEXTO-HUB.md](docs/CONTEXTO-HUB.md) antes de tomar trabajo. Explica las decisiones funcionales y los límites que deben conservarse.

El código y los documentos públicos no contienen la situación de los clientes. Para conocer el estado operativo vigente se necesitan las fuentes privadas autorizadas. Un chat compartido o una copia de Obsidian no fusiona conversaciones ni acredita que otra persona haya leído los cambios.

No conectar automáticamente este repositorio a producción durante la importación. La versión productiva usa su configuración privada existente; la importación pública requiere configurar las integraciones antes de desplegarla.
