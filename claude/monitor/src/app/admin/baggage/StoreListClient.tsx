'use client'

/**
 * 手荷物検査 店舗別設定（有効化・検査台カメラ）を全店舗まとめて編集。
 * iPad の据え付け向きは店長が自店舗で設定する項目のため「iPad設定」(/baggage/ipad) に置く。
 * iPadのQR/PIN設定は手荷物検査モジュールの「iPad設定」(/baggage/ipad) へ移設。
 * 共通設定（保持日数・タイムアウト等）は同ページ上部の TenantSettingsClient。
 * 保存は店舗ごと（PUT /api/baggage/settings）。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

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

            {/* iPad の QR / PIN / 据え付け向きは「手荷物検査 › iPad設定」へ移設 */}
            <div className="mt-3 text-[12px] text-slate-500 dark:text-gedink3">
              iPad の QRコード・6桁PIN・据え付け向きは <span className="font-medium text-slate-700 dark:text-gedink2">手荷物検査 › iPad設定</span> で行います（店長が自店舗で設定できます）。
            </div>

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
