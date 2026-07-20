/**
 * /baggage — 手荷物検査 履歴一覧（M4・SCREEN G）
 *
 * 状態バッジ先頭列（OV#3: 管理者の仕事=異常を拾う）＋フィルタチップ＋店舗×日付スコープ。
 * 読み取りはすべて RLS（baggage_store_access）越し — 見えない店舗の行は返らない。
 * バッジ辞書・フィルタ述語は lib/baggage/status.ts（M2）が単一源。
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from './nav'
import {
  sessionBadge, clipBadge,
  HISTORY_FILTERS, type HistoryFilterKey,
} from '@/lib/baggage/status'
import { jstDateStr } from '@/lib/baggage/unmatch'
import { HistoryWorkspace, type RowVM } from './HistoryWorkspace'

interface SessionRow {
  id: string
  person_kind: 'staff' | 'visitor'
  visitor_name: string | null
  entry_at: string | null
  exit_at: string | null
  status: string
  auth_skipped: boolean
  confirmed_at: string | null
  employees: { name: string } | null
}

export default async function BaggageHistoryPage(
  { searchParams }: { searchParams: Promise<{ store?: string; date?: string; f?: string }> },
) {
  const sp = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // 対象店舗 = inspection_settings.enabled の店舗（RLS で可視分のみ返る）
  const { data: enabledRows } = await supa
    .from('inspection_settings')
    .select('store_id, stores ( id, name )')
    .eq('enabled', true)
  const storeOptions = (enabledRows ?? [])
    .map((r) => {
      const s = Array.isArray(r.stores) ? r.stores[0] : r.stores
      return s ? { id: (s as { id: string }).id, name: (s as { name: string }).name } : null
    })
    .filter(Boolean) as { id: string; name: string }[]

  // 店舗の既定: ?store → cookie(bg_store・前回選択) → 先頭。いずれも可視店舗に限る。
  const cookieStore = (await cookies()).get('bg_store')?.value
  const storeId =
    (sp.store && storeOptions.some((s) => s.id === sp.store) && sp.store) ||
    (cookieStore && storeOptions.some((s) => s.id === cookieStore) && cookieStore) ||
    storeOptions[0]?.id
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : jstDateStr(new Date())
  const filter: HistoryFilterKey = (HISTORY_FILTERS.some((f) => f.key === sp.f) ? sp.f : 'all') as HistoryFilterKey

  let rows: SessionRow[] = []
  let clipsBySession = new Map<string, string[]>()
  const jobsBySession = new Map<string, number>()   // 期待クリップ本数（1カメラ店舗は1）
  if (storeId) {
    const { data } = await supa
      .from('inspection_sessions')
      .select('id, person_kind, visitor_name, entry_at, exit_at, status, auth_skipped, confirmed_at, employees ( name )')
      .eq('store_id', storeId)
      .eq('inspection_date', date)
      .order('exit_at', { ascending: false, nullsFirst: false })
      .limit(500)
    rows = ((data ?? []) as unknown[]).map((r) => {
      const row = r as Omit<SessionRow, 'employees'> & { employees: unknown }
      const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees
      return { ...row, employees: (emp ?? null) as SessionRow['employees'] }
    })

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id)
      const [{ data: clips }, { data: jobs }] = await Promise.all([
        supa.from('inspection_clips').select('session_id, upload_status').in('session_id', ids),
        supa.from('inspection_clip_jobs').select('session_id').in('session_id', ids),
      ])
      clipsBySession = new Map()
      for (const c of (clips ?? []) as { session_id: string; upload_status: string }[]) {
        clipsBySession.set(c.session_id, [...(clipsBySession.get(c.session_id) ?? []), c.upload_status])
      }
      for (const j of (jobs ?? []) as { session_id: string }[]) {
        jobsBySession.set(j.session_id, (jobsBySession.get(j.session_id) ?? 0) + 1)
      }
    }
  }

  // チップ件数と表示行は同じ日次データから導出（数字と行が食い違わない）
  const matches = (r: SessionRow, key: HistoryFilterKey): boolean => {
    switch (key) {
      case 'completed':    return r.status === 'completed'
      case 'unmatched':    return r.status === 'unmatched_entry' || r.status === 'unmatched_exit'
      case 'interrupted':  return r.status === 'interrupted'
      case 'auth_skipped': return r.auth_skipped
      case 'unconfirmed':  return r.confirmed_at === null && r.status !== 'entered'
      case 'all':
      default:             return true
    }
  }
  const visible = rows.filter((r) => matches(r, filter))
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(storeId ? { store: storeId } : {}), date, f: filter, ...over })
    return `/baggage?${p.toString()}`
  }

  // クリップバッジは行内で導出できないシリアライズ済み値としてサーバで確定する。
  const rowVMs: RowVM[] = visible.map((r) => {
    const statuses = clipsBySession.get(r.id)
    const expected = jobsBySession.get(r.id)
    return {
      id: r.id,
      person: r.person_kind === 'staff' ? (r.employees?.name ?? '（未特定）') : (r.visitor_name ?? '（未特定）'),
      kind: r.person_kind,
      entryAt: r.entry_at,
      exitAt: r.exit_at,
      statusBadge: sessionBadge(r.status),
      authSkipped: r.auth_skipped,
      unconfirmed: r.confirmed_at === null && r.status !== 'entered',
      clip: (statuses || expected) ? clipBadge(statuses ?? [], expected ?? statuses?.length ?? 2) : null,
    }
  })

  return (
    <AdminShell pathname="/baggage" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
      <PageHeader title="手荷物検査 履歴" crumb={[{ href: '/baggage', label: BAGGAGE_NAV_TITLE }]} />
      <div className="p-5">

        {storeOptions.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2">
            手荷物検査が有効な店舗がありません。<Link href="/baggage/settings" className="text-blue-700 underline dark:text-gedaccent">設定</Link>から有効化してください。
          </div>
        ) : (
          <>
            {/* 店舗・日付スコープ */}
            <form method="get" action="/baggage" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <select name="store" defaultValue={storeId}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 dark:border-gedline dark:bg-gedbg2 dark:text-gedink">
                {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="date" name="date" defaultValue={date}
                className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-gedline dark:bg-gedbg2 dark:text-gedink" />
              <input type="hidden" name="f" value={filter} />
              <button type="submit"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
                表示
              </button>
            </form>

            {/* フィルタチップ（M2 HISTORY_FILTERS が単一源） */}
            <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
              {HISTORY_FILTERS.map((f) => {
                const n = rows.filter((r) => matches(r, f.key)).length
                const on = f.key === filter
                return (
                  <Link key={f.key} href={qs({ f: f.key })}
                    className={
                      'rounded border px-3 py-1 ' +
                      (on
                        ? 'border-blue-700 bg-blue-50 font-medium text-blue-800 dark:border-gedaccent dark:bg-gedbg3 dark:text-gedink'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2 dark:hover:bg-gedbg3')
                    }>
                    {f.label} {n}
                  </Link>
                )
              })}
            </div>

            {/* 履歴（左一覧×右詳細・行を次々に選択） */}
            <HistoryWorkspace rows={rowVMs} storeId={storeId ?? null} />
          </>
        )}
      </div>
    </AdminShell>
  )
}
