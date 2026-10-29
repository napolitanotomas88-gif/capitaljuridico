import { asegurarUsuarios } from '@/lib/auth/accesos';
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso';
import { mismoOrigen } from '@/lib/bot/kickoff/acciones';
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos';
import { baseAccionesConfigurada } from '@/lib/clientes/acciones/registro';
import { puedeVer } from '@/lib/auth/roles';
import { deshacerAccion } from '@/lib/clientes/acciones/servidor';
// DELETE /api/clientes/<id>/acciones/<accionId> — deshacer la última acción vigente del cliente (RespuestaAccion).
export const dynamic = 'force-dynamic';
const SIN_CACHE = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const ID_CLIENTE = /^[A-Za-z]\d{1,6}$/;
const ID_ACCION = /^ac_[a-z0-9]{6,20}$/;
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: SIN_CACHE });
export async function DELETE(req: Request, ctx: {
    params: Promise<{
        id: string;
        accionId: string;
    }>;
}) {
    await asegurarUsuarios();
    const rechazo = exigirAccesoApi(req, 'clientes');
    if (rechazo)
        return rechazo;
    if (!mismoOrigen(req.headers))
        return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403);
    const { id, accionId } = await ctx.params;
    if (!ID_CLIENTE.test(id) || !ID_ACCION.test(accionId))
        return respuesta({ ok: false, mensaje: 'No encontrado.' }, 404);
    const sesion = sesionDePeticion(req.headers);
    if (!sesion)
        return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401);
    if (!puedeHacerAcciones(sesion.email))
        return respuesta({ ok: false, mensaje: 'Solo Tomás, Gero A, Gero M y Aylu pueden hacer cambios en la tarjeta.' }, 403);
    if (!baseAccionesConfigurada())
        return respuesta({ ok: false, mensaje: 'La base del Despacho no está configurada.' }, 503);
    try {
        const r = await deshacerAccion(id, accionId, sesion.nombre || 'Equipo', puedeVer(sesion, 'finanzas'));
        return respuesta(r.cuerpo, r.status);
    }
    catch (e) {
        console.error('API acciones (DELETE):', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200));
        return respuesta({ ok: false, mensaje: 'No se pudo deshacer. Probá de nuevo en un minuto.' }, 500);
    }
}
