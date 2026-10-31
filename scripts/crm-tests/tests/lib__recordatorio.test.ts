import { describe, expect, it } from "vitest";
import { recordatorioParaGuardar, recordatorioVisual, videosConfEnviados } from "@/lib/crm/recordatorio";
import { ESTILO_WHATSAPP } from "@/components/crm/estilosWhatsApp";

describe("Recordatorio, compatibilidad con Sheets", () => {
  it.each(["0", "1", "2", "3"])("ida y vuelta de %s conserva el número visible", numero => {
    const celda = recordatorioParaGuardar(numero);
    expect(celda).toBe(numero === "0" ? "" : numero);
    expect(recordatorioVisual(celda)).toBe(numero);
  });
  it("vacío previo aparece como 0 sin requerir una escritura", () => expect(recordatorioVisual("")).toBe("0"));
  it("normaliza sólo formato, sin tomar otras fases como videos enviados", () => {
    expect(videosConfEnviados(" videos  conf ")).toBe(true);
    for (const fase of ["DOLORES", "Hecho - link a call", "CONF + DECISORES", "Enviado", "", "VIDEOS CONF Enviado"]) expect(videosConfEnviados(fase)).toBe(false);
  });
});

describe("WhatsApp, contraste del estilo compartido", () => {
  const contraste = (hex: string) => {
    const v = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return 1.05 / (v[0] * .2126 + v[1] * .7152 + v[2] * .0722 + .05);
  };
  it("blanco sobre los colores normal y hover supera 4,5:1 y mantiene foco visible", () => {
    const colores = [...ESTILO_WHATSAPP.matchAll(/(?:^|\s)(?:hover:)?bg-\[#([0-9a-f]{6})\]/g)].map(m => m[1]);
    expect(colores).toHaveLength(2);
    for (const color of colores) expect(contraste(color)).toBeGreaterThanOrEqual(4.5);
    expect(ESTILO_WHATSAPP).toContain("text-white!");
    expect(ESTILO_WHATSAPP).toContain("focus-visible:ring-2");
  });
});
