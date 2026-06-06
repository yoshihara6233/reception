'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreInRange {
  id: string
  name: string
  area_code: string | null
  distanceKm: number
}

interface ZipResult {
  lat: number
  lng: number
  address: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALERT_TYPES = [
  { value: 'earthquake', label: '震度情報',   emoji: '🌏', color: 'border-amber-400 bg-amber-50 text-amber-800' },
  { value: 'tsunami',    label: '津波情報',   emoji: '🌊', color: 'border-blue-400 bg-blue-50 text-blue-800'   },
  { value: 'missile',    label: 'ミサイル情報', emoji: '🚀', color: 'border-red-400 bg-red-50 text-red-800'   },
] as const

const RADIUS_OPTIONS = [1, 3, 5, 10, 20, 30, 50, 100]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKm(km: number) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`
}

function nowLocalStr() {
  const d = new Date()
  d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TestForm() {
  const router = useRouter()

  // Input mode
  const [inputMode, setInputMode] = useState<'zip' | 'coords'>('zip')

  // Zip input
  const [zip, setZip]           = useState('')
  const [zipLoading, setZipLoading] = useState(false)
  const [zipError, setZipError]   = useState<string | null>(null)
  const [zipResult, setZipResult] = useState<ZipResult | null>(null)

  // Coord input (also populated from zip)
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')

  // Radius & preview
  const [radiusKm, setRadiusKm]   = useState(10)
  const [previewing, setPreviewing] = useState(false)
  const [previewStores, setPreviewStores] = useState<StoreInRange[] | null>(null)
  const [previewError, setPreviewError]   = useState<string | null>(null)

  // Alert
  const [alertType,   setAlertType]   = useState<string>('earthquake')
  const [alertIssued, setAlertIssued] = useState(nowLocalStr)

  // Submit
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Geocode zip ─────────────────────────────────────────────────────────────

  const geocodeZip = useCallback(async () => {
    const code = zip.replace(/[^0-9]/g, '')
    if (code.length !== 7) {
      setZipError('7桁の郵便番号を入力してください（例: 1600022）')
      return
    }
    setZipLoading(true)
    setZipError(null)
    setZipResult(null)
    setPreviewStores(null)
    try {
      const res  = await fetch(`/api/geocode?zipcode=${code}`)
      const json = await res.json() as { lat?: number; lng?: number; address?: string; error?: string }
      if (!res.ok) {
        setZipError(json.error ?? '郵便番号の検索に失敗しました')
        return
      }
      if (json.lat == null || json.lng == null) {
        setZipError('座標が取得できませんでした')
        return
      }
      setZipResult({ lat: json.lat, lng: json.lng, address: json.address ?? '' })
      setLatStr(String(json.lat))
      setLngStr(String(json.lng))
      setNoCoordsTried(false)
    } catch {
      setZipError('郵便番号の検索に失敗しました')
    } finally {
      setZipLoading(false)
    }
  }, [zip])

  // ── Preview stores ──────────────────────────────────────────────────────────

  const previewTargetStores = useCallback(async () => {
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (isNaN(lat) || isNaN(lng)) {
      setPreviewError('有効な座標を入力してください')
      return
    }
    setPreviewing(true)
    setPreviewError(null)
    setPreviewStores(null)
    try {
      const url = `/api/bcp/test/stores?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`
      const res  = await fetch(url)
      const json = await res.json() as { stores?: StoreInRange[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setPreviewStores(json.stores ?? [])
    } catch (e) {
      setPreviewError(String(e instanceof Error ? e.message : e))
    } finally {
      setPreviewing(false)
    }
  }, [latStr, lngStr, radiusKm])

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleConfirm() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/bcp/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          lat:          parseFloat(latStr),
          lng:          parseFloat(lngStr),
          radiusKm,
          alertType,
          alertIssuedAt: new Date(alertIssued).toISOString(),
        }),
      })
      const json = await res.json() as {
        eventIds?: { storeId: string; storeName: string; eventId: string }[]
        failed?:   number
        error?:    string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      // All activations failed (RLS / DB error)
      if (!json.eventIds || json.eventIds.length === 0) {
        const reason = json.failed
          ? `全 ${json.failed} 件の店舗でイベント作成に失敗しました。RLS ポリシーまたはデータベースエラーの可能性があります。`
          : '対象店舗が見つかりませんでした。'
        throw new Error(reason)
      }

      // Navigate to the first created event (or BCP list if multiple)
      if (json.eventIds.length === 1) {
        router.push(`/bcp/${json.eventIds[0].eventId}`)
      } else {
        router.push('/bcp')
      }
    } catch (e) {
      setSubmitError(String(e instanceof Error ? e.message : e))
      setSubmitting(false)
      setConfirming(false)
    }
  }

  // Submit validation
  const [noCoordsTried, setNoCoordsTried] = useState(false)

  const selectedAlert = ALERT_TYPES.find((a) => a.value === alertType)
  const hasCoords     = !isNaN(parseFloat(latStr)) && !isNaN(parseFloat(lngStr))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl space-y-6">

      {/* Warning */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <span className="font-bold">注意：</span>
        このテストは範囲内の全店舗のエッジデバイスに BCP コマンドを送信します。
        イベントは <span className="font-bold">「テスト」</span> バッジ付きで記録されます。
      </div>

      {/* ── Section 1: 震源地 ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">① 震源地 / 発令エリア</h2>

        {/* Input mode toggle */}
        <div className="flex gap-0 overflow-hidden rounded border border-slate-200 text-xs font-medium w-fit">
          {(['zip', 'coords'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => { setInputMode(mode); setPreviewStores(null) }}
              className={
                'px-4 py-1.5 transition-colors ' +
                (inputMode === mode
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100')
              }
            >
              {mode === 'zip' ? '〒 郵便番号' : '📍 座標入力'}
            </button>
          ))}
        </div>

        {/* Zip mode */}
        {inputMode === 'zip' && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <span className="text-sm text-slate-500">〒</span>
              <input
                type="text"
                value={zip}
                onChange={(e) => { setZip(e.target.value); setZipResult(null); setPreviewStores(null) }}
                onKeyDown={(e) => e.key === 'Enter' && geocodeZip()}
                placeholder="1600022"
                maxLength={8}
                className="w-32 rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={geocodeZip}
                disabled={zipLoading}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {zipLoading ? '検索中…' : '検索'}
              </button>
            </div>
            {zipError && <p className="text-xs text-red-600">{zipError}</p>}
            {zipResult && (
              <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                <span className="font-bold">📍 {zipResult.address}</span>
                <span className="ml-2 font-mono text-emerald-600">
                  ({zipResult.lat.toFixed(5)}, {zipResult.lng.toFixed(5)})
                </span>
              </div>
            )}
          </div>
        )}

        {/* Coords mode */}
        {inputMode === 'coords' && (
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">緯度 (lat)</label>
              <input
                type="number"
                value={latStr}
                onChange={(e) => { setLatStr(e.target.value); setPreviewStores(null) }}
                placeholder="35.6917"
                step="0.0001"
                className="w-36 rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">経度 (lng)</label>
              <input
                type="number"
                value={lngStr}
                onChange={(e) => { setLngStr(e.target.value); setPreviewStores(null) }}
                placeholder="139.7008"
                step="0.0001"
                className="w-36 rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* Radius selector */}
        <div>
          <label className="mb-1.5 block text-[11px] text-slate-500 font-semibold">
            対象半径
          </label>
          <div className="flex flex-wrap gap-1.5">
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => { setRadiusKm(r); setPreviewStores(null) }}
                className={
                  'rounded px-3 py-1 text-xs font-medium transition-colors ' +
                  (radiusKm === r
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100')
                }
              >
                {r}km
              </button>
            ))}
          </div>
        </div>

        {/* Preview button */}
        <button
          type="button"
          onClick={previewTargetStores}
          disabled={!hasCoords || previewing}
          className="rounded border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {previewing ? '検索中…' : '🔍 対象店舗を確認'}
        </button>

        {previewError && <p className="text-xs text-red-600">{previewError}</p>}

        {/* Preview results */}
        {previewStores !== null && (
          <div className={
            'rounded-lg border px-3 py-2 text-xs ' +
            (previewStores.length === 0
              ? 'border-slate-200 bg-slate-50 text-slate-500'
              : 'border-emerald-200 bg-emerald-50')
          }>
            {previewStores.length === 0 ? (
              <p>半径 {radiusKm}km 以内に座標が登録された店舗はありません。</p>
            ) : (
              <>
                <p className="mb-2 font-semibold text-emerald-800">
                  {previewStores.length}店舗が対象（半径 {radiusKm}km）
                </p>
                <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                  {previewStores.map((s) => (
                    <li key={s.id} className="flex justify-between">
                      <span className="font-medium text-slate-700">{s.name}</span>
                      <span className="font-mono text-slate-500 ml-4">{fmtKm(s.distanceKm)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Section 2: アラート種別 ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">② アラート種別</h2>
        <div className="flex gap-3">
          {ALERT_TYPES.map((at) => (
            <button
              key={at.value}
              type="button"
              onClick={() => setAlertType(at.value)}
              className={
                'flex-1 rounded-lg border-2 p-3 text-center transition-all ' +
                (alertType === at.value
                  ? at.color + ' border-opacity-100 font-semibold'
                  : 'border-slate-200 bg-white hover:bg-slate-50')
              }
            >
              <div className="text-2xl">{at.emoji}</div>
              <div className="mt-1 text-[11px]">{at.label}</div>
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-500 font-semibold">
            アラート発令日時
            <span className="ml-2 font-normal text-slate-400">（録画ウィンドウの基準時刻）</span>
          </label>
          <input
            type="datetime-local"
            value={alertIssued}
            onChange={(e) => setAlertIssued(e.target.value)}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Error */}
      {submitError && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          エラー: {submitError}
        </div>
      )}

      {/* ── Confirm / Submit ─────────────────────────────────────────────────── */}
      {confirming ? (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-red-800">本当に発令しますか？</p>
          <div className="text-xs text-red-700 space-y-1">
            <div>
              座標: <span className="font-mono font-bold">{parseFloat(latStr).toFixed(5)}, {parseFloat(lngStr).toFixed(5)}</span>
            </div>
            <div>
              半径: <span className="font-bold">{radiusKm}km</span>
              {previewStores !== null && (
                <span className="ml-2 text-red-600">（{previewStores.length}店舗対象）</span>
              )}
            </div>
            <div>種別: <span className="font-bold">{selectedAlert?.emoji} {selectedAlert?.label}</span></div>
            <div>発令: <span className="font-bold">{new Date(alertIssued).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span></div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="rounded bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? '発令中…' : '🚨 テスト発令を確定'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => {
              if (!hasCoords) {
                setNoCoordsTried(true)
                return
              }
              setNoCoordsTried(false)
              setConfirming(true)
            }}
            className="rounded-lg bg-red-600 px-6 py-3 text-sm font-bold text-white hover:bg-red-700"
          >
            🚨 テストアラートを発令する
          </button>
          {noCoordsTried && !hasCoords && (
            <p className="text-xs text-red-600">
              {inputMode === 'zip'
                ? '先に郵便番号を入力して「検索」ボタンを押してください'
                : '緯度・経度を入力してください'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
