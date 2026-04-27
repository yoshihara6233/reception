'use client'

/**
 * 手荷物申告 録画ビューアー
 *
 * VMS が設定されている場合: HLS.js で実際の映像を再生する
 * VMS 未設定の場合: モック表示（i-PRO Remo 将来対応）
 *
 * 1 申告につき最大 2 カメラを横並びで同期再生
 */

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'

type CameraInfo = { slot: 1 | 2; label: string; cameraId: string; hlsUrl?: string }

const MOCK_DURATION_SEC = 600
type EventMarker = { t: number; label: string; color: string }
const MOCK_EVENTS: EventMarker[] = [
  { t: 60,  label: '入室',         color: 'bg-purple-500' },
  { t: 120, label: '手荷物申告',   color: 'bg-amber-500'  },
  { t: 185, label: '撮影',         color: 'bg-blue-500'   },
  { t: 340, label: 'スタッフ審査', color: 'bg-emerald-500' },
  { t: 510, label: '退室',         color: 'bg-orange-500' },
]

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// ── HLS プレーヤー（1 カメラ分） ─────────────────────────────────
function HlsVideoPanel({
  cam, hlsUrl, playing, onDurationChange,
}: {
  cam: CameraInfo
  hlsUrl: string
  playing: boolean
  onDurationChange?: (d: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!videoRef.current || !hlsUrl) return

    let hlsInstance: unknown = null

    const load = async () => {
      const Hls = (await import('hls.js')).default
      if (!Hls.isSupported()) {
        // Safari native HLS
        if (videoRef.current) videoRef.current.src = hlsUrl
        return
      }
      const hls = new Hls()
      hlsInstance = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(videoRef.current!)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (onDurationChange && videoRef.current) {
          onDurationChange(videoRef.current.duration || 0)
        }
      })
    }

    load()

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (hlsInstance) (hlsInstance as any).destroy?.()
    }
  }, [hlsUrl, onDurationChange])

  useEffect(() => {
    if (!videoRef.current) return
    if (playing) {
      videoRef.current.play().catch(() => {})
    } else {
      videoRef.current.pause()
    }
  }, [playing])

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        muted
      />
      <div className="absolute top-2 left-2 text-[10px] text-white/80 font-mono bg-black/50 rounded px-2 py-0.5 leading-tight">
        🔴 LIVE · カメラ{cam.slot} · {cam.label}
      </div>
    </div>
  )
}

// ── モックパネル（VMS 未設定） ─────────────────────────────────────
function MockCameraPanel({
  cam, position, playing, speed,
}: {
  cam: CameraInfo
  position: number
  playing: boolean
  speed: number
}) {
  return (
    <div className="relative aspect-video bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 rounded-xl overflow-hidden">
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="absolute top-2 left-2 text-[10px] text-white/80 font-mono bg-black/50 rounded px-2 py-0.5 leading-tight">
        🔴 REC · カメラ{cam.slot} · {cam.label}
      </div>
      <div className="absolute top-2 right-2 text-[10px] text-white/80 font-mono bg-black/50 rounded px-2 py-0.5 tabular-nums">
        {new Date(Date.now() - (MOCK_DURATION_SEC - position) * 1000).toLocaleString('ja-JP')}
      </div>
      <div className="absolute bottom-2 right-2 text-[10px] text-white/60 font-mono">
        {playing ? `▶ ×${speed}` : '⏸'}
      </div>
      <div className="absolute bottom-2 left-2 text-[9px] text-white/40 font-mono">
        HLS: /recordings/{cam.cameraId}-{position}/stream.m3u8
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className={`w-16 h-16 rounded-full border-2 border-white/40 flex items-center justify-center text-2xl text-white/70 ${playing ? 'bg-white/5' : 'bg-black/20'}`}>
          {playing ? '⏸' : '▶'}
        </div>
      </div>
    </div>
  )
}

// ── メイン ────────────────────────────────────────────────────────
export default function BaggageRecordingPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const visitId = searchParams.get('visitId')

  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(120)
  const [speed, setSpeed] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const [duration, setDuration] = useState(MOCK_DURATION_SEC)
  const [cameras, setCameras] = useState<CameraInfo[]>([])
  const [hlsUrl, setHlsUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timelineRef = useRef<HTMLDivElement>(null)

  const hasVms = Boolean(hlsUrl)

  // Load declaration + camera info
  useEffect(() => {
    if (!id) return

    fetch(`/api/v1/admin/baggage/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (data.vms_hls_url) setHlsUrl(data.vms_hls_url)
        if (data.cameras?.length) {
          setCameras(data.cameras.map((c: CameraInfo) => ({
            ...c,
            hlsUrl: data.vms_hls_url,
          })))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  // Fallback mock cameras if none loaded
  const displayCameras: CameraInfo[] = cameras.length > 0 ? cameras : [
    { slot: 1, label: '受付カウンター',   cameraId: 'ipro-cam-001' },
    { slot: 2, label: '手荷物検査デスク', cameraId: 'ipro-cam-002' },
  ]

  const posPct = (position / duration) * 100

  const fireToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    setPosition(Math.max(0, Math.min(duration, pct * duration)))
  }

  const handleDownloadAll = () => {
    if (hasVms) {
      fireToast('📥 VMS から録画を取得します（GET /recordings）')
    } else {
      fireToast('📥 両カメラの録画を MP4 に変換してダウンロード（i-PRO Remo 接続後に有効）')
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* ── ヘッダ ───────────────────────────────────────────── */}
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
            {!hasVms && (
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
                🚧 モック（VMS / i-PRO 未設定）
              </span>
            )}
            {hasVms && (
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                ✅ VMS 接続中
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-[var(--ge-accent)]">録画再生 · 手荷物申告 #{id.slice(0, 8)}</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
          <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
          読み込み中...
        </div>
      ) : (
        <>
          {/* ── カメラ 2 枚ビュー ───────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
              {displayCameras.map(cam => (
                <div key={cam.slot} className="relative">
                  {hasVms && cam.hlsUrl ? (
                    <HlsVideoPanel
                      cam={cam}
                      hlsUrl={cam.hlsUrl}
                      playing={playing}
                      onDurationChange={d => { if (d > 0) setDuration(d) }}
                    />
                  ) : (
                    <MockCameraPanel cam={cam} position={position} playing={playing} speed={speed} />
                  )}
                  <button
                    onClick={() => fireToast(`📥 カメラ${cam.slot}: ${cam.label} の録画をダウンロード`)}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/90 text-[11px] text-[var(--ge-accent)] font-medium shadow hover:bg-white"
                  >
                    📥 MP4 で取得
                  </button>
                </div>
              ))}
            </div>

            {/* ── 共有タイムライン・コントロール ─────────────── */}
            <div className="px-4 py-4 border-t border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => setPosition(Math.max(0, position - 10))}
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
                  onClick={() => setPosition(Math.min(duration, position + 10))}
                  className="w-9 h-9 rounded-full border border-gray-200 hover:bg-gray-50 text-sm"
                  title="10秒進む"
                >⏭</button>
                {!hasVms && (
                  <div className="flex items-center gap-1 ml-2">
                    {[0.5, 1, 2, 4].map(s => (
                      <button
                        key={s}
                        onClick={() => setSpeed(s)}
                        className={`px-2 py-1 text-xs rounded-md ${speed === s ? 'bg-[var(--ge-accent)] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                      >×{s}</button>
                    ))}
                  </div>
                )}
                <span className="ml-2 text-[11px] text-gray-400">※ 両カメラ同期</span>
                <div className="flex-1" />
                <div className="text-xs text-gray-500 font-mono tabular-nums">
                  {fmtClock(position)} / {fmtClock(duration)}
                </div>
              </div>

              {/* シークバー */}
              <div
                ref={timelineRef}
                onClick={handleSeek}
                className="relative h-8 bg-gray-100 rounded-lg cursor-pointer"
              >
                <div className="absolute inset-y-0 left-0 bg-[var(--ge-accent)]/20 rounded-lg" style={{ width: `${posPct}%` }} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--ge-accent)]" style={{ left: `${posPct}%` }} />
                {MOCK_EVENTS.map(ev => (
                  <div
                    key={ev.label}
                    className="absolute top-0 bottom-0 w-1 group/ev"
                    style={{ left: `${(ev.t / duration) * 100}%` }}
                  >
                    <div className={`absolute inset-0 ${ev.color}`} />
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] bg-gray-800 text-white px-1.5 py-0.5 rounded opacity-0 group-hover/ev:opacity-100 transition-opacity">
                      {ev.label} · {fmtClock(ev.t)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 flex-wrap mt-3 text-[11px] text-gray-500">
                {MOCK_EVENTS.map(ev => (
                  <button
                    key={ev.label}
                    onClick={() => setPosition(ev.t)}
                    className="flex items-center gap-1.5 hover:text-gray-800 transition-colors"
                  >
                    <span className={`w-2 h-2 ${ev.color} rounded-full`} />
                    {ev.label}（{fmtClock(ev.t)}）
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── 下段: 操作 + 接続情報 ──────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">操作</p>
              <button
                onClick={handleDownloadAll}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[var(--ge-accent)] text-white rounded-xl text-sm font-medium hover:bg-[var(--ge-accent-ink)]"
              >
                📥 両カメラをまとめて MP4 ダウンロード
              </button>
              <button
                onClick={() => fireToast('📎 両カメラのスナップショットを申告レコードに添付')}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
              >
                📎 現在フレームを両カメラ分添付
              </button>
              <button
                onClick={() => fireToast(`🔖 ブックマーク: ${fmtClock(position)}`)}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
              >
                🔖 現在位置にブックマーク
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {hasVms ? 'VMS 接続情報' : 'カメラ接続'}
              </p>
              <dl className="text-xs space-y-1.5">
                {hasVms ? (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-400">HLS URL</dt>
                      <dd className="font-mono text-gray-700 truncate max-w-[140px]" title={hlsUrl || ''}>
                        {hlsUrl?.replace(/^https?:\/\/[^/]+/, '...')}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-400">カメラ数</dt>
                      <dd className="font-mono text-gray-700">{displayCameras.length} / 2 台</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-400">Status</dt>
                      <dd>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium">接続中</span>
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-400">VMS</dt>
                      <dd><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">未設定</span></dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-400">i-PRO Remo</dt>
                      <dd><span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px]">未接続</span></dd>
                    </div>
                    <div className="text-gray-400 mt-2 text-[10px]">
                      店舗設定のカメラ接続タブで VMS または i-PRO を設定してください
                    </div>
                  </>
                )}
              </dl>
            </div>

            {!hasVms && (
              <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 text-[11px] text-amber-900 space-y-1.5">
                <p className="font-semibold">📝 VMS 接続時の差し替え</p>
                <ul className="list-disc list-inside space-y-1 opacity-90">
                  <li>店舗設定 → カメラ接続 → VMS タブを設定</li>
                  <li>検査モード &quot;映像&quot; で申告すると自動で録画開始</li>
                  <li>申告完了後にこの画面に HLS URL が反映される</li>
                  <li>VMS API: <code>POST /inspections</code> → <code>hls_url</code></li>
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Toast ───────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ge-accent)] text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
