/**
 * Admin-only request guard. Returns the authenticated user when the caller
 * has a role that allows mutating master data; otherwise returns null
 * so the route can respond 401/403.
 */
import { createSupabaseServer } from '@/lib/supabase/server'

const ADMIN_ROLES = ['super_admin', 'tenant_admin', 'store_manager'] as const

// 手荷物検査モジュールに触れられるロール。baggage_manager（手荷物検査店長）は
// これに含めるが ADMIN_ROLES には含めない — 他の管理機能（ライブ視聴・ユーザ管理等）
// には入れないため（アクセス境界は middleware でも二重に強制する）。
export const BAGGAGE_ROLES = ['super_admin', 'tenant_admin', 'store_manager', 'baggage_manager'] as const

type AdminProfile = { id: string; role: string; tenant_id: string; store_ids: string[] }

/**
 * ⚠ **失敗分岐に `supa` を載せないこと。**
 *
 * このガードは例外を投げず `{ ok: false, ... }` を**返す**ので、呼ぶだけでは
 * 何も止まらない。加えて以前は `supa`（DB クライアント）を成功・失敗の
 * **両方の分岐**に載せていた。その結果、次のコードが **TypeScript の型検査を
 * 通っていた** — 認可を一切していないにもかかわらず:
 *
 *   const { supa } = await requireAdmin()   // ok を見ずに DB クライアントが手に入る
 *
 * ルート棚卸し（`api-guard-inventory.test.ts`）は正規表現でソースを見るため、
 * こう書かれていても「requireAdmin を呼んでいる = admin で守られている」と
 * 分類する。2026-08-14 の検査時点では 35 ルートすべてが `!ok` で早期 return して
 * いて実害は無かったが、**現状そうなっているだけで構造的には防がれていなかった**。
 *
 * 失敗分岐から外すと、`ok` で絞り込むまで `supa` に触れなくなる（型エラーになる）。
 * 判定を書き忘れた瞬間にコンパイルが落ちる、という形にしてある。
 */
async function requireRole(allowed: readonly string[]) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'unauthorized' }

  const { data: profile } = await supa
    .from('admin_users')
    .select('id, role, tenant_id, store_ids')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile || !allowed.includes(profile.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' }
  }

  return { ok: true as const, user, profile: profile as AdminProfile, supa }
}

export function requireAdmin() {
  return requireRole(ADMIN_ROLES)
}

/** 手荷物検査系の認可（baggage_manager を含む）。global admin 権限は与えない。 */
export function requireBaggageRole() {
  return requireRole(BAGGAGE_ROLES)
}

/**
 * 運営管理プレーン（②）＝SaaS運営者のみ。テナント／エッジ／NVR機種／視聴上限など、
 * 個別テナントに属さない運営レベルの操作に使う。tenant_admin 以下は 403。
 */
export function requireSuperAdmin() {
  return requireRole(['super_admin'])
}
