/**
 * /security/alarms — 発報タイムライン（Phase B / PB4）
 *
 * 時系列の発報一覧・スナップ・確認(ack/close)ワークフロー。上部からテスト発報も可能。
 * 発報の受信は /api/alarms/ingest（エッジ/Webhook源）、記録は alarm_events。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AlarmTimeline, type AlarmEventVM, type AlarmStoreOption } from './AlarmTimeline'

interface EventRow {
  id: string
  store_id: string | null
  source: string
  event_type: string | null
  occurred_at: string
  snapshot_url: string | null
  status: 'new' | 'ack' | 'closed'
  notified_at: string | null
  stores: { name: string } | { name: string }[] | null
  recorder_cameras: { name: string } | { name: string }[] | null
}
interface StoreRow { id: string; name: string }

const nameOf = (s: { name: string } | { name: string }[] | null | undefined) =>
  (Array.isArray(s) ? s[0]?.name : s?.name) ?? null

export default async function AlarmsPage() {
  const supa = await createSupabaseServer()

  const [eventsRes, storesRes] = await Promise.all([
    supa
      .from('alarm_events')
      .select('id, store_id, source, event_type, occurred_at, snapshot_url, status, notified_at, stores ( name ), recorder_cameras ( name )')
      .order('occurred_at', { ascending: false })
      .limit(300),
    supa.from('stores').select('id, name').eq('is_active', true).order('name').limit(10_000),
  ])

  const events: AlarmEventVM[] = ((eventsRes.data ?? []) as unknown as EventRow[]).map((e) => ({
    id: e.id,
    storeName: nameOf(e.stores) ?? '—',
    cameraName: nameOf(e.recorder_cameras),
    source: e.source,
    eventType: e.event_type,
    occurredAt: e.occurred_at,
    snapshotUrl: e.snapshot_url,
    status: e.status,
    notified: !!e.notified_at,
  }))
  const stores: AlarmStoreOption[] = ((storesRes.data ?? []) as StoreRow[]).map((s) => ({ id: s.id, name: s.name }))

  return (
    <AdminShell pathname="/security/alarms" section="security">
      <PageHeader title="発報" crumb={[{ href: '/security', label: '警備' }, { href: '/security/alarms', label: '発報' }]} />
      <div className="px-5 py-4">
        <AlarmTimeline events={events} stores={stores} />
      </div>
    </AdminShell>
  )
}
