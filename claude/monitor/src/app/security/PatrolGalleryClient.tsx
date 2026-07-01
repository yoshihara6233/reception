'use client'

/**
 * 証跡ギャラリー（Phase A / A3）— 比較なしの巡回運用のメイン画面。
 *
 * AI判定・差分比較をしないため「異常キュー」ではなく、巡回サイクル毎のスナップショットを
 * 時系列で一覧する「証跡」ビューが主役。担当者は目視で確認し、気になる画像だけ
 * 「要確認」に手動フラグする。上部から「今すぐ巡回」も発火できる。
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Play, Flag, Check } from 'lucide-react'
import { triggerManualPatrol, updateFindingStatus } from './actions'

export interface GalleryFinding {
  id: string
  cameraName: string
  snapshotUrl: string | null
  status: string
}

export interface RunCard {
  id: string
  storeName: string
  startedAt: string
  trigger: string
  findings: GalleryFinding[]
}

export interface StoreOption {
  id: string
  name: string
}

function fmtJST(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const TRIGGER_LABEL: Record<string, string> = {
  scheduled: '定時', manual: '手動', emergency: '緊急',
}

/** 「今すぐ巡回」— 店舗を選んで即時発火。 */
function ManualPatrol({ stores }: { stores: StoreOption[] }) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (!stores.length) return null

  function run() {
    if (!storeId) return
    setMsg(null)
    startTransition(async () => {
      const res = await triggerManualPatrol(storeId)
      if (res.ok) {
        setMsg({ ok: true, text: '巡回を開始しました。数十秒後に証跡が表示されます。' })
        setTimeout(() => router.refresh(), 8000)
      } else {
        setMsg({ ok: false, text: res.error ?? '巡回の開始に失敗しました' })
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-gedline dark:bg-gedbg2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">今すぐ巡回</span>
      <select
        value={storeId}
        onChange={(e) => setStoreId(e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-[13px] dark:border-gedline dark:bg-gedbg3 dark:text-gedink"
      >
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button
        onClick={run}
        disabled={pending || !storeId}
        className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-[13px] font-medium text-white disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg"
      >
        <Play size={14} strokeWidth={2} aria-hidden /> {pending ? '発火中…' : '巡回を実行'}
      </button>
      {msg && (
        <span className={'text-[12px] ' + (msg.ok ? 'text-emerald-600 dark:text-[#5CC98B]' : 'text-red-600 dark:text-[#E87D74]')}>
          {msg.text}
        </span>
      )}
    </div>
  )
}

/** 1枚のスナップショット（サムネ＋気になるフラグ）。 */
function Thumb({ f }: { f: GalleryFinding }) {
  const [pending, startTransition] = useTransition()
  const [flagged, setFlagged] = useState(f.status === 'review' || f.status === 'anomaly')

  function flag() {
    startTransition(async () => {
      const res = await updateFindingStatus(f.id, 'review')
      if (res.ok) setFlagged(true)
    })
  }

  return (
    <div className="group relative overflow-hidden rounded border border-slate-200 bg-slate-100 dark:border-gedline dark:bg-gedbg3">
      <div className="flex aspect-video items-center justify-center text-slate-400 dark:text-gedink3">
        {f.snapshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.snapshotUrl} alt={f.cameraName} loading="lazy" className="h-full w-full object-cover" />
        ) : <Camera size={20} strokeWidth={1.5} aria-hidden />}
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <span className="truncate text-[11px] text-slate-600 dark:text-gedink2">{f.cameraName}</span>
        {flagged ? (
          <span className="inline-flex flex-none items-center gap-0.5 rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-700 dark:bg-[#B5761A]/20 dark:text-[#E2A55A]">
            <Flag size={10} strokeWidth={2} aria-hidden /> 要確認
          </span>
        ) : (
          <button
            onClick={flag}
            disabled={pending}
            className="inline-flex flex-none items-center gap-0.5 rounded border border-slate-300 px-1.5 py-px text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-gedline dark:text-gedink2 dark:hover:bg-gedbg2"
          >
            <Flag size={10} strokeWidth={2} aria-hidden /> 気になる
          </button>
        )}
      </div>
    </div>
  )
}

export function PatrolGalleryClient({ runs, stores }: { runs: RunCard[]; stores: StoreOption[] }) {
  return (
    <div className="space-y-4">
      <ManualPatrol stores={stores} />

      {runs.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-gedline dark:bg-gedbg2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-gedbg3 dark:text-gedink3">
            <Camera size={22} strokeWidth={1.5} aria-hidden />
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-gedink">まだ巡回記録がありません</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-gedink3">
            スケジュール（4時間毎）で自動撮影されるか、上の「今すぐ巡回」で開始できます。
          </p>
        </div>
      ) : (
        runs.map((run) => (
          <div key={run.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-gedline">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-semibold text-slate-800 dark:text-gedink">{run.storeName}</span>
                <span className="text-slate-400 dark:text-gedink3">·</span>
                <span className="tabular-nums text-slate-600 dark:text-gedink2">{fmtJST(run.startedAt)}</span>
                <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
                  {TRIGGER_LABEL[run.trigger] ?? run.trigger}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-gedink3">
                <Check size={12} strokeWidth={2} aria-hidden /> {run.findings.length} 枚
              </span>
            </div>
            {run.findings.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-slate-500 dark:text-gedink3">撮影待ち…（エッジが処理中）</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {run.findings.map((f) => <Thumb key={f.id} f={f} />)}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
