'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

interface Area {
  id: string
  name: string
  qr_token: string
  is_active: boolean
}

interface Store {
  id: string
  name: string
  address: string | null
  is_active: boolean
  areas: Area[]
}

export default function StoresPage() {
  const { t } = useLocale()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    fetchStores()
  }, [])

  async function fetchStores() {
    const res = await fetch('/api/v1/admin/stores-list')
    const data = await res.json()
    setStores(data.stores || [])
    setLoading(false)
  }

  const handleQrPrint = (area: Area) => {
    const qrUrl = `${window.location.origin}/r/${area.qr_token}`
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>QR Code - ${area.name}</title>
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"><\/script>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 40px; }
        h2 { color: #1e3a5f; margin-bottom: 8px; }
        p { color: #666; font-size: 14px; margin-bottom: 24px; }
        canvas { border: 1px solid #eee; border-radius: 8px; }
        .url { font-size: 11px; color: #999; margin-top: 16px; word-break: break-all; }
        @media print { body { padding: 20px; } }
      </style></head><body>
        <h2>${area.name}</h2>
        <p>${t('admin.qrCode')}</p>
        <canvas id="qr"></canvas>
        <div class="url">${qrUrl}</div>
        <script>
          QRCode.toCanvas(document.getElementById('qr'), '${qrUrl}', { width: 256, margin: 2 }, function() {
            setTimeout(function() { window.print(); }, 500);
          });
        <\/script>
      </body></html>
    `)
    printWindow.document.close()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('admin.stores')}</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c]"
        >
          + {t('admin.addStore')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
      ) : stores.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-400">
          {t('admin.noStores')}
        </div>
      ) : (
        <div className="space-y-4">
          {stores.map(store => (
            <div key={store.id} className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-[#1e3a5f]">{store.name}</h3>
                  {store.address && <p className="text-sm text-gray-400 mt-1">{store.address}</p>}
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  store.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {store.is_active ? '✓' : '✗'}
                </span>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider">{t('admin.area')} / {t('admin.qrCode')}</p>
                <div className="space-y-2">
                  {store.areas?.map(area => (
                    <div key={area.id} className="flex items-center justify-between py-2 px-3 bg-[#f0f2f5] rounded-lg">
                      <div>
                        <span className="text-sm font-medium text-gray-700">{area.name}</span>
                        <span className="text-xs text-gray-400 ml-3">Token: {area.qr_token.slice(0, 12)}...</span>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/r/${area.qr_token}`}
                          target="_blank"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Preview
                        </Link>
                        <button
                          onClick={() => handleQrPrint(area)}
                          className="text-xs text-[#1e3a5f] font-medium hover:underline"
                        >
                          {t('admin.printQr')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Store Modal */}
      {showAddModal && (
        <AddStoreModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); fetchStores() }}
        />
      )}
    </div>
  )
}

function AddStoreModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { t } = useLocale()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/v1/admin/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || t('common.error'))
      setSubmitting(false)
      return
    }

    onAdded()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-[#1e3a5f] mb-4">{t('admin.addStore')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">{t('admin.storeName')} *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1e3a5f] mb-1">{t('admin.address')}</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={submitting} className="flex-1 py-3 bg-[#1e3a5f] text-white rounded-xl font-medium disabled:opacity-40">
              {submitting ? t('common.loading') : t('admin.addStore')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
