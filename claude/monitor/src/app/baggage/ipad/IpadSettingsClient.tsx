'use client'

/**
 * iPad設定（クライアント）— 店舗ごとに QRコード表示と6桁PINの設定/解除。
 * QR は origin/kiosk/baggage/<storeId>（マウント後に window.location から生成）。
 * PIN 設定は PUT /api/baggage/kiosk-pin、解除は DELETE。設定後はサーバ状態を再取得。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'

export interface IpadStore {
  id: string
  name: string
  pinSet: boolean
  locked: boolean
}

const ERR_LABEL: Record<string, string> = {
  invalid_pin_format: '6桁の数字で入力してください。',
  forbidden: 'この店舗を操作する権限がありません。',
  pin_save_failed: 'PINの保存に失敗しました。',
  pin_delete_failed: 'PINの解除に失敗しました。',
}

export function IpadSettingsClient({ stores }: { stores: IpadStore[] }) {
  const router = useRouter()
  const [origin, setOrigin] = useState('')
  const [pinInput, setPinInput] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string | null>>({})

  useEffect(() => { setOrigin(window.location.origin) }, [])

  const setStoreMsg = (id: string, m: string | null) => setMsg((prev) => ({ ...prev, [id]: m }))

  const savePin = async (id: string) => {
    const pin = (pinInput[id] ?? '').trim()
    if (!/^\d{6}$/.test(pin)) { setStoreMsg(id, '6桁の数字で入力してください。'); return }
    setBusy(`save:${id}`); setStoreMsg(id, null)
    try {
      const res = await fetch('/api/baggage/kiosk-pin', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId: id, pin }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setStoreMsg(id, ERR_LABEL[j?.error ?? ''] ?? 'PINの設定に失敗しました。')
        return
      }
      setPinInput((prev) => ({ ...prev, [id]: '' }))
      setStoreMsg(id, 'PINを設定しました。')
      router.refresh()
    } finally { setBusy(null) }
  }

  const clearPin = async (id: string) => {
    if (!window.confirm('この店舗のPINを解除します。iPadはPINで開始できなくなります。よろしいですか？')) return
    setBusy(`clear:${id}`); setStoreMsg(id, null)
    try {
      const res = await fetch(`/api/baggage/kiosk-pin?storeId=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setStoreMsg(id, ERR_LABEL[j?.error ?? ''] ?? '解除に失敗しました。')
        return
      }
      setStoreMsg(id, 'PINを解除しました。')
      router.refresh()
    } finally { setBusy(null) }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {stores.map((s) => {
        const kioskUrl = origin ? `${origin}/kiosk/baggage/${s.id}` : ''
        return (
          <div key={s.id} className="rounded border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900 dark:text-gedink">{s.name}</span>
              {s.locked ? (
                <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">ロック中</span>
              ) : s.pinSet ? (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">PIN設定済み</span>
              ) : (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">PIN未設定</span>
              )}
            </div>

            {/* QR */}
            <div className="flex items-start gap-3">
              <div className="rounded bg-white p-2 ring-1 ring-slate-200 dark:ring-gedline">
                {kioskUrl
                  ? <QRCodeSVG value={kioskUrl} size={116} level="M" marginSize={1} />
                  : <div className="h-[116px] w-[116px]" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-slate-500 dark:text-gedink3">iPad キオスクURL</div>
                <div className="break-all font-mono text-[11px] text-slate-600 dark:text-gedink2">{kioskUrl || '…'}</div>
                <a href={kioskUrl || '#'} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-block text-[12px] text-blue-700 hover:underline dark:text-gedaccent">開く ↗</a>
              </div>
            </div>

            {/* PIN 設定 */}
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-gedline/50">
              <label className="text-[11px] text-slate-500 dark:text-gedink3">6桁PIN（{s.pinSet ? '変更' : '設定'}）</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  inputMode="numeric" maxLength={6} value={pinInput[s.id] ?? ''}
                  onChange={(e) => setPinInput((prev) => ({ ...prev, [s.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                  placeholder="000000"
                  className="w-28 rounded border border-slate-300 px-2 py-1.5 font-mono tabular-nums tracking-widest text-slate-900 dark:border-gedline dark:bg-gedbg dark:text-gedink" />
                <button onClick={() => savePin(s.id)} disabled={busy !== null}
                  className="rounded bg-blue-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-800 disabled:opacity-40 dark:bg-gedaccent">
                  {busy === `save:${s.id}` ? '保存中…' : '設定'}
                </button>
                {s.pinSet && (
                  <button onClick={() => clearPin(s.id)} disabled={busy !== null}
                    className="rounded border border-red-300 px-2.5 py-1.5 text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
                    {busy === `clear:${s.id}` ? '解除中…' : '解除'}
                  </button>
                )}
              </div>
              {msg[s.id] && <div className="mt-1.5 text-[12px] text-slate-600 dark:text-gedink2">{msg[s.id]}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
