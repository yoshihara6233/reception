/**
 * F46.20: i-PRO WJ-NU Adapter
 *
 * WJ-NU シリーズは WJ-NX とほぼ同じ CGI API を持つが、機種ごとに max channels が
 * 異なる (NU101K=4 / NU201K=8 / NU301K=16)。capability-matrix.ts で吸収済み。
 *
 * 世代別差分は WJ-NX と同様なので、NX のクラスを「vendor 文字列だけ違う形」で
 * 再利用する。継承はせず、constructor の vendor 引数で 'i-pro-nu' を渡すだけ。
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo,
} from '../../_base'
import { detectIProFirmware, deriveCapabilities } from '../_common'
import type { IProBaseAdapterDeps } from '../_common/i-pro-base-adapter'
import { IProNxV1Adapter } from '../nx-series/nx-v1-adapter'
import { IProNxV2Adapter } from '../nx-series/nx-v2-adapter'
import { IProNxV3PlusAdapter } from '../nx-series/nx-v3-plus-adapter'

// NU 用ファクトリ関数 — vendor を 'i-pro-nu' で構築
function makeNuV1(c: NvrAdapterConfig, fw: FirmwareInfo, caps: NvrCapabilities, deps?: IProBaseAdapterDeps) {
  return new IProNxV1Adapter(c, fw, caps, deps, 'i-pro-nu')
}
function makeNuV2(c: NvrAdapterConfig, fw: FirmwareInfo, caps: NvrCapabilities, deps?: IProBaseAdapterDeps) {
  return new IProNxV2Adapter(c, fw, caps, deps, 'i-pro-nu')
}
function makeNuV3Plus(c: NvrAdapterConfig, fw: FirmwareInfo, caps: NvrCapabilities, deps?: IProBaseAdapterDeps) {
  return new IProNxV3PlusAdapter(c, fw, caps, deps, 'i-pro-nu')
}

export async function createIProNuAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  const firmware = await detectIProFirmware({
    endpoint:    config.endpoint,
    credentials: config.credentials,
    timeoutMs:   config.timeoutMs,
  })
  const capabilities = deriveCapabilities(firmware)

  if (firmware.fwMajor >= 3) return makeNuV3Plus(config, firmware, capabilities)
  if (firmware.fwMajor >= 2) return makeNuV2(config, firmware, capabilities)
  return makeNuV1(config, firmware, capabilities)
}

// テスト等で参照する用に re-export
export { IProNxV1Adapter as IProNuV1Adapter }
export { IProNxV2Adapter as IProNuV2Adapter }
export { IProNxV3PlusAdapter as IProNuV3PlusAdapter }
