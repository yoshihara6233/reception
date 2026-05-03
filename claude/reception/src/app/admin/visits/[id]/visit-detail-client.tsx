'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

// ── 録画ビューアー型定義 ──────────────────────────────────────────────────────

type CameraInfo = {
  slot: number
  label: string
  cameraId: string
  hlsUrl: string | null
}

type DeclarationData = {
  id: string
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

function wallClockTime(inspectionStartedIso: string | null, positionSec: number): string {
  if (!inspectionStartedIso) return fmtTime(positionSec)
  const dt = new Date(new Date(inspectionStartedIso).getTime() + positionSec * 1000)
  return dt.toLocaleString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function wallClockFull(inspectionStartedIso: string | null, positionSec: number): string {
  if (!inspectionStartedIso) return fmtTime(positionSec)
  const dt = new Date(new Date(inspectionStartedIso).getTime() + positionSec * 1000)
  return dt.toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

// ── HLS プレーヤーパネル ──────────────────────────────────────────────────────

function HlsVideoPanel({
  cam, hlsUrl, playing, seekCmd, inspectionStartedIso, onDurationChange, onTimeUpdate,
}: {
  cam: CameraInfo
  hlsUrl: string
  playing: boolean
  seekCmd?: { to: number; v: number }
  inspectionStartedIso: string | null
  onDurationChange?: (d: number) => void
  onTimeUpdate?: (t: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)

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
        if (videoRef.current) onDurationChange?.(videoRef.current.duration || 0)
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
    if (seekCmd === undefined || !videoRef.current) return
    videoRef.current.currentTime = seekCmd.to
  }, [seekCmd])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const handler = () => {
      setCurrentTime(v.currentTime)
      onTimeUpdate?.(v.currentTime)
    }
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
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 rounded px-2.5 py-1">
        {playing && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />}
        <span className="text-white font-mono text-xs tabular-nums tracking-wide">
          {wallClockTime(inspectionStartedIso, currentTime)}
        </span>
      </div>
    </div>
  )
}

// ── カメラ未設定パネル ────────────────────────────────────────────────────────

function NoCameraPanel({ cam, reason }: { cam: CameraInfo; reason: string }) {
  return (
    <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl overflow-hidden flex flex-col items-center justify-center gap-2">
      <span className="text-3xl">📷</span>
      <p className="text-sm font-medium text-gray-600">カメラ{cam.slot} · {cam.label}</p>
      <p className="text-xs text-gray-400 text-center px-4">{reason}</p>
    </div>
  )
}

// ── インライン録画ビューアー ──────────────────────────────────────────────────

function InlineRecordingViewer({ baggageId, visitId }: { baggageId: string; visitId: string }) {
  const [data, setData]       = useState<DeclarationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [playing, setPlaying]   = useState(false)
  const [position, setPosition] = useState(0)
  const [seekCmd, setSeekCmd]   = useState<{ to: number; v: number } | undefined>(undefined)
  const seekingRef = useRef(false)
  const [duration, setDuration] = useState(0)
  const [toast, setToast]       = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const fireToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    fetch(`/api/v1/admin/baggage/${baggageId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: DeclarationData) => setData(d))
      .catch(() => setLoadErr('録画情報の読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [baggageId])

  const cameras: CameraInfo[] = data?.cameras?.length
    ? data.cameras
    : [
        { slot: 1, label: '受付カウンター',   cameraId: '', hlsUrl: null },
        { slot: 2, label: '手荷物検査デスク', cameraId: '', hlsUrl: null },
      ]

  const anyHls         = cameras.some(c => c.hlsUrl)
  const vmsConnected   = data?.vms_connected ?? false
  const inspectionStarted = data?.inspection_started_at ?? null

  const posPct = duration > 0 ? (position / duration) * 100 : 0

  const seek = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(duration || 0, target))
    seekingRef.current = true
    setPosition(clamped)
    setSeekCmd(prev => ({ to: clamped, v: (prev?.v ?? 0) + 1 }))
    setTimeout(() => { seekingRef.current = false }, 200)
  }, [duration])

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !duration) return
    const rect = timelineRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(pct * duration)
  }

  const onTimeUpdate = useCallback((t: number) => {
    if (!seekingRef.current) setPosition(t)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        録画情報を読み込み中...
      </div>
    )
  }

  if (loadErr) {
    return <div className="py-4 text-sm text-red-500">{loadErr}</div>
  }

  return (
    <div className="space-y-2">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {anyHls ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium">
              ✅ 映像あり
            </span>
          ) : vmsConnected ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
              ⚠️ 録画なし
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
              📷 VMS 未設定
            </span>
          )}
          {inspectionStarted && (
            <span className="text-[10px] text-gray-400 font-mono">
              {new Date(inspectionStarted).toLocaleString('ja-JP', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}〜
            </span>
          )}
        </div>
        <Link
          href={`/admin/baggage/${baggageId}/recording?visitId=${visitId}`}
          target="_blank"
          className="text-xs text-[var(--ge-accent)] hover:underline"
        >
          別画面で開く ↗
        </Link>
      </div>

      {/* カメラ映像 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {cameras.map(cam => (
          <div key={cam.slot} className="relative">
            {cam.hlsUrl ? (
              <HlsVideoPanel
                cam={cam}
                hlsUrl={cam.hlsUrl}
                playing={playing}
                seekCmd={seekCmd}
                inspectionStartedIso={inspectionStarted}
                onDurationChange={d => { if (d > 0) setDuration(d) }}
                onTimeUpdate={onTimeUpdate}
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
          </div>
        ))}
      </div>

      {/* 再生コントロール */}
      {anyHls ? (
        <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => seek(position - 10)}
              className="w-8 h-8 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-sm flex items-center justify-center"
              title="10秒戻る"
            >⏮</button>
            <button
              onClick={() => setPlaying(p => !p)}
              className="w-10 h-10 rounded-full bg-[var(--ge-accent)] text-white text-base hover:bg-[var(--ge-accent-ink)] flex items-center justify-center"
            >{playing ? '⏸' : '▶'}</button>
            <button
              onClick={() => seek(position + 10)}
              className="w-8 h-8 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-sm flex items-center justify-center"
              title="10秒進む"
            >⏭</button>
            <span className="text-[10px] text-gray-400">両カメラ同期</span>
            {inspectionStarted && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg ml-1">
                <span className="text-[10px] text-gray-400">再生時刻</span>
                <span className="text-xs font-mono font-semibold text-gray-800 tabular-nums">
                  {wallClockFull(inspectionStarted, position)}
                </span>
              </div>
            )}
            <div className="flex-1" />
            <span className="text-xs text-gray-500 font-mono tabular-nums">
              {fmtTime(position)} / {duration > 0 ? fmtTime(duration) : '--:--'}
            </span>
          </div>

          {/* シークバー */}
          <div
            ref={timelineRef}
            onClick={handleSeek}
            className="relative h-7 bg-gray-200 rounded-lg cursor-pointer"
          >
            <div className="absolute inset-y-0 left-0 bg-[var(--ge-accent)]/20 rounded-lg" style={{ width: `${posPct}%` }} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--ge-accent)]" style={{ left: `${posPct}%` }} />
            {inspectionStarted && duration > 0 && (
              <div
                className="absolute -top-5 text-[10px] font-mono text-[var(--ge-accent)] whitespace-nowrap -translate-x-1/2 pointer-events-none"
                style={{ left: `${posPct}%` }}
              >
                {wallClockTime(inspectionStarted, position)}
              </div>
            )}
          </div>
          {inspectionStarted && (
            <div className="flex justify-between text-[10px] text-gray-400 font-mono px-0.5">
              <span>{new Date(inspectionStarted).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              {duration > 0 && <span>{wallClockFull(inspectionStarted, duration)}</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100 text-xs text-amber-900">
          <span className="text-base mt-0.5">📝</span>
          <div>
            <p className="font-semibold mb-1">映像を表示するには</p>
            <ol className="list-decimal list-inside space-y-0.5 opacity-90">
              <li>店舗設定 → カメラ タブ → VMS URL と API Key を登録</li>
              <li>カメラID — スロット2（手荷物）にカメラIDを入力して保存</li>
              <li>エリア設定で検査モードを「映像」に変更</li>
            </ol>
          </div>
        </div>
      )}

      {/* VMS 接続情報 */}
      <div className="bg-white rounded-xl border border-gray-100 p-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">カメラ接続情報</p>
        <dl className="text-[11px] space-y-1">
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
        </dl>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ge-accent)] text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── 型定義 ────────────────────────────────────────────────────────────────────

interface VisitInfo {
  purpose: string
  storeName?: string
  areaName?: string
  checkInAt: string
  checkOutAt?: string | null
  phone?: string
  email?: string
  status: string
}

interface Photo {
  id: string
  type: string
  signedUrl: string | null
  ocrResult?: unknown
}

interface BaggageDeclaration {
  id: string
  context: 'checkin' | 'checkout'
  inspection_mode: 'photo' | 'video' | null
  declaration_text: string | null
  status: string
  staff_notes: string | null
  reviewed_at: string | null
  photoContentsUrl: string | null
  photoEmptyUrl: string | null
}

// ── 審査ステータスバッジ ────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '審査待ち', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  flagged:  { label: '🚩 フラグ', cls: 'bg-red-50 text-red-700 border-red-200' },
  cleared:  { label: '✓ 問題なし', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  approved: { label: '✓ 承認',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  rejected: { label: '却下',    cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function BaggageStatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
      {s.label}
    </span>
  )
}

function VisitStatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    checked_in:  'bg-emerald-50 text-emerald-700',
    checked_out: 'bg-gray-100 text-gray-600',
    auto_closed: 'bg-yellow-50 text-yellow-700',
  }
  const labelKeys: Record<string, string> = {
    checked_in:  'admin.statusCheckedIn',
    checked_out: 'admin.statusCheckedOut',
    auto_closed: 'admin.statusAutoClosed',
  }
  return (
    <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${styles[status] || ''}`}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  )
}

// ── 手荷物写真パネル ────────────────────────────────────────────────────────

function BaggagePhotoPanel({ label, url, placeholder }: {
  label: string; url: string | null; placeholder: string
}) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs text-gray-400 font-medium mb-1.5">{label}</p>
      <div className="rounded-xl overflow-hidden bg-gray-100 aspect-[4/3] relative">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs flex-col gap-1">
            <span className="text-2xl opacity-30">📦</span>
            <span>{placeholder}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 審査コントロール ────────────────────────────────────────────────────────

function BaggageReviewControls({
  baggageId, currentStatus, staffNotes: initNotes, reviewedAt, onUpdated,
}: {
  baggageId: string
  currentStatus: string
  staffNotes: string | null
  reviewedAt: string | null
  onUpdated: (status: string, notes: string) => void
}) {
  const [status, setStatus] = useState(currentStatus)
  const [notes, setNotes]   = useState(initNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [open, setOpen]     = useState(false)

  const handleSave = async (newStatus: string) => {
    setSaving(true)
    try {
      await fetch(`/api/v1/admin/baggage/${baggageId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, staff_notes: notes || null }),
      })
      setStatus(newStatus)
      onUpdated(newStatus, notes)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <BaggageStatusBadge status={status} />
        {reviewedAt && (
          <span className="text-xs text-gray-400">
            {new Date(reviewedAt).toLocaleDateString('ja-JP')} 審査済
          </span>
        )}
        <button
          onClick={() => setOpen(v => !v)}
          className="text-xs text-[#1e3a5f] border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 font-medium"
        >
          {open ? '閉じる' : '審査する'}
        </button>
      </div>

      {open && (
        <div className="mt-3 p-3 bg-gray-50 rounded-xl space-y-3">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="スタッフメモ（任意）"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleSave('cleared')}
              disabled={saving}
              className="flex-1 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-40 transition-colors"
            >
              ✓ 問題なし
            </button>
            <button
              onClick={() => handleSave('flagged')}
              disabled={saving}
              className="flex-1 py-2 bg-red-500 text-white text-sm font-semibold rounded-xl hover:bg-red-600 disabled:opacity-40 transition-colors"
            >
              🚩 フラグ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── メインコンポーネント ────────────────────────────────────────────────────

export function VisitDetailClient({
  visitId,
  visitorName,
  visitorCompany,
  visitInfo,
  photos,
  baggageDeclarations = [],
}: {
  visitId: string
  visitorName: string
  visitorCompany: string
  visitInfo: VisitInfo
  photos: Photo[]
  baggageDeclarations?: BaggageDeclaration[]
}) {
  const { t, locale } = useLocale()
  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'

  const [baggage, setBaggage] = useState(baggageDeclarations)

  const ocrPhoto     = photos.find(p => p.ocrResult)
  const visitorPhotos = photos.filter(p => p.type === 'face' || p.type === 'card')

  const handleBaggageUpdated = (bdId: string, status: string, notes: string) => {
    setBaggage(prev => prev.map(bd =>
      bd.id === bdId
        ? { ...bd, status, staff_notes: notes, reviewed_at: new Date().toISOString() }
        : bd
    ))
  }

  return (
    <div>
      <Link href="/admin/visits" className="inline-flex items-center text-sm text-[#1e3a5f]/60 hover:text-[#1e3a5f] mb-4">
        ← {t('admin.backToVisits')}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">{visitorName}</h1>
          <p className="text-gray-500 mt-1">{visitorCompany}</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/admin/visits/${visitId}/evidence`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0f1a2e] text-white text-xs font-semibold rounded-xl hover:bg-[#1e3a5f] transition-colors shadow-sm"
          >
            🔒 エビデンスPDF出力
          </a>
          <VisitStatusBadge status={visitInfo.status} t={t} />
        </div>
      </div>

      {/* ── 来訪情報 + 写真 ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 来訪情報 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">{t('admin.visitDetail')}</h2>
          <dl className="space-y-3 text-sm">
            <InfoRow label={t('admin.visitPurpose')} value={visitInfo.purpose} />
            <InfoRow label={t('admin.store')}        value={visitInfo.storeName} />
            <InfoRow label={t('admin.area')}         value={visitInfo.areaName} />
            <InfoRow
              label={t('admin.checkInTime')}
              value={new Date(visitInfo.checkInAt).toLocaleString(dateLocale)}
            />
            <InfoRow
              label={t('admin.checkOutTime')}
              value={visitInfo.checkOutAt
                ? new Date(visitInfo.checkOutAt).toLocaleString(dateLocale)
                : '—'}
            />
            {visitInfo.phone && <InfoRow label={t('admin.phone')} value={visitInfo.phone} />}
            {visitInfo.email && <InfoRow label={t('admin.email')} value={visitInfo.email} />}
          </dl>
        </div>

        {/* 来訪者写真（顔・名刺） */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-[#1e3a5f] mb-4">{t('admin.photos')}</h2>
          {visitorPhotos.length === 0 ? (
            <p className="text-gray-400 text-sm">{t('admin.noPhotos')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visitorPhotos.map(photo => {
                const label = photo.type === 'card' ? t('admin.businessCard') : t('admin.facePhoto')
                return (
                  <div key={photo.id} className="rounded-xl overflow-hidden bg-[#f0f2f5] aspect-[4/3] relative">
                    {photo.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.signedUrl} alt={label} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                        {label}
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {ocrPhoto && (
            <div className="mt-4 p-3 bg-[#f0f2f5] rounded-xl">
              <p className="text-xs text-gray-500 mb-2 font-medium">{t('admin.ocrResult')}</p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                {JSON.stringify(ocrPhoto.ocrResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* ── 手荷物検査セクション ─────────────────────────────────────────────── */}
      {baggage.length > 0 && (
        <div className="mt-6 space-y-6">
          {baggage.map(bd => (
            <div key={bd.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* ヘッダー */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-base">🧳</span>
                  <h2 className="font-semibold text-[#1e3a5f]">
                    手荷物検査 — {bd.context === 'checkin' ? '入室時' : '退室時'}
                  </h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    bd.inspection_mode === 'video'
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}>
                    {bd.inspection_mode === 'video' ? '🎥 動画' : '📷 写真'}
                  </span>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5">

                {/* 動画モード: インライン録画ビューアー */}
                {bd.inspection_mode === 'video' ? (
                  <InlineRecordingViewer baggageId={bd.id} visitId={visitId} />
                ) : (
                  /* 写真モード: 手荷物写真インライン */
                  <div className="flex gap-3">
                    <BaggagePhotoPanel label="荷物の内容" url={bd.photoContentsUrl} placeholder="写真なし" />
                    <BaggagePhotoPanel label="バッグ外観（空）" url={bd.photoEmptyUrl} placeholder="写真なし" />
                  </div>
                )}

                {/* 申告内容 */}
                {bd.declaration_text && (
                  <div className="p-3 bg-[#f0f4f8] rounded-xl">
                    <p className="text-xs text-gray-500 mb-1 font-medium">申告内容</p>
                    <p className="text-sm text-gray-700">{bd.declaration_text}</p>
                  </div>
                )}

                {/* 審査コントロール */}
                <BaggageReviewControls
                  baggageId={bd.id}
                  currentStatus={bd.status}
                  staffNotes={bd.staff_notes}
                  reviewedAt={bd.reviewed_at}
                  onUpdated={(status, notes) => handleBaggageUpdated(bd.id, status, notes)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-50 last:border-0">
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-[#1e3a5f] font-medium">{value || '—'}</dd>
    </div>
  )
}
