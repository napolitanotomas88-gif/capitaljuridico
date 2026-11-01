# Puente de Claude a la Mac

Decisión de Tomás (1/11/2026, opción «A»): nada del Despacho gasta créditos de la API de Anthropic. Con `CLAUDE_VIA=mac`
en Vercel, los módulos que llamaban a la API dejan su pedido en Neon (`cj_ia_pedidos`) y el trabajador de la Mac lo
resuelve con `claude -p`, con el plan de Tomás.

| Pieza | Dónde |
|---|---|
| Cliente con la forma del SDK (`messages.create`, `beta.messages.create`, `beta.messages.stream().finalMessage()`) | `lib/ia/puenteMac.ts` |
| Elección API o Mac (`crearClienteClaude`, `claveOMac`) | `lib/ia/cliente.ts` |
| Cuerpo de la API → argumentos de `claude -p` (adjuntos a archivos, esquema, esfuerzo, búsqueda web) | `lib/ia/pedidoCli.ts` |
| Trabajador (cola cada 2 s, de a 3, se relanza cada hora con el código de `main`) | `scripts/ia-mac.mjs` |
| Pruebas | `scripts/test-ia-puente.mjs` |

Módulos conectados: comprobantes y dirección del alta, kickoff (ficha, mapa, copys), guiones (en el Despacho),
Fathom → anuncios, trazabilidad, éxito y bajas.

## Comportamiento

- Si la Mac no responde a tiempo, el módulo recibe un error de conexión (pasajero): reintenta más tarde o lo deja para
  revisión humana, como con un corte de la API. El mismo pedido repetido reusa el que está en curso o resuelto
  (huella, 24 h).
- La dirección espera 60 s; si no llega, se separa con reglas. El comprobante espera 150 s; si no, el motor reintenta a
  los 5 minutos y encuentra la respuesta.
- Los pedidos resueltos se vacían (los adjuntos van en base64) y se borran a las 24 h.

## Instalación en la Mac

1. Copia del trabajador: `git worktree add --detach ~/cj-trabajador origin/main` (desde `~/capitaljuridico`), con
   `node_modules` (enlace a los de `~/capitaljuridico` o `npm ci`) y un `.env.local` con `DATABASE_URL` y
   `CLAUDE_CODE_OAUTH_TOKEN` (lo genera Tomás con `claude setup-token`). Nunca `ANTHROPIC_API_KEY`.
2. `~/Library/LaunchAgents/com.skyward.ia-mac.plist` con `KeepAlive`, `RunAtLoad`, `IA_MAC_ACTUALIZAR=1` y
   `WorkingDirectory` en `~/cj-trabajador`; cargarlo con `launchctl bootstrap gui/$(id -u) <plist>`.
3. Registro: `~/Library/Logs/ia-mac/ia-mac.log` (sin claves ni contenido de los pedidos).
