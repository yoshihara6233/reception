'use client'

/**
 * iPad設定（クライアント）— 店舗ごとに QRコード表示・6桁PINの設定/解除・据え付け向き。
 * QR は origin/kiosk/baggage/<storeId>（マウント後に window.location から生成）。
 * PIN 設定は PUT /api/baggage/kiosk-pin、解除は DELETE。設定後はサーバ状態を再取得。
 * 据え付け向きは PUT /api/baggage/kiosk-orientation（押した時点で即保存。店長が現物を
 * 見ながら選ぶ項目なので、保存ボタンを別に押させない）。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { KIOSK_ORIENTATIONS, ORIENTATION_LABEL, type KioskOrientation } from '@/lib/baggage/kiosk-layout'

export interface IpadStore {
  id: string
  name: string
  pinSet: boolean
  locked: boolean
  /** iPad の据え付け向き。縦置きにするとキオスクが縦型レイアウトになる。 */
  orientation: KioskOrientation
}

const ERR_LABEL: Record<string, string> = {
  invalid_pin_format: '6桁の数字で入力してください。',
  forbidden: 'この店舗を操作する権限がありません。',
  pin_save_failed: 'PINの保存に失敗しました。',
  pin_delete_failed: 'PINの解除に失敗しました。',
  settings_not_found: 'この店舗は手荷物検査が有効になっていません。',
}

/** 向きの選び方（現物の設置状態で選ぶものだと分かるようにする）。 */
const ORIENTATION_HINT: Record<KioskOrientation, string> = {
  landscape: '横向きに設置',
  portrait: '縦向きに設置',
}

export function IpadSettingsClient({ stores }: { stores: IpadStore[] }) {
  const router = useRouter()
  const [origin, setOrigin] = useState('')
  const [pinInput, setPinInput] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string | null>>({})
  // 向きは押した瞬間に反映したいので、サーバ再取得を待たずローカルにも持つ。
  const [orientation, setOrientation] = useState<Record<string, KioskOrientation>>(
    () => Object.fromEntries(stores.map((s) => [s.id, s.orientation])),
  )

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

  const saveOrientation = async (id: string, next: KioskOrientation) => {
    if (orientation[id] === next) return
    const prev = orientation[id]
    setOrientation((o) => ({ ...o, [id]: next }))   // 楽観更新（失敗時は戻す）
    setBusy(`orient:${id}`); setStoreMsg(id, null)
    try {
      const res = await fetch('/api/baggage/kiosk-orientation', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId: id, orientation: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setOrientation((o) => ({ ...o, [id]: prev }))
        setStoreMsg(id, ERR_LABEL[j?.error ?? ''] ?? '向きの保存に失敗しました。')
        return
      }
      setStoreMsg(id, `${ORIENTATION_LABEL[next]}にしました。iPad の画面を再読込してください。`)
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

            {/* 据え付け向き（押した時点で保存） */}
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-gedline/50">
              <label className="text-[11px] text-slate-500 dark:text-gedink3">iPad の据え付け向き</label>
              <div className="mt-1 flex items-center gap-2">
                {KIOSK_ORIENTATIONS.map((o) => {
                  const on = (orientation[s.id] ?? s.orientation) === o
                  return (
                    <button key={o} onClick={() => saveOrientation(s.id, o)} disabled={busy !== null}
                      aria-pressed={on}
                      className={'rounded px-3 py-1.5 text-[13px] disabled:opacity-40 ' + (on
                        ? 'border-2 border-blue-700 bg-blue-50 font-medium text-blue-800 dark:border-gedaccent dark:bg-gedaccent/15 dark:text-gedaccent'
                        : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-gedline dark:text-gedink2 dark:hover:bg-gedbg')}>
                      {ORIENTATION_LABEL[o]}
                      <span className="ml-1.5 text-[11px] font-normal opacity-70">{ORIENTATION_HINT[o]}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-gedink3">
                縦置きにすると、キオスクの画面が縦型のレイアウトに変わります。
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
