/**
 * ログインまわりの画面から、サーバの受け口 (/api/auth/*・/api/account/mfa) を呼ぶ。
 * セッションは HttpOnly の Cookie にあり、画面からは読めない (lib/supabase/cookie-options.ts)。
 */
export async function authFetch(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      // GET 以外は JSON で送る (受け口は別のサイトからの要求を断るため application/json を求める)
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, data }
  } catch {
    return { status: 0, data: {} }
  }
}
