/** Pregunta real de las reservas consultivas, comprobada en Calendly el 31/10/2026. No se usa position. */
export const PREGUNTA_INSTAGRAM = "Tu Instagram. Ej.: @geronimo.actis (Si no tenés indicalo y listo, no es excluyente)";

export type InstagramAgenda = { estado: "disponible"; texto: string } | { estado: "sin_dato" | "no_disponible" };

const normalizarPregunta = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Ausente, null o vacío son opcionales. Dos respuestas distintas a la misma pregunta no se atribuyen a nadie. */
export function respuestaInstagram(preguntas: unknown): string | null {
  if (!Array.isArray(preguntas)) return null;
  const respuestas = preguntas.flatMap((q: unknown) => {
    if (!q || typeof q !== "object") return [];
    const { question, answer } = q as { question?: unknown; answer?: unknown };
    return typeof question === "string" && normalizarPregunta(question) === normalizarPregunta(PREGUNTA_INSTAGRAM) && typeof answer === "string" && answer.trim()
      ? [answer.trim().slice(0, 1000)] : [];
  });
  const unicas = [...new Set(respuestas)];
  return unicas.length === 1 ? unicas[0] : null;
}

/** Sólo perfiles: nunca enlaces a otros hosts, credenciales, HTML, publicaciones o rutas de login. */
export function urlPerfilInstagram(valor: string | null | undefined): string | null {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto) return null;
  let usuario = texto.replace(/^@/, "");
  if (/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i.test(texto)) {
    try {
      const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
      if (!["http:", "https:"].includes(url.protocol) || !["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
      const perfil = /^\/([a-z0-9._]+)\/?$/i.exec(url.pathname);
      if (!perfil) return null;
      usuario = perfil[1];
    } catch { return null; }
  }
  if (!/^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/i.test(usuario) || usuario.includes("..")) return null;
  if (["no", "notengo", "ninguno", "ninguna", "sin", "sincuenta", "sininstagram", "na", "p", "reel", "reels", "stories", "explore", "accounts", "direct", "about", "legal", "oauth"].includes(usuario.toLowerCase())) return null;
  return `https://www.instagram.com/${usuario}/`;
}
