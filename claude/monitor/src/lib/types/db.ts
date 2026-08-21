// Minimal hand-typed shape of the new tables introduced in
// 20260519_001_recorder_monitoring.sql. Regenerate from Supabase CLI later.

export type EdgeStatus = 'offline' | 'idle' | 'grid' | 'live' | 'vod' | 'error'
export type EdgeMode   = 'grid' | 'live' | 'vod'
export type RecorderVendor = 'ipro' | 'frigate' | 'onvif-generic' | 'i-pro-nvr'

/**
 * Vendors whose recorders support VOD playback today.
 *
 * ⚠ **ここに載せてよいのは、エッジ側に実装があるものだけ。**
 *   この配列は UI の録画ボタンの出し分け（isVodVendor）に直結する一方、
 *   実際に録画を取りに行くのは edge-agent の modes/vod.ts で、両者は
 *   別のリポジトリ部分にある。以前 uniview がここに入ったまま vod.ts 側に
 *   実装が無く、**録画ボタンは出るが押すと失敗する**状態になっていた
 *   （2026-08-19 に uniview ごと削除）。足すときは vod.ts の分岐も見ること。
 *
 * - frigate : HTTP MP4 export (clip.mp4 generated on demand). The whole range
 *   is generated before the first frame, so we cap the requested window
 *   tighter for frigate (see VOD_RANGE_MAX_MIN_BY_VENDOR).
 * - i-pro-nvr / onvif-generic + vod_host : i-PRO NVR の httpdl.cgi で取得。
 * - ipro    : not supported; needs ONVIF Profile-G (Phase 2 work).
 */
export const VOD_VENDORS = ['frigate', 'onvif-generic', 'i-pro-nvr'] as const
export type VodVendor = (typeof VOD_VENDORS)[number]
export function isVodVendor(v: RecorderVendor): v is VodVendor {
  return (VOD_VENDORS as readonly RecorderVendor[]).includes(v)
}

/**
 * **このカメラから実際に録画を切り出せるか。**判定はここ 1 箇所。
 *
 * `isVodVendor()` はベンダ名だけを見る型ガードで、**実運用の可否とは違う**。
 * onvif-generic はカメラ直なので、VOD ソース(NVR)が設定されていなければ
 * ベンダが対応でも取れない。この差を呼び出し側それぞれに書かせると必ずずれる。
 *
 * 実際にずれた: BCP の 5 分動画メニューを足したとき、画面側は `isVodVendor()`
 * だけで判定し、API 側は vod_host まで見ていた。**メニューは押せるのに
 * 押したら 422** という、操作するまで分からない食い違いになっていた。
 * 以降、画面と API は必ずこの関数を通す。
 */
export function canFetchVod(
  vendor: string,
  vodHost: string | null | undefined,
): boolean {
  if (vendor === 'frigate' || vendor === 'i-pro-nvr') return true
  if (vendor === 'onvif-generic') return !!vodHost
  return false
}

/**
 * 要求できる VOD 区間の上限（分）。
 *
 * ⚠ **効いているのは NVR の仕様ではなく、保存先の 1 ファイル上限。**
 *   i-PRO の httpdl は 1 リクエスト 1 時間まで受けるので、以前はここを 60 に
 *   していた。だが Supabase Storage の上限（既定 50MB）に対し、60 分の録画が
 *   収まるはずがない。**選べるのに保存できない**状態で、押して初めて失敗が
 *   分かる形だった（2026-08-21、BCP の 5 分クリップで表面化）。
 *
 *   エッジは長さから逆算した帯域で作り直し、収まらない長さは取得前に断る
 *   （edge-agent の util/upload-fit.ts）。45MB・下限 300kbps + 音声 64kbps で
 *   計算すると上限は 16.4 分なので、余裕を見て 15 分にそろえた。
 *   **Storage の上限を上げたら、両方を上げること。**
 *
 *   frigate は別の理由で 5 分。clip.mp4 は全区間を作り終えてから 1 フレーム目を
 *   返すため、長いとエッジのメモリと初期表示が持たない。
 */
export const VOD_RANGE_MAX_MIN_BY_VENDOR: Record<VodVendor, number> = {
  frigate: 5,
  'onvif-generic': 15,
  'i-pro-nvr': 15,
}

export interface Store {
  id: string
  tenant_id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  area_code: string | null
  geocoded_at: string | null
  is_active: boolean
}

export interface EdgeDevice {
  id: string
  store_id: string
  name: string
  /**
   * 端末トークンの SHA-256(hex)。**平文は DB に無い**（M-5 段階2で列ごと削除）。
   * 払出時のレスポンスが平文の唯一の出口で、失くしたら再発行しかない。
   */
  device_token_hash: string
  agent_version: string | null
  status: EdgeStatus
  current_mode: EdgeMode | null
  last_seen_at: string | null
}

export interface Recorder {
  id: string
  edge_id: string
  vendor: RecorderVendor
  model: string | null
  host: string
  rtsp_port: number
  onvif_port: number | null
  username: string
}

export interface RecorderCamera {
  id: string
  recorder_id: string
  channel: number
  name: string
  grid_pos: number
  enabled: boolean
}

export interface LiveSession {
  id: string
  user_id: string
  store_id: string
  camera_id: string | null
  mode: EdgeMode
  livekit_room: string | null
  vod_from: string | null
  vod_to: string | null
  started_at: string
  ended_at: string | null
}
