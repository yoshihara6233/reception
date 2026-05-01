'use client'

/**
 * 手荷物申告 録画ビューアー
 *
 * VMS 設定済み + カメラID登録済み: HLS.js で実際の映像を再生
 * カメラID未設定 / VMS 未設定: 設定案内を表示
 *
 * 1 申告につき最大 2 カメラを横並びで同期再生。
 * API からカメラ毎に HLS URL が解決済みで返される。
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'

type CameraInfo = {
  slot: number
  label: string
  cameraId: string
  hlsUrl: string | null
}

type DeclarationData = {
  id: string
  visit_id: string
  context: string
  inspection_mode: string
  status: string
  vms_hls_url: string | null
  vms_inspection_id: string | null
  vms_connected: boolean
  inspection_started_at: string | null
  inspection_ended_at: string | null
  cameras: CameraInfo[]
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ── HLS プレーヤー（1 カメラ分） ─────────────────────────────────────
function HlsVideoPanel({
  cam,
  hlsUrl,
  playing,
  onDurationChange,
  onTimeUpdate,
}: {
  cam: CameraInfo
  hlsUrl: string
  playing: boolean
  onDurationChange?: (d: number) => void
  onTimeUpdate?: (t: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!videoRef.current || !hlsUrl) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hlsInstance: any = null

    const load = async () => {
      const Hls = (await import('hls.js')).default
      if (!Hls.isSupported()) {
        if (videoRef.current) videoRef.current.src = hlsUrl
        return
      }
      const hls = new Hls()
      hlsInstance = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(videoRef.current!)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (videoRef.current) {
          onDurationChange?.(videoRef.current.duration || 0)
        }
      })
    }

    load()

    return () => { hlsInstance?.destroy?.() }
  }, [hlsUrl, onDurationChange])

  useEffect(() => {
    if (!videoRef.current) return
    if (playing) videoRef.current.play().catch(() => {})
    else videoRef.current.pause()
  }, [playing])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !onTimeUpdate) return
    const handler = () => onTimeUpdate(v.currentTime)
    v.addEventListener('timeupdate', handler)
    return () => v.removeEventListener('timeupdate', handler)
  }, [onTimeUpdate])

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} className="w-full h-full object-contain" playsInline muted />
      <div className="absolute top-2 left-2 text-[10px] text-white/80 font-mono bg-black/50 rounded px-2 py-0.5 leading-tight">
        🔴 REC · カメラ{cam.slot} · {cam.label}
      </div>
      <div className="absolute top-2 right-2 text-[10px] text-white/60 font-mono bg-black/50 rounded px-2 py-0.5">
        {cam.cameraId}
      </div>
    </div>
  )
}

// ── カメラ未設定パネル ─────────────────────────────────────────────
function NoCameraPanel({ cam, reason }: { cam: CameraInfo; reason: string }) {
  return (
    <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl overflow-hidden flex flex-col items-center justify-center gap-2">
      <span className="text-3xl">📷</span>
      <p className="text-sm font-medium text-gray-600">カメラ{cam.slot} · {cam.label}</p>
      <p className="text-xs text-gray-400 text-center px-4">{reason}</p>
    </div>
  )
}

// ── メイン ────────────────────────────────────────────────────────────
export default function BaggageRecordingPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const visitId = searchParams.get('visitId')

  const [data, setData] = useState<DeclarationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const fireToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/admin/baggage/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: DeclarationData) => setData(d))
      .catch(() => setLoadError('録画情報の読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [id])

  const cameras: CameraInfo[] = data?.cameras?.length
    ? data.cameras
    : [
        { slot: 1, label: '受付カウンター',   cameraId: '', hlsUrl: null },
        { slot: 2, label: '手荷物検査デスク', cameraId: '', hlsUrl: null },
      ]

  const anyHls = cameras.some(c => c.hlsUrl)
  const vmsConnected = data?.vms_connected ?? false
  const inspectionStarted = data?.inspection_started_at
  const inspectionEnded   = data?.inspection_ended_at

  const posPct = duration > 0 ? (position / duration) * 100 : 0

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPosition(pct * duration)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        録画情報を読み込み中...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-20 text-red-500 text-sm">
        {loadError}
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* ── ヘッダ ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            {visitId ? (
              <>
                <Link href="/admin/visits" className="hover:text-[var(--ge-accent)]">来訪履歴</Link>
                <span>›</span>
                <Link href={`/admin/visits/${visitId}`} className="hover:text-[var(--ge-accent)]">来訪詳細</Link>
              </>
            ) : (
              <Link href="/admin/baggage" className="hover:text-[var(--ge-accent)]">手荷物検査</Link>
            )}
            <span>›</span>
            <span>録画ビューアー</span>

            {anyHls ? (
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                ✅ 映像あり
              </span>
            ) : vmsConnected ? (
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
                ⚠️ VMS 接続中・録画なし
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
                📷 VMS 未設定
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-[var(--ge-accent)]">
            録画再生 · 手荷物申告 #{id.slice(0, 8)}
          </h1>
        </div>
      </div>

      {/* ── 検査時刻バナー ─────────────────────────────────────────── */}
      {(inspectionStarted || inspectionEnded) && (
        <div className="flex items-center gap-4 px-4 py-3 bg-[var(--ge-accent)]/5 border border-[var(--ge-accent)]/15 rounded-xl mb-3 text-sm">
          <span className="text-[var(--ge-accent)] font-semibold text-xs uppercase tracking-wide">検査時刻</span>
          <span className="font-mono text-gray-700 text-xs">
            {fmtDatetime(inspectionStarted ?? null)} 〜 {fmtDatetime(inspectionEnded ?? null)}
          </span>
          {inspectionStarted && !anyHls && vmsConnected && (
            <span className="ml-auto text-[11px] text-amber-600">
              ⚠️ この時刻の録画が VMS から取得できませんでした。カメラID を確認してください。
            </span>
          )}
        </div>
      )}

      {/* ── カメラ映像 ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
          {cameras.map(cam => (
            <div key={cam.slot} className="relative">
              {cam.hlsUrl ? (
                <HlsVideoPanel
                  cam={cam}
                  hlsUrl={cam.hlsUrl}
                  playing={playing}
                  onDurationChange={d => { if (d > 0) setDuration(d) }}
                  onTimeUpdate={t => setPosition(t)}
                />
              ) : (
                <NoCameraPanel
                  cam={cam}
                  reason={
                    !vmsConnected
                      ? '店舗設定でVMS接続とカメラIDを設定してください'
                      : !cam.cameraId
                      ? 'このスロットにカメラIDが設定されていません'
                      : `この時間帯の録画が見つかりませんでした (${cam.cameraId})`
                  }
                />
              )}
              {cam.hlsUrl && (
                <button
                  onClick={() => fireToast(`📥 カメラ${cam.slot}: ${cam.label} の録画をダウンロード`)}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/90 text-[11px] text-[var(--ge-accent)] font-medium shadow hover:bg-white"
                >
                  📥 MP4 で取得
                </button>
              )}
            </div>
          ))}
        </div>

        {/* ── 再生コントロール（映像がある場合のみ） ─────────────── */}
        {anyHls ? (
          <div className="px-4 py-4 border-t border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setPosition(p => Math.max(0, p - 10))}
                className="w-9 h-9 rounded-full border border-gray-200 hover:bg-gray-50 text-sm"
                title="10秒戻る"
              >⏮</button>
              <button
                onClick={() => setPlaying(p => !p)}
                className="w-11 h-11 rounded-full bg-[var(--ge-accent)] text-white text-lg hover:bg-[var(--ge-accent-ink)]"
              >
                {playing ? '⏸' : '▶'}
              </button>
              <button
                onClick={() => setPosition(p => Math.min(duration, p + 10))}
                className="w-9 h-9 rounded-full border border-gray-200 hover:bg-gray-50 text-sm"
                title="10秒進む"
              >⏭</button>
              <span className="text-xs text-gray-400 ml-2">両カメラ同期</span>
              <div className="flex-1" />
              <span className="text-xs text-gray-500 font-mono tabular-nums">
                {fmtTime(position)} / {duration > 0 ? fmtTime(duration) : '--:--'}
              </span>
            </div>

            {/* シークバー */}
            <div
              ref={timelineRef}
              onClick={handleSeek}
              className="relative h-8 bg-gray-100 rounded-lg cursor-pointer"
            >
              <div
                className="absolute inset-y-0 left-0 bg-[var(--ge-accent)]/20 rounded-lg"
                style={{ width: `${posPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[var(--ge-accent)]"
                style={{ left: `${posPct}%` }}
              />
              {/* 検査開始マーカー */}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-1 bg-amber-400 group/marker"
                  style={{ left: '0%' }}
                  title="検査開始"
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded opacity-0 group-hover/marker:opacity-100 transition-opacity">
                    検査開始
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── 映像なし: 設定案内 ─────────────────────────────────── */
          <div className="px-5 py-5 border-t border-gray-100">
            <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-xl border border-amber-100 text-sm">
              <span className="text-xl mt-0.5">📝</span>
              <div className="space-y-1 text-amber-900">
                <p className="font-semibold">映像を表示するには</p>
                <ol className="list-decimal list-inside space-y-1 text-xs opacity-90">
                  <li>店舗設定 → カメラ タブ → VMS URL と API Key を登録</li>
                  <li>カメラID — スロット2（手荷物）にカメラIDを入力して保存</li>
                  <li>エリア設定で検査モードを「映像」に変更</li>
                  <li>次回以降の手荷物検査から自動的に録画が紐付けられます</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 下段: 操作 + 接続情報 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {anyHls && (
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">操作</p>
            <button
              onClick={() => fireToast('📥 両カメラの録画を MP4 に変換してダウンロード')}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[var(--ge-accent)] text-white rounded-xl text-sm font-medium hover:bg-[var(--ge-accent-ink)]"
            >
              📥 両カメラをまとめて MP4 ダウンロード
            </button>
            <button
              onClick={() => fireToast('📎 スナップショットを申告レコードに添付')}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
            >
              📎 現在フレームを添付
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">カメラ接続情報</p>
          <dl className="text-xs space-y-2">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">VMS</dt>
              <dd>
                {vmsConnected
                  ? <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium">接続済</span>
                  : <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">未設定</span>
                }
              </dd>
            </div>
            {cameras.map(cam => (
              <div key={cam.slot} className="flex justify-between gap-2">
                <dt className="text-gray-400">カメラ{cam.slot} · {cam.label}</dt>
                <dd className="font-mono text-gray-600 truncate max-w-[160px]">
                  {cam.cameraId
                    ? <span className={cam.hlsUrl ? 'text-emerald-600' : 'text-amber-600'}>{cam.cameraId}</span>
                    : <span className="text-gray-300">未設定</span>
                  }
                </dd>
              </div>
            ))}
            {inspectionStarted && (
              <div className="flex justify-between gap-2 pt-1 border-t border-gray-100">
                <dt className="text-gray-400">検査開始</dt>
                <dd className="font-mono text-gray-600 text-[10px]">{fmtDatetime(inspectionStarted)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* ── Toast ────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ge-accent)] text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
