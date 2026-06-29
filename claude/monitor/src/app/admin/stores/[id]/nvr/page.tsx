/**
 * F47: 店舗別 NVR 設定 (Admin 配下に移設)
 *
 * URL: /admin/stores/[id]/nvr
 *
 * モニタリングユーザに見せたくない管理者専用の設定:
 *   - NVR ベンダー / 機種 / エンドポイント / 認証情報 (vault 参照)
 *   - 検出された FW Ver / capability
 *   - 機材ライフサイクル (EOL/EOS)
 *
 * 旧パス /stores/[id]/nvr からの移設。AdminShell を使い admin 全体ナビと統合。
 */
import { notFound } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { CapabilityList } from '@/components/nvr/CapabilityList'
import { LifecycleCard } from '@/components/nvr/LifecycleCard'
import { NvrConnectionForm } from '@/components/nvr/NvrConnectionForm'
import { saveNvrConfig } from './actions'
import {
  CONSERVATIVE_CAPABILITIES, type NvrCapabilities, type StoreNvrLifecycle, type NvrVendor,
} from '@/lib/nvr-adapter/types'
import type { NvrModelsRow } from '@/lib/supabase/db-types'

interface StoreNvrRow {
  id:                   string
  name:                 string
  deployment_mode?:     string | null
  nvr_vendor?:          string | null
  nvr_model?:           string | null
  nvr_endpoint?:        string | null
  nvr_options?:         Record<string, unknown> | null
  nvr_fw_version?:      string | null
  nvr_fw_detected_at?:  string | null
  nvr_installed_at?:    string | null
  nvr_eol_date?:        string | null
  nvr_eos_date?:        string | null
  nvr_replace_by?:      string | null
}

export default async function AdminStoreNvrPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ saved?: string; error?: string }>
  },
) {
  const { id } = await params
  const { saved, error: errorMsg } = await searchParams
  const supa = await createSupabaseServer()

  let store: StoreNvrRow | null = null
  try {
    const { data } = await supa.from('stores').select('*').eq('id', id).single()
    store = data as never as StoreNvrRow
  } catch {
    const { data } = await supa.from('stores').select('id, name').eq('id', id).single()
    store = data as never as StoreNvrRow
  }
  if (!store) notFound()

  let availableModels: NvrModelsRow[] = []
  try {
    const { data } = await supa.from('nvr_models').select('*').order('vendor').order('model_number')
    availableModels = (data ?? []) as never as NvrModelsRow[]
  } catch {
    availableModels = []
  }

  let lifecycle: StoreNvrLifecycle = {
    storeId:         store.id,
    storeName:       store.name,
    nvrVendor:       (store.nvr_vendor ?? null) as NvrVendor | null,
    nvrModel:        store.nvr_model ?? null,
    installedAt:     store.nvr_installed_at ?? null,
    eolDate:         store.nvr_eol_date ?? null,
    eosDate:         store.nvr_eos_date ?? null,
    replaceBy:       store.nvr_replace_by ?? null,
    monthsUntilEos:  null,
    yearsInService:  null,
    lifecycleStatus: 'nvr_lifecycle_unknown',
  }
  try {
    const { data } = await supa
      .from('v_store_nvr_lifecycle')
      .select('*')
      .eq('store_id', id)
      .maybeSingle()
    if (data) {
      const r = data as {
        store_id: string; store_name: string
        nvr_vendor: NvrVendor | null; nvr_model: string | null
        nvr_installed_at: string | null; nvr_eol_date: string | null
        nvr_eos_date: string | null; nvr_replace_by: string | null
        months_until_eos: number | null; years_in_service: number | null
        lifecycle_status: StoreNvrLifecycle['lifecycleStatus']
      }
      lifecycle = {
        storeId:         r.store_id,
        storeName:       r.store_name,
        nvrVendor:       r.nvr_vendor,
        nvrModel:        r.nvr_model,
        installedAt:     r.nvr_installed_at,
        eolDate:         r.nvr_eol_date,
        eosDate:         r.nvr_eos_date,
        replaceBy:       r.nvr_replace_by,
        monthsUntilEos:  r.months_until_eos,
        yearsInService:  r.years_in_service,
        lifecycleStatus: r.lifecycle_status,
      }
    }
  } catch {
    /* VIEW 未存在: unknown 維持 */
  }

  const capabilities: NvrCapabilities = CONSERVATIVE_CAPABILITIES

  return (
    <AdminShell pathname="/admin/stores" section="admin">
      <PageHeader
        title={`NVR 設定: ${store.name}`}
        crumb={[
          { href: '/admin',                       label: '設定' },
          { href: '/admin/stores',                label: '店舗' },
          { href: `/admin/stores/${id}`,          label: store.name },
          { href: `/admin/stores/${id}/nvr`,      label: 'NVR' },
        ]}
      />

      <div className="max-w-6xl space-y-4 px-5 py-5">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          NVR ベンダー・機種・接続情報を設定し、「接続テスト」で疎通確認できます。
          認証情報は Vault 参照 (uuid) として保存され、生のパスワードは DB に残りません。
        </p>

        {saved && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Check size={15} strokeWidth={1.5} aria-hidden /> 保存しました
          </div>
        )}
        {errorMsg && (
          <div className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
            <X size={15} strokeWidth={1.5} aria-hidden /> {errorMsg}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <NvrConnectionForm
            storeId={id}
            initialVendor={(store.nvr_vendor ?? null) as NvrVendor | null}
            initialModel={store.nvr_model ?? null}
            initialEndpoint={store.nvr_endpoint ?? null}
            initialOptions={store.nvr_options ?? {}}
            availableModels={availableModels}
            apiBasePath={`/api/admin/stores/${id}/nvr`}
            onSave={saveNvrConfig}
          />

          <div className="space-y-4">
            <CapabilityList capabilities={capabilities} provisional />
            <LifecycleCard lifecycle={lifecycle} lang="ja" />
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
