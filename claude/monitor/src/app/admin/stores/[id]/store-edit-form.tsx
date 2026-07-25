'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import { StoreOptionsFieldset, type StoreOptionsAvail, type StoreOptionState } from '../StoreOptionsFieldset'
import { quotaMessage } from '@/lib/admin/quota-messages'

interface Initial {
  name: string
  address: string | null
  area_code: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
  timezone: string | null
  opt_patrol:  boolean
  opt_alarm:   boolean
  opt_baggage: boolean
}

const ERR_LABELS: Record<string, string> = {
  store_limit_exceeded:  '店舗数が上限に達しています',
  option_not_contracted: 'このテナントで契約していないオプションは ON にできません',
  option_limit_exceeded: 'オプションを ON にできる店舗数が上限に達しています',
}

export function StoreEditForm({
  id, initial, optionsAvail, canManageOptions,
}: {
  id: string
  initial: Initial
  optionsAvail: StoreOptionsAvail
  canManageOptions: boolean
}) {
  const router = useRouter()
  const [form, setForm]   = useState(initial)
  const [opts, setOpts]   = useState<StoreOptionState>({
    opt_patrol: initial.opt_patrol, opt_alarm: initial.opt_alarm, opt_baggage: initial.opt_baggage,
  })
  const [busy, setBusy]   = useState(false)
  const [err,  setErr]    = useState<string | null>(null)
  const [done, setDone]   = useState(false)
  const [warn, setWarn]   = useState<string[]>([])

  async function geocode() {
    if (!form.address) return setErr('住所が空です')
    setErr(null); setBusy(true)
    const res = await fetch(`/api/admin/geocode?addr=${encodeURIComponent(form.address)}`)
    setBusy(false)
    const json = await res.json()
    if (json.error) return setErr(json.error)
    setForm((f) => ({ ...f, latitude: json.lat, longitude: json.lng }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setDone(false); setWarn([])
    const body = {
      name: form.name, address: form.address, area_code: form.area_code,
      latitude: form.latitude, longitude: form.longitude, timezone: form.timezone,
      is_active: form.is_active,
      ...(canManageOptions ? opts : {}),
    }
    const res = await fetch(`/api/admin/stores/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setErr(ERR_LABELS[j.error] ?? (quotaMessage(j.error) || `保存失敗: ${res.status}`))
    }
    const j = await res.json().catch(() => ({}))
    setWarn(((j.warnings ?? []) as string[]).map(quotaMessage))
    setDone(true)
    router.refresh()
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <Field label="店舗名">
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </Field>
      <Field label="住所">
        <div className="flex gap-2">
          <input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })}
                 className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="button" onClick={geocode} disabled={busy || !form.address}
                  className="inline-flex items-center gap-1 rounded bg-slate-700 px-3 text-xs text-white disabled:opacity-50">
            <Globe size={14} strokeWidth={1.5} aria-hidden /> 住所→座標
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="エリアコード">
          <input value={form.area_code ?? ''} onChange={(e) => setForm({ ...form, area_code: e.target.value || null })}
                 className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="例: KANTO" />
        </Field>
        <Field label="緯度">
          <input type="number" step="0.000001" value={form.latitude ?? ''}
                 onChange={(e) => setForm({ ...form, latitude: e.target.value === '' ? null : Number(e.target.value) })}
                 className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono" />
        </Field>
        <Field label="経度">
          <input type="number" step="0.000001" value={form.longitude ?? ''}
                 onChange={(e) => setForm({ ...form, longitude: e.target.value === '' ? null : Number(e.target.value) })}
                 className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono" />
        </Field>
      </div>

      <Field label="タイムゾーン">
        <input value={form.timezone ?? 'Asia/Tokyo'}
               onChange={(e) => setForm({ ...form, timezone: e.target.value })}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </Field>

      {canManageOptions && (
        <StoreOptionsFieldset value={opts} avail={optionsAvail} onChange={setOpts} />
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active}
               onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        この店舗を有効にする
      </label>

      {err  && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
      {done && warn.length === 0 && <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">保存しました</p>}
      {done && warn.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-bold">保存しました（警告あり）</p>
          <ul className="mt-1 list-disc pl-4">{warn.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="submit" disabled={busy}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : '保存'}
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
