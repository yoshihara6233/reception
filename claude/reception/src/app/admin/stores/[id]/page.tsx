'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSiteConfig } from '@/lib/site-config'

interface Area {
  id: string
  name: string
  qr_token: string
  is_active: boolean
}

interface StoreDetail {
  id: string
  name: string
  address: string | null
  timezone: string
  is_active: boolean
  areas: Area[]
}

export default function StoreDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { locationName } = useSiteConfig()
  const [store, setStore] = useState<StoreDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/admin/stores-list')
    const data = await res.json()
    const found = (data.stores ?? []).find((s: StoreDetail) => s.id === id)
    if (found) {
      setStore(found)
      setName(found.name)
      setAddress(found.address ?? '')
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    await fetch(`/api/v1/admin/stores?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address }),
    })
    setSaving(false)
    setEditing(false)
    load()
  }

  const handleQrPrint = (area: Area) => {
    const qrUrl = `${window.location.origin}/r/${area.qr_token}`
    const printUrl = `/admin/stores/qr-print?name=${encodeURIComponent(area.name)}&url=${encodeURIComponent(qrUrl)}`
    window.open(printUrl, '_blank', 'noopener')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40 text-gray-400">読み込み中...</div>
  )

  if (!store) return (
    <div className="text-center py-12">
      <p className="text-gray-400 mb-4">{locationName}が見つかりません</p>
      <button onClick={() => router.push('/admin/stores')} className="text-[var(--ge-accent)] text-sm underline">
        {locationName}一覧に戻る
      </button>
    </div>
  )

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link href="/admin/stores" className="hover:text-[var(--ge-accent)]">{locationName}・エリア</Link>
        <span>›</span>
        <span className="text-[var(--ge-accent)] font-medium">{store.name}</span>
      </div>

      {/* Store info */}
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">{store.name}</h1>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-[var(--ge-accent)] font-medium px-3 py-1.5 border border-[var(--ge-accent)]/20 rounded-lg hover:bg-[var(--ge-accent)]/5"
            >
              編集
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">{locationName}名 *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">住所</label>
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="px-4 py-2 bg-[var(--ge-accent)] text-white text-sm rounded-lg disabled:opacity-40"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => { setEditing(false); setName(store.name); setAddress(store.address ?? '') }}
                className="px-4 py-2 text-gray-500 text-sm border border-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex gap-4">
              <dt className="text-gray-400 w-20 flex-shrink-0">住所</dt>
              <dd className="text-gray-700">{store.address || '—'}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-400 w-20 flex-shrink-0">タイムゾーン</dt>
              <dd className="text-gray-700">{store.timezone}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-400 w-20 flex-shrink-0">状態</dt>
              <dd>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  store.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {store.is_active ? '稼働中' : '停止中'}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Areas & QR */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-base font-semibold text-[var(--ge-accent)] mb-4">エリア / QRコード</h2>
        {store.areas.length === 0 ? (
          <p className="text-sm text-gray-400">エリアが登録されていません</p>
        ) : (
          <div className="space-y-3">
            {store.areas.map(area => (
              <div key={area.id} className="flex items-center justify-between py-3 px-4 bg-[var(--ge-paper)] rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-800">{area.name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">Token: {area.qr_token.slice(0, 16)}...</p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/r/${area.qr_token}`}
                    target="_blank"
                    className="text-xs text-blue-600 hover:underline px-2 py-1"
                  >
                    Preview
                  </Link>
                  <button
                    onClick={() => handleQrPrint(area)}
                    className="text-xs text-[var(--ge-accent)] font-medium px-2 py-1 hover:underline"
                  >
                    QR印刷
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
