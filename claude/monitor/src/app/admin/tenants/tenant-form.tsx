'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export type Plan   = 'starter' | 'standard' | 'enterprise'
export type Status = 'active' | 'suspended' | 'trial'

export interface TenantInitial {
  name:        string
  plan:        Plan
  status:      Status
  slug:        string | null
  opt_patrol:  boolean
  opt_alarm:   boolean
  opt_baggage: boolean
  // 数量クォータ（null=無制限）
  max_stores:  number | null
  max_patrol:  number | null
  max_alarm:   number | null
  max_baggage: number | null
  // 月次レポート作成日（1〜28・null=既定28）
  report_day:  number | null
}

/** 現在の利用数（表示用・任意）。編集時のみ渡す。 */
export interface TenantUsage {
  stores:  number
  patrol:  number
  alarm:   number
  baggage: number
}

const PLAN_LABELS: Record<Plan, string> = {
  starter:    'スターター (starter)',
  standard:   'スタンダード (standard)',
  enterprise: 'エンタープライズ (enterprise)',
}
const STATUS_LABELS: Record<Status, string> = {
  trial:     'トライアル (trial)',
  active:    '稼働 (active)',
  suspended: '停止 (suspended)',
}
const ERR_LABELS: Record<string, string> = {
  slug_taken:      'そのスラッグは既に使われています',
  super_admin_only: 'テナント操作は全体管理者のみ可能です',
  invalid_body:    '入力内容を確認してください',
}

export function TenantForm({ mode, id, initial, usage }: {
  mode: 'create' | 'edit'; id?: string; initial: TenantInitial; usage?: TenantUsage
}) {
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setDone(false); setBusy(true)

    const url    = mode === 'create' ? '/api/admin/tenants' : `/api/admin/tenants/${id}`
    const method = mode === 'create' ? 'POST' : 'PUT'
    const body: Record<string, unknown> = {
      name:        form.name,
      plan:        form.plan,
      status:      form.status,
      slug:        form.slug?.trim() ? form.slug.trim().toLowerCase() : null,
      opt_patrol:  form.opt_patrol,
      opt_alarm:   form.opt_alarm,
      opt_baggage: form.opt_baggage,
      max_stores:  form.max_stores,
      max_patrol:  form.max_patrol,
      max_alarm:   form.max_alarm,
      max_baggage: form.max_baggage,
      report_day:  form.report_day,
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(ERR_LABELS[j.error] ?? `${j.error ?? `保存失敗: ${res.status}`}`)
      return
    }
    setDone(true)
    if (mode === 'create') {
      router.push('/admin/tenants')
      router.refresh()
    } else {
      router.refresh()
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <Field label="テナント名 *">
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="例: 株式会社◯◯" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="プラン *">
          <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as Plan })}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
            {(['starter', 'standard', 'enterprise'] as Plan[]).map((p) => (
              <option key={p} value={p}>{PLAN_LABELS[p]}</option>
            ))}
          </select>
        </Field>
        <Field label="ステータス *">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
            {(['trial', 'active', 'suspended'] as Status[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="スラッグ (任意・英小文字/数字/ハイフン)">
        <input value={form.slug ?? ''} onChange={(e) => setForm({ ...form, slug: e.target.value || null })}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono" placeholder="例: acme-corp" />
        <p className="mt-1 text-[11px] text-slate-500">URL 等で使う識別子。未入力可。重複不可。</p>
      </Field>

      <Field label="店舗数の上限（空欄＝無制限）">
        <div className="flex items-center gap-2">
          <LimitInput value={form.max_stores} onChange={(v) => setForm({ ...form, max_stores: v })} />
          {mode === 'edit' && usage && (
            <span className={`text-[11px] ${form.max_stores != null && usage.stores > form.max_stores ? 'font-bold text-amber-600' : 'text-slate-500'}`}>
              現在 {usage.stores.toLocaleString()} 店舗
              {form.max_stores != null && usage.stores > form.max_stores && '（上限超過・警告）'}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">上限を超えても店舗は作成できます（超過時は警告を表示）。</p>
      </Field>

      <Field label="月次レポート作成日（毎月・1〜28）">
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={28} value={form.report_day ?? ''} placeholder="28"
            onChange={(e) => {
              const raw = e.target.value.trim()
              if (raw === '') return setForm({ ...form, report_day: null })
              const n = Math.min(28, Math.max(1, Math.trunc(Number(raw))))
              setForm({ ...form, report_day: Number.isFinite(n) ? n : null })
            }}
            className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono tabular-nums" />
          <span className="text-[11px] text-slate-500">空欄＝既定28日</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">毎月この日に前月分の利用状況レポートを確定・通知します（通知は今後対応）。29〜31日は月により無いため28まで。</p>
      </Field>

      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          オプション機能（有料）
        </legend>
        <p className="mb-2 text-[11px] text-slate-500">
          Monitor + BCP は基本パック（常時有効）。チェックで契約有効化（対応メニュー可視）。
          「ON上限」は、その機能を<b>店舗別にON</b>にできる店舗数の上限（空欄＝無制限）。上限を超えても登録は可能で、超過時は<b className="text-amber-600">警告</b>表示。
        </p>
        <div className="space-y-2.5">
          <OptionRow
            label="巡回（AI警備 / /security）"
            checked={form.opt_patrol}
            onChecked={(c) => setForm({ ...form, opt_patrol: c })}
            max={form.max_patrol}
            onMax={(v) => setForm({ ...form, max_patrol: v })}
            usage={mode === 'edit' ? usage?.patrol : undefined}
          />
          <OptionRow
            label="発報（アラーム / /alarms）"
            checked={form.opt_alarm}
            onChecked={(c) => setForm({ ...form, opt_alarm: c })}
            max={form.max_alarm}
            onMax={(v) => setForm({ ...form, max_alarm: v })}
            usage={mode === 'edit' ? usage?.alarm : undefined}
          />
          <OptionRow
            label="手荷物検査（/baggage・検査設定）"
            checked={form.opt_baggage}
            onChecked={(c) => setForm({ ...form, opt_baggage: c })}
            max={form.max_baggage}
            onMax={(v) => setForm({ ...form, max_baggage: v })}
            usage={mode === 'edit' ? usage?.baggage : undefined}
          />
        </div>
      </fieldset>

      {err  && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
      {done && <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">保存しました</p>}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Link href="/admin/tenants"
              className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          キャンセル
        </Link>
        <button type="submit" disabled={busy}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : mode === 'create' ? '作成' : '保存'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  )
}

/** 数量上限の入力。空欄=無制限(null)。 */
function LimitInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={100000}
      value={value ?? ''}
      placeholder="無制限"
      onChange={(e) => {
        const raw = e.target.value.trim()
        if (raw === '') return onChange(null)
        const n = Math.max(0, Math.trunc(Number(raw)))
        onChange(Number.isFinite(n) ? n : null)
      }}
      className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono tabular-nums"
    />
  )
}

/** オプション1行: ON/OFF（契約）＋ ON上限（店舗数）＋ 現在ON数。 */
function OptionRow({
  label, checked, onChecked, max, onMax, usage,
}: {
  label: string
  checked: boolean
  onChecked: (c: boolean) => void
  max: number | null
  onMax: (v: number | null) => void
  usage?: number
}) {
  const over = usage != null && max != null && usage > max
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <label className="flex min-w-[16rem] items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChecked(e.target.checked)} />
        {label}
      </label>
      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
        ON上限
        <LimitInput value={max} onChange={onMax} />
      </span>
      {usage != null && (
        <span className={`text-[11px] tabular-nums ${over ? 'font-bold text-amber-600' : 'text-slate-500'}`}>
          現在ON {usage.toLocaleString()}{max != null ? ` / ${max.toLocaleString()}` : ''} 店舗
          {over && '（上限超過・警告）'}
        </span>
      )}
    </div>
  )
}
