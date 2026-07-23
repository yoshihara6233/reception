import { notFound } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { EdgeNewForm } from './edge-new-form'

export default async function NewEdgePage() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) notFound()
  const supa = guard.supa

  // List stores that don't yet have an edge (one edge per store policy).
  const { data } = await supa
    .from('stores')
    .select('id, name, area_code, edge_devices ( id )')
    .order('name')
    .limit(2_000)

  const candidates = (data ?? [])
    .filter((s) => (s as never as { edge_devices: unknown[] }).edge_devices.length === 0)
    .map((s) => ({
      id:        (s as never as { id: string }).id,
      name:      (s as never as { name: string }).name,
      area_code: (s as never as { area_code: string | null }).area_code,
    }))

  return (
    <AdminShell pathname="/admin/edges" section="admin">
      <PageHeader
        title="エッジサーバ 新規登録"
        crumb={[
          { href: '/admin',         label: 'マスタ' },
          { href: '/admin/edges',   label: 'エッジ' },
          { href: '/admin/edges/new', label: '新規登録' },
        ]}
      />
      <div className="max-w-2xl px-5 py-5">
        <EdgeNewForm storeCandidates={candidates} />
      </div>
    </AdminShell>
  )
}
