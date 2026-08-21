/**
 * BCP スナップショットの取得可否（純粋ロジック）。
 *
 * bcp.ts 本体は supabase / config を読み込むため、テストから直接触れない。
 * bcp-timing.ts と同じく、判定だけをここに切り出してテスト可能にする。
 *
 * 背景: ベンダを増やしたときに captureOneSnapshot の分岐へ追加し忘れると、平時は
 * 誰も気づかず、発災した瞬間に初めて 'no snapshot URL for vendor' で 8 枚すべてが
 * 落ちる。実際 `i-pro-nvr`（カメラ網が業務網から分離され、エッジから NVR にしか
 * 到達できない現場向けの構成）が丸ごと抜けていた。switch を網羅にすることで、
 * 新ベンダ追加時にコンパイルエラーで気づけるようにしている。
 */
import type { Vendor } from '../types.js'

export interface BcpCapabilityInput {
  vendor: Vendor
  /** onvif-generic で録画を担う NVR。null = カメラ直のみ。 */
  vodHost: string | null
}

/**
 * このカメラ構成に、発災前後（過去時刻）のフレームを取得する経路があるか。
 *
 * BCP は 8 枚すべてが過去オフセット扱いで撮られる（bcp-timing の
 * FUTURE_OFFSET_SETTLE_MS 参照）ため、「過去が取れるか」が可否を決める。
 */
export function hasBcpSnapshotPath(i: BcpCapabilityInput): boolean {
  switch (i.vendor) {
    case 'frigate':   return true   // 録画から過去フレーム ＋ latest.jpg
    case 'ipro':      return true   // snapshot.cgi（FW v3+ は ?time= で過去）
    case 'i-pro-nvr': return true   // httpdl.cgi 録画 ＋ push.cgi 現フレーム
    // カメラ直構成。カメラ側に録画が無いので、NVR を併記しない限り過去は作れない。
    case 'onvif-generic': return !!i.vodHost
  }
  const exhaustive: never = i.vendor
  return exhaustive
}

/** 取得経路が無いときに、設定不備だと即断できる理由文を返す。 */
export function bcpUnavailableReason(i: BcpCapabilityInput): string {
  if (i.vendor === 'onvif-generic') {
    return 'onvif-generic camera has no vod_host (NVR) — past frames are unavailable'
  }
  return `no BCP snapshot path for vendor "${i.vendor}"`
}
