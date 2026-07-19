/**
 * /baggage — 手荷物検査 履歴一覧（M4・SCREEN G）
 *
 * 状態バッジ先頭列（OV#3: 管理者の仕事=異常を拾う）＋フィルタチップ＋店舗×日付スコープ。
 * 読み取りはすべて RLS（baggage_store_access）越し — 見えない店舗の行は返らない。
 * バッジ辞書・フィルタ述語は lib/baggage/status.ts（M2）が単一源。
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from './nav'
import {
  sessionBadge, clipBadge, AUTH_SKIPPED_BADGE, UNCONFIRMED_BADGE,
  HISTORY_FILTERS, type HistoryFilterKey, type BadgeDef,
} from '@/lib/baggage/status'
import { jstDateStr } from '@/lib/baggage/unmatch'

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

const toneClass: Record<BadgeDef['tone'], string> = {
  ok:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  bad:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  muted:  'bg-slate-200 text-slate-600 dark:bg-gedbg3 dark:text-gedink3',
  accent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
}

function Badge({ def }: { def: BadgeDef }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${toneClass[def.tone]}`}>
      {def.label}
    </span>
  )
}

const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '—'

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

  const storeId = sp.store && storeOptions.some((s) => s.id === sp.store) ? sp.store : storeOptions[0]?.id
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

            {/* 履歴テーブル（状態バッジ先頭・OV#3） */}
            <div className="overflow-x-auto rounded border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500 dark:border-gedline dark:text-gedink3">
                    <th className="px-3 py-2 font-medium">状態</th>
                    <th className="px-3 py-2 font-medium">時刻</th>
                    <th className="px-3 py-2 font-medium">人物</th>
                    <th className="px-3 py-2 font-medium">区分</th>
                    <th className="px-3 py-2 font-medium">入室</th>
                    <th className="px-3 py-2 font-medium">退出</th>
                    <th className="px-3 py-2 font-medium">映像</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500 dark:text-gedink3">
                      該当する検査はありません
                    </td></tr>
                  )}
                  {visible.map((r) => {
                    const statuses = clipsBySession.get(r.id)
                    const expected = jobsBySession.get(r.id)
                    const person = r.person_kind === 'staff'
                      ? (r.employees?.name ?? '（未特定）')
                      : (r.visitor_name ?? '（未特定）')
                    return (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-gedline/50 dark:hover:bg-gedbg3">
                        <td className="px-3 py-2">
                          <Link href={`/baggage/${r.id}`} className="flex flex-wrap gap-1">
                            <Badge def={sessionBadge(r.status)} />
                            {r.auth_skipped && <Badge def={AUTH_SKIPPED_BADGE} />}
                            {r.confirmed_at === null && r.status !== 'entered' && <Badge def={UNCONFIRMED_BADGE} />}
                          </Link>
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{hm(r.exit_at ?? r.entry_at)}</td>
                        <td className="px-3 py-2">
                          <Link href={`/baggage/${r.id}`} className="text-blue-700 hover:underline dark:text-gedaccent">{person}</Link>
                        </td>
                        <td className="px-3 py-2">{r.person_kind === 'staff' ? '従業員' : '来訪者'}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{hm(r.entry_at)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{hm(r.exit_at)}</td>
                        <td className="px-3 py-2">
                          {statuses || expected
                            ? <Badge def={clipBadge(statuses ?? [], expected ?? statuses?.length ?? 2)} />
                            : <span className="text-slate-400 dark:text-gedink3">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  )
}
