/**
 * 遠隔視聴のセッションの持ち主確認（/api/video/sessions/[id] と配下の HLS 配信）。
 *
 * 見られるのは**セッションを開いた本人だけ**。カメラを見る権限の判定は開始のとき
 * （POST /api/video/sessions）に RLS で済ませてあり、ここはその結果の持ち回り。
 *
 * 判定は video_sessions の SELECT を**セッションクライアント（RLS 配下）**で引き、
 * user_id が本人かを見る。super_admin は RLS で他人の行も見えるが、他人の視聴に
 * 相乗りさせる理由は無いので本人に限る。
 *
 * HLS は区切りごとに 1〜4 秒おきに来るので、エッジ映像のガード（view-access.ts）と
 * 同じくトークン単位で判定を 30 秒持ち回る（理由と代償は lib/auth/token-cache.ts）。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { createTokenCache, hashToken, jwtExpiresAtMs } from '@/lib/auth/token-cache'
import type { VideoKind } from '@/lib/video/session-logic'

interface Entry {
  userId: string | null
  kind: VideoKind | null
}

const cache = createTokenCache<Entry>()

export function resetVideoAccessCache(): void {
  cache.reset()
}

export type VideoSessionAccess =
  | { ok: true; userId: string; kind: VideoKind }
  | { ok: false; status: 401 | 404 }

function toAccess(e: Entry): VideoSessionAccess {
  if (!e.userId) return { ok: false, status: 401 }
  return e.kind ? { ok: true, userId: e.userId, kind: e.kind } : { ok: false, status: 404 }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 未ログインは 401。自分のセッションでなければ 404（他人のセッションの有無を教えない）。 */
export async function requireVideoSessionAccess(sessionId: string): Promise<VideoSessionAccess> {
  if (!UUID_RE.test(sessionId)) return { ok: false, status: 404 }
  const supa = await createSupabaseServer()

  // session.user には触らない（未検証）。キャッシュのキーにするトークンだけを読む
  const { data: { session } } = await supa.auth.getSession()
  const token = session?.access_token ?? null
  const tokenHash = token ? await hashToken(token) : null
  const scope = `video:${sessionId}`
  if (tokenHash) {
    const hit = cache.read(tokenHash, scope)
    if (hit) return toAccess(hit.value)
  }

  const { data: { user } } = await supa.auth.getUser()
  if (!user) {
    if (tokenHash && token) cache.write(tokenHash, scope, { userId: null, kind: null }, jwtExpiresAtMs(token))
    return { ok: false, status: 401 }
  }

  const { data, error } = await supa
    .from('video_sessions')
    .select('user_id, kind')
    .eq('id', sessionId)
    .maybeSingle()
  // DB の失敗は覚え込ませない（瞬断で本人を 30 秒締め出さない）
  if (error) return { ok: false, status: 404 }
  const row = data as { user_id: string; kind: VideoKind } | null
  const entry: Entry = { userId: user.id, kind: row && row.user_id === user.id ? row.kind : null }
  if (tokenHash && token) cache.write(tokenHash, scope, entry, jwtExpiresAtMs(token))
  return toAccess(entry)
}
