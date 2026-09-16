/**
 * Phase 2b（NVMS/docs/UPLINK_CLIPS_SPEC.md）: アップリンク経由の BCP/VOD
 * アップロード受け口の共通部品。
 *
 * ストレージのキーは既存エッジの命名と揃える（PDF sweep・詳細画面・点検が
 * パスの形を前提にしているため）:
 *   カメラ個別: bcp-clips/<eventId>/<cameraId>/<offsetKey>_<JST時刻>.jpg
 *   合成      : bcp-clips/<eventId>/_grid/p<page3桁>_<offsetKey>_<JST時刻>.jpg
 *   VOD       : vod-clips/cam_<cameraId>/<from14桁>_<to14桁>.mp4
 * 時刻は「T+offset の狙い時刻」から決定的に作る — リトライで同じ要求なら
 * 同じキーになる（署名URLの再発行が冪等になる）。
 */

/** -5 → 'm5', 0 → 'p0', 30 → 'p30'（エッジの offsetKey と同一規則・整列可能） */
export function offsetKey(offsetMin: number): string {
  return offsetMin < 0 ? `m${-offsetMin}` : `p${offsetMin}`
}

/** JST の YYYYMMDD_HHMMSS（エッジの F61 命名と同一） */
export function jstStamp(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600_000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}`
    + `_${p(j.getUTCHours())}${p(j.getUTCMinutes())}${p(j.getUTCSeconds())}`
}

/** VOD の storage_path（エッジ modes/vod.ts の stamp() と同一規則） */
export function vodStoragePath(cameraId: string, fromIso: string, toIso: string): string {
  const stamp = (s: string) => new Date(s).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `cam_${cameraId}/${stamp(fromIso)}_${stamp(toIso)}.mp4`
}

/** 合成ショットの storage_path。 */
export function gridShotStoragePath(
  eventId: string, pageNo: number, offsetMin: number, targetAt: Date,
): string {
  return `${eventId}/_grid/p${String(pageNo).padStart(3, '0')}_${offsetKey(offsetMin)}_${jstStamp(targetAt)}.jpg`
}

/** カメラ個別ショットの storage_path（既存エッジと同一形）。 */
export function cameraShotStoragePath(
  eventId: string, cameraId: string, offsetMin: number, targetAt: Date,
): string {
  return `${eventId}/${cameraId}/${offsetKey(offsetMin)}_${jstStamp(targetAt)}.jpg`
}
