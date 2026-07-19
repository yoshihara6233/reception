'use client'

/**
 * 手荷物検査 店舗設定フォーム（M4・クライアント）
 * STEP 文言は全角40字上限（D13）— 入力側でも制限し、保存時にサーバで正規化。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { STEP_TEXT_MAX, type AnnounceStep, type TerminalMode } from '@/lib/baggage/inspection-flow'

export interface SettingsForm {
  storeId: string
  enabled: boolean
  cameraIds: string[]
  retentionDays: number
  nvrRetentionDays: number
  timeoutSec: number
  terminalMode: TerminalMode
  audioEnabled: boolean
  audioVolume: number
  steps: AnnounceStep[]
}

const row = 'flex flex-wrap items-center gap-3'
const label = 'w-44 text-[13px] text-slate-600 dark:text-gedink2'
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

  // キオスクURL（この店舗のiPad用）。SSRとクライアントで origin がずれると
  // hydration mismatch になるためマウント後に組み立てる。
  const [kioskUrl, setKioskUrl] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setKioskUrl(`${window.location.origin}/kiosk/baggage/${f.storeId}`)
    setCopied(false)
  }, [f.storeId])

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setF((p) => ({ ...p, [k]: v }))

  const toggleCamera = (id: string) => {
    setF((p) => {
      const has = p.cameraIds.includes(id)
      if (has) return { ...p, cameraIds: p.cameraIds.filter((c) => c !== id) }
      if (p.cameraIds.length >= 2) return p   // 検査台は最大2カメラ
      return { ...p, cameraIds: [...p.cameraIds, id] }
    })
  }

  const setStep = (i: number, text: string) => {
    setF((p) => {
      const steps = p.steps.map((s, j) => (j === i ? { ...s, text: text.slice(0, STEP_TEXT_MAX) } : s))
      return { ...p, steps }
    })
  }
  const addStep = () => setF((p) => ({ ...p, steps: [...p.steps, { order: p.steps.length + 1, text: '' }] }))
  const removeStep = (i: number) => setF((p) => ({
    ...p,
    steps: p.steps.filter((_, j) => j !== i).map((s, j) => ({ order: j + 1, text: s.text })),
  }))

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/baggage/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f),
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

      <div className="space-y-4 rounded border border-slate-200 bg-white p-4 text-sm dark:border-gedline dark:bg-gedbg2">
        <div className={row}>
          <span className={label}>手荷物検査オプション</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            この店舗で有効にする
          </label>
        </div>

        <div className={row}>
          <span className={label}>検査台カメラ（最大2台）</span>
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

        <div className={row}>
          <span className={label}>クリップ保持（日）</span>
          <input type="number" min={1} max={365} value={f.retentionDays}
            onChange={(e) => set('retentionDays', Number(e.target.value))} className={`${input} w-24`} />
          <span className={label}>NVR録画保持（日）</span>
          <input type="number" min={3} max={90} value={f.nvrRetentionDays}
            onChange={(e) => set('nvrRetentionDays', Number(e.target.value))} className={`${input} w-24`} />
        </div>

        <div className={row}>
          <span className={label}>STEP無操作タイムアウト（秒）</span>
          <input type="number" min={30} max={600} value={f.timeoutSec}
            onChange={(e) => set('timeoutSec', Number(e.target.value))} className={`${input} w-24`} />
        </div>

        <div className={row}>
          <span className={label}>端末モード</span>
          <select value={f.terminalMode} onChange={(e) => set('terminalMode', e.target.value as TerminalMode)} className={input}>
            <option value="both">入退両用</option>
            <option value="entry_only">入室専用</option>
            <option value="exit_only">退出専用</option>
          </select>
        </div>

        <div className={row}>
          <span className={label}>音声案内（TTS）</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.audioEnabled} onChange={(e) => set('audioEnabled', e.target.checked)} />
            読み上げる（既定ON — アナウンス自体が抑止力）
          </label>
          <span className="text-[12px] text-slate-500 dark:text-gedink3">音量</span>
          <input type="range" min={0} max={1} step={0.1} value={f.audioVolume}
            onChange={(e) => set('audioVolume', Number(e.target.value))} className="w-32 accent-[#2C4A7E]" />
          <span className="w-8 font-mono text-[12px] tabular-nums">{Math.round(f.audioVolume * 100)}%</span>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className={label}>検査STEP文言（全角{STEP_TEXT_MAX}字まで）</span>
            <button onClick={addStep} disabled={f.steps.length >= 10}
              className="rounded border border-slate-300 px-2 py-0.5 text-[12px] hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:text-gedink dark:hover:bg-gedbg3">
              ＋ STEP追加
            </button>
          </div>
          <div className="space-y-2">
            {f.steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 font-mono text-[12px] text-slate-500 dark:text-gedink3">STEP {i + 1}</span>
                <input value={s.text} onChange={(e) => setStep(i, e.target.value)}
                  maxLength={STEP_TEXT_MAX} className={`${input} flex-1`} />
                <span className="w-12 text-right font-mono text-[11px] tabular-nums text-slate-400 dark:text-gedink3">
                  {s.text.length}/{STEP_TEXT_MAX}
                </span>
                <button onClick={() => removeStep(i)} disabled={f.steps.length <= 1}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:text-gedink2 dark:hover:bg-gedbg3">
                  削除
                </button>
              </div>
            ))}
          </div>
        </div>
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
