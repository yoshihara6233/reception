'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type Role = 'super_admin' | 'tenant_admin' | 'store_manager' | 'baggage_manager' | 'viewer'

export interface FormInitial {
  email:        string
  display_name: string
  role:         Role
  tenant_id:    string | null
  store_ids:    string[]
}

export interface TenantOpt { id: string; name: string }
export interface StoreOpt  { id: string; name: string; tenant_id: string | null }

interface Props {
  mode:     'create' | 'edit'
  id?:      string                // edit only
  initial:  FormInitial
  tenants:  TenantOpt[]
  stores:   StoreOpt[]
  canCreateSuperAdmin: boolean    // false for tenant_admin
}

const ROLE_LABELS: Record<Role, string> = {
  super_admin:     '全体管理者 (super_admin)',
  tenant_admin:    'テナント管理者 (tenant_admin)',
  store_manager:   '店舗管理者 (store_manager)',
  baggage_manager: '手荷物検査店長 (baggage_manager)',
  viewer:          '閲覧者 (viewer)',
}

export function UserForm({ mode, id, initial, tenants, stores, canCreateSuperAdmin }: Props) {
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // テナント未選択時は「全店舗」ではなく空にする（他テナントの店舗を担当に
  // 割り当てられる誤操作を防ぐ）。テナントを選ぶとその店舗だけが候補に出る。
  const filteredStores = form.tenant_id
    ? stores.filter((s) => s.tenant_id === form.tenant_id)
    : []

  const showStorePicker = form.role === 'store_manager' || form.role === 'baggage_manager' || form.role === 'viewer'

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setDone(false); setBusy(true)

    const url = mode === 'create' ? '/api/admin/users' : `/api/admin/users/${id}`
    const method = mode === 'create' ? 'POST' : 'PUT'

    const body: Record<string, unknown> = {
      display_name: form.display_name,
      role:         form.role,
      tenant_id:    form.tenant_id,
      store_ids:    showStorePicker ? form.store_ids : [],
    }
    if (mode === 'create') {
      body.email    = form.email
      body.password = password
    } else if (password) {
      body.password = password
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(`${j.error ?? `保存失敗: ${res.status}`}${j.message ? ` (${j.message})` : ''}`)
      return
    }
    setDone(true)
    if (mode === 'create') {
      router.push('/admin/users')
      router.refresh()
    } else {
      router.refresh()
    }
  }

  function toggleStore(id: string) {
    setForm((f) => ({
      ...f,
      store_ids: f.store_ids.includes(id)
        ? f.store_ids.filter((x) => x !== id)
        : [...f.store_ids, id],
    }))
  }

  return (
    <form
      onSubmit={save}
      autoComplete="off"
      // Chrome は autoComplete="off" を無視するので、ダミー隠しフィールドで
      // パスワードマネージャを"先に消費"させてから本物のフィールドを置く
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-sm"
    >
      {/* Chrome オートフィル誘導用ダミー (display:none では効かないため off-screen) */}
      <input type="text"     name="fakeusernameremembered"  autoComplete="username"     style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} tabIndex={-1} aria-hidden="true" />
      <input type="password" name="fakepasswordremembered"  autoComplete="new-password" style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} tabIndex={-1} aria-hidden="true" />

      <Field label="メールアドレス *">
        <input
          type="email"
          required
          disabled={mode === 'edit'}
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          autoComplete="off"
          // ブラウザに「これはログインフォームではない」と伝える
          name="new_user_email_field"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-500"
        />
        {mode === 'edit' && (
          <p className="mt-1 text-[11px] text-slate-500">メールは変更できません</p>
        )}
      </Field>

      <Field label={mode === 'create' ? 'パスワード * (8文字以上)' : 'パスワード変更 (空欄なら変更しない)'}>
        <input
          type="password"
          required={mode === 'create'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          name="new_user_password_field"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
          placeholder={mode === 'edit' ? '••••••••' : ''}
        />
      </Field>

      <Field label="表示名 *">
        <input
          required
          value={form.display_name}
          onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="ロール *">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {(canCreateSuperAdmin ? (['super_admin','tenant_admin','store_manager','baggage_manager','viewer'] as Role[]) :
              (['tenant_admin','store_manager','baggage_manager','viewer'] as Role[])).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>

        <Field label="テナント">
          <select
            value={form.tenant_id ?? ''}
            onChange={(e) => setForm({ ...form, tenant_id: e.target.value || null, store_ids: [] })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— 指定なし —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {showStorePicker && (
        <Field label={`担当店舗 (${form.store_ids.length} 件選択中)`}>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-200 p-2">
            {filteredStores.length === 0 ? (
              <p className="text-xs text-slate-400">テナントを選択すると店舗が表示されます</p>
            ) : (
              <ul className="space-y-1">
                {filteredStores.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={form.store_ids.includes(s.id)}
                        onChange={() => toggleStore(s.id)}
                      />
                      <span>{s.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
      )}

      {err  && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
      {done && <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">保存しました</p>}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => router.push('/admin/users')}
          className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
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
