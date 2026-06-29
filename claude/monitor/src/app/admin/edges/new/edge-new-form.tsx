'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { CircleCheck, TriangleAlert } from 'lucide-react'

type StoreOption = { id: string; name: string; area_code: string | null }
type Config = 'relay' | 'hq_direct' | 'frigate_unit'
type Step = 'config' | 'form' | 'qr' | 'done'
type Enrollment = { id: string; token: string; expires_at: string; origin: string }

const TIERS = [16, 32, 48] as const

export function EdgeNewForm({ storeCandidates }: { storeCandidates: StoreOption[] }) {
  const router = useRouter()
  const [step, setStep]     = useState<Step>('config')
  const [config]            = useState<Config>('relay')   // GA は relay のみ有効
  const [storeId, setStoreId] = useState('')
  const [tier, setTier]     = useState<number>(16)
  const [name, setName]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const [enroll, setEnroll] = useState<Enrollment | null>(null)
  const [edgeId, setEdgeId] = useState<string | null>(null)
  const pollRef             = useRef<NodeJS.Timeout | null>(null)

  // エンロール完了をポーリング（used_at がつけば edge_id が返る）。
  useEffect(() => {
    if (step !== 'qr' || !enroll) return
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/enrollments/${enroll.id}`)
        if (!res.ok) return
        const j = await res.json() as { used_at: string | null; edge_id: string | null }
        if (j.used_at && j.edge_id) {
          setEdgeId(j.edge_id)
          setStep('done')
        }
      } catch { /* ネットワーク一時失敗は無視（次tickで再試行） */ }
    }
    pollRef.current = setInterval(tick, 3000)
    void tick()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [step, enroll])

  async function issue() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/admin/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, name, camera_tier: tier }),
    })
    setBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); return setErr(j.error ?? `発行失敗: ${res.status}`) }
    const j = await res.json() as { id: string; token: string; expires_at: string }
    setEnroll({ ...j, origin: window.location.origin })
    setStep('qr')
  }

  async function reissue() {
    if (!enroll) return
    setBusy(true); setErr(null)
    const res = await fetch(`/api/admin/enrollments/${enroll.id}/reissue`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); return setErr(j.error ?? `再発行失敗: ${res.status}`) }
    const j = await res.json() as { id: string; token: string; expires_at: string }
    setEnroll({ ...j, origin: window.location.origin })
  }

  // ── Step: 構成選択 ──
  if (step === 'config') {
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="font-bold text-slate-900">拠点構成を選択</h2>
        <ConfigCard active={config === 'relay'} title="② 中継ユニット (relay)" desc="既存NVR + 中継ユニット。QRで現地ユニットを自己登録。【GA本命】" onClick={() => setStep('form')} />
        <ConfigCard disabled title="① 本部直結 (hq_direct)" desc="拠点機器なし・本部からNVRへ直接接続" badge="GA後" />
        <ConfigCard disabled title="③ Frigate録画 (frigate_unit)" desc="録画も自前ユニットで実施" badge="GA後" />
      </div>
    )
  }

  // ── Step: 完了 ──
  if (step === 'done') {
    return (
      <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm">
        <h2 className="flex items-center gap-1.5 font-bold text-emerald-900"><CircleCheck size={18} strokeWidth={1.5} aria-hidden /> エンロール完了</h2>
        <p className="text-emerald-800">現地ユニットが登録され、device_token が払い出されました。続けてレコーダ/カメラを設定してください。</p>
        <div className="flex gap-2 pt-1">
          <button onClick={() => edgeId && router.push(`/admin/edges/${edgeId}`)}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white">
            続けてレコーダを登録 →
          </button>
          <button onClick={() => router.push('/admin/edges')}
                  className="rounded border border-slate-200 bg-white px-4 py-1.5 text-sm">
            一覧に戻る
          </button>
        </div>
      </div>
    )
  }

  // ── Step: QR 表示 + エンロール待ち ──
  if (step === 'qr' && enroll) {
    const qrPayload = JSON.stringify({ v: 1, url: enroll.origin, token: enroll.token })
    return (
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="font-bold text-slate-900">QRを現地ユニットで読み取り</h2>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <QRCodeSVG value={qrPayload} size={208} level="M" />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            エンロール待ち… 現地ユニットがQRを読み取ると自動で次へ進みます
          </div>
        </div>

        <div className="rounded border border-slate-200 p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">手入力用トークン（QRが読めない場合）</p>
          <code className="block break-all rounded bg-slate-900 px-2 py-1.5 font-mono text-[11px] text-emerald-200">{enroll.token}</code>
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400">有効期限: {new Date(enroll.expires_at).toLocaleString('ja-JP')}（24時間・単一使用）。<TriangleAlert size={13} strokeWidth={1.5} aria-hidden /> トークンは再表示できません。</p>
        </div>

        {err && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

        <div className="flex justify-between gap-2 border-t border-slate-100 pt-3">
          <button onClick={reissue} disabled={busy}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? '再発行中…' : '期限切れ → 再発行'}
          </button>
          <button onClick={() => router.push('/admin/edges')}
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs">
            あとで（一覧へ）
          </button>
        </div>
      </div>
    )
  }

  // ── Step: 登録フォーム（store + tier + name） ──
  return (
    <form onSubmit={(e) => { e.preventDefault(); void issue() }} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-blue-50 px-2 py-0.5 font-medium text-blue-700">② 中継ユニット (relay)</span>
        <button type="button" onClick={() => setStep('config')} className="underline">構成を変更</button>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">配置する店舗</span>
        <select required value={storeId} onChange={(e) => setStoreId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">— 選択してください —</option>
          {storeCandidates.map((s) => (
            <option key={s.id} value={s.id}>{s.area_code ? `[${s.area_code}] ` : ''}{s.name}</option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-slate-500">エッジ未登録の店舗のみ表示（候補 {storeCandidates.length} 件）</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">カメラ台数ティア</span>
        <select value={tier} onChange={(e) => setTier(Number(e.target.value))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
          {TIERS.map((t) => <option key={t} value={t}>{t} 台</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">エッジ名（識別用）</span>
        <input required value={name} onChange={(e) => setName(e.target.value)}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
               placeholder="例: shibuya-minami-edge-01" />
      </label>

      {err && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="submit" disabled={busy || !storeId || !name}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? '発行中…' : 'QRを発行'}
        </button>
      </div>
    </form>
  )
}

function ConfigCard({ active, disabled, title, desc, badge, onClick }: {
  active?: boolean; disabled?: boolean; title: string; desc: string; badge?: string; onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors ' +
        (disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
          : 'border-blue-200 bg-blue-50/40 hover:bg-blue-50') +
        (active ? ' ring-1 ring-blue-300' : '')
      }
    >
      <div>
        <div className="font-bold text-slate-900">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
      </div>
      {badge && <span className="shrink-0 rounded bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">{badge}</span>}
    </button>
  )
}
