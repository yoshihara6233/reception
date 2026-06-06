/**
 * F46.25-26: NVR 接続情報フォーム + 接続テストボタン
 *
 * Client Component。フォームの状態は useState で持つ。
 * - 保存: Server Action (parent から渡される)
 * - 接続テスト: /api/stores/[id]/nvr/test-connection を POST
 */
'use client'

import { useState, useTransition } from 'react'
import type { NvrVendor } from '@/lib/nvr-adapter/types'
import type { NvrModelsRow } from '@/lib/supabase/db-types'

interface Props {
  storeId:        string
  initialVendor:  NvrVendor | null
  initialModel:   string | null
  initialEndpoint: string | null
  initialOptions: Record<string, unknown>
  availableModels: Pick<NvrModelsRow, 'vendor' | 'model_number' | 'display_name'>[]
  /**
   * F47: 接続テスト API のベースパス。
   * 管理画面では `/api/admin/stores/[id]/nvr`、店舗画面では `/api/stores/[id]/nvr`。
   * 省略時は `/api/stores/[id]/nvr` (下位互換)。
   */
  apiBasePath?:   string
  /** Server Action — フォーム保存処理。SaveResult を返せばインライン表示 */
  onSave?: (formData: FormData) => Promise<{ ok: boolean; message?: string } | void>
}

interface TestResult {
  ok:           boolean
  vendor?:      string
  modelNumber?: string
  fwVersion?:   string
  message?:     string
  capabilities?: Record<string, unknown>
}

const VENDOR_OPTIONS: { value: NvrVendor; label: string }[] = [
  // i-PRO 系 (Phase 0/1 + Phase 5)
  { value: 'i-pro-nx',              label: 'i-PRO WJ-NX シリーズ' },
  { value: 'i-pro-nu',              label: 'i-PRO WJ-NU シリーズ' },
  { value: 'i-pro-gxe500',          label: 'i-PRO WJ-GXE500 (アナログ→IP)' },
  // Phase 5 で追加されたベンダー
  { value: 'hikvision',             label: 'Hikvision (ISAPI)' },
  { value: 'hanwha-wisenet',        label: 'Hanwha Wisenet (SUNAPI)' },
  // Phase 6 で追加されたベンダー
  { value: 'synology-surveillance', label: 'Synology Surveillance Station' },
  { value: 'onvif-generic',         label: 'ONVIF 汎用 (fallback)' },
  // Phase 7 で追加されたベンダー
  { value: 'axis-vapix',            label: 'Axis VAPIX (Q3/P3/M3/M70 シリーズ)' },
  { value: 'dahua',                 label: 'Dahua DH-NVR / IPC' },
  // 各店 Mini PC モード互換
  { value: 'frigate',               label: 'Frigate (各店 Mini PC モード)' },
]

export function NvrConnectionForm({
  storeId,
  initialVendor,
  initialModel,
  initialEndpoint,
  initialOptions,
  availableModels,
  apiBasePath,
  onSave,
}: Props) {
  const testApiPath = (apiBasePath ?? `/api/stores/${storeId}/nvr`) + '/test-connection'
  const [vendor, setVendor]     = useState<NvrVendor | ''>(initialVendor ?? '')
  const [model, setModel]       = useState(initialModel ?? '')
  const [endpoint, setEndpoint] = useState(initialEndpoint ?? '')
  const [optionsText, setOptionsText] = useState(
    JSON.stringify(initialOptions, null, 2),
  )
  const [optionsError, setOptionsError] = useState<string | null>(null)

  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, startTest] = useTransition()
  const [saving, startSave] = useTransition()

  // ベンダーに紐づく機種だけにフィルタ
  const filteredModels = availableModels.filter((m) => {
    if (!vendor) return false
    if (vendor === 'i-pro-nx')           return m.vendor === 'i-pro' && m.model_number.startsWith('WJ-NX')
    if (vendor === 'i-pro-nu')           return m.vendor === 'i-pro' && m.model_number.startsWith('WJ-NU')
    if (vendor === 'i-pro-gxe500')       return m.vendor === 'i-pro' && m.model_number === 'WJ-GXE500'
    if (vendor === 'frigate')            return m.vendor === 'frigate'
    // Phase 5 で追加: 機種マスタにまだ未登録の場合は機種選択は空でOK
    if (vendor === 'hikvision')             return m.vendor === 'hikvision'
    if (vendor === 'hanwha-wisenet')        return m.vendor === 'hanwha'
    if (vendor === 'onvif-generic')         return m.vendor === 'onvif'
    // Phase 6 で追加
    if (vendor === 'synology-surveillance') return m.vendor === 'synology'
    // Phase 7 で追加
    if (vendor === 'axis-vapix')            return m.vendor === 'axis'
    if (vendor === 'dahua')                 return m.vendor === 'dahua'
    return false
  })

  function handleTest() {
    setTestResult(null)
    startTest(async () => {
      try {
        const res = await fetch(testApiPath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ vendor, endpoint, options: tryParseOptions() }),
        })
        const json = await res.json() as TestResult
        setTestResult(json)
      } catch (err) {
        setTestResult({ ok: false, message: (err as Error).message })
      }
    })
  }

  function handleSave(formData: FormData) {
    setOptionsError(null)
    setSaveMessage(null)
    try {
      JSON.parse(optionsText)
    } catch (err) {
      setOptionsError(`JSON parse error: ${(err as Error).message}`)
      return
    }
    if (onSave) {
      startSave(async () => {
        const r = await onSave(formData)
        if (r && typeof r === 'object') {
          setSaveMessage({ ok: r.ok, message: r.message ?? (r.ok ? '保存しました' : '保存に失敗') })
        }
      })
    }
  }

  function tryParseOptions(): Record<string, unknown> {
    try { return JSON.parse(optionsText) } catch { return {} }
  }

  return (
    <form action={handleSave} className="space-y-4">
      <input type="hidden" name="storeId" value={storeId} />

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          NVR 接続情報
        </h3>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">ベンダー</span>
            <select
              name="vendor"
              value={vendor}
              onChange={(e) => { setVendor(e.target.value as NvrVendor); setModel('') }}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">— 選択してください —</option>
              {VENDOR_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">機種</span>
            <select
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!vendor}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">— 選択 —</option>
              {filteredModels.map((m) => (
                <option key={m.model_number} value={m.model_number}>{m.display_name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">エンドポイント</span>
            <input
              type="text"
              name="endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://10.0.1.5:8443"
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">追加オプション (JSON)</span>
            <textarea
              name="options"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            {optionsError && (
              <p className="mt-1 text-xs text-red-600">{optionsError}</p>
            )}
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '💾 保存'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={!vendor || !endpoint || testing}
              aria-busy={testing}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {testing ? '接続中...' : '🔌 接続テスト'}
            </button>
          </div>
        </div>
      </div>

      {saveMessage && (
        <div className={
          'rounded-lg border-2 px-3 py-2 text-xs ' +
          (saveMessage.ok
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300')
        }>
          {saveMessage.ok ? '✓ ' : '✕ '}{saveMessage.message}
        </div>
      )}

      {testResult && <TestResultCard result={testResult} />}
    </form>
  )
}

function TestResultCard({ result }: { result: TestResult }) {
  if (result.ok) {
    return (
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950/30">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xl">✓</span>
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
            接続成功
          </span>
        </div>
        {result.modelNumber && (
          <dl className="grid grid-cols-2 gap-1 text-xs">
            <dt className="text-slate-500 dark:text-slate-400">機種</dt>
            <dd className="font-mono">{result.modelNumber}</dd>
            <dt className="text-slate-500 dark:text-slate-400">FW Ver</dt>
            <dd className="font-mono">{result.fwVersion}</dd>
            <dt className="text-slate-500 dark:text-slate-400">ベンダー</dt>
            <dd className="font-mono">{result.vendor}</dd>
          </dl>
        )}
      </div>
    )
  }
  return (
    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950/30">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xl">✕</span>
        <span className="text-sm font-bold text-red-700 dark:text-red-300">
          接続失敗
        </span>
      </div>
      <p className="text-xs text-red-700 dark:text-red-300">
        {result.message ?? '不明なエラー'}
      </p>
    </div>
  )
}
