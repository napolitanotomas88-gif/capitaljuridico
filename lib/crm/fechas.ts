// Fechas en la zona de negocio (Buenos Aires). Vercel corre en UTC, así que
// nunca usamos getHours()/getDate() locales: todo pasa por estas funciones.

export const ZONA_NEGOCIO = "America/Argentina/Buenos_Aires";

// Argentina no usa horario de verano desde 2009: offset fijo UTC-3.
const OFFSET_MS = -3 * 60 * 60 * 1000;
const MS_DIA = 24 * 60 * 60 * 1000;

// dd/mm/yyyy, opcionalmente con HH:mm o HH:mm:ss (la hora puede venir con 1 dígito).
const RE_FECHA_SHEET =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parsea el texto que usa la planilla (`dd/mm/yyyy HH:mm:ss`, con o sin
 * segundos, o solo la fecha) como hora de Buenos Aires.
 * Devuelve null si el texto no es una fecha válida.
 */
export function parsearFechaSheet(texto: string | null | undefined): Date | null {
  const m = RE_FECHA_SHEET.exec((texto ?? "").trim());
  if (!m) return null;

  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [hora, minuto, segundo] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  if (hora > 23 || minuto > 59 || segundo > 59) return null;

  const base = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechaza fechas que Date "corrige" solas, como 31/02.
  if (base.getUTCFullYear() !== anio || base.getUTCMonth() !== mes - 1 || base.getUTCDate() !== dia) {
    return null;
  }

  return new Date(Date.UTC(anio, mes - 1, dia, hora, minuto, segundo) - OFFSET_MS);
}

/** Formatea como lo escribe la planilla: `dd/mm/yyyy HH:mm:ss` en hora de Buenos Aires. */
export function formatearFechaSheet(fecha: Date): string {
  const local = new Date(fecha.getTime() + OFFSET_MS);
  const dos = (n: number) => String(n).padStart(2, "0");
  return (
    `${dos(local.getUTCDate())}/${dos(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ` +
    `${dos(local.getUTCHours())}:${dos(local.getUTCMinutes())}:${dos(local.getUTCSeconds())}`
  );
}

// Fecha escrita a mano: "12/03 15 hs", "12/03/26 10 am", "el 12/03 a las 15:30", "12/03".
// Tiene que ser SOLO la fecha (y hora): textos como "12/03 FUP" son recordatorios, no reagendas.
const RE_FECHA_LIBRE =
  /^(?:el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?:\s*(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(hs?\.?|am|pm)?)?\s*$/i;

/**
 * Parsea la fecha de reagenda (AC). Acepta el formato de la planilla y, además, fechas
 * escritas a mano sin año; el año se deduce de la fecha de la call (la reagenda es posterior).
 * Devuelve null si el texto no es solo una fecha.
 */
export function parsearFechaReagenda(texto: string | null | undefined, fechaCall: Date): Date | null {
  const estricta = parsearFechaSheet(texto);
  if (estricta) return estricta;

  const m = RE_FECHA_LIBRE.exec((texto ?? "").trim());
  if (!m) return null;
  const [, dia, mes, anioTexto, horaTexto, minutos, sufijo] = m;
  // "12/03 15" es ambiguo: la hora sin minutos necesita "hs", "am" o "pm".
  if (horaTexto && !minutos && !sufijo) return null;

  let hora = Number(horaTexto ?? 0);
  if (sufijo?.toLowerCase() === "pm" && hora < 12) hora += 12;
  if (sufijo?.toLowerCase() === "am" && hora === 12) hora = 0;
  const hhmm = `${hora}:${minutos ?? "00"}`;

  if (anioTexto) {
    const anio = anioTexto.length === 2 ? 2000 + Number(anioTexto) : Number(anioTexto);
    return parsearFechaSheet(`${dia}/${mes}/${anio} ${hhmm}`);
  }
  const anioCall = new Date(fechaCall.getTime() + OFFSET_MS).getUTCFullYear();
  const mismoAnio = parsearFechaSheet(`${dia}/${mes}/${anioCall} ${hhmm}`);
  // Si queda más de una semana antes de la call, es del año siguiente (call 28/12 → "05/01").
  if (mismoAnio && diasDesde(mismoAnio, fechaCall) > 7) {
    return parsearFechaSheet(`${dia}/${mes}/${anioCall + 1} ${hhmm}`);
  }
  return mismoAnio;
}

/**
 * Convierte el número de serie de Sheets (días desde 30/12/1899, con la hora como fracción)
 * al texto de la planilla. El serial es hora "de pared", así que no se aplica offset.
 */
export function textoDesdeSerialSheets(serial: number): string {
  const ms = Math.round((serial - 25569) * MS_DIA / 1000) * 1000; // 25569 = días hasta 01/01/1970
  return formatearFechaSheet(new Date(ms - OFFSET_MS));
}

/** Número de día calendario en Buenos Aires (sirve para comparar y restar días). */
function numeroDia(fecha: Date): number {
  return Math.floor((fecha.getTime() + OFFSET_MS) / MS_DIA);
}

/** Días calendario entre `desde` y `ahora`, en Buenos Aires. Negativo si `desde` es futuro. */
export function diasDesde(desde: Date, ahora: Date): number {
  return numeroDia(ahora) - numeroDia(desde);
}

/** true si ambas fechas caen en el mismo día calendario de Buenos Aires. */
export function mismoDia(a: Date, b: Date): boolean {
  return numeroDia(a) === numeroDia(b);
}

// Nombres en castellano, fijos para no depender de los datos ICU del servidor.
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Partes de la fecha en hora de Buenos Aires (mes 1-12, diaSemana 0 = domingo). */
export function partesFecha(fecha: Date) {
  const local = new Date(fecha.getTime() + OFFSET_MS);
  return {
    dia: local.getUTCDate(),
    mes: local.getUTCMonth() + 1,
    anio: local.getUTCFullYear(),
    hora: local.getUTCHours(),
    minuto: local.getUTCMinutes(),
    diaSemana: local.getUTCDay(),
  };
}

const dos = (n: number) => String(n).padStart(2, "0");

/** "jue 24/09 15:00": para la tarjeta de la lista del día. */
export function formatearCorto(fecha: Date): string {
  const p = partesFecha(fecha);
  return `${DIAS_CORTOS[p.diaSemana]} ${dos(p.dia)}/${dos(p.mes)} ${dos(p.hora)}:${dos(p.minuto)}`;
}

/** "jueves 24 de septiembre": para el encabezado de la pantalla. */
export function formatearFechaLarga(fecha: Date): string {
  const p = partesFecha(fecha);
  return `${DIAS_SEMANA[p.diaSemana]} ${p.dia} de ${MESES[p.mes - 1]}`;
}

/** "15:00" (hora de Buenos Aires): para la tira de calls y "Hechas hoy". */
export function horaCorta(fecha: Date): string {
  const p = partesFecha(fecha);
  return `${dos(p.hora)}:${dos(p.minuto)}`;
}
