'use client'

/**
 * i-PRO Remo 連携 録画ビューアー（モック）
 *
 * 仕様:
 *  - 1 店舗あたり最大 2 カメラを常時 横並び で表示
 *  - 両カメラは同一タイムコードで同期再生（シーク・再生・速度変更は一括）
 *  - 現地レコーダに保存された録画を Cloud 経由で取得して再生
 *
 * Integration spec:
 *  - Cloud API:  https://remo.i-pro.com/cloudapi/v1
 *  - Auth:       OAuth2 client-credentials (clientId/secret tenant単位)
 *  - Endpoints:  GET /cameras, GET /cameras/{id}/recordings?from&to,
 *                GET /recordings/{recId}/stream (HLS m3u8),
 *                GET /recordings/{recId}/download (mp4 非同期変換)
 *
 * このページはデモ用のモックで実カメラには接続しません。
 * 本番化時の置き換えポイントは ★ コメントで明示しています。
 */

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'

type MockCamera = { slot: 1 | 2; label: string; model: string; cameraId: string }
type EventMarker = { t: number; label: string; color: string }

// ★ 本番では store_cameras テーブルから該当店舗の 2 台を取得
const MOCK_CAMERAS: MockCamera[] = [
  { slot: 1, label: '受付カウンター',   model: 'WV-S1536LN  2688×1520', cameraId: 'ipro-cam-001' },
  { slot: 2, label: '手荷物検査デスク', model: 'WV-X2531LN  1920×1080', cameraId: 'ipro-cam-002' },
]

const MOCK_DURATION_SEC = 600 // 申告時刻の前後 5 分
const MOCK_EVENTS: EventMarker[] = [
  { t: 60,  label: '入室',       color: 'bg-purple-500' },
  { t: 120, label: '手荷物申告', color: 'bg-amber-500'  },
  { t: 185, label: '撮影',       color: 'bg-blue-500'   },
  { t: 340, label: 'スタッフ審査', color: 'bg-emerald-500' },
  { t: 510, label: '退室',       color: 'bg-orange-500' },
]

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// ── 映像プレースホルダ（カメラ1枚分） ─────────────────────────
function CameraPanel({
  cam, position, playing, speed,
}: {
  cam: MockCamera
  position: number
  playing: boolean
  speed: number
}) {
  return (
    <div className="relative aspect-video bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 rounded-xl overflow-hidden">
      {/* 格子 */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* 左上: カメラ名 */}
      <div className="absolute top-2 left-2 text-[10px] text-white/80 font-mono bg-black/50 rounded px-2 py-0.5 leading-tight">
        🔴 REC · カメラ{cam.slot} · {cam.label}
        <div className="text-white/50 text-[9px]">{cam.model}</div>
      </div>
      {/* 右上: 時刻 */}
      <div className="absolute top-2 right-2 text-[10px] text-white/80 font-mono bg-black/50 rounded px-2 py-0.5 tabular-nums">
        {new Date(Date.now() - (MOCK_DURATION_SEC - position) * 1000).toLocaleString('ja-JP')}
      </div>
      {/* 右下: 再生状態 */}
      <div className="absolute bottom-2 right-2 text-[10px] text-white/60 font-mono">
        {playing ? `▶ ×${speed}` : '⏸'}
      </div>
      {/* 左下: HLS モック表示 */}
      <div className="absolute bottom-2 left-2 text-[9px] text-white/40 font-mono">
        HLS: /recordings/{cam.cameraId}-{position}/stream.m3u8
      </div>
      {/* 中央の再生アイコン */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className={`w-16 h-16 rounded-full border-2 border-white/40 flex items-center justify-center text-2xl text-white/70 ${playing ? 'bg-white/5' : 'bg-black/20'}`}>
          {playing ? '⏸' : '▶'}
        </div>
      </div>
    </div>
  )
}

// ── メイン ────────────────────────────────────────────────────
export default function BaggageRecordingPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const visitId = searchParams.get('visitId')
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(120) // 手荷物申告時点でスタート
  const [speed, setSpeed] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const posPct = (position / MOCK_DURATION_SEC) * 100

  const fireToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    setPosition(Math.max(0, Math.min(MOCK_DURATION_SEC, pct * MOCK_DURATION_SEC)))
  }

  // ★ 本番では両カメラ分の /recordings/{id}/download を並列で呼び、ZIP でまとめる
  const handleDownloadAll = () => {
    fireToast('📥 両カメラの録画を MP4 に変換してダウンロード（本番では /recordings/{id}/download ×2 を並列実行）')
  }

  const handleDownloadCam = (cam: MockCamera) => {
    fireToast(`📥 ${cam.label} の録画を MP4 でダウンロード（cameraId: ${cam.cameraId}）`)
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
            <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
              🚧 モック（i-PRO Remo 未接続）
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--ge-accent)]">録画再生 · 手荷物申告 #{id.slice(0, 8)}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            現地レコーダに保存された両カメラの録画を、同一タイムコードで同時再生できます
          </p>
        </div>
      </div>

      {/* ── カメラ 2 枚ビュー ───────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
          {MOCK_CAMERAS.map(cam => (
            <div key={cam.slot} className="relative">
              <CameraPanel cam={cam} position={position} playing={playing} speed={speed} />
              <button
                onClick={() => handleDownloadCam(cam)}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/90 text-[11px] text-[var(--ge-accent)] font-medium shadow hover:bg-white"
                title={`${cam.label} のみダウンロード`}
              >
                📥 このカメラを MP4 で取得
              </button>
            </div>
          ))}
        </div>

        {/* ── 共有タイムライン・コントロール ───────────────── */}
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
              title={playing ? '一時停止（両カメラ）' : '再生（両カメラ同時）'}
            >{playing ? '⏸' : '▶'}</button>
            <button
              onClick={() => setPosition(Math.min(MOCK_DURATION_SEC, position + 10))}
              className="w-9 h-9 rounded-full border border-gray-200 hover:bg-gray-50 text-sm"
              title="10秒進む"
            >⏭</button>
            <div className="flex items-center gap-1 ml-2">
              {[0.5, 1, 2, 4].map(s => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-1 text-xs rounded-md ${speed === s ? 'bg-[var(--ge-accent)] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                >×{s}</button>
              ))}
            </div>
            <span className="ml-2 text-[11px] text-gray-400">※ 両カメラ同期再生</span>
            <div className="flex-1" />
            <div className="text-xs text-gray-500 font-mono tabular-nums">
              {fmtClock(position)} / {fmtClock(MOCK_DURATION_SEC)}
            </div>
          </div>

          {/* シークバー + イベントマーカー */}
          <div
            ref={timelineRef}
            onClick={handleSeek}
            className="relative h-8 bg-gray-100 rounded-lg cursor-pointer group"
          >
            <div
              className="absolute inset-y-0 left-0 bg-[var(--ge-accent)]/20 rounded-lg"
              style={{ width: `${posPct}%` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[var(--ge-accent)]"
              style={{ left: `${posPct}%` }}
            />
            {MOCK_EVENTS.map(ev => (
              <div
                key={ev.label}
                className="absolute top-0 bottom-0 w-1 group/ev"
                style={{ left: `${(ev.t / MOCK_DURATION_SEC) * 100}%` }}
              >
                <div className={`absolute inset-0 ${ev.color}`} />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] bg-gray-800 text-white px-1.5 py-0.5 rounded opacity-0 group-hover/ev:opacity-100 transition-opacity">
                  {ev.label} · {fmtClock(ev.t)}
                </div>
              </div>
            ))}
          </div>

          {/* イベント凡例（クリックで両カメラが同時ジャンプ） */}
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

      {/* ── 下段: 操作 + 接続情報 ─────────────────────────── */}
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
            onClick={() => fireToast('📎 両カメラのスナップショットを申告レコードに添付（モック）')}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
          >
            📎 現在フレームを両カメラ分添付
          </button>
          <button
            onClick={() => fireToast(`🔖 ブックマーク: ${fmtClock(position)}（両カメラ同期）`)}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
          >
            🔖 現在位置にブックマーク
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">i-PRO Remo 接続</p>
          <dl className="text-xs space-y-1.5">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">Endpoint</dt>
              <dd className="font-mono text-gray-700 truncate">remo.i-pro.com</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">Tenant</dt>
              <dd className="font-mono text-gray-700">—（未設定）</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">この店舗のカメラ</dt>
              <dd className="font-mono text-gray-700">{MOCK_CAMERAS.length} / 2 台</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">録画保管元</dt>
              <dd className="font-mono text-gray-700">現地レコーダ</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">Status</dt>
              <dd>
                <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-medium">未接続</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 text-[11px] text-amber-900 space-y-1.5">
          <p className="font-semibold">📝 本番接続時の差し替え</p>
          <ul className="list-disc list-inside space-y-1 opacity-90">
            <li>カメラ登録: <code>store_cameras</code>（1店舗最大2台）</li>
            <li>録画検索: <code>GET /cameras/{`{id}`}/recordings?from=&to=</code></li>
            <li>再生URL: <code>GET /recordings/{`{recId}`}/stream</code>（HLS）</li>
            <li>MP4出力: <code>GET /recordings/{`{recId}`}/download</code> × 2</li>
            <li>同期再生: 共有 currentTime を両 <code>&lt;video&gt;</code> に反映</li>
            <li>認証: OAuth2 client_credentials（テナント単位）</li>
          </ul>
        </div>
      </div>

      {/* ── Toast ────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ge-accent)] text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
