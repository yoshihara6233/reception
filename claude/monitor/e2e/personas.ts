/**
 * E2E のペルソナ定義。**supabase/seed.example.sql と 1 対 1 で対応する。**
 *
 * 権限まわりのバグは「ロールごとに何が見えるか」がずれて起きる。RLS は
 * tests/authz/（63 テスト）、スコープ解決は src/lib/tenant/（29 ケース）が
 * 守っているが、**画面の層は誰も守っていなかった**。メニューの出し分け、
 * 直 URL への到達、middleware のリダイレクトは、ブラウザで実際に動かさないと
 * 分からない。ここがその層。
 *
 * ロールを増やすときに触る箇所は 4 つ:
 *   ① アプリの型 ② DB の CHECK 制約 ③ RLS ポリシー ④ テストのペルソナ
 * 2026-08-09 に baggage_manager が ② だけ欠けていて本番で作成不能だった。
 * ここ（④）にも必ず足すこと。
 */

export type RoleKey =
  | 'super' | 'adminA' | 'adminB' | 'storeA1' | 'viewerA1' | 'baggageA2'

export interface Persona {
  key: RoleKey
  email: string
  /** admin_users.role */
  role: string
  /** 人が読むためのラベル（テスト名に出る） */
  label: string
  /** ログイン直後に到達するパス。baggage_manager だけ middleware で /baggage へ飛ぶ */
  landing: string
}

/** seed.example.sql は全員このパスワード。ローカル固定の使い捨て。 */
export const PASSWORD = 'LocalDev!2026'

export const PERSONAS: Record<RoleKey, Persona> = {
  super: {
    key: 'super', email: 'super@local.dev', role: 'super_admin',
    label: 'システム管理者', landing: '/stores',
  },
  adminA: {
    key: 'adminA', email: 'admin-a@local.dev', role: 'tenant_admin',
    label: 'テナントA 管理者', landing: '/stores',
  },
  adminB: {
    key: 'adminB', email: 'admin-b@local.dev', role: 'tenant_admin',
    label: 'テナントB 管理者', landing: '/stores',
  },
  storeA1: {
    key: 'storeA1', email: 'store-a1@local.dev', role: 'store_manager',
    label: 'A1 店長', landing: '/stores',
  },
  viewerA1: {
    key: 'viewerA1', email: 'viewer-a1@local.dev', role: 'viewer',
    label: 'A1 閲覧者', landing: '/stores',
  },
  baggageA2: {
    key: 'baggageA2', email: 'baggage-a2@local.dev', role: 'baggage_manager',
    label: 'A2 検査店長', landing: '/baggage',
  },
}

export const ALL_PERSONAS = Object.values(PERSONAS)

/** seed.example.sql の店舗名。テナント跨ぎの漏れはこの文字列の有無で見る。 */
export const STORE_A1 = 'A1 店舗（ローカル）'
export const STORE_A2 = 'A2 店舗（ローカル）'
export const STORE_B1 = 'B1 店舗（ローカル）'

/** 保存済みログイン状態の置き場（.gitignore 済み）。 */
export function storageStatePath(key: RoleKey): string {
  return `e2e/.auth/${key}.json`
}
