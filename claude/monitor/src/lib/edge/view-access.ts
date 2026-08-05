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
 * 毎フレーム DB を引かないよう (userId, edgeId) の判定を短時間メモ化する。grid は約2秒、
 * snapshot は約1秒ごとにポーリングされるため、TTL 30秒で追加クエリは 1/30〜1/15 に収まる。
 * 代償は「権限を外された利用者が最大 TTL の間だけ見え続ける」こと。ライブ映像の可視性
 * としては許容し、TTL を延ばさない。
 *
 * なお snapshot ルートの `cameraId` に個別チェックは要らない。ストレージキーが
 * `edges/<edgeId>/cam/<cameraId>/snapshot.jpg` とエッジ配下に閉じており、他エッジの
 * カメラIDを差し込んでも存在しないキーになるため（＝エッジの可視性が上位ゲート）。
 */
import { createSupabaseServer } from '@/lib/supabase/server'

/** 認可判定を持ち回す時間。延ばすほど権限剥奪の反映が遅れる。 */
export const VIEW_ACCESS_TTL_MS = 30_000
/** ウォームインスタンスで無制限に伸びないための上限（超えたら丸ごと捨てる）。 */
const MAX_ENTRIES = 5_000

type Entry = { ok: boolean; at: number }
const memo = new Map<string, Entry>()

export function viewAccessKey(userId: string, edgeId: string): string {
  // 改行はどちらのIDにも現れないので連結の曖昧さが出ない。
  return `${userId}\n${edgeId}`
}

/** キャッシュ命中なら判定、未命中/期限切れなら undefined。 */
export function readViewAccess(
  userId: string,
  edgeId: string,
  now: number = Date.now(),
): boolean | undefined {
  const key = viewAccessKey(userId, edgeId)
  const hit = memo.get(key)
  if (!hit) return undefined
  if (now - hit.at >= VIEW_ACCESS_TTL_MS) {
    memo.delete(key)
    return undefined
  }
  return hit.ok
}

export function writeViewAccess(
  userId: string,
  edgeId: string,
  ok: boolean,
  now: number = Date.now(),
): void {
  if (memo.size >= MAX_ENTRIES) memo.clear()
  memo.set(viewAccessKey(userId, edgeId), { ok, at: now })
}

/** テスト用／権限変更を即時反映させたいときに。 */
export function resetViewAccessCache(): void {
  memo.clear()
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

/**
 * ライブ画像ルートの入口ガード。未ログインは 401、可視外は 403。
 * 判定不能（DB障害等）もフェイルクローズで 403 にする — 監視映像は「見えて止まる」側に倒す。
 */
export async function requireEdgeViewAccess(edgeId: string): Promise<EdgeViewAccess> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const cached = readViewAccess(user.id, edgeId)
  if (cached !== undefined) {
    return cached ? { ok: true, userId: user.id } : { ok: false, status: 403 }
  }

  const visibility = await resolveEdgeVisibility(supa as unknown as EdgeVisibilityClient, edgeId)
  if (visibility === 'error') return { ok: false, status: 403 }

  const ok = visibility === 'visible'
  writeViewAccess(user.id, edgeId, ok)
  return ok ? { ok: true, userId: user.id } : { ok: false, status: 403 }
}
