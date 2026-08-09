/**
 * 月次パーティションの残余判定。
 *
 * 事実の取り出しは DB の `partition_health()`、**判断はここ**。しきい値を
 * 変えるのに migration を要らなくするための分割。純粋関数なので、
 * 「あと1ヶ月」「ジョブが消えた」といった状況をテストで直接作れる。
 *
 * ── なぜ見張るのか ──────────────────────────────────────────────────────
 * パーティションが尽きた月に入った瞬間、その表への INSERT は必ず失敗する
 * （`no partition of relation ... found for row`）。live_sessions はライブ
 * 視聴の開始時に必ず INSERT されるので、**月初に全店で視聴が止まる**。
 * 生成は cron が自動でやっているが、**cron が止まったことは誰も教えてくれない**
 * （pg_cron のジョブは DB 移行で引き継がれず、2026-08-01 に BCP の自動 PDF が
 * 実際に沈黙した）。だから残余そのものを毎日見る。
 */

/** `partition_health()` が返す形。 */
export interface PartitionHealthFacts {
  checked_at?: string
  pg_cron?: boolean
  tables?: Record<string, { last_partition?: string; months_ahead?: number }>
  jobs?: Record<string, boolean>
}

export type Severity = 'ok' | 'warn' | 'critical'

export interface PartitionVerdict {
  severity: Severity
  /** 人が読む1行（メール件名・Slack に出す）。 */
  summary: string
  /** 個別の指摘。ok のときは空。 */
  problems: string[]
  /** 表ごとの残余（監視の記録用）。 */
  runway: Record<string, number>
}

/**
 * 残余のしきい値（今月を 0 とした「先の月数」）。
 *
 *   2 以上 … 正常（cron が毎月25日に翌月・翌々月を作る設計どおり）
 *   1     … 警告。cron が1回失敗した可能性。翌月には尽きる
 *   0 以下 … 危険。今月ぶんしか無い＝**来月頭に書き込みが落ちる**
 */
export const WARN_MONTHS_AHEAD = 2
export const CRITICAL_MONTHS_AHEAD = 1

/** 見張る対象。ここに無い表は判定しない（増えたら明示的に足す）。 */
export const WATCHED_TABLES = ['live_sessions', 'monitor_results'] as const

/** 各表に対応する生成ジョブ名。 */
export const PARTITION_JOBS: Record<string, string> = {
  live_sessions:   'live_sessions_partition',
  monitor_results: 'monitor_results_partition',
}

export function evaluatePartitionHealth(facts: PartitionHealthFacts): PartitionVerdict {
  const problems: string[] = []
  const runway: Record<string, number> = {}
  let severity: Severity = 'ok'

  const raise = (s: Severity) => {
    if (s === 'critical' || (s === 'warn' && severity === 'ok')) severity = s
  }

  for (const table of WATCHED_TABLES) {
    const info = facts.tables?.[table]

    // 表そのものが見えない＝関数の想定と実際がずれている。黙って ok にしない。
    if (!info || typeof info.months_ahead !== 'number') {
      problems.push(`${table}: パーティションが 1 つも見つかりません`)
      raise('critical')
      continue
    }

    const ahead = info.months_ahead
    runway[table] = ahead

    // 2026-08-09、変異テストがこの分岐の不備を出した。旧実装は
    //   if (ahead <= 0) …critical / else if (ahead < 2) …critical / else if (ahead < 2) …warn
    // となっており、**3 本目に到達する値が存在しなかった**（warn を一度も出せない）。
    // 定数のコメントに書いた意図（1 ヶ月＝警告）と実装がずれていた。
    const at = `${table}: 残り ${ahead} ヶ月（最終 ${info.last_partition ?? '不明'}）`
    if (ahead <= CRITICAL_MONTHS_AHEAD - 1) {
      // 今月ぶんしか無い。月が変わった瞬間に書き込みが落ちる。
      problems.push(`${at} — 来月頭に書き込みが失敗します`)
      raise('critical')
    } else if (ahead < WARN_MONTHS_AHEAD) {
      // 設計上は常に 2 ヶ月先まであるはず。1 ヶ月＝生成が 1 回失敗した形。
      problems.push(`${at} — 生成ジョブが失敗している可能性があります`)
      raise('warn')
    }
  }

  // pg_cron が無い環境（ローカル等）ではジョブの有無を問わない。
  // 本番で拡張ごと消えていたらそれ自体が critical。
  if (facts.pg_cron === false) {
    problems.push('pg_cron 拡張がありません — パーティションは自動生成されません')
    raise('critical')
  } else {
    for (const table of WATCHED_TABLES) {
      const job = PARTITION_JOBS[table]
      if (facts.jobs?.[job] !== true) {
        // 残余があっても、作る人が居なければ数ヶ月後に必ず尽きる。
        // **DB を建て直すと pg_cron のジョブは消える**ので、これは実際に起きる。
        problems.push(`cron ジョブ ${job} が登録されていません（${table} の生成が止まります）`)
        raise('critical')
      }
    }
  }

  const summary = severity === 'ok'
    ? `パーティション正常（${WATCHED_TABLES.map((t) => `${t}=${runway[t] ?? '?'}ヶ月先`).join(' / ')}）`
    : `パーティション${severity === 'critical' ? '異常' : '警告'}: ${problems[0]}`

  return { severity, summary, problems, runway }
}
