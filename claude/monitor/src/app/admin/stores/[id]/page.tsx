import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { StoreEditForm } from './store-edit-form'

export default async function StoreEdit(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supa = await createSupabaseServer()
  const { data: store } = await supa
    .from('stores')
    .select('id, name, address, area_code, latitude, longitude, is_active, timezone')
    .eq('id', id)
    .single()
  if (!store) notFound()

  return (
    <AdminShell pathname="/admin/stores" section="admin">
      <PageHeader
        title={`店舗編集: ${(store as { name: string }).name}`}
        crumb={[
          { href: '/admin',         label: 'マスタ' },
          { href: '/admin/stores',  label: '店舗' },
          { href: `/admin/stores/${id}`, label: (store as { name: string }).name },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        {/* F47: NVR 設定への動線 — 管理者専用ページとして分離した */}
        <Link
          href={`/admin/stores/${id}/nvr`}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500 dark:hover:bg-slate-700"
        >
          <span className="flex items-center gap-2">
            <span className="text-base">🛰</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              NVR 設定
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ベンダー・機種・接続情報・ライフサイクル管理
            </span>
          </span>
          <span className="text-slate-400">→</span>
        </Link>

        <StoreEditForm
          id={id}
          initial={store as never as {
            name: string; address: string | null; area_code: string | null;
            latitude: number | null; longitude: number | null; is_active: boolean;
            timezone: string | null;
          }}
        />
      </div>
    </AdminShell>
  )
}
