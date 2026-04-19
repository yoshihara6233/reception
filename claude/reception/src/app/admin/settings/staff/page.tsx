'use client'

import { useState, useEffect } from 'react'

interface StaffMember {
  id: string
  name: string
  name_kana: string | null
  email: string | null
  slack_member_id: string | null
  store_id: string | null
  is_active: boolean
}

interface Store { id: string; name: string }

const EMPTY_FORM = { name: '', name_kana: '', email: '', slack_member_id: '', store_id: '' }

export default function StaffSettingsPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const [staffRes, storeRes] = await Promise.all([
      fetch('/api/v1/admin/staff?active=false'),
      fetch('/api/v1/admin/stores'),
    ])
    const [staffData, storeData] = await Promise.all([staffRes.json(), storeRes.json()])
    setStaff(staffData.staff ?? [])
    setStores(storeData.stores ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  const openEdit = (s: StaffMember) => {
    setEditing(s)
    setForm({
      name: s.name,
      name_kana: s.name_kana || '',
      email: s.email || '',
      slack_member_id: s.slack_member_id || '',
      store_id: s.store_id || '',
    })
    setError(null)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('名前は必須です'); return }
    setSaving(true)
    setError(null)

    const payload = {
      name: form.name.trim(),
      name_kana: form.name_kana.trim() || null,
      email: form.email.trim() || null,
      slack_member_id: form.slack_member_id.trim() || null,
      store_id: form.store_id || null,
    }

    const res = editing
      ? await fetch(`/api/v1/admin/staff?id=${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/v1/admin/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || '保存に失敗しました')
      setSaving(false)
      return
    }

    setSaving(false)
    setShowForm(false)
    load()
  }

  const handleDeactivate = async (id: string) => {
    if (!confirm('このスタッフを無効化しますか？')) return
    await fetch(`/api/v1/admin/staff?id=${id}`, { method: 'DELETE' })
    load()
  }

  const handleReactivate = async (id: string) => {
    await fetch(`/api/v1/admin/staff?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    })
    load()
  }

  const activeStaff = staff.filter(s => s.is_active)
  const inactiveStaff = staff.filter(s => !s.is_active)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#1e3a5f]">スタッフ管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            来訪者の訪問先担当者として表示されます。チェックイン時に担当者へメールで通知されます。
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg"
        >
          + 追加
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4 border-2 border-[#1e3a5f]">
          <h2 className="text-sm font-semibold text-[#1e3a5f] mb-4">
            {editing ? 'スタッフ編集' : '新規スタッフ登録'}
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">名前 *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                placeholder="田中 花子"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">よみがな</label>
              <input
                value={form.name_kana}
                onChange={e => setForm(f => ({ ...f, name_kana: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                placeholder="たなか はなこ"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">メールアドレス（通知先）</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                placeholder="hanako@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Slack メンバー ID
                <span className="ml-1 text-gray-400 font-normal">（例: U012AB3CD）</span>
              </label>
              <input
                value={form.slack_member_id}
                onChange={e => setForm(f => ({ ...f, slack_member_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                placeholder="U012AB3CD"
              />
              <p className="text-xs text-gray-400 mt-0.5">
                Slackの「プロフィールを表示」→「…」→「メンバーIDをコピー」から取得できます
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">担当店舗</label>
              <select
                value={form.store_id}
                onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              >
                <option value="">全店舗共通</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="text-red-600 text-xs mt-3">{error}</p>
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 text-gray-500 text-sm font-medium border border-gray-200 rounded-lg"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Active staff list */}
      <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-[#1e3a5f]">有効なスタッフ（{activeStaff.length}名）</p>
        </div>
        {activeStaff.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">スタッフが登録されていません</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeStaff.map(s => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[s.email, s.slack_member_id && `Slack: ${s.slack_member_id}`, s.store_id && stores.find(st => st.id === s.store_id)?.name].filter(Boolean).join(' · ')}
                    {!s.email && !s.slack_member_id && '通知先未設定'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(s)} className="text-xs text-[#1e3a5f] font-medium px-2 py-1 rounded hover:bg-[#1e3a5f]/10">
                    編集
                  </button>
                  <button onClick={() => handleDeactivate(s.id)} className="text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50">
                    無効化
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inactive staff */}
      {inactiveStaff.length > 0 && (
        <div className="bg-gray-50 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">無効なスタッフ（{inactiveStaff.length}名）</p>
          </div>
          <div className="divide-y divide-gray-100">
            {inactiveStaff.map(s => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3 opacity-60">
                <p className="text-sm text-gray-500 line-through">{s.name}</p>
                <button onClick={() => handleReactivate(s.id)} className="text-xs text-emerald-600 font-medium">
                  有効に戻す
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
