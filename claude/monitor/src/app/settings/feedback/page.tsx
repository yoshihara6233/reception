/**
 * /settings/feedback — 送った要望の一覧（テナント管理者だけ・基本設計 §3.1・§3.6）
 *
 * 自分のテナントの要望（クラウドの画面から送ったもの・拠点の G・VMS から届いたもの・
 * ファイルで取り込んだもの）と、運営が決めた状態・返事・対応した版を出す。
 * 読むのは RLS 配下のセッション（feedback_items_select: tenant_admin は自分のテナントだけ）。
 * 運営の話題・内部メモはここには出ない（テーブルごと読めない）。
 *
 * 本文と返事は文として出す（HTML として解釈しない・§7）。
 * 該当の画面の URL と添えた画像も出す（画像は /api/feedback/[id]/attachment の期限つきの URL）。
 *
 * 開いたら既読にする（feedback_seen・§3.6）。左メニューの「要望」の件数の印が消え、
 * 前に開いたあとで運営が状態・返事を変えた要望には「新着」を付ける。
 * 開いた画面の印は AdminShell に feedbackSeen を渡して 0 にする（数え直さない理由は AdminShell の注記）。
 * Link の先読み（prefetch）では既読にしない（開いていないのに印が消えるのを避ける）。
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { FeedbackSendButton } from '@/components/feedback/FeedbackSendButton'
import { FeedbackStatusBadge } from '@/components/feedback/FeedbackStatusBadge'
import { requireTenantAdmin } from '@/lib/admin/guard'
import { resolveFeedbackEntry } from '@/lib/feedback/entry'
import { KIND_LABEL, URGENCY_LABEL, type FeedbackKind, type FeedbackUrgency } from '@/lib/feedback/schema'
import { attachmentState, fmtJst } from '@/lib/feedback/board'
import { FeedbackAttachment } from '@/components/feedback/FeedbackAttachment'
import { isUnseenUpdate, loadSeenAt, markFeedbackSeen } from '@/lib/feedback/seen'
import { createSupabaseService } from '@/lib/supabase/server'

interface Row {
  id: string
  source: 'gvms' | 'cloud' | 'import'
  store_id: string | null
  kind: FeedbackKind
  urgency: FeedbackUrgency
  body: string
  status: string
  reply: string | null
  fixed_version: string | null
  created_at: string
  updated_at: string
  page_url: string | null
  attachment_type: string | null
  attachment_path: string | null
  attachment_purged_at: string | null
}

const PATH = '/settings/feedback'

export default async function FeedbackListPage() {
  const guard = await requireTenantAdmin()
  if (!guard.ok) {
    if (guard.status === 401) redirect('/login')
    return <AdminDenied pathname={PATH} message="要望の一覧を見られるのはテナント管理者だけです。" />
  }
  const tenantId = guard.profile.tenant_id
  const me = { userId: guard.user.id, tenantId }

  const [enabled, { data, error }, { data: stores }, seenAt] = await Promise.all([
    resolveFeedbackEntry(),
    guard.supa
      .from('feedback_items')
      .select('id, source, store_id, kind, urgency, body, status, reply, fixed_version, created_at, updated_at, page_url, attachment_type, attachment_path, attachment_purged_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(200),
    guard.supa.from('stores').select('id, name').eq('tenant_id', tenantId),
    loadSeenAt(guard.supa, me.userId),
  ])
  const rows = (data ?? []) as Row[]
  // 前に開いたあとに運営が状態・返事を変えたもの（今回の既読の前の時刻で判定する）
  const fresh = new Set(rows.filter((r) => isUnseenUpdate(r, seenAt)).map((r) => r.id))
  const seenNow = !error && !(await isPrefetch())
  if (seenNow) await markFeedbackSeen(createSupabaseService(), me)
  const storeName = new Map(((stores ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const from = (r: Row) =>
    r.source === 'cloud' ? 'クラウドの画面'
      : `${r.store_id ? storeName.get(r.store_id) ?? '拠点' : '拠点'}（${r.source === 'import' ? 'ファイル' : 'G・VMS'}）`

  return (
    <AdminShell pathname={PATH} section="admin" feedbackSeen={seenNow}>
      <PageHeader
        title="要望"
        crumb={[{ href: '/admin', label: '設定' }, { href: PATH, label: '要望' }]}
        actions={<FeedbackSendButton disabled={!enabled} />}
      />
      <div className="space-y-4 px-5 py-4">
        <p className="text-xs text-ge-ink-3 dark:text-gedink2">
          このテナントから送った要望・困りごとと、運営からの返事です。拠点の G・VMS の管理者が送ったものも含みます。
          運営が内容を確かめ、状態と返事をここでお知らせします。
        </p>
        {!enabled && (
          <p className="rounded border border-ge-line bg-ge-paper-2 px-3 py-2 text-xs text-ge-ink-2 dark:border-gedline dark:bg-gedbg3 dark:text-gedink2">
            このテナントでは要望の受付が止められています。再開は運営へお問い合わせください。
          </p>
        )}
        {error ? (
          <p className="text-xs text-ge-danger">一覧を読めませんでした。時間をおいて開き直してください。</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-ge-line bg-white py-10 text-center text-sm text-ge-ink-2 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2">
            送った要望はまだありません
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border border-ge-line bg-white p-4 text-xs dark:border-gedline dark:bg-gedbg2">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <FeedbackStatusBadge status={r.status} />
                  {fresh.has(r.id) && (
                    // 藍は使わない（この画面の藍は「要望を送る」と左メニューの印）。墨の塗りで状態の札と分ける
                    <span className="inline-block whitespace-nowrap rounded bg-ge-ink px-1.5 py-0.5 text-[11px] font-medium text-ge-paper dark:bg-gedink dark:text-gedbg">新着</span>
                  )}
                  <span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span className="text-ge-ink-3 dark:text-gedink3">{URGENCY_LABEL[r.urgency] ?? r.urgency}</span>
                  <span className="text-ge-ink-3 dark:text-gedink3">{from(r)}</span>
                  <span className="ml-auto font-ge-mono tabular-nums text-ge-ink-3 dark:text-gedink3">{fmtJst(r.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{r.body}</p>
                <FeedbackAttachment pageUrl={r.page_url} state={attachmentState(r)} imageHref={`/api/feedback/${r.id}/attachment`} />
                {(r.reply || r.fixed_version) && (
                  <div className="mt-3 rounded border border-ge-line bg-ge-paper px-3 py-2 dark:border-gedline dark:bg-gedbg">
                    <div className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-ge-ink-3 dark:text-gedink3">
                      <span className="font-bold">運営からの返事</span>
                      {r.fixed_version && <span>対応した版 <span className="font-ge-mono">{r.fixed_version}</span></span>}
                      <span className="font-ge-mono tabular-nums">{fmtJst(r.updated_at)}</span>
                    </div>
                    {r.reply && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{r.reply}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  )
}

/** Link の先読みの要求か（このときは既読にしない）。 */
async function isPrefetch(): Promise<boolean> {
  const h = await headers()
  return h.get('next-router-prefetch') != null || h.get('next-router-segment-prefetch') != null
}
