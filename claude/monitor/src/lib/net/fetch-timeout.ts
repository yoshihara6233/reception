/**
 * 外への fetch の時間切れ (2026-10-30・自主診断 ASVS 15.2.2)。
 *
 * `AbortSignal.timeout(ms)` は本文を読み終えるまでを数えるので、本文を利用者へ流す
 * 中継 (録画の HLS の断片) に使うと、受け手の回線が遅いだけで途中で切れる。
 * ここでは「応答の見出しが届くまで」だけを数える。見出しが届いたら時計を止め、
 * 本文の流れは受け手の速さに任せる (関数の上限 maxDuration が最後の歯止め)。
 */
export async function fetchWithHeaderTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new DOMException('header timeout', 'TimeoutError')), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}
