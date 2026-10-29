import type { Metadata } from 'next'
import ShellLayout from './(shell)/layout'
import ResumenDashboard from '@/components/ResumenDashboard'
import { METADATA_APP, VIEWPORT_APP } from '@/components/shell/pwa'
import { exigirAcceso } from '@/lib/auth/sesion'

export const metadata: Metadata = { title: 'Resumen · Despacho', robots: { index: false, follow: false }, ...METADATA_APP }
export const viewport = VIEWPORT_APP

export default async function ResumenPage() {
  await exigirAcceso('resumen')
  return <ShellLayout><ResumenDashboard /></ShellLayout>
}
