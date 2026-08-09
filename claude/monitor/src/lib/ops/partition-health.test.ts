import { describe, expect, it } from 'vitest'
import {
  CORE_JOBS,
  evaluatePartitionHealth,
  PARTITION_JOBS,
  REQUIRED_VAULT_SECRETS,
  WATCHED_TABLES,
  type PartitionHealthFacts,
} from './partition-health'

/**
 * 「残り何ヶ月で鳴らすか」の判定。DB を触らずに、尽きかけ・尽きた・ジョブが
 * 消えた、といった状況を直接作れるのがこの分割の目的。
 *
 * 守りたいのは 2 つ:
 *   - 残余が減ったら鳴る（尽きてからでは遅い）
 *   - **残余があってもジョブが消えていたら鳴る**（数ヶ月後に必ず尽きるため。
 *     pg_cron のジョブは DB 移行で消える＝実際に起きる）
 */

/** 既定は「正常」。テストごとに壊したい所だけ上書きする。 */
function facts(over: Partial<PartitionHealthFacts> = {}): PartitionHealthFacts {
  return {
    pg_cron: true,
    tables: {
      live_sessions:   { last_partition: '202610', months_ahead: 2 },
      monitor_results: { last_partition: '202610', months_ahead: 2 },
    },
    // 期待するジョブが全部居る状態を既定にする（パーティション 2 + 中核 4）。
    jobs: Object.fromEntries(
      [...Object.values(PARTITION_JOBS), ...Object.keys(CORE_JOBS)].map((n) => [n, true]),
    ),
    // Vault も既定は「全部揃っている」。
    vault: Object.fromEntries(Object.keys(REQUIRED_VAULT_SECRETS).map((n) => [n, true])),
    ...over,
  }
}

describe('evaluatePartitionHealth', () => {
  it('2ヶ月先まであってジョブも生きていれば ok', () => {
    const v = evaluatePartitionHealth(facts())
    expect(v.severity).toBe('ok')
    expect(v.problems).toEqual([])
    expect(v.runway).toEqual({ live_sessions: 2, monitor_results: 2 })
  })

  it('先が多い分には ok（cron が余分に作っても騒がない）', () => {
    expect(evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202701', months_ahead: 5 },
        monitor_results: { last_partition: '202701', months_ahead: 5 },
      },
    })).severity).toBe('ok')
  })

  it('残り1ヶ月は warn（生成ジョブが1回失敗した形）', () => {
    // 旧実装ではこの分岐に到達できず、**warn を一度も出せなかった**
    // （2026-08-09、変異テストが検出）。境界そのものを固定する。
    const v = evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202609', months_ahead: 1 },
        monitor_results: { last_partition: '202610', months_ahead: 2 },
      },
    }))
    expect(v.severity).toBe('warn')
    expect(v.summary).toContain('警告')
    expect(v.problems).toHaveLength(1)
    expect(v.problems[0]).toContain('live_sessions: 残り 1 ヶ月（最終 202609）')
    expect(v.problems[0]).toContain('生成ジョブが失敗している可能性')
  })

  it('残り0ヶ月は critical（来月頭に書き込みが落ちる）', () => {
    const v = evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202608', months_ahead: 0 },
        monitor_results: { last_partition: '202608', months_ahead: 0 },
      },
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(2)
    expect(v.summary).toContain('異常')
    expect(v.problems[0]).toContain('来月頭に書き込みが失敗します')
  })

  it('既に尽きている（負の残余）でも critical', () => {
    expect(evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202607', months_ahead: -1 },
        monitor_results: { last_partition: '202610', months_ahead: 2 },
      },
    })).severity).toBe('critical')
  })

  it('warn と critical が混ざったら critical が勝つ（重い方を採る）', () => {
    const v = evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202609', months_ahead: 1 },   // warn
        monitor_results: { last_partition: '202608', months_ahead: 0 },   // critical
      },
    }))
    expect(v.severity).toBe('critical')
  })

  it('critical の後に warn が来ても格下げされない（順序に依存しない）', () => {
    const v = evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202608', months_ahead: 0 },   // critical が先
        monitor_results: { last_partition: '202609', months_ahead: 1 },   // warn が後
      },
    }))
    expect(v.severity).toBe('critical')
  })

  it('中核ジョブ（J-Alert 受信など）が消えていれば critical', () => {
    // 2026-08-01 の東京移行で BCP の自動 PDF が沈黙したのと同じ形。
    // パーティションと違い猶予が無く、止まった瞬間に機能が死ぬ。
    const v = evaluatePartitionHealth(facts({
      jobs: { live_sessions_partition: true, monitor_results_partition: true,
              bcp_report_sweep: true, monitor_sweep_edges: true,
              monitor_sweep_unattended_streams: true },   // jalert_poll だけ欠落
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems.join()).toContain('jalert_poll')
    expect(v.problems.join()).toContain('J-Alert 受信')
  })

  it('中核ジョブが全部消えていれば 4 件すべて指摘する', () => {
    const v = evaluatePartitionHealth(facts({
      jobs: { live_sessions_partition: true, monitor_results_partition: true },
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(Object.keys(CORE_JOBS).length)
  })

  it('残余があってもパーティション生成ジョブが消えていれば critical', () => {
    // **これが一番起きる形**。DB を建て直すと pg_cron のジョブは消えるので、
    // 「今は足りているから大丈夫」に見えたまま数ヶ月後に尽きる。
    // 2026-08-09 に monitor_results_partition が実際にこの状態だった。
    const v = evaluatePartitionHealth(facts({
      jobs: Object.fromEntries([
        ...Object.keys(CORE_JOBS).map((n) => [n, true]),
        ['live_sessions_partition', true],
      ]),
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems.join()).toContain('monitor_results_partition')
  })

  it('jobs のキーが丸ごと欠けていても critical（未定義を正常と読まない）', () => {
    const v = evaluatePartitionHealth(facts({ jobs: {} }))
    expect(v.severity).toBe('critical')
    // パーティション 2 + 中核 4
    expect(v.problems).toHaveLength(2 + Object.keys(CORE_JOBS).length)
  })

  it('pg_cron 拡張ごと無ければ critical', () => {
    const v = evaluatePartitionHealth(facts({ pg_cron: false, jobs: {} }))
    expect(v.severity).toBe('critical')
    expect(v.problems.join()).toContain('pg_cron')
    // 拡張が無いときはジョブの有無を重ねて責めない（原因は1つ）。
    expect(v.problems).toHaveLength(1)
  })

  it('表が1つも見つからなければ critical（空を正常と読まない）', () => {
    const v = evaluatePartitionHealth(facts({ tables: {} }))
    expect(v.severity).toBe('critical')
    // ジョブも Vault も全部居るので、指摘されるのは「表が無い」2 件だけ。
    expect(v.problems).toHaveLength(WATCHED_TABLES.length)
  })

  it('空の事実を渡しても ok にならない', () => {
    // RPC が壊れて {} を返した、という最悪ケース。
    expect(evaluatePartitionHealth({}).severity).toBe('critical')
  })

  it('Vault の秘密情報が 1 つ欠けても critical', () => {
    // cron が全部揃っていても、Vault が欠ければ呼び出しは静かに空振りする。
    // 2026-08-01 の BCP 沈黙はこの経路でも起こりえた。
    const { project_url: _drop, ...rest } = Object.fromEntries(
      Object.keys(REQUIRED_VAULT_SECRETS).map((n) => [n, true]),
    )
    const v = evaluatePartitionHealth(facts({ vault: rest }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(1)
    expect(v.problems[0]).toContain('project_url')
    expect(v.problems[0]).toContain('J-Alert 受信')
  })

  it('Vault が丸ごと空なら 4 件すべて指摘する', () => {
    const v = evaluatePartitionHealth(facts({ vault: {} }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(Object.keys(REQUIRED_VAULT_SECRETS).length)
  })

  it('vault のキー自体が無くても critical（未定義を正常と読まない）', () => {
    const v = evaluatePartitionHealth(facts({ vault: undefined }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(Object.keys(REQUIRED_VAULT_SECRETS).length)
  })

  it('余分な秘密情報が入っていても騒がない', () => {
    // 他用途の secret が同居していても、期待するものが揃っていれば ok。
    const v = evaluatePartitionHealth(facts({
      vault: {
        ...Object.fromEntries(Object.keys(REQUIRED_VAULT_SECRETS).map((n) => [n, true])),
        some_other_secret: true,
      },
    }))
    expect(v.severity).toBe('ok')
  })

  it('pg_cron が無い環境でも Vault は問う（独立に見る）', () => {
    const v = evaluatePartitionHealth(facts({ pg_cron: false, jobs: {}, vault: {} }))
    // pg_cron 1 件 + Vault 4 件。cron ジョブは拡張が無いので重ねて責めない。
    expect(v.problems).toHaveLength(1 + Object.keys(REQUIRED_VAULT_SECRETS).length)
  })

  it('監視対象すべてに生成ジョブ名が定義されている', () => {
    // 表を足したのにジョブ名を書き忘れると、その表のジョブ欠落を検出できない。
    for (const t of WATCHED_TABLES) expect(PARTITION_JOBS[t]).toBeTruthy()
  })

  it('中核ジョブと Vault には「止まると何が起きるか」が添えてある', () => {
    // アラートを受け取った人が、直すべきかを自分で判断できるように。
    for (const [name, purpose] of Object.entries(CORE_JOBS)) {
      expect(purpose, `${name} の説明が空です`).toBeTruthy()
    }
    for (const [name, purpose] of Object.entries(REQUIRED_VAULT_SECRETS)) {
      expect(purpose, `${name} の説明が空です`).toBeTruthy()
    }
  })

  it('Vault の期待リストに値が混ざっていない（名前だけを扱う）', () => {
    // 万一ここに実際の秘密が書かれたら、アラート本文やログに漏れる。
    for (const name of Object.keys(REQUIRED_VAULT_SECRETS)) {
      expect(name, `${name} が秘密の値に見えます`).toMatch(/^[a-z0-9_]{1,40}$/)
    }
  })
})
