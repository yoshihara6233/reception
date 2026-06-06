/**
 * F46.19: i-PRO WJ-NX Adapter Factory
 *
 * FW Ver を検出して v1/v2/v3+ サブクラスを返すファクトリ。
 * 各サブクラスは IProBaseAdapter を継承し、世代別の API 差分を吸収。
 */
import type { NvrAdapter, NvrAdapterConfig } from '../../_base'
import { detectIProFirmware, deriveCapabilities } from '../_common'
import { IProNxV1Adapter } from './nx-v1-adapter'
import { IProNxV2Adapter } from './nx-v2-adapter'
import { IProNxV3PlusAdapter } from './nx-v3-plus-adapter'

export async function createIProNxAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  const firmware = await detectIProFirmware({
    endpoint:    config.endpoint,
    credentials: config.credentials,
    timeoutMs:   config.timeoutMs,
  })
  const capabilities = deriveCapabilities(firmware)

  // FW Ver に応じて適切なサブクラスを返す
  if (firmware.fwMajor >= 3) {
    return new IProNxV3PlusAdapter(config, firmware, capabilities)
  }
  if (firmware.fwMajor >= 2) {
    return new IProNxV2Adapter(config, firmware, capabilities)
  }
  return new IProNxV1Adapter(config, firmware, capabilities)
}

export {
  IProNxV1Adapter,
  IProNxV2Adapter,
  IProNxV3PlusAdapter,
}
