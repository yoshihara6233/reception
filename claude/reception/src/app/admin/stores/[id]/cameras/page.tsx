'use client'

/**
 * 店舗カメラ接続設定（i-PRO Remo / VMS）
 *
 * 1 店舗につき最大 2 カメラを登録する。スロット 1/2 は手荷物検査フローの
 * 2 画面同期再生で使われる。録画は現地レコーダが保管。
 *
 * このページでは i-PRO Remo と VMS の両方を設定できる。
 * baggage/recording ページは vms_hls_url が存在する場合 VMS を優先する。
 */

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

type CameraSlot = {
  slot: 1 | 2
  label: string
  ipro_camera_id: string
  ipro_recorder_id: string
  vms_camera_id: string
  is_active: boolean
}

const DEFAULT_SLOTS: CameraSlot[] = [
  { slot: 1, label: '受付カウンター',   ipro_camera_id: '', ipro_recorder_id: '', vms_camera_id: '', is_active: true },
  { slot: 2, label: '手荷物検査デスク', ipro_camera_id: '', ipro_recorder_id: '', vms_camera_id: '', is_active: true },
]

export default function StoreCamerasPage() {
  const { id: storeId } = useParams<{ id: string }>()
  const [slots, setSlots] = useState<CameraSlot[]>(DEFAULT_SLOTS)

  // i-PRO
  const [tenantClientId, setTenantClientId] = useState('')
  const [tenantClientSecret, setTenantClientSecret] = useState('')
  const [iproTesting, setIproTesting] = useState(false)
  const [iproTestResult, setIproTestResult] = useState<null | { ok: boolean; msg: string }>(null)

  // VMS
  const [vmsUrl, setVmsUrl] = useState('')
  const [vmsApiKey, setVmsApiKey] = useState('')
  const [vmsEnabled, setVmsEnabled] = useState(false)
  const [vmsTesting, setVmsTesting] = useState(false)
  const [vmsTestResult, setVmsTestResult] = useState<null | { ok: boolean; msg: string }>(null)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'ipro' | 'vms'>('vms')

  // Load from API
  useEffect(() => {
    if (!storeId) return
    fetch(`/api/v1/admin/stores/${storeId}/cameras`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (data.slots?.length) setSlots(data.slots)
        if (data.ipro_client_id) setTenantClientId(data.ipro_client_id)
        if (data.vms_url) setVmsUrl(data.vms_url)
        if (data.vms_enabled != null) setVmsEnabled(data.vms_enabled)
        // api_key / secret intentionally not pre-filled for security
      })
      .catch(() => { /* ignore — first-time setup */ })
  }, [storeId])

  const update = (slot: 1 | 2, patch: Partial<CameraSlot>) => {
    setSlots(prev => prev.map(s => (s.slot === slot ? { ...s, ...patch } : s)))
  }

  const handleIproTest = async () => {
    setIproTesting(true)
    setIproTestResult(null)
    await new Promise(r => setTimeout(r, 800))
    if (!tenantClientId || !tenantClientSecret) {
      setIproTestResult({ ok: false, msg: 'client_id / client_secret を入力してください' })
    } else {
      setIproTestResult({ ok: true, msg: '接続成功（モック）— OAuth2 トークン取得 OK' })
    }
    setIproTesting(false)
  }

  const handleVmsTest = async () => {
    setVmsTesting(true)
    setVmsTestResult(null)
    if (!vmsUrl || !vmsApiKey) {
      setVmsTestResult({ ok: false, msg: 'VMS URL と API Key を入力してください' })
      setVmsTesting(false)
      return
    }
    try {
      const res = await fetch('/api/v1/vms/cameras-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vmsUrl, vmsApiKey }),
      })
      const data = await res.json()
      if (res.ok) {
        setVmsTestResult({ ok: true, msg: `接続成功 — カメラ ${data.count ?? '?'} 台確認` })
      } else {
        setVmsTestResult({ ok: false, msg: data.error || '接続失敗' })
      }
    } catch {
      setVmsTestResult({ ok: false, msg: 'ネットワークエラー' })
    }
    setVmsTesting(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`/api/v1/admin/stores/${storeId}/cameras`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots,
          ipro_client_id: tenantClientId || null,
          ipro_client_secret: tenantClientSecret || null,
          vms_url: vmsUrl || null,
          vms_api_key: vmsApiKey || null,
          vms_enabled: vmsEnabled,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const tabClass = (t: 'ipro' | 'vms') =>
    `px-4 py-2 text-sm font-medium rounded-xl transition-all ${
      activeTab === t
        ? 'bg-[var(--ge-accent)] text-white shadow-sm'
        : 'text-gray-500 hover:bg-gray-100'
    }`

  return (
    <div className="max-w-3xl space-y-6">
      {/* ── ヘッダ ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-[var(--ge-accent)]">📹 カメラ接続設定</h2>
        <p className="text-sm text-gray-500 mt-1">
          1 店舗につき最大 2 カメラを登録できます。手荷物申告時刻の録画を取得して、履歴画面から 2 画面同時再生します。
        </p>
      </div>

      {/* ── タブ ──────────────────────────────────────────── */}
      <div className="flex gap-2 bg-gray-50 rounded-xl p-1 w-fit">
        <button className={tabClass('vms')} onClick={() => setActiveTab('vms')}>
          🖥 VMS（オンプレミス）
        </button>
        <button className={tabClass('ipro')} onClick={() => setActiveTab('ipro')}>
          📷 i-PRO Remo
        </button>
      </div>

      {/* ── VMS 設定 ──────────────────────────────────────── */}
      {activeTab === 'vms' && (
        <>
          <section className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--ge-accent)]">VMS 接続（REST API）</h3>
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vmsEnabled}
                  onChange={e => setVmsEnabled(e.target.checked)}
                  className="accent-[var(--ge-accent)] w-4 h-4"
                />
                <span className="font-medium">VMS 有効</span>
              </label>
            </div>

            {!vmsEnabled && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-3 py-2">
                VMS を有効にすると、手荷物申告時に自動で録画開始し HLS ストリームで再生できます。
              </p>
            )}

            <div className={vmsEnabled ? '' : 'opacity-50 pointer-events-none'}>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    VMS URL
                  </label>
                  <input
                    type="url"
                    value={vmsUrl}
                    onChange={e => setVmsUrl(e.target.value)}
                    placeholder="例: http://192.168.1.100:8080"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={vmsApiKey}
                    onChange={e => setVmsApiKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    autoComplete="new-password"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">本番では Supabase Vault に暗号化保存します</p>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handleVmsTest}
                  disabled={vmsTesting}
                  className="px-4 py-2 border border-[var(--ge-accent)]/30 text-[var(--ge-accent)] rounded-xl text-sm font-medium hover:bg-[var(--ge-accent)]/5 disabled:opacity-40"
                >
                  {vmsTesting ? 'テスト中...' : '接続テスト'}
                </button>
                {vmsTestResult && (
                  <span className={`text-xs ${vmsTestResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                    {vmsTestResult.ok ? '✅' : '⚠️'} {vmsTestResult.msg}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* カメラスロット（VMS camera_id） */}
          <section className="bg-white rounded-2xl shadow-sm p-5 space-y-5">
            <h3 className="text-sm font-semibold text-[var(--ge-accent)]">この店舗のカメラ（最大 2 台）</h3>

            {slots.map(s => (
              <div key={s.slot} className="border border-gray-100 rounded-xl p-4 bg-[#f9fafb] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-[var(--ge-accent)] text-white text-xs font-bold flex items-center justify-center">
                      {s.slot}
                    </span>
                    <span className="text-sm font-semibold text-[var(--ge-accent)]">スロット {s.slot}</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={s.is_active}
                      onChange={e => update(s.slot, { is_active: e.target.checked })}
                      className="accent-[var(--ge-accent)]"
                    />
                    有効
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">ラベル（用途）</label>
                    <input
                      type="text"
                      value={s.label}
                      onChange={e => update(s.slot, { label: e.target.value })}
                      placeholder="例: 受付カウンター"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                      VMS camera_id
                    </label>
                    <input
                      type="text"
                      value={s.vms_camera_id}
                      onChange={e => update(s.slot, { vms_camera_id: e.target.value })}
                      placeholder="例: cam-001"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                    />
                  </div>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {/* ── i-PRO Remo 設定 ───────────────────────────────── */}
      {activeTab === 'ipro' && (
        <>
          <section className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--ge-accent)]">テナント認証（OAuth2）</h3>
              <span className="text-[11px] text-gray-400 font-mono">remo.i-pro.com/cloudapi/v1</span>
            </div>
            <p className="text-xs text-gray-500 -mt-2">
              i-PRO Remo のテナント管理コンソールで発行された client_id / client_secret を登録します（テナント単位、全店舗で共有）。
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">client_id</label>
              <input
                type="text"
                value={tenantClientId}
                onChange={e => setTenantClientId(e.target.value)}
                placeholder="例: remo-tenant-abcdef1234"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">client_secret</label>
              <input
                type="password"
                value={tenantClientSecret}
                onChange={e => setTenantClientSecret(e.target.value)}
                placeholder="••••••••••••••••"
                autoComplete="new-password"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleIproTest}
                disabled={iproTesting}
                className="px-4 py-2 border border-[var(--ge-accent)]/30 text-[var(--ge-accent)] rounded-xl text-sm font-medium hover:bg-[var(--ge-accent)]/5 disabled:opacity-40"
              >
                {iproTesting ? 'テスト中...' : '接続テスト'}
              </button>
              {iproTestResult && (
                <span className={`text-xs ${iproTestResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {iproTestResult.ok ? '✅' : '⚠️'} {iproTestResult.msg}
                </span>
              )}
            </div>
          </section>

          {/* カメラスロット（i-PRO camera_id） */}
          <section className="bg-white rounded-2xl shadow-sm p-5 space-y-5">
            <h3 className="text-sm font-semibold text-[var(--ge-accent)]">この店舗のカメラ（最大 2 台）</h3>

            {slots.map(s => (
              <div key={s.slot} className="border border-gray-100 rounded-xl p-4 bg-[#f9fafb] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-[var(--ge-accent)] text-white text-xs font-bold flex items-center justify-center">
                      {s.slot}
                    </span>
                    <span className="text-sm font-semibold text-[var(--ge-accent)]">スロット {s.slot}</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={s.is_active}
                      onChange={e => update(s.slot, { is_active: e.target.checked })}
                      className="accent-[var(--ge-accent)]"
                    />
                    有効
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">ラベル（用途）</label>
                    <input
                      type="text"
                      value={s.label}
                      onChange={e => update(s.slot, { label: e.target.value })}
                      placeholder="例: 受付カウンター"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">i-PRO camera_id</label>
                    <input
                      type="text"
                      value={s.ipro_camera_id}
                      onChange={e => update(s.slot, { ipro_camera_id: e.target.value })}
                      placeholder="例: cam-ab12cd34"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                      現地レコーダ ID
                      <span className="ml-1 font-normal text-gray-400">（録画取得元、任意）</span>
                    </label>
                    <input
                      type="text"
                      value={s.ipro_recorder_id}
                      onChange={e => update(s.slot, { ipro_recorder_id: e.target.value })}
                      placeholder="例: nvr-001"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]"
                    />
                  </div>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {/* ── 保存 ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 sticky bottom-4 bg-white/80 backdrop-blur rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-[var(--ge-accent)] text-white rounded-xl text-sm font-semibold hover:bg-[var(--ge-accent-ink)] disabled:opacity-40"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {saved && <span className="text-xs text-emerald-600">✅ 保存しました</span>}
      </div>
    </div>
  )
}
