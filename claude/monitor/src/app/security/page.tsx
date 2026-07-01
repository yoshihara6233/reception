/**
 * /security — 警備 巡回（証跡ギャラリー ＋ 要確認キュー）
 *
 * Phase A（証跡型巡回・AI/比較なし）: メインは巡回サイクル毎のスナップショット証跡。
 * 担当者が目視し、気になる画像を「要確認」に手動フラグする。フラグ/異常があるときだけ
 * 上部に要確認キュー（SecurityTriageClient）を出す。AdminShell + PageHeader で /bcp と一貫。
 */
import Link from 'next/link'
import { Shield } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { SecurityTriageClient, type Finding } from './SecurityTriageClient'
import { PatrolGalleryClient, type RunCard, type StoreOption } from './PatrolGalleryClient'
import { getT } from '@/lib/i18n/server'

interface FlaggedRow {
  id: string
  snapshot_url: string | null
  diff_score: number | null
  status: string
  ai_status: string
  ai_verdict: string | null
  ai_reason: string | null
  ai_confidence: number | null
  created_at: string
  patrol_runs: { store_id: string; stores: { id: string; name: string } | null } | null
  recorder_cameras: { id: string; name: string } | null
}

interface RunRow {
  id: string
  trigger: string
  started_at: string
  stores: { name: string } | null
}

interface RunFindingRow {
  id: string
  run_id: string
  status: string
  snapshot_url: string | null
  recorder_cameras: { name: string } | null
}

interface StoreStatusRow {
  store_id: string
  stores: { id: string; name: string } | null
}

export default async function SecurityPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const tSec = t.securityTriage

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  const [flaggedRes, runsRes, todayRunsRes, snapTodayRes, settingsRes] = await Promise.all([
    // 手動フラグ / 異常のみを要確認キューに（通常運用では空になりがち）
    supa
      .from('patrol_findings')
      .select(
        'id, snapshot_url, diff_score, status, ai_status, ai_verdict, ai_reason, ai_confidence, created_at, ' +
        'patrol_runs!inner ( store_id, stores ( id, name ) ), recorder_cameras ( id, name )'
      )
      .in('status', ['anomaly', 'review'])
      .order('created_at', { ascending: false })
      .limit(200),

    // 直近の巡回サイクル（証跡ギャラリー本体）
    supa
      .from('patrol_runs')
      .select('id, trigger, started_at, stores ( name )')
      .order('started_at', { ascending: false })
      .limit(12),

    // 本日の巡回回数
    supa.from('patrol_runs').select('id', { count: 'exact', head: true }).gte('started_at', todayISO),

    // 本日の撮影枚数
    supa.from('patrol_findings').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),

    // 有効店舗（今すぐ巡回のドロップダウン）
    supa
      .from('security_settings')
      .select('store_id, stores ( id, name )')
      .eq('enabled', true)
      .limit(1000),
  ])

  // 要確認キュー
  const flaggedRows = (flaggedRes.data ?? []) as unknown as FlaggedRow[]
  const flagged: Finding[] = flaggedRows.map((r) => ({
    id: r.id,
    storeId: r.patrol_runs?.store_id ?? '',
    storeName: r.patrol_runs?.stores?.name ?? '—',
    cameraName: r.recorder_cameras?.name ?? '—',
    snapshotUrl: r.snapshot_url,
    diffScore: r.diff_score,
    status: r.status,
    aiStatus: r.ai_status,
    aiVerdict: r.ai_verdict,
    aiReason: r.ai_reason,
    aiConfidence: r.ai_confidence,
    createdAt: r.created_at,
  }))

  // 証跡ギャラリー: run に findings をぶら下げる
  const runRows = (runsRes.data ?? []) as unknown as RunRow[]
  const runIds = runRows.map((r) => r.id)
  let findingsByRun: Record<string, RunFindingRow[]> = {}
  if (runIds.length) {
    const { data: rf } = await supa
      .from('patrol_findings')
      .select('id, run_id, status, snapshot_url, recorder_cameras ( name )')
      .in('run_id', runIds)
      .order('created_at', { ascending: true })
    findingsByRun = ((rf ?? []) as unknown as RunFindingRow[]).reduce((acc, f) => {
      (acc[f.run_id] ??= []).push(f)
      return acc
    }, {} as Record<string, RunFindingRow[]>)
  }
  const runs: RunCard[] = runRows.map((r) => ({
    id: r.id,
    storeName: r.stores?.name ?? '—',
    startedAt: r.started_at,
    trigger: r.trigger,
    findings: (findingsByRun[r.id] ?? []).map((f) => ({
      id: f.id,
      cameraName: f.recorder_cameras?.name ?? '—',
      snapshotUrl: f.snapshot_url,
      status: f.status,
    })),
  }))

  const storeRows = (settingsRes.data ?? []) as unknown as StoreStatusRow[]
  const stores: StoreOption[] = storeRows
    .filter((s) => s.stores)
    .map((s) => ({ id: s.stores!.id, name: s.stores!.name }))

  const todayRuns = todayRunsRes.count ?? 0
  const todaySnaps = snapTodayRes.count ?? 0
  const unconfirmed = flagged.length

  return (
    <AdminShell pathname="/security" section="security">
      <PageHeader
        title={tSec.title}
        crumb={[{ href: '/security', label: t.breadcrumb.security }]}
      />

      <div className="px-5 py-4 space-y-4">
        {/* 巡回解説バナー */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"><Shield size={16} strokeWidth={1.5} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                {t.securityHelp.title}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/80">
                {t.securityHelp.body}
              </p>
              <Link
                href="/security/glossary"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
              >
                {t.securityHelp.learnMore} →
              </Link>
            </div>
          </div>
        </div>

        {/* サマリ */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">{tSec.statRunsToday}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-gedink">{todayRuns.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">{tSec.statUnconfirmed}</div>
            <div className={'mt-1 text-2xl font-bold tabular-nums ' + (unconfirmed > 0 ? 'text-amber-600 dark:text-[#E2A55A]' : 'text-slate-900 dark:text-gedink')}>
              {unconfirmed.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">本日の撮影枚数</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-gedink">{todaySnaps.toLocaleString()}</div>
          </div>
        </div>

        {/* 要確認キュー（フラグ / 異常があるときだけ） */}
        {flagged.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-[#E2A55A]">要確認（{flagged.length}）</h3>
            <SecurityTriageClient findings={flagged} />
          </div>
        )}

        {/* 証跡ギャラリー（メイン） */}
        <PatrolGalleryClient runs={runs} stores={stores} />
      </div>
    </AdminShell>
  )
}
