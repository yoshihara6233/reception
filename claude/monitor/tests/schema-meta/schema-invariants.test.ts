import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import {
  embedPairsForSql,
  evaluateSchemaInvariants,
  type SchemaInvariantFacts,
} from '../../src/lib/ops/schema-invariants'

/**
 * `schema_invariants()` ——**日次で本番に問う**のと同じ検査を、CI では
 * migration を当てた直後の DB に対して走らせる。
 *
 * ── 二重に見えるが、見ている物が違う ──────────────────────────────────
 * rls-meta.test.ts / embed-inventory.test.ts は**個別の条件を細かく**見る。
 * こちらは「本番に毎日投げる関数が、正しい形の答えを返すか」を見る。
 *
 * つまりここが守るのは**監視そのもの**。関数が壊れて空を返すようになると、
 * 本番の異常は永久に検出されなくなる——2026-08-10 に見つけた
 * 「壊れているのに正常と区別が付かない」形そのものなので、
 * 監視の側にも同じ疑いをかける。
 */

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
afterAll(async () => { await pool.end() })

async function invariants(embeds = embedPairsForSql()): Promise<SchemaInvariantFacts> {
  const { rows } = await pool.query('select public.schema_invariants($1::jsonb) as f',
    [JSON.stringify(embeds)])
  return (rows[0] as { f: SchemaInvariantFacts }).f
}

describe('schema_invariants()', () => {
  it('★migration を当てた DB では指摘ゼロ', async () => {
    const verdict = evaluateSchemaInvariants(await invariants())
    expect(verdict.problems, verdict.problems.join('\n')).toEqual([])
    expect(verdict.severity).toBe('ok')
  })

  it('台帳の表がすべて実在する（台帳のほうが古くなっていない）', async () => {
    // 表の名前を変えたのに台帳を直し忘れると、**検査対象から静かに外れる**。
    expect((await invariants()).unknown_embed_tables ?? []).toEqual([])
  })

  it('外部キーが無い組を渡せば検出する（検査が生きていることの確認）', async () => {
    // live_sessions → stores は 2026-08-10 に実際に欠けていた組。
    // 今は埋め込みを使っていないが、**検出できること**はここで固定する。
    const facts = await invariants([{ from: 'live_sessions', to: 'stores' }])
    expect(facts.missing_fk).toEqual(['live_sessions→stores'])
    expect(facts.partitioned_embed, 'パーティション表だと分かっていません')
      .toEqual(['live_sessions→stores'])
    expect(evaluateSchemaInvariants(facts).severity).toBe('critical')
  })

  it('存在しない表は unknown として返す（黙って正常にしない）', async () => {
    const facts = await invariants([{ from: 'no_such_table', to: 'stores' }])
    expect(facts.unknown_embed_tables).toEqual(['no_such_table'])
    expect(facts.missing_fk, '実在しない表を「外部キー欠落」と混ぜていません').toEqual([])
  })

  it('パーティションの子と台帳のテーブルは「ポリシー無し」の指摘に出さない', async () => {
    // 事実としては返るが、判断側が台帳と正規表現で落とす。
    //
    // ⚠ 月を直書きしない。生成 migration は「実行時点の now() 起点」で作るので、
    //   固定月（旧: live_sessions_202608）は月が進むと DB reset で生成されなくなり、
    //   このテストが 9/1 に時限で落ちた。正規表現で「どれか 1 つ以上」を見る。
    const facts = await invariants()
    const partitionChildren = (facts.no_policy ?? []).filter((t) => /^live_sessions_\d{6}$/.test(t))
    expect(partitionChildren.length, 'パーティションの子が事実に出ていません').toBeGreaterThan(0)
    expect(facts.no_policy, '台帳のテーブルが事実に出ていません')
      .toEqual(expect.arrayContaining(['rate_limits']))
    expect(evaluateSchemaInvariants(facts).problems).toEqual([])
  })

  it('service_role 以外は実行できない', async () => {
    // 中身はスキーマの構造そのもの。攻撃者に地図を渡さない。
    const { rows } = await pool.query(
      `select coalesce(has_function_privilege('anon', p.oid, 'execute'), false) as anon,
              coalesce(has_function_privilege('authenticated', p.oid, 'execute'), false) as auth
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = 'schema_invariants'`)
    expect(rows[0]).toEqual({ anon: false, auth: false })
  })
})
