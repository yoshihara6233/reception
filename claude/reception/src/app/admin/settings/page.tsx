'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'

interface Settings {
  require_business_card: string
  require_face_photo: string
  require_baggage_inspection_checkin: string
  require_baggage_inspection_checkout: string
  baggage_review_checkin: boolean
  baggage_review_checkout: boolean
  visit_purposes: string[]
  photo_retention_days: number
  visit_retention_days: number
}

interface Store {
  id: string
  name: string
  settings?: {
    ipro_api_key?: string
    ipro_site_id?: string
    ipro_endpoint?: string
  }
}

const defaultSettings: Settings = {
  require_business_card: 'optional',
  require_face_photo: 'optional',
  require_baggage_inspection_checkin: 'none',
  require_baggage_inspection_checkout: 'none',
  baggage_review_checkin: true,
  baggage_review_checkout: true,
  visit_purposes: ['定期配送', 'メンテナンス', '商談', '監査', 'その他'],
  photo_retention_days: 90,
  visit_retention_days: 365,
}

function isOverridden(key: keyof Settings, overrideKeys: Set<keyof Settings>): boolean {
  return overrideKeys.has(key)
}

// ── ピルラジオグループ ──────────────────────────────────────────────────────────

interface PillOption { value: string; label: string; icon?: string }

interface PillGroupProps {
  value: string
  options: PillOption[]
  onChange: (v: string) => void
  disabled?: boolean
}

function PillGroup({ value, options, onChange, disabled }: PillGroupProps) {
  return (
    <div className={`inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 gap-0.5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            value === opt.value
              ? 'bg-white shadow-sm text-[#1e3a5f] ring-1 ring-[#1e3a5f]/10'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
          }`}
        >
          {opt.icon && <span>{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── トグルスイッチ ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? 'bg-[#1e3a5f]' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ── セクションヘッダー ─────────────────────────────────────────────────────────

function SectionHeader({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <div className="flex items-center gap-3 mb-3 pt-2">
      <span className="text-lg">{icon}</span>
      <div>
        <h2 className="text-sm font-bold text-[#1e3a5f] uppercase tracking-wider">{title}</h2>
        {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
      </div>
    </div>
  )
}

// ── 設定行 ────────────────────────────────────────────────────────────────────

interface SettingRowProps {
  label: string
  desc?: string
  overridden: boolean
  tenantValue: string
  showReset: boolean
  onReset: () => void
  children: React.ReactNode
}

function SettingRow({ label, desc, overridden, tenantValue, showReset, onReset, children }: SettingRowProps) {
  const valueLabel = (v: string) => {
    const map: Record<string, string> = {
      required: '必須', optional: '任意', hidden: '非表示',
      none: '無し', photo: '写真', video: '動画（i-PRO）',
    }
    return map[v] ?? v
  }

  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <div className="min-w-0 mr-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-800">{label}</span>
          {overridden && (
            <button
              onClick={onReset}
              title="テナント共通設定に戻す"
              className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-full transition-colors font-medium"
            >
              <span>店舗固有</span>
              <span>↩</span>
            </button>
          )}
          {showReset && !overridden && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              共通: {valueLabel(tenantValue)}
            </span>
          )}
        </div>
        {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

// ── メインコンポーネント ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useLocale()

  const [stores, setStores] = useState<Store[]>([])
  const [selectedStore, setSelectedStore] = useState<string>('tenant')

  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [tenantSettings, setTenantSettings] = useState<Settings>(defaultSettings)
  const [overrideKeys, setOverrideKeys] = useState<Set<keyof Settings>>(new Set())

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newPurpose, setNewPurpose] = useState('')

  const emptyIpro = () => ({ ipro_api_key: '', ipro_site_id: '', ipro_endpoint: '' })
  const [iproForm, setIproForm]       = useState(emptyIpro())
  const [iproEditing, setIproEditing] = useState(false)
  const [iproSaving, setIproSaving]   = useState(false)
  const [iproShowKey, setIproShowKey] = useState(false)

  useEffect(() => {
    fetch('/api/v1/admin/stores-list')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  }, [])

  const loadSettings = useCallback(async (scope: string) => {
    const url = scope === 'tenant'
      ? '/api/v1/admin/settings'
      : `/api/v1/admin/settings?storeId=${scope}`

    const res = await fetch(url)
    if (!res.ok) return
    const data = await res.json()

    const merged: Settings = { ...defaultSettings, ...data.settings }
    setSettings(merged)

    if (scope === 'tenant') {
      setTenantSettings(merged)
      setOverrideKeys(new Set())
    } else {
      const tenant: Settings = { ...defaultSettings, ...data.tenantSettings }
      const store = (data.storeSettings || {}) as Partial<Settings>
      setTenantSettings(tenant)
      const keys = new Set(Object.keys(store) as (keyof Settings)[])
      setOverrideKeys(keys)
    }
  }, [])

  useEffect(() => {
    loadSettings(selectedStore)
    setIproEditing(false)
    setIproShowKey(false)
    if (selectedStore !== 'tenant') {
      const store = stores.find(s => s.id === selectedStore)
      setIproForm({
        ipro_api_key:  store?.settings?.ipro_api_key  ?? '',
        ipro_site_id:  store?.settings?.ipro_site_id  ?? '',
        ipro_endpoint: store?.settings?.ipro_endpoint ?? '',
      })
    } else {
      setIproForm(emptyIpro())
    }
  }, [selectedStore, loadSettings, stores])

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    if (selectedStore !== 'tenant') {
      setOverrideKeys(prev => new Set([...prev, key]))
    }
  }

  const resetField = async (key: keyof Settings) => {
    if (selectedStore === 'tenant') return
    await fetch(`/api/v1/admin/settings?storeId=${selectedStore}&key=${key}`, { method: 'DELETE' })
    setSettings(prev => ({ ...prev, [key]: tenantSettings[key] as Settings[typeof key] }))
    setOverrideKeys(prev => { const s = new Set(prev); s.delete(key); return s })
  }

  const handleSaveIpro = async () => {
    if (selectedStore === 'tenant') return
    setIproSaving(true)
    await fetch(`/api/v1/admin/stores?id=${selectedStore}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          ipro_api_key:  iproForm.ipro_api_key.trim()  || null,
          ipro_site_id:  iproForm.ipro_site_id.trim()  || null,
          ipro_endpoint: iproForm.ipro_endpoint.trim() || null,
        },
      }),
    })
    const res = await fetch('/api/v1/admin/stores-list')
    const data = await res.json()
    setStores(data.stores ?? [])
    setIproSaving(false)
    setIproEditing(false)
    setIproShowKey(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)

    let payload: Partial<Settings>
    if (selectedStore !== 'tenant') {
      payload = {}
      for (const key of overrideKeys) {
        (payload as Record<string, unknown>)[key] = settings[key]
      }
    } else {
      payload = settings
    }

    const url = selectedStore === 'tenant'
      ? '/api/v1/admin/settings'
      : `/api/v1/admin/settings?storeId=${selectedStore}`

    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addPurpose = () => {
    if (!newPurpose.trim() || settings.visit_purposes.includes(newPurpose.trim())) return
    update('visit_purposes', [...settings.visit_purposes, newPurpose.trim()])
    setNewPurpose('')
  }

  const removePurpose = (p: string) => {
    update('visit_purposes', settings.visit_purposes.filter(x => x !== p))
  }

  const currentStoreName = selectedStore === 'tenant'
    ? 'テナント共通'
    : stores.find(s => s.id === selectedStore)?.name ?? ''

  const VISIBILITY_OPTIONS: PillOption[] = [
    { value: 'required', label: '必須',   icon: '✳️' },
    { value: 'optional', label: '任意',   icon: '🔵' },
    { value: 'hidden',   label: '非表示', icon: '🚫' },
  ]

  const BAGGAGE_OPTIONS: PillOption[] = [
    { value: 'none',  label: '無し',        icon: '⬜' },
    { value: 'photo', label: '写真',        icon: '📷' },
    { value: 'video', label: '動画（i-PRO）', icon: '🎥' },
  ]

  return (
    <div className="max-w-2xl">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('admin.settings')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">受付フロー・連携・データ保持ポリシーの管理</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm disabled:opacity-40 ${
            saved
              ? 'bg-green-500 text-white'
              : 'bg-[#1e3a5f] text-white hover:bg-[#2c4f7c]'
          }`}
        >
          {saving && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          )}
          {saved ? '✓ 保存しました' : saving ? '保存中...' : t('admin.saveSettings')}
        </button>
      </div>

      {/* 店舗セレクター */}
      <div className="mb-7">
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">設定対象</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedStore('tenant')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
              selectedStore === 'tenant'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-sm'
                : 'bg-white text-gray-500 border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f]'
            }`}
          >
            🏢 テナント共通
          </button>
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => setSelectedStore(store.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                selectedStore === store.id
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-sm'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f]'
              }`}
            >
              🏪 {store.name}
            </button>
          ))}
        </div>

        <div className={`mt-3 flex items-start gap-2 text-xs rounded-xl px-4 py-2.5 ${
          selectedStore === 'tenant'
            ? 'bg-blue-50 text-blue-700 border border-blue-100'
            : 'bg-amber-50 text-amber-700 border border-amber-100'
        }`}>
          <span>{selectedStore === 'tenant' ? '📋' : '🏪'}</span>
          {selectedStore === 'tenant' ? (
            <span>テナント共通設定。各店舗で上書きしていない項目はこの設定が適用されます。</span>
          ) : (
            <span>
              <strong>{currentStoreName}</strong> の設定。変更した項目は店舗固有として保存され、テナント共通より優先されます。
              <span className="ml-1 opacity-80">「店舗固有 ↩」で共通設定に戻せます。</span>
            </span>
          )}
        </div>
      </div>

      <div className="space-y-5">

        {/* ── 受付フロー ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-2 border-b border-gray-100">
            <SectionHeader icon="📋" title="受付フロー" desc="訪問者の入室手続きで表示する項目を設定します" />
          </div>
          <div className="px-6">
            <SettingRow
              label={t('admin.businessCardSetting')}
              desc="名刺をスマートフォンで撮影・OCR読取"
              overridden={selectedStore !== 'tenant' && isOverridden('require_business_card', overrideKeys)}
              tenantValue={tenantSettings.require_business_card}
              showReset={selectedStore !== 'tenant'}
              onReset={() => resetField('require_business_card')}
            >
              <PillGroup
                value={settings.require_business_card}
                options={VISIBILITY_OPTIONS}
                onChange={v => update('require_business_card', v)}
              />
            </SettingRow>

            <SettingRow
              label={t('admin.facePhotoSetting')}
              desc="顔写真を入室時に撮影"
              overridden={selectedStore !== 'tenant' && isOverridden('require_face_photo', overrideKeys)}
              tenantValue={tenantSettings.require_face_photo}
              showReset={selectedStore !== 'tenant'}
              onReset={() => resetField('require_face_photo')}
            >
              <PillGroup
                value={settings.require_face_photo}
                options={VISIBILITY_OPTIONS}
                onChange={v => update('require_face_photo', v)}
              />
            </SettingRow>
          </div>
        </div>

        {/* ── 手荷物検査 ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-2 border-b border-gray-100">
            <SectionHeader icon="🧳" title="手荷物検査" desc="入室・退室時の手荷物記録方法を設定します" />
          </div>
          <div className="px-6">
            <SettingRow
              label="入室時"
              desc="チェックイン手続き中に手荷物を記録"
              overridden={selectedStore !== 'tenant' && isOverridden('require_baggage_inspection_checkin', overrideKeys)}
              tenantValue={tenantSettings.require_baggage_inspection_checkin}
              showReset={selectedStore !== 'tenant'}
              onReset={() => resetField('require_baggage_inspection_checkin')}
            >
              <PillGroup
                value={settings.require_baggage_inspection_checkin}
                options={BAGGAGE_OPTIONS}
                onChange={v => update('require_baggage_inspection_checkin', v)}
              />
            </SettingRow>

            <SettingRow
              label="退室時"
              desc="チェックアウト手続き中に手荷物を記録"
              overridden={selectedStore !== 'tenant' && isOverridden('require_baggage_inspection_checkout', overrideKeys)}
              tenantValue={tenantSettings.require_baggage_inspection_checkout}
              showReset={selectedStore !== 'tenant'}
              onReset={() => resetField('require_baggage_inspection_checkout')}
            >
              <PillGroup
                value={settings.require_baggage_inspection_checkout}
                options={BAGGAGE_OPTIONS}
                onChange={v => update('require_baggage_inspection_checkout', v)}
              />
            </SettingRow>
          </div>
        </div>

        {/* ── 手荷物検査レビュー ──────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-2 border-b border-gray-100">
            <SectionHeader icon="🔍" title="手荷物検査レビュー" desc="管理者によるレビュー審査が必要なタイミングを設定します" />
          </div>
          <div className="px-6">
            <SettingRow
              label="入室時のレビュー"
              desc="入室時の手荷物検査結果をレビュー対象にする"
              overridden={selectedStore !== 'tenant' && isOverridden('baggage_review_checkin', overrideKeys)}
              tenantValue={tenantSettings.baggage_review_checkin ? 'ON' : 'OFF'}
              showReset={selectedStore !== 'tenant'}
              onReset={() => resetField('baggage_review_checkin')}
            >
              <div className="flex items-center gap-2">
                <Toggle
                  checked={settings.baggage_review_checkin}
                  onChange={v => update('baggage_review_checkin', v)}
                />
                <span className="text-xs font-semibold min-w-[24px]" style={{ color: settings.baggage_review_checkin ? '#1e3a5f' : '#9ca3af' }}>
                  {settings.baggage_review_checkin ? 'ON' : 'OFF'}
                </span>
              </div>
            </SettingRow>

            <SettingRow
              label="退室時のレビュー"
              desc="退室時の手荷物検査結果をレビュー対象にする"
              overridden={selectedStore !== 'tenant' && isOverridden('baggage_review_checkout', overrideKeys)}
              tenantValue={tenantSettings.baggage_review_checkout ? 'ON' : 'OFF'}
              showReset={selectedStore !== 'tenant'}
              onReset={() => resetField('baggage_review_checkout')}
            >
              <div className="flex items-center gap-2">
                <Toggle
                  checked={settings.baggage_review_checkout}
                  onChange={v => update('baggage_review_checkout', v)}
                />
                <span className="text-xs font-semibold min-w-[24px]" style={{ color: settings.baggage_review_checkout ? '#1e3a5f' : '#9ca3af' }}>
                  {settings.baggage_review_checkout ? 'ON' : 'OFF'}
                </span>
              </div>
            </SettingRow>
          </div>
        </div>

        {/* ── 来訪目的（テナント共通のみ） ────────────────────────────────── */}
        {selectedStore === 'tenant' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 pt-5 pb-2 border-b border-gray-100">
              <SectionHeader icon="📝" title="来訪目的" desc="チェックイン時に来訪者が選択できる目的の一覧" />
            </div>
            <div className="px-6 py-4">
              <div className="flex flex-wrap gap-2 mb-4">
                {settings.visit_purposes.map(p => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#f0f4f8] text-[#1e3a5f] rounded-xl text-sm font-medium"
                  >
                    {p}
                    <button
                      onClick={() => removePurpose(p)}
                      className="ml-1 text-gray-400 hover:text-red-500 leading-none text-base"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPurpose}
                  onChange={e => setNewPurpose(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addPurpose())}
                  placeholder={t('admin.newPurposeLabel')}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                <button
                  onClick={addPurpose}
                  className="px-4 py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-xl hover:bg-[#2c4f7c] transition-colors"
                >
                  {t('admin.addPurpose')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── データ保持期間（テナント共通のみ） ──────────────────────────── */}
        {selectedStore === 'tenant' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 pt-5 pb-2 border-b border-gray-100">
              <SectionHeader icon="🗓️" title="データ保持期間" desc="写真・来訪記録の自動削除タイミングを設定します" />
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t('admin.photoRetention')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">名刺・顔写真の保持期間</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={settings.photo_retention_days}
                    onChange={e => update('photo_retention_days', parseInt(e.target.value) || 90)}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-xl text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                  <span className="text-sm text-gray-400 font-medium">{t('admin.days')}</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t('admin.visitRetention')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">来訪記録・申告データの保持期間</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={settings.visit_retention_days}
                    onChange={e => update('visit_retention_days', parseInt(e.target.value) || 365)}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-xl text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                  <span className="text-sm text-gray-400 font-medium">{t('admin.days')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── i-PRO Remo 連携設定（店舗選択時のみ） ──────────────────────── */}
        {selectedStore !== 'tenant' && (() => {
          const store = stores.find(s => s.id === selectedStore)
          const hasKey = !!store?.settings?.ipro_api_key

          return (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 pt-5 pb-2 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <SectionHeader
                    icon="📡"
                    title="i-PRO Remo 連携"
                    desc="動画手荷物検査で使用するカメラシステムの認証設定"
                  />
                  <div className="flex items-center gap-2 mb-3">
                    {hasKey && (
                      <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-semibold">
                        ✓ 設定済
                      </span>
                    )}
                    {!iproEditing && (
                      <button
                        onClick={() => { setIproEditing(true); setIproShowKey(false) }}
                        className="text-xs text-[#1e3a5f] border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 font-medium"
                      >
                        {hasKey ? '編集' : '設定する'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4">
                {iproEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                        APIキー <span className="text-red-400">*</span>
                        <span className="font-normal text-gray-400 ml-2">i-PRO Remo Cloud の認証キー</span>
                      </label>
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          type={iproShowKey ? 'text' : 'password'}
                          value={iproForm.ipro_api_key}
                          onChange={e => setIproForm(p => ({ ...p, ipro_api_key: e.target.value }))}
                          placeholder="••••••••••••••••••••••••"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                        />
                        <button
                          type="button"
                          onClick={() => setIproShowKey(v => !v)}
                          className="text-xs text-[#1e3a5f] font-medium whitespace-nowrap px-2"
                        >
                          {iproShowKey ? '隠す' : '表示'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                        サイトID
                        <span className="font-normal text-gray-400 ml-2">Remo Cloud のサイト／テナント識別子</span>
                      </label>
                      <input
                        type="text"
                        value={iproForm.ipro_site_id}
                        onChange={e => setIproForm(p => ({ ...p, ipro_site_id: e.target.value }))}
                        placeholder="site-xxxxxxxx"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                        APIエンドポイント
                        <span className="font-normal text-gray-400 ml-2">カスタム環境の場合のみ。通常は空欄</span>
                      </label>
                      <input
                        type="text"
                        value={iproForm.ipro_endpoint}
                        onChange={e => setIproForm(p => ({ ...p, ipro_endpoint: e.target.value }))}
                        placeholder="https://api.remo.i-pro.com"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleSaveIpro}
                        disabled={iproSaving}
                        className="px-4 py-2 bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-[#2c4f7c] transition-colors"
                      >
                        {iproSaving ? '保存中...' : '保存'}
                      </button>
                      <button
                        onClick={() => {
                          setIproEditing(false); setIproShowKey(false)
                          const s = stores.find(x => x.id === selectedStore)
                          setIproForm({
                            ipro_api_key:  s?.settings?.ipro_api_key  ?? '',
                            ipro_site_id:  s?.settings?.ipro_site_id  ?? '',
                            ipro_endpoint: s?.settings?.ipro_endpoint ?? '',
                          })
                        }}
                        className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : hasKey ? (
                  <dl className="space-y-3">
                    <div className="flex gap-4">
                      <dt className="text-xs text-gray-400 w-32 pt-0.5 font-medium">APIキー</dt>
                      <dd className="text-sm font-mono text-gray-700">
                        {'•'.repeat(16)}
                        <span className="text-xs text-gray-400 ml-2">（登録済）</span>
                      </dd>
                    </div>
                    {store?.settings?.ipro_site_id && (
                      <div className="flex gap-4">
                        <dt className="text-xs text-gray-400 w-32 pt-0.5 font-medium">サイトID</dt>
                        <dd className="text-sm font-mono text-gray-700">{store.settings.ipro_site_id}</dd>
                      </div>
                    )}
                    {store?.settings?.ipro_endpoint && (
                      <div className="flex gap-4">
                        <dt className="text-xs text-gray-400 w-32 pt-0.5 font-medium">エンドポイント</dt>
                        <dd className="text-sm font-mono text-gray-700 break-all">{store.settings.ipro_endpoint}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-gray-400 py-2">
                    i-PRO Remo Cloud の認証情報が未設定です。「設定する」から登録してください。
                  </p>
                )}
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
