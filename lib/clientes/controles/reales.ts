// ── Controles de cumplimiento: las dependencias reales (Neon, Meta, Drive, Discord). Solo servidor ────────────────────────
// Meta: el mismo cliente de Graph del tablero de anuncios (lib/anuncios/meta.ts, tokens META_ANUNCIOS_TOKEN /
// META_CLIENTES_TOKEN con respaldo). Moneda: ARS al dólar MEP (venta; si falta, oficial), como el tablero; otras monedas,
// con la cotización del día. Drive: lectura con la cuenta de servicio (drive.readonly) y la carpeta «Capturas» se crea con
// el Puente Drive (crearCarpeta devuelve la existente si ya está: no se duplica).
import { alertar } from '@/lib/alertas'
import { googleConfigurado, googleJson } from '@/lib/auth/googleRest'
import { listarHijosDriveReal } from '@/lib/bot/alta/driveCliente'
import { puenteDriveReal } from '@/lib/bot/alta/puenteDrive'
import { dolarHoy, monedasPorUSD } from '@/lib/anuncios/dolar'
import { leerCuentas, leerInsightsRango } from '@/lib/anuncios/meta'
import { pausasVigentes } from '@/lib/anuncios/pausas'
import { ESTADOS_ERROR_PAGO, textoEstadoCuenta } from '@/lib/anuncios/reglas'
import * as db from './db'
import { esIdDrive, ymdAR, type ConfigControles } from './reglas'
import { NOMBRE_CARPETA_CAPTURAS, type DepsControles } from './servidor'

const SCOPE_LECTURA = 'https://www.googleapis.com/auth/drive.readonly'
const MIME_CARPETA = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3/files'

type ArchivoApi = { id: string; mimeType: string; createdTime?: string }
async function listar(q: string): Promise<ArchivoApi[]> {
  const out: ArchivoApi[] = []
  let token = ''
  do {
    const r = await googleJson<{ files?: ArchivoApi[]; nextPageToken?: string }>(
      `${API}?q=${encodeURIComponent(q)}&pageSize=1000&fields=nextPageToken,files(id,mimeType,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
      { scopes: SCOPE_LECTURA },
    )
    out.push(...(r.files ?? []))
    token = r.nextPageToken ?? ''
  } while (token && out.length < 5_000)
  return out
}

/** Archivos (no carpetas) creados desde `desdeIso` en la carpeta y en sus subcarpetas directas (p. ej., una por día). */
export async function archivosDesde(carpeta: string, desdeIso: string): Promise<{ creado: string }[] | null> {
  if (!googleConfigurado() || !esIdDrive(carpeta)) return null
  const desde = new Date(desdeIso).toISOString().replace(/\.\d{3}Z$/, 'Z')
  try {
    const sub = (await listar(`'${carpeta}' in parents and mimeType = '${MIME_CARPETA}' and trashed = false`)).map((f) => f.id).slice(0, 60)
    const out: { creado: string }[] = []
    for (const id of [carpeta, ...sub]) {
      for (const f of await listar(`'${id}' in parents and createdTime > '${desde}' and trashed = false`)) {
        if (f.mimeType !== MIME_CARPETA && f.createdTime) out.push({ creado: f.createdTime })
      }
    }
    return out
  } catch { return null }
}

/** La carpeta «Capturas» del cliente: la configurada, la que ya existe adentro de la del cliente o una nueva (si `crear`). */
export async function carpetaCapturasReal(c: ConfigControles, crear: boolean): Promise<string | null> {
  if (c.carpetaCapturas) return c.carpetaCapturas
  const padre = c.carpetaCliente ?? (await db.carpetaClienteVinculada(c.idCrm))
  if (!padre || !esIdDrive(padre)) return null
  const hijos = await listarHijosDriveReal(padre).catch(() => null)
  const ya = hijos?.find((h) => h.mimeType === MIME_CARPETA && h.name.trim().toLowerCase() === NOMBRE_CARPETA_CAPTURAS.toLowerCase())
  let id = ya?.id ?? null
  if (!id && crear) id = (await puenteDriveReal().crearCarpeta({ padreId: padre, nombre: NOMBRE_CARPETA_CAPTURAS })).id
  if (id && crear) await db.guardarCarpetaCapturas(c.idCrm, id).catch(() => undefined)
  return id
}

export function depsReales(): DepsControles {
  const hoy = () => ymdAR(new Date())
  return {
    ahora: () => new Date(),
    configs: () => db.leerConfigs(hoy()),
    pausado: async (idCrm) => (await pausasVigentes([idCrm])).has(idCrm.toUpperCase()),
    async cuenta(id) {
      const r = await leerCuentas([id])
      const c = r.cuentas[id]
      if (!c) return null
      return { estado: c.estado, motivoBaja: c.motivoBaja, entrega: c.entrega ?? null, medioPago: !!c.medioPago?.id, moneda: c.moneda, textoEstado: textoEstadoCuenta(c.estado, c.motivoBaja) }
    },
    async gastos(id, desde, hasta) {
      const r = await leerInsightsRango([id], desde, hasta)
      const dias = r.porCuenta[id]
      if (!dias) return null
      return Object.fromEntries(dias.map((x) => [x.d, x.g]))
    },
    async usdPor(moneda) {
      if (moneda === 'USD') return 1
      if (moneda === 'ARS') { const d = await dolarHoy(); return d.bolsa?.venta ?? d.oficial?.venta ?? null }
      return (await monedasPorUSD())[moneda] ?? null
    },
    erroresPago: ESTADOS_ERROR_PAGO,
    tandas: (idCrm) => db.tandasConEnvio(idCrm),
    crudos: (idCrm, desdeIso) => db.crudosDesde(idCrm, desdeIso),
    carpetaCapturas: carpetaCapturasReal,
    archivos: archivosDesde,
    registrar: db.registrarIncumplimiento,
    anotarAlerta: db.anotarAlerta,
    incumplimientos: async (idCrm, desde, hasta) => (await db.incumplimientosEntre(idCrm, desde, hasta)).map((i) => ({ tipo: i.tipo, fecha: i.fecha, estado: i.estado })),
    alertar,
  }
}
