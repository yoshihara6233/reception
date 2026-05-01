'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { UserCircle, Briefcase, Camera, Trash2, Edit2, Plus, Search, RefreshCw, QrCode, Printer, X, ArrowUpRight, Clock } from 'lucide-react'
import QRCode from 'qrcode'

// ── 型 ────────────────────────────────────────────────────────────────────────

interface Person {
  id: string
  name: string
  company: string
  department: string | null
  phone: string | null
  email: string | null
  person_type: 'employee' | 'external' | 'visitor'
  employee_code: string | null
  notes: string | null
  face_id: string | null
  face_registered_at: string | null
  face_photo_path: string | null
  facePhotoUrl: string | null
  is_registered: boolean
  created_at: string
  lastVisitAt?: string | null
}

interface Area {
  id: string
  name: string
  qr_token: string
  is_active: boolean
}

interface Store {
  id: string
  name: string
  areas: Area[]
}

type TabType = 'employee' | 'external' | 'primary'

// ── メインページ ──────────────────────────────────────────────────────────────

export default function PersonsPage() {
  const [tab, setTab] = useState<TabType>('employee')
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editPerson, setEditPerson] = useState<Person | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [qrPerson, setQrPerson] = useState<Person | null>(null)
  const [promotePerson, setPromotePerson] = useState<Person | null>(null)
  const [stores, setStores] = useState<Store[]>([])

  const fetchPersons = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ type: tab })
    if (q) params.set('q', q)
    const res = await fetch(`/api/v1/admin/persons?${params}`)
    const data = await res.json()
    setPersons(data.persons || [])
    setLoading(false)
  }, [tab, q])

  // 一次受付者タブに切り替えたら検索バーをリセット
  useEffect(() => { setQ('') }, [tab])

  useEffect(() => { fetchPersons() }, [fetchPersons])

  useEffect(() => {
    fetch('/api/v1/admin/stores-list')
      .then(r => r.json())
      .then(d => setStores(d.stores || []))
      .catch(() => {})
  }, [])

  async function handleDelete(person: Person) {
    if (!confirm(`「${person.name}」を削除しますか？顔登録データも削除されます。`)) return
    setDeletingId(person.id)
    await fetch(`/api/v1/admin/persons?id=${person.id}`, { method: 'DELETE' })
    setDeletingId(null)
    fetchPersons()
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 500,
    color: active ? '#1e3a5f' : '#9ca3af',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #1e3a5f' : '2px solid transparent',
    whiteSpace: 'nowrap',
  })

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">来店者管理</h1>
        <button
          onClick={() => { setEditPerson(null); setShowModal(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c]"
        >
          <Plus size={14} />
          新規登録
        </button>
      </div>

      {/* タブ + 検索 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-4">
        <div className="flex border-b border-gray-100 px-4">
          <button style={tabStyle(tab === 'employee')} onClick={() => setTab('employee')}>
            <span className="flex items-center gap-1.5">
              <Briefcase size={13} />
              従業員
            </span>
          </button>
          <button style={tabStyle(tab === 'external')} onClick={() => setTab('external')}>
            <span className="flex items-center gap-1.5">
              <UserCircle size={13} />
              外部登録者
            </span>
          </button>
          <button style={tabStyle(tab === 'primary')} onClick={() => setTab('primary')}>
            <span className="flex items-center gap-1.5">
              <Clock size={13} />
              一次受付者
            </span>
          </button>
        </div>

        {/* 検索バー */}
        <div className="p-3 border-b border-gray-50 flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchPersons()}
              placeholder={tab === 'employee' ? '名前・社員番号・メールで検索' : tab === 'external' ? '名前・会社・メールで検索' : '名前・会社で検索'}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>
          <button
            onClick={fetchPersons}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* テーブル */}
        <table className="w-full text-sm">
          <thead className="bg-[#f8f9fb] text-gray-400 font-medium text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">名前</th>
              {tab === 'employee' ? (
                <th className="text-left px-4 py-3">社員番号</th>
              ) : tab === 'external' ? (
                <th className="text-left px-4 py-3">会社</th>
              ) : (
                <th className="text-left px-4 py-3">会社 / 部署</th>
              )}
              {tab === 'primary' ? (
                <th className="text-left px-4 py-3">直近来訪</th>
              ) : (
                <th className="text-left px-4 py-3">連絡先</th>
              )}
              <th className="text-left px-4 py-3">顔認証</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">読み込み中...</td></tr>
            ) : persons.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">
                {q ? '該当する登録者が見つかりません' : tab === 'employee' ? '従業員が登録されていません' : tab === 'external' ? '外部登録者が登録されていません' : '直近30日以内に来訪した未登録者がいません'}
              </td></tr>
            ) : (
              persons.map(person => (
                <tr key={person.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-[#1e3a5f]/10 flex items-center justify-center text-[#1e3a5f] font-semibold text-sm flex-shrink-0">
                        {person.facePhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={person.facePhotoUrl}
                            alt={person.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          person.name.slice(0, 1)
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-[#1e3a5f]">{person.name}</div>
                        {person.department && <div className="text-xs text-gray-400">{person.department}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {tab === 'employee'
                      ? (person.employee_code || <span className="text-gray-300">—</span>)
                      : (person.company || <span className="text-gray-300">—</span>)
                    }
                  </td>
                  {tab === 'primary' ? (
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {person.lastVisitAt
                        ? new Date(person.lastVisitAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                  ) : (
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      <div>{person.email || '—'}</div>
                      <div>{person.phone || ''}</div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {person.face_id ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                        <Camera size={10} />
                        登録済み
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                        未登録
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {tab === 'primary' ? (
                        <>
                          <button
                            onClick={() => setPromotePerson(person)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1e3a5f] bg-[#1e3a5f]/10 hover:bg-[#1e3a5f]/20 rounded-lg"
                            title="従業員または外部登録者に移行"
                          >
                            <ArrowUpRight size={12} />
                            移行する
                          </button>
                          <button
                            onClick={() => handleDelete(person)}
                            disabled={deletingId === person.id}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-40"
                            title="削除"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          {/* QR発行ボタン */}
                          <button
                            onClick={() => setQrPerson(person)}
                            className="p-1.5 text-gray-400 hover:text-[#1e3a5f] hover:bg-[#1e3a5f]/10 rounded-lg"
                            title="顔登録QRを発行"
                          >
                            <QrCode size={13} />
                          </button>
                          <button
                            onClick={() => { setEditPerson(person); setShowModal(true) }}
                            className="p-1.5 text-gray-400 hover:text-[#1e3a5f] hover:bg-[#1e3a5f]/10 rounded-lg"
                            title="編集"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(person)}
                            disabled={deletingId === person.id}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-40"
                            title="削除"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 説明テキスト */}
      <p className="text-xs text-gray-400 leading-relaxed px-1">
        {tab === 'employee'
          ? '従業員は受付キオスクで顔登録ができます。顔認証で受付・入退館が可能になります。'
          : tab === 'external'
          ? '外部登録者（取引先・常連訪問者等）は一度顔登録すると、次回から顔認証で受付できます。'
          : '直近30日以内に来訪した未登録の訪問者です。「移行する」から従業員・外部登録者として正式登録できます。30日を過ぎると一覧から外れます。'}
      </p>

      {/* 登録・編集モーダル */}
      {showModal && (
        <PersonModal
          mode={editPerson ? 'edit' : 'add'}
          defaultTab={tab}
          person={editPerson ?? undefined}
          onClose={() => { setShowModal(false); setEditPerson(null) }}
          onSaved={() => { setShowModal(false); setEditPerson(null); fetchPersons() }}
        />
      )}

      {/* QR発行モーダル */}
      {qrPerson && (
        <QrModal
          person={qrPerson}
          stores={stores}
          onClose={() => setQrPerson(null)}
        />
      )}

      {/* 移行モーダル（一次受付者 → 従業員 / 外部登録者） */}
      {promotePerson && (
        <PromoteModal
          person={promotePerson}
          onClose={() => setPromotePerson(null)}
          onSaved={() => { setPromotePerson(null); fetchPersons() }}
        />
      )}
    </div>
  )
}

// ── 移行モーダル（一次受付者 → 従業員 / 外部登録者） ────────────────────────────

function PromoteModal({
  person,
  onClose,
  onSaved,
}: {
  person: Person
  onClose: () => void
  onSaved: () => void
}) {
  const [personType, setPersonType] = useState<'employee' | 'external'>('external')
  const [name, setName] = useState(person.name)
  const [company, setCompany] = useState(person.company ?? '')
  const [department, setDepartment] = useState(person.department ?? '')
  const [phone, setPhone] = useState(person.phone ?? '')
  const [email, setEmail] = useState(person.email ?? '')
  const [employeeCode, setEmployeeCode] = useState('')
  const [notes, setNotes] = useState(person.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError(null)

    const body = {
      name,
      company,
      department,
      phone,
      email,
      person_type: personType,
      employee_code: employeeCode,
      notes,
      promote: true,
    }

    const res = await fetch(`/api/v1/admin/persons?id=${person.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'エラーが発生しました')
      setSubmitting(false)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-[#1e3a5f]">登録者に移行する</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-5">
          一次受付者として記録された来訪者を従業員または外部登録者として正式登録します。
        </p>

        {/* 元の訪問者情報 */}
        <div className="flex items-center gap-3 mb-5 p-3 bg-[#f8f9fb] rounded-xl">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-[#1e3a5f]/10 flex items-center justify-center text-[#1e3a5f] font-semibold text-sm flex-shrink-0">
            {person.facePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={person.facePhotoUrl} alt={person.name} className="w-full h-full object-cover" />
            ) : (
              person.name.slice(0, 1)
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-[#1e3a5f]">{person.name}</div>
            <div className="text-xs text-gray-400">
              {person.company && `${person.company} `}
              {person.lastVisitAt && `・直近来訪: ${new Date(person.lastVisitAt).toLocaleDateString('ja-JP')}`}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 移行先種別 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">移行先</label>
            <div className="flex gap-2">
              {(['employee', 'external'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPersonType(t)}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                    personType === t
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'border-gray-200 text-gray-500 hover:border-[#1e3a5f]/40'
                  }`}
                >
                  {t === 'employee' ? '従業員' : '外部登録者'}
                </button>
              ))}
            </div>
          </div>

          {/* 名前 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">名前 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              required
            />
          </div>

          {/* 従業員番号 */}
          {personType === 'employee' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">社員番号</label>
              <input
                type="text"
                value={employeeCode}
                onChange={e => setEmployeeCode(e.target.value)}
                placeholder="例: EMP-001"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              />
            </div>
          )}

          {/* 会社名 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">会社名</label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>

          {/* 部署 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">部署</label>
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>

          {/* メール・電話 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">メール</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">電話番号</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              />
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">メモ</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 resize-none"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 bg-[#1e3a5f] text-white rounded-xl text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <ArrowUpRight size={14} />
              {submitting ? '処理中...' : '移行する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── QR発行モーダル ─────────────────────────────────────────────────────────────

function QrModal({
  person,
  stores,
  onClose,
}: {
  person: Person
  stores: Store[]
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const allAreas = stores.flatMap(s => s.areas.filter(a => a.is_active).map(a => ({ ...a, storeName: s.name })))
  const [selectedToken, setSelectedToken] = useState(allAreas[0]?.qr_token ?? '')
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!selectedToken) return
    const origin = window.location.origin
    const u = `${origin}/r/${selectedToken}/face-register?visitorId=${person.id}&lang=ja`
    setUrl(u)
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, u, {
        width: 240,
        margin: 2,
        color: { dark: '#1e3a5f', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [selectedToken, person.id])

  const handlePrint = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const dataUrl = canvasRef.current?.toDataURL('image/png') ?? ''
    win.document.write(`
      <html><head><title>${person.name} 顔登録QR</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; gap: 12px; }
        h2 { font-size: 18px; color: #1e3a5f; margin: 0; }
        p { font-size: 12px; color: #6b7280; margin: 0; }
        img { width: 240px; height: 240px; }
        .url { font-size: 10px; color: #9ca3af; word-break: break-all; max-width: 280px; text-align: center; }
      </style></head>
      <body>
        <h2>${person.name}</h2>
        <p>顔認証登録用QRコード</p>
        <img src="${dataUrl}" />
        <p class="url">${url}</p>
        <script>window.onload = () => { window.print(); window.close() }<\/script>
      </body></html>
    `)
    win.document.close()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#1e3a5f]">顔登録QRを発行</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* 人物情報 */}
        <div className="flex items-center gap-3 mb-5 p-3 bg-[#f8f9fb] rounded-xl">
          <div className="w-9 h-9 rounded-full bg-[#1e3a5f]/10 flex items-center justify-center text-[#1e3a5f] font-semibold text-sm flex-shrink-0">
            {person.name.slice(0, 1)}
          </div>
          <div>
            <div className="text-sm font-medium text-[#1e3a5f]">{person.name}</div>
            <div className="text-xs text-gray-400">
              {person.person_type === 'employee' ? '従業員' : '外部登録者'}
              {person.employee_code ? ` • ${person.employee_code}` : ''}
            </div>
          </div>
        </div>

        {/* 受付エリア選択 */}
        {allAreas.length > 1 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">受付エリアを選択</label>
            <select
              value={selectedToken}
              onChange={e => setSelectedToken(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            >
              {allAreas.map(a => (
                <option key={a.id} value={a.qr_token}>{a.storeName} — {a.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* QRコード */}
        <div className="flex flex-col items-center gap-3 mb-5">
          <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
            <canvas ref={canvasRef} />
          </div>
          <p className="text-xs text-gray-400 text-center leading-relaxed">
            このQRをスキャンすると顔登録ページへ直接アクセスできます
          </p>
          {person.face_id && (
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg text-center">
              ⚠ すでに顔登録済みです。再スキャンで上書き登録できます。
            </p>
          )}
        </div>

        {/* URL表示 */}
        <div className="mb-5">
          <div className="text-[10px] text-gray-400 font-mono break-all bg-gray-50 rounded-lg px-3 py-2 select-all">
            {url}
          </div>
        </div>

        {/* ボタン */}
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Printer size={13} />
            印刷
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-medium"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 登録・編集モーダル ─────────────────────────────────────────────────────────

function PersonModal({
  mode,
  defaultTab,
  person,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit'
  defaultTab: TabType
  person?: Person
  onClose: () => void
  onSaved: () => void
}) {
  const [personType, setPersonType] = useState<'employee' | 'external'>(
    (person?.person_type === 'visitor' ? 'external' : person?.person_type)
    ?? (defaultTab === 'primary' ? 'external' : defaultTab)
  )
  const [name, setName] = useState(person?.name ?? '')
  const [company, setCompany] = useState(person?.company ?? '')
  const [department, setDepartment] = useState(person?.department ?? '')
  const [phone, setPhone] = useState(person?.phone ?? '')
  const [email, setEmail] = useState(person?.email ?? '')
  const [employeeCode, setEmployeeCode] = useState(person?.employee_code ?? '')
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [resetFace, setResetFace] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasFace = !!(person?.face_id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError(null)

    const body = {
      name, company, department, phone, email,
      person_type: personType,
      employee_code: employeeCode,
      notes,
      ...(mode === 'edit' && resetFace ? { reset_face: true } : {}),
    }

    const res = mode === 'add'
      ? await fetch('/api/v1/admin/persons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/v1/admin/persons?id=${person!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'エラーが発生しました')
      setSubmitting(false)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-[#1e3a5f] mb-5">
          {mode === 'add' ? '来店者を登録' : '来店者を編集'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 種別 */}
          {mode === 'add' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">種別</label>
              <div className="flex gap-2">
                {(['employee', 'external'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPersonType(t)}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                      personType === t
                        ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                        : 'border-gray-200 text-gray-500 hover:border-[#1e3a5f]/40'
                    }`}
                  >
                    {t === 'employee' ? '従業員' : '外部登録者'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 名前 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">名前 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              required
            />
          </div>

          {/* 従業員番号 */}
          {personType === 'employee' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">社員番号</label>
              <input
                type="text"
                value={employeeCode}
                onChange={e => setEmployeeCode(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                placeholder="例: EMP-001"
              />
            </div>
          )}

          {/* 会社（外部登録者のみ） */}
          {personType === 'external' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">会社名</label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              />
            </div>
          )}

          {/* 部署 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">部署</label>
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>

          {/* メール・電話 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">メール</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">電話番号</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
              />
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">メモ</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 resize-none"
            />
          </div>

          {/* 顔登録リセット（編集時のみ） */}
          {mode === 'edit' && hasFace && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={resetFace}
                  onChange={e => setResetFace(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium text-amber-800">顔登録データをリセット</div>
                  <div className="text-xs text-amber-600 mt-0.5">Rekognition のデータも削除されます。再登録は受付キオスクから行ってください。</div>
                </div>
              </label>
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 bg-[#1e3a5f] text-white rounded-xl text-sm font-medium disabled:opacity-40"
            >
              {submitting ? '処理中...' : mode === 'add' ? '登録する' : '保存する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
