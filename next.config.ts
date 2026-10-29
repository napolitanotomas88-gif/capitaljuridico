import type { NextConfig } from "next";

// Clientes como hub (25/10/2026, lib/auth/hubClientes.ts): Edición y Referidos pasaron a ser pestañas bajo /clientes. Las
// direcciones viejas (links de los avisos de Discord de Edición, marcadores, la app instalada) redirigen con 308 permanente,
// con sus subrutas y su query (Next conserva la query sola). Corre ANTES que proxy.ts: el permiso lo decide la ruta nueva.
// Guiones (/guiones, /guiones/[id]) y Anuncios (/anuncios, con su clave propia) no se movieron: no llevan redirección.
// Las API (/api/edicion/*, /api/referidos*) tampoco cambian. scripts/test-rutas.mjs controla esta lista.
export const REDIRECCIONES_HUB = [
  { source: "/edicion/:ruta*", destination: "/clientes/edicion/:ruta*", permanent: true },
  { source: "/referidos/:ruta*", destination: "/clientes/referidos/:ruta*", permanent: true },
];

const nextConfig: NextConfig = {
  async redirects() {
    return REDIRECCIONES_HUB;
  },
  // ffmpeg-static (bot de kickoff, zona desde el video): el binario se carga en tiempo de ejecución y solo lo
  // empaqueta /api/bot/kickoff/mapa, para no sumarle ~80 MB al resto de las funciones. Ver docs/BOT-KICKOFF-CJ.md.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    // index.js + package.json además del binario: la ruta lo resuelve con un require en tiempo de ejecución que el tracing no ve
    "/api/bot/kickoff/mapa": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffmpeg-static/index.js",
      "./node_modules/ffmpeg-static/package.json",
    ],
  },
};

export default nextConfig;
