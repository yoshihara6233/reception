'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSiteConfig } from '@/lib/site-config'

// ── 型 ────────────────────────────────────────────────────────────────────────

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

interface Staff {
  id: string
  name: string
  name_kana: string | null
  email: string | null
  slack_member_id: string | null
  is_active: boolean
}

interface PreReg {
  id: string
  visitor_company: string
  visitor_name: string
  visitor_email: string | null
  purpose: string
  expires_at: string
  used_at: string | null
  cancelled_at: string | null
  created_at: string
  areas: { id: string; name: string } | null
  staff_members: { id: string; name: string } | null
}

interface Camera {
  id: string
  slot: 1 | 2
  label: string
  ipro_camera_id: string
  ipro_recorder_id: string | null
  is_active: boolean
}

type RightTab = 'areas' | 'staff' | 'preregs' | 'cameras'

// ── ユーティリティ ─────────────────────────────────────────────────────────────

function preRegStatus(pr: PreReg): { label: string; bg: string; color: string } {
  if (pr.cancelled_at) return { label: 'キャンセル', bg: '#f3f4f6', color: '#6b7280' }
  if (pr.used_at)      return { label: '使用済',     bg: '#f0fdf4', color: '#15803d' }
  if (new Date(pr.expires_at) < new Date()) return { label: '期限切れ', bg: '#fef2f2', color: '#dc2626' }
  return { label: '有効',   bg: '#eff6ff', color: '#1d4ed8' }
}

// ── スタイル定数 ───────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px',
  font: '400 13px/1.4 var(--font-sans)',
  color: 'var(--ge-ink)', background: '#fff',
  border: '1px solid var(--ge-line)', borderRadius: 6, outline: 'none',
}
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
  font: '500 12px/1 var(--font-sans)', color: '#fff',
  background: 'var(--ge-accent)', border: 'none',
}
const btnSecondary: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  font: '500 12px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
  background: 'var(--ge-paper-2)', border: '1px solid var(--ge-line)',
}

// ── メインページ ──────────────────────────────────────────────────────────────

export default function StoresPage() {
  const { locationName } = useSiteConfig()

  // 店舗
  const [stores, setStores]         = useState<Store[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab]   = useState<RightTab>('areas')

  // 店舗編集
  const [editName, setEditName]       = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [saving, setSaving]           = useState(false)
  const [dirty, setDirty]             = useState(false)

  // 店舗追加
  const [addingStore, setAddingStore]           = useState(false)
  const [newStoreName, setNewStoreName]         = useState('')
  const [addingStoreSaving, setAddingStoreSaving] = useState(false)

  // エリア追加
  const [addingArea, setAddingArea]           = useState(false)
  const [newAreaName, setNewAreaName]         = useState('')
  const [addingAreaSaving, setAddingAreaSaving] = useState(false)
  const [reissuingAreaId, setReissuingAreaId] = useState<string | null>(null)

  // スタッフ
  const [staffList, setStaffList]     = useState<Staff[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [addingStaff, setAddingStaff] = useState(false)
  const [newStaff, setNewStaff]       = useState({ name: '', name_kana: '', email: '', slack_member_id: '' })
  const [staffSaving, setStaffSaving] = useState(false)
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null)
  const [editStaff, setEditStaff]     = useState({ name: '', name_kana: '', email: '', slack_member_id: '' })

  // カメラ
  const [cameras, setCameras]           = useState<Camera[]>([])
  const [cameraLoading, setCameraLoading] = useState(false)
  const emptyCameraForm = () => ({ label: '', iproCameraId: '', iproRecorderId: '' })
  const [editingCameraSlot, setEditingCameraSlot] = useState<1 | 2 | null>(null)
  const [cameraForm, setCameraForm]     = useState(emptyCameraForm())
  const [cameraSaving, setCameraSaving] = useState(false)

  // 事前来客登録
  const [preRegs, setPreRegs]           = useState<PreReg[]>([])
  const [preRegLoading, setPreRegLoading] = useState(false)
  const [showExpired, setShowExpired]   = useState(false)
  const defaultExpiresAt = () => {
    const d = new Date(); d.setDate(d.getDate() + 2)
    return d.toISOString().slice(0, 10)
  }
  const emptyPreReg = () => ({ visitorCompany: '', visitorName: '', visitorEmail: '', purpose: '', areaId: '', contactPersonId: '', expiresAt: defaultExpiresAt() })
  const [addingPreReg, setAddingPreReg] = useState(false)
  const [newPreReg, setNewPreReg]       = useState(emptyPreReg)
  const [preRegSaving, setPreRegSaving] = useState(false)
  const [editingPreRegId, setEditingPreRegId] = useState<string | null>(null)
  const [editPreReg, setEditPreReg]     = useState(emptyPreReg)

  const selectedStore = stores.find(s => s.id === selectedId) ?? null

  // ── データ取得 ──────────────────────────────────────────────────────────────

  const fetchStores = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/v1/admin/stores-list')
    const data = await res.json()
    const list: Store[] = data.stores ?? []
    setStores(list)
    setLoading(false)
    return list
  }, [])

  const fetchStaff = useCallback(async (storeId: string) => {
    setStaffLoading(true)
    const res  = await fetch(`/api/v1/admin/staff?storeId=${storeId}&active=false`)
    const data = await res.json()
    setStaffList(data.staff ?? [])
    setStaffLoading(false)
  }, [])

  const fetchPreRegs = useCallback(async (storeId: string) => {
    setPreRegLoading(true)
    const res  = await fetch(`/api/v1/admin/pre-registrations?storeId=${storeId}`)
    const data = await res.json()
    setPreRegs(data.preRegistrations ?? [])
    setPreRegLoading(false)
  }, [])

  const fetchCameras = useCallback(async (storeId: string) => {
    setCameraLoading(true)
    const res  = await fetch(`/api/v1/admin/cameras?storeId=${storeId}`)
    const data = await res.json()
    setCameras(data.cameras ?? [])
    setCameraLoading(false)
  }, [])

  useEffect(() => { fetchStores() }, [fetchStores])

  // 店舗選択
  const selectStore = (store: Store) => {
    setSelectedId(store.id)
    setEditName(store.name)
    setEditAddress(store.address ?? '')
    setDirty(false)
    setAddingArea(false); setNewAreaName('')
    setAddingStaff(false); setNewStaff({ name: '', name_kana: '', email: '', slack_member_id: '' })
    setAddingPreReg(false); setEditingPreRegId(null)
    setEditingStaffId(null)
    setEditingCameraSlot(null)
    fetchStaff(store.id)
    fetchPreRegs(store.id)
    fetchCameras(store.id)
  }

  // タブ切替時にデータ再取得
  const switchTab = (tab: RightTab) => {
    setActiveTab(tab)
    if (!selectedId) return
    if (tab === 'staff')   fetchStaff(selectedId)
    // preregs タブではスタッフ一覧も必要（担当スタッフドロップダウン用）
    if (tab === 'preregs') { fetchPreRegs(selectedId); fetchStaff(selectedId) }
    if (tab === 'cameras') fetchCameras(selectedId)
  }

  // ── 店舗保存 ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedId || !editName.trim()) return
    setSaving(true)
    await fetch(`/api/v1/admin/stores?id=${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, address: editAddress }),
    })
    setSaving(false); setDirty(false)
    const list = await fetchStores()
    const updated = list.find(s => s.id === selectedId)
    if (updated) { setEditName(updated.name); setEditAddress(updated.address ?? '') }
  }

  // ── 店舗追加 ───────────────────────────────────────────────────────────────

  const handleAddStore = async () => {
    if (!newStoreName.trim()) return
    setAddingStoreSaving(true)
    const res  = await fetch('/api/v1/admin/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newStoreName }),
    })
    const data = await res.json()
    setAddingStoreSaving(false); setAddingStore(false); setNewStoreName('')
    const list = await fetchStores()
    if (data.storeId) {
      const added = list.find(s => s.id === data.storeId)
      if (added) selectStore(added)
    }
  }

  // ── エリア追加 ─────────────────────────────────────────────────────────────

  const handleAddArea = async () => {
    if (!selectedId || !newAreaName.trim()) return
    setAddingAreaSaving(true)
    await fetch('/api/v1/admin/areas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: selectedId, name: newAreaName }),
    })
    setAddingAreaSaving(false); setAddingArea(false); setNewAreaName('')
    const list = await fetchStores()
    const updated = list.find(s => s.id === selectedId)
    if (updated) { setEditName(updated.name); setEditAddress(updated.address ?? '') }
  }

  const handleReissueQr = async (areaId: string) => {
    if (!confirm('QRコードを再発行しますか？現在のQRコードは無効になります。')) return
    setReissuingAreaId(areaId)
    await fetch('/api/v1/admin/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ areaId }),
    })
    setReissuingAreaId(null)
    const list = await fetchStores()
    list.find(s => s.id === selectedId) // refresh
    await fetchStores()
  }

  const handleQrPrint = (area: Area) => {
    const qrUrl    = `${window.location.origin}/r/${area.qr_token}`
    const printUrl = `/admin/stores/qr-print?name=${encodeURIComponent(area.name)}&url=${encodeURIComponent(qrUrl)}`
    window.open(printUrl, '_blank', 'noopener')
  }

  // ── スタッフ追加 ───────────────────────────────────────────────────────────

  const handleAddStaff = async () => {
    if (!selectedId || !newStaff.name.trim()) return
    setStaffSaving(true)
    await fetch('/api/v1/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newStaff, store_id: selectedId }),
    })
    setStaffSaving(false); setAddingStaff(false)
    setNewStaff({ name: '', name_kana: '', email: '', slack_member_id: '' })
    fetchStaff(selectedId)
  }

  const handleUpdateStaff = async (id: string) => {
    if (!editStaff.name.trim()) return
    setStaffSaving(true)
    await fetch(`/api/v1/admin/staff?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editStaff),
    })
    setStaffSaving(false); setEditingStaffId(null)
    if (selectedId) fetchStaff(selectedId)
  }

  const handleDeleteStaff = async (id: string) => {
    if (!confirm('このスタッフを無効にしますか？')) return
    await fetch(`/api/v1/admin/staff?id=${id}`, { method: 'DELETE' })
    if (selectedId) fetchStaff(selectedId)
  }

  // ── カメラ ─────────────────────────────────────────────────────────────────

  const handleSaveCamera = async (slot: 1 | 2) => {
    if (!selectedId || !cameraForm.label.trim() || !cameraForm.iproCameraId.trim()) return
    setCameraSaving(true)
    await fetch('/api/v1/admin/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: selectedId,
        slot,
        label: cameraForm.label,
        iproCameraId: cameraForm.iproCameraId,
        iproRecorderId: cameraForm.iproRecorderId || null,
      }),
    })
    setCameraSaving(false)
    setEditingCameraSlot(null)
    setCameraForm(emptyCameraForm())
    fetchCameras(selectedId)
  }

  const handleDeleteCamera = async (id: string) => {
    if (!confirm('このカメラ登録を削除しますか？')) return
    await fetch(`/api/v1/admin/cameras?id=${id}`, { method: 'DELETE' })
    if (selectedId) fetchCameras(selectedId)
  }

  // ── 事前来客登録 ───────────────────────────────────────────────────────────

  const handleAddPreReg = async () => {
    if (!selectedId) return
    const { visitorCompany, visitorName, purpose, areaId, contactPersonId, expiresAt } = newPreReg
    if (!visitorCompany.trim() || !visitorName.trim() || !purpose.trim() || !areaId || !contactPersonId) return
    setPreRegSaving(true)
    // expiresAt は date 文字列（YYYY-MM-DD）→ 当日の23:59:59に変換
    const expiresEnd = new Date(expiresAt); expiresEnd.setHours(23, 59, 59, 999)
    const diffHours = Math.max(1, Math.round((expiresEnd.getTime() - Date.now()) / 3600000))
    await fetch('/api/v1/admin/pre-registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorCompany, visitorName, visitorEmail: newPreReg.visitorEmail || null,
        purpose, areaId, contactPersonId, storeId: selectedId,
        expiresInHours: diffHours,
      }),
    })
    setPreRegSaving(false); setAddingPreReg(false)
    setNewPreReg(emptyPreReg())
    fetchPreRegs(selectedId)
  }

  const handleUpdatePreReg = async (id: string) => {
    const { visitorCompany, visitorName, purpose, areaId, contactPersonId, expiresAt } = editPreReg
    if (!visitorCompany.trim() || !visitorName.trim() || !purpose.trim()) return
    setPreRegSaving(true)
    const expiresEnd = new Date(expiresAt); expiresEnd.setHours(23, 59, 59, 999)
    await fetch('/api/v1/admin/pre-registrations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, visitorCompany, visitorName, visitorEmail: editPreReg.visitorEmail || null,
        purpose, areaId, contactPersonId, expiresAt: expiresEnd.toISOString(),
      }),
    })
    setPreRegSaving(false); setEditingPreRegId(null)
    if (selectedId) fetchPreRegs(selectedId)
  }

  // ── レンダリング ────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', gap: 0,
      height: 'calc(100vh - 92px)',
      overflow: 'hidden',
      margin: '-32px -32px -32px -32px',
    }}>

      {/* ── 左パネル（店舗一覧） ─────────────────────────────────────────────── */}
      <div style={{
        width: 220, flexShrink: 0,
        background: 'var(--ge-paper)',
        borderRight: '1px solid var(--ge-line)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--ge-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ font: '600 12px/1 var(--font-sans)', color: 'var(--ge-ink-3)' }}>
            {locationName}一覧
          </span>
          <button
            onClick={() => { setAddingStore(true); setSelectedId(null) }}
            style={{
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
              font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
              background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
            }}
          >
            ＋ 追加
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} style={{ padding: '12px 14px', borderBottom: '1px solid var(--ge-line)' }}>
                <div style={{ height: 12, borderRadius: 3, background: 'var(--ge-paper-2)', width: '70%', marginBottom: 6 }} />
                <div style={{ height: 10, borderRadius: 3, background: 'var(--ge-paper-2)', width: '40%' }} />
              </div>
            ))
          ) : stores.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ge-ink-4)', font: '400 12px/1.5 var(--font-sans)' }}>
              まだ{locationName}がありません
            </div>
          ) : (
            stores.map(store => {
              const isSelected = store.id === selectedId
              return (
                <button
                  key={store.id}
                  onClick={() => selectStore(store)}
                  style={{
                    width: '100%', padding: '11px 14px',
                    textAlign: 'left', cursor: 'pointer',
                    background: isSelected ? 'var(--ge-accent-soft)' : 'transparent',
                    borderBottom: '1px solid var(--ge-line)',
                    borderLeft: isSelected ? '3px solid var(--ge-accent)' : '3px solid transparent',
                    paddingLeft: isSelected ? 11 : 14,
                    display: 'flex', alignItems: 'center', gap: 8,
                    outline: 'none',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                    background: store.is_active ? 'var(--ge-success)' : 'var(--ge-ink-4)',
                  }} />
                  <span style={{
                    font: isSelected ? '600 13px/1.3 var(--font-sans)' : '400 13px/1.3 var(--font-sans)',
                    color: isSelected ? 'var(--ge-accent-ink)' : 'var(--ge-ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {store.name}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── 右パネル ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

        {/* 店舗追加フォーム */}
        {addingStore && (
          <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', padding: 20, marginBottom: 16, maxWidth: 480 }}>
            <p style={{ font: '600 14px/1 var(--font-sans)', color: 'var(--ge-ink)', marginBottom: 14 }}>
              新しい{locationName}を追加
            </p>
            <div style={{ marginBottom: 10 }}>
              <label style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 4 }}>{locationName}名 *</label>
              <input autoFocus value={newStoreName} onChange={e => setNewStoreName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddStore()} placeholder="例: 新宿本店" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAddStore} disabled={!newStoreName.trim() || addingStoreSaving} style={{ ...btnPrimary, opacity: !newStoreName.trim() ? 0.4 : 1 }}>
                {addingStoreSaving ? '追加中...' : '追加'}
              </button>
              <button onClick={() => { setAddingStore(false); setNewStoreName('') }} style={btnSecondary}>キャンセル</button>
            </div>
          </div>
        )}

        {/* 未選択 */}
        {!addingStore && !selectedStore && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--ge-ink-4)', gap: 12 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
            </svg>
            <span style={{ font: '400 13px/1 var(--font-sans)' }}>左から{locationName}を選択してください</span>
          </div>
        )}

        {/* 店舗詳細 */}
        {selectedStore && (
          <div style={{ maxWidth: 600 }}>

            {/* ─ 基本情報カード ─ */}
            <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h2 style={{ font: '700 16px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>{selectedStore.name}</h2>
                <span style={{
                  padding: '3px 10px', borderRadius: 999, font: '500 11px/1.4 var(--font-sans)',
                  background: selectedStore.is_active ? 'var(--ge-success-soft)' : 'var(--ge-paper-2)',
                  color: selectedStore.is_active ? 'var(--ge-success)' : 'var(--ge-ink-4)',
                }}>
                  {selectedStore.is_active ? '稼働中' : '停止中'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 4 }}>{locationName}名 *</label>
                  <input value={editName} onChange={e => { setEditName(e.target.value); setDirty(true) }} style={inputStyle} />
                </div>
                <div>
                  <label style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 4 }}>住所</label>
                  <input value={editAddress} onChange={e => { setEditAddress(e.target.value); setDirty(true) }} placeholder="任意" style={inputStyle} />
                </div>
              </div>
              {dirty && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={handleSave} disabled={saving || !editName.trim()} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button onClick={() => { setEditName(selectedStore.name); setEditAddress(selectedStore.address ?? ''); setDirty(false) }} style={btnSecondary}>取消</button>
                </div>
              )}
            </div>

            {/* ─ タブ ─ */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--ge-line)', marginBottom: 16 }}>
              {([
                { key: 'areas',   label: 'エリア・QR' },
                { key: 'staff',   label: 'スタッフ' },
                { key: 'preregs', label: '事前来客登録' },
                { key: 'cameras', label: 'カメラ' },
              ] as { key: RightTab; label: string }[]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  style={{
                    padding: '8px 16px', cursor: 'pointer',
                    font: '500 13px/1 var(--font-sans)',
                    color: activeTab === tab.key ? 'var(--ge-accent)' : 'var(--ge-ink-3)',
                    background: 'transparent', border: 'none',
                    borderBottom: activeTab === tab.key ? '2px solid var(--ge-accent)' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ─ エリア・QR タブ ─ */}
            {activeTab === 'areas' && (
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <h3 style={{ font: '600 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>エリア / QRコード</h3>
                  <button onClick={() => setAddingArea(true)} style={{
                    padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                    font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
                    background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
                  }}>＋ エリア追加</button>
                </div>

                {addingArea && (
                  <div style={{ padding: 12, marginBottom: 12, background: 'var(--ge-paper)', borderRadius: 6, border: '1px solid var(--ge-line)' }}>
                    <input autoFocus value={newAreaName} onChange={e => setNewAreaName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddArea()}
                      placeholder="エリア名（例: 正面入口）" style={{ ...inputStyle, marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleAddArea} disabled={!newAreaName.trim() || addingAreaSaving} style={{ ...btnPrimary, opacity: !newAreaName.trim() ? 0.4 : 1, padding: '4px 12px' }}>
                        {addingAreaSaving ? '追加中...' : '追加'}
                      </button>
                      <button onClick={() => { setAddingArea(false); setNewAreaName('') }} style={{ ...btnSecondary, padding: '4px 10px' }}>キャンセル</button>
                    </div>
                  </div>
                )}

                {selectedStore.areas.length === 0 && !addingArea ? (
                  <p style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--ge-ink-4)', margin: 0 }}>エリアが登録されていません</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedStore.areas.map(area => (
                      <div key={area.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: 6,
                        background: 'var(--ge-paper)', border: '1px solid var(--ge-line)',
                      }}>
                        <div>
                          <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>{area.name}</p>
                          <p style={{ font: '400 10px/1 var(--font-mono)', color: 'var(--ge-ink-4)', margin: '4px 0 0' }}>{area.qr_token.slice(0, 16)}…</p>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Link href={`/r/${area.qr_token}`} target="_blank"
                            style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)', textDecoration: 'none', padding: '3px 8px' }}>
                            Preview
                          </Link>
                          <button onClick={() => handleQrPrint(area)} style={{ ...btnSecondary, padding: '3px 8px', fontSize: 11 }}>QR印刷</button>
                          <button onClick={() => handleReissueQr(area.id)} disabled={reissuingAreaId === area.id} style={{
                            padding: '3px 8px', borderRadius: 4, cursor: 'pointer', font: '500 11px/1 var(--font-sans)',
                            color: 'var(--ge-warning)', background: '#fffbeb', border: '1px solid #fde68a',
                            opacity: reissuingAreaId === area.id ? 0.5 : 1,
                          }}>
                            {reissuingAreaId === area.id ? '再発行中...' : '再発行'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─ スタッフ タブ ─ */}
            {activeTab === 'staff' && (
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <h3 style={{ font: '600 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>スタッフ一覧</h3>
                  <button onClick={() => setAddingStaff(true)} style={{
                    padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                    font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
                    background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
                  }}>＋ 追加</button>
                </div>

                {/* スタッフ追加フォーム */}
                {addingStaff && (
                  <div style={{ padding: 14, marginBottom: 14, background: 'var(--ge-paper)', borderRadius: 6, border: '1px solid var(--ge-line)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>氏名 *</label>
                        <input autoFocus value={newStaff.name} onChange={e => setNewStaff(p => ({ ...p, name: e.target.value }))} placeholder="山田 太郎" style={inputStyle} />
                      </div>
                      <div>
                        <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>フリガナ</label>
                        <input value={newStaff.name_kana} onChange={e => setNewStaff(p => ({ ...p, name_kana: e.target.value }))} placeholder="ヤマダ タロウ" style={inputStyle} />
                      </div>
                      <div>
                        <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>メールアドレス</label>
                        <input value={newStaff.email} onChange={e => setNewStaff(p => ({ ...p, email: e.target.value }))} placeholder="taro@example.com" style={inputStyle} />
                      </div>
                      <div>
                        <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>Slack ID</label>
                        <input value={newStaff.slack_member_id} onChange={e => setNewStaff(p => ({ ...p, slack_member_id: e.target.value }))} placeholder="U12345678" style={inputStyle} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleAddStaff} disabled={!newStaff.name.trim() || staffSaving} style={{ ...btnPrimary, opacity: !newStaff.name.trim() ? 0.4 : 1, padding: '4px 12px' }}>
                        {staffSaving ? '追加中...' : '追加'}
                      </button>
                      <button onClick={() => { setAddingStaff(false); setNewStaff({ name: '', name_kana: '', email: '', slack_member_id: '' }) }} style={{ ...btnSecondary, padding: '4px 10px' }}>キャンセル</button>
                    </div>
                  </div>
                )}

                {staffLoading ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--ge-ink-4)', font: '400 12px/1 var(--font-sans)' }}>読み込み中...</div>
                ) : staffList.length === 0 ? (
                  <p style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--ge-ink-4)', margin: 0 }}>スタッフが登録されていません</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {staffList.map(s => (
                      <div key={s.id} style={{
                        padding: '10px 12px', borderRadius: 6,
                        background: s.is_active ? 'var(--ge-paper)' : '#f9fafb',
                        border: '1px solid var(--ge-line)',
                        opacity: s.is_active ? 1 : 0.5,
                      }}>
                        {editingStaffId === s.id ? (
                          <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                              <div>
                                <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>氏名 *</label>
                                <input value={editStaff.name} onChange={e => setEditStaff(p => ({ ...p, name: e.target.value }))} style={inputStyle} />
                              </div>
                              <div>
                                <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>フリガナ</label>
                                <input value={editStaff.name_kana} onChange={e => setEditStaff(p => ({ ...p, name_kana: e.target.value }))} style={inputStyle} />
                              </div>
                              <div>
                                <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>メール</label>
                                <input value={editStaff.email} onChange={e => setEditStaff(p => ({ ...p, email: e.target.value }))} style={inputStyle} />
                              </div>
                              <div>
                                <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>Slack ID</label>
                                <input value={editStaff.slack_member_id} onChange={e => setEditStaff(p => ({ ...p, slack_member_id: e.target.value }))} style={inputStyle} />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => handleUpdateStaff(s.id)} disabled={!editStaff.name.trim() || staffSaving} style={{ ...btnPrimary, padding: '4px 12px', opacity: staffSaving ? 0.5 : 1 }}>保存</button>
                              <button onClick={() => setEditingStaffId(null)} style={{ ...btnSecondary, padding: '4px 10px' }}>取消</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                              <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>
                                {s.name}
                                {s.name_kana && <span style={{ font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', marginLeft: 8 }}>{s.name_kana}</span>}
                                {!s.is_active && <span style={{ font: '400 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)', marginLeft: 8 }}>（無効）</span>}
                              </p>
                              {(s.email || s.slack_member_id) && (
                                <p style={{ font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', margin: '3px 0 0' }}>
                                  {s.email}{s.email && s.slack_member_id && '  ·  '}{s.slack_member_id && `Slack: ${s.slack_member_id}`}
                                </p>
                              )}
                            </div>
                            {s.is_active && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => { setEditingStaffId(s.id); setEditStaff({ name: s.name, name_kana: s.name_kana ?? '', email: s.email ?? '', slack_member_id: s.slack_member_id ?? '' }) }}
                                  style={{ ...btnSecondary, padding: '3px 8px', fontSize: 11 }}>編集</button>
                                <button onClick={() => handleDeleteStaff(s.id)}
                                  style={{ padding: '3px 8px', borderRadius: 4, cursor: 'pointer', font: '500 11px/1 var(--font-sans)', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca' }}>
                                  無効化
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─ 事前来客登録 タブ ─ */}
            {activeTab === 'preregs' && (() => {
              const now = new Date()
              const isExpiredOrDone = (pr: PreReg) =>
                !!pr.cancelled_at || !!pr.used_at || new Date(pr.expires_at) < now
              const displayed = showExpired ? preRegs : preRegs.filter(pr => !isExpiredOrDone(pr))
              const expiredCount = preRegs.filter(isExpiredOrDone).length
              const preRegFormValid = (f: typeof newPreReg) =>
                f.visitorCompany.trim() && f.visitorName.trim() && f.purpose.trim() && f.areaId && f.contactPersonId

              const PreRegForm = ({ value, onChange, onSubmit, onCancel, saving: s, submitLabel }: {
                value: typeof newPreReg
                onChange: (v: typeof newPreReg) => void
                onSubmit: () => void
                onCancel: () => void
                saving: boolean
                submitLabel: string
              }) => (
                <div style={{ padding: 14, marginBottom: 14, background: 'var(--ge-paper)', borderRadius: 6, border: '1px solid var(--ge-line)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>会社名 *</label>
                      <input value={value.visitorCompany} onChange={e => onChange({ ...value, visitorCompany: e.target.value })} placeholder="株式会社〇〇" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>氏名 *</label>
                      <input value={value.visitorName} onChange={e => onChange({ ...value, visitorName: e.target.value })} placeholder="山田 花子" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>メールアドレス</label>
                      <input value={value.visitorEmail} onChange={e => onChange({ ...value, visitorEmail: e.target.value })} placeholder="visitor@example.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>目的 *</label>
                      <input value={value.purpose} onChange={e => onChange({ ...value, purpose: e.target.value })} placeholder="商談" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>エリア *</label>
                      <select value={value.areaId} onChange={e => onChange({ ...value, areaId: e.target.value })}
                        style={{ ...inputStyle, color: value.areaId ? 'var(--ge-ink)' : 'var(--ge-ink-4)' }}>
                        <option value="">選択してください</option>
                        {selectedStore!.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>担当スタッフ *</label>
                      <select value={value.contactPersonId} onChange={e => onChange({ ...value, contactPersonId: e.target.value })}
                        style={{ ...inputStyle, color: value.contactPersonId ? 'var(--ge-ink)' : 'var(--ge-ink-4)' }}>
                        <option value="">選択してください</option>
                        {staffList.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>有効期限（完了日付）</label>
                      <input type="date" value={value.expiresAt} min={new Date().toISOString().slice(0, 10)}
                        onChange={e => onChange({ ...value, expiresAt: e.target.value })} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={onSubmit} disabled={!preRegFormValid(value) || s}
                      style={{ ...btnPrimary, padding: '4px 12px', opacity: !preRegFormValid(value) ? 0.4 : 1 }}>
                      {s ? '保存中...' : submitLabel}
                    </button>
                    <button onClick={onCancel} style={{ ...btnSecondary, padding: '4px 10px' }}>キャンセル</button>
                  </div>
                </div>
              )

              return (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', padding: 20 }}>
                  {/* ヘッダー */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h3 style={{ font: '600 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>事前来客登録</h3>
                      {expiredCount > 0 && (
                        <button onClick={() => setShowExpired(v => !v)} style={{
                          padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                          font: '500 10px/1 var(--font-sans)',
                          color: showExpired ? 'var(--ge-accent)' : 'var(--ge-ink-4)',
                          background: showExpired ? 'var(--ge-accent-soft)' : 'var(--ge-paper-2)',
                          border: `1px solid ${showExpired ? 'var(--ge-accent-line)' : 'var(--ge-line)'}`,
                        }}>
                          {showExpired ? '期限切れを非表示' : `期限切れ等を表示（${expiredCount}件）`}
                        </button>
                      )}
                    </div>
                    <button onClick={() => { setAddingPreReg(true); setEditingPreRegId(null) }} style={{
                      padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                      font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
                      background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
                    }}>＋ 新規登録</button>
                  </div>

                  {/* 新規登録フォーム */}
                  {addingPreReg && (
                    <PreRegForm
                      value={newPreReg} onChange={setNewPreReg}
                      onSubmit={handleAddPreReg} onCancel={() => { setAddingPreReg(false); setNewPreReg(emptyPreReg()) }}
                      saving={preRegSaving} submitLabel="登録"
                    />
                  )}

                  {/* 一覧 */}
                  {preRegLoading ? (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--ge-ink-4)', font: '400 12px/1 var(--font-sans)' }}>読み込み中...</div>
                  ) : displayed.length === 0 ? (
                    <p style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--ge-ink-4)', margin: 0 }}>
                      {preRegs.length === 0 ? '事前登録がありません' : '有効な事前登録がありません'}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {displayed.map(pr => {
                        const st = preRegStatus(pr)
                        const isEditing = editingPreRegId === pr.id
                        const canEdit = !pr.used_at && !pr.cancelled_at
                        return (
                          <div key={pr.id} style={{
                            borderRadius: 6, border: '1px solid var(--ge-line)',
                            background: isExpiredOrDone(pr) ? '#fafafa' : 'var(--ge-paper)',
                            opacity: (pr.cancelled_at || pr.used_at) ? 0.6 : 1,
                            overflow: 'hidden',
                          }}>
                            {isEditing ? (
                              <div style={{ padding: '0 0 0 0' }}>
                                <PreRegForm
                                  value={editPreReg} onChange={setEditPreReg}
                                  onSubmit={() => handleUpdatePreReg(pr.id)}
                                  onCancel={() => setEditingPreRegId(null)}
                                  saving={preRegSaving} submitLabel="保存"
                                />
                              </div>
                            ) : (
                              <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                    <span style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink)' }}>{pr.visitor_name}</span>
                                    <span style={{ font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>{pr.visitor_company}</span>
                                    <span style={{ padding: '2px 7px', borderRadius: 999, font: '500 10px/1 var(--font-sans)', background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                                  </div>
                                  <div style={{ font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <span>{pr.purpose}</span>
                                    {pr.areas && <span>· {pr.areas.name}</span>}
                                    {pr.staff_members && <span>· {pr.staff_members.name}</span>}
                                    <span>· 期限: {new Date(pr.expires_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
                                  </div>
                                </div>
                                {canEdit && (
                                  <button
                                    onClick={() => {
                                      setEditingPreRegId(pr.id)
                                      setAddingPreReg(false)
                                      setEditPreReg({
                                        visitorCompany: pr.visitor_company,
                                        visitorName: pr.visitor_name,
                                        visitorEmail: pr.visitor_email ?? '',
                                        purpose: pr.purpose,
                                        areaId: pr.areas?.id ?? '',
                                        contactPersonId: pr.staff_members?.id ?? '',
                                        expiresAt: new Date(pr.expires_at).toISOString().slice(0, 10),
                                      })
                                    }}
                                    style={{ ...btnSecondary, padding: '3px 8px', fontSize: 11, flexShrink: 0 }}
                                  >
                                    編集
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ─ カメラ タブ ─ */}
            {activeTab === 'cameras' && (
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', padding: 20 }}>
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ font: '600 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: '0 0 4px' }}>i-PRO Remo カメラ登録</h3>
                  <p style={{ font: '400 11px/1.5 var(--font-sans)', color: 'var(--ge-ink-4)', margin: 0 }}>
                    1店舗につき最大2台のカメラを登録できます。スロット1が受付カウンター、スロット2が手荷物検査デスクの目安です。
                  </p>
                </div>

                {cameraLoading ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--ge-ink-4)', font: '400 12px/1 var(--font-sans)' }}>読み込み中...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {([1, 2] as const).map(slot => {
                      const cam = cameras.find(c => c.slot === slot)
                      const isEditing = editingCameraSlot === slot
                      const slotLabel = slot === 1 ? 'スロット1（受付カウンター）' : 'スロット2（手荷物検査デスク）'

                      return (
                        <div key={slot} style={{
                          borderRadius: 8, border: '1px solid var(--ge-line)',
                          background: 'var(--ge-paper)', overflow: 'hidden',
                        }}>
                          {/* スロットヘッダー */}
                          <div style={{
                            padding: '10px 14px', borderBottom: '1px solid var(--ge-line)',
                            background: '#f8fafc',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--ge-ink-3)', flexShrink: 0 }}>
                                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                              </svg>
                              <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--ge-ink-3)' }}>{slotLabel}</span>
                              {cam && (
                                <span style={{
                                  padding: '2px 7px', borderRadius: 999,
                                  font: '500 10px/1 var(--font-sans)',
                                  background: cam.is_active ? 'var(--ge-success-soft)' : 'var(--ge-paper-2)',
                                  color: cam.is_active ? 'var(--ge-success)' : 'var(--ge-ink-4)',
                                }}>
                                  {cam.is_active ? '稼働中' : '停止中'}
                                </span>
                              )}
                            </div>
                            {!isEditing && (
                              cam ? (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    onClick={() => {
                                      setEditingCameraSlot(slot)
                                      setCameraForm({
                                        label: cam.label,
                                        iproCameraId: cam.ipro_camera_id,
                                        iproRecorderId: cam.ipro_recorder_id ?? '',
                                      })
                                    }}
                                    style={{ ...btnSecondary, padding: '3px 8px', fontSize: 11 }}
                                  >編集</button>
                                  <button
                                    onClick={() => handleDeleteCamera(cam.id)}
                                    style={{ padding: '3px 8px', borderRadius: 4, cursor: 'pointer', font: '500 11px/1 var(--font-sans)', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca' }}
                                  >削除</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setEditingCameraSlot(slot); setCameraForm(emptyCameraForm()) }}
                                  style={{
                                    padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                                    font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
                                    background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
                                  }}
                                >＋ 登録</button>
                              )
                            )}
                          </div>

                          {/* カメラ情報 or フォーム */}
                          <div style={{ padding: '12px 14px' }}>
                            {isEditing ? (
                              <div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                                  <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>ラベル *</label>
                                    <input
                                      autoFocus
                                      value={cameraForm.label}
                                      onChange={e => setCameraForm(p => ({ ...p, label: e.target.value }))}
                                      placeholder={slot === 1 ? '受付カメラ' : '手荷物検査カメラ'}
                                      style={inputStyle}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>i-PRO カメラID *</label>
                                    <input
                                      value={cameraForm.iproCameraId}
                                      onChange={e => setCameraForm(p => ({ ...p, iproCameraId: e.target.value }))}
                                      placeholder="cam-xxxxxxxx"
                                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-3)', display: 'block', marginBottom: 3 }}>レコーダID（任意）</label>
                                    <input
                                      value={cameraForm.iproRecorderId}
                                      onChange={e => setCameraForm(p => ({ ...p, iproRecorderId: e.target.value }))}
                                      placeholder="rec-xxxxxxxx"
                                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                                    />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    onClick={() => handleSaveCamera(slot)}
                                    disabled={!cameraForm.label.trim() || !cameraForm.iproCameraId.trim() || cameraSaving}
                                    style={{ ...btnPrimary, padding: '4px 12px', opacity: (!cameraForm.label.trim() || !cameraForm.iproCameraId.trim()) ? 0.4 : 1 }}
                                  >
                                    {cameraSaving ? '保存中...' : '保存'}
                                  </button>
                                  <button
                                    onClick={() => { setEditingCameraSlot(null); setCameraForm(emptyCameraForm()) }}
                                    style={{ ...btnSecondary, padding: '4px 10px' }}
                                  >キャンセル</button>
                                </div>
                              </div>
                            ) : cam ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                <div>
                                  <p style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)', margin: '0 0 3px' }}>ラベル</p>
                                  <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>{cam.label}</p>
                                </div>
                                <div>
                                  <p style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)', margin: '0 0 3px' }}>i-PRO カメラID</p>
                                  <p style={{ font: '400 12px/1 var(--font-mono)', color: 'var(--ge-ink)', margin: 0 }}>{cam.ipro_camera_id}</p>
                                </div>
                                {cam.ipro_recorder_id && (
                                  <div>
                                    <p style={{ font: '500 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)', margin: '0 0 3px' }}>レコーダID</p>
                                    <p style={{ font: '400 12px/1 var(--font-mono)', color: 'var(--ge-ink)', margin: 0 }}>{cam.ipro_recorder_id}</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-4)', margin: 0 }}>未登録</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
