// Enlaces de los videos de la guía del CRM de ventas (SOLO servidor).
// En el CRM original se guardan en su base Neon (cj_guia_videos); el dashboard no tiene esa base, así que van en la pestaña
// "Videos guía" de la planilla de Accesos (SHEET_ID_ACCESOS, la misma que usa Configuración): columna A = id ("ventas" o
// "cuotas"), B = enlace https. Sin planilla, o si Google falla, valen los enlaces iniciales de config/guia.ts.
import { googleJson, sheetsBase } from "@/lib/auth/googleRest";
import { planillaConfigurada } from "@/lib/auth/accesos";
import { URL_VIDEO_CUOTAS, URL_VIDEO_GUIA } from "@/lib/crm/config/guia";

export type IdVideo = "ventas" | "cuotas";
export type Videos = Record<IdVideo, string>;
const PESTANA = "Videos guía";
const IDS: IdVideo[] = ["ventas", "cuotas"];
const FRESCO_MS = 60_000;
let cache: { en: number; videos: Videos } | null = null;

const base = () => `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(process.env.SHEET_ID_ACCESOS!.trim())}`;
const rango = encodeURIComponent(`'${PESTANA}'!A2:B10`);

/** Un enlace válido: https, sin usuario ni contraseña y de largo razonable (lo mismo que exige el original). */
export function enlaceValido(valor: unknown): string | null {
  const v = String(valor ?? "").trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? v : null;
  } catch {
    return null;
  }
}

export async function videosGuia(): Promise<Videos> {
  const videos: Videos = { ventas: URL_VIDEO_GUIA, cuotas: URL_VIDEO_CUOTAS };
  if (!planillaConfigurada()) return videos;
  if (cache && Date.now() - cache.en < FRESCO_MS) return cache.videos;
  try {
    const r = await googleJson<{ values?: unknown[][] }>(`${base()}/values/${rango}`);
    for (const [id, url] of r.values ?? []) {
      const ok = enlaceValido(url);
      if ((id === "ventas" || id === "cuotas") && ok) videos[id] = ok;
    }
  } catch {
    // La pestaña todavía no existe (nadie guardó un enlace) o Google no respondió: quedan los iniciales
  }
  cache = { en: Date.now(), videos };
  return videos;
}

/** Guarda los dos enlaces (crea la pestaña si falta). Lanza si la planilla no está conectada. */
export async function guardarVideosGuia(videos: Videos): Promise<void> {
  if (!planillaConfigurada()) throw new Error("La planilla de Accesos no está conectada.");
  const meta = await googleJson<{ sheets?: { properties?: { title?: string } }[] }>(`${base()}?fields=sheets.properties.title`);
  if (!(meta.sheets ?? []).some((s) => s.properties?.title === PESTANA)) {
    await googleJson(`${base()}:batchUpdate`, { cuerpo: { requests: [{ addSheet: { properties: { title: PESTANA, gridProperties: { rowCount: 10, columnCount: 2, frozenRowCount: 1 } } } }] } });
  }
  const filas = [["Video", "Enlace"], ...IDS.map((id) => [id, videos[id]])];
  await googleJson(`${base()}/values/${encodeURIComponent(`'${PESTANA}'!A1:B3`)}?valueInputOption=RAW`, { metodo: "PUT", cuerpo: { values: filas } });
  cache = null;
}
