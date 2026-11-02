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

// Finanzas (1/11/2026, pedido de Tomás: «lanzalo todo»): el diseño de cristal que se probaba en /finanzas/prueba pasó a ser
// /finanzas. Las direcciones de la prueba (marcadores, links pasados por chat) siguen andando: redirigen a la misma pantalla.
// 307 (no permanente) por si algún día se vuelve atrás. El diseño anterior quedó en /finanzas/clasico.
export const REDIRECCIONES_FINANZAS = [
  { source: "/finanzas/prueba", destination: "/finanzas", permanent: false },
  { source: "/finanzas/prueba/:ruta*", destination: "/finanzas/:ruta*", permanent: false },
];

// Encabezados de seguridad (31/10/2026, pedido de Tomás: «mejorar la seguridad del Despacho», con el paso a
// software.capitaljuridico.com.ar). Van en TODAS las respuestas. Sin Content-Security-Policy de scripts a propósito: una
// política estricta podría romper la app; solo se prohíbe que otra página la meta en un iframe (frame-ancestors).
// scripts/test-rutas.mjs no los toca; se comprueban con curl -I después de publicar.
export const ENCABEZADOS_SEGURIDAD = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },   // siempre por HTTPS (2 años)
  { key: "X-Frame-Options", value: "DENY" },                                             // nadie la embebe (clickjacking)
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },                  // no filtra rutas con IDs a otros sitios
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

// Videos de /v/ (WhatsApp de confirmación: Make y 2Chat los bajan sin sesión). No van al repo, que es público: viven en el
// proyecto estático capitaljuridico-medios (~/capitaljuridico-medios, ver su LEEME.md) y el Despacho los sirve en la misma
// dirección. Es un rewrite de respaldo: solo actúa si el archivo no está en public/v (1/11/2026).
export const MEDIOS_URL = "https://capitaljuridico-medios.vercel.app";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [...REDIRECCIONES_HUB, ...REDIRECCIONES_FINANZAS];
  },
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/v/:archivo", destination: `${MEDIOS_URL}/v/:archivo` }] };
  },
  async headers() {
    return [{ source: "/:ruta*", headers: ENCABEZADOS_SEGURIDAD }];
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
