import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 「super_admin を 0 人にしない」下限ガード。
 *
 * super_admin が 1 人もいなくなると、②運営管理プレーン（テナント作成・エッジ登録・
 * 視聴上限・運営アクセスログ）へ誰も到達できなくなる。RLS もアプリのガードも
 * `requireSuperAdmin()` を通さないため、**復旧は DB を直接触るしかない**。
 * そこまで行かせないための最後の砦。
 *
 * 既存の自己削除禁止（DELETE ハンドラ）だけでは足りない理由:
 *   - ロール変更（PUT）で自分自身を降格すれば 0 人にできてしまう。
 *   - 一部の admin_users 行は auth_user_id が NULL のまま（[[monitor-admin-authz-model]]
 *     の「既知の未処理データ」）。auth_user_id 比較の自己判定はそこをすり抜ける。
 *
 * RLS を迂回する service client で数えること。セッション client では
 * 他テナント／自分以外の super_admin が見えず、実数を数え損なう。
 */

/** 現在の super_admin 人数（service client 前提）。 */
export async function countSuperAdmins(svc: SupabaseClient): Promise<number> {
  const { count, error } = await svc
    .from('admin_users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'super_admin')
  if (error) throw new Error(`super_admin count failed: ${error.message}`)
  return count ?? 0
}

export type FloorVerdict =
  | { ok: true }
  | { ok: false; error: 'last_super_admin'; message: string }

/**
 * 対象ユーザーを「super_admin でなくする」操作（削除・降格）が許されるか。
 *
 * @param targetRole  対象の現在のロール
 * @param nextRole    操作後のロール。削除なら null を渡す
 */
export async function checkSuperAdminFloor(
  svc: SupabaseClient,
  targetRole: string,
  nextRole: string | null,
): Promise<FloorVerdict> {
  // super_admin 以外は関係ない。super_admin のままなら人数も変わらない。
  if (targetRole !== 'super_admin') return { ok: true }
  if (nextRole === 'super_admin') return { ok: true }

  if ((await countSuperAdmins(svc)) <= 1) {
    return {
      ok: false,
      error: 'last_super_admin',
      message:
        'システム管理者（super_admin）が 0 人になるため実行できません。'
        + '先に別のユーザーをシステム管理者にしてから、この操作をやり直してください。',
    }
  }
  return { ok: true }
}
