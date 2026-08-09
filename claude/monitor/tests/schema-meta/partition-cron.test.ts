/**
 * 月次パーティションと、その生成 cron が **migration だけで揃うか**。
 *
 * ── 何を守るのか ────────────────────────────────────────────────────────
 * pg_cron のジョブは DB を移行しても引き継がれない。だから「本番に手で作った
 * ジョブ」は資産ではなく、**建て直した瞬間に消える**。2026-08-01 に BCP の
 * 自動 PDF が沈黙したのがこれで、誰も気づかないまま数日経った。
 *
 * このテストは `supabase db reset` 直後の DB、つまり **migration だけから
 * 組み立てた状態**に対して走る。ここで登録されていないジョブは、DR で復旧した
 * 環境にも存在しない。実際 2026-08-09 に monitor_results_partition が
 * この形で欠けていた（コメントには「ある」と書かれていたが、それは当時の
 * 本番に手で作られていたという意味だった）。
 *
 * 残余そのものの日次監視は /api/cron/partition-health（本番向け）。
 * こちらは「仕組みが migration に載っているか」だけを見る。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import {
  CORE_JOBS, evaluatePartitionHealth, PARTITION_JOBS, REQUIRED_VAULT_SECRETS,
  WATCHED_TABLES, type PartitionHealthFacts,
} from '../../src/lib/ops/partition-health'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

afterAll(async () => { await pool.end() })

async function facts(): Promise<PartitionHealthFacts> {
  const { rows } = await pool.query('select public.partition_health() as h')
  return rows[0].h as PartitionHealthFacts
}

describe('パーティションと生成 cron', () => {
  it('partition_health() が呼べる', async () => {
    const h = await facts()
    expect(h.tables, 'partition_health() が表を返しません').toBeTruthy()
  })

  it('監視対象の表すべてにパーティションがある', async () => {
    const h = await facts()
    for (const t of WATCHED_TABLES) {
      expect(h.tables?.[t], `${t} のパーティションが 1 つもありません`).toBeTruthy()
    }
  })

  it('期待する cron ジョブがすべて migration だけで登録される', async () => {
    // ここが落ちたら「本番に手で作ったジョブ」に依存している。migration に書く。
    //
    // 2026-08-09 の時点では、本番で動いている 6 本のうち **4 本が
    // migrations_archive/（db reset の対象外）にしか無かった**。本番は動いて
    // いたので誰も困っていなかったが、DR で建て直すと J-Alert 受信すら
    // 復旧しない状態だった。DR Runbook の「手で再構築する」項目そのもの。
    const h = await facts()
    if (h.pg_cron !== true) {
      // pg_cron 無しの環境ではジョブを問えない。**黙って通さず**理由を出す。
      throw new Error('pg_cron が入っていません。supabase db reset で作り直してください。')
    }
    const expected = [...Object.values(PARTITION_JOBS), ...Object.keys(CORE_JOBS)]
    const missing = expected.filter((name) => h.jobs?.[name] !== true)
    expect(
      missing,
      'cron ジョブが migration から登録されていません。DB を建て直すと'
      + 'このジョブは存在せず、対応する機能が黙って止まります:\n' + missing.join('\n'),
    ).toEqual([])
  })

  it('migration 適用直後の状態を judge が ok と判定する（Vault を除く）', async () => {
    // 判定ロジック（単体テスト済み）と実際のカタログを突き合わせる。
    // 片方だけ直して食い違う、を防ぐ。
    //
    // **Vault だけは migration で用意できない**（値を書けない）。真っ新な DB の
    // Vault は空が正しく、それを「異常」と数えるとこのテストは永久に赤になる。
    // ここで見るのは「migration が用意できるもの」＝パーティションと cron。
    // Vault の欠落は本番向けの日次監視が受け持つ。
    const h = await facts()
    const v = evaluatePartitionHealth({
      ...h,
      vault: Object.fromEntries(Object.keys(REQUIRED_VAULT_SECRETS).map((n) => [n, true])),
    })
    expect(v.severity, v.problems.join(' / ')).toBe('ok')
  })

  it('Vault は migration で用意されない（＝DR の手作業として残ることの明示）', async () => {
    // 「いつの間にか migration で入るようになった」ら、この前提が変わったということ。
    // そのときはここが落ちて、DR Runbook を見直す合図になる。
    const h = await facts()
    const provided = Object.keys(REQUIRED_VAULT_SECRETS).filter((n) => h.vault?.[n] === true)
    expect(
      provided,
      'Vault が migration から供給されています。DR Runbook の手作業項目を見直してください:\n'
      + provided.join('\n'),
    ).toEqual([])
  })

  it('partition_health() が秘密の値を返さない', async () => {
    // 監視に必要なのは「在るか無いか」だけ。**値を返し始めたら即座に気づく**。
    // 返り値はアラートのメール本文やログに載るので、混入は実害になる。
    //
    // ⚠ 最初この検査は「値が真偽値か」と「本文に既知のパターンが無いか」だけを
    // 見ていたが、変異テストで素通りした。`array_agg(name || '=' || 値)` に
    // すると**値はキー側に入る**ため、どちらの条件にも引っかからない。
    // 実際に守るべきは「キーが秘密の名前の形をしていること」。
    const h = await facts()
    for (const [name, v] of Object.entries(h.vault ?? {})) {
      // 名前は識別子。区切り記号や長い文字列が現れたら値が混ざっている。
      expect(name, `vault のキーが名前の形をしていません（値の混入）: ${name}`)
        .toMatch(/^[a-z0-9_]{1,64}$/)
      expect(typeof v, `${name} が真偽値ではありません（値が漏れている可能性）`).toBe('boolean')
    }
    // ⚠ 上のループは **Vault が空だと 1 度も回らない**（新品の DB がまさにそれ）。
    // それだけでは「素通りして緑」になるので、カナリアを 1 本入れて実際に確かめる。
    const CANARY = 'canary_probe_secret'
    const VALUE  = 'CANARY-VALUE-MUST-NOT-APPEAR'
    await pool.query('select vault.create_secret($1, $2)', [VALUE, CANARY])
    try {
      const probed = await facts()
      expect(Object.keys(probed.vault ?? {}), 'カナリアが見えていません（検査が効いていない）')
        .toContain(CANARY)
      expect(JSON.stringify(probed), '秘密の値が返り値に含まれています')
        .not.toContain(VALUE)
      for (const name of Object.keys(probed.vault ?? {})) {
        expect(name, `vault のキーが名前の形をしていません（値の混入）: ${name}`)
          .toMatch(/^[a-z0-9_]{1,64}$/)
      }
    } finally {
      await pool.query('delete from vault.secrets where name = $1', [CANARY])
    }

    // 復号ビューを**参照していない**こと（定義本文の裏取り）。
    // 正規表現は実際の参照だけに当てる。`decrypted_secret` だけを見ると
    // 「足さないこと」と書いた注意書きにまで反応する（実際に踏んだ）。
    const { rows } = await pool.query(
      "select pg_get_functiondef(p.oid) as def from pg_proc p"
      + " join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname in ('vault_secret_names', 'partition_health')",
    )
    for (const r of rows as { def: string }[]) {
      expect(r.def, '復号ビュー vault.decrypted_secrets を参照しています')
        .not.toMatch(/vault\.decrypted_secrets/)
    }
  })
})
