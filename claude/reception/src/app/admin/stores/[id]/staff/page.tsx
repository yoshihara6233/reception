'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface StaffMember {
  id: string
  name: string
  name_kana: string | null
  email: string | null
  slack_member_id: string | null
  store_id: string | null
  is_active: boolean
}

const EMPTY_FORM = { name: '', name_kana: '', email: '', slack_member_id: '' }

export default function StoreStaffPage() {
  const { id: storeId } = useParams<{ id: string }>()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/staff?active=false&store_id=${storeId}`)
    const data = await res.json()
    setStaff(data.staff ?? [])
    setLoading(false)
  }, [storeId])

  useEffect(() => { load() }, [load])

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
      store_id: storeId,
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
        <div className="w-6 h-6 border-2 border-[var(--ge-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ge-accent)]">スタッフ管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            来訪者の訪問先担当者として表示されます。チェックイン時に通知されます。
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[var(--ge-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--ge-accent-ink)]"
        >
          + 追加
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4 border-2 border-[var(--ge-accent)]">
          <h3 className="text-sm font-semibold text-[var(--ge-accent)] mb-4">
            {editing ? 'スタッフ編集' : '新規スタッフ登録'}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">名前 *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                placeholder="田中 花子"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">よみがな</label>
              <input
                value={form.name_kana}
                onChange={e => setForm(f => ({ ...f, name_kana: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                placeholder="たなか はなこ"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">メールアドレス（通知先）</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
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
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                placeholder="U012AB3CD"
              />
              <p className="text-xs text-gray-400 mt-0.5">
                Slackの「プロフィールを表示」→「…」→「メンバーIDをコピー」から取得できます
              </p>
            </div>
          </div>

          {error && <p className="text-red-600 text-xs mt-3">{error}</p>}

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-[var(--ge-accent)] text-white text-sm font-medium rounded-lg disabled:opacity-40"
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
          <p className="text-sm font-semibold text-[var(--ge-accent)]">有効なスタッフ（{activeStaff.length}名）</p>
        </div>
        {activeStaff.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">スタッフが登録されていません</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeStaff.map(s => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.name}</p>
                  {s.name_kana && <p className="text-xs text-gray-400">{s.name_kana}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[s.email, s.slack_member_id && `Slack: ${s.slack_member_id}`].filter(Boolean).join(' · ') || '通知先未設定'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(s)} className="text-xs text-[var(--ge-accent)] font-medium px-2 py-1 rounded hover:bg-[var(--ge-accent)]/10">
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
