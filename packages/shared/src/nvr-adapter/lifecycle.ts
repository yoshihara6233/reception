/**
 * NVR ライフサイクル管理用の型 (packages/shared 版・正本)
 *
 * v_store_nvr_lifecycle VIEW と対応。UI 側で取得して NVR タブのライフサイクル
 * カードを描画する。
 *
 * 設計: docs/tier3/eol-eos-data-model.md
 */
import type { NvrVendor } from './types'

export type NvrLifecycleStatus =
  | 'nvr_lifecycle_unknown'
  | 'nvr_lifecycle_ok'
  | 'nvr_lifecycle_warning'           // EOS まで 12〜24 ヶ月
  | 'nvr_lifecycle_replace_planned'   // EOS まで 6〜12 ヶ月
  | 'nvr_lifecycle_urgent'            // EOS まで 6 ヶ月以内
  | 'nvr_lifecycle_eos'               // EOS 超過
  | 'nvr_lifecycle_overage'           // 7 年ルール超過

export interface StoreNvrLifecycle {
  storeId:          string
  storeName:        string
  nvrVendor:        NvrVendor | null
  nvrModel:         string | null
  installedAt:      string | null        // ISO date
  eolDate:          string | null
  eosDate:          string | null
  replaceBy:        string | null
  monthsUntilEos:   number | null
  yearsInService:   number | null
  lifecycleStatus:  NvrLifecycleStatus
}
