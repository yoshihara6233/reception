/**
 * テスト発令の「アラート発令日時」の入力欄 (datetime-local・JST) の値 (2026-11-04)。
 *
 * 以前は既定値を `new Date().toISOString().slice(0, 16)` で作っており、これは UTC の文字列なので
 * 日本では 9 時間前が入っていた (G・VMS のシナリオ試験 S-9 の 9-c6 で 11:06 に 02:05)。
 * 送るときも `new Date(欄の値)` で端末の時間帯として読んでいたので、JST に固定する。
 */
import { fromJstInput, toJstInput } from '@/lib/video/playback-nav'

/** 今の時刻 (分まで・JST) を入力欄の値にする。 */
export function defaultIssuedInput(nowMs: number = Date.now()): string {
  const minute = nowMs - (nowMs % 60_000)
  return toJstInput(new Date(minute).toISOString()).slice(0, 16)
}

/** 入力欄の値 (JST) を送る時刻 (ISO) にする。読めなければ null。 */
export function issuedInputToIso(v: string): string | null {
  return fromJstInput(v)
}
