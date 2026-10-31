import { describe, expect, it } from "vitest";
import { PREGUNTA_INSTAGRAM, respuestaInstagram, urlPerfilInstagram } from "@/lib/crm/instagram";

describe("Instagram opcional: pregunta real, nunca posición", () => {
  it.each([undefined, null, [], {}, "", [{ question: PREGUNTA_INSTAGRAM }], [{ question: PREGUNTA_INSTAGRAM, answer: null }], [{ question: PREGUNTA_INSTAGRAM, answer: "  " }]])("ausente o vacío: %j", qa => expect(respuestaInstagram(qa)).toBeNull());
  it("recupera la respuesta aunque cambien posición u orden y conserva las demás", () => {
    const qa = [{ question: "Decisores", answer: "Sí", position: 0 }, { question: PREGUNTA_INSTAGRAM, answer: " @estudio.ejemplo ", position: 12 }, { question: "Ingresos", answer: "Rango", position: 1 }];
    const antes = JSON.stringify(qa);
    expect(respuestaInstagram(qa)).toBe("@estudio.ejemplo");
    expect(respuestaInstagram([...qa].reverse())).toBe("@estudio.ejemplo");
    expect(JSON.stringify(qa)).toBe(antes);
  });
  it("no toma un Instagram que sólo se menciona en otra pregunta", () => expect(respuestaInstagram([{ question: "¿Nos conociste en Instagram?", answer: "@otro" }])).toBeNull());
  it("no atribuye dos respuestas distintas a la misma pregunta", () => expect(respuestaInstagram([{ question: PREGUNTA_INSTAGRAM, answer: "@uno" }, { question: PREGUNTA_INSTAGRAM, answer: "@dos" }])).toBeNull());
  it.each(["no tengo", "No tengo Instagram", "<script>alert(1)</script>"])("conserva texto libre %s sin convertirlo en HTML", texto => expect(respuestaInstagram([{ question: PREGUNTA_INSTAGRAM, answer: texto }])).toBe(texto));
});

describe("Enlace de perfil seguro", () => {
  it.each(["@estudio.ejemplo", "estudio.ejemplo", "https://instagram.com/estudio.ejemplo", "https://www.instagram.com/estudio.ejemplo/?igsh=abc", "instagram.com/estudio.ejemplo/", "http://instagram.com/estudio.ejemplo/"])("normaliza %s", texto => expect(urlPerfilInstagram(texto)).toBe("https://www.instagram.com/estudio.ejemplo/"));
  it.each([undefined, null, "", "no tengo", "No", "notengo", "ninguno", "<img src=x onerror=alert(1)>", "javascript:alert(1)", "https://evil.test/a", "https://instagram.com.evil.test/a", "https://instagram.com@evil.test/a", "https://usuario:clave@instagram.com/a", "https://instagram.com:444/a", "https://instagram.com/p/abc", "https://instagram.com/accounts", "https://instagram.com/a/b", "https://instagram.com/a%2fb", ".usuario", "usuario.", "us..er", "a".repeat(31)])("no crea enlace para %s", texto => expect(urlPerfilInstagram(texto)).toBeNull());
});
