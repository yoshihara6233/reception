/**
 * NVMS カメラ同期の割付ロジック（純粋関数・/api/edge/nvms-sync から使用）
 *
 * ルートから切り出してあるのは、slot 割付と無効化判定が「静かに壊れる」
 * 種類のものだから。割付を誤っても同期は成功に見え、気づくのは
 * グリッドが欠けたとき・過去クリップの参照が消えたとき。
 */

export interface ExistingCam {
  id: string; channel: number; grid_pos: number
  /** G・VMS 側で削除された日時。null/省略 = 登録あり */
  removed_at?: string | null
}
export interface IncomingCam { id: number; name: string; folder_path: string | null; enabled: boolean }

export interface PlannedRow {
  recorder_id: string
  channel: number
  name: string
  folder_path: string | null
  enabled: boolean
  grid_pos: number
  /** スナップショットにある = G・VMS に登録あり。一度消えて戻ったカメラもここで印を外す */
  removed_at: null
}

/**
 * upsert する行を組み立てる。
 *   - 既存カメラ: grid_pos を**維持**（手で 0..15 に置いたものを同期が壊さない）
 *   - 新規カメラ: 空きスロット 0..15 を先着で埋め、以降は -1（フォルダページ表示）
 */
export function planCameraRows(
  recorderId: string,
  existing: readonly ExistingCam[],
  incoming: readonly IncomingCam[],
): PlannedRow[] {
  const byChannel = new Map(existing.map((c) => [c.channel, c]))
  const used = new Set(existing.map((c) => c.grid_pos))
  const nextSlot = (): number => {
    for (let i = 0; i < 16; i++) if (!used.has(i)) { used.add(i); return i }
    return -1
  }
  return incoming.map((c) => ({
    recorder_id: recorderId,
    channel:     c.id,
    name:        c.name,
    folder_path: c.folder_path,
    enabled:     c.enabled,
    grid_pos:    byChannel.get(c.id)?.grid_pos ?? nextSlot(),
    removed_at:  null,
  }))
}

/**
 * NVMS 側から**新たに**消えたカメラの行 id（enabled=false・removed_at を入れる対象）。
 * **削除はしない** — vod_clips / video_sessions は一緒に消え（cascade）、alarm_events は
 * 削除そのものが失敗し、bcp_clips などはカメラ名を失う。行は残し、removed_at で
 * 画面と台数から外す。既に removed_at が入っている行は返さない（消えた日時を毎回上書きしない）。
 */
export function computeGoneIds(
  existing: readonly ExistingCam[],
  presentIds: readonly number[],
): string[] {
  const present = new Set(presentIds)
  return existing.filter((c) => !present.has(c.channel) && !c.removed_at).map((c) => c.id)
}
