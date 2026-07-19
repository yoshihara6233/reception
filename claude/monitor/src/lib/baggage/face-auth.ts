/**
 * 顔認証まわりの純ヘルパ（M3）
 *
 * Rekognition 呼び出し自体は lib/aws/rekognition.ts（コア層）。ここは
 *   - withTimeout: 3秒レース（超過は auth_skipped でフロー継続 — 可用性優先・D）
 *   - lastNameOf: 姓のみ表示（OV#13 — フルネームを画面に出さない）
 *   - jstYmd: 来訪者当日コレクション名の日付部（JST）
 * のみを持つ I/O なしユーティリティ。
 */

import { jstDateStr } from './unmatch'

export type TimeoutResult<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'error' }

/**
 * Promise を ms でレースする。超過・失敗は ok:false（呼び出し側が auth_skipped に落とす）。
 * Rekognition 側の処理は中断できないが、結果は破棄される。
 */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms)
  })
  try {
    const winner = await Promise.race([
      p.then((value) => ({ ok: true, value }) as TimeoutResult<T>),
      timeout,
    ])
    return winner
  } catch {
    return { ok: false, reason: 'error' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 「田中 花子」→「田中」。全角/半角スペース区切りの先頭。区切り無しはそのまま。 */
export function lastNameOf(fullName: string): string {
  return fullName.trim().split(/[\s　]+/)[0] ?? fullName
}

/** JST の yyyymmdd（来訪者当日コレクション baggage-<store>-<ymd> 用）。 */
export function jstYmd(now: Date): string {
  return jstDateStr(now).replaceAll('-', '')
}
