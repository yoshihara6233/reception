/**
 * F46.11: Adapter Registry — vendor 文字列 → ファクトリ関数
 *
 * 新ベンダー追加 = ADAPTER_REGISTRY に 1 行追加 + adapters/<vendor>/ を作成。
 * 既存コード (commands/, modes/, …) は触らない (Open/Closed)。
 */
import type { NvrVendor, NvrAdapter, NvrAdapterConfig, AdapterFactory } from '../_base'

/**
 * vendor → ファクトリ関数。ファクトリは dynamic import で各 adapter モジュール
 * を遅延ロードする (起動コストとメモリを最小化)。
 *
 * Phase 0 で登録されるベンダー:
 *   - 'frigate'     ← 現行 Mini PC モード (F46.21 で実装)
 *   - 'i-pro-nx'    ← WJ-NX シリーズ (F46.19 で実装)
 *   - 'i-pro-nu'    ← WJ-NU シリーズ (F46.20 で実装)
 *
 * Phase 1 以降の追加枠:
 *   - 'i-pro-gxe500'
 *
 * Phase 5+ で追加候補:
 *   - 'hikvision', 'hanwha-wisenet', 'synology-surveillance',
 *     'axis-vapix', 'onvif-generic'
 */
export const ADAPTER_REGISTRY: Partial<Record<NvrVendor, AdapterFactory>> = {
  // === 現行 Mini PC モード互換 ===
  'frigate': async (cfg) => {
    const mod = await import('../frigate/frigate-adapter')
    return mod.createFrigateAdapter(cfg)
  },

  // === i-PRO 系 (Phase 0/1 で実装) ===
  'i-pro-nx': async (cfg) => {
    const mod = await import('../i-pro/nx-series/nx-adapter')
    return mod.createIProNxAdapter(cfg)
  },

  'i-pro-nu': async (cfg) => {
    const mod = await import('../i-pro/nu-series/nu-adapter')
    return mod.createIProNuAdapter(cfg)
  },

  // F52.C: WJ-GXE500 (アナログ→IP 変換)
  'i-pro-gxe500': async (cfg) => {
    const mod = await import('../i-pro/gxe500/gxe-adapter')
    return mod.createIProGxe500Adapter(cfg)
  },

  // F52.B: Hikvision (ISAPI)
  'hikvision': async (cfg) => {
    const mod = await import('../hikvision/hikvision-adapter')
    return mod.createHikvisionAdapter(cfg)
  },

  // F52.D: Hanwha Wisenet (SUNAPI)
  'hanwha-wisenet': async (cfg) => {
    const mod = await import('../hanwha/hanwha-adapter')
    return mod.createHanwhaAdapter(cfg)
  },

  // F52.A: ONVIF 汎用 (未知ベンダーの fallback)
  'onvif-generic': async (cfg) => {
    const mod = await import('../onvif/onvif-generic-adapter')
    return mod.createOnvifGenericAdapter(cfg)
  },

  // F53.D: Synology Surveillance Station (NAS ベース)
  'synology-surveillance': async (cfg) => {
    const mod = await import('../synology/synology-adapter')
    return mod.createSynologyAdapter(cfg)
  },

  // F55.A: Axis VAPIX (Phase 7)
  'axis-vapix': async (cfg) => {
    const mod = await import('../axis/axis-adapter')
    return mod.createAxisAdapter(cfg)
  },

  // F55.B: Dahua DH-NVR / IPC (Phase 7)
  'dahua': async (cfg) => {
    const mod = await import('../dahua/dahua-adapter')
    return mod.createDahuaAdapter(cfg)
  },
}

/**
 * 動的に adapter インスタンスを生成。
 *
 * @throws Error if vendor is not registered
 */
export async function getAdapter(
  vendor: NvrVendor,
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  const factory = ADAPTER_REGISTRY[vendor]
  if (!factory) {
    throw new Error(
      `No adapter registered for vendor: ${vendor}. ` +
      `Available: ${Object.keys(ADAPTER_REGISTRY).join(', ')}`,
    )
  }
  return factory(config)
}

/** 登録済ベンダー一覧 (UI のドロップダウン用) */
export function listRegisteredVendors(): NvrVendor[] {
  return Object.keys(ADAPTER_REGISTRY) as NvrVendor[]
}
