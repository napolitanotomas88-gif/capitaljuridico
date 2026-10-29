// Ejecutar, reconciliar y deshacer acciones del cliente. En prueba sólo Z001; en real primero se congela una reserva durable.
import { hoyArgentina, esYmdValido } from '../fechas';
import type { Cliente } from '../tipos';
import { planDatos, CAMPOS } from './campos';
import { nombresCsmVigentes } from './csm';
import { planPausa, planReanudar, planServicio } from './plan';
import { planExtra, planBeneficioReferido, evidenciaBeneficioReferido } from './planesNuevos';
import { anularAccion, guardarAccion, listarAcciones, modoAcciones, nuevoIdAccion, pausaVigente } from './registro';
import { TIPOS_ACCION, type Accion, type CuerpoAccion, type CuerpoPago, type RespuestaAccion, type TipoAccion } from './tipos';
import { claveAccionValida, idDesdeClave, huellaAccion, buscarOperacion, reservarOperacion, confirmarOperacion, anotarErrorOperacion, reservarDeshacer, confirmarDeshacer, tomarEnvio, rechazarSinEscritura, tomarEnvioReversa, cancelarReversaSinEscritura, type Operacion } from './durable';
import { leerClienteFresco, planillaAccionesReal, congelarPlan, pisoRenovaciones, aplicarPlan, estadoPlan, prepararPago, escribirPago, pagoYaEscrito, type LecturaAcciones, type PlanillaAcciones } from './escritor';
import { leerCreditosRenovacion, prepararRenovacionReferidos, agregarCanjeCongelado } from './renovacionReferidos';
import { liberarEnvioAntesDeSheets } from './durable';
import type { PlanExtra } from './planesNuevos';
const esTipo = (v: unknown): v is TipoAccion => typeof v === 'string' && (TIPOS_ACCION as readonly string[]).includes(v);
const texto = (v: unknown) => typeof v === 'string' ? v : undefined;
export function leerCuerpoAccion(x: unknown): CuerpoAccion | string {
    const o = x && typeof x === 'object' ? x as Record<string, unknown> : null;
    if (!o || !esTipo(o.tipo))
        return 'Tipo de acción desconocido.';
    if (o.clave !== undefined && !claveAccionValida(o.clave))
        return 'Clave de acción inválida.';
    const motivo = texto(o.motivo);
    if (motivo && motivo.length > 300)
        return 'El motivo es demasiado largo.';
    let b: CuerpoAccion;
    switch (o.tipo) {
        case 'servicio':
            if (!['1m', '2s', 'personalizado'].includes(String(o.duracion)))
                return 'Duración inválida (1m, 2s o personalizado).';
            b = {
                tipo: 'servicio', duracion: o.duracion as '1m', hasta: texto(o.hasta), dias: o.dias === undefined ? undefined : Number(o.dias), motivo
            };
            break;
        case 'pausa':
            b = { tipo: 'pausa', desde: texto(o.desde), motivo };
            break;
        case 'reanudar':
            b = {
                tipo: 'reanudar', fecha: texto(o.fecha), desdePausa: texto(o.desdePausa), motivo
            };
            break;
        case 'datos':
            if (!Array.isArray(o.cambios))
                return 'Faltan los cambios.';
            b = { tipo: 'datos', cambios: o.cambios.map(x => x && typeof x === 'object' ? { campo: (x as Record<string, unknown>).campo, valor: (x as Record<string, unknown>).valor } : {}) as Extract<CuerpoAccion, {
                    tipo: 'datos';
                }>['cambios'], motivo };
            break;
        case 'pago':
            if (o.tipoVenta !== undefined && !['Front-end', 'Back-end'].includes(String(o.tipoVenta))) return 'Tipo de venta inválido.';
            if (typeof o.usd !== 'number' || typeof o.fecha !== 'string' || typeof o.concepto !== 'string' || typeof o.cuenta !== 'string')
                return 'Faltan fecha, monto, concepto o cuenta del pago.';
            b = {
                tipo: 'pago', fecha: o.fecha, usd: o.usd, ars: o.ars === undefined ? undefined : Number(o.ars), concepto: o.concepto as CuerpoPago['concepto'], cuenta: o.cuenta as CuerpoPago['cuenta'], comprobanteDriveId: texto(o.comprobanteDriveId), programa: texto(o.programa), fuente: texto(o.fuente), setter: texto(o.setter), tipoVenta: o.tipoVenta as CuerpoPago['tipoVenta']
            };
            break;
        case 'archivar':
            if (typeof o.confirmacion !== 'string' || !motivo)
                return 'Falta el motivo y la confirmación del nombre para archivar.';
            b = {
                tipo: 'archivar', confirmacion: o.confirmacion, motivo, confirmado: o.confirmado === true
            };
            break;
        case 'restaurar':
            b = { tipo: 'restaurar', motivo };
            break;
        case 'renovacion':
            if (o.referidosEsperados !== undefined && !/^[a-f0-9]{64}$/.test(String(o.referidosEsperados))) return 'Revisión de referidos inválida.';
            if (typeof o.inicio !== 'string' || typeof o.meses !== 'number' || typeof o.precio !== 'number')
                return 'Faltan inicio, meses y precio de la renovación.';
            b = {
                tipo: 'renovacion', inicio: o.inicio, meses: o.meses, precio: o.precio, referidosEsperados: texto(o.referidosEsperados)
            };
            break;
        case 'proyeccion':
            if (!['link_enviado', 'agendada', 'hecha'].includes(String(o.estado)))
                return 'Estado de proyección inválido.';
            b = { tipo: 'proyeccion', estado: o.estado as 'agendada', fecha: texto(o.fecha) };
            break;
    }
    return { ...b, ...(o.clave ? { clave: String(o.clave) } : {}), ...(o.revisar === true ? { revisar: true } : {}) };
}
export interface DepsAcciones {
    creditos?: typeof leerCreditosRenovacion;
    liberarEnvioAntesDeSheets?: typeof liberarEnvioAntesDeSheets;
    historial?(id: string): Promise<Accion[]>;
    planilla: PlanillaAcciones;
    leerFresco(id: string): Promise<LecturaAcciones>;
    buscar(id: string): Promise<Operacion | null>;
    reservar: typeof reservarOperacion;
    confirmar: typeof confirmarOperacion;
    error: typeof anotarErrorOperacion;
    pago: typeof prepararPago;
    escribirPago: typeof escribirPago;
    tomarEnvio: typeof tomarEnvio;
    rechazar: typeof rechazarSinEscritura;
    pagoConfirmado: typeof pagoYaEscrito;
}
const depsReales = (): DepsAcciones => ({
    creditos: leerCreditosRenovacion, liberarEnvioAntesDeSheets,
    planilla: planillaAccionesReal(), leerFresco: id => leerClienteFresco(id), buscar: buscarOperacion, reservar: reservarOperacion, confirmar: confirmarOperacion, error: anotarErrorOperacion, pago: prepararPago, escribirPago, tomarEnvio, rechazar: rechazarSinEscritura, pagoConfirmado: pagoYaEscrito
});
const no = (mensaje: string, status = 409, codigo?: string) => ({ status, cuerpo: { ok: false, mensaje, ...(codigo ? { codigo } : {}) } as RespuestaAccion });
const monetaria = (b: CuerpoAccion) => b.tipo === 'pago' || b.tipo === 'renovacion';
export const requiereFinanzas = (b: CuerpoAccion): boolean => monetaria(b) || b.tipo === 'datos' && Array.isArray(b.cambios) && b.cambios.some(x => CAMPOS[x.campo]?.soloFinanzas === true);
export function accionesParaPersona(acciones: Accion[], conFinanzas: boolean): Accion[] {
    return acciones.map(a => {
        const publica = { ...a };
        delete publica.resultado;
        if (conFinanzas)
            return publica;
        if (a.tipo === 'pago' || a.tipo === 'renovacion' || monetaria(a.datos))
            return {
                ...publica, datos: { tipo: a.tipo } as CuerpoAccion, plan: [], resumen: a.tipo === 'pago' ? 'Pago registrado (detalle de Finanzas)' : 'Renovación registrada (detalle de Finanzas)', error: null, esDeshacible: false
            };
        if (a.datos.tipo === 'datos')
            return {
                ...publica, datos: { ...a.datos, cambios: a.datos.cambios.filter(x => !CAMPOS[x.campo]?.soloFinanzas) }, plan: a.plan.filter(x => !/pr[oó]ximo cobro/i.test(x.celda)), ...(requiereFinanzas(a.datos) ? { esDeshacible: false, resumen: 'Datos editados (detalle financiero reservado)', error: null } : {})
            };
        return publica;
    });
}
function crearPlan(c: Cliente, b: CuerpoAccion, id: string, historial: Accion[], conFinanzas: boolean) {
    const hoy = hoyArgentina(), abierta = pausaVigente(historial, hoy);
    switch (b.tipo) {
        case 'servicio': return planServicio(c, b, id);
        case 'pausa': return planPausa(c, b, hoy, abierta);
        case 'reanudar': {
            if (modoAcciones() !== 'sombra' && c.estado !== 'PAUSADO')
                return 'Solo se reanuda un cliente PAUSADO; restaurá o revisá su estado actual antes de compensar la pausa.';
            const desde = b.desdePausa;
            if (!abierta && c.estado === 'PAUSADO' && desde && !esYmdValido(desde))
                return 'La fecha de inicio de la pausa no es válida.';
            const vigente = abierta ?? (c.estado === 'PAUSADO' && desde && esYmdValido(desde) ? {
                desde, dias: 0, accionId: 'pausa-CRM', modo: modoAcciones()
            } : null);
            return planReanudar(c, b, hoy, vigente, id);
        }
        case 'datos': return planDatos(c, b, conFinanzas, nombresCsmVigentes());
        default: return planExtra(c, b, id, hoy, conFinanzas);
    }
}
async function terminar(op: Operacion, d: DepsAcciones): Promise<{
    status: number;
    cuerpo: RespuestaAccion;
}> {
    if (op.accion.estado === 'aplicada')
        return { status: 200, cuerpo: {
                ok: true, accion: op.accion, plan: op.accion.plan, ...(op.resultado.renovacionReferidos ? { renovacionReferidos: op.resultado.renovacionReferidos } : {}), mensaje: 'Esta acción ya quedó aplicada; no se repitió.'
            } };
    if (op.accion.estado !== 'registrada')
        return no('Este intento ya fue cerrado; no se reutiliza para otra acción.');
    try {
        if (!await d.tomarEnvio(op.accion.id)) {
            const aplicado = op.resultado.pago ? await d.pagoConfirmado(op.accion.id, op.resultado.pagoPreparado as Parameters<typeof escribirPago>[1]) : await estadoPlan(d.planilla, op.resultado) === 'despues';
            if (!aplicado)
                return { status: 202, cuerpo: { ok: false, accion: op.accion, mensaje: 'El envío anterior no pudo confirmarse. Se conserva la reserva y no se repite la escritura: revisar este intento antes de continuar.' } };
        }
        else if (op.resultado.pago) {
            if (!op.resultado.pagoPreparado)
                throw new Error('Falta el plan financiero congelado');
            await d.escribirPago(op.accion.id, op.resultado.pagoPreparado as Parameters<typeof escribirPago>[1]);
        }
        else
        {
            if (op.resultado.renovacionReferidos && op.accion.datos.tipo === 'renovacion') {
                try {
                    const lectura = await d.leerFresco(op.accion.idCrm);
                    const ctx = await (d.creditos ?? leerCreditosRenovacion)(op.accion.idCrm, lectura, d.planilla);
                    const base = planExtra(lectura.cliente, op.accion.datos, op.accion.id, ctx.hoy, true);
                    if (typeof base === 'string') throw Object.assign(new Error(base), { sinEscritura: true });
                    const actual = prepararRenovacionReferidos(op.accion.idCrm, op.accion.datos, base, ctx, op.accion.id, op.accion.quien);
                    if (actual.meta.huella !== op.resultado.renovacionReferidos.huella) throw Object.assign(new Error('Los créditos cambiaron desde la revisión. Volvé a revisar antes de confirmar.'), { sinEscritura: true, codigo: 'referidos_cambiaron' });
                } catch (e) {
                    if (!(e as { sinEscritura?: boolean })?.sinEscritura) await (d.liberarEnvioAntesDeSheets ?? liberarEnvioAntesDeSheets)(op.accion.id);
                    throw e;
                }
            }
            await aplicarPlan(d.planilla, op.resultado, await d.planilla.ids());
        }
        const accion = await d.confirmar(op.accion.id);
        if (op.resultado.pago) {
            const { invalidarCobrosFinanzas } = await import('../cobrosFinanzas');
            invalidarCobrosFinanzas();
        }
        const { invalidarSnapshot } = await import('../snapshot');
        invalidarSnapshot();
        return { status: 200, cuerpo: {
                ok: true, accion, plan: accion.plan, ...(op.resultado.renovacionReferidos ? { renovacionReferidos: op.resultado.renovacionReferidos } : {}), mensaje: `Aplicado y verificado: ${accion.resumen}.`
            } };
    }
    catch (e) {
        if ((e as {
            sinEscritura?: boolean;
        })?.sinEscritura) {
            await d.rechazar(op.accion.id, 'No se escribió: los datos o validaciones cambiaron');
            return no((e as Error).message, 409, (e as { codigo?: string }).codigo);
        }
        await d.error(op.accion.id).catch(() => { });
        return { status: 202, cuerpo: {
                ok: false, accion: op.accion, plan: op.accion.plan, mensaje: 'El intento quedó reservado y pendiente de confirmación. Reintentá con la misma clave; no lo cargues nuevamente con otra clave.'
            } };
    }
}
export async function ejecutarAccion(c: Cliente, cuerpo: CuerpoAccion, quien: string, conFinanzas = false, op: {
    deps?: DepsAcciones;
} = {}): Promise<{
    status: number;
    cuerpo: RespuestaAccion;
}> {
    const modo = modoAcciones();
    if (requiereFinanzas(cuerpo) && !conFinanzas)
        return no('Esta acción incluye datos que requieren permiso de Finanzas.', 403);
    if (modo === 'prueba' && (c.id.toUpperCase() !== 'Z001' || !/^PRUEBA BOT\b/i.test(c.nombre)))
        return no('Modo prueba: únicamente el cliente Z001 con nombre PRUEBA BOT.', 403);
    if (modo !== 'sombra' && !claveAccionValida(cuerpo.clave))
        return no('Falta una clave estable de intento. Recargá la pantalla y volvé a revisar la acción.', 400);
    const id = cuerpo.clave ? idDesdeClave(c.id, cuerpo.clave) : nuevoIdAccion();
    const d = modo !== 'sombra' ? op.deps ?? depsReales() : null;
    if (d && !cuerpo.revisar) {
        const previa = await d.buscar(id);
        if (previa) {
            if (previa.accion.modo !== modo)
                return no('Esta clave corresponde a otro modo de operación; generá un intento nuevo después de revisar el modo actual.');
            if (previa.huella !== huellaAccion(cuerpo))
                return no('La clave corresponde a otro contenido; no se modifica el intento original.');
            return terminar(previa, d);
        }
    }
    const lectura = d ? await d.leerFresco(c.id) : null;
    if (lectura)
        c = lectura.cliente;
    if (modo === 'prueba' && (c.id.toUpperCase() !== 'Z001' || !/^PRUEBA BOT\b/i.test(c.nombre)))
        return no('La fila de prueba no coincide con Z001 / PRUEBA BOT.', 403);
    const historial = (await (d?.historial ?? listarAcciones)(c.id)).filter(a => modo === 'sombra' || a.modo === modo);
    let plan = crearPlan(c, cuerpo, id, historial, conFinanzas);
    if (typeof plan === 'string')
        return no(plan);
    let renovacion: ReturnType<typeof prepararRenovacionReferidos> | undefined;
    let contextoCreditos: Awaited<ReturnType<typeof leerCreditosRenovacion>> | undefined;
    if (cuerpo.tipo === 'renovacion') {
        if (modo !== 'sombra' && !cuerpo.revisar && !cuerpo.referidosEsperados) return no('Revisá los meses de referidos y las fechas antes de confirmar la renovación.', 409, 'revisar_referidos');
        const fuente = lectura ?? await leerClienteFresco(c.id);
        try {
            contextoCreditos = await (d?.creditos ?? leerCreditosRenovacion)(c.id, fuente, d?.planilla ?? planillaAccionesReal());
            renovacion = prepararRenovacionReferidos(c.id, cuerpo, plan as PlanExtra, contextoCreditos, id, quien);
        } catch (e) { return no((e as Error).message, 503, (e as { codigo?: string }).codigo ?? 'referidos_no_disponibles'); }
        if (!cuerpo.revisar && modo !== 'sombra' && cuerpo.referidosEsperados !== renovacion.meta.huella) return { ...no('Los créditos cambiaron desde la revisión. Revisá los nuevos meses y fechas antes de confirmar.', 409, 'referidos_cambiaron'), cuerpo: { ...no('').cuerpo, codigo: 'referidos_cambiaron', mensaje: 'Los créditos cambiaron desde la revisión. Volvé a revisar antes de confirmar.', renovacionReferidos: renovacion.meta } };
        if (!cuerpo.revisar && modo !== 'sombra' && renovacion.pedido && (process.env.CRM_ESCRITURA_CANJE !== 'real' || (process.env.REFERIDOS_HMAC_SECRET?.length ?? 0) < 32)) return no('No se puede reservar el canje automático: falta la configuración de canjes reales. No se confirmó la renovación.', 503, 'canje_no_disponible');
        plan = renovacion.plan;
    }
    const hoy = hoyArgentina();
    const datos: CuerpoAccion = cuerpo.tipo === 'pausa' ? { ...cuerpo, desde: cuerpo.desde ?? hoy } : cuerpo.tipo === 'reanudar' ? { ...cuerpo, fecha: cuerpo.fecha ?? hoy } : cuerpo;
    let pagoPreparado: Awaited<ReturnType<typeof prepararPago>>['fila'] | undefined;
    if (d && 'pago' in plan && plan.pago) {
        let p: Awaited<ReturnType<typeof prepararPago>>;
        try {
            p = await d.pago(c, plan.pago as CuerpoPago, lectura ?? undefined);
        }
        catch (e) {
            if ((e as {
                sinEscritura?: boolean;
            })?.sinEscritura)
                return no((e as Error).message);
            throw e;
        }
        if (p.duplicado !== null)
            return no(`Ya existe un pago igual en Finanzas (fila ${p.duplicado}); no se duplica.`);
        pagoPreparado = p.fila;
        plan.plan.push(...(['B', 'K', 'H', 'N', 'O'] as const).map((k, i) => ({
            hoja: 'Finanzas · Registro de Pagos', celda: ['Programa', 'Fuente', 'Setter', 'Tipo de venta', 'Tipo de pago'][i], antes: '', despues: String(p.fila.celdas[k] ?? '')
        })));
    }
    if (cuerpo.revisar)
        return { status: 200, cuerpo: {
                ok: true, plan: plan.plan, ...(renovacion ? { renovacionReferidos: renovacion.meta } : {}), ...(pagoPreparado ? { pago: { programa: String(pagoPreparado.celdas.B ?? ''), fuente: String(pagoPreparado.celdas.K ?? ''), setter: String(pagoPreparado.celdas.H ?? ''), tipoVenta: String(pagoPreparado.celdas.N ?? ''), tipoPago: String(pagoPreparado.celdas.O ?? '') } } : {}), mensaje: `Revisión: ${plan.resumen}. ${modo === 'sombra' ? 'Modo sombra: no se escribe el CRM.' : 'Al confirmar se aplicará y verificará la escritura.'}`
            } };
    const n = {
        id, idCrm: c.id, tipo: cuerpo.tipo, estado: 'registrada' as const, modo, datos, plan: plan.plan, resumen: plan.resumen, quien
    };
    if (!d || !lectura) {
        const accion = await guardarAccion(n);
        return { status: 200, cuerpo: {
                ok: true, accion, plan: plan.plan, mensaje: `Modo sombra: registrado sin modificar el CRM. ${plan.resumen}.`
            } };
    }
    const tieneFila = !!(('extension' in plan && plan.extension) || ('renovacion' in plan && plan.renovacion));
    let reserva: Operacion;
    try { reserva = await d.reservar(n, cuerpo.clave!, huellaAccion(cuerpo), tieneFila ? pisoRenovaciones(lectura) : null, (fila, canje) => {
        const resultado = { ...congelarPlan(lectura, plan, fila), ...(pagoPreparado ? { pagoPreparado } : {}) };
        return renovacion && contextoCreditos ? agregarCanjeCongelado(resultado, contextoCreditos, canje, renovacion.canje, quien, renovacion.meta) : resultado;
    }, renovacion?.pedido); }
    catch (e) {
        if ((e as { codigo?: string }).codigo === 'canje_concurrente') return no((e as Error).message, 409, 'canje_concurrente');
        if ((e as { codigo?: string }).codigo === 'cliente_con_accion_pendiente') return no((e as Error).message, 409, 'cliente_con_accion_pendiente');
        if (renovacion?.pedido && (e as { code?: string }).code === '42P01') return no('No está disponible la tabla de reservas de canjes. No se guardó la renovación ni se consumieron meses.', 503, 'canje_no_disponible');
        throw e;
    }
    return terminar(reserva, d);
}
export interface DepsDeshacer {
    historial: typeof listarAcciones;
    reservar: typeof reservarDeshacer;
    tomarEnvio: typeof tomarEnvioReversa;
    cancelar: typeof cancelarReversaSinEscritura;
    confirmar: typeof confirmarDeshacer;
    planilla: PlanillaAcciones;
}
const depsDeshacerReales = (): DepsDeshacer => ({
    historial: listarAcciones, reservar: reservarDeshacer, tomarEnvio: tomarEnvioReversa, cancelar: cancelarReversaSinEscritura, confirmar: confirmarDeshacer, planilla: planillaAccionesReal()
});
export async function deshacerAccion(idCrm: string, accionId: string, quien: string, conFinanzas = false, op: {
    deps?: DepsDeshacer;
} = {}): Promise<{
    status: number;
    cuerpo: RespuestaAccion;
}> {
    const d = op.deps ?? depsDeshacerReales();
    const historial = await d.historial(idCrm), ultima = historial.find(a => a.estado !== 'anulada' && a.estado !== 'error');
    const yaAnulada = historial.find(a => a.id === accionId && a.estado === 'anulada');
    if (yaAnulada)
        return { status: 200, cuerpo: { ok: true, accion: accionesParaPersona([yaAnulada], conFinanzas)[0], mensaje: 'La acción ya estaba deshecha; no se repitió.' } };
    if (!ultima)
        return no('No hay acciones para deshacer.', 404);
    if (ultima.id !== accionId)
        return no('Solo se puede deshacer la última acción vigente del cliente.');
    if (requiereFinanzas(ultima.datos) && !conFinanzas)
        return no('Esta acción requiere Finanzas.', 403);
    if (ultima.tipo === 'renovacion' && (ultima.renovacionReferidos?.mesesReferidos ?? 0) > 0)
        return no('Esta renovación consumió créditos. Requiere una corrección conjunta del servicio y del libro; no admite deshacer automático.', 409, 'renovacion_con_creditos');
    if (ultima.modo !== 'sombra' && ultima.modo !== modoAcciones())
        return no('El modo actual no permite revertir esta escritura; revisá la configuración antes de continuar.');
    if (modoAcciones() === 'prueba' && idCrm.toUpperCase() !== 'Z001')
        return no('La reversa de prueba solo admite Z001.', 403);
    if (ultima.estado === 'aplicada') {
        const operacion = await d.reservar(idCrm, accionId);
        const p = d.planilla;
        try {
            if (await d.tomarEnvio(accionId)) {
                await aplicarPlan(p, operacion.resultado, await p.ids(), true);
            }
            else if (await estadoPlan(p, operacion.resultado) !== 'antes') {
                return { status: 202, cuerpo: { ok: false, mensaje: 'La reversa anterior está pendiente de confirmación. No se vuelve a escribir; se reconciliará al comprobar el CRM.' } };
            }
            const accion = await d.confirmar(accionId, quien);
            const { invalidarSnapshot } = await import('../snapshot');
            invalidarSnapshot();
            return { status: 200, cuerpo: { ok: true, accion, mensaje: 'Deshecho y verificado en el CRM.' } };
        }
        catch (e) {
            if ((e as {
                sinEscritura?: boolean;
            })?.sinEscritura) {
                await d.cancelar(accionId);
                return no((e as Error).message);
            }
            return { status: 202, cuerpo: { ok: false, mensaje: 'La reversa pudo haberse aplicado. Queda reservada para verificarla sin repetir escrituras.' } };
        }
    }
    if (ultima.modo !== 'sombra')
        return no('Primero hay que confirmar o reconciliar la escritura pendiente.');
    const accion = await anularAccion(accionId, idCrm, quien);
    return accion ? { status: 200, cuerpo: { ok: true, accion, mensaje: 'Deshecho.' } } : no('La acción ya estaba deshecha.');
}
export interface DepsBeneficio {
    leerFresco: typeof leerClienteFresco;
    buscar: typeof buscarOperacion;
    ejecutar: typeof ejecutarAccion;
}
/** Para altas/cierres: el llamador ya comprobó la condición referido+Cerró. La clave estable se deriva del ID del nuevo cliente. */
export async function aplicarBeneficioReferido(idCrm: string, _claveOrigen: string, quien: string, op: {
    revisar?: boolean;
    deps?: DepsBeneficio;
} = {}): Promise<{
    status: number;
    cuerpo: RespuestaAccion;
}> {
    const d = op.deps ?? { leerFresco: leerClienteFresco, buscar: buscarOperacion, ejecutar: ejecutarAccion };
    const l = await d.leerFresco(idCrm);
    const clave = `beneficio-referido-${idCrm.toUpperCase()}`;
    const b: CuerpoAccion = {
        tipo: 'servicio', duracion: '1m', motivo: 'beneficio por ingresar como referido cerrado', clave, ...(op.revisar ? { revisar: true } : {})
    };
    const ejecutarYComprobar = async () => {
        const r = await d.ejecutar(l.cliente, { ...b, ...(modoAcciones() === 'sombra' ? { revisar: true } : {}) }, quien, false);
        if (r.status !== 200 || !r.cuerpo.ok || r.cuerpo.accion?.estado !== 'aplicada')
            return r;
        const actual = await d.leerFresco(idCrm);
        if (evidenciaBeneficioReferido(actual.cliente).estado !== 'incluido')
            return no('La operación figura aplicada pero el mes por referido no se confirma en el CRM. Se conserva para revisión; no se duplica.');
        return { ...r, cuerpo: { ...r.cuerpo, beneficioAplicado: true as const } };
    };
    if (modoAcciones() !== 'sombra' && !op.revisar && await d.buscar(idDesdeClave(idCrm, clave)))
        return ejecutarYComprobar();
    const e = evidenciaBeneficioReferido(l.cliente);
    if (e.estado === 'incluido')
        return { status: 200, cuerpo: { ok: true, beneficioAplicado: true, mensaje: `El mes extra ya está incluido: ${e.evidencia}` } };
    if (e.estado === 'ambiguo')
        return no(e.evidencia);
    const plan = planBeneficioReferido(l.cliente, idDesdeClave(idCrm, b.clave!));
    if (typeof plan === 'string')
        return no(plan);
    return ejecutarYComprobar();
}
/** El cron sólo reconcilia la evidencia de un envío anterior o ejecuta una reserva que aún no tuvo envío. */
export async function reconciliarAccionesPendientes(op: {
    limite?: number;
} = {}) {
    const { listarPendientes } = await import('./durable');
    const pendientes = await listarPendientes(modoAcciones(), op.limite ?? 10);
    const resultados: {
        id: string;
        estado: 'aplicada' | 'pendiente' | 'error';
    }[] = [];
    const deps = depsReales();
    for (const accion of pendientes) {
        if (accion.accion.modo === 'prueba' && accion.accion.idCrm.toUpperCase() !== 'Z001') {
            resultados.push({ id: accion.accion.id, estado: 'error' });
            continue;
        }
        try {
            const r = accion.resultado.deshaciendo ? await deshacerAccion(accion.accion.idCrm, accion.accion.id, 'Reconciliación del Despacho', true) : await terminar(accion, deps);
            resultados.push({ id: accion.accion.id, estado: r.cuerpo.ok ? 'aplicada' : r.status === 202 ? 'pendiente' : 'error' });
        }
        catch {
            resultados.push({ id: accion.accion.id, estado: 'error' });
        }
    }
    return {
        revisadas: resultados.length, aplicadas: resultados.filter(x => x.estado === 'aplicada').length, pendientes: resultados.filter(x => x.estado === 'pendiente').length, resultados
    };
}
