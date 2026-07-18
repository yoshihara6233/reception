/**
 * 手荷物検査 6テーブルの RLS 契約テスト（T1）
 *
 * reception の CI にはライブ Postgres が無いため、migration SQL を解析して
 * RLS の不変条件を検証する「契約テスト」とする。狙いは本リポジトリで実際に
 * 起きた2件の障害クラスを実装時に機械的に捕捉すること:
 *   (1) RLS 付け忘れ（store_cameras で Supabase セキュリティアラート）
 *   (2) 店舗スコープ述語の取り違え（id = auth.uid() 等で全行不可視/全行可視）
 *
 * ライブDBでの挙動検証（越境で 0 行が返る等）は supabase をCIに載せた段階で
 * rls.authz.test.ts として追加する（本テストはその前段の静的ゲート）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const MIGRATION = readFileSync(
  join(__dirname, '../../supabase/migrations/20260718_001_baggage_inspection.sql'),
  'utf8',
)

/** 本 migration で新設し、RLS + 店舗スコープSELECT が必須のテーブル。 */
const SECURED_TABLES = [
  'store_employees',
  'inspection_sessions',
  'inspection_session_events',
  'inspection_clip_jobs',
  'inspection_clips',
  'edge_api_tokens',
] as const

describe('baggage inspection RLS contract', () => {
  test.each(SECURED_TABLES)('%s: CREATE TABLE が存在する', (table) => {
    expect(MIGRATION).toMatch(new RegExp(`CREATE TABLE ${table}\\b`))
  })

  test.each(SECURED_TABLES)('%s: RLS が有効化されている（付け忘れ防止）', (table) => {
    expect(MIGRATION).toMatch(
      new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
    )
  })

  test.each(SECURED_TABLES)('%s: 店舗スコープの SELECT ポリシーがある', (table) => {
    // FOR SELECT USING (can_access_baggage_store(tenant_id, store_id)) を要求
    const policy = new RegExp(
      `CREATE POLICY[^;]*ON ${table}\\s+FOR SELECT\\s+USING \\(can_access_baggage_store\\(tenant_id, store_id\\)\\)`,
    )
    expect(MIGRATION).toMatch(policy)
  })

  test.each(SECURED_TABLES)(
    '%s: セッションクライアント用の書き込みポリシーを作らない（書き込みは service role のみ）',
    (table) => {
      // 該当テーブルのポリシーを抽出し、FOR INSERT/UPDATE/DELETE/ALL が無いことを確認。
      const policyStmts = MIGRATION.match(
        new RegExp(`CREATE POLICY[^;]*ON ${table}[^;]*;`, 'g'),
      ) ?? []
      for (const stmt of policyStmts) {
        expect(stmt).toMatch(/FOR SELECT/)
        expect(stmt).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/)
      }
    },
  )
})

describe('店舗スコープ判定ヘルパ can_access_baggage_store', () => {
  const fn = MIGRATION.match(
    /CREATE OR REPLACE FUNCTION can_access_baggage_store[\s\S]*?\$\$ LANGUAGE sql/,
  )?.[0]

  test('ヘルパ関数が定義されている', () => {
    expect(fn).toBeTruthy()
  })

  test('テナント一致と担当店舗（store_ids）で判定する', () => {
    expect(fn).toMatch(/get_tenant_id\(\)/)
    expect(fn).toMatch(/get_admin_store_ids\(\)/)
    expect(fn).toMatch(/get_admin_role\(\)/)
  })

  test('anti-pattern: auth.uid() をテーブルの id と直接比較していない（実障害の再発防止）', () => {
    // reception 既存ヘルパ経由でのみ auth を参照する。生の auth.uid() 比較は禁止。
    expect(MIGRATION).not.toMatch(/id\s*=\s*auth\.uid\(\)/)
    expect(MIGRATION).not.toMatch(/auth\.uid\(\)\s*=\s*id\b/)
  })
})

describe('ストレージバケットは非公開', () => {
  test.each(['baggage-clips', 'baggage-photos'])('%s: public=false で作成', (bucket) => {
    // INSERT ... VALUES ( 'bucket', 'bucket', false, ... )
    const stmt = MIGRATION.match(
      new RegExp(`VALUES \\(\\s*'${bucket}',\\s*'${bucket}',\\s*(true|false)`),
    )
    expect(stmt).toBeTruthy()
    expect(stmt![1]).toBe('false')
  })
})
