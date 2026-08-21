/**
 * BCP スナップショットから切り出す動画の区間。**定義はここ 1 箇所。**
 *
 * ── なぜ 1 箇所に置くのか ──────────────────────────────────────────────
 * この区間は 2 つの用途で使われ、**両者が完全に一致していないと嘘をつく**:
 *   ① タイルに「動画あり」と出すための照合（サーバ側・page.tsx）
 *   ② 実際に取得を頼むときの from/to（クライアント側・SnapshotTile.tsx）
 *
 * VOD の再利用は (camera_id, requested_from, requested_to) の完全一致で効く。
 * 長さの定数が 2 箇所にあると、片方だけ変えたときに
 * **「動画あり」と表示したのに押すと作り直しが走る**——表示は正しそうに見えて
 * 中身が違う、という形になる。定数と計算をここへ寄せる。
 */

/** 1 コマから切り出す長さ（分）。スナップの間隔と同じにして、コマ間を埋める。 */
export const SNAPSHOT_CLIP_MINUTES = 5

/** 照合にも要求にも使う区間。ISO 文字列は必ずここで正規化する。 */
export function snapshotClipRange(shotAtIso: string): { fromIso: string; toIso: string } {
  const from = new Date(shotAtIso)
  const to   = new Date(from.getTime() + SNAPSHOT_CLIP_MINUTES * 60_000)
  return { fromIso: from.toISOString(), toIso: to.toISOString() }
}

/**
 * 再利用の照合キー。**DB の µ 秒表記と送信時の ISO を突き合わせるため、
 * 文字列ではなくエポック ms で作る。**
 */
export function snapshotClipKey(cameraId: string, fromIso: string, toIso: string): string {
  return `${cameraId}|${new Date(fromIso).getTime()}|${new Date(toIso).getTime()}`
}
