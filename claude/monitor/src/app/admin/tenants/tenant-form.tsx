'use client'

import { useState } from 'react'
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

export function TenantForm({ mode, id, initial }: { mode: 'create' | 'edit'; id?: string; initial: TenantInitial }) {
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

      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          オプション機能（有料）
        </legend>
        <p className="mb-2 text-[11px] text-slate-500">
          Monitor + BCP は基本パック（常時有効）。以下を無効にすると、対応メニューがこのテナントで非表示になります。
        </p>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.opt_patrol}
                   onChange={(e) => setForm({ ...form, opt_patrol: e.target.checked })} />
            巡回（AI警備 / <span className="font-mono text-xs">/security</span>）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.opt_alarm}
                   onChange={(e) => setForm({ ...form, opt_alarm: e.target.checked })} />
            発報（アラーム / <span className="font-mono text-xs">/alarms</span>）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.opt_baggage}
                   onChange={(e) => setForm({ ...form, opt_baggage: e.target.checked })} />
            手荷物検査（<span className="font-mono text-xs">/baggage</span>・検査設定）
          </label>
        </div>
      </fieldset>

      {err  && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
      {done && <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">保存しました</p>}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => router.push('/admin/tenants')}
                className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600">
          キャンセル
        </button>
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
