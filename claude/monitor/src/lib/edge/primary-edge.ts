/**
 * 拠点に複数のエッジがあるとき、画面で「その拠点のエッジ」として代表に使う 1 台を選ぶ。
 *
 * 以前は PostgREST の埋め込み取得 `stores ( edge_devices (...) )` の先頭 (`[0]`) を
 * 使っていた。埋め込みには順序の指定が無いので、どれが先頭になるかは DB 次第になる。
 * 実例 (2026-10-16): 拠点「PoC 熊本店」に止まった旧エッジと動いているエッジの 2 台が
 * 登録されていて、拠点の画面は止まった方を表示していた。
 *
 * 選び方: last_seen_at (最後に通知が届いた時刻) がいちばん新しいもの。
 *   - last_seen_at が null (一度も通知が無い)・読めない値のものは最後に回す
 *   - 同じ時刻なら id の昇順で決める (描画のたびに入れ替わらないように)
 *
 * 管理画面のエッジ一覧のように「全エッジを並べる」箇所には使わない。
 * 先頭 1 台を代表に使っていた箇所だけを、この関数に置き換える。
 */

export type PrimaryEdgeCandidate = {
  id?: string | null
  last_seen_at?: string | null
}

/** last_seen_at をミリ秒へ。null・読めない値は null。 */
function seenMs(e: PrimaryEdgeCandidate): number | null {
  if (!e.last_seen_at) return null
  const t = Date.parse(e.last_seen_at)
  return Number.isNaN(t) ? null : t
}

/**
 * 代表のエッジを返す。空・null・undefined なら undefined。
 * 引数の配列は並べ替えない (コピーもしない・1 回なめるだけ)。
 */
export function pickPrimaryEdge<T extends PrimaryEdgeCandidate>(
  edges: readonly T[] | null | undefined,
): T | undefined {
  if (!edges || edges.length === 0) return undefined
  let best: T | undefined
  let bestMs: number | null = null
  for (const e of edges) {
    if (!e) continue
    const ms = seenMs(e)
    if (best === undefined) { best = e; bestMs = ms; continue }
    if (isBetter(ms, e.id ?? null, bestMs, best.id ?? null)) { best = e; bestMs = ms }
  }
  return best
}

/** 候補 a が現在の最良 b より優先されるか。 */
function isBetter(aMs: number | null, aId: string | null, bMs: number | null, bId: string | null): boolean {
  if (aMs !== bMs) {
    if (aMs === null) return false
    if (bMs === null) return true
    return aMs > bMs
  }
  // 時刻が同じ (両方 null も含む) なら id の昇順。id が無いものは配列の順のまま
  if (aId !== null && bId !== null) return aId < bId
  return false
}
