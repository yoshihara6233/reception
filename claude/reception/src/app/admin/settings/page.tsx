'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '@/lib/i18n/useLocale'

interface Settings {
  require_business_card: string
  require_face_photo: string
  visit_purposes: string[]
  photo_retention_days: number
  visit_retention_days: number
}

interface Store {
  id: string
  name: string
}

const defaultSettings: Settings = {
  require_business_card: 'optional',
  require_face_photo: 'optional',
  visit_purposes: ['定期配送', 'メンテナンス', '商談', '監査', 'その他'],
  photo_retention_days: 90,
  visit_retention_days: 365,
}

// 店舗固有で上書きされているか判定
function isOverridden(
  key: keyof Settings,
  overrideKeys: Set<keyof Settings>,
): boolean {
  return overrideKeys.has(key)
}

export default function SettingsPage() {
  const { t } = useLocale()

  // 店舗一覧
  const [stores, setStores] = useState<Store[]>([])
  const [selectedStore, setSelectedStore] = useState<string>('tenant') // 'tenant' or store.id

  // 表示中の設定値（selectedStoreに応じた merged 設定）
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  // テナント共通設定（店舗選択時の参照用）
  const [tenantSettings, setTenantSettings] = useState<Settings>(defaultSettings)
  // 店舗固有で上書きされているフィールドのセット
  const [overrideKeys, setOverrideKeys] = useState<Set<keyof Settings>>(new Set())

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newPurpose, setNewPurpose] = useState('')

  // 店舗一覧を取得
  useEffect(() => {
    fetch('/api/v1/admin/stores')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  }, [])

  // 設定を読み込む
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

      // どのキーが店舗で上書きされているか記録
      const keys = new Set(Object.keys(store) as (keyof Settings)[])
      setOverrideKeys(keys)
    }
  }, [])

  useEffect(() => {
    loadSettings(selectedStore)
  }, [selectedStore, loadSettings])

  // フィールド更新（店舗モードでは上書きセットに追加）
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    if (selectedStore !== 'tenant') {
      setOverrideKeys(prev => new Set([...prev, key]))
    }
  }

  // 特定フィールドをテナント設定にリセット（店舗モードのみ）
  const resetField = async (key: keyof Settings) => {
    if (selectedStore === 'tenant') return
    await fetch(`/api/v1/admin/settings?storeId=${selectedStore}&key=${key}`, {
      method: 'DELETE',
    })
    setSettings(prev => ({ ...prev, [key]: tenantSettings[key] as Settings[typeof key] }))
    setOverrideKeys(prev => {
      const s = new Set(prev); s.delete(key); return s
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)

    // 店舗モードのときは上書きされたフィールドのみ送信
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('admin.settings')}</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] disabled:opacity-40"
        >
          {saving ? t('admin.saving') : saved ? t('admin.saved') : t('admin.saveSettings')}
        </button>
      </div>

      {/* 店舗セレクター */}
      <div className="mb-6">
        <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">設定対象</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedStore('tenant')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              selectedStore === 'tenant'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#1e3a5f]'
            }`}
          >
            🏢 テナント共通
          </button>
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => setSelectedStore(store.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                selectedStore === store.id
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1e3a5f]'
              }`}
            >
              🏪 {store.name}
            </button>
          ))}
        </div>

        {/* スコープ説明バナー */}
        {selectedStore === 'tenant' ? (
          <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            📋 テナント共通設定です。各店舗で上書きしていない項目はこの設定が適用されます。
          </p>
        ) : (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            🏪 <strong>{currentStoreName}</strong> の設定です。
            変更した項目は店舗固有の設定として保存され、テナント共通設定より優先されます。
            <span className="ml-1">リセットボタン（↩）で共通設定に戻せます。</span>
          </p>
        )}
      </div>

      <div className="space-y-4 max-w-2xl">
        {/* 名刺撮影 */}
        <SettingRow
          label={t('admin.businessCardSetting')}
          overridden={selectedStore !== 'tenant' && isOverridden('require_business_card', overrideKeys)}
          tenantValue={tenantSettings.require_business_card}
          showReset={selectedStore !== 'tenant'}
          onReset={() => resetField('require_business_card')}
        >
          <select
            value={settings.require_business_card}
            onChange={e => update('require_business_card', e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          >
            <option value="required">{t('admin.required')}</option>
            <option value="optional">{t('admin.optional')}</option>
            <option value="hidden">{t('admin.hidden')}</option>
          </select>
        </SettingRow>

        {/* 顔写真 */}
        <SettingRow
          label={t('admin.facePhotoSetting')}
          overridden={selectedStore !== 'tenant' && isOverridden('require_face_photo', overrideKeys)}
          tenantValue={tenantSettings.require_face_photo}
          showReset={selectedStore !== 'tenant'}
          onReset={() => resetField('require_face_photo')}
        >
          <select
            value={settings.require_face_photo}
            onChange={e => update('require_face_photo', e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          >
            <option value="required">{t('admin.required')}</option>
            <option value="optional">{t('admin.optional')}</option>
            <option value="hidden">{t('admin.hidden')}</option>
          </select>
        </SettingRow>

        {/* 来訪目的 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-[#1e3a5f]">{t('admin.purposeSettings')}</h3>
              {selectedStore !== 'tenant' && overrideKeys.has('visit_purposes') && (
                <OverrideBadge onReset={() => resetField('visit_purposes')} />
              )}
            </div>
            {selectedStore !== 'tenant' && !overrideKeys.has('visit_purposes') && (
              <span className="text-xs text-gray-400">共通設定を使用中</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {settings.visit_purposes.map(p => (
              <span key={p} className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#f0f2f5] rounded-lg text-sm text-gray-700">
                {p}
                <button onClick={() => removePurpose(p)} className="text-gray-400 hover:text-red-500 ml-1">&times;</button>
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
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
            <button
              onClick={addPurpose}
              className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg"
            >
              {t('admin.addPurpose')}
            </button>
          </div>
        </div>

        {/* データ保持期間（テナント共通のみ編集可） */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-medium text-[#1e3a5f]">{t('admin.retentionSettings')}</h3>
            {selectedStore !== 'tenant' && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                テナント共通のみ設定可能
              </span>
            )}
          </div>
          <div className={`space-y-3 ${selectedStore !== 'tenant' ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{t('admin.photoRetention')}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={selectedStore === 'tenant' ? settings.photo_retention_days : tenantSettings.photo_retention_days}
                  onChange={e => update('photo_retention_days', parseInt(e.target.value) || 90)}
                  className="w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                <span className="text-sm text-gray-400">{t('admin.days')}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{t('admin.visitRetention')}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={selectedStore === 'tenant' ? settings.visit_retention_days : tenantSettings.visit_retention_days}
                  onChange={e => update('visit_retention_days', parseInt(e.target.value) || 365)}
                  className="w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                <span className="text-sm text-gray-400">{t('admin.days')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── サブコンポーネント ─────────────────────────────────────────────────────────

function OverrideBadge({ onReset }: { onReset: () => void }) {
  return (
    <button
      onClick={onReset}
      title="テナント共通設定に戻す"
      className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-full transition-colors"
    >
      <span>店舗固有</span>
      <span>↩</span>
    </button>
  )
}

interface SettingRowProps {
  label: string
  overridden: boolean
  tenantValue: string
  showReset: boolean
  onReset: () => void
  children: React.ReactNode
}

function SettingRow({ label, overridden, tenantValue, showReset, onReset, children }: SettingRowProps) {
  const valueLabel = (v: string) => {
    if (v === 'required') return '必須'
    if (v === 'optional') return '任意'
    if (v === 'hidden') return '非表示'
    return v
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-[#1e3a5f]">{label}</h3>
          {overridden && <OverrideBadge onReset={onReset} />}
          {showReset && !overridden && (
            <span className="text-xs text-gray-400">共通: {valueLabel(tenantValue)}</span>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
