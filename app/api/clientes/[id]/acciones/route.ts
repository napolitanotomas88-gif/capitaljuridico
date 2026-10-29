import { asegurarUsuarios } from '@/lib/auth/accesos';
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso';
import { mismoOrigen } from '@/lib/bot/kickoff/acciones';
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos';
import { hoyArgentina } from '@/lib/clientes/fechas';
import { baseAccionesConfigurada, listarAcciones, modoAcciones, pausaVigente } from '@/lib/clientes/acciones/registro';
import { camposDe } from '@/lib/clientes/acciones/campos';
import { nombresCsmVigentes } from '@/lib/clientes/acciones/csm';
import { ejecutarAccion, leerCuerpoAccion, accionesParaPersona } from '@/lib/clientes/acciones/servidor';
import type { RespuestaCampos, RespuestaHistorial } from '@/lib/clientes/acciones/tipos';
import { leerClienteFresco, metadatosPago } from '@/lib/clientes/acciones/escritor';
import { puedeVer } from '@/lib/auth/roles';
import { estaArchivado } from '@/lib/clientes/acciones/planesNuevos';
// /api/clientes/<id>/acciones — acciones sobre el cliente desde su tarjeta (lib/clientes/acciones: contrato en tipos.ts).
//   GET  → historial + pausa vigente (RespuestaHistorial) · GET ?campos=1 → campos editables con su valor (RespuestaCampos)
//   POST → CuerpoAccion (RespuestaAccion). La variable CLIENTES_ESCRITURA selecciona sombra, prueba Z001 o real.
// Misma barrera que /hitos: sesión de Google con Clientes (se repite por si el proxy no corre), mismo origen, JSON y tamaño,
// y el cliente tiene que existir en el CRM de Agencia.
export const dynamic = 'force-dynamic';
const SIN_CACHE = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const ID_CLIENTE = /^[A-Za-z]\d{1,6}$/;
const LARGO_MAX = 8000;
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: SIN_CACHE });
const sinUrls = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200);
export async function GET(req: Request, ctx: {
    params: Promise<{
        id: string;
    }>;
}) {
    await asegurarUsuarios();
    const rechazo = exigirAccesoApi(req, 'clientes');
    if (rechazo)
        return rechazo;
    const { id } = await ctx.params;
    if (!ID_CLIENTE.test(id))
        return respuesta({ ok: false, mensaje: 'No encontrado.' }, 404);
    if (new URL(req.url).searchParams.get('pago') === '1') {
        const sesion = sesionDePeticion(req.headers);
        if (!sesion || !puedeVer(sesion, 'finanzas'))
            return respuesta({ ok: false, mensaje: 'Se requiere Finanzas.' }, 403);
        try {
            const l = await leerClienteFresco(id);
            return respuesta({ ok: true, ...await metadatosPago(l.cliente, l) });
        }
        catch {
            return respuesta({ ok: false, mensaje: 'No se pudieron leer las opciones de Finanzas.' }, 503);
        }
    }
    if (new URL(req.url).searchParams.get('campos') === '1') {
        const sesion = sesionDePeticion(req.headers);
        if (!sesion)
            return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401);
        try {
            const { cliente: c } = await leerClienteFresco(id);
            if (!c)
                return respuesta({
                    ok: false, modo: modoAcciones(), campos: [], mensaje: 'Ese cliente no está en el CRM de Agencia.'
                }, 404);
            const cuerpo: RespuestaCampos = { ok: true, modo: modoAcciones(), campos: camposDe(c, puedeVer(sesion, 'finanzas'), nombresCsmVigentes()) };
            return respuesta(cuerpo);
        }
        catch {
            return respuesta({
                ok: false, modo: modoAcciones(), campos: [], mensaje: 'No se pudo leer el CRM. Probá de nuevo en un minuto.'
            }, 503);
        }
    }
    try {
        const [acciones, lectura] = await Promise.all([listarAcciones(id), leerClienteFresco(id)]);
        const sesion = sesionDePeticion(req.headers);
        const cuerpo: RespuestaHistorial = {
            ok: true, modo: modoAcciones(), acciones: accionesParaPersona(acciones, !!sesion && puedeVer(sesion, 'finanzas')), pausa: pausaVigente(acciones.filter(a => a.modo === modoAcciones()), hoyArgentina()), archivado: estaArchivado(lectura.cliente)
        };
        return respuesta(cuerpo);
    }
    catch (e) {
        console.error('API acciones (GET):', sinUrls(e));
        return respuesta({
            ok: false, modo: modoAcciones(), acciones: [], pausa: null, mensaje: 'No se pudo leer el historial.'
        }, 500);
    }
}
export async function POST(req: Request, ctx: {
    params: Promise<{
        id: string;
    }>;
}) {
    await asegurarUsuarios();
    const rechazo = exigirAccesoApi(req, 'clientes');
    if (rechazo)
        return rechazo;
    if (!mismoOrigen(req.headers))
        return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403);
    if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? ''))
        return respuesta({ ok: false, mensaje: 'Se espera JSON.' }, 415);
    const { id } = await ctx.params;
    if (!ID_CLIENTE.test(id))
        return respuesta({ ok: false, mensaje: 'No encontrado.' }, 404);
    const texto = await req.text().catch(() => null);
    if (texto === null || texto.length > LARGO_MAX)
        return respuesta({ ok: false, mensaje: 'Pedido inválido.' }, 400);
    let crudo: unknown;
    try {
        crudo = JSON.parse(texto);
    }
    catch {
        return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400);
    }
    const sesion = sesionDePeticion(req.headers);
    if (!sesion)
        return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401);
    if (!puedeHacerAcciones(sesion.email))
        return respuesta({ ok: false, mensaje: 'Solo Tomás, Gero A, Gero M y Aylu pueden hacer cambios en la tarjeta.' }, 403);
    if (!baseAccionesConfigurada())
        return respuesta({ ok: false, mensaje: 'La base del Despacho no está configurada.' }, 503);
    const cuerpo = leerCuerpoAccion(crudo);
    if (typeof cuerpo === 'string')
        return respuesta({ ok: false, mensaje: cuerpo }, 400);
    let cliente;
    try {
        cliente = (await leerClienteFresco(id)).cliente;
    }
    catch {
        return respuesta({ ok: false, mensaje: 'No se pudo leer el CRM. Probá de nuevo en un minuto.' }, 503);
    }
    if (!cliente)
        return respuesta({ ok: false, mensaje: 'Ese cliente no está en el CRM de Agencia.' }, 404);
    try {
        const r = await ejecutarAccion(cliente, cuerpo, sesion.nombre || 'Equipo', puedeVer(sesion, 'finanzas'));
        return respuesta(r.cuerpo, r.status);
    }
    catch (e) {
        console.error('API acciones (POST):', sinUrls(e));
        return respuesta({ ok: false, mensaje: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 500);
    }
}
