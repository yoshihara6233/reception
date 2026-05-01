'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface NotificationRule {
  id: string
  event_type: 'checkin' | 'long_stay'
  channel: 'slack' | 'email'
  config: Record<string, string>
  store_id: string | null
  enabled: boolean
  created_at: string
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  checkin: 'チェックイン',
  long_stay: '長時間滞在',
}

const CHANNEL_LABELS: Record<string, string> = {
  slack: 'Slack',
  email: 'メール',
}

export default function StoreNotificationsPage() {
  const { id: storeId } = useParams<{ id: string }>()
  const [rules, setRules] = useState<NotificationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [eventType, setEventType] = useState<'checkin' | 'long_stay'>('checkin')
  const [channel, setChannel] = useState<'slack' | 'email'>('slack')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/notifications/rules?store_id=${storeId}`)
    const data = await res.json()
    setRules(data.rules ?? [])
    setLoading(false)
  }, [storeId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    setFormError('')
    const config: Record<string, string> = {}
    if (channel === 'slack') {
      if (!webhookUrl.trim()) { setFormError('Webhook URLを入力してください'); return }
      config.webhookUrl = webhookUrl.trim()
    } else {
      if (!email.trim()) { setFormError('メールアドレスを入力してください'); return }
      config.email = email.trim()
    }

    setSaving(true)
    try {
      const res = await fetch('/api/v1/admin/notifications/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: eventType,
          channel,
          config,
          store_id: storeId,
        }),
      })
      const data = await res.json()
      if (data.rule) {
        setRules(prev => [data.rule, ...prev])
        setWebhookUrl('')
        setEmail('')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/v1/admin/notifications/rules?id=${id}`, { method: 'DELETE' })
    if (res.ok) setRules(prev => prev.filter(r => r.id !== id))
  }

  const handleToggle = async (rule: NotificationRule) => {
    const res = await fetch(`/api/v1/admin/notifications/rules?id=${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    if (res.ok) {
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-[var(--ge-accent)]">通知設定</h2>
        <p className="text-sm text-gray-500 mt-1">
          この店舗のチェックインや長時間滞在を Slack / メールで通知します。
        </p>
      </div>

      {/* Add new rule */}
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <h3 className="text-base font-semibold text-[var(--ge-accent)] mb-4">通知ルールを追加</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">イベント</label>
              <select
                value={eventType}
                onChange={e => setEventType(e.target.value as 'checkin' | 'long_stay')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              >
                <option value="checkin">チェックイン</option>
                <option value="long_stay">長時間滞在</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">チャネル</label>
              <select
                value={channel}
                onChange={e => setChannel(e.target.value as 'slack' | 'email')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              >
                <option value="slack">Slack</option>
                <option value="email">メール</option>
              </select>
            </div>
          </div>

          {channel === 'slack' ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Webhook URL</label>
              <input
                type="url"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              />
            </div>
          )}

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-5 py-2 bg-[var(--ge-accent)] text-white text-sm rounded-lg hover:bg-[var(--ge-accent-ink)] disabled:opacity-40"
          >
            {saving ? '追加中...' : 'ルールを追加'}
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div className="bg-white rounded-2xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-[var(--ge-accent)]">設定済みルール</h3>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">通知ルールがありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rules.map(rule => (
              <div key={rule.id} className="p-4 flex items-center justify-between">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      rule.channel === 'slack' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {CHANNEL_LABELS[rule.channel]}
                    </span>
                    <span className="text-sm text-gray-700">{EVENT_TYPE_LABELS[rule.event_type]}</span>
                    <span className={`inline-flex px-2 py-0.5 text-xs rounded ${
                      rule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {rule.enabled ? '有効' : '無効'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {rule.channel === 'slack'
                      ? rule.config.webhookUrl
                      : rule.config.email}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(rule)}
                    className={`text-xs font-medium px-2 py-1 rounded ${
                      rule.enabled
                        ? 'text-gray-500 hover:bg-gray-100'
                        : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {rule.enabled ? '無効化' : '有効化'}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
