'use client'

/**
 * /admin/cameras/live?storeId=<uuid>
 *
 * VMS オンプレミス接続のライブカメラ映像確認画面。
 * GET /api/v1/admin/stores/:id/live-cameras から HLS URL を取得し、
 * HLS.js で映像を表示する。映像確認・接続テスト用途。
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

type SlotCamera = {
  slot: 1 | 2
  label: string
  camera_id: string | null
  hls_url: string | null
  error: string | null
}

type LiveData = {
  store: { id: string; name: string }
  vms_connected: boolean
  vms_url: string | null
  cameras: SlotCamera[]
  fetched_at: string
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── ライブ HLS パネル ───────────────────────────────────────────────────────
function LivePanel({
  cam,
  key: _key,
}: {
  cam: SlotCamera
  key: number
}) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const hlsRef    = useRef<unknown>(null)
  const [err, setErr]     = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!cam.hls_url || !videoRef.current) return

    setErr(null)
    setLoaded(false)

    let destroyed = false

    const load = async () => {
      const Hls = (await import('hls.js')).default

      if (destroyed) return

      // Safari / iOS の native HLS
      if (!Hls.isSupported() && videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = cam.hls_url!
        videoRef.current.play().catch(() => {})
        setLoaded(true)
        return
      }

      if (!Hls.isSupported()) {
        setErr('この環境では HLS 再生がサポートされていません')
        return
      }

      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
      })
      hlsRef.current = hls

      hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal?: boolean; type?: string }) => {
        if (data.fatal) {
          setErr(`再生エラー (${data.type ?? 'unknown'})`)
          hls.destroy()
        }
      })

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoaded(true)
        videoRef.current?.play().catch(() => {})
      })

      hls.loadSource(cam.hls_url!)
      hls.attachMedia(videoRef.current!)
    }

    load()

    return () => {
      destroyed = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = hlsRef.current as any
      h?.destroy?.()
      hlsRef.current = null
    }
  }, [cam.hls_url])

  return (
    <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9' }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: cam.hls_url ? 'block' : 'none' }}
        playsInline
        muted
        autoPlay
      />

      {/* ライブ バッジ */}
      {cam.hls_url && loaded && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '3px 8px',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#ef4444',
            animation: 'livePulse 1.4s ease-in-out infinite',
            display: 'inline-block',
          }} />
          <span style={{ font: '600 10px/1 monospace', color: '#fff', letterSpacing: 1 }}>LIVE</span>
        </div>
      )}

      {/* カメラ情報 */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '3px 7px',
        font: '500 10px/1 monospace', color: 'rgba(255,255,255,0.75)',
      }}>
        カメラ{cam.slot} · {cam.label}
        {cam.camera_id && <><br /><span style={{ opacity: 0.55, fontSize: 9 }}>{cam.camera_id}</span></>}
      </div>

      {/* ローディング */}
      {cam.hls_url && !loaded && !err && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 10, background: '#111',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            border: '2px solid #ef4444', borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ font: '400 11px/1 sans-serif', color: 'rgba(255,255,255,0.5)' }}>接続中...</span>
        </div>
      )}

      {/* エラー or 未設定 */}
      {(!cam.hls_url || err) && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8,
          background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
        }}>
          <span style={{ fontSize: 28, opacity: 0.5 }}>📷</span>
          <p style={{ font: '500 12px/1.4 sans-serif', color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '0 16px', margin: 0 }}>
            {err ?? cam.error ?? '映像なし'}
          </p>
        </div>
      )}
    </div>
  )
}

// ── メイン ─────────────────────────────────────────────────────────────────────
export default function LiveCameraPage() {
  const searchParams = useSearchParams()
  const storeId      = searchParams.get('storeId')

  const [data, setData]       = useState<LiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)   // HLS パネルを再マウントする
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [nextRefreshSec, setNextRefreshSec] = useState(30)

  const fetchLive = useCallback(async (isManual = false) => {
    if (!storeId) return
    if (isManual) setLoading(true)
    setLoadErr(null)

    try {
      const res = await fetch(`/api/v1/admin/stores/${storeId}/live-cameras`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d: LiveData = await res.json()
      setData(d)
      setRefreshKey(k => k + 1)
      setNextRefreshSec(30)
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : '取得失敗')
    } finally {
      setLoading(false)
    }
  }, [storeId])

  // 初回ロード
  useEffect(() => { fetchLive() }, [fetchLive])

  // 30 秒自動更新
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setNextRefreshSec(s => {
        if (s <= 1) {
          fetchLive()
          return 30
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchLive])

  if (!storeId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: '#6b7280' }}>
        storeId が指定されていません
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      {/* CSS アニメーション */}
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── ヘッダ ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', marginBottom: 6 }}>
            <Link href="/admin/stores" style={{ color: 'inherit', textDecoration: 'none' }}>店舗設定</Link>
            <span>›</span>
            <span>ライブ映像</span>
          </div>
          <h1 style={{ font: '700 22px/1 var(--font-sans)', color: 'var(--ge-accent)', margin: 0 }}>
            🔴 ライブ映像
            {data?.store?.name && (
              <span style={{ font: '400 14px/1 var(--font-sans)', color: 'var(--ge-ink-3)', marginLeft: 10 }}>
                {data.store.name}
              </span>
            )}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* VMS ステータス */}
          {data && (
            <span style={{
              padding: '3px 10px', borderRadius: 20,
              font: '500 11px/1 var(--font-sans)',
              background: data.vms_connected ? '#f0fdf4' : '#f3f4f6',
              color: data.vms_connected ? '#15803d' : '#6b7280',
            }}>
              {data.vms_connected ? '✅ VMS 接続済' : '⚠️ VMS 未接続'}
            </span>
          )}

          {/* 更新ボタン */}
          <button
            onClick={() => fetchLive(true)}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 6, cursor: loading ? 'default' : 'pointer',
              font: '500 12px/1 var(--font-sans)', color: '#fff',
              background: 'var(--ge-accent)', border: 'none', opacity: loading ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading
              ? <><span style={{ width: 12, height: 12, border: '1.5px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />取得中...</>
              : <>↻ 映像を更新</>
            }
          </button>
        </div>
      </div>

      {/* 更新タイマー */}
      {!loading && data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, font: '400 11px/1 var(--font-mono)', color: 'var(--ge-ink-4)' }}>
          <span>最終取得: {fmtTime(data.fetched_at)}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>次の自動更新まで {nextRefreshSec}s</span>
          {data.vms_url && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{data.vms_url}</span>
            </>
          )}
        </div>
      )}

      {/* エラー */}
      {loadErr && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', font: '400 12px/1.5 var(--font-sans)', marginBottom: 16 }}>
          ⚠️ {loadErr}
        </div>
      )}

      {/* ── カメラグリッド ─────────────────────────────────────── */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12, marginBottom: 20 }}>
          {data.cameras.map((cam) => (
            <LivePanel key={cam.slot + refreshKey * 10} cam={cam} />
          ))}
        </div>
      )}

      {/* スケルトン */}
      {loading && !data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[1, 2].map(i => (
            <div key={i} style={{
              aspectRatio: '16/9', background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #ef4444', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ))}
        </div>
      )}

      {/* VMS 未設定ガイド */}
      {data && !data.vms_connected && (
        <div style={{
          padding: '16px 18px', borderRadius: 10,
          background: '#fffbeb', border: '1px solid #fde68a',
          font: '400 12px/1.6 var(--font-sans)', color: '#92400e',
        }}>
          <p style={{ font: '600 13px/1 var(--font-sans)', margin: '0 0 8px' }}>📝 映像を表示するには</p>
          <ol style={{ margin: 0, paddingLeft: 18, listStyle: 'decimal' }}>
            <li>店舗設定 → カメラ タブ → <strong>VMS 有効</strong> をオンにする</li>
            <li>VMS URL と API Key を入力して <strong>保存</strong></li>
            <li>カメラID（スロット1・2）を入力して保存</li>
            <li>このページを再読み込みすると映像が表示されます</li>
          </ol>
          <div style={{ marginTop: 12 }}>
            <Link
              href={`/admin/stores?tab=cameras&storeId=${storeId}`}
              style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--ge-accent)', textDecoration: 'none' }}
            >
              → カメラ設定を開く
            </Link>
          </div>
        </div>
      )}

      {/* カメラ接続詳細 */}
      {data && data.vms_connected && (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--ge-line)', padding: '16px 18px' }}>
          <p style={{ font: '600 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 10px' }}>カメラ接続状態</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {data.cameras.map(cam => (
              <div key={cam.slot} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <p style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)', margin: 0 }}>
                  カメラ{cam.slot} · {cam.label}
                </p>
                {cam.camera_id ? (
                  <>
                    <p style={{ font: '400 10px/1 monospace', color: 'var(--ge-ink-3)', margin: 0 }}>{cam.camera_id}</p>
                    {cam.hls_url
                      ? <span style={{ font: '500 10px/1 var(--font-sans)', color: '#15803d' }}>✅ ライブ取得成功</span>
                      : <span style={{ font: '400 10px/1.4 var(--font-sans)', color: '#dc2626' }}>⚠️ {cam.error}</span>
                    }
                  </>
                ) : (
                  <span style={{ font: '400 10px/1 var(--font-sans)', color: '#9ca3af' }}>カメラID 未設定</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
