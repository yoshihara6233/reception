/**
 * /baggage/ipad — iPad設定（QR＋6桁PIN）。手荷物検査店長が自店舗のiPadを自己設定する。
 *
 * 店舗一覧は RLS（有効化店舗のみ可視）。PIN の設定状態は service client で取得
 * （baggage_kiosk_pins はセッション用ポリシー無し＝deny）。QR とPIN設定の実操作は
 * クライアント（IpadSettingsClient）から API 越しに行う。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { TenantGate } from '@/components/TenantGate'
import { resolveMonitorScope } from '@/lib/tenant/monitor-scope'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from '../nav'
import { isLocked } from '@/lib/baggage/kiosk-pin'
import { IpadSettingsClient, type IpadStore } from './IpadSettingsClient'

export default async function BaggageIpadPage() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // テナント分離: 操作中テナントの店舗のみ。未選択はゲート（他テナント漏洩防止）。
  const scope = await resolveMonitorScope(supa)
  if (scope.needsTenant) {
    return (
      <AdminShell pathname="/baggage/ipad" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
        <TenantGate />
      </AdminShell>
    )
  }

  const { data: enabledRows } = await supa
    .from('inspection_settings')
    .select('store_id, stores ( id, name )')
    .eq('enabled', true)
    .in('store_id', scope.storeIds)
  const stores = (enabledRows ?? [])
    .map((r) => {
      const s = Array.isArray(r.stores) ? r.stores[0] : r.stores
      return s ? { id: (s as { id: string }).id, name: (s as { name: string }).name } : null
    })
    .filter(Boolean) as { id: string; name: string }[]

  // PIN 設定状態（service）。可視店舗のみ問い合わせる。
  const now = new Date()
  const statusById = new Map<string, { pinSet: boolean; locked: boolean }>()
  if (stores.length > 0) {
    const svc = createSupabaseService()
    const { data: pins } = await svc
      .from('baggage_kiosk_pins')
      .select('store_id, locked_until')
      .in('store_id', stores.map((s) => s.id))
    for (const p of (pins ?? []) as { store_id: string; locked_until: string | null }[]) {
      statusById.set(p.store_id, {
        pinSet: true,
        locked: isLocked(p.locked_until ? new Date(p.locked_until) : null, now),
      })
    }
  }

  const rows: IpadStore[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    pinSet: statusById.get(s.id)?.pinSet ?? false,
    locked: statusById.get(s.id)?.locked ?? false,
  }))

  return (
    <AdminShell pathname="/baggage/ipad" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
      <PageHeader
        title="iPad設定"
        crumb={[{ href: '/baggage', label: BAGGAGE_NAV_TITLE }, { href: '/baggage/ipad', label: 'iPad設定' }]}
      />
      <div className="p-5">
        <p className="mb-4 max-w-2xl text-[13px] text-slate-600 dark:text-gedink2">
          店舗ごとに iPad キオスクの QR コードと6桁PINを設定します。iPad で QR を読み取り、
          設定した6桁PINを入力するとキオスクが起動します（常設ログインは不要）。PIN は他者に知られないよう管理してください。
        </p>
        {rows.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2">
            手荷物検査が有効な担当店舗がありません。
          </div>
        ) : (
          <IpadSettingsClient stores={rows} />
        )}
      </div>
    </AdminShell>
  )
}
