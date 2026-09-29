/**
 * SFU（LiveKit Cloud）ベータの共通ロジック（server-only）。
 *
 * セキュリティ方針:
 *  - 視聴トークンは「カメラIDから導出した room・**購読専用**・可視性は RLS で検証」。
 *    クライアントに room / identity / canPublish を選ばせない（なりすまし・配信注入を防ぐ）。
 *  - publish（配信）は **monitor が起点**（/api/livekit/publish が Ingress 発行＋start_sfu dispatch）。エッジに鍵は不要。
 *  - 機能フラグ LIVEKIT_ENABLED='true' ＋ 3つの必須env が揃うときだけ有効（既定 OFF）。
 */

/** 視聴トークンのTTL（秒）。クライアントは切れる前に取り直す。 */
export const LIVEKIT_VIEWER_TTL_SEC = 900 // 15分

/**
 * SFU 機能が有効か。**明示的な opt-in**（LIVEKIT_ENABLED='true'）＋ creds 3点が必要。
 * creds を置いただけ（テスト等）では有効化しない安全既定。
 */
export function livekitEnabled(): boolean {
  if (process.env.LIVEKIT_ENABLED !== 'true') return false
  return (
    !!process.env.LIVEKIT_URL?.trim() &&
    !!process.env.LIVEKIT_API_KEY?.trim() &&
    !!process.env.LIVEKIT_API_SECRET?.trim()
  )
}

/**
 * G・VMS の拠点への SFU（GVMS_CLOUD_SPEC §5.4）を出すか。
 * 2026-09-29 に保留（LiveKit は自前のサーバを検討するまで使わない。遠隔視聴は JPEG・HLS で
 * 提供する）。GVMS_SFU_ENABLED='true' を置いたときだけ出す（既定 OFF）。従来のエッジ端末の
 * SFU ベータ（livekitEnabled）とは別に切れるよう、フラグを分けている。
 */
export function gvmsSfuEnabled(): boolean {
  return process.env.GVMS_SFU_ENABLED === 'true' && livekitEnabled()
}

/**
 * カメラID → LiveKit room 名。go2rtc のストリーム名と同規則（`cam_<cameraId>`）。
 * room はサーバでのみ導出し、クライアントの任意指定を受け付けない。
 */
export function roomForCamera(cameraId: string): string {
  return `cam_${cameraId}`
}
