/**
 * 単一カメラのライブと録画再生を行き来するための、時刻と行き先の計算。
 *
 * 2026-09-26 利用者の要望: ライブで気になった場面を見返すのに、分割画面へ戻って
 * 長いカメラの一覧から同じカメラを選び直すのは遠回り。ライブの画面に録画再生と
 * 同じ操作（開始時刻・5 分／30 秒の移動）を最初から並べ、押したらそのカメラの
 * 録画再生へ移る。録画再生で今より先へ進めたら、ライブへ戻す。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ライブから「この時刻から再生」の入力欄に最初に入れておく時刻（今の何秒前か）。 */
export const LIVE_DEFAULT_BACK_SEC = 60

/**
 * 録画再生でこれより今に近い時刻を指定されたら、ライブへ戻す。録画は書き込みの
 * 途中の区切りをまだ送れないので、今ぴったりを録画で開いても映らない。
 */
export const LIVE_EDGE_MS = 5_000

/** ISO → datetime-local の値（JST・秒まで）。 */
export function toJstInput(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 19)
}

/** datetime-local の値（JST）→ ISO。読めなければ null。 */
export function fromJstInput(v: string): string | null {
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}+09:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 指定の時刻がライブで見る範囲（今の LIVE_EDGE_MS 以内か、今より先）か。 */
export function isLiveEdge(iso: string, nowMs: number = Date.now()): boolean {
  return new Date(iso).getTime() > nowMs - LIVE_EDGE_MS
}

export function liveHref(storeId: string, cameraId: string): string {
  return `/stores/${storeId}/cam/${cameraId}/live`
}

/**
 * 録画再生の行き先。
 * rangeMin が null のカメラ（G・VMS の拠点の HLS 録画再生・Frigate の HLS）は
 * 開始時刻だけで開ける。それ以外は範囲の切り出しなので、終わりの時刻も付ける。
 */
export function vodHref(
  storeId: string,
  cameraId: string,
  fromIso: string,
  rangeMin: number | null,
): string {
  let q = `from=${encodeURIComponent(fromIso)}`
  if (rangeMin != null) {
    const to = new Date(new Date(fromIso).getTime() + rangeMin * 60_000).toISOString()
    q += `&to=${encodeURIComponent(to)}`
  }
  return `/stores/${storeId}/cam/${cameraId}/vod?${q}`
}
