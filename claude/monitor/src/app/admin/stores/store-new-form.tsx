'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import { StoreOptionsFieldset, type StoreOptionsAvail, type StoreOptionState } from './StoreOptionsFieldset'
import { quotaMessage } from '@/lib/admin/quota-messages'

interface FormState {
  name:      string
  tenant_id: string | null
  address:   string | null
  area_code: string | null
  latitude:  number | null
  longitude: number | null
  timezone:  string
  is_active: boolean
}

const ERR_LABELS: Record<string, string> = {
  tenant_required:      'テナントを選択してください',
  insufficient_role:    '店舗作成の権限がありません',
  invalid_body:         '入力内容を確認してください',
  store_limit_exceeded: '店舗数が上限に達しています（テナント設定で上限を確認してください）',
  option_not_contracted: 'このテナントで契約していないオプションは ON にできません',
  option_limit_exceeded: 'オプションを ON にできる店舗数が上限に達しています',
}

export function StoreNewForm({
  lockedTenantId,
  tenantName,
  optionsAvail,
}: {
  /** 作成先テナント（tenant_admin=自テナント / super_admin=操作中テナント）。
   *  drop-down は置かない — 選び間違いで他テナントに店舗を作る事故を構造的に防ぐ。 */
  lockedTenantId: string
  tenantName: string | null
  optionsAvail: StoreOptionsAvail
}) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>({
    name: '', tenant_id: lockedTenantId, address: null, area_code: null,
    latitude: null, longitude: null, timezone: 'Asia/Tokyo', is_active: true,
  })
  const [opts, setOpts] = useState<StoreOptionState>({
    opt_patrol: false, opt_alarm: false, opt_baggage: false,
  })
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)
  const [warn, setWarn] = useState<{ id: string; msgs: string[] } | null>(null)

  async function geocode() {
    if (!form.address) return setErr('住所が空です')
    setErr(null); setBusy(true)
    const res = await fetch(`/api/admin/geocode?addr=${encodeURIComponent(form.address)}`)
    setBusy(false)
    const json = await res.json().catch(() => ({}))
    if (json.error) return setErr(json.error)
    setForm((f) => ({ ...f, latitude: json.lat, longitude: json.lng }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    const res = await fetch('/api/admin/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:      form.name,
        tenant_id: lockedTenantId,
        address:   form.address,
        area_code: form.area_code,
        latitude:  form.latitude,
        longitude: form.longitude,
        timezone:  form.timezone,
        is_active: form.is_active,
        opt_patrol:  opts.opt_patrol,
        opt_alarm:   opts.opt_alarm,
        opt_baggage: opts.opt_baggage,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setErr(ERR_LABELS[j.error] ?? (quotaMessage(j.error) || `保存失敗: ${res.status}`))
    }
    const j = await res.json()
    const warns = (j.warnings ?? []) as string[]
    if (warns.length) {
      // 登録は完了。上限超過などの警告を表示し、続けて店舗設定へ誘導。
      setWarn({ id: j.id, msgs: warns.map(quotaMessage) })
      return
    }
    router.push(`/admin/stores/${j.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <Field label="店舗名 *">
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="例: ◯◯店" />
      </Field>

      {/* 作成先テナントは固定表示（変更不可）。切替は「操作中テナント」バーから。 */}
      {tenantName && (
        <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
          作成先テナント: <span className="font-bold">{tenantName}</span>
        </div>
      )}

      <Field label="住所">
        <div className="flex gap-2">
          <input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value || null })}
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
        <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
               className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </Field>

      <StoreOptionsFieldset value={opts} avail={optionsAvail} onChange={setOpts} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active}
               onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        この店舗を有効にする
      </label>

      {warn && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-bold">店舗を作成しました（警告あり）</p>
          <ul className="mt-1 list-disc pl-4">
            {warn.msgs.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => { router.push(`/admin/stores/${warn.id}`); router.refresh() }}
                    className="rounded bg-amber-600 px-3 py-1 font-medium text-white">この店舗の設定へ</button>
            <button type="button" onClick={() => { router.push('/admin/stores'); router.refresh() }}
                    className="rounded border border-amber-400 px-3 py-1">店舗一覧へ</button>
          </div>
        </div>
      )}

      {err && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Link href="/admin/stores"
              className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          キャンセル
        </Link>
        <button type="submit" disabled={busy}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? '作成中…' : '作成'}
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
