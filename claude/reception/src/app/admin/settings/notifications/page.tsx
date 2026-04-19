'use client'

import { useState, useEffect } from 'react'

interface NotificationRule {
  id: string
  event_type: 'checkin' | 'long_stay'
  channel: 'slack' | 'email'
  config: Record<string, string>
  store_id: string | null
  enabled: boolean
  created_at: string
}

interface Store {
  id: string
  name: string
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  checkin: 'チェックイン',
  long_stay: '長時間滞在',
}

const CHANNEL_LABELS: Record<string, string> = {
  slack: 'Slack',
  email: 'メール',
}

export default function NotificationsSettingsPage() {
  const [rules, setRules] = useState<NotificationRule[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [eventType, setEventType] = useState<'checkin' | 'long_stay'>('checkin')
  const [channel, setChannel] = useState<'slack' | 'email'>('slack')
  const [storeId, setStoreId] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/admin/notifications/rules').then(r => r.json()),
      fetch('/api/v1/admin/stores').then(r => r.json()),
    ]).then(([rulesData, storesData]) => {
      setRules(rulesData.rules ?? [])
      setStores(storesData.stores ?? [])
    }).finally(() => setLoading(false))
  }, [])

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
          store_id: storeId || null,
        }),
      })
      const data = await res.json()
      if (data.rule) {
        setRules(prev => [data.rule, ...prev])
        setWebhookUrl('')
        setEmail('')
        setStoreId('')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/v1/admin/notifications/rules?id=${id}`, { method: 'DELETE' })
    if (res.ok) setRules(prev => prev.filter(r => r.id !== id))
  }

  const getStoreName = (id: string | null) => {
    if (!id) return '全店舗'
    return stores.find(s => s.id === id)?.name || id
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-6">通知設定</h1>

      {/* Add new rule */}
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6 max-w-2xl">
        <h2 className="text-base font-semibold text-[#1e3a5f] mb-4">通知ルールを追加</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">イベント</label>
              <select
                value={eventType}
                onChange={e => setEventType(e.target.value as 'checkin' | 'long_stay')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              >
                <option value="checkin">チェックイン</option>
                <option value="long_stay">長時間滞在</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">チャネル</label>
              <select
                value={channel}
                onChange={e => setChannel(e.target.value as 'slack' | 'email')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              >
                <option value="slack">Slack</option>
                <option value="email">メール</option>
              </select>
            </div>
          </div>

          {stores.length > 0 && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">店舗フィルター</label>
              <select
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              >
                <option value="">全店舗</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {channel === 'slack' ? (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Webhook URL</label>
              <input
                type="url"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm text-gray-600 mb-1">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>
          )}

          {formError && (
            <p className="text-sm text-red-500">{formError}</p>
          )}

          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-5 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] disabled:opacity-40"
          >
            {saving ? '追加中...' : 'ルールを追加'}
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div className="bg-white rounded-2xl shadow-sm max-w-2xl">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-base font-semibold text-[#1e3a5f]">設定済みルール</h2>
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
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      rule.channel === 'slack' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {CHANNEL_LABELS[rule.channel]}
                    </span>
                    <span className="text-sm text-gray-700">{EVENT_TYPE_LABELS[rule.event_type]}</span>
                    <span className="text-xs text-gray-400">{getStoreName(rule.store_id)}</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {rule.channel === 'slack'
                      ? (rule.config.webhookUrl || '').slice(0, 50) + '...'
                      : rule.config.email}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="text-sm text-red-400 hover:text-red-600 ml-4 flex-shrink-0"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
