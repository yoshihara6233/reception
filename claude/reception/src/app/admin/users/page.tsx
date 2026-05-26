'use client'

import { useState, useEffect } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'

interface AdminUser {
  id: string
  email: string
  name: string
  role: string
  store_ids: string[]
  created_at: string
}

export default function UsersPage() {
  const { t, locale } = useLocale()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  async function handleDeleteUser(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？この操作は取り消せません。`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/v1/admin/users?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '削除に失敗しました')
        return
      }
      await fetchUsers()
    } finally {
      setDeletingId(null)
    }
  }

  async function fetchUsers() {
    setLoading(true)
    const res = await fetch('/api/v1/admin/users-list')
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }

  const roleLabels: Record<string, string> = {
    super_admin: t('admin.roleTenantAdmin'),
    tenant_admin: t('admin.roleTenantAdmin'),
    store_manager: t('admin.roleStoreManager'),
    viewer: t('admin.roleViewer'),
  }

  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('admin.users')}</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c]"
        >
          + {t('admin.addUser')}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#f0f2f5] border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.userName')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.email')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.role')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium text-xs">登録日</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">{t('common.loading')}</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">{t('admin.noUsers')}</td></tr>
            ) : (
              users.map(user => (
                <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-[#1e3a5f]">{user.name}</td>
                  <td className="px-6 py-3 text-gray-600">{user.email}</td>
                  <td className="px-6 py-3">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#1e3a5f]/10 text-[#1e3a5f]">
                      {roleLabels[user.role] || user.role}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-400 text-xs">
                    {new Date(user.created_at).toLocaleDateString(dateLocale)}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="text-xs text-[#1e3a5f] hover:underline font-medium px-2 py-1 rounded hover:bg-[#1e3a5f]/10"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id, user.name)}
                        disabled={deletingId === user.id}
                        className="text-xs text-red-500 hover:underline font-medium px-2 py-1 rounded hover:bg-red-50 disabled:opacity-40"
                      >
                        {deletingId === user.id ? '削除中...' : '削除'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <UserModal
          mode="add"
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); fetchUsers() }}
        />
      )}

      {editingUser && (
        <UserModal
          mode="edit"
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); fetchUsers() }}
        />
      )}
    </div>
  )
}

function UserModal({
  mode, user, onClose, onSaved,
}: {
  mode: 'add' | 'edit'
  user?: AdminUser
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState(user?.role ?? 'viewer')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    if (mode === 'add' && !email.trim()) return
    setSubmitting(true)
    setError(null)

    let res: Response
    if (mode === 'add') {
      res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role }),
      })
    } else {
      res = await fetch(`/api/v1/admin/users?id=${user!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role }),
      })
    }

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || t('common.error'))
      setSubmitting(false)
      return
    }

    onSaved()
  }

  const title = mode === 'add' ? t('admin.addUser') : 'ユーザ編集'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-[#1e3a5f] mb-4">{title}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">{t('admin.userName')} *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">{t('admin.emailLabel')}{mode === 'add' ? ' *' : ''}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={mode === 'edit'}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] disabled:bg-gray-50 disabled:text-gray-400"
              required={mode === 'add'}
            />
            {mode === 'edit' && (
              <p className="text-xs text-gray-400 mt-1">メールアドレスは変更できません</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">{t('admin.role')}</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            >
              <option value="viewer">{t('admin.roleViewer')}</option>
              <option value="store_manager">{t('admin.roleStoreManager')}</option>
              <option value="tenant_admin">{t('admin.roleTenantAdmin')}</option>
            </select>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={submitting} className="flex-1 py-3 bg-[#1e3a5f] text-white rounded-xl font-medium disabled:opacity-40">
              {submitting ? t('common.loading') : mode === 'add' ? t('admin.addUser') : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
