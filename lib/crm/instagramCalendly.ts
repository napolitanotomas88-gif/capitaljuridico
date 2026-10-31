// Sólo servidor. Enriquecimiento de lectura al abrir la ficha; no escribe en Sheets ni modifica Make.
import { parsearFechaSheet } from "@/lib/crm/fechas";
import { respuestaInstagram, type InstagramAgenda } from "@/lib/crm/instagram";

const API = "https://api.calendly.com";
const SIN_DATO: InstagramAgenda = { estado: "sin_dato" };
const NO_DISPONIBLE: InstagramAgenda = { estado: "no_disponible" };
type Objeto = Record<string, unknown>;
const objeto = (x: unknown): Objeto => x && typeof x === "object" && !Array.isArray(x) ? x as Objeto : {};
const lista = (x: unknown): Objeto[] => Array.isArray(x) ? x.map(objeto) : [];

/** Lector con caché acotada por identidad+fecha y deduplicación de peticiones. Se inyecta fetch/reloj para pruebas sin red. */
export function crearLectorInstagram(token: string, pedir: typeof fetch = fetch, reloj: () => number = Date.now) {
  let organizacion: { uri: string; hasta: number } | undefined;
  const cache = new Map<string, { dato: InstagramAgenda; hasta: number }>();
  const pendientes = new Map<string, Promise<InstagramAgenda>>();

  async function consultar(email: string, fecha: Date): Promise<InstagramAgenda> {
    const signal = AbortSignal.timeout(5000);
    const get = async (url: string): Promise<Objeto> => {
      const r = await pedir(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal });
      if (!r.ok) throw new Error("Calendly no disponible");
      return objeto(await r.json());
    };
    try {
      if (!organizacion || organizacion.hasta <= reloj()) {
        const me = objeto((await get(`${API}/users/me`)).resource);
        if (typeof me.current_organization !== "string" || !/^https:\/\/api\.calendly\.com\/organizations\/[\w-]+$/.test(me.current_organization)) return NO_DISPONIBLE;
        organizacion = { uri: me.current_organization, hasta: reloj() + 300_000 };
      }
      const q = new URLSearchParams({ organization: organizacion.uri, invitee_email: email,
        min_start_time: new Date(fecha.getTime() - 1000).toISOString(), max_start_time: new Date(fecha.getTime() + 1000).toISOString(), count: "20" });
      // D es la reserva original, incluso cancelada/reprogramada: allí se respondió el formulario. No se usa AC para atribuir otra reserva.
      const eventos = await get(`${API}/scheduled_events?${q}`);
      if (!Array.isArray(eventos.collection)) return NO_DISPONIBLE;
      if (objeto(eventos.pagination).next_page) return NO_DISPONIBLE;
      const coincidencias = lista(eventos.collection).filter(e => typeof e.start_time === "string" && new Date(e.start_time).getTime() === fecha.getTime()
        && typeof e.name === "string" && /consultiva/i.test(e.name));
      if (coincidencias.length === 0) return SIN_DATO;
      if (coincidencias.length !== 1) return NO_DISPONIBLE;
      const uri = coincidencias[0].uri;
      if (typeof uri !== "string" || !/^https:\/\/api\.calendly\.com\/scheduled_events\/[\w-]+$/.test(uri)) return NO_DISPONIBLE;
      const invitados = await get(`${uri}/invitees?count=100`);
      if (!Array.isArray(invitados.collection)) return NO_DISPONIBLE;
      if (objeto(invitados.pagination).next_page) return NO_DISPONIBLE;
      const personas = lista(invitados.collection).filter(i => typeof i.email === "string" && i.email.trim().toLowerCase() === email);
      if (personas.length !== 1) return personas.length === 0 ? SIN_DATO : NO_DISPONIBLE;
      const texto = respuestaInstagram(personas[0].questions_and_answers);
      return texto ? { estado: "disponible", texto } : SIN_DATO;
    } catch { return NO_DISPONIBLE; }
  }

  return async (valores: { email?: string | null; fechaCall?: string | null }): Promise<InstagramAgenda> => {
    const email = typeof valores.email === "string" ? valores.email.trim().toLowerCase() : "";
    const fecha = parsearFechaSheet(typeof valores.fechaCall === "string" ? valores.fechaCall : "");
    if (!token || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fecha) return SIN_DATO;
    const clave = `${email}|${fecha.toISOString()}`;
    const previo = cache.get(clave);
    if (previo && previo.hasta > reloj()) return previo.dato;
    const enCurso = pendientes.get(clave);
    if (enCurso) return enCurso;
    const trabajo = consultar(email, fecha).then(dato => {
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(clave, { dato, hasta: reloj() + (dato.estado === "disponible" ? 300_000 : 30_000) });
      return dato;
    }).finally(() => pendientes.delete(clave));
    pendientes.set(clave, trabajo);
    return trabajo;
  };
}

let lector: { token: string; leer: ReturnType<typeof crearLectorInstagram> } | undefined;
export async function instagramDeAgenda(valores: { email?: string | null; fechaCall?: string | null }): Promise<InstagramAgenda> {
  const token = process.env.CALENDLY_VENTAS_TOKEN || process.env.CALENDLY_TOKEN;
  if (!token) return NO_DISPONIBLE;
  if (!lector || lector.token !== token) lector = { token, leer: crearLectorInstagram(token) };
  return lector.leer(valores);
}
