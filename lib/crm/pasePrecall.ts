// Pre-call v2 (pedido de Tomás, 5/11/2026): al tocar "Pre-call hecho → pasar al closer" sale solo, desde el WhatsApp del
// closer, UN mensaje: el video de traspaso de autoridad del closer + la bienvenida, la cita afirmada (sin pedir confirmación)
// y el video de pre-llamada con la palabra LISTO. El texto y el video viven en la plantilla de Meta del escenario de Make de
// cada closer (copias del de la confirmación al agendar); acá solo se arman los datos y se llama al webhook.
// Apagado salvo `PRECALL_V2_ENVIO=1` (además de `PRECALL_V2=1`) y el webhook del closer cargado: docs/ENCENDIDO-PRECALL-V2.md.
import "server-only";
import { registrar } from "@/lib/confirmacionAgenda";
import { envioPaseActivo } from "@/lib/crm/config/precallV2";
import { nombreCloserDeHoja } from "@/lib/crm/config";
import { reunionActual, reunionEnCalendly } from "@/lib/crm/calendlyReagenda";
import { digitosWhatsApp } from "@/lib/crm/presentacion";
import type { FilaLead } from "@/lib/crm/sheets/columnas";

const TZ_AR = "America/Argentina/Buenos_Aires";

/** Pestaña → variable con el webhook de Make del pase de ese closer (escenarios copiados, ver el doc de encendido). */
export const WEBHOOK_PASE_POR_HOJA: Readonly<Record<string, string>> = {
  "Closer 1": "MAKE_WEBHOOK_PASE_CARLOS",
  "Closer 2": "MAKE_WEBHOOK_PASE_MARCOS",
  "Closer 3": "MAKE_WEBHOOK_PASE_YAMILA",
  "Closer 4": "MAKE_WEBHOOK_PASE_NAHUEL",
  "Closer 5": "MAKE_WEBHOOK_PASE_BRENDA",
};

/** "(hora Argentina)": el país, no el gentilicio (texto de Tomás del 5/11/2026). Sin match, la ciudad de la zona. */
const PAISES: Record<string, string> = {
  "America/Argentina": "Argentina", "America/Buenos_Aires": "Argentina", "America/Montevideo": "Uruguay",
  "America/Santiago": "Chile", "America/Asuncion": "Paraguay", "America/La_Paz": "Bolivia", "America/Lima": "Perú",
  "America/Bogota": "Colombia", "America/Guayaquil": "Ecuador", "America/Caracas": "Venezuela",
  "America/Mexico_City": "Ciudad de México", "America/Monterrey": "Monterrey", "America/Panama": "Panamá",
  "America/Costa_Rica": "Costa Rica", "America/Guatemala": "Guatemala", "America/El_Salvador": "El Salvador",
  "America/Tegucigalpa": "Honduras", "America/Managua": "Nicaragua", "America/Santo_Domingo": "República Dominicana",
  "America/Puerto_Rico": "Puerto Rico", "Europe/Madrid": "España",
};
export const paisDeZona = (tz: string) => {
  const k = Object.keys(PAISES).find((z) => tz === z || tz.startsWith(`${z}/`));
  return k ? PAISES[k] : (tz.split("/").pop() ?? tz).replace(/_/g, " ");
};

const zonaValida = (tz: string | null): string => {
  if (!tz) return TZ_AR;
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    return tz;
  } catch {
    return TZ_AR;
  }
};

// Lo que viaja a una plantilla de WhatsApp: sin saltos de línea y solo letras en el nombre (lo escribió el lead).
const soloNombre = (s: string) => s.replace(/[^\p{L}\p{M}\s'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
const primerNombre = (s: string) => {
  const p = soloNombre(s).split(" ")[0] ?? "";
  return p ? p[0].toLocaleUpperCase("es") + p.slice(1).toLocaleLowerCase("es") : "";
};

export type DatosPase = {
  tipo: "pase_al_closer";
  telefono: string;
  /** Primer nombre del lead; vacío → Make usa la plantilla sin nombre. */
  nombre: string;
  closer_completo: string;
  /** "jueves 12 de noviembre" */
  fecha_texto: string;
  /** "15:00" */
  hora_texto: string;
  /** "Argentina" → "(hora Argentina)" */
  pais_texto: string;
  inicio_iso: string;
  hoja: string;
  fila: number;
};

/** Arma los datos del pase con la reunión de Calendly (hora y país del lead); si Calendly no responde, con la planilla y hora Argentina. */
export async function datosPase(fila: FilaLead): Promise<{ datos: DatosPase; aviso?: string } | { error: string }> {
  const digitos = digitosWhatsApp(fila.valores.telefono);
  if (digitos.length < 10 || digitos.length > 15) return { error: "el lead no tiene un teléfono con código de país" };
  const enCalendly = await reunionEnCalendly(fila).catch((e: Error) => ({ error: e.message }));
  const inicio = "error" in enCalendly ? reunionActual(fila) : enCalendly.inicio;
  if (!inicio) return { error: "la fila no tiene una fecha de reunión legible" };
  const tz = zonaValida("error" in enCalendly ? null : enCalendly.zona);
  const fecha = new Intl.DateTimeFormat("es", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(inicio).replace(",", "");
  const hora = new Intl.DateTimeFormat("es", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(inicio);
  return {
    datos: {
      tipo: "pase_al_closer",
      telefono: `+${digitos}`,
      nombre: primerNombre(fila.valores.nombre),
      closer_completo: soloNombre(("error" in enCalendly ? "" : enCalendly.closer) || nombreCloserDeHoja(fila.hoja)),
      fecha_texto: fecha,
      hora_texto: hora,
      pais_texto: paisDeZona(tz),
      inicio_iso: inicio.toISOString(),
      hoja: fila.hoja,
      fila: fila.numeroFila,
    },
    ...("error" in enCalendly ? { aviso: `sin Calendly (${enCalendly.error}): hora de Argentina` } : {}),
  };
}

/**
 * Manda el pase al webhook de Make del closer de la pestaña. Nunca tira: devuelve lo que pasó en una línea para el toast
 * ("WhatsApp del closer enviado", "WhatsApp apagado", o el error para mandarlo a mano). Cada intento queda en la pestaña
 * "Confirmaciones WhatsApp".
 */
export async function enviarPaseAlCloser(fila: FilaLead): Promise<string> {
  if (!envioPaseActivo()) return "WhatsApp del pase apagado (mandalo a mano)";
  const variable = WEBHOOK_PASE_POR_HOJA[fila.hoja];
  const url = variable ? process.env[variable] : undefined;
  if (!url) return `sin WhatsApp automático para ${nombreCloserDeHoja(fila.hoja)} (falta ${variable ?? "el escenario"}): mandalo a mano`;
  const armado = await datosPase(fila);
  const ahora = new Date().toLocaleString("es-AR", { timeZone: TZ_AR });
  const nombre = soloNombre(fila.valores.nombre);
  const closer = nombreCloserDeHoja(fila.hoja);
  if ("error" in armado) {
    await registrar([ahora, nombre, "", closer, "", "PASE NO enviado — escribirle a mano", armado.error, `pase:${fila.hoja}:${fila.numeroFila}`]).catch(() => {});
    return `WhatsApp no enviado: ${armado.error}`;
  }
  const { datos } = armado;
  const base = [ahora, nombre, datos.telefono, closer, `${datos.fecha_texto} ${datos.hora_texto} (hora ${datos.pais_texto})`];
  let falla = "";
  try {
    const apiKey = process.env.MAKE_WEBHOOK_APIKEY;
    const r = await fetch(url, {
      method: "POST",
      body: JSON.stringify(datos),
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-make-apikey": apiKey } : {}) },
    });
    if (!r.ok) falla = `Make respondió ${r.status}`;
  } catch (e) {
    falla = (e as Error).name === "TimeoutError" ? "Make no respondió en 15 s (verificar si salió)" : `no se pudo llamar a Make (${(e as Error).message})`;
  }
  await registrar([...base, falla ? "PASE ERROR — verificar y escribirle a mano" : "pase enviado a Make", [falla, armado.aviso].filter(Boolean).join(" · "), `pase:${fila.hoja}:${fila.numeroFila}`]).catch(() => {});
  return falla ? `WhatsApp no enviado: ${falla}` : "WhatsApp del closer enviado";
}
