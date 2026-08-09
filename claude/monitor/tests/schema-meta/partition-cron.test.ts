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
  CORE_JOBS, evaluatePartitionHealth, PARTITION_JOBS, WATCHED_TABLES,
  type PartitionHealthFacts,
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

  it('migration 適用直後の状態を judge が ok と判定する', async () => {
    // 判定ロジック（単体テスト済み）と実際のカタログを突き合わせる。
    // 片方だけ直して食い違う、を防ぐ。
    const v = evaluatePartitionHealth(await facts())
    expect(v.severity, v.problems.join(' / ')).toBe('ok')
  })
})
