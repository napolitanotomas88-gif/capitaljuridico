// Reservas durables antes de Sheets. Una acción pendiente bloquea nuevas acciones del mismo cliente hasta reconciliarla.
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Accion, CuerpoAccion, ResultadoEscritura, ModoAcciones } from './tipos';
import type { NuevaAccion } from './registro';
import { reservarCanjeConConsulta, confirmarCanjeConConsulta, SQL_CANJE, CLAVE_LOCK_CANJE, type PedidoReservaCanje, type ReservaCanje } from '../reservasCanje';
import { resumenRenovacion } from './resumenRenovacion';
const LOCK = '7261900501';
let pool: Pool | null = null;
const getPool = async () => {
    if (!pool) {
        const { Pool } = await import('pg');
        pool = new Pool({
            connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000
        });
    }
    return pool;
};
export const claveAccionValida = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_.:-]{8,100}$/.test(x);
export function idDesdeClave(idCrm: string, clave: string): string { return `ac_${createHash('sha256').update(`${idCrm.toUpperCase()}\0${clave}`).digest('hex').slice(0, 18)}`; }
function estable(x: unknown): unknown {
    if (Array.isArray(x))
        return x.map(estable);
    if (x && typeof x === 'object')
        return Object.fromEntries(Object.entries(x).filter(([k, v]) => !['clave', 'revisar'].includes(k) && v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, estable(v)]));
    return x;
}
export const huellaAccion = (b: CuerpoAccion) => createHash('sha256').update(JSON.stringify(estable(b))).digest('hex');
export interface Operacion {
    accion: Accion;
    resultado: ResultadoEscritura;
    huella: string;
}
const iso = (v: unknown): string | null => v ? new Date(String(v)).toISOString() : null;
export function operacionDesde(f: Record<string, unknown>): Operacion {
    const resultado = f.resultado as ResultadoEscritura;
    return { huella: String(f.huella ?? ''), resultado, accion: {
            id: String(f.id), idCrm: String(f.id_crm), tipo: f.tipo as Accion['tipo'], estado: f.estado as Accion['estado'], modo: f.modo as ModoAcciones, datos: f.datos as CuerpoAccion, plan: f.plan as Accion['plan'], resumen: String(f.resumen ?? ''), quien: String(f.quien ?? ''), creada: iso(f.creada)!, aplicada: iso(f.aplicada), anulada: iso(f.anulada), error: f.error ? String(f.error) : null, esDeshacible: !resultado?.pago && !resultado?.canje, renovacionReferidos: resumenRenovacion(resultado)
        } };
}
async function esquema(c: PoolClient) {
    await c.query(`CREATE TABLE IF NOT EXISTS cj_cliente_acciones (
    id text PRIMARY KEY, id_crm text NOT NULL, tipo text NOT NULL, estado text NOT NULL, modo text NOT NULL,
    datos jsonb NOT NULL, plan jsonb NOT NULL DEFAULT '[]'::jsonb, resumen text NOT NULL DEFAULT '', quien text NOT NULL DEFAULT '',
    creada timestamptz NOT NULL DEFAULT now(), aplicada timestamptz, anulada timestamptz, anulada_por text, error text, resultado jsonb)`);
    await c.query('ALTER TABLE cj_cliente_acciones ADD COLUMN IF NOT EXISTS clave text, ADD COLUMN IF NOT EXISTS huella text');
    await c.query('CREATE UNIQUE INDEX IF NOT EXISTS cj_cliente_acciones_clave ON cj_cliente_acciones(id_crm, clave) WHERE clave IS NOT NULL');
    await c.query('CREATE TABLE IF NOT EXISTS cj_cliente_acciones_filas (hoja text NOT NULL, fila integer NOT NULL, accion_id text UNIQUE NOT NULL, PRIMARY KEY(hoja,fila))');
}
async function transaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await (await getPool()).connect();
    try {
        await c.query('BEGIN');
        await c.query("SET LOCAL lock_timeout = '8s'");
        await c.query("SET LOCAL statement_timeout = '15s'");
        await c.query('SELECT pg_advisory_xact_lock($1::bigint)', [LOCK]);
        await esquema(c);
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
    }
    catch (e) {
        await c.query('ROLLBACK').catch(() => { });
        throw e;
    }
    finally {
        c.release();
    }
}
export async function buscarOperacion(id: string): Promise<Operacion | null> {
    return transaccion(async (c) => { const r = await c.query('SELECT * FROM cj_cliente_acciones WHERE id=$1', [id]); return r.rows[0] ? operacionDesde(r.rows[0]) : null; });
}
export async function reservarOperacion(n: NuevaAccion, clave: string, huella: string, piso: number | null, construir: (fila: number | null, canje?: ReservaCanje) => ResultadoEscritura, pedidoCanje?: PedidoReservaCanje): Promise<Operacion> {
    return transaccion(async (c) => {
        const anterior = (await c.query('SELECT * FROM cj_cliente_acciones WHERE id_crm=$1 AND clave=$2', [n.idCrm.toUpperCase(), clave])).rows[0];
        if (anterior) {
            if (anterior.huella !== huella)
                throw new Error('La clave ya se usó para otra acción; conservá la clave del intento original');
            return operacionDesde(anterior);
        }
        const pendiente = (await c.query("SELECT id FROM cj_cliente_acciones WHERE id_crm=$1 AND modo IN ('real','prueba') AND (estado='registrada' OR resultado->>'deshaciendo'='true') LIMIT 1", [n.idCrm.toUpperCase()])).rows[0];
        if (pendiente)
            throw Object.assign(new Error('Hay una acción pendiente de confirmar para este cliente; reconciliá ese intento antes de crear otro'), { codigo: 'cliente_con_accion_pendiente' });
        let fila: number | null = null;
        if (piso !== null) {
            const max = (await c.query("SELECT COALESCE(MAX(fila),1) AS m FROM cj_cliente_acciones_filas WHERE hoja='Renovaciones'")).rows[0];
            fila = Math.max(piso, Number(max.m) + 1);
            await c.query("INSERT INTO cj_cliente_acciones_filas(hoja,fila,accion_id) VALUES('Renovaciones',$1,$2)", [fila, n.id]);
        }
        let canje: ReservaCanje | undefined;
        if (pedidoCanje) {
            const reserva = await reservarCanjeConConsulta(c.query.bind(c), pedidoCanje, process.env.REFERIDOS_HMAC_SECRET ?? '');
            if (reserva.tipo !== 'nueva') throw Object.assign(new Error('Hay un canje reservado o aplicado para este ciclo; revisá el saldo antes de confirmar otra renovación'), { codigo: 'canje_concurrente' });
            canje = reserva.reserva;
        }
        const resultado = construir(fila, canje);
        const r = await c.query(`INSERT INTO cj_cliente_acciones(id,id_crm,tipo,estado,modo,datos,plan,resumen,quien,clave,huella,resultado)
      VALUES($1,$2,$3,'registrada',$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11::jsonb) RETURNING *`, [n.id, n.idCrm.toUpperCase(), n.tipo, n.modo, JSON.stringify(n.datos), JSON.stringify(n.plan), n.resumen, n.quien, clave, huella, JSON.stringify(resultado)]);
        return operacionDesde(r.rows[0]);
    });
}
export async function confirmarOperacion(id: string): Promise<Accion> {
    return transaccion(async (c) => {
        const previa = (await c.query('SELECT * FROM cj_cliente_acciones WHERE id=$1 FOR UPDATE', [id])).rows[0];
        const canje = (previa?.resultado as ResultadoEscritura | undefined)?.canje;
        if (canje) {
            const confirmado = await confirmarCanjeConConsulta(c.query.bind(c), canje.idNumero, { estado: 'guardado', id: canje.id, fila: canje.fila, meses: canje.meses, usd: 0, avisos: [], mensaje: `Canje automático de ${canje.meses} meses aplicado junto con la renovación; conserva los USD.` });
            if (!confirmado) throw new Error('No se pudo confirmar el canje asociado; se conserva la acción pendiente');
        }
        const r = await c.query("UPDATE cj_cliente_acciones SET estado='aplicada',aplicada=COALESCE(aplicada,now()),error=NULL WHERE id=$1 AND estado IN ('registrada','aplicada') RETURNING *", [id]);
        if (!r.rows[0])
            throw new Error('La acción cambió de estado');
        return operacionDesde(r.rows[0]).accion;
    });
}
export async function anotarErrorOperacion(id: string): Promise<void> { await transaccion(async (c) => { await c.query("UPDATE cj_cliente_acciones SET error='Escritura pendiente de confirmación; reintentar con la misma clave' WHERE id=$1 AND estado='registrada'", [id]); }); }
export async function reservarDeshacer(idCrm: string, id: string): Promise<Operacion> {
    return transaccion(async (c) => {
        const rows = (await c.query("SELECT * FROM cj_cliente_acciones WHERE id_crm=$1 AND estado NOT IN ('anulada','error') ORDER BY creada DESC LIMIT 1", [idCrm.toUpperCase()])).rows;
        const op = rows[0] ? operacionDesde(rows[0]) : null;
        if (!op || op.accion.id !== id)
            throw new Error('Solo se puede deshacer la última acción vigente del cliente');
        if (op.resultado?.canje) throw new Error('Esta renovación consumió créditos. Requiere una corrección conjunta de servicio y libro; no admite deshacer automático.');
        if (op.accion.estado !== 'aplicada' || !op.resultado || op.resultado.pago)
            throw new Error('Esta acción no admite deshacer automático; un pago se corrige con un ajuste de Finanzas');
        await c.query("UPDATE cj_cliente_acciones SET resultado=jsonb_set(resultado,'{deshaciendo}','true') WHERE id=$1", [id]);
        return op;
    });
}
export async function confirmarDeshacer(id: string, quien: string): Promise<Accion> {
    return transaccion(async (c) => {
        const r = await c.query("UPDATE cj_cliente_acciones SET estado='anulada',anulada=now(),anulada_por=$2,resultado=resultado-'deshaciendo'-'reversaEnvioIniciado' WHERE id=$1 AND estado='aplicada' RETURNING *", [id, quien]);
        if (r.rows[0])
            return operacionDesde(r.rows[0]).accion;
        const anterior = (await c.query("SELECT * FROM cj_cliente_acciones WHERE id=$1 AND estado='anulada'", [id])).rows[0];
        if (anterior)
            return operacionDesde(anterior).accion;
        throw new Error('La acción ya no está aplicada');
    });
}
/** Un solo envío HTTP por operación. Los reintentos sólo reconcilian la evidencia, nunca repiten un POST ambiguo. */
export async function tomarEnvio(id: string): Promise<boolean> {
    return transaccion(async (c) => {
        const r = await c.query("UPDATE cj_cliente_acciones SET resultado=jsonb_set(resultado,'{envioIniciado}','true') WHERE id=$1 AND estado='registrada' AND COALESCE(resultado->>'envioIniciado','false')<>'true' RETURNING id", [id]);
        return r.rows.length === 1;
    });
}
/** Sólo para una validación previa que falló ANTES de llamar a Sheets: conserva la reserva y permite retomar. */
export async function liberarEnvioAntesDeSheets(id: string): Promise<void> {
    await transaccion(async c => { await c.query("UPDATE cj_cliente_acciones SET resultado=resultado-'envioIniciado' WHERE id=$1 AND estado='registrada'", [id]); });
}
export async function rechazarSinEscritura(id: string, mensaje: string): Promise<void> {
    await transaccion(async (c) => {
        const previa = (await c.query("SELECT resultado FROM cj_cliente_acciones WHERE id=$1 AND estado='registrada' FOR UPDATE", [id])).rows[0];
        const canje = (previa?.resultado as ResultadoEscritura | undefined)?.canje;
        if (canje) {
            await c.query(SQL_CANJE.lock, [CLAVE_LOCK_CANJE]);
            await c.query(SQL_CANJE.liberar, [canje.idNumero]);
        }
        await c.query("UPDATE cj_cliente_acciones SET estado='error',error=$2 WHERE id=$1 AND estado='registrada'", [id, mensaje.slice(0, 200)]);
    });
}
export async function listarPendientes(modo: ModoAcciones, limite = 10): Promise<Operacion[]> {
    if (modo === 'sombra')
        return [];
    return transaccion(async (c) => {
        const r = await c.query("SELECT * FROM cj_cliente_acciones WHERE modo=$1 AND (estado='registrada' OR estado='aplicada' AND resultado->>'deshaciendo'='true') AND resultado->>'version'='1' ORDER BY creada LIMIT $2", [modo, Math.min(20, Math.max(1, Math.trunc(limite)))]);
        return r.rows.map(operacionDesde);
    });
}
export async function tomarEnvioReversa(id: string): Promise<boolean> {
    return transaccion(async (c) => {
        const r = await c.query("UPDATE cj_cliente_acciones SET resultado=jsonb_set(resultado,'{reversaEnvioIniciado}','true') WHERE id=$1 AND estado='aplicada' AND resultado->>'deshaciendo'='true' AND COALESCE(resultado->>'reversaEnvioIniciado','false')<>'true' RETURNING id", [id]);
        return r.rows.length === 1;
    });
}
export async function cancelarReversaSinEscritura(id: string): Promise<void> {
    await transaccion(async (c) => {
        await c.query("UPDATE cj_cliente_acciones SET resultado=resultado-'deshaciendo'-'reversaEnvioIniciado' WHERE id=$1 AND estado='aplicada'", [id]);
    });
}
