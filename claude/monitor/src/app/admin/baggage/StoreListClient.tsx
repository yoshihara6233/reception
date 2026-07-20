'use client'

/**
 * 手荷物検査 店舗別設定（有効化・検査台カメラ・iPad URL/QR）を全店舗まとめて編集。
 * 共通設定（保持日数・タイムアウト等）は同ページ上部の TenantSettingsClient。
 * 保存は店舗ごと（PUT /api/baggage/settings）。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'

export interface StoreRow {
  id: string
  name: string
  enabled: boolean
  cameraIds: string[]
  cameras: { id: string; name: string; channel: number }[]
}

export function StoreListClient({ stores }: { stores: StoreRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<StoreRow[]>(stores)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  const [origin, setOrigin] = useState('')
  const [qrOpen, setQrOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const patch = (id: string, up: Partial<StoreRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...up } : r)))

  const toggleCamera = (id: string, camId: string) =>
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r
      const has = r.cameraIds.includes(camId)
      if (has) return { ...r, cameraIds: r.cameraIds.filter((c) => c !== camId) }
      if (r.cameraIds.length >= 2) return r
      return { ...r, cameraIds: [...r.cameraIds, camId] }
    }))

  const save = async (r: StoreRow) => {
    setBusy(r.id); setMsg(null)
    try {
      const res = await fetch('/api/baggage/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId: r.id, enabled: r.enabled, cameraIds: r.cameraIds }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setMsg({ id: r.id, ok: false, text: `保存に失敗しました（${j?.error ?? res.status}）` })
        return
      }
      setMsg({ id: r.id, ok: true, text: '保存しました。' })
      router.refresh()
    } finally { setBusy(null) }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-gedink3">この対象に店舗がありません。</p>
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const kioskUrl = origin ? `${origin}/kiosk/baggage/${r.id}` : ''
        return (
          <div key={r.id} className="rounded border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[14px] font-bold text-slate-900 dark:text-gedink">{r.name}</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} />
                この店舗で有効にする
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-start gap-3 text-sm">
              <span className="w-40 text-[13px] text-slate-600 dark:text-gedink2">検査台カメラ（最大2台）</span>
              <div className="flex flex-col gap-1">
                {r.cameras.length === 0
                  ? <span className="text-slate-500 dark:text-gedink3">この店舗にカメラが登録されていません</span>
                  : r.cameras.map((c) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={r.cameraIds.includes(c.id)}
                        disabled={!r.cameraIds.includes(c.id) && r.cameraIds.length >= 2}
                        onChange={() => toggleCamera(r.id, c.id)} />
                      <span>{c.name}</span>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-gedink3">ch{c.channel}</span>
                    </label>
                  ))}
              </div>
            </div>

            {/* iPad URL / QR */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="w-40 text-[13px] text-slate-600 dark:text-gedink2">iPad 受付端末</span>
              <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-slate-700 dark:bg-gedbg3 dark:text-gedink2">
                {kioskUrl || '…'}
              </code>
              <button type="button" disabled={!kioskUrl}
                onClick={() => { if (kioskUrl) void navigator.clipboard.writeText(kioskUrl).then(() => setCopied(r.id)) }}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
                {copied === r.id ? 'コピーしました' : 'URLをコピー'}
              </button>
              <a href={kioskUrl || '#'} target="_blank" rel="noopener noreferrer"
                className="rounded border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
                開く
              </a>
              <button type="button" onClick={() => setQrOpen(qrOpen === r.id ? null : r.id)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
                {qrOpen === r.id ? 'QRを閉じる' : 'QRを表示'}
              </button>
            </div>
            {qrOpen === r.id && kioskUrl && (
              <div className="mt-2 inline-block rounded-lg bg-white p-2.5 ring-1 ring-slate-200 dark:ring-gedline">
                <QRCodeSVG value={kioskUrl} size={132} level="M" marginSize={1} />
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <button onClick={() => save(r)} disabled={busy !== null}
                className="rounded bg-blue-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-800 disabled:opacity-40">
                {busy === r.id ? '保存中…' : 'この店舗を保存'}
              </button>
              {msg?.id === r.id && (
                <span className={'text-[12px] ' + (msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
                  {msg.text}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
