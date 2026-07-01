'use client'

/**
 * 巡回レポートの証跡ビューア（/security/reports の各行「画像」ボタン）。
 * 開くとレポート期間内の JPEG を 1/4/9/16 分割で表示し、ページ送りで全枚数を閲覧できる。
 * 画像は認証付き署名プロキシ（同一オリジン）の <img> で表示。
 */
import { useState, useTransition, useCallback } from 'react'
import { Images, Square, Grid2x2, Grid3x3, LayoutGrid, ChevronLeft, ChevronRight, X, Camera } from 'lucide-react'
import { listReportSnapshots, type ReportSnapshot } from './actions'

const SPLITS: Array<{ n: 1 | 4 | 9 | 16; cols: number; Icon: typeof Square; label: string }> = [
  { n: 1,  cols: 1, Icon: Square,     label: '1分割' },
  { n: 4,  cols: 2, Icon: Grid2x2,    label: '4分割' },
  { n: 9,  cols: 3, Icon: Grid3x3,    label: '9分割' },
  { n: 16, cols: 4, Icon: LayoutGrid, label: '16分割' },
]

function fmtJst(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function ReportImagesButton({ reportId, count }: { reportId: string; count: number }) {
  const [open, setOpen] = useState(false)
  const [snaps, setSnaps] = useState<ReportSnapshot[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [split, setSplit] = useState<1 | 4 | 9 | 16>(4)
  const [page, setPage] = useState(0)

  const load = useCallback(() => {
    setErr(null)
    startTransition(async () => {
      const res = await listReportSnapshots(reportId)
      if (res.ok) setSnaps(res.snapshots ?? [])
      else setErr(res.error ?? '読み込みに失敗しました')
    })
  }, [reportId])

  function openViewer() {
    setOpen(true); setPage(0)
    if (!snaps) load()
  }

  const list = snaps ?? []
  const perPage = split
  const pages = Math.max(1, Math.ceil(list.length / perPage))
  const current = list.slice(page * perPage, page * perPage + perPage)
  const cols = SPLITS.find((s) => s.n === split)!.cols

  return (
    <>
      <button
        onClick={openViewer}
        disabled={count === 0}
        title={count === 0 ? '画像なし' : '証跡画像を見る'}
        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:text-gedink2 dark:hover:bg-gedbg3"
      >
        <Images size={12} strokeWidth={2} aria-hidden /> 画像
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/70 p-3 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-gedbg2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: split selector + paging + close */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gedline px-4 py-2">
              <div className="flex items-center gap-1">
                {SPLITS.map(({ n, Icon, label }) => (
                  <button
                    key={n}
                    onClick={() => { setSplit(n); setPage(0) }}
                    title={label}
                    className={
                      'flex h-8 w-8 items-center justify-center rounded ' +
                      (split === n
                        ? 'bg-gedaccent text-gedbg'
                        : 'text-gedink2 hover:bg-gedbg3')
                    }
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                ))}
                <span className="ml-2 text-xs text-gedink3">全 {list.length} 枚</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex h-8 w-8 items-center justify-center rounded text-gedink2 hover:bg-gedbg3 disabled:opacity-30"
                  title="前へ"
                ><ChevronLeft size={18} strokeWidth={2} aria-hidden /></button>
                <span className="min-w-[64px] text-center text-xs tabular-nums text-gedink2">{page + 1} / {pages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                  disabled={page >= pages - 1}
                  className="flex h-8 w-8 items-center justify-center rounded text-gedink2 hover:bg-gedbg3 disabled:opacity-30"
                  title="次へ"
                ><ChevronRight size={18} strokeWidth={2} aria-hidden /></button>
                <button
                  onClick={() => setOpen(false)}
                  className="ml-1 flex h-8 w-8 items-center justify-center rounded text-gedink2 hover:bg-gedbg3"
                  title="閉じる"
                ><X size={18} strokeWidth={2} aria-hidden /></button>
              </div>
            </div>

            {/* Body: grid */}
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {pending && !snaps ? (
                <div className="flex h-full items-center justify-center text-sm text-gedink3">読み込み中…</div>
              ) : err ? (
                <div className="flex h-full items-center justify-center text-sm text-[#E87D74]">{err}</div>
              ) : list.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-gedink3">
                  <Camera size={28} strokeWidth={1.5} aria-hidden />
                  <p className="text-sm">この期間に表示できる画像がありません</p>
                  <p className="text-xs">（スナップショットは 30 日で削除されます。PDF 内の画像は残ります）</p>
                </div>
              ) : (
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {current.map((s, i) => (
                    <a
                      key={page * perPage + i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative overflow-hidden rounded border border-gedline bg-gedbg3"
                    >
                      <div className="flex aspect-video items-center justify-center text-gedink3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt={s.camera} loading="lazy" className="h-full w-full object-cover" />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                        <span className="truncate">{s.camera}</span>
                        <span className="flex-none tabular-nums opacity-80">{fmtJst(s.at)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
