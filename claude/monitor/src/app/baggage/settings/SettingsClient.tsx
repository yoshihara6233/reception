'use client'

/**
 * 手荷物検査 店舗設定フォーム（M4・店舗固有のみ）
 *
 * 店舗固有は「有効化・検査台カメラ（最大2台）」だけ。保持期間・タイムアウト・端末
 * モード・音声・STEP文言はテナント共通（/admin/baggage）で一元管理する。
 * この画面には iPad キオスクの URL/QR も表示する。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'

export interface SettingsForm {
  storeId: string
  enabled: boolean
  cameraIds: string[]
}

const input = 'rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 dark:border-gedline dark:bg-gedbg dark:text-gedink'

export function SettingsClient(
  { storeOptions, initial, cameras }: {
    storeOptions: { id: string; name: string }[]
    initial: SettingsForm
    cameras: { id: string; name: string; channel: number }[]
  },
) {
  const router = useRouter()
  const [f, setF] = useState<SettingsForm>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // キオスクURL（この店舗のiPad用）。hydration mismatch 回避のためマウント後に組む。
  const [kioskUrl, setKioskUrl] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setKioskUrl(`${window.location.origin}/kiosk/baggage/${f.storeId}`)
    setCopied(false)
  }, [f.storeId])

  const toggleCamera = (id: string) => {
    setF((p) => {
      const has = p.cameraIds.includes(id)
      if (has) return { ...p, cameraIds: p.cameraIds.filter((c) => c !== id) }
      if (p.cameraIds.length >= 2) return p   // 検査台は最大2カメラ
      return { ...p, cameraIds: [...p.cameraIds, id] }
    })
  }

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/baggage/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId: f.storeId, enabled: f.enabled, cameraIds: f.cameraIds }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setMsg({ ok: false, text: `保存に失敗しました（${j?.error ?? res.status}）` })
        return
      }
      setMsg({ ok: true, text: '保存しました。キオスク端末は次の画面遷移から新設定で動作します。' })
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* 店舗切替 */}
      <form method="get" action="/baggage/settings" className="flex items-center gap-2 text-sm">
        <select name="store" defaultValue={f.storeId} className={input}>
          {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="submit"
          className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
          表示
        </button>
      </form>

      {/* iPad キオスク URL ＋ QR（この店舗の受付端末で開く） */}
      <div className="flex flex-wrap items-center gap-5 rounded border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
        <div className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200 dark:ring-gedline">
          {kioskUrl
            ? <QRCodeSVG value={kioskUrl} size={132} level="M" marginSize={1} />
            : <div className="flex h-[132px] w-[132px] items-center justify-center text-[10px] text-slate-400">読み込み中…</div>}
        </div>
        <div className="min-w-[240px] flex-1 space-y-2">
          <div className="text-[13px] font-bold text-slate-900 dark:text-gedink">iPad 受付端末のURL</div>
          <p className="text-[12px] text-slate-500 dark:text-gedink3">
            この店舗の受付 iPad で下記URLを開くか、QRコードを読み取ってください。ログイン後に固定表示できます。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-[12px] text-slate-700 dark:bg-gedbg3 dark:text-gedink2">
              {kioskUrl || '…'}
            </code>
            <button
              type="button"
              disabled={!kioskUrl}
              onClick={() => { if (kioskUrl) { void navigator.clipboard.writeText(kioskUrl).then(() => setCopied(true)) } }}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
              {copied ? 'コピーしました' : 'URLをコピー'}
            </button>
            <a href={kioskUrl || '#'} target="_blank" rel="noopener noreferrer"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
              開く
            </a>
          </div>
          {!f.enabled && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400">
              ※ このURLは「この店舗で有効にする」を保存後に利用できます。
            </p>
          )}
        </div>
      </div>

      {/* 店舗固有設定（有効化＋カメラ） */}
      <div className="space-y-4 rounded border border-slate-200 bg-white p-4 text-sm dark:border-gedline dark:bg-gedbg2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-44 text-[13px] text-slate-600 dark:text-gedink2">手荷物検査オプション</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF((p) => ({ ...p, enabled: e.target.checked }))} />
            この店舗で有効にする
          </label>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <span className="w-44 text-[13px] text-slate-600 dark:text-gedink2">検査台カメラ（最大2台）</span>
          <div className="flex flex-col gap-1">
            {cameras.length === 0 && <span className="text-slate-500 dark:text-gedink3">この店舗にカメラが登録されていません</span>}
            {cameras.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={f.cameraIds.includes(c.id)}
                  disabled={!f.cameraIds.includes(c.id) && f.cameraIds.length >= 2}
                  onChange={() => toggleCamera(c.id)} />
                <span>{c.name}</span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-gedink3">ch{c.channel}</span>
              </label>
            ))}
          </div>
        </div>

        <p className="text-[12px] text-slate-500 dark:text-gedink3">
          保持期間・STEP無操作タイムアウト・端末モード・音声・検査STEP文言は全店舗共通です。
          <Link href="/admin/baggage" className="ml-1 text-blue-700 underline dark:text-gedaccent">管理 → 手荷物検査設定</Link>
          で変更できます。
        </p>
      </div>

      {msg && (
        <div className={
          'rounded border px-3 py-2 text-[13px] ' +
          (msg.ok
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300')
        }>{msg.text}</div>
      )}

      <button onClick={save} disabled={busy}
        className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40">
        {busy ? '保存中…' : '設定を保存'}
      </button>
    </div>
  )
}
