'use client'

/**
 * 手荷物検査 テナント共通設定フォーム（全店舗共通）
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { STEP_TEXT_MAX, type TerminalMode } from '@/lib/baggage/inspection-flow'
import type { BaggageTenantSettings } from '@/lib/baggage/tenant-settings'

const row = 'flex flex-wrap items-center gap-3'
const label = 'w-52 text-[13px] text-slate-600 dark:text-gedink2'
const input = 'rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 dark:border-gedline dark:bg-gedbg dark:text-gedink'

export function TenantSettingsClient(
  { isSuperAdmin, tenants, tenantId, initial }: {
    isSuperAdmin: boolean
    tenants: { id: string; name: string }[]
    tenantId: string
    initial: BaggageTenantSettings
  },
) {
  const router = useRouter()
  const [f, setF] = useState<BaggageTenantSettings>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const set = <K extends keyof BaggageTenantSettings>(k: K, v: BaggageTenantSettings[K]) => setF((p) => ({ ...p, [k]: v }))
  const setStep = (i: number, text: string) =>
    setF((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, text: text.slice(0, STEP_TEXT_MAX) } : s)) }))
  const addStep = () => setF((p) => ({ ...p, steps: [...p.steps, { order: p.steps.length + 1, text: '' }] }))
  const removeStep = (i: number) => setF((p) => ({
    ...p, steps: p.steps.filter((_, j) => j !== i).map((s, j) => ({ order: j + 1, text: s.text })),
  }))

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/baggage-settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, tenantId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setMsg({ ok: false, text: `保存に失敗しました（${j?.error ?? res.status}）` })
        return
      }
      setMsg({ ok: true, text: '保存しました。全店舗のキオスク端末は次の画面遷移から新設定で動作します。' })
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-[13px] text-slate-600 dark:text-gedink2">
        この設定は<b>全店舗共通</b>です。店舗ごとの有効化・検査台カメラは各店舗の
        <span className="font-mono"> 検査 → 設定 </span>で行います。
      </p>

      {isSuperAdmin && tenants.length > 0 && (
        <form method="get" action="/admin/baggage" className="flex items-center gap-2 text-sm">
          <span className={label}>テナント</span>
          <select name="tenant" defaultValue={tenantId} className={input}>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="submit"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
            表示
          </button>
        </form>
      )}

      <div className="space-y-4 rounded border border-slate-200 bg-white p-4 text-sm dark:border-gedline dark:bg-gedbg2">
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
            onChange={(e) => set('audioVolume', Number(e.target.value))} className="w-32 accent-blue-800" />
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

        {/* 個人情報取扱い同意の文言（iPadで表示。従業員=顔登録時／来訪者=入室毎に確認） */}
        <div className="border-t border-slate-100 pt-4 dark:border-gedline/50">
          <div className="mb-2 flex items-center gap-3">
            <span className={label}>個人情報取扱い同意の文言</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">現在 v{f.consentVersion}</span>
          </div>
          <textarea
            value={f.consentText}
            onChange={(e) => set('consentText', e.target.value.slice(0, 4000))}
            rows={5}
            placeholder="例）当店では手荷物検査のため、顔情報を取得・照合し、検査記録として一定期間保管します。ご同意のうえ「同意して進む」を押してください。"
            className={`${input} w-full`} />
          <p className="mt-1 text-[12px] text-slate-500 dark:text-gedink3">
            iPadキオスクで表示します。<b>空欄なら同意画面を出しません</b>。文言を変更して保存すると版(v)が上がり、以降の同意はその版で記録されます（過去の同意と区別できます）。
          </p>
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
        {busy ? '保存中…' : '共通設定を保存'}
      </button>
    </div>
  )
}
