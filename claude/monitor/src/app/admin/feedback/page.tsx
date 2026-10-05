/**
 * /admin/feedback — 要望ボード（②運営管理・super_admin 専用・基本設計 §3.5）
 *
 * 現場の G・VMS・クラウドの画面・ファイル取り込みから来た要望を、全テナント横断で扱う。
 *   - 見方: 新着（受け付けたまま）・未分類（話題に束ねていない）・話題ごと・すべて
 *   - 絞り込み: テナント・拠点・種類・状態・出どころ。CSV に書き出せる（同じ絞り込み）
 *   - 要望を話題に束ねる・話題を作る。話題の状態（と返事・対応の版）を変えると束ねた要望にも写る
 *   - 要望 1 件ずつの状態と返事（見送りは返事が必須）
 *   - 閉域の拠点が書き出したファイルの取り込み
 *
 * ②プレーンの原則どおり、ページ本体で super_admin を確かめる（メニューを隠すだけに頼らない）。
 * 全テナント横断のため service role で読む（上のガードで守る）。
 */
import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { loadBoardItems, parseBoardFilters } from '@/lib/feedback/board'
import { BoardClient, type TopicVM } from './board-client'

const PATH = '/admin/feedback'

export default async function FeedbackBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) { if (guard.status === 401) redirect('/login'); return <AdminDenied pathname={PATH} /> }

  const sp = await searchParams
  const first = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v }
  const filters = parseBoardFilters(first)

  const svc = createSupabaseService()
  const [board, { data: topics }, { data: tenants }, { data: stores }, { data: bundled }] = await Promise.all([
    loadBoardItems(svc, filters),
    svc.from('feedback_topics')
      .select('id, title, description, status, reply, fixed_version, wbs_ref, issue_url, internal_note, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500),
    svc.from('tenants').select('id, name').order('name'),
    svc.from('stores').select('id, name, tenant_id').order('name').limit(10_000),
    // 話題の集計（要望の件数・拠点の数・業務が止まるの件数）は絞り込みに依らず全件で数える。
    svc.from('feedback_items').select('topic_id, store_id, tenant_id, urgency').not('topic_id', 'is', null).limit(20_000),
  ])

  const agg = new Map<string, { items: number; places: Set<string>; blocking: number }>()
  for (const r of (bundled ?? []) as { topic_id: string; store_id: string | null; tenant_id: string; urgency: string }[]) {
    const a = agg.get(r.topic_id) ?? { items: 0, places: new Set<string>(), blocking: 0 }
    a.items += 1
    // 拠点の数: 拠点に属さない（クラウドの画面から送った）要望はテナント単位で 1 つと数える。
    a.places.add(r.store_id ?? `tenant:${r.tenant_id}`)
    if (r.urgency === 'blocking') a.blocking += 1
    agg.set(r.topic_id, a)
  }
  const topicVMs: TopicVM[] = ((topics ?? []) as Omit<TopicVM, 'itemCount' | 'placeCount' | 'blockingCount'>[]).map((t) => {
    const a = agg.get(t.id)
    return { ...t, itemCount: a?.items ?? 0, placeCount: a?.places.size ?? 0, blockingCount: a?.blocking ?? 0 }
  })

  return (
    <AdminShell pathname={PATH} section="admin">
      <PageHeader
        title="要望ボード"
        crumb={[{ href: '/admin', label: 'マスタ' }, { href: PATH, label: '要望ボード' }]}
      />
      <div className="p-5">
        <BoardClient
          filters={filters}
          items={board.items}
          loadError={board.error}
          topics={topicVMs}
          tenants={(tenants ?? []) as { id: string; name: string }[]}
          stores={(stores ?? []) as { id: string; name: string; tenant_id: string }[]}
        />
      </div>
    </AdminShell>
  )
}
