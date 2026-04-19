'use client'

import { useState, useEffect } from 'react'

interface ConsentTemplate {
  id: string
  version: string
  body_ja: string
  body_en: string | null
  body_zh: string | null
  body_ko: string | null
  is_active: boolean
  created_at: string
}

export default function ConsentSettingsPage() {
  const [template, setTemplate] = useState<ConsentTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'ja' | 'en' | 'zh' | 'ko'>('ja')

  const [form, setForm] = useState({
    version: '1.0',
    body_ja: '',
    body_en: '',
    body_zh: '',
    body_ko: '',
  })

  useEffect(() => {
    fetch('/api/v1/admin/settings/consent')
      .then(r => r.ok ? r.json() : { template: null })
      .then(data => {
        if (data.template) {
          setTemplate(data.template)
          setForm({
            version: data.template.version,
            body_ja: data.template.body_ja,
            body_en: data.template.body_en || '',
            body_zh: data.template.body_zh || '',
            body_ko: data.template.body_ko || '',
          })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!form.body_ja.trim()) {
      setError('日本語同意文は必須です')
      return
    }
    setSaving(true)
    setError(null)

    const res = await fetch('/api/v1/admin/settings/consent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || '保存に失敗しました')
      setSaving(false)
      return
    }

    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
    setSaving(false)

    // Refresh
    const fresh = await fetch('/api/v1/admin/settings/consent').then(r => r.json())
    if (fresh.template) setTemplate(fresh.template)
  }

  const handleDisable = async () => {
    if (!confirm('同意取得を無効にしますか？来訪者は同意画面をスキップします。')) return
    setDeleting(true)

    const res = await fetch('/api/v1/admin/settings/consent', { method: 'DELETE' })
    if (res.ok) {
      setTemplate(null)
      setForm({ version: '1.0', body_ja: '', body_en: '', body_zh: '', body_ko: '' })
    }
    setDeleting(false)
  }

  const tabs: { key: 'ja' | 'en' | 'zh' | 'ko'; label: string }[] = [
    { key: 'ja', label: '日本語' },
    { key: 'en', label: 'English' },
    { key: 'zh', label: '中文' },
    { key: 'ko', label: '한국어' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#1e3a5f]">個人情報取扱同意設定</h1>
        <p className="text-sm text-gray-500 mt-1">
          来訪者が写真・名刺データを提供する前に表示する同意文を設定します。
          未設定の場合、同意画面はスキップされます。
        </p>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-3 mb-6">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
          template ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <span className={`w-2 h-2 rounded-full ${template ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          {template ? `有効 — Ver. ${template.version}` : '無効（同意画面なし）'}
        </div>
        {template && (
          <button
            onClick={handleDisable}
            disabled={deleting}
            className="text-sm text-red-500 hover:text-red-700 disabled:opacity-40"
          >
            {deleting ? '処理中...' : '無効にする'}
          </button>
        )}
      </div>

      {/* Version */}
      <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
        <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">バージョン</label>
        <input
          type="text"
          value={form.version}
          onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
          placeholder="1.0"
          className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        />
        <p className="text-xs text-gray-400 mt-1">
          同意文を変更するたびにバージョンを上げてください（例: 1.0 → 1.1）
        </p>
      </div>

      {/* Body — tabbed by language */}
      <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
        <div className="flex gap-1 mb-3 border-b border-gray-100 pb-2">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-[#1e3a5f] text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              {tab.key === 'ja' && <span className="ml-1 text-red-500 text-xs">*</span>}
            </button>
          ))}
        </div>

        <label className="block text-sm font-medium text-[#1e3a5f] mb-1.5">
          同意文{activeTab === 'ja' ? '（必須）' : '（未入力の場合は日本語が表示されます）'}
        </label>
        <textarea
          value={form[`body_${activeTab}`]}
          onChange={e => setForm(f => ({ ...f, [`body_${activeTab}`]: e.target.value }))}
          rows={8}
          placeholder={activeTab === 'ja'
            ? '例: 当社は、来訪者の個人情報（氏名、会社名、顔写真、名刺情報）を...'
            : ''}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">
          Markdownは使用できません。改行は反映されます。
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3 mb-4">
          ✅ 保存しました
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-4 bg-[#1e3a5f] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? '保存中...' : '保存して有効化'}
      </button>

      {/* Preview */}
      {form.body_ja && (
        <div className="mt-6 bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">プレビュー（日本語）</p>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto border border-gray-100 rounded-xl p-3">
            {form.body_ja}
          </div>
        </div>
      )}
    </div>
  )
}
