import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 無認証で叩ける受け口のためのレート制限。
 *
 * Vercel の関数はインスタンスを跨ぐのでプロセス内カウンタは効かない。
 * 判定は DB 側の `rate_limit_hit`（1 文の UPSERT・競合でもすり抜けない）に任せる。
 *
 * **フェイルオープンにしてある。** DB が落ちているときにパスワード再設定まで
 * 巻き添えで止めるのは割に合わない（レート制限は嫌がらせ対策であって
 * 認証境界ではない）。認可の判定でこの方針を真似しないこと。
 */
export async function rateLimitAllows(
  svc: SupabaseClient,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await svc.rpc('rate_limit_hit', {
    p_key:    key,
    p_limit:  limit,
    p_window: `${windowSeconds} seconds`,
  })
  if (error) {
    console.warn('[rate-limit] check failed, allowing:', error.message)
    return true
  }
  return data !== false
}

/**
 * リクエスト元 IP。Vercel は x-forwarded-for の先頭に実クライアントを置く。
 * 取れないときは null（＝IP 単位の制限を掛けない。メール単位の制限は残る）。
 */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first && first.length > 0 ? first : (req.headers.get('x-real-ip') ?? null)
}
