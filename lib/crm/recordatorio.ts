import { normalizarTexto } from "@/lib/crm/sheets/verificacion";

/** F guarda la última fase enviada. DOLORES también puede venir del salto por llamada efectiva: no prueba envío de videos. */
export const videosConfEnviados = (fase: string): boolean => normalizarTexto(fase) === "videos conf";

/** El cero es sólo visual: el Sheet conserva vacío / 1 / 2 / 3. No se escribe al mostrar u ocultar el control. */
export const recordatorioVisual = (valor: string): string => ["1", "2", "3"].includes(valor) ? valor : "0";
export const recordatorioParaGuardar = (valor: string): string => valor === "0" ? "" : valor;
