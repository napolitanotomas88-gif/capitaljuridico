import { describe, expect, it } from "vitest";
import {
  ErrorConfiguracion,
  TEXTO_FALLA,
  clasificarError,
  conDiagnostico,
  digestPara,
  marcarFalla,
  tipoDesdeDigest,
} from "@/lib/crm//errores";

/** Un error como los de googleapis (gaxios): `status` HTTP y `code` numérico o de red. */
function errorGoogle(message: string, extra: { status?: number; code?: number | string }) {
  return Object.assign(new Error(message), extra);
}

describe("digest", () => {
  it("lleva el tipo y un sufijo al azar", () => {
    const a = digestPara("google");
    expect(a).toMatch(/^SKWD_GOOGLE_[0-9a-f]{8}$/);
    expect(digestPara("configuracion")).toMatch(/^SKWD_CONFIGURACION_[0-9a-f]{8}$/);
    expect(digestPara("google")).not.toBe(a);
  });

  it("tipoDesdeDigest reconoce los nuestros y el resto es desconocido", () => {
    expect(tipoDesdeDigest(digestPara("configuracion"))).toBe("configuracion");
    expect(tipoDesdeDigest(digestPara("google"))).toBe("google");
    expect(tipoDesdeDigest("2871823712")).toBe("desconocido");
    expect(tipoDesdeDigest(undefined)).toBe("desconocido");
  });
});

describe("clasificarError", () => {
  it("variables de entorno → configuración", () => {
    const e = new ErrorConfiguracion("Falta la variable de entorno SHEET_ID_VENTAS (ver .env.example)");
    expect(clasificarError(e)).toBe("configuracion");
    expect(tipoDesdeDigest(e.digest)).toBe("configuracion");
    expect(e.message).toMatch(/SHEET_ID_VENTAS/);
  });

  it.each([
    ["clave mal pegada", errorGoogle("error:1E08010C:DECODER routines::unsupported", {})],
    ["cuenta de servicio borrada", errorGoogle("invalid_grant: Invalid JWT Signature.", { status: 400 })],
    ["planilla no compartida", errorGoogle("The caller does not have permission", { status: 403, code: 403 })],
    ["id incorrecto", errorGoogle("Requested entity was not found.", { status: 404, code: 404 })],
    ["hoja inexistente", errorGoogle("Unable to parse range: 'Closer 9'!A2:AG", { status: 400, code: 400 })],
  ])("%s → configuración", (_, e) => {
    expect(clasificarError(e)).toBe("configuracion");
  });

  it.each([
    ["cuota", errorGoogle("Quota exceeded for quota metric 'Read requests'", { status: 429, code: 429 })],
    ["cuota con 403", errorGoogle("User rate limit exceeded", { status: 403 })],
    ["error de Google", errorGoogle("Internal error encountered.", { status: 500, code: 500 })],
    ["servicio caído", errorGoogle("The service is currently unavailable.", { code: 503 })],
    ["red", errorGoogle("request to https://sheets.googleapis.com failed", { code: "ECONNRESET" })],
    ["fetch", new Error("fetch failed")],
  ])("%s → google", (_, e) => {
    expect(clasificarError(e)).toBe("google");
  });

  it("cualquier otra cosa no se clasifica", () => {
    expect(clasificarError(new TypeError("Cannot read properties of undefined"))).toBeNull();
    expect(clasificarError(errorGoogle("Invalid value at 'data'", { status: 400 }))).toBeNull();
    expect(clasificarError("texto")).toBeNull();
    expect(clasificarError(null)).toBeNull();
  });
});

describe("marcarFalla / conDiagnostico", () => {
  it("le pone el digest con el tipo a un error de Google", () => {
    const e = marcarFalla(errorGoogle("Internal error", { status: 500 })) as Error & { digest?: string };
    expect(tipoDesdeDigest(e.digest)).toBe("google");
  });

  it("no toca los errores que ya tienen digest (redirect, notFound)", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    expect(marcarFalla(redirect).digest).toBe("NEXT_REDIRECT;replace;/login;307;");
    const noEncontrado = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(marcarFalla(noEncontrado).digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("un error de la app queda sin digest (Next le pone el suyo)", () => {
    const e = marcarFalla(new TypeError("x")) as TypeError & { digest?: string };
    expect(e.digest).toBeUndefined();
  });

  it("conDiagnostico devuelve el valor o relanza marcado", async () => {
    await expect(conDiagnostico(Promise.resolve(3))).resolves.toBe(3);
    const fallo = conDiagnostico(Promise.reject(errorGoogle("Requested entity was not found.", { status: 404 })));
    await expect(fallo).rejects.toMatchObject({ digest: expect.stringMatching(/^SKWD_CONFIGURACION_/) });
  });
});

describe("TEXTO_FALLA", () => {
  it("no culpa siempre a la planilla ni muestra detalles", () => {
    expect(TEXTO_FALLA.desconocido.texto).not.toMatch(/planilla/i);
    for (const { titulo, texto } of Object.values(TEXTO_FALLA)) {
      expect(titulo.length).toBeGreaterThan(0);
      expect(texto).not.toMatch(/SHEET_ID_VENTAS|GOOGLE_PRIVATE_KEY|CLOSERS_JSON/);
    }
  });
});
