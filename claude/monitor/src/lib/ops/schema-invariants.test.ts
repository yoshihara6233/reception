import { describe, expect, it } from 'vitest'
import {
  EMBED_PAIRS,
  NO_POLICY_OK,
  PARTITION_RE,
  embedPairsForSql,
  evaluateSchemaInvariants,
  type SchemaInvariantFacts,
} from './schema-invariants'

/**
 * 本番スキーマの判定ロジック。**事実は DB、判断はここ**（partition-health と同形）。
 *
 * 純粋関数なので「RLS が落ちた」「外部キーが消えた」といった状況を
 * テストで直接作れる。本番でそれを再現するわけにはいかないので、
 * **監視が異常時に本当に鳴るか**を確かめられる唯一の場所。
 */

const OK: SchemaInvariantFacts = {
  checked_at: '2026-08-10T04:00:00Z',
  rls_disabled: [],
  no_policy: [],
  secdef_bad_search_path: [],
  missing_fk: [],
  partitioned_embed: [],
  unknown_embed_tables: [],
}

describe('evaluateSchemaInvariants', () => {
  it('指摘ゼロなら ok', () => {
    const v = evaluateSchemaInvariants(OK)
    expect(v.severity).toBe('ok')
    expect(v.problems).toEqual([])
  })

  it('★結果が空なら critical（監視が死んでいるのに緑にしない）', () => {
    // checked_at が無い＝関数の想定と実際がずれている。
    // 「事実が取れない」を「異常なし」と読み違えるのが一番まずい。
    for (const empty of [{}, { rls_disabled: [] }]) {
      const v = evaluateSchemaInvariants(empty as SchemaInvariantFacts)
      expect(v.severity).toBe('critical')
      expect(v.problems[0]).toContain('schema_invariants()')
    }
  })

  it('RLS 無効は critical', () => {
    const v = evaluateSchemaInvariants({ ...OK, rls_disabled: ['secrets_table'] })
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('anon キー')
  })

  it('★台帳に載っているテーブルのポリシー 0 本は指摘しない', () => {
    const v = evaluateSchemaInvariants({ ...OK, no_policy: Object.keys(NO_POLICY_OK) })
    expect(v.problems, '台帳が効いていません（毎日誤報が出ます）').toEqual([])
  })

  it('★パーティションの子のポリシー 0 本も指摘しない', () => {
    const children = ['live_sessions_202608', 'monitor_results_202610']
    for (const c of children) expect(PARTITION_RE.test(c), c).toBe(true)
    expect(evaluateSchemaInvariants({ ...OK, no_policy: children }).problems).toEqual([])
  })

  it('台帳にも無く子でもないテーブルのポリシー 0 本は critical', () => {
    const v = evaluateSchemaInvariants({ ...OK, no_policy: ['brand_new_table'] })
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('brand_new_table')
  })

  it('SECURITY DEFINER の search_path 不正は critical', () => {
    // 未固定の SECURITY DEFINER は**リストアを失敗させた実績がある**。
    const v = evaluateSchemaInvariants({ ...OK, secdef_bad_search_path: ['foo(uuid)'] })
    expect(v.severity).toBe('critical')
  })

  it('★外部キー欠落は critical で、どのファイルが困るかを添える', () => {
    // 400 が握り潰されて「0 件」になる形。受け取った人がその場で動けるように、
    // 代表ファイルを 1 件添える（同じ組を使う箇所は複数あるが、1 件辿れば十分）。
    const v = evaluateSchemaInvariants({ ...OK, missing_fk: ['security_settings→stores'] })
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('security-patrol')
  })

  it('パーティション表の埋め込みは critical', () => {
    const v = evaluateSchemaInvariants({ ...OK, partitioned_embed: ['live_sessions→stores'] })
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('素の SQL')
  })

  it('★台帳が古い（表が実在しない）のは warn — 監視の網が縮む合図', () => {
    // 今この瞬間は壊れていないが、その組は検査対象から静かに外れている。
    const v = evaluateSchemaInvariants({ ...OK, unknown_embed_tables: ['old_table'] })
    expect(v.severity).toBe('warn')
    expect(v.problems[0]).toContain('EMBED_PAIRS')
  })

  it('critical と warn が混ざれば critical', () => {
    const v = evaluateSchemaInvariants({
      ...OK, rls_disabled: ['a'], unknown_embed_tables: ['b'],
    })
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(2)
  })

  it('summary には最初の指摘が入る（メールの件名になる）', () => {
    const v = evaluateSchemaInvariants({ ...OK, rls_disabled: ['secrets_table'] })
    expect(v.summary).toContain('secrets_table')
  })
})

describe('EMBED_PAIRS（台帳）', () => {
  it('★組が重複していない（1 組 1 行）', () => {
    // 台帳は embed-scan.ts の機械抽出と 1 対 1。重複があれば
    // 抽出か手編集のどちらかが壊れている。
    const keys = EMBED_PAIRS.map((p) => `${p.from}→${p.to}`)
    expect(new Set(keys).size, '同じ組が 2 行あります').toBe(keys.length)
    expect(embedPairsForSql()).toHaveLength(EMBED_PAIRS.length)
  })

  it('十分な数の組を見ている（`!inner` だけ見て 5 組に戻っていない）', () => {
    // 最初の実装は表記だけを目で拾って 5 組としており、実際の 4 分の 1 だった。
    expect(EMBED_PAIRS.length, '台帳が縮んでいます').toBeGreaterThanOrEqual(20)
  })

  it('台帳の各行にファイルが書かれている（どこを直すか分かる）', () => {
    for (const p of EMBED_PAIRS) {
      // src 相対。`../supabase/functions/...` は Edge Function 側
      // （src だけ見ていて丸ごと外れていた範囲）。
      expect(p.file, JSON.stringify(p)).toMatch(/^(app|lib|components|\.\.\/supabase)\//)
      expect(p.from).toMatch(/^[a-z_]+$/)
      expect(p.to).toMatch(/^[a-z_]+$/)
    }
  })

  it('★Edge Function 側の埋め込みも入っている', () => {
    // supabase/functions/ を走査対象から外していたため、J-Alert ポーラーの
    // `bcp_settings → stores` が検査から丸ごと漏れていた。
    expect(EMBED_PAIRS.some((p) => p.file.includes('supabase/functions')),
      'Edge Function 側が台帳にありません').toBe(true)
  })

  it('台帳の理由（NO_POLICY_OK）が空文字でない', () => {
    // 「とりあえず通す」ために足された行を残さないための最低限。
    for (const [t, why] of Object.entries(NO_POLICY_OK)) {
      expect(why.length, `${t} の理由が短すぎます`).toBeGreaterThan(20)
    }
  })
})
