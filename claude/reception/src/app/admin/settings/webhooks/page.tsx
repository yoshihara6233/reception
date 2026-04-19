'use client'

import { useState, useEffect } from 'react'

interface WebhookEndpoint {
  id: string
  url: string
  events: string[]
  enabled: boolean
  secret: string
  retry_count: number
  last_error: string | null
  created_at: string
}

interface WebhookDelivery {
  id: string
  endpoint_id: string
  event_type: string
  status: 'delivered' | 'failed' | 'pending'
  http_status: number | null
  attempted_at: string
  duration_ms: number | null
}

const AVAILABLE_EVENTS = [
  { value: 'checkin', label: 'チェックイン' },
  { value: 'long_stay', label: '長時間滞在' },
]

export default function WebhooksSettingsPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  // Form state
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['checkin'])
  const [formError, setFormError] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [epRes, dlRes] = await Promise.all([
        fetch('/api/v1/admin/webhooks'),
        fetch('/api/v1/admin/webhooks/deliveries'),
      ])
      const epData = await epRes.json()
      setEndpoints(epData.endpoints ?? [])
      if (dlRes.ok) {
        const dlData = await dlRes.json()
        setDeliveries(dlData.deliveries ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  const toggleEvent = (event: string) => {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    )
  }

  const handleAdd = async () => {
    setFormError('')
    if (!url.trim()) { setFormError('URLを入力してください'); return }
    if (!selectedEvents.length) { setFormError('イベントを1つ以上選択してください'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/v1/admin/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      })
      const data = await res.json()
      if (data.endpoint) {
        setEndpoints(prev => [{ ...data.endpoint, secret: data.secret }, ...prev])
        setNewSecret(data.secret)
        setUrl('')
        setSelectedEvents(['checkin'])
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/v1/admin/webhooks?id=${id}`, { method: 'DELETE' })
    if (res.ok) setEndpoints(prev => prev.filter(e => e.id !== id))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-6">Webhook設定</h1>

      {/* Secret shown once dialog */}
      {newSecret && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 max-w-2xl">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-amber-800 mb-1">シークレットキー（一度しか表示されません）</h3>
              <code className="block text-sm font-mono bg-white border border-amber-200 rounded px-3 py-2 mt-2 break-all">
                {newSecret}
              </code>
              <p className="text-xs text-amber-600 mt-2">このシークレットを安全な場所に保存してください。再表示はできません。</p>
            </div>
            <button
              onClick={() => setNewSecret(null)}
              className="text-amber-400 hover:text-amber-600 ml-4 flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Add new endpoint */}
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6 max-w-2xl">
        <h2 className="text-base font-semibold text-[#1e3a5f] mb-4">エンドポイントを追加</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">エンドポイントURL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/reception"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">イベント</label>
            <div className="flex gap-4">
              {AVAILABLE_EVENTS.map(ev => (
                <label key={ev.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(ev.value)}
                    onChange={() => toggleEvent(ev.value)}
                    className="rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                  />
                  <span className="text-sm text-gray-700">{ev.label}</span>
                </label>
              ))}
            </div>
          </div>

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-5 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] disabled:opacity-40"
          >
            {saving ? '追加中...' : 'エンドポイントを追加'}
          </button>
        </div>
      </div>

      {/* Endpoints list */}
      <div className="bg-white rounded-2xl shadow-sm max-w-2xl mb-6">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-base font-semibold text-[#1e3a5f]">登録済みエンドポイント</h2>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : endpoints.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">エンドポイントが登録されていません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {endpoints.map(ep => (
              <div key={ep.id} className="p-4 flex items-start justify-between">
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{ep.url}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {ep.events.map(ev => (
                      <span key={ev} className="inline-flex px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                        {ev}
                      </span>
                    ))}
                    <span className={`inline-flex px-2 py-0.5 text-xs rounded ${
                      ep.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {ep.enabled ? '有効' : '無効'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 font-mono">secret: {ep.secret}</p>
                </div>
                <button
                  onClick={() => handleDelete(ep.id)}
                  className="text-sm text-red-400 hover:text-red-600 ml-4 flex-shrink-0"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent deliveries */}
      <div className="bg-white rounded-2xl shadow-sm max-w-2xl">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-base font-semibold text-[#1e3a5f]">直近の配信ログ</h2>
        </div>
        {deliveries.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">配信履歴がありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {deliveries.slice(0, 10).map(d => (
              <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                <span className={`inline-flex w-2 h-2 rounded-full flex-shrink-0 ${
                  d.status === 'delivered' ? 'bg-green-400' : d.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400'
                }`} />
                <span className="text-xs font-mono text-gray-500">{d.event_type}</span>
                {d.http_status && (
                  <span className="text-xs text-gray-400">HTTP {d.http_status}</span>
                )}
                {d.duration_ms && (
                  <span className="text-xs text-gray-400">{d.duration_ms}ms</span>
                )}
                <span className="text-xs text-gray-400 ml-auto">
                  {new Date(d.attempted_at).toLocaleString('ja-JP')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
