// Adaptador de escritura: planes congelados y lotes atómicos; nunca usa append ni reintenta una inserción financiera a ciegas.
import { googleJson, sheetsBase } from '@/lib/auth/googleRest';
import { columnasDeClientes, columnasDeRenovaciones, parsearHojas } from '../parsear';
import { derivarClientes } from '../clasificar';
import { hoyArgentina, ymdASerial, fechaDeCelda } from '../fechas';
import { letraColumna } from '../texto';
import type { Cliente, Fila, Celda } from '../tipos';
import type { CeldaAccion, ResultadoEscritura, CuerpoPago } from './tipos';
import { finActual, type PlanAccion } from './plan';
import type { PlanExtra } from './planesNuevos';
import { CAMPOS, type PlanDatos } from './campos';
import { invalidarCobrosFinanzas, normalizarNombreCobro, telefonoCobro, identidadesDeHojasCobros, type IdentidadCobro } from '../cobrosFinanzas';
export interface LecturaAcciones {
    cliente: Cliente;
    agencia: Fila[];
    consultora?: Fila[];
    renovaciones: Fila[];
    ids: Record<string, number>;
}
export interface PlanillaAcciones {
    leer(rangos: string[], render?: 'FORMULA' | 'UNFORMATTED_VALUE'): Promise<Fila[][]>;
    ids(): Promise<Record<string, number>>;
    escribir(celdas: CeldaAccion[], ids: Record<string, number>, reversa?: boolean): Promise<void>;
}
const normal = (v: Celda | undefined): Celda => v === undefined || v === null ? '' : v;
export const mismoValor = (a: Celda | undefined, b: Celda | undefined) => normal(a) === normal(b);
const baseCrm = () => `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(process.env.SHEET_ID_CLIENTES?.trim() ?? '')}`;
export function planillaAccionesReal(): PlanillaAcciones {
    if (!process.env.SHEET_ID_CLIENTES)
        throw new Error('Falta SHEET_ID_CLIENTES');
    return {
        async leer(rangos, render = 'FORMULA') {
            const q = rangos.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
            const r = await googleJson<{
                valueRanges?: {
                    values?: Fila[];
                }[];
            }>(`${baseCrm()}/values:batchGet?${q}&valueRenderOption=${render}`);
            return rangos.map((_, i) => r.valueRanges?.[i]?.values ?? []);
        },
        async ids() {
            const r = await googleJson<{
                sheets?: {
                    properties?: {
                        title?: string;
                        sheetId?: number;
                    };
                }[];
            }>(`${baseCrm()}?fields=sheets.properties(title,sheetId)`);
            return Object.fromEntries((r.sheets ?? []).filter(s => s.properties?.title && s.properties.sheetId !== undefined).map(s => [s.properties!.title!, s.properties!.sheetId!]));
        },
        async escribir(celdas, ids, reversa = false) {
            const requests = celdas.map(c => {
                const m = /^'([^']+)'!([A-Z]+)(\d+)$/.exec(c.range);
                if (!m || ids[m[1]] === undefined)
                    throw new Error('Rango de escritura no reconocido');
                const col = [...m[2]].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0) - 1;
                const v = reversa ? c.antes : c.despues;
                const valor = v === null || v === '' ? {} : typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : reversa && v.startsWith('=') ? { formulaValue: v } : { stringValue: v };
                return { updateCells: { range: {
                            sheetId: ids[m[1]], startRowIndex: Number(m[3]) - 1, endRowIndex: Number(m[3]), startColumnIndex: col, endColumnIndex: col + 1
                        }, rows: [{ values: [v === null || v === '' ? {} : { userEnteredValue: valor }] }], fields: 'userEnteredValue' } };
            });
            await googleJson(`${baseCrm()}:batchUpdate`, { cuerpo: { requests } });
        },
    };
}
export async function leerClienteFresco(id: string, planilla = planillaAccionesReal()): Promise<LecturaAcciones> {
    const rangos = ["'Agencia'!A1:AF2000", "'Consultora'!A1:AF2000", "'Renovaciones'!A1:L5000"];
    const [hojas, calculadas, ids] = await Promise.all([planilla.leer(rangos), planilla.leer(rangos, 'UNFORMATTED_VALUE'), planilla.ids()]);
    const [agencia, consultora, renovaciones] = hojas;
    const p = parsearHojas({
        agencia: calculadas[0], consultora: calculadas[1], renovaciones: calculadas[2], referidos: null, creditos: null, config: null
    });
    const matches = derivarClientes(p.base, hoyArgentina()).filter(c => c.id.toUpperCase() === id.toUpperCase());
    if (matches.length !== 1)
        throw new Error('El cliente no existe o tiene un ID duplicado en el CRM');
    const c = matches[0];
    return {
        cliente: c, agencia, consultora, renovaciones, ids
    };
}
export function pisoRenovaciones(l: LecturaAcciones): number {
    const idx = columnasDeRenovaciones(l.renovaciones[0]).idx;
    if (idx.id < 0)
        throw new Error('No se encuentra ID Cliente en Renovaciones');
    let ultimo = 1;
    l.renovaciones.forEach((r, i) => {
        if (String(r[idx.id] ?? '').trim())
            ultimo = i + 1;
    });
    return ultimo + 1;
}
export function congelarPlan(l: LecturaAcciones, p: PlanAccion | PlanDatos | PlanExtra, filaRenovacion: number | null): ResultadoEscritura {
    const c = l.cliente;
    const hoja = c.linea === 'agencia' ? 'Agencia' : 'Consultora';
    const filas = c.linea === 'agencia' ? l.agencia : l.consultora;
    if (!filas) throw new Error('No se leyó la hoja actual del cliente');
    const a = columnasDeClientes(hoja, filas[0]), r = columnasDeRenovaciones(l.renovaciones[0]);
    const celdas: CeldaAccion[] = [];
    const poner = (campo: string, valor: Celda) => {
        const col = a.idx[campo as keyof typeof a.idx];
        if (col === undefined || col < 0)
            throw new Error(`Falta la columna ${campo} en ${hoja}`);
        if (a.resumen.duplicadas.includes(campo))
            throw new Error(`La columna ${campo} es ambigua en ${hoja}`);
        const antes = filas[c.fila - 1]?.[col] ?? null;
        if (typeof antes === 'string' && antes.startsWith('='))
            throw new Error(`La columna ${campo} es una fórmula y no se modifica`);
        celdas.push({ range: `'${hoja}'!${letraColumna(col)}${c.fila}`, antes, despues: valor });
    };
    if ('cambios' in p)
        for (const x of p.cambios) {
            const def = CAMPOS[x.campo];
            const v: Celda = def.tipo === 'fecha' ? x.despues ? ymdASerial(x.despues) : null : def.tipo === 'numero' ? x.despues ? Number(x.despues) : null : x.despues;
            poner(x.campo, v);
        }
    if ('valores' in p)
        for (const x of p.valores ?? [])
            poner(x.campo, x.campo === 'fechaBaja' && x.valor ? ymdASerial(String(x.valor)) : x.valor);
    if ('estadoNuevo' in p && p.estadoNuevo)
        poner('estado', p.estadoNuevo);
    if ('nota' in p && p.nota)
        poner('notasRenov', `${c.notasRenov ? `${c.notasRenov} | ` : ''}${p.nota}`);
    const ext = 'extension' in p ? p.extension : null;
    const ren = 'renovacion' in p ? p.renovacion : null;
    if (ext || ren) {
        if (!filaRenovacion || filaRenovacion < 2)
            throw new Error('Falta la reserva durable de Renovaciones');
        const fila = l.renovaciones[filaRenovacion - 1] ?? [];
        if (String(fila[r.idx.id] ?? '').trim())
            throw new Error('La fila reservada de Renovaciones está ocupada: no se pisa');
        const datos: Record<string, Celda> = {
            id: c.id, nombre: c.nombre, periodo: (ext ?? ren)!.periodo, dia1: ymdASerial((ext ?? ren)!.desde), fin: ymdASerial((ext ?? ren)!.hasta), precio: ren?.precio ?? 0, notas: (ext ?? ren)!.notas, meses: (ext ?? ren)!.meses
        };
        for (const [campo, valor] of Object.entries(datos)) {
            const col = r.idx[campo as keyof typeof r.idx];
            if (col === undefined || col < 0) {
                if (campo === 'meses')
                    continue;
                throw new Error(`Falta ${campo} en Renovaciones`);
            }
            const antes = fila[col] ?? null;
            // Finalización puede traer la fórmula plantilla: es una fila nueva reservada sin ID. Se congela para restaurarla al deshacer.
            if (typeof antes === 'string' && antes.startsWith('=') && campo !== 'fin')
                throw new Error('La fila nueva contiene una fórmula inesperada');
            if (antes !== null && antes !== '' && !(typeof antes === 'string' && antes.startsWith('=')))
                throw new Error('La fila nueva contiene datos ajenos: no se pisa');
            celdas.push({ range: `'Renovaciones'!${letraColumna(col)}${filaRenovacion}`, antes, despues: valor });
        }
    }
    return {
        version: 1, celdas, identidad: { range: `'${hoja}'!${letraColumna(a.idx.id)}${c.fila}`, valor: c.id },
        ...('cambios' in p ? { encabezados: p.cambios.map(x => ({ range: `'${hoja}'!${letraColumna(a.idx[x.campo])}1`, valor: String(filas[0][a.idx[x.campo]] ?? '') })) } : {}),
        ...((ext || ren) ? { finBase: finActual(c) ?? undefined, finRango: a.idx.finPeriodo >= 0 ? `'${hoja}'!${letraColumna(a.idx.finPeriodo)}${c.fila}` : undefined } : {}), ...('pago' in p && p.pago ? { pago: p.pago } : {})
    };
}
export async function estadoPlan(planilla: PlanillaAcciones, p: ResultadoEscritura): Promise<'antes' | 'despues' | 'conflicto'> {
    const r = await planilla.leer([p.identidad.range, ...p.celdas.map(c => c.range), ...(p.encabezados ?? []).map(c => c.range)]);
    if (String(r[0]?.[0]?.[0] ?? '').toUpperCase() !== p.identidad.valor.toUpperCase())
        return 'conflicto';
    if ((p.encabezados ?? []).some((h, i) => String(r[1 + p.celdas.length + i]?.[0]?.[0] ?? '') !== h.valor))
        return 'conflicto';
    const valores = p.celdas.map((_, i) => r[i + 1]?.[0]?.[0]);
    if (p.celdas.every((c, i) => mismoValor(valores[i], c.despues)))
        return 'despues';
    if (p.celdas.every((c, i) => mismoValor(valores[i], c.antes))) {
        if (p.finBase) {
            const [ren] = await planilla.leer(["'Renovaciones'!A1:L5000"], 'UNFORMATTED_VALUE');
            const fines = parsearHojas({
                agencia: [], consultora: [], renovaciones: ren, referidos: null, creditos: null, config: null
            }).periodos.filter(x => x.idCliente.toUpperCase() === p.identidad.valor.toUpperCase()).map(x => x.fin).filter((x): x is string => !!x).sort();
            let fin = fines.at(-1);
            if (!fin && p.finRango) {
                const [celda] = await planilla.leer([p.finRango], 'UNFORMATTED_VALUE');
                fin = fechaDeCelda(celda[0]?.[0]) ?? undefined;
            }
            if (fin !== p.finBase)
                return 'conflicto';
        }
        return 'antes';
    }
    return 'conflicto';
}
export async function aplicarPlan(planilla: PlanillaAcciones, p: ResultadoEscritura, ids: Record<string, number>, reversa = false): Promise<void> {
    const estado = await estadoPlan(planilla, p);
    const origen = reversa ? 'despues' : 'antes', destino = reversa ? 'antes' : 'despues';
    if (estado === destino)
        return;
    if (estado !== origen)
        throw Object.assign(new Error('Los datos cambiaron desde la reserva; no se pisa la edición ajena'), { sinEscritura: true });
    await planilla.escribir(p.celdas, ids, reversa);
    if (await estadoPlan(planilla, p) !== destino)
        throw new Error('La escritura no pudo confirmarse; conservar el mismo intento y revisar antes de reintentar');
}
export const normalizarNombre = normalizarNombreCobro;
export function filasFinanzasDelCliente(c: Pick<Cliente, 'id' | 'nombre' | 'celular'>, filas: Fila[], identidades: IdentidadCobro[]): Fila[] {
    const id = c.id.toUpperCase(), propias = identidades.filter(x => x.id.toUpperCase() === id);
    const rechazar = (): never => { throw Object.assign(new Error('La identidad financiera del cliente es ambigua; no se infieren ni cargan datos hasta revisar nombre y teléfono en el CRM.'), { sinEscritura: true }); };
    if (propias.length !== 1) rechazar();
    const actual = propias[0], nombre = normalizarNombre(actual.nombre), tel = telefonoCobro(actual.celular);
    const compatibles = (n: string, t: string) => identidades.filter(x => !!n && normalizarNombre(x.nombre) === n || !!t && telefonoCobro(x.celular) === t);
    if (!nombre && !tel || compatibles(nombre, tel).length !== 1) rechazar();
    return filas.slice(1).filter(f => {
        const n = normalizarNombre(f[2]), t = telefonoCobro(f[3]);
        if (!(nombre && n === nombre || tel && t === tel)) return false;
        const candidatos = compatibles(n, t);
        if (candidatos.length !== 1 || candidatos[0].id.toUpperCase() !== id) rechazar();
        return true;
    });
}
export function clasificacionPago(p: Pick<CuerpoPago, 'concepto' | 'tipoVenta'>, programa: string, historial: Fila[]): { tipoVenta: 'Front-end' | 'Back-end'; tipoPago: 'Upfront' | 'Payment Plan' } {
    const error = (mensaje: string): never => { throw Object.assign(new Error(mensaje), { sinEscritura: true }); };
    if (p.tipoVenta !== undefined && !['Front-end', 'Back-end'].includes(p.tipoVenta)) error('Confirmá un tipo de venta válido.');
    if (p.concepto === 'Renovación' && p.tipoVenta !== 'Back-end') error('Una renovación requiere confirmar explícitamente Back-end como tipo de venta.');
    const anteriores = [...new Set(historial.map(f => String(f[13] ?? '').trim()).filter(Boolean))];
    const tipoVenta = p.tipoVenta ?? (anteriores.length === 1 && ['Front-end', 'Back-end'].includes(anteriores[0]) ? anteriores[0] as 'Front-end' | 'Back-end' : undefined);
    if (!tipoVenta) error('Confirmá el tipo de venta: no hay un historial único para inferir Front-end o Back-end.');
    const modalidad = programa.split('|').map(x => x.trim().toUpperCase());
    const pif = modalidad.includes('PIF'), pp = modalidad.includes('PP');
    if (pif === pp) error('El programa debe indicar una modalidad única PIF o PP para verificar el tipo de pago.');
    return { tipoVenta: tipoVenta!, tipoPago: pif ? 'Upfront' : 'Payment Plan' };
}
export async function prepararPago(c: Cliente, p: CuerpoPago, lectura?: LecturaAcciones) {
    const { planillaFinanzasReal, buscarRepetido, armarCarga, lecturaDesde } = await import('@/lib/bot/alta/finanzasEscribir');
    const { COLUMNAS_REGISTRO, serialPlanilla, formulaMes, OPCIONES_PROGRAMA, OPCIONES_FUENTE } = await import('@/lib/bot/alta/finanzas');
    const planilla = planillaFinanzasReal('real');
    const [[filas], estructura] = await Promise.all([planilla.leer(["'Registro de Pagos'!A1:R5000"], 'UNFORMATTED_VALUE'), planilla.estructura(2)]);
    const crm = lectura ?? await leerClienteFresco(c.id);
    const ultimas = filasFinanzasDelCliente(c, filas, identidadesDeHojasCobros(crm.agencia, crm.consultora ?? []));
    const inferir = (n: number): string | null => { const vals = [...new Set(ultimas.map(f => String(f[n] ?? '').trim()).filter(Boolean))]; return vals.length === 1 ? vals[0] : null; };
    const programa = p.programa?.trim() || inferir(1), fuente = p.fuente?.trim() || inferir(10);
    if (!programa || !OPCIONES_PROGRAMA.includes(programa as typeof OPCIONES_PROGRAMA[number]))
        throw new Error('Confirmá el programa del pago; no se puede inferir de forma única');
    if (!fuente || !OPCIONES_FUENTE.includes(fuente as typeof OPCIONES_FUENTE[number]))
        throw new Error('Confirmá la fuente del pago; no se puede inferir de forma única');
    const { tipoVenta, tipoPago } = clasificacionPago(p, programa, ultimas);
    const celdas = Object.fromEntries(COLUMNAS_REGISTRO.map(x => [x.col, null])) as import('@/lib/bot/alta/finanzas').FilaRegistroPagos['celdas'];
    Object.assign(celdas, {
        A: serialPlanilla(p.fecha), B: programa, C: c.nombre, D: c.celular, E: p.usd, F: p.ars ?? null, G: c.closer, H: p.setter?.trim() || inferir(7) || null, I: p.comprobanteDriveId ? `https://drive.google.com/file/d/${p.comprobanteDriveId}/view` : '', J: p.concepto, K: fuente, M: formulaMes(), N: tipoVenta, O: tipoPago, R: p.cuenta
    });
    const fila = {
        celdas, fila: COLUMNAS_REGISTRO.map(x => celdas[x.col]), fechaTexto: p.fecha, fechaLegible: p.fecha.split('-').reverse().join('/'), pendientes: [], avisos: []
    };
    const duplicado = buscarRepetido(filas.slice(1), celdas);
    // El escritor puede sumar estos conceptos conocidos a J al confirmar. En revisión sólo simula esa ampliación;
    // los encabezados y todas las demás validaciones se controlan antes de reservar la operación.
    const validaciones = estructura.validaciones.map((regla, i) => i === 9 && regla?.lista ? { ...regla, lista: [...new Set([...regla.lista, '3ra Cuota', '4ta Cuota', 'Renovación'])] } : regla);
    const revision = armarCarga(fila, lecturaDesde([filas], { ...estructura, validaciones }));
    if (!revision.ok && duplicado === null)
        throw Object.assign(new Error(`Finanzas necesita revisión: ${revision.errores.join(' ')}`), { sinEscritura: true });
    return { fila, duplicado };
}
function baseFinanzas(): string {
    if (!process.env.SHEET_ID_FINANZAS)
        throw new Error('Falta SHEET_ID_FINANZAS');
    return `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(process.env.SHEET_ID_FINANZAS)}`;
}
export function coincideFilaPagoMarcada(leida: Fila, fila: import('@/lib/bot/alta/finanzas').FilaRegistroPagos, literal: typeof import('@/lib/bot/alta/finanzasEscribir').textoLiteral): boolean {
    const campos: [number, keyof typeof fila.celdas][] = [[0, 'A'], [1, 'B'], [2, 'C'], [3, 'D'], [4, 'E'], [7, 'H'], [9, 'J'], [10, 'K'], [13, 'N'], [14, 'O'], [17, 'R']];
    return campos.every(([i, k]) => mismoValor(leida[i], literal(fila.celdas[k])));
}
export async function pagoYaEscrito(accionId: string, fila?: import('@/lib/bot/alta/finanzas').FilaRegistroPagos): Promise<boolean> {
    const r = await googleJson<{
        matchedDeveloperMetadata?: {
            developerMetadata?: {
                location?: {
                    dimensionRange?: {
                        startIndex?: number;
                    };
                };
            };
        }[];
    }>(`${baseFinanzas()}/developerMetadata:search`, { cuerpo: { dataFilters: [{ developerMetadataLookup: { metadataKey: 'cj_cliente_accion', metadataValue: accionId, visibility: 'DOCUMENT' } }] } });
    const matches = r.matchedDeveloperMetadata ?? [];
    if (!matches.length)
        return false;
    if (matches.length !== 1)
        throw new Error('El pago tiene más de una marca de acción: revisar antes de continuar');
    if (!fila)
        return true;
    const indice = matches[0].developerMetadata?.location?.dimensionRange?.startIndex;
    if (indice === undefined)
        throw new Error('La marca del pago no tiene una fila identificable');
    const rango = encodeURIComponent(`'Registro de Pagos'!A${indice + 1}:R${indice + 1}`);
    const row = await googleJson<{
        values?: Fila[];
    }>(`${baseFinanzas()}/values/${rango}?valueRenderOption=UNFORMATTED_VALUE`);
    const leida = row.values?.[0] ?? [];
    const { textoLiteral } = await import('@/lib/bot/alta/finanzasEscribir');
    if (!coincideFilaPagoMarcada(leida, fila, textoLiteral))
        throw new Error('La fila financiera marcada cambió; no se vuelve a insertar el pago');
    return true;
}
export async function escribirPago(accionId: string, fila: import('@/lib/bot/alta/finanzas').FilaRegistroPagos): Promise<void> {
    if (await pagoYaEscrito(accionId, fila)) {
        invalidarCobrosFinanzas();
        return;
    }
    const { cargarPagoFinanzas, planillaFinanzasReal } = await import('@/lib/bot/alta/finanzasEscribir');
    const planilla = planillaFinanzasReal('real'), estructura = await planilla.estructura(2);
    const regla = estructura.validaciones[9];
    if (regla?.lista && !regla.lista.includes(String(fila.celdas.J))) {
        const conceptos = [...new Set([...regla.lista, '3ra Cuota', '4ta Cuota', 'Renovación'])];
        if (!conceptos.includes(String(fila.celdas.J)))
            throw new Error('El concepto no está permitido en Finanzas');
        await planilla.batchUpdate([{ setDataValidation: { range: {
                        sheetId: estructura.sheetId, startRowIndex: 1, endRowIndex: estructura.filasHoja, startColumnIndex: 9, endColumnIndex: 10
                    }, rule: { condition: { type: 'ONE_OF_LIST', values: conceptos.map(x => ({ userEnteredValue: x })) }, strict: regla.strict, showCustomUi: true } } }]);
    }
    const adapter = { ...planilla, batchUpdate: async (requests: object[]) => planilla.batchUpdate([...requests, { createDeveloperMetadata: { developerMetadata: {
                        metadataKey: 'cj_cliente_accion', metadataValue: accionId, visibility: 'DOCUMENT', location: { dimensionRange: {
                                sheetId: estructura.sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2
                            } }
                    } } }]) };
    const r = await cargarPagoFinanzas(fila, null, { modo: 'real', deps: { planilla: () => adapter } });
    if (!r.ok || !r.verificacion?.ok || !await pagoYaEscrito(accionId, fila))
        throw Object.assign(new Error(r.motivo || 'No se pudo confirmar el pago en Finanzas; no repetir con otra clave'), { sinEscritura: !r.escribio });
    invalidarCobrosFinanzas();
}
export async function metadatosPago(c: Cliente, lectura?: LecturaAcciones) {
    const { planillaFinanzasReal } = await import('@/lib/bot/alta/finanzasEscribir');
    const { OPCIONES_PROGRAMA, OPCIONES_FUENTE, OPCIONES_SETTER, OPCIONES_CUENTA } = await import('@/lib/bot/alta/finanzas');
    const { CONCEPTOS_PAGO } = await import('./planesNuevos');
    const [filas] = await planillaFinanzasReal('real').leer(["'Registro de Pagos'!A1:R5000"], 'UNFORMATTED_VALUE');
    const crm = lectura ?? await leerClienteFresco(c.id);
    const propias = filasFinanzasDelCliente(c, filas, identidadesDeHojasCobros(crm.agencia, crm.consultora ?? []));
    const unico = (i: number) => { const xs = [...new Set(propias.map(f => String(f[i] ?? '').trim()).filter(Boolean))]; return xs.length === 1 ? xs[0] : ''; };
    return {
        programa: unico(1), fuente: unico(10), setter: unico(7), tipoVenta: ['Front-end', 'Back-end'].includes(unico(13)) ? unico(13) : '', tiposVenta: ['Front-end', 'Back-end'], programas: OPCIONES_PROGRAMA, fuentes: OPCIONES_FUENTE, setters: OPCIONES_SETTER, conceptos: CONCEPTOS_PAGO, cuentas: OPCIONES_CUENTA, requiereConfirmacion: true
    };
}
