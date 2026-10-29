import { esYmdValido, sumarMeses, sumarDias, hoyArgentina, type Ymd } from '../fechas';
import type { Cliente } from '../tipos';
import { finActual, planServicio, type PlanAccion } from './plan';
import type { CuerpoAccion, CambioPlan } from './tipos';
export const CONCEPTOS_PAGO = ['Fee', '1ra Cuota', '2da Cuota', '3ra Cuota', '4ta Cuota', 'PIF', 'Renovación'] as const;
export const estaArchivado = (c: Pick<Cliente, 'estado' | 'anotaciones'>) => {
    const marcas = [...c.anotaciones.matchAll(/\[\[(ARCHIVADO|RESTAURADO):/g)];
    return c.estado === 'FINALIZADO' && marcas.at(-1)?.[1] === 'ARCHIVADO';
};
export function estadoAntesDeArchivo(c: Pick<Cliente, 'anotaciones'>): Cliente['estado'] {
    const marcas = [...c.anotaciones.matchAll(/\[\[ARCHIVADO:[^\]]*estado=(ACTIVO|PAUSADO|FINALIZADO|INACTIVO)/g)];
    return (marcas.at(-1)?.[1] ?? 'ACTIVO') as Cliente['estado'];
}
export function bajaAntesDeArchivo(c: Pick<Cliente, 'anotaciones'>): string | null {
    const marcas = [...c.anotaciones.matchAll(/\[\[ARCHIVADO:[^\]]*baja=([0-9-]+|vacia)/g)];
    const fecha = marcas.at(-1)?.[1];
    return fecha && esYmdValido(fecha) ? fecha : null;
}
export interface PlanExtra extends PlanAccion {
    valores?: {
        campo: string;
        valor: string | number | null;
    }[];
    renovacion?: {
        desde: Ymd;
        hasta: Ymd;
        precio: number;
        meses: number;
        notas: string;
        periodo: number;
    };
    pago?: Extract<CuerpoAccion, {
        tipo: 'pago';
    }>;
}
export function planExtra(c: Cliente, b: CuerpoAccion, id: string, hoy = hoyArgentina(), conFinanzas = false): PlanExtra | string {
    const hoja = `${c.linea === 'agencia' ? 'Agencia' : 'Consultora'} · fila ${c.fila}`;
    const valores: NonNullable<PlanExtra['valores']> = [];
    const plan: CambioPlan[] = [];
    const poner = (campo: string, valor: string | number | null, antes: string | number | null) => { valores.push({ campo, valor }); plan.push({
        hoja, celda: campo, antes: String(antes ?? ''), despues: String(valor ?? '')
    }); };
    switch (b.tipo) {
        case 'pago':
            if (!conFinanzas)
                return 'Agregar pagos requiere permiso de Finanzas.';
            if (!esYmdValido(b.fecha) || b.fecha > hoy)
                return 'La fecha del pago debe ser válida y no futura.';
            if (!Number.isFinite(b.usd) || b.usd <= 0 || b.usd > 1000000 || b.ars !== undefined && (!Number.isFinite(b.ars) || b.ars < 0))
                return 'El monto del pago no es válido.';
            if (!CONCEPTOS_PAGO.includes(b.concepto) || !['Tomi', 'Gero', 'Empresa'].includes(b.cuenta))
                return 'Concepto o cuenta de pago inválidos.';
            if (b.comprobanteDriveId && !/^[\w-]{20,100}$/.test(b.comprobanteDriveId))
                return 'ID de comprobante inválido.';
            return { pago: b, resumen: `Registrar ${b.concepto}: USD ${b.usd} (${b.cuenta})`, plan: [{
                        hoja: 'Finanzas · Registro de Pagos', celda: 'Fecha / Cliente / Concepto / USD / Cuenta', antes: '', despues: `${b.fecha} · ${c.id} · ${b.concepto} · ${b.usd} · ${b.cuenta}`
                    }] };
        case 'archivar':
            if (!c.estado)
                return 'El cliente no tiene un estado válido para archivar.';
            if (estaArchivado(c))
                return 'El cliente ya está archivado.';
            if (b.confirmado !== true || b.confirmacion.trim() !== c.nombre.trim())
                return 'Confirmá primero la baja y escribí el nombre exacto del cliente.';
            if (!b.motivo.trim() || b.motivo.length > 300)
                return 'Indicá un motivo de archivo (máximo 300 caracteres).';
            poner('estado', 'FINALIZADO', c.estado);
            poner('fechaBaja', c.fechaBaja ?? hoy, c.fechaBaja);
            poner('anotaciones', `${c.anotaciones ? `${c.anotaciones}\n` : ''}[[ARCHIVADO:${id} estado=${c.estado} baja=${c.fechaBaja ?? 'vacia'}]] ${hoy} · ${b.motivo.trim()}`, c.anotaciones);
            return { valores, plan, resumen: 'Archivar cliente (reversible; conserva historial y documentos)' };
        case 'restaurar':
            if (!estaArchivado(c))
                return 'El cliente no tiene un archivo del Despacho para restaurar.';
            poner('estado', estadoAntesDeArchivo(c), c.estado);
            poner('fechaBaja', bajaAntesDeArchivo(c), c.fechaBaja);
            poner('anotaciones', `${c.anotaciones}\n[[RESTAURADO:${id}]] ${hoy}${b.motivo ? ` · ${b.motivo.trim()}` : ''}`, c.anotaciones);
            return { valores, plan, resumen: 'Restaurar cliente archivado' };
        case 'renovacion': {
            if (!esYmdValido(b.inicio) || !Number.isInteger(b.meses) || b.meses < 1 || b.meses > 24 || !Number.isFinite(b.precio) || b.precio <= 0 || b.precio > 1000000)
                return 'La renovación requiere inicio válido, 1 a 24 meses y un precio positivo.';
            const fin = finActual(c);
            if (fin && b.inicio < fin)
                return `La renovación no puede superponerse con el período vigente (hasta ${fin}).`;
            const hasta = sumarMeses(b.inicio, b.meses);
            return { resumen: `Renovar ${b.meses} meses hasta ${hasta}`, plan: [{
                        hoja: 'Renovaciones · fila nueva', celda: 'Inicio / Finalización / Precio', antes: '', despues: `${b.inicio} / ${hasta} / USD ${b.precio}`
                    }], renovacion: {
                    desde: b.inicio, hasta, precio: b.precio, meses: b.meses, periodo: Math.max(0, ...c.periodos.map(p => p.periodo)) + 1, notas: `Renovación ${b.meses} meses · acción ${id}`
                } };
        }
        case 'proyeccion':
            if (!['link_enviado', 'agendada', 'hecha'].includes(b.estado))
                return 'Estado de proyección inválido.';
            if (b.fecha && !esYmdValido(b.fecha))
                return 'La fecha de proyección no es válida.';
            if (b.estado !== 'link_enviado' && !b.fecha)
                return 'Indicá la fecha de la llamada.';
            poner('llamadaAgendada', `${b.estado === 'hecha' ? 'Hecha' : b.estado === 'agendada' ? 'Agendada' : 'Link enviado'} (${b.fecha ?? hoy})`, c.llamadaAgendada);
            poner('anotaciones', `${c.anotaciones ? `${c.anotaciones}\n` : ''}[[PROYECCION:${b.estado}:${b.fecha ?? hoy}]] · acción ${id}`, c.anotaciones);
            return { valores, plan, resumen: `Proyección: ${b.estado.replace('_', ' ')}` };
        default: return 'Acción no disponible en este plan.';
    }
}
/** Devuelve evidencia conservadora: si hay una extensión compatible sin motivo, pide revisión antes de duplicar. */
export function evidenciaBeneficioReferido(c: Cliente): {
    estado: 'incluido' | 'ambiguo' | 'falta';
    evidencia: string;
} {
    const porNota = c.periodos.find(p => p.precio === 0 && /referid|beneficio.*mes|mes.*beneficio/i.test(p.notas));
    if (porNota)
        return { estado: 'incluido', evidencia: `Renovaciones, fila ${porNota.fila}: ${porNota.notas}` };
    const compatible = c.periodos.find(p => p.precio === 0 && p.dia1 && p.fin && sumarMeses(p.dia1, 1) === p.fin);
    if (compatible)
        return { estado: 'ambiguo', evidencia: `Ya hay una extensión de un mes sin motivo de referido explícito (fila ${compatible.fila}); confirmar antes de sumar otro.` };
    const inicialLargo = c.periodos.find(p => p.periodo === 0 && p.dia1 && p.fin && p.fin >= sumarMeses(sumarDias(p.dia1, 120), 1));
    if (inicialLargo)
        return { estado: 'ambiguo', evidencia: `El período inicial ya incluye al menos un mes sobre 120 días (fila ${inicialLargo.fila}); confirmar si corresponde al beneficio antes de duplicarlo.` };
    return { estado: 'falta', evidencia: 'No se encontró una extensión de un mes por referido.' };
}
export function planBeneficioReferido(c: Cliente, id: string): PlanAccion | string {
    const e = evidenciaBeneficioReferido(c);
    if (e.estado !== 'falta')
        return `${e.estado}: ${e.evidencia}`;
    return planServicio(c, { tipo: 'servicio', duracion: '1m', motivo: 'beneficio por ingresar como referido cerrado' }, id);
}
