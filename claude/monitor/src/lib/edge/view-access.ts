/**
 * ライブ画像ルート（grid / snapshot）の可視性ガード。
 *
 * ⚠ これらのルートは R2/Worker の署名URL、あるいは service_role で Supabase Storage を
 * 読む。つまり **DB の RLS を一切踏まない経路**なので、「ログイン済みか」だけを見ていると
 * エッジUUIDを知っている別テナントの利用者にそのまま映像が渡る。実際 2026-08-06 まで
 * `getUser()` のみで、店舗可視性を見ていなかった。
 *
 * 判定は `edge_devices` の SELECT を **セッションクライアント（RLS 配下）**で1行引けるかに
 * 委ねる。`edges_select` ポリシーが super_admin / tenant_admin / store_ids の3経路を
 * すでに表現しているので、認可ロジックをコード側に二重実装しない（片方だけ直る事故を防ぐ）。
 * そのポリシーの可視範囲は `tests/authz/rls.authz.test.ts`（"edge_devices RLS" describe）が
 * 実DBで固定している＝**このルートの認可はそこで担保されている**。ポリシーを緩めると
 * 映像の可視範囲も一緒に緩むので、変更時は必ず両方を見ること。
 *
 * トークン単位のキャッシュで毎フレームの実検証を省く理由と代償は
 * `src/lib/auth/token-cache.ts` の冒頭に集約してある。
 *
 * なお snapshot ルートの `cameraId` に個別チェックは要らない。ストレージキーが
 * `edges/<edgeId>/cam/<cameraId>/snapshot.jpg` とエッジ配下に閉じており、他エッジの
 * カメラIDを差し込んでも存在しないキーになるため（＝エッジの可視性が上位ゲート）。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { createTokenCache, hashToken, jwtExpiresAtMs } from '@/lib/auth/token-cache'

/**
 * ゲートの判定結果。
 * - `userId` 非null = トークンは実検証済み。`ok` がそのエッジの可視性。
 * - `userId` null   = トークンが無効だった（401）。連打を吸収するため覚える。
 */
export interface GateEntry {
  userId: string | null
  ok: boolean
}

const gateCache = createTokenCache<GateEntry>()

/** テスト用／権限変更を即時反映させたいときに。 */
export function resetViewAccessCache(): void {
  gateCache.reset()
}

/** RLS 配下で `edge_devices` を1行引くのに必要な最小の型（テストで差し替えるため）。 */
export interface EdgeVisibilityClient {
  from(table: 'edge_devices'): {
    select(cols: 'id'): {
      eq(col: 'id', value: string): {
        maybeSingle(): Promise<{ data: { id: string } | null; error: unknown }>
      }
    }
  }
}

export type EdgeVisibility = 'visible' | 'hidden' | 'error'

/**
 * RLS 配下の1行引きで可視性を判定する。
 *
 * - 行あり → visible
 * - 0行（他テナント / 存在しないエッジ） → hidden
 * - エラー（UUID として不正・DB障害） → error
 *
 * error を hidden と区別するのは**キャッシュしないため**。DB の瞬断で false を掴むと、
 * 正当な利用者が TTL のあいだ 403 を食い続ける。判定は同じ「見せない」でよいが、
 * 覚え込ませはしない。
 */
export async function resolveEdgeVisibility(
  supa: EdgeVisibilityClient,
  edgeId: string,
): Promise<EdgeVisibility> {
  try {
    const { data, error } = await supa.from('edge_devices').select('id').eq('id', edgeId).maybeSingle()
    if (error) return 'error'
    return data ? 'visible' : 'hidden'
  } catch {
    return 'error'
  }
}

export type EdgeViewAccess =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 }

export function toAccess(entry: GateEntry): EdgeViewAccess {
  if (!entry.userId) return { ok: false, status: 401 }
  return entry.ok ? { ok: true, userId: entry.userId } : { ok: false, status: 403 }
}

/**
 * ライブ画像ルートの入口ガード。未ログインは 401、可視外は 403。
 * 判定不能（DB障害等）もフェイルクローズで 403 にする — 監視映像は「見えて止まる」側に倒す。
 */
export async function requireEdgeViewAccess(edgeId: string): Promise<EdgeViewAccess> {
  const supa = await createSupabaseServer()

  // ★ `session.user` には**触らない**（未検証の値なので信用できない）。ここで欲しいのは
  //   キャッシュキーにする access_token だけで、これは cookie を読むだけ＝往復ゼロ。
  //   期限切れが近ければ getSession 内で自動更新が走る。その場合は新しいトークンが返り、
  //   キー変更＝未命中になるので、下で必ず実検証される。
  const { data: { session } } = await supa.auth.getSession()
  const token = session?.access_token ?? null
  const tokenHash = token ? await hashToken(token) : null

  if (tokenHash) {
    const hit = gateCache.read(tokenHash, edgeId)
    if (hit) return toAccess(hit.value)
  }

  // ここから先が実検証。キャッシュ未命中のときだけ Auth と DB を叩く。
  const { data: { user } } = await supa.auth.getUser()
  if (!user) {
    // 失効・改竄トークンでのポーリングが毎秒 Auth を叩くのを止める。
    // 再ログインすればトークンが変わる＝別キーなので、締め出しにはならない。
    if (tokenHash && token) {
      gateCache.write(tokenHash, edgeId, { userId: null, ok: false }, jwtExpiresAtMs(token))
    }
    return { ok: false, status: 401 }
  }

  const visibility = await resolveEdgeVisibility(supa as unknown as EdgeVisibilityClient, edgeId)
  if (visibility === 'error') return { ok: false, status: 403 }

  const entry: GateEntry = { userId: user.id, ok: visibility === 'visible' }
  if (tokenHash && token) gateCache.write(tokenHash, edgeId, entry, jwtExpiresAtMs(token))
  return toAccess(entry)
}
