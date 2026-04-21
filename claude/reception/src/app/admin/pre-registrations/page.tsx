'use client'

import { useState, useEffect } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'

interface Area {
  id: string
  name: string
  qr_token: string
}

interface Store {
  id: string
  name: string
  areas: Area[]
}

interface StaffMember {
  id: string
  name: string
  name_kana: string | null
}

interface PreRegistration {
  id: string
  visitor_company: string
  visitor_name: string
  visitor_email: string | null
  visitor_phone: string | null
  purpose: string
  token: string
  expires_at: string
  used_at: string | null
  cancelled_at: string | null
  created_at: string
  stores: { id: string; name: string } | null
  areas: { id: string; name: string } | null
  staff_members: { id: string; name: string } | null
}

type Status = 'active' | 'used' | 'expired' | 'cancelled'

function getStatus(pr: PreRegistration): Status {
  if (pr.cancelled_at) return 'cancelled'
  if (pr.used_at) return 'used'
  if (new Date(pr.expires_at) < new Date()) return 'expired'
  return 'active'
}

const STATUS_LABELS: Record<Status, { label: string; color: string }> = {
  active:    { label: '有効',         color: 'bg-emerald-100 text-emerald-700' },
  used:      { label: '使用済み',      color: 'bg-blue-100 text-blue-700' },
  expired:   { label: '期限切れ',      color: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'キャンセル済み', color: 'bg-red-100 text-red-600' },
}

const DEFAULT_PURPOSES = ['定期配送', 'メンテナンス', '商談', '監査', 'その他']

export function PreRegistrationsContent({ lockedStoreId }: { lockedStoreId?: string } = {}) {
  const { t } = useLocale()
  const [preRegs, setPreRegs] = useState<PreRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all')

  // Form state
  const [stores, setStores] = useState<Store[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [visitPurposes, setVisitPurposes] = useState<string[]>(DEFAULT_PURPOSES)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [form, setForm] = useState({
    visitorCompany: '',
    visitorName: '',
    visitorEmail: '',
    visitorPhone: '',
    purpose: '',
    contactPersonId: '',
    expiresInHours: '48',
  })
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  useEffect(() => {
    fetchPreRegs()
    fetchStores()
    // 受付設定の訪問目的を取得
    fetch('/api/v1/admin/settings')
      .then(r => r.ok ? r.json() : { settings: {} })
      .then((data: { settings?: { visit_purposes?: string[] } }) => {
        if (Array.isArray(data.settings?.visit_purposes) && (data.settings?.visit_purposes?.length ?? 0) > 0) {
          setVisitPurposes(data.settings!.visit_purposes!)
        }
      })
      .catch(() => {})
  }, [])

  async function fetchPreRegs() {
    setLoading(true)
    const res = await fetch('/api/v1/admin/pre-registrations')
    const data = await res.json()
    setPreRegs(data.preRegistrations || [])
    setLoading(false)
  }

  async function fetchStores() {
    const res = await fetch('/api/v1/admin/stores-list')
    const data = await res.json()
    setStores(data.stores || [])
  }

  async function fetchStaff(storeId: string) {
    if (!storeId) { setStaffList([]); return }
    const res = await fetch(`/api/v1/admin/staff?storeId=${storeId}`)
    const data = await res.json()
    setStaffList(data.staff || [])
  }

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId)
    setSelectedAreaId('')
    fetchStaff(storeId)
  }

  const selectedStore = stores.find(s => s.id === selectedStoreId)
  const availableAreas = selectedStore?.areas || []

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setCreateError(null)

    const res = await fetch('/api/v1/admin/pre-registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        storeId: selectedStoreId,
        areaId: selectedAreaId,
        expiresInHours: Number(form.expiresInHours),
        contactPersonId: form.contactPersonId || null,
      }),
    })

    const data = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      setCreateError(data.error || '作成に失敗しました')
      return
    }

    setCreatedToken(data.token)
    fetchPreRegs()
  }

  async function handleCancel(id: string) {
    if (!confirm('この事前登録をキャンセルしますか？')) return
    await fetch('/api/v1/admin/pre-registrations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchPreRegs()
  }

  function getPreRegUrl(pr: PreRegistration): string {
    return `${window.location.origin}/pre/${pr.token}`
  }

  async function copyUrl(pr: PreRegistration) {
    await navigator.clipboard.writeText(getPreRegUrl(pr))
    setCopiedToken(pr.token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  function handlePrintQr(pr: PreRegistration) {
    const url = getPreRegUrl(pr)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html>
<html><head><title>事前登録QR - ${pr.visitor_name}</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"><\/script>
<style>
  body { font-family: sans-serif; text-align: center; padding: 40px; }
  h2 { color: #1e3a5f; }
  p { color: #666; font-size: 14px; }
  canvas { border: 1px solid #eee; border-radius: 8px; }
  .url { font-size: 10px; color: #999; margin-top: 12px; word-break: break-all; }
  @media print { body { padding: 20px; } }
</style></head><body>
  <h2>🎫 事前登録QR</h2>
  <p>${pr.visitor_name} 様（${pr.visitor_company}）</p>
  <p style="color:#999;font-size:12px">${pr.areas?.name || ''}</p>
  <canvas id="qr"></canvas>
  <div class="url">${url}</div>
  <script>
    QRCode.toCanvas(document.getElementById('qr'), '${url}', { width: 256, margin: 2 }, function() {
      setTimeout(function() { window.print(); }, 500);
    });
  <\/script>
</body></html>`)
    win.document.close()
  }

  const filtered = filterStatus === 'all'
    ? preRegs
    : preRegs.filter(pr => getStatus(pr) === filterStatus)

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const resetModal = () => {
    setShowModal(false)
    setCreatedToken(null)
    setCreateError(null)
    setSelectedStoreId('')
    setSelectedAreaId('')
    setForm({ visitorCompany: '', visitorName: '', visitorEmail: '', visitorPhone: '', purpose: '', contactPersonId: '', expiresInHours: '48' })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">事前登録管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">来訪者へQRコードを事前発行できます</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] flex items-center gap-2"
        >
          <span>＋</span> 事前登録を作成
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'active', 'used', 'expired', 'cancelled'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterStatus === s
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-[#1e3a5f]'
            }`}
          >
            {s === 'all' ? 'すべて'
              : s === 'active' ? '有効'
              : s === 'used' ? '使用済み'
              : s === 'expired' ? '期限切れ'
              : 'キャンセル'}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400">
          <p className="text-3xl mb-3">🎫</p>
          <p className="text-sm">事前登録がありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-3">来訪者</th>
                <th className="text-left px-4 py-3">目的</th>
                <th className="text-left px-4 py-3">店舗 / エリア</th>
                <th className="text-left px-4 py-3">有効期限</th>
                <th className="text-left px-4 py-3">ステータス</th>
                <th className="text-left px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(pr => {
                const status = getStatus(pr)
                const { label, color } = STATUS_LABELS[status]
                return (
                  <tr key={pr.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#1e3a5f]">{pr.visitor_name}</p>
                      <p className="text-xs text-gray-400">{pr.visitor_company}</p>
                      {pr.visitor_email && <p className="text-xs text-gray-400">{pr.visitor_email}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-[120px]">
                      <span className="line-clamp-2">{pr.purpose}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <p>{pr.stores?.name}</p>
                      <p className="text-xs text-gray-400">{pr.areas?.name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {formatDate(pr.expires_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => copyUrl(pr)}
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
                          title="URLをコピー"
                        >
                          {copiedToken === pr.token ? '✅' : '📋'}
                        </button>
                        <button
                          onClick={() => handlePrintQr(pr)}
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
                          title="QRコードを印刷"
                        >
                          🖨️
                        </button>
                        <a
                          href={`/pre/${pr.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
                          title="来訪者ページを開く"
                        >
                          🔗
                        </a>
                        {status === 'active' && (
                          <button
                            onClick={() => handleCancel(pr.id)}
                            className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 rounded-lg text-red-600 transition-colors"
                            title="キャンセル"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-[#1e3a5f]">🎫 事前登録を作成</h2>
              <button onClick={resetModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            {createdToken ? (
              <CreatedSuccess
                token={createdToken}
                origin={typeof window !== 'undefined' ? window.location.origin : ''}
                onClose={resetModal}
              />
            ) : (
              <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
                {/* Store */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    店舗 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedStoreId}
                    onChange={e => handleStoreChange(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  >
                    <option value="">店舗を選択...</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Area */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    エリア <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedAreaId}
                    onChange={e => setSelectedAreaId(e.target.value)}
                    required
                    disabled={!selectedStoreId}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] disabled:opacity-50"
                  >
                    <option value="">エリアを選択...</option>
                    {availableAreas.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">来訪者情報</p>
                </div>

                {/* Company */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    会社名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.visitorCompany}
                    onChange={e => setForm(f => ({ ...f, visitorCompany: e.target.value }))}
                    placeholder="株式会社〇〇"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    お名前 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.visitorName}
                    onChange={e => setForm(f => ({ ...f, visitorName: e.target.value }))}
                    placeholder="山田 太郎"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                  <input
                    type="email"
                    value={form.visitorEmail}
                    onChange={e => setForm(f => ({ ...f, visitorEmail: e.target.value }))}
                    placeholder="taro@example.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
                  <input
                    type="tel"
                    value={form.visitorPhone}
                    onChange={e => setForm(f => ({ ...f, visitorPhone: e.target.value }))}
                    placeholder="090-1234-5678"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                </div>

                {/* Purpose */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    訪問目的 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.purpose}
                    onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  >
                    <option value="">訪問目的を選択...</option>
                    {visitPurposes.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* Contact person */}
                {staffList.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">担当スタッフ</label>
                    <select
                      value={form.contactPersonId}
                      onChange={e => setForm(f => ({ ...f, contactPersonId: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                    >
                      <option value="">未設定</option>
                      {staffList.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Expiry */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">有効期限</label>
                  <select
                    value={form.expiresInHours}
                    onChange={e => setForm(f => ({ ...f, expiresInHours: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  >
                    <option value="24">24時間</option>
                    <option value="48">48時間（デフォルト）</option>
                    <option value="72">72時間</option>
                    <option value="168">7日間</option>
                  </select>
                </div>

                {createError && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                    {createError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={resetModal}
                    className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-semibold hover:bg-[#2c4f7c] disabled:opacity-40"
                  >
                    {submitting ? '作成中...' : '🎫 QRを発行する'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PreRegistrationsPage() {
  return <PreRegistrationsContent />
}

// Success screen after creation
function CreatedSuccess({ token, origin, onClose }: { token: string; origin: string; onClose: () => void }) {
  const url = `${origin}/pre/${token}`
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="px-6 py-6 text-center">
      <div className="text-5xl mb-4">🎉</div>
      <h3 className="text-lg font-semibold text-[#1e3a5f] mb-2">事前登録QRを発行しました</h3>
      <p className="text-sm text-gray-500 mb-6">
        以下のURLを来訪者にメール等でお送りください。<br />
        来訪者はこのURLからQRコードを表示して受付を行います。
      </p>

      <div className="bg-gray-50 rounded-xl p-4 mb-4 text-left">
        <p className="text-xs text-gray-400 mb-1">来訪者URL</p>
        <p className="text-sm text-[#1e3a5f] font-mono break-all">{url}</p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleCopy}
          className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
        >
          <span>{copied ? '✅' : '📋'}</span>
          {copied ? 'コピーしました' : 'URLをコピー'}
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-semibold hover:bg-[#2c4f7c]"
        >
          閉じる
        </button>
      </div>
    </div>
  )
}
