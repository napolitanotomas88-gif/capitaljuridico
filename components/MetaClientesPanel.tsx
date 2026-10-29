'use client'

import { useState } from 'react'
import { nombreDePila, telefonoWhatsApp } from './tablero'

// ── Panel grande: cuentas publicitarias de los clientes (Meta) ─────────
// Nombres grandes y filtros rápidos: errores de pago (incluye las que están
// por cortarse) / deshabilitadas / frenadas / en pausa / corriendo.
// Fuente: Business Managers de clientes visibles con META_CLIENTES_TOKEN
// (business_management), cruzado con el CRM de Agencia (pausa, teléfono).
// Los clientes FINALIZADOS o INACTIVOS del CRM ya vienen excluidos del server.

export interface MetaCuenta {
  nombre: string
  estado: 'activa' | 'error_pago' | 'deshabilitada' | 'cerrada'
  diasSinCorrer: number | null
  racha: number
  pausadoCRM?: boolean     // cliente PAUSADO en el CRM (cualquier estado de cuenta) → no es error ni frenada
  enOnboarding?: boolean   // cliente en producción (ClickUp): todavía no lanzó campaña, no es "frenada"
  sinDatos?: boolean
  enGracia?: boolean       // Meta en período de gracia: todavía entrega pero va a cortar por deuda
  sinMedioPago?: boolean   // sin tarjeta / medio de pago cargado
  clienteCRM?: string      // nombre del cliente en el CRM
  sinCliente?: boolean     // no se pudo asociar a un cliente del CRM (falta la col C de "Cuentas Meta")
  telefono?: string        // CRM Agencia col D
  email?: string
}

type Filtro = 'todas' | 'errores' | 'deshabilitadas' | 'frenadas' | 'onboarding' | 'pausa' | 'corriendo' | 'otras'

// Clasificación (la pausa del CRM manda sobre todo lo demás)
const enPausa = (c: MetaCuenta) => !!c.pausadoCRM
const esErrorPago = (c: MetaCuenta) => !c.pausadoCRM && (c.estado === 'error_pago' || !!c.enGracia)
const estaDeshabilitada = (c: MetaCuenta) => !c.pausadoCRM && !c.enGracia && c.estado === 'deshabilitada'
const estaFrenada = (c: MetaCuenta) => !c.pausadoCRM && !c.enGracia && c.estado === 'activa' && !c.sinDatos && !c.enOnboarding && c.diasSinCorrer != null
const estaCorriendo = (c: MetaCuenta) => !c.pausadoCRM && !c.enGracia && c.estado === 'activa' && !c.sinDatos && c.diasSinCorrer === null
// Cliente en producción (ClickUp) que todavía no lanzó campaña: activa, sin gasto, pero no "frenada"
const enOnboarding = (c: MetaCuenta) => !c.pausadoCRM && !c.enGracia && c.estado === 'activa' && !c.sinDatos && !!c.enOnboarding && c.diasSinCorrer != null
// Lo que no entra en ningún filtro (cerradas, sin datos de gasto): así la suma de filtros = Todas
const esOtra = (c: MetaCuenta) => !esErrorPago(c) && !estaDeshabilitada(c) && !estaFrenada(c) && !enOnboarding(c) && !enPausa(c) && !estaCorriendo(c)
// Sin cliente del CRM asociado: la marca viene del server; si todavía no llega, se deduce de clienteCRM
const sinClienteCRM = (c: MetaCuenta) => c.sinCliente ?? !c.clienteCRM

// Orden de la grilla: lo más urgente primero
function rango(c: MetaCuenta): number {
  if (esErrorPago(c)) return 0
  if (estaDeshabilitada(c)) return 1
  if (estaFrenada(c)) return 2
  if (enPausa(c)) return 4
  if (estaCorriendo(c)) return 5
  return 3
}

// Borrador de WhatsApp: abre wa.me con el texto listo para revisar (NO envía nada solo).
// Teléfono normalizado (10 dígitos → 549…, 54 sin el 9 → se inserta); inválido → sin link.
// Nombre de pila (con compuestos tipo "Juan Pablo" / "María Eugenia") en components/tablero.ts
function linkWhatsApp(c: MetaCuenta): string | null {
  const digitos = telefonoWhatsApp(c.telefono)
  if (!digitos) return null
  const nombre = nombreDePila(c.clienteCRM)
  const situacion = c.estado === 'error_pago' && c.diasSinCorrer != null
    ? `están frenados hace ${c.diasSinCorrer >= 90 ? 'más de 90' : c.diasSinCorrer} ${c.diasSinCorrer === 1 ? 'día' : 'días'}`
    : 'pueden cortarse en cualquier momento'
  const texto =
    `Hola${nombre ? ` ${nombre}` : ''}, ¿cómo estás? Te escribimos de Skyward. ` +
    `Meta nos marca un problema con el pago de tu cuenta publicitaria (${c.nombre}) y los anuncios ${situacion}. ` +
    `¿Podés revisar la tarjeta en Meta → Configuración de pagos? Si necesitás, te ayudamos por acá.`
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`
}

const dias = (n: number) => `${n >= 90 ? '90+' : n}d`

export function MetaClientesPanel({ cuentas, disponible }: { cuentas: MetaCuenta[]; disponible: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  if (!disponible) return null

  const errores = cuentas.filter(esErrorPago)
  const deshabilitadas = cuentas.filter(estaDeshabilitada)
  const frenadas = cuentas.filter(estaFrenada)
  const onboarding = cuentas.filter(enOnboarding)
  const pausadas = cuentas.filter(enPausa)
  const corriendo = cuentas.filter(estaCorriendo)
  const otras = cuentas.filter(esOtra)

  const FILTROS: { id: Filtro; label: string; n: number }[] = [
    { id: 'todas', label: 'Todas', n: cuentas.length },
    { id: 'errores', label: 'Errores de pago', n: errores.length },
    { id: 'deshabilitadas', label: 'Deshabilitadas', n: deshabilitadas.length },
    { id: 'frenadas', label: 'Frenadas', n: frenadas.length },
    { id: 'onboarding', label: 'Onboarding', n: onboarding.length },
    { id: 'pausa', label: 'En pausa', n: pausadas.length },
    { id: 'corriendo', label: 'Corriendo', n: corriendo.length },
    // Solo si hay alguna (cerradas / sin datos de gasto)
    ...(otras.length ? [{ id: 'otras' as Filtro, label: 'ℹ️ Otras', n: otras.length }] : []),
  ]
  const base = filtro === 'errores' ? errores
    : filtro === 'deshabilitadas' ? deshabilitadas
    : filtro === 'frenadas' ? frenadas
    : filtro === 'onboarding' ? onboarding
    : filtro === 'pausa' ? pausadas
    : filtro === 'otras' ? otras
    : filtro === 'corriendo' ? corriendo
    : cuentas
  const visibles = base.slice().sort((a, b) =>
    rango(a) - rango(b) || (b.diasSinCorrer ?? 0) - (a.diasSinCorrer ?? 0) || b.racha - a.racha)

  const chip = (c: MetaCuenta): { texto: string; color: string; bg: string } => {
    if (c.pausadoCRM) return { texto: 'CLIENTE EN PAUSA', color: '#fff', bg: '#6b5a43' }
    if (c.enGracia) return { texto: 'POR CORTARSE · deuda en período de gracia', color: '#fff', bg: '#7f202c' }
    if (c.estado === 'error_pago') return {
      texto: c.diasSinCorrer == null
        ? 'ERROR DE PAGO · sigue corriendo'
        : `ERROR DE PAGO · ${dias(c.diasSinCorrer)} sin correr`,
      color: '#fff', bg: '#7f202c' }
    if (c.estado === 'deshabilitada') return { texto: 'DESHABILITADA', color: '#fff', bg: '#5e1720' }
    if (c.estado === 'cerrada') return { texto: 'CERRADA', color: 'var(--text-muted)', bg: 'color-mix(in srgb, var(--border) 60%, transparent)' }
    if (c.sinDatos) return { texto: 'ℹ️ SIN DATOS DE GASTO (revisar acceso)', color: 'var(--text)', bg: 'color-mix(in srgb, var(--border) 60%, transparent)' }
    if (c.enOnboarding && c.diasSinCorrer != null) return { texto: 'EN ONBOARDING · todavía sin campaña', color: 'var(--text)', bg: 'color-mix(in srgb, var(--border) 60%, transparent)' }
    if (c.diasSinCorrer != null) return { texto: `FRENADA · ${dias(c.diasSinCorrer)} sin correr`, color: '#fff', bg: '#805c29' }
    return { texto: `CORRIENDO · ${c.racha}d seguidos`, color: '#fff', bg: '#1f6b52' }
  }

  return (
    <section className="mb-6">
      <div className="glass-board" style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            Cuentas de Meta — clientes
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTROS.map(f => (
              <button key={f.id} onClick={() => setFiltro(f.id)}
                style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: '1.5px solid ' + (filtro === f.id ? 'var(--brand-orange)' : 'var(--border)'),
                  background: filtro === f.id ? 'var(--brand-orange)' : 'transparent',
                  color: filtro === f.id ? 'var(--on-brand)' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}>
                {f.label} · {f.n}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 14 }}>
            {filtro === 'errores' ? 'Ninguna cuenta con error de pago ' : 'Nada para mostrar con este filtro'}
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {visibles.map((c, i) => {
              const ch = chip(c)
              // Aviso por WhatsApp solo para errores de pago / por cortarse de clientes no pausados
              const error = esErrorPago(c)
              const wa = error ? linkWhatsApp(c) : null
              const sinCli = sinClienteCRM(c)
              // Motivo por el que no hay botón de WhatsApp
              const sinWa = sinCli ? 'cuenta sin cliente asociado (cargar col C en Cuentas Meta)'
                : !(c.telefono ?? '').replace(/\D/g, '') ? 'sin teléfono en el CRM (col D de Agencia)'
                : `teléfono inválido en el CRM (col D de Agencia: "${c.telefono}")`
              const mismoNombre = !!c.clienteCRM && c.clienteCRM.trim().toLowerCase() === c.nombre.trim().toLowerCase()
              return (
                <div key={c.nombre + i} className="glass-alert" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderLeft: `3px solid ${ch.bg}` }}>
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{c.nombre}</p>
                    {c.clienteCRM && !mismoNombre && (
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Cliente: {c.clienteCRM}</p>
                    )}
                  </div>
                  <span style={{
                    alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 8,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: '0.02em',
                    color: ch.color, background: ch.bg, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {ch.texto}
                  </span>
                  {c.sinMedioPago && !c.pausadoCRM && c.estado === 'activa' && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#805c29' }}>sin tarjeta cargada en Meta</span>
                  )}
                  {error && (wa ? (
                    <a href={wa} target="_blank" rel="noopener noreferrer"
                      style={{
                        alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 999,
                        fontSize: 12, fontWeight: 700, textDecoration: 'none',
                        color: '#fff', background: '#1f6b52',
                      }}>
                      Avisar por WhatsApp
                    </a>
                  ) : (
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{sinWa}</span>
                  ))}
                  {!error && sinCli && (
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>cuenta sin cliente asociado (cargar col C en Cuentas Meta)</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12 }}>
          Estado de cada cuenta publicitaria según Meta · frenada = activa pero sin gasto · racha = días seguidos corriendo campañas ·
          &quot;Avisar por WhatsApp&quot; abre un borrador para revisar antes de mandar (no envía nada solo)
        </p>
      </div>
    </section>
  )
}
