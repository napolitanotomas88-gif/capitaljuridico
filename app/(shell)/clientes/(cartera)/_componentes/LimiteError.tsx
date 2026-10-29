'use client'

import { Component, type ReactNode } from 'react'

// Límite de errores de la tarjeta abierta (revisión del Hub, 26/10/2026): si algo de la tarjeta de un cliente falla al
// dibujarse (por ejemplo una ficha de kickoff con una forma inesperada), se ve un aviso adentro del panel en vez de que se
// caiga toda la cartera hasta la página de error del shell.
export class LimiteError extends Component<{ children: ReactNode; titulo?: string }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(e: unknown) { console.error('[cartera] la tarjeta no se pudo dibujar:', String((e as Error)?.message ?? e).slice(0, 200)) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="cj-aviso" role="alert">
        <p>{this.props.titulo ?? 'No se pudo mostrar esta tarjeta.'} Cerrala y probá de nuevo; si sigue, avisá con el nombre del cliente.</p>
      </div>
    )
  }
}
